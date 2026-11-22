// Demography: cohort-component projection by single year of age (0..99, 100+) and sex, run yearly on 1 January.
//
//   mortality  Siler hazard per sex  μ(x) = a1·e^(−b1·x) + c + a2·e^(b2·x),  c = cA1·a1 + c0.
//              a1 (childhood) and a2 (adult) are solved per country and sex so that the life table reproduces
//              under-5 mortality and life expectancy at birth (WDI). Probabilities use the exact integral of μ.
//   fertility  ASFR(x) = TFR · g(x; μ, σ), g a discretised normal over ages 15-49 with the same mean age and spread
//              for every country (WDI adolescent fertility, which would pin the timing per country, is currently not
//              retrievable from the API). fertK scales births to the WDI crude birth rate at baseline, absorbing the
//              schedule-shape error. Sex ratio at birth from WDI.
//   migration  net migrants = rate × population, conserved worldwide, distributed by a fixed age profile. The rate
//              starts at the 9-year WDI average and decays toward zero (no push/pull model until Phase 5).
//   transition yearly, TFR, e0 and under-5 mortality relax toward income curves (binned cross-section medians)
//              plus a decaying country residual; Siler parameters are re-solved to the new targets. The TFR curve
//              also drifts at the rate observed in the decade before the baseline (fertility fell faster than
//              income alone explains), fading over time. Mortality curves do not drift: their estimated drift was
//              not stable across periods (AIDS in the 1990s, COVID in 2020-22) — see docs/DESIGN.md.
//              After TFR first falls below replacement, the target blends (log-linearly, time constant
//              fertilityPhase3.years) toward a long-run level, as in UN WPP's "Phase III" assumption.
// Initial single-year ages: WDI 5-year groups split evenly within each group; the 80+ group is spread over 80..100+
// in proportion to life-table survivorship (stationary assumption inside that group).
import type { Baseline, Curve } from '../types';
import type { Params } from '../params';
import { AGES, cohortIndex, totalPop, type WorldState } from '../state';

export const FEMALE = 0, MALE = 1;
const OPEN = AGES - 1; // 100+

/** Interpolates a curve at log PPP GDP per capita; flat outside the observed range (no extrapolation).
 *  driftYears > 0 shifts every knot by its estimated drift (curves move over time independently of income). */
export function curveAt(cv: Curve, gdpPppPc: number, driftYears = 0): number {
  const x = Math.log(Math.max(gdpPppPc, 1)), k = cv.knots;
  const y = (i: number) => (!driftYears || !cv.drift ? k[i][1] : cv.driftLog ? k[i][1] * Math.exp(cv.drift[i] * driftYears) : k[i][1] + cv.drift[i] * driftYears);
  if (x <= k[0][0]) return y(0);
  for (let i = 1; i < k.length; i++) {
    if (x <= k[i][0]) { const t = (x - k[i - 1][0]) / (k[i][0] - k[i - 1][0]); return y(i - 1) + t * (y(i) - y(i - 1)); }
  }
  return y(k.length - 1);
}

/** Effective years of curve drift: the observed drift rate, fading with time constant fadeYears. */
export function driftYears(st: WorldState, p: Params): number {
  const t = (st.day - st.startDay) / 365.25;
  return p.fertilityDrift.fadeYears * (1 - Math.exp(-t / p.fertilityDrift.fadeYears));
}

export function gdpPppPc(st: WorldState, c: number): number {
  return (st.f.gdp[c] * st.f.pppRatio[c]) / totalPop(st, c);
}

// ---------------------------------------------------------------- life table

const MAXAGE = 130;
/** Age terms of the integrated Siler hazard, precomputed once per parameter set:
 *  H(x) = a1·K1[x] + (cA1·a1 + c0) + a2·K2[x] over [x, x+1). */
const kCache = new WeakMap<Params['siler'], [Float64Array, Float64Array]>();
function kTerms(p: Params): [Float64Array, Float64Array] {
  let k = kCache.get(p.siler);
  if (!k) {
    const { b1, b2 } = p.siler, K1 = new Float64Array(MAXAGE), K2 = new Float64Array(MAXAGE);
    for (let x = 0; x < MAXAGE; x++) {
      K1[x] = (Math.exp(-b1 * x) - Math.exp(-b1 * (x + 1))) / b1;
      K2[x] = (Math.exp(b2 * (x + 1)) - Math.exp(b2 * x)) / b2;
    }
    kCache.set(p.siler, (k = [K1, K2]));
  }
  return k;
}

/** Probability of dying between exact ages x and x+1 (x = 0..99) and, for the open group, within one year. */
export function deathProbs(p: Params, a1: number, a2: number, out = new Float64Array(AGES)): Float64Array {
  const [K1, K2] = kTerms(p), c = p.siler.cA1 * a1 + p.siler.c0;
  for (let x = 0; x < AGES; x++) out[x] = 1 - Math.exp(-(a1 * K1[x] + c + a2 * K2[x]));
  return out;
}

export function under5(p: Params, a1: number, a2: number): number {
  const [K1, K2] = kTerms(p), c = p.siler.cA1 * a1 + p.siler.c0;
  let H = 0;
  for (let x = 0; x < 5; x++) H += a1 * K1[x] + c + a2 * K2[x];
  return 1 - Math.exp(-H);
}

/** Life expectancy at birth from single-year probabilities (deaths at mid-interval; table closed at 130). */
export function lifeExpectancy(p: Params, a1: number, a2: number): number {
  const [K1, K2] = kTerms(p), c = p.siler.cA1 * a1 + p.siler.c0;
  let l = 1, e = 0;
  for (let x = 0; x < MAXAGE; x++) {
    const l1 = l * Math.exp(-(a1 * K1[x] + c + a2 * K2[x]));
    e += (l + l1) / 2;
    l = l1;
    if (l < 1e-7) break;
  }
  return e;
}

/** Newton iteration in log space for g(a) = target (g monotone); numeric derivative, step clamped. */
function newtonLog(g: (a: number) => number, target: number, a: number, iters: number): number {
  let la = Math.log(a);
  for (let i = 0; i < iters; i++) {
    const v = g(Math.exp(la)) - target;
    if (Math.abs(v) < 1e-10) break;
    const d = (g(Math.exp(la + 1e-4)) - g(Math.exp(la))) / 1e-4;
    if (d === 0 || !Number.isFinite(d)) break;
    la -= Math.max(-2, Math.min(2, v / d));
  }
  return Math.exp(la);
}

/** Solve (a1, a2) so the life table reproduces under-5 mortality u5 (probability) and life expectancy e0.
 *  `guess` warm-starts the yearly update (targets move little from one year to the next). */
export function solveSiler(p: Params, e0: number, u5: number, guess?: [number, number], rounds = 4): [number, number] {
  let a1 = guess?.[0] ?? 0.02, a2 = guess?.[1] ?? 5e-5;
  const iters = guess ? 3 : 30;
  for (let r = 0; r < rounds; r++) {
    a1 = newtonLog((a) => under5(p, a, a2), u5, a1, iters);
    a2 = newtonLog((a) => lifeExpectancy(p, a1, a), e0, a2, iters);
  }
  return [a1, a2];
}

// ---------------------------------------------------------------- fertility schedule

/** Normalised ASFR shape over single ages 15..49 (index 0 = age 15). */
export function fertilityShape(mean: number, sd: number, out = new Float64Array(35)): Float64Array {
  let s = 0;
  for (let i = 0; i < 35; i++) { out[i] = Math.exp(-((15 + i + 0.5 - mean) ** 2) / (2 * sd * sd)); s += out[i]; }
  for (let i = 0; i < 35; i++) out[i] /= s;
  return out;
}


// ---------------------------------------------------------------- migration age profile

/** Share of net migrants by single age (sums to 1). Coarse Rogers-Castro-like shape, assumption. */
export const MIGRATION_PROFILE: Float64Array = (() => {
  const w = new Float64Array(AGES);
  const band = (a: number, b: number, share: number) => { for (let x = a; x <= b; x++) w[x] = share / (b - a + 1); };
  band(0, 14, 0.2); band(15, 19, 0.06); band(20, 34, 0.48); band(35, 49, 0.17); band(50, 64, 0.06); band(65, OPEN, 0.03);
  return w;
})();

// ---------------------------------------------------------------- init

const GROUPS = ['0004', '0509', '1014', '1519', '2024', '2529', '3034', '3539', '4044', '4549', '5054', '5559', '6064', '6569', '7074', '7579', '80UP'];

export function initDemography(st: WorldState, b: Baseline, p: Params): void {
  const { f, cohorts } = st;
  const q = new Float64Array(AGES);
  b.countries.forEach((bc, c) => {
    const v = (k: string) => {
      const o = bc.fields[k];
      if (!o) throw new Error(`baseline: ${bc.id} has no ${k}`);
      return o.v;
    };
    const P = v('pop');
    f.tfr[c] = v('tfr');
    f.e0F[c] = v('lifeExpF'); f.e0M[c] = v('lifeExpM');
    f.u5F[c] = v('u5mrF') / 1000; f.u5M[c] = v('u5mrM') / 1000;
    f.srb[c] = v('srb');
    f.urban[c] = bc.fields.urban?.v ?? NaN;
    f.migRate[c] = (bc.fields.netMigration?.v ?? 0) / P;
    [f.silA1F[c], f.silA2F[c]] = solveSiler(p, f.e0F[c], f.u5F[c]);
    [f.silA1M[c], f.silA2M[c]] = solveSiler(p, f.e0M[c], f.u5M[c]);
    f.mab[c] = bc.fields.mac?.v ?? p.fertMean; // UN WPP mean age of childbearing

    const fShare = v('femaleShare') / 100;
    for (const sex of [FEMALE, MALE]) {
      const pre = sex === FEMALE ? 'f' : 'm';
      const tot = P * (sex === FEMALE ? fShare : 1 - fShare);
      const shares = GROUPS.map((g) => v(pre + g));
      const norm = shares.reduce((s, x) => s + x, 0);
      const base = cohortIndex(c, sex);
      for (let gi = 0; gi < 16; gi++) for (let k = 0; k < 5; k++) cohorts[base + gi * 5 + k] = (tot * shares[gi]) / norm / 5;
      // 80+: proportional to survivorship l(x), x = 80..100+
      deathProbs(p, sex === FEMALE ? f.silA1F[c] : f.silA1M[c], sex === FEMALE ? f.silA2F[c] : f.silA2M[c], q);
      const l = new Float64Array(AGES - 80);
      let lx = 1, sum = 0;
      for (let x = 80; x < OPEN; x++) { l[x - 80] = lx; sum += lx; lx *= 1 - q[x]; }
      l[OPEN - 80] = lx / q[OPEN]; sum += l[OPEN - 80]; // open group: stationary stock l(100)/μ
      for (let x = 80; x <= OPEN; x++) cohorts[base + x] = ((tot * shares[16]) / norm) * (l[x - 80] / sum);
    }
    aggregate(st, c);
    // births implied by the schedule vs. observed crude birth rate -> calibration constant
    f.fertK[c] = 1;
    f.fertK[c] = (v('cbr') / 1000) * P / birthsOf(st, p, c);
  });
}

/** Must run after initEconomy (needs GDP and PPP ratio). Residuals: TFR and u5 as log ratios, e0 in years. */
export function initTransitionResiduals(st: WorldState, b: Baseline): void {
  const cv = b.meta.curves, f = st.f;
  for (let c = 0; c < st.n; c++) {
    const y = gdpPppPc(st, c);
    f.tfrResid[c] = Math.log(f.tfr[c] / curveAt(cv.tfr, y));
    f.e0FResid[c] = f.e0F[c] - curveAt(cv.lifeExpF, y);
    f.e0MResid[c] = f.e0M[c] - curveAt(cv.lifeExpM, y);
    f.u5FResid[c] = Math.log(f.u5F[c] / (curveAt(cv.u5mrF, y) / 1000));
    f.u5MResid[c] = Math.log(f.u5M[c] / (curveAt(cv.u5mrM, y) / 1000));
    f.mabResid[c] = cv.mac ? f.mab[c] - curveAt(cv.mac, y) : 0;
  }
}

// ---------------------------------------------------------------- yearly projection

/** Recomputes the broad-age aggregates other systems read (p0 0-14, p1 15-64, p2 65+) and life expectancy. */
export function aggregate(st: WorldState, c: number): void {
  const { cohorts, f } = st;
  let p0 = 0, p1 = 0, p2 = 0;
  for (const sex of [FEMALE, MALE]) {
    const base = cohortIndex(c, sex);
    for (let x = 0; x < 15; x++) p0 += cohorts[base + x];
    for (let x = 15; x < 65; x++) p1 += cohorts[base + x];
    for (let x = 65; x < AGES; x++) p2 += cohorts[base + x];
  }
  f.p0[c] = p0; f.p1[c] = p1; f.p2[c] = p2;
  f.lifeExp[c] = (f.e0F[c] + f.e0M[c]) / 2;
}

const shapeBuf = new Float64Array(35);
function birthsOf(st: WorldState, p: Params, c: number): number {
  const g = fertilityShape(st.f.mab[c], p.fertSd, shapeBuf);
  const base = cohortIndex(c, FEMALE);
  let b = 0;
  for (let i = 0; i < 35; i++) b += g[i] * st.cohorts[base + 15 + i];
  return st.f.fertK[c] * st.f.tfr[c] * b;
}

const qBuf = new Float64Array(AGES);

export function demographyYearly(st: WorldState, b: Baseline, p: Params): void {
  const { f, n, cohorts } = st;
  // 1. vital events and ageing over the past year
  for (let c = 0; c < n; c++) {
    const births = birthsOf(st, p, c);
    let deaths = 0;
    for (const sex of [FEMALE, MALE]) {
      const base = cohortIndex(c, sex);
      deathProbs(p, sex === FEMALE ? f.silA1F[c] : f.silA1M[c], sex === FEMALE ? f.silA2F[c] : f.silA2M[c], qBuf);
      const open = cohorts[base + OPEN] * (1 - qBuf[OPEN]) + cohorts[base + OPEN - 1] * (1 - qBuf[OPEN - 1]);
      deaths += cohorts[base + OPEN] * qBuf[OPEN] + cohorts[base + OPEN - 1] * qBuf[OPEN - 1];
      for (let x = OPEN - 1; x >= 1; x--) {
        deaths += cohorts[base + x - 1] * qBuf[x - 1];
        cohorts[base + x] = cohorts[base + x - 1] * (1 - qBuf[x - 1]);
      }
      cohorts[base + OPEN] = open;
      const share = sex === MALE ? f.srb[c] / (1 + f.srb[c]) : 1 / (1 + f.srb[c]);
      const newborn = births * share;
      deaths += newborn * qBuf[0] * p.infantSeparation;
      cohorts[base] = newborn * (1 - qBuf[0] * p.infantSeparation);
    }
    f.births[c] = births;
    f.deaths[c] = deaths;
  }
  // 2. net migration, scaled so world inflows equal world outflows
  let inflow = 0, outflow = 0;
  const mig = new Float64Array(n);
  for (let c = 0; c < n; c++) {
    mig[c] = Math.max(f.migRate[c] * totalPop(st, c), -p.maxEmigration * totalPop(st, c));
    if (mig[c] > 0) inflow += mig[c]; else outflow -= mig[c];
  }
  // outflows first (an age group can never lose more people than it has), then inflows scaled to what actually left
  const sOut = outflow > 0 ? Math.min(inflow, outflow) / outflow : 0;
  let left = 0;
  for (let c = 0; c < n; c++) {
    f.netMig[c] = 0;
    if (mig[c] >= 0) continue;
    for (const sex of [FEMALE, MALE]) {
      const base = cohortIndex(c, sex);
      for (let x = 0; x < AGES; x++) {
        const out = Math.min(cohorts[base + x], -0.5 * mig[c] * sOut * MIGRATION_PROFILE[x]);
        cohorts[base + x] -= out; f.netMig[c] -= out; left += out;
      }
    }
  }
  const sIn = inflow > 0 ? left / inflow : 0;
  for (let c = 0; c < n; c++) {
    if (mig[c] > 0) {
      f.netMig[c] = mig[c] * sIn;
      for (const sex of [FEMALE, MALE]) { const base = cohortIndex(c, sex); for (let x = 0; x < AGES; x++) cohorts[base + x] += 0.5 * f.netMig[c] * MIGRATION_PROFILE[x]; }
    }
    aggregate(st, c);
  }
  // 3. demographic transition toward income-implied levels
  const cv = b.meta.curves;
  const relax = 1 - Math.exp(-1 / p.transitionYears), decay = Math.exp(-1 / p.residualYears);
  const migDecay = Math.exp(-1 / p.migrationYears);
  const dy = p.fertilityDrift.on ? driftYears(st, p) : 0;
  for (let c = 0; c < n; c++) {
    f.migRate[c] *= migDecay;
    for (const k of ['tfrResid', 'e0FResid', 'e0MResid', 'u5FResid', 'u5MResid', 'mabResid'] as const) f[k][c] *= decay;
    const y = gdpPppPc(st, c);
    // Post-transition ("Phase III", UN WPP): once below replacement, the target blends toward a long-run level.
    if (f.phase3Years[c] > 0 || f.tfr[c] < p.fertilityPhase3.entry) f.phase3Years[c] += 1;
    const w = Math.exp(-f.phase3Years[c] / p.fertilityPhase3.years);
    // schooling gained since the start lowers fertility beyond what income implies (education.ts)
    const transition = curveAt(cv.tfr, y, dy) * Math.exp(f.tfrResid[c] - p.education.fertility * (f.eduYears[c] - f.eduYears0[c]));
    const tfrTarget = p.fertilityPhase3.on ? Math.exp(w * Math.log(transition) + (1 - w) * Math.log(p.fertilityPhase3.level)) : transition;
    f.tfr[c] += (tfrTarget - f.tfr[c]) * relax;
    const longevity = p.mortalityProgress * (st.day - st.startDay) / 365.25; // medicine improves at every income level
    f.e0F[c] += (Math.min(97, curveAt(cv.lifeExpF, y) + longevity) + f.e0FResid[c] - f.e0F[c]) * relax;
    if (cv.mac) f.mab[c] += (Math.min(34, Math.max(24, curveAt(cv.mac, y) + f.mabResid[c])) - f.mab[c]) * relax; // childbearing is postponed as incomes rise
    f.e0M[c] += (Math.min(94, curveAt(cv.lifeExpM, y) + longevity) + f.e0MResid[c] - f.e0M[c]) * relax;
    f.u5F[c] += ((curveAt(cv.u5mrF, y) / 1000) * Math.exp(f.u5FResid[c]) - f.u5F[c]) * relax;
    f.u5M[c] += ((curveAt(cv.u5mrM, y) / 1000) * Math.exp(f.u5MResid[c]) - f.u5M[c]) * relax;
    [f.silA1F[c], f.silA2F[c]] = solveSiler(p, f.e0F[c], f.u5F[c], [f.silA1F[c], f.silA2F[c]], 1);
    [f.silA1M[c], f.silA2M[c]] = solveSiler(p, f.e0M[c], f.u5M[c], [f.silA1M[c], f.silA2M[c]], 1);
    f.lifeExp[c] = (f.e0F[c] + f.e0M[c]) / 2;
  }
}
