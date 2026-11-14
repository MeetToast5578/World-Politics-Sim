// Domestic politics (quarterly). Per country:
//   demo        V-Dem electoral democracy index (0-1); regime = Regimes of the World category
//               0 closed autocracy, 1 electoral autocracy, 2 electoral democracy, 3 liberal democracy
//   approval    government approval (0-1): economic voting (growth surprise, misery index) and tenure fatigue
//   legit       regime legitimacy (0-1): initialised from WGI political stability, moves with remembered
//               performance (long average of approval) and democratic change
//   unrest      (0-1): initialised from WGI political stability; moves with misery, low approval, lost legitimacy,
//               religious polarisation and the youth bulge, each relative to the country's own baseline
//   ideology    governing orientation, −1 left … +1 right (no open data: drawn at start); shifts government size
// Events (each records the values that produced it):
//   elections   on a fixed term in electoral regimes; incumbent survival = logistic(approval, regime openness, terms)
//   coups       hazard ∝ exp(autocracy, unrest, coup memory, recession, low legitimacy), with the constant set so the
//               world total at baseline matches the observed rate; success with probability falling in legitimacy
//   protests    when unrest first exceeds a threshold
//   uprisings   hazard while unrest is high, scaled by low legitimacy and religious polarisation; outcome is a
//               democratic revolution, an autocratic overthrow or (in democracies) the fall of the government
//   regime      categories follow the democracy index with hysteresis (democratisation / autocratisation events)
// Democracy diffuses slowly toward the average of trading partners and neighbours (Gleditsch & Ward 2006).
import type { Baseline } from '../types';
import type { Params } from '../params';
import type { Rng } from '../rng';
import type { WorldState, SimEvent } from '../state';
import { cohortIndex } from '../state';
import { gdpPppPc } from './demography';
import type { TradeNet } from './trade';

const DT = 0.25;
const clamp = (x: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, x));
const logistic = (x: number) => 1 / (1 + Math.exp(-x));
const logit = (p: number) => Math.log(clamp(p, 1e-4, 1 - 1e-4) / (1 - clamp(p, 1e-4, 1 - 1e-4)));

/** Misery index with inflation compressed (logarithmic above 10%) so hyperinflation does not swamp everything. */
export const misery = (st: WorldState, c: number) => st.f.unemp[c] + 10 * Math.log(1 + Math.max(0, st.f.inflation[c]) / 10);

/** Share of 15-24 year-olds among 15-64 year-olds (youth bulge, Urdal 2006). */
export function youthShare(st: WorldState, c: number): number {
  let y = 0, a = 0;
  for (const sex of [0, 1]) {
    const o = cohortIndex(c, sex);
    for (let x = 15; x < 65; x++) { a += st.cohorts[o + x]; if (x < 25) y += st.cohorts[o + x]; }
  }
  return a > 0 ? y / a : 0;
}

function coupLogHazard(st: WorldState, p: Params, c: number): number {
  const f = st.f, k = p.politics.coup;
  return k.autocracy * (1 - f.demo[c]) + k.unrest * f.unrest[c] + k.memory * f.coupMem[c]
    + k.recession * (f.growthEma[c] < 0 ? 1 : 0) - k.legitimacy * f.legit[c] - k.income * Math.log(gdpPppPc(st, c) / 10000);
}

export function initPolitics(st: WorldState, b: Baseline, p: Params, rng: Rng): void {
  const f = st.f, P = p.politics;
  b.countries.forEach((bc, c) => {
    const v = (k: string) => bc.fields[k]!.v;
    f.demo[c] = f.demo0[c] = v('vdemEdi');
    f.regime[c] = Math.round(v('regimeRow'));
    f.approval[c] = 0.5;
    f.legit[c] = f.legit0[c] = f.perf[c] = logistic(0.3 + 1.2 * f.wgiStability[c]);
    f.unrest[c] = f.unrest0[c] = logistic(-1.5 - 1.2 * f.wgiStability[c]);
    f.misery0[c] = misery(st, c);
    f.youth0[c] = youthShare(st, c);
    f.polar0[c] = f.relPolar[c];
    f.rev0[c] = f.revShare[c];
    f.growthEma[c] = f.growthLong[c] = NaN; // set from the first quarter's growth
    // no open dataset of governing-party orientation for all countries: drawn, and labelled as such in the UI
    f.ideology[c] = (rng.next() * 2 - 1) * 0.6;
    f.nextElection[c] = f.regime[c] >= 1 ? st.day + Math.floor(rng.next() * P.termYears * 365.25) : -1; // -1: no elections
  });
  // coup hazard constant: solve c so the world's expected attempts per year at baseline equal the observed rate
  const z = Array.from({ length: st.n }, (_, c) => coupLogHazard(st, p, c));
  let lo = -40, hi = 10;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2, tot = z.reduce((s, zc) => s + P.coup.maxPerYear * logistic(zc + mid), 0);
    if (tot > P.coup.attemptsPerYear) hi = mid; else lo = mid;
  }
  st.g.coupBase = (lo + hi) / 2;
}

/** Annual coup-attempt hazard: saturating in the risk score, so coup traps stay bounded (max = coup.maxPerYear). */
export const coupHazard = (st: WorldState, p: Params, c: number) => p.politics.coup.maxPerYear * logistic(coupLogHazard(st, p, c) + st.g.coupBase);

function emit(st: WorldState, e: Omit<SimEvent, 'd'>) { st.events.push({ d: st.day, ...e }); }

/** New government: ideology swings away from the predecessor (plus noise), honeymoon approval, tenure reset. */
function changeGovernment(st: WorldState, c: number, noise: number, approval: number) {
  const f = st.f;
  f.ideology[c] = clamp(-0.5 * f.ideology[c] + 0.35 * noise, -1, 1);
  f.approval[c] = approval;
  f.govYears[c] = 0;
  f.govTerms[c] = 0;
}

export function politicsQuarterly(st: WorldState, p: Params, rng: Rng, trade: TradeNet): void {
  const f = st.f, P = p.politics, n = st.n;
  const ra = 1 - Math.exp(-DT / P.approvalYears), rl = 1 - Math.exp(-DT / P.legitYears), ru = 1 - Math.exp(-DT / P.unrestYears);
  const rp = 1 - Math.exp(-DT / P.perfYears), rr = 1 - Math.exp(-DT / P.policyYears), memDecay = Math.exp(-DT / P.coup.memoryYears);
  // diffusion target read before any update (order independence)
  const nbr = new Float64Array(n);
  for (let c = 0; c < n; c++) {
    const ps = trade.partners[c];
    let s = 0;
    for (let k = 0; k < ps.length; k++) s += f.demo[ps[k]];
    nbr[c] = ps.length ? s / ps.length : f.demo[c];
  }
  for (let c = 0; c < n; c++) {
    // every country draws the same random numbers each quarter whatever happens, so one country's events never
    // shift another country's draws (keeps branches comparable)
    const uA = rng.normal(), uU = rng.normal(), uD = rng.normal(), uGov = rng.normal();
    const uCoup = rng.next(), uCoupOk = rng.next(), uUp = rng.next(), uUpKind = rng.next(), uElec = rng.next();
    const uEp = rng.next(), uEpSize = rng.normal();

    const gq = (f.gdp[c] / f.gdpPrevQ[c]) ** 4 - 1;
    if (Number.isNaN(f.growthEma[c])) f.growthEma[c] = f.growthLong[c] = gq;
    f.growthEma[c] += (gq - f.growthEma[c]) * (1 - Math.exp(-DT / 1));
    f.growthLong[c] += (gq - f.growthLong[c]) * (1 - Math.exp(-DT / 8));
    const mis = misery(st, c);

    // approval: economic voting + tenure fatigue + news shocks
    const aTarget = clamp(0.5 + P.voteGrowth * (f.growthEma[c] - f.growthLong[c]) - P.voteMisery * (mis - f.misery0[c]) - P.fatigue * Math.max(0, f.govYears[c] - 2), 0.05, 0.95);
    f.approval[c] = clamp(f.approval[c] + (aTarget - f.approval[c]) * ra + P.approvalNoise * uA, 0.02, 0.98);

    // legitimacy: remembered performance and democratic change, anchored at the baseline level
    f.perf[c] += (f.approval[c] - f.perf[c]) * rp;
    const lTarget = clamp(f.legit0[c] + 0.6 * (f.perf[c] - 0.5) + 0.3 * (f.demo[c] - f.demo0[c]), 0.02, 0.98);
    f.legit[c] += (lTarget - f.legit[c]) * rl;

    // unrest, relative to the country's own baseline
    const u = P.unrestW;
    const uLogit = logit(f.unrest0[c]) + u.misery * (mis - f.misery0[c]) + u.approval * (0.5 - f.approval[c])
      + u.legitimacy * (f.legit0[c] - f.legit[c]) + u.polarisation * (f.relPolar[c] - f.polar0[c]) + u.youth * (youthShare(st, c) - f.youth0[c]);
    const prevUnrest = f.unrest[c];
    f.unrest[c] = clamp(f.unrest[c] + (logistic(uLogit) - f.unrest[c]) * ru + P.unrestNoise * uU, 0.01, 0.99);
    // instability costs output (Aisen & Veiga 2013): unrest above baseline lowers the domestic cycle
    f.cycle[c] -= P.instabilityCost * Math.max(0, f.unrest[c] - f.unrest0[c]) * DT;

    // fiscal orientation of the government drifts government size
    f.revShare[c] += (f.rev0[c] * (1 + P.ideologyFiscal * f.ideology[c]) - f.revShare[c]) * rr;

    // democracy: diffusion from partners, small drift, and occasional episodes of regime change (contested
    // elections, executive aggrandisement, crackdowns, openings): V-Dem yearly changes are fat-tailed
    let dDemo = DT * P.diffusion * (nbr[c] - f.demo[c]) + P.demoNoise * Math.sqrt(DT) * uD;
    if (uEp < P.episode.perYear * DT) dDemo += P.episode.size * uEpSize + P.episode.legitimacy * (f.legit[c] - f.legit0[c]);
    // institutional persistence: regimes drift back toward their long-run institutional level after shocks
    dDemo += DT * P.persistence * (f.demo0[c] - f.demo[c]);
    // executive aggrandisement: popular incumbents in weakly institutionalised electoral regimes erode constraints
    if (f.regime[c] >= 1 && f.demo[c] < 0.75) dDemo -= DT * P.aggrandisement * Math.max(0, f.approval[c] - 0.5) * (0.75 - f.demo[c]) * Math.min(f.govYears[c], 8);
    f.demo[c] = clamp(f.demo[c] + dDemo, 0.005, 0.95);

    f.govYears[c] += DT;
    f.coupMem[c] *= memDecay;
    const x = () => ({ approval: f.approval[c], legit: f.legit[c], unrest: f.unrest[c], demo: f.demo[c], polar: f.relPolar[c], misery: mis, growth: f.growthEma[c] });

    // elections
    if (f.regime[c] >= 1 && f.nextElection[c] >= 0 && st.day >= f.nextElection[c]) {
      f.nextElection[c] += Math.round(P.termYears * 365.25);
      const pWin = logistic(P.election.approval * (f.approval[c] - 0.5) + P.election.autocracy * (1 - f.demo[c]) - P.election.terms * f.govTerms[c]);
      if (uElec < pWin) { f.govTerms[c] += 1; emit(st, { k: 'election_won', c, v: pWin, x: x() }); }
      else {
        emit(st, { k: 'election_lost', c, v: pWin, x: { ...x(), ideology: f.ideology[c] } });
        changeGovernment(st, c, uGov, 0.6);
        // turnover restores constraints eroded by the outgoing government ("U-turns", Nord et al. 2024)
        if (f.demo[c] < 0.75) f.demo[c] = Math.min(0.95, f.demo[c] + P.uTurn);
      }
    }

    // coups
    const hCoup = coupHazard(st, p, c);
    if (uCoup < 1 - Math.exp(-hCoup * DT)) {
      const pSuccess = clamp(P.coup.success + 0.5 * (0.5 - f.legit[c]), 0.15, 0.85);
      const ev = { ...x(), hazard: hCoup, pSuccess };
      if (uCoupOk < pSuccess) {
        emit(st, { k: 'coup', c, x: ev });
        f.regime[c] = 0; f.demo[c] *= P.coup.demoFactor; f.legit[c] = Math.min(f.legit[c], 0.35); f.coupMem[c] += 1;
        f.unrest[c] = clamp(f.unrest[c] + 0.1); f.cycle[c] -= P.coup.outputLoss; f.nextElection[c] = -1;
        changeGovernment(st, c, uGov, 0.45);
      } else {
        emit(st, { k: 'coup_failed', c, x: ev });
        f.coupMem[c] += 0.5; f.unrest[c] = clamp(f.unrest[c] + 0.05);
      }
    }

    // mass protests and uprisings
    if (prevUnrest < P.protestThreshold && f.unrest[c] >= P.protestThreshold) emit(st, { k: 'protests', c, v: f.unrest[c], x: x() });
    if (f.unrest[c] > 0.5) {
      const hUp = P.uprising.rate * ((f.unrest[c] - 0.5) / 0.5) * (1.5 - f.legit[c]) * Math.exp(P.uprising.polarisation * (f.relPolar[c] - 0.5));
      if (uUp < 1 - Math.exp(-hUp * DT)) {
        const ev = { ...x(), hazard: hUp };
        if (f.regime[c] >= 2) {
          emit(st, { k: 'government_collapse', c, x: ev });
          f.nextElection[c] = st.day + 180; // early elections
          changeGovernment(st, c, uGov, 0.55);
        } else if (uUpKind < P.uprising.democraticShare + 0.4 * f.demo[c]) {
          emit(st, { k: 'revolution', c, x: ev });
          f.regime[c] = 2; f.demo[c] = Math.max(f.demo[c], 0.55); f.nextElection[c] = st.day + 365;
          changeGovernment(st, c, uGov, 0.65);
        } else {
          emit(st, { k: 'regime_overthrown', c, x: ev });
          f.regime[c] = Math.min(f.regime[c], 1);
          changeGovernment(st, c, uGov, 0.5);
        }
        f.unrest[c] = 0.4; f.legit[c] = 0.4; f.cycle[c] -= P.uprising.outputLoss;
      }
    }

    // regime categories follow the democracy index, with hysteresis
    const d = f.demo[c], r = f.regime[c];
    if (r <= 1 && d > P.thresholds.democratise) {
      f.regime[c] = 2; if (f.nextElection[c] < 0) f.nextElection[c] = st.day + 365;
      emit(st, { k: 'democratization', c, v: d, x: x() });
    } else if (r >= 2 && d < P.thresholds.autocratise) {
      f.regime[c] = 1; emit(st, { k: 'autocratization', c, v: d, x: x() });
    } else if (r === 2 && d > P.thresholds.liberal) f.regime[c] = 3;
    else if (r === 3 && d < P.thresholds.liberal - 0.07) f.regime[c] = 2;
    else if (r === 0 && d > P.thresholds.electoral) { f.regime[c] = 1; f.nextElection[c] = st.day + 365; emit(st, { k: 'elections_restored', c, v: d, x: x() }); }
  }
}
