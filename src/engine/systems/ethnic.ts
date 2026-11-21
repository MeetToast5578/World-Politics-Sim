// Ethnic groups (Ethnic Power Relations). Groups matter through one mechanism the evidence supports: access to state
// power. Excluded groups, above all discriminated ones and groups that recently lost power, rebel more often
// (Cederman, Wimmer & Min 2010; Wimmer, Cederman & Min 2009); separatist wars start in an excluded group's homeland.
// Nothing else (income, health, schooling, behaviour) depends on ethnicity in the model.
//  - yearly: excluded groups gain a share of power and included ones lose it at EPR's observed rates (2001-2021),
//    more often in democracies (inclusion) and under military rule (exclusion); the hazards are normalised at t0 so
//    the world rates match the data
//  - war outcomes (conflict.ts) and secession (sim.ts) change statuses, autonomy and the country a group lives in
import type { Baseline } from '../types';
import type { Params } from '../params';
import type { Rng } from '../rng';
import { daysFromCivil } from '../calendar';
import { totalPop, type EthnicGroup, type SimEvent, type WorldState } from '../state';

function emit(st: WorldState, e: Omit<SimEvent, 'd'>) { st.events.push({ d: st.day, ...e }); }

export const EXCLUDED = 1; // status ≤ 1: discriminated or powerless

/** Groups in baseline order (country by country). The same order is used everywhere (UI names come from it). */
export function baselineGroups(b: Baseline): EthnicGroup[] {
  return b.countries.flatMap((bc, c) => (bc.groups ?? []).map((g) => ({ name: g.name, c, size: g.size, status: g.status, aut: g.aut, down: g.down != null ? daysFromCivil(g.down, 7, 1) : -1e9, home: g.provinces.slice() })));
}

/** Population shares of a country's discriminated and powerless groups, and whether a group lost power recently. */
export function exclusion(st: WorldState, c: number, recentYears: number): { discriminated: number; powerless: number; downgraded: number } {
  let discriminated = 0, powerless = 0, downgraded = 0;
  for (const g of st.groups) {
    if (g.c !== c) continue;
    if (g.status === 0) discriminated += g.size; else if (g.status === 1) powerless += g.size;
    if (st.day - g.down < recentYears * 365.25) downgraded = 1;
  }
  return { discriminated, powerless, downgraded };
}

/** The group a rebellion in c recruits from: the largest excluded group with a homeland (and without autonomy) for a
 *  war over territory, the largest excluded group for a war over government; −1 if there is none. */
export function rebelGroup(st: WorldState, c: number, territorial: boolean): number {
  let best = -1;
  st.groups.forEach((g, i) => {
    if (g.c !== c || g.status > EXCLUDED || (territorial && (!g.home.length || g.aut))) return;
    if (best < 0 || g.size > st.groups[best].size) best = i;
  });
  return best;
}

const hazardTerms = (st: WorldState, p: Params, g: EthnicGroup) => {
  const E = p.ethnic, f = st.f, c = g.c;
  return g.status <= EXCLUDED
    ? Math.exp(E.democracyInclusion * f.demo[c])
    : Math.exp(-E.democracyExclusion * f.demo[c]) * (f.govLead[c] < 0 ? E.militaryExclusion : 1);
};

export function initEthnic(st: WorldState, b: Baseline, p: Params): void {
  st.groups = baselineGroups(b);
  // normalisers: the mean hazard multiplier over the groups at risk at t0 (so world rates equal EPR's)
  let sIn = 0, nIn = 0, sEx = 0, nEx = 0;
  for (const g of st.groups) {
    if (g.status === 4) continue;
    const h = hazardTerms(st, p, g);
    if (g.status <= EXCLUDED) { sIn += h; nIn++; } else { sEx += h; nEx++; }
  }
  st.g.ethIn = nIn ? sIn / nIn : 1; st.g.ethEx = nEx ? sEx / nEx : 1;
}

/** Group sizes after people moved between countries (secession): shares of the old and new population. */
export function rescaleGroups(st: WorldState, c: number, popBefore: number): void {
  const P = totalPop(st, c);
  if (P > 0) for (const g of st.groups) if (g.c === c) g.size = Math.min(1, (g.size * popBefore) / P);
}

export function ethnicYearly(st: WorldState, b: Baseline, p: Params, rng: Rng): void {
  const rates = b.meta.ethnic?.rates;
  st.groups.forEach((g, i) => {
    const u = rng.next(); // one draw per group per year, whatever happens
    if (!rates || g.status === 4 || g.c >= st.n) return;
    const h = hazardTerms(st, p, g);
    if (g.status <= EXCLUDED) {
      if (u < rates.include * h / st.g.ethIn) { g.status = 2; emit(st, { k: 'group_included', c: g.c, v: i, x: { demo: st.f.demo[g.c], size: g.size } }); }
    } else if (u < rates.exclude * h / st.g.ethEx) {
      g.status = 1; g.down = st.day;
      emit(st, { k: 'group_excluded', c: g.c, v: i, x: { demo: st.f.demo[g.c], size: g.size, military: st.f.govLead[g.c] < 0 ? 1 : 0 } });
    }
  });
}
