// Economy (quarterly unless noted). Output Y = A K^α (hL)^(1-α) e^c, h = human capital (systems/education.ts), in constant base-year USD (annualised).
//  - capital: K' = K + (s·Y − δK)Δt; s = structural share (relaxes yearly toward an income curve + residual) plus a
//    procyclical term
//  - TFP: frontier growth plus catch-up on a gap measured against a mix of the world frontier and the TFP of the
//    country's import sources (technology diffuses through trade), scaled by absorptive capacity (institutions)
//  - output gap = domestic cycle u (AR(1) with a common world shock) + export-share-weighted domestic cycles of trading
//    partners (one round of transmission, so no feedback loop can explode) + terms-of-trade effect of the oil price
//    level (hydrocarbon rents vs. energy-import costs)
//  - unemployment by Okun's law; labour = working-age pop × participation × (1 − u)
//  - inflation: Phillips curve on the cycle + energy pass-through; expectations anchored to a target in proportion
//    to institutional credibility, otherwise adaptive; surprise inflation erodes real public debt
//  - public debt: budget identity, Bohn fiscal reaction, sovereign default when interest/revenue is too high
//  - military capital = perpetual inventory of military spending
//  - yearly: sector shares (agriculture, industry, services) relax toward income curves; trade openness recomputed
// Not modelled yet: exchange rates (PPP ratio fixed), multiple goods, resource depletion, monetary policy rates.
import type { Baseline } from '../types';
import type { Params } from '../params';
import type { Rng } from '../rng';
import type { WorldState } from '../state';
import { curveAt, gdpPppPc } from './demography';
import { humanCapital } from './education';
import { exportShare, tradeOpenness, worldGdp, type TradeNet } from './trade';

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
    f.sStruct[c] = f.sInv[c] = clamp(v('investment') / 100, 0.05, 0.6);
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
    f.inflation[c] = f.piE[c] = v('inflation');
    // energy exposure: hydrocarbon rents (exporters) minus energy import dependence × energy cost share (importers)
    f.rents[c] = (v('oilRents', 0) + v('gasRents', 0) + v('coalRents', 0)) / 100;
    f.oilExp[c] = f.rents[c] - p.oil.energyCostShare * Math.max(0, v('energyImportsShare') / 100);
    f.agriShare[c] = v('agriShare') / 100;
    f.indShare[c] = v('industryShare') / 100;
    f.tradeShare[c] = v('trade');
  });
}

/** Residuals against the income curves (must run after demography init so GDP per capita is defined). */
export function initEconomyResiduals(st: WorldState, b: Baseline): void {
  const cv = b.meta.curves, f = st.f;
  for (let c = 0; c < st.n; c++) {
    const y = gdpPppPc(st, c);
    f.agriResid[c] = f.agriShare[c] - curveAt(cv.agriShare, y) / 100;
    f.indResid[c] = f.indShare[c] - curveAt(cv.industryShare, y) / 100;
    f.invResid[c] = f.sStruct[c] - curveAt(cv.investment, y) / 100;
  }
}

/** Real rate on public debt: base rate plus a premium on debt above the higher of 60% of GDP and the country's
 *  reference ratio (baseline, or post-restructuring level). Baseline high-debt countries thus start at the base rate. */
export function interestRate(p: Params, debtRatio: number, refRatio: number): number {
  return p.realRate + p.riskPremium * Math.max(0, debtRatio - Math.max(0.6, refRatio));
}

export function economyQuarterly(st: WorldState, p: Params, rng: Rng, oilRng: Rng, trade: TradeNet,
  onDefault?: (c: number, x: Record<string, number>) => void): void {
  const { f, n } = st;
  // world oil price: mean-reverting log deviation from baseline
  const oilPrev = st.g.oilLn;
  st.g.oilLn = p.oil.rho * oilPrev + p.oil.sd * oilRng.normal();
  st.g.oilDln = st.g.oilLn - oilPrev;

  let lnAf = -Infinity;
  for (let c = 0; c < n; c++) if (labour(st, c) >= p.frontierMinLabor) lnAf = Math.max(lnAf, Math.log(f.A[c]));
  // 1. TFP catch-up target: mix of world frontier and import-weighted TFP of trading partners (all read before any update)
  const growthA = new Float64Array(n);
  for (let c = 0; c < n; c++) {
    const ps = trade.partners[c], lnA = Math.log(f.A[c]);
    let impW = 0, impLnA = 0;
    for (let k = 0; k < ps.length; k++) { const w = trade.a[ps[k]] * f.gdp[ps[k]] * trade.dist[c][k] * trade.mult[c][k]; impW += w; impLnA += w * Math.log(f.A[ps[k]]); } // w ∝ imports of c from j
    const partnerGap = impW > 0 ? impLnA / impW - lnA : 0;
    const gap = Math.max(0, p.trade.frontierWeight * (lnAf - lnA) + (1 - p.trade.frontierWeight) * partnerGap);
    growthA[c] = p.frontierGrowth + p.catchUp * f.absorb[c] * gap;
  }
  // persistent growth regimes: AR(1) deviation of TFP growth (one draw per country per quarter, in index order)
  const rhoG = Math.exp(-DT / p.growthRegime.years), sdG = p.growthRegime.sd * Math.sqrt(1 - rhoG * rhoG);
  for (let c = 0; c < n; c++) { f.tfpDrift[c] = rhoG * f.tfpDrift[c] + sdG * rng.normal(); growthA[c] += f.tfpDrift[c]; }
  // 2. domestic cycles; one world shock per quarter is shared by all countries (synchronised downturns can emerge).
  //    Draws happen for every country in index order, so the random sequence never depends on state.
  const world = rng.normal(), wg = Math.sqrt(p.globalShockShare), wi = Math.sqrt(1 - p.globalShockShare);
  for (let c = 0; c < n; c++) f.cycle[c] = p.cycleRho * f.cycle[c] + f.cycleSd[c] * (wg * world + wi * rng.normal());
  // 3. output gaps: own cycle + partners' domestic cycles weighted by export shares + oil terms of trade
  const gapNew = new Float64Array(n), W = worldGdp(f.gdp);
  for (let c = 0; c < n; c++) {
    let spill = 0;
    for (let k = 0; k < trade.partners[c].length; k++) spill += exportShare(trade, f.gdp, W, c, k) * f.cycle[trade.partners[c][k]];
    gapNew[c] = f.cycle[c] + p.trade.spillover * spill + p.oil.incomeEffect * f.oilExp[c] * st.g.oilLn;
  }
  for (let c = 0; c < n; c++) {
    f.A[c] *= Math.exp(growthA[c] * DT);
    f.gap[c] = gapNew[c];
    // physical bounds: unemployment cannot reach 100%; 60% exceeds any recorded national rate
    f.unemp[c] = Math.min(60, Math.max(0.5, f.unempStar[c] - p.okun * f.gap[c] * 100));
    const Yprev = f.gdp[c];
    const Y = f.A[c] * f.K[c] ** p.alpha * (humanCapital(st, p, c) * labour(st, c)) ** (1 - p.alpha) * Math.exp(f.gap[c]);
    f.gdpPrevQ[c] = Yprev;
    f.gdp[c] = Y;
    f.negQ[c] = Y < Yprev ? f.negQ[c] + 1 : 0;
    f.sInv[c] = clamp(f.sStruct[c] + p.investCyclical * f.gap[c], 0.05, 0.6);
    f.K[c] += (f.sInv[c] * Y - p.delta * f.K[c]) * DT;
    // inflation (annual %): expectations + Phillips curve + energy pass-through (annualised quarterly log change)
    const piQ = f.piE[c] + p.inflation.phillips * 100 * f.gap[c] + p.oil.cpiWeight * st.g.oilDln * 400;
    const surprise = piQ - f.piE[c];
    f.inflation[c] += (piQ - f.inflation[c]) * 0.25; // smoothed to approximate a year-on-year rate
    const cred = f.absorb[c];
    f.piE[c] += DT * (cred * p.inflation.anchorSpeed * (p.inflation.target - f.piE[c]) + (1 - cred) * p.inflation.adaptSpeed * (piQ - f.piE[c]));
    // budget identity: Δdebt = (primary spending − revenue) + interest; unexpected inflation erodes real debt
    const d = f.debt[c] / Y;
    const pb = f.pb0[c] + p.bohn * (d - f.debtRatio0[c]);
    f.primSpendShare[c] = f.revShare[c] - pb;
    const interest = interestRate(p, d, f.debtRatio0[c]) * f.debt[c];
    // shortcut: gross debt floors at 0; surpluses beyond that are not tracked as sovereign assets.
    f.debt[c] = Math.max(0, f.debt[c] * Math.exp((-surprise / 100) * DT) + ((f.primSpendShare[c] - f.revShare[c]) * Y + interest) * DT);
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

/** Yearly structural update: sector shares and structural investment relax toward income curves. */
export function economyYearly(st: WorldState, b: Baseline, p: Params, trade: TradeNet): void {
  const cv = b.meta.curves, f = st.f, W = worldGdp(f.gdp);
  const relax = 1 - Math.exp(-1 / p.transitionYears), decay = Math.exp(-1 / p.residualYears);
  for (let c = 0; c < st.n; c++) {
    f.agriResid[c] *= decay; f.indResid[c] *= decay; f.invResid[c] *= decay;
    const y = gdpPppPc(st, c);
    f.agriShare[c] += (clamp(curveAt(cv.agriShare, y) / 100 + f.agriResid[c], 0.002, 0.8) - f.agriShare[c]) * relax;
    f.indShare[c] += (clamp(curveAt(cv.industryShare, y) / 100 + f.indResid[c], 0.05, 0.85) - f.indShare[c]) * relax;
    f.sStruct[c] += (clamp(curveAt(cv.investment, y) / 100 + f.invResid[c], 0.05, 0.6) - f.sStruct[c]) * relax;
    f.tradeShare[c] = tradeOpenness(trade, f.gdp, c, W);
  }
}
