// Education and learning (yearly).
//  - children's expected years of school (eduExp) relax toward the income curve plus a fading residual; fighting on the
//    territory keeps children out of school
//  - test scores (learn, harmonised 300-625 scale) relax toward their income curve plus residual, more slowly
//  - adults' mean years of schooling (eduYears, age 25+) change by cohort replacement: each year the 25-year-olds join
//    the adult population with the schooling of their generation. Their schooling at the start is set so the stock
//    follows its own trend of the previous ten years (data), and then moves with expected years of school ~15 years
//    earlier (eduPipe). Adults' learning (learnAdult) is replaced the same way.
// Effects (elsewhere): human capital in production h = exp(φ · years · learning/625) (learning-adjusted years, World Bank
// Human Capital Index); lower fertility, a higher long-run democracy level and lower civil-war risk with more schooling.
import type { Baseline } from '../types';
import type { Params } from '../params';
import { AGES, cohortIndex, type WorldState } from '../state';
import { curveAt, driftYears, FEMALE, gdpPppPc, MALE } from './demography';

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/** Human capital per worker: learning-adjusted years of schooling at a fixed return per year. */
export const humanCapital = (st: WorldState, p: Params, c: number) => Math.exp(p.education.returnPerYear * st.f.eduYears[c] * (st.f.learnAdult[c] / 625));

/** Share of the 25+ population that turned 25 this year (cohort replacement rate). */
function entryShare(st: WorldState, c: number): number {
  let at25 = 0, adults = 0;
  for (const sex of [FEMALE, MALE]) {
    const base = cohortIndex(c, sex);
    at25 += st.cohorts[base + 25];
    for (let x = 25; x < AGES; x++) adults += st.cohorts[base + x];
  }
  return adults > 0 ? at25 / adults : 0;
}

export function initEducation(st: WorldState, b: Baseline, p: Params): void {
  const f = st.f, cv = b.meta.curves, E = p.education;
  b.countries.forEach((bc, c) => {
    const v = (k: string) => { const o = bc.fields[k]; if (!o) throw new Error(`baseline: ${bc.id} has no ${k}`); return o.v; };
    const y = gdpPppPc(st, c);
    f.eduYears[c] = f.eduYears0[c] = v('schoolYears');
    f.eduExp[c] = v('expectedYears');
    f.eduPipe[c] = v('expectedYearsLag');
    f.eduExpResid[c] = f.eduExp[c] - curveAt(cv.expectedYears, y);
    f.learn[c] = f.learnAdult[c] = v('learning');
    f.learnResid[c] = f.learn[c] - curveAt(cv.learning, y);
    // schooling of this year's entrants implied by the observed trend of the stock: Δyears = rate·(entrants − years)
    const rate = E.replacement * entryShare(st, c);
    const implied = f.eduYears[c] + (rate > 0 ? v('schoolTrend') / rate : 0);
    f.eduEntry0[c] = clamp(implied, f.eduYears[c] - 2, Math.max(f.eduYears[c], 0.9 * f.eduExp[c]) + 0.5);
    // TFP was calibrated with raw labour (initEconomy): take human capital out of it
    f.A[c] /= humanCapital(st, p, c) ** (1 - p.alpha);
  });
}

export function educationYearly(st: WorldState, b: Baseline, p: Params): void {
  const f = st.f, cv = b.meta.curves, E = p.education;
  const relax = 1 - Math.exp(-1 / p.transitionYears), decay = Math.exp(-1 / p.residualYears);
  const relaxLearn = 1 - Math.exp(-1 / E.learningYears), pipe = 1 - Math.exp(-1 / E.pipelineYears);
  const dy = driftYears(st, p); // schooling expanded faster than income alone implies (curve drift, as for fertility)
  for (let c = 0; c < st.n; c++) {
    const y = gdpPppPc(st, c);
    f.eduExpResid[c] *= decay; f.learnResid[c] *= decay;
    const war = Math.exp(-E.warLoss * f.warLoad[c]);
    f.eduExp[c] += (clamp((curveAt(cv.expectedYears, y, dy) + f.eduExpResid[c]) * war, 1, 22) - f.eduExp[c]) * relax;
    f.learn[c] += (clamp(curveAt(cv.learning, y) + f.learnResid[c], 250, 625) - f.learn[c]) * relaxLearn;
    const pipe0 = f.eduPipe[c];
    f.eduPipe[c] += (f.eduExp[c] - f.eduPipe[c]) * pipe;
    f.eduEntry0[c] += E.attainment * (f.eduPipe[c] - pipe0); // entrants' schooling follows earlier school expectancy
    const rate = E.replacement * entryShare(st, c);
    f.eduYears[c] += (clamp(f.eduEntry0[c], 0, 20) - f.eduYears[c]) * rate;
    f.learnAdult[c] += (f.learn[c] - f.learnAdult[c]) * rate;
  }
}
