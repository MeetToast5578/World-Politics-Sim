// Demography: three age cohorts (0-14, 15-64, 65+) per country.
// Monthly: births, deaths, ageing, net migration (globally conserved).
// Yearly: fertility and life expectancy relax toward income-implied levels (demographic transition).
// Simplification: three broad cohorts with uniform-age-within-cohort ageing. Phase 2 replaces this with
// 5-year cohorts by sex from UN WPP; see docs/DESIGN.md §3.
import type { Baseline, Curve } from '../types';
import type { Params } from '../params';
import { totalPop, type WorldState } from '../state';

export function mortalityRates(p: Params, e0: number): [number, number, number] {
  const { a, b } = p.mort;
  return [a[0] * Math.exp(-b[0] * (e0 - 70)), a[1] * Math.exp(-b[1] * (e0 - 70)), a[2] * Math.exp(-b[2] * (e0 - 70))];
}

/** Interpolates a curve at log PPP GDP per capita; flat outside the observed range (no extrapolation). */
export function curveAt(cv: Curve, gdpPppPc: number): number {
  const x = Math.log(Math.max(gdpPppPc, 1)), k = cv.knots;
  if (x <= k[0][0]) return k[0][1];
  for (let i = 1; i < k.length; i++) {
    if (x <= k[i][0]) { const t = (x - k[i - 1][0]) / (k[i][0] - k[i - 1][0]); return k[i - 1][1] + t * (k[i][1] - k[i - 1][1]); }
  }
  return k[k.length - 1][1];
}

export function gdpPppPc(st: WorldState, c: number): number {
  return (st.f.gdp[c] * st.f.pppRatio[c]) / totalPop(st, c);
}

export function initDemography(st: WorldState, b: Baseline, p: Params): void {
  const { f } = st;
  b.countries.forEach((bc, c) => {
    const v = (k: string) => {
      const o = bc.fields[k];
      if (!o) throw new Error(`baseline: ${bc.id} has no ${k}`);
      return o.v;
    };
    const P = v('pop');
    let s0 = v('pop0014') / 100, s2 = v('pop65') / 100;
    const s1 = Math.max(0, 1 - s0 - s2);
    const norm = s0 + s1 + s2;
    s0 /= norm; s2 /= norm;
    f.p0[c] = P * s0; f.p2[c] = P * s2; f.p1[c] = P - f.p0[c] - f.p2[c];
    f.tfr[c] = v('tfr');
    f.lifeExp[c] = v('lifeExp');
    f.urban[c] = bc.fields.urban?.v ?? NaN;
    // Calibration constants: make baseline births and deaths match the observed crude rates exactly.
    f.fertK[c] = ((v('cbr') / 1000) * P) / (f.tfr[c] * f.p1[c]);
    const m = mortalityRates(p, f.lifeExp[c]);
    f.mortK[c] = ((v('cdr') / 1000) * P) / (m[0] * f.p0[c] + m[1] * f.p1[c] + m[2] * f.p2[c]);
    f.migRate[c] = (bc.fields.netMigration?.v ?? 0) / P;
  });
}

/** Must run after initEconomy (needs GDP and PPP ratio). Residuals keep each country's deviation from the
 *  cross-section (TFR as a log ratio, life expectancy in years) and decay over time. */
export function initTransitionResiduals(st: WorldState, b: Baseline): void {
  const { tfr, lifeExp } = b.meta.curves;
  for (let c = 0; c < st.n; c++) {
    const y = gdpPppPc(st, c);
    st.f.tfrResid[c] = Math.log(st.f.tfr[c] / curveAt(tfr, y));
    st.f.leResid[c] = st.f.lifeExp[c] - curveAt(lifeExp, y);
  }
}

const DT = 1 / 12;

export function demographyMonthly(st: WorldState, p: Params): void {
  const { f, n } = st;
  // Net migration: scale inflows and outflows to the smaller of the two totals so the world total is conserved.
  let inflow = 0, outflow = 0;
  const mig = new Float64Array(n);
  for (let c = 0; c < n; c++) {
    mig[c] = Math.max(f.migRate[c] * totalPop(st, c) * DT, -0.01 * f.p1[c]);
    if (mig[c] > 0) inflow += mig[c]; else outflow -= mig[c];
  }
  const flow = Math.min(inflow, outflow);
  const sIn = inflow > 0 ? flow / inflow : 0, sOut = outflow > 0 ? flow / outflow : 0;

  for (let c = 0; c < n; c++) {
    const m = mortalityRates(p, f.lifeExp[c]);
    const k = f.mortK[c] * DT;
    const births = f.fertK[c] * f.tfr[c] * f.p1[c] * DT;
    const d0 = k * m[0] * f.p0[c], d1 = k * m[1] * f.p1[c], d2 = k * m[2] * f.p2[c];
    const a01 = (f.p0[c] * DT) / p.childYears, a12 = (f.p1[c] * DT) / p.workYears;
    const mg = mig[c] * (mig[c] > 0 ? sIn : sOut); // migrants modelled as working-age
    f.p0[c] += births - d0 - a01;
    f.p1[c] += a01 - d1 - a12 + mg;
    f.p2[c] += a12 - d2;
  }
}

export function demographyYearly(st: WorldState, b: Baseline, p: Params): void {
  const { f } = st;
  const { tfr, lifeExp } = b.meta.curves;
  const relax = 1 - Math.exp(-1 / p.transitionYears), decay = Math.exp(-1 / p.residualYears);
  for (let c = 0; c < st.n; c++) {
    f.tfrResid[c] *= decay;
    f.leResid[c] *= decay;
    const y = gdpPppPc(st, c);
    const tfrTarget = curveAt(tfr, y) * Math.exp(f.tfrResid[c]);
    const leTarget = curveAt(lifeExp, y) + f.leResid[c];
    f.tfr[c] += (tfrTarget - f.tfr[c]) * relax;
    f.lifeExp[c] += (leTarget - f.lifeExp[c]) * relax;
  }
}
