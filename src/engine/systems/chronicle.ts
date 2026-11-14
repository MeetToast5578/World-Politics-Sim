// Chronicle: detects notable state changes and records them as events with the inputs that caused them.
// It only observes; it never changes simulation variables. Text is rendered by the UI from (kind, values).
import type { WorldState, SimEvent } from '../state';
import { totalPop } from '../state';

const POP_LEVELS = [1e6, 2e6, 5e6, 1e7, 2e7, 5e7, 1e8, 2e8, 5e8, 1e9, 2e9];
const DEBT_LEVELS = [1, 1.5, 2];

function emit(st: WorldState, e: Omit<SimEvent, 'd'>) { st.events.push({ d: st.day, ...e }); }

export function chronicleQuarterly(st: WorldState): void {
  const { f } = st;
  for (let c = 0; c < st.n; c++) {
    const key = `rec:${c}`;
    if (f.negQ[c] === 2) {
      st.milestones[key] = st.day;
      emit(st, { k: 'recession_start', c, v: f.gdp[c] / f.gdpPrevQ[c] - 1, x: { cycle: f.cycle[c], gap: f.gap[c], unemp: f.unemp[c] } });
    } else if (f.negQ[c] === 0 && st.milestones[key]) {
      emit(st, { k: 'recession_end', c, v: Math.round((st.day - st.milestones[key]) / 91.31) + 1 /* quarters of contraction */, x: { unemp: f.unemp[c] } });
      delete st.milestones[key];
    }
  }
}

/** Highest level in `levels` that x has reached (index), or -1. */
const levelOf = (x: number, levels: number[]) => { let i = -1; while (i + 1 < levels.length && x >= levels[i + 1]) i++; return i; };

export function chronicleYearly(st: WorldState): void {
  const { f } = st;
  // world oil price swings of more than ±30% (log) within a year; c = -1 marks a world event
  const oilPrev = st.milestones.oilLn;
  if (oilPrev !== undefined && Math.abs(st.g.oilLn - oilPrev) > 0.3)
    emit(st, { k: 'oil_shock', c: -1, v: Math.exp(st.g.oilLn - oilPrev) - 1, x: { price: Math.exp(st.g.oilLn) } });
  st.milestones.oilLn = st.g.oilLn;
  for (let c = 0; c < st.n; c++) {
    const ik = `infl:${c}`;
    if (st.milestones[ik] === undefined) st.milestones[ik] = f.inflation[c] > 25 ? 1 : 0;
    else if (!st.milestones[ik] && f.inflation[c] > 25) {
      emit(st, { k: 'inflation_high', c, v: f.inflation[c], x: { expected: f.piE[c], oil: Math.exp(st.g.oilLn), gap: f.gap[c] } });
      st.milestones[ik] = 1;
    } else if (st.milestones[ik] && f.inflation[c] < 10) {
      emit(st, { k: 'inflation_tamed', c, v: f.inflation[c], x: { expected: f.piE[c] } });
      st.milestones[ik] = 0;
    }
  }
  for (let c = 0; c < st.n; c++) {
    const P = totalPop(st, c);
    // population thresholds, in both directions (first crossing of each level only)
    const lv = levelOf(P, POP_LEVELS), pk = `pop:${c}`;
    if (st.milestones[pk] === undefined) st.milestones[pk] = lv;
    else if (lv !== st.milestones[pk]) {
      emit(st, { k: lv > st.milestones[pk] ? 'pop_above' : 'pop_below', c, v: POP_LEVELS[Math.max(lv, st.milestones[pk])], x: { tfr: f.tfr[c], lifeExp: f.lifeExp[c] } });
      st.milestones[pk] = lv;
    }
    // population peak: first decline after growth
    const gk = `popTrend:${c}`, prev = st.milestones[`popPrev:${c}`];
    if (prev !== undefined) {
      const growing = P >= prev ? 1 : 0;
      if (st.milestones[gk] === 1 && growing === 0) emit(st, { k: 'pop_peak', c, v: prev, x: { tfr: f.tfr[c], old: f.p2[c] / P } });
      st.milestones[gk] = growing;
    }
    st.milestones[`popPrev:${c}`] = P;
    // public debt thresholds
    const d = f.debt[c] / f.gdp[c], dl = levelOf(d, DEBT_LEVELS), dk = `debt:${c}`;
    if (st.milestones[dk] === undefined) st.milestones[dk] = dl;
    else if (dl > st.milestones[dk]) {
      emit(st, { k: 'debt_above', c, v: DEBT_LEVELS[dl], x: { primSpend: f.primSpendShare[c], rev: f.revShare[c] } });
      st.milestones[dk] = dl;
    } else if (dl < st.milestones[dk]) st.milestones[dk] = dl;
  }
  // changes in the ten largest economies (market exchange rates)
  const order = Array.from({ length: st.n }, (_, i) => i).sort((a, b) => f.gdp[b] - f.gdp[a] || a - b);
  for (let r = 0; r < 10; r++) {
    const c = order[r], rk = `rank:${c}`, old = st.milestones[rk];
    if (old !== undefined && old > r && old < 99) {
      const passed = order[r + 1];
      emit(st, { k: 'gdp_rank_up', c, o: passed, v: r + 1, x: { gdp: f.gdp[c], otherGdp: f.gdp[passed] } });
    }
  }
  for (let r = 0; r < st.n; r++) st.milestones[`rank:${order[r]}`] = r < 10 ? r : 99;
  for (let c = 0; c < st.n; c++) f.gdpPrevY[c] = f.gdp[c];
}
