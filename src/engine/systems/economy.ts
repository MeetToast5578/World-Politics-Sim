// Economy (quarterly): Cobb-Douglas production Y = A K^α L^(1-α) e^cycle, all in constant 2023 USD (annualised).
//  - capital accumulates from the observed investment share, depreciates at δ
//  - TFP grows at the frontier rate plus catch-up proportional to the log gap, scaled by absorptive capacity (institutions)
//  - a per-country AR(1) business cycle, volatility calibrated to 2000-2019 real GDP growth
//  - unemployment moves with the cycle (Okun); labour = working-age pop × participation × (1 - u)
//  - public debt follows the budget identity with a Bohn-type fiscal reaction (stand-in for Phase 3 politics),
//    and is restructured (sovereign default) when interest payments exceed a share of revenue
//  - military capital = perpetual inventory of military spending
// Not modelled yet (Phase 2+): sectors, prices/inflation, trade flows, exchange rates (PPP ratio is held fixed).
import type { Baseline } from '../types';
import type { Params } from '../params';
import type { Rng } from '../rng';
import type { WorldState } from '../state';

const DT = 0.25;
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
/** Converts annual growth s.d. to the AR(1) innovation s.d. so year-over-year changes of the cycle match it. */
export const cycleScale = (rho: number) => Math.sqrt((2 * (1 - rho ** 4)) / (1 - rho ** 2));

export function labour(st: WorldState, c: number): number {
  return st.f.p1[c] * st.f.lfRate[c] * (1 - st.f.unemp[c] / 100);
}

export function initEconomy(st: WorldState, b: Baseline, p: Params): void {
  const { f } = st;
  b.countries.forEach((bc, c) => {
    const v = (k: string, dflt?: number) => {
      const o = bc.fields[k];
      if (!o) { if (dflt !== undefined) return dflt; throw new Error(`baseline: ${bc.id} has no ${k}`); }
      return o.v;
    };
    const Y = v('gdp');
    f.gdp[c] = f.gdpPrevQ[c] = f.gdpPrevY[c] = Y;
    f.pppRatio[c] = v('gdpPpp') / Y;
    f.unemp[c] = f.unempStar[c] = v('unemployment');
    f.lfRate[c] = clamp(v('laborForce') / f.p1[c], 0.2, 1.0);
    f.K[c] = p.capitalOutput * Y;
    f.A[c] = Y / (f.K[c] ** p.alpha * labour(st, c) ** (1 - p.alpha));
    f.sInv[c] = clamp(v('investment') / 100, 0.05, 0.6);
    f.cycleSd[c] = clamp(v('growthSd') / 100, 0.005, 0.08) / cycleScale(p.cycleRho);
    f.wgiVoice[c] = v('wgiVoice'); f.wgiStability[c] = v('wgiStability'); f.wgiEffectiveness[c] = v('wgiEffectiveness');
    f.wgiRuleOfLaw[c] = v('wgiRuleOfLaw'); f.wgiCorruption[c] = v('wgiCorruption');
    f.absorb[c] = 1 / (1 + Math.exp(-p.absorbSlope * f.wgiEffectiveness[c]));
    // public finance: primary balance implied by the overall balance and the interest bill
    f.debt[c] = (v('govDebt') / 100) * Y;
    f.debtRatio0[c] = f.debt[c] / Y;
    f.revShare[c] = v('govRevenue') / 100;
    f.pb0[c] = v('govBalance') / 100 + p.realRate * f.debtRatio0[c];
    f.primSpendShare[c] = f.revShare[c] - f.pb0[c];
    f.milexShare[c] = v('milexShare', 0) / 100;
    f.milCap[c] = (f.milexShare[c] * Y) / p.milDepreciation; // steady state of the perpetual inventory
    f.afRate[c] = v('armedForces', 0) / f.p1[c];
    f.inflation[c] = v('inflation', NaN);
    f.tradeShare[c] = v('trade', NaN);
  });
}

/** Real rate on public debt: base rate plus a premium on debt above the higher of 60% of GDP and the country's
 *  reference ratio (baseline, or post-restructuring level). Baseline high-debt countries thus start at the base rate. */
export function interestRate(p: Params, debtRatio: number, refRatio: number): number {
  return p.realRate + p.riskPremium * Math.max(0, debtRatio - Math.max(0.6, refRatio));
}

export function economyQuarterly(st: WorldState, p: Params, rng: Rng, onDefault?: (c: number, x: Record<string, number>) => void): void {
  const { f, n } = st;
  let lnAf = -Infinity;
  for (let c = 0; c < n; c++) if (labour(st, c) >= p.frontierMinLabor) lnAf = Math.max(lnAf, Math.log(f.A[c]));
  for (let c = 0; c < n; c++) {
    const lnA = Math.log(f.A[c]);
    const gap = Math.max(0, lnAf - lnA);
    f.A[c] = Math.exp(lnA + (p.frontierGrowth + p.catchUp * f.absorb[c] * gap) * DT);
    // shock drawn for every country in index order, so the draw sequence never depends on state
    f.cycle[c] = p.cycleRho * f.cycle[c] + f.cycleSd[c] * rng.normal();
    f.unemp[c] = Math.max(0.5, f.unempStar[c] - p.okun * f.cycle[c] * 100);
    const Yprev = f.gdp[c];
    const Y = f.A[c] * f.K[c] ** p.alpha * labour(st, c) ** (1 - p.alpha) * Math.exp(f.cycle[c]);
    f.gdpPrevQ[c] = Yprev;
    f.gdp[c] = Y;
    f.negQ[c] = Y < Yprev ? f.negQ[c] + 1 : 0;
    f.K[c] += (f.sInv[c] * Y - p.delta * f.K[c]) * DT;
    // budget identity: Δdebt = (primary spending - revenue) + interest
    const d = f.debt[c] / Y;
    const pb = f.pb0[c] + p.bohn * (d - f.debtRatio0[c]);
    f.primSpendShare[c] = f.revShare[c] - pb;
    const interest = interestRate(p, d, f.debtRatio0[c]) * f.debt[c];
    // shortcut: gross debt floors at 0; surpluses beyond that are not tracked as sovereign assets (Phase 2).
    f.debt[c] = Math.max(0, f.debt[c] + ((f.primSpendShare[c] - f.revShare[c]) * Y + interest) * DT);
    // Sovereign default: when interest absorbs too much revenue, debt is restructured with a haircut and output falls.
    const burden = interest / (f.revShare[c] * Y);
    if (burden > p.defaultBurden) {
      onDefault?.(c, { debtRatio: f.debt[c] / Y, burden });
      f.debt[c] *= 1 - p.defaultHaircut;
      f.debtRatio0[c] = f.debt[c] / Y; // new reference: premium and fiscal reaction re-anchor after restructuring
      f.cycle[c] -= p.defaultOutputLoss;
    }
    f.milCap[c] += (f.milexShare[c] * Y - p.milDepreciation * f.milCap[c]) * DT;
  }
}
