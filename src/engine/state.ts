// World state: struct-of-arrays. Every per-country dynamic variable is one Float64Array indexed by country.
// All mutable simulation state lives in WorldState so that save / load / hash / replay are complete by construction.
import type { Baseline } from './types';
import { parseDate } from './calendar';

export const FIELDS = [
  // demography: broad-age aggregates (derived from cohorts), vital rates, life-table and fertility parameters
  'p0', 'p1', 'p2', 'tfr', 'lifeExp', 'e0F', 'e0M', 'u5F', 'u5M', 'srb', 'mab', 'fertK',
  'silA1F', 'silA2F', 'silA1M', 'silA2M', 'migRate', 'births', 'deaths', 'netMig', 'phase3Years',
  'tfrResid', 'e0FResid', 'e0MResid', 'u5FResid', 'u5MResid', 'urban',
  // economy (constant base-year USD, annualised flows)
  'gdp', 'gdpPrevQ', 'gdpPrevY', 'K', 'A', 'cycle', 'gap', 'cycleSd', 'sInv', 'sStruct', 'invResid', 'pppRatio', 'unemp', 'unempStar',
  'lfRate', 'negQ', 'absorb', 'inflation', 'piE', 'oilExp', 'rents', 'agriShare', 'indShare', 'agriResid', 'indResid', 'tradeShare',
  // public finance
  'debt', 'revShare', 'primSpendShare', 'pb0', 'debtRatio0',
  // military
  'milexShare', 'milCap', 'afRate',
  // religion (indices of the composition in WorldState.religion)
  'relFrac', 'relPolar', 'secCeil',
  // politics
  'demo', 'demo0', 'regime', 'approval', 'legit', 'legit0', 'perf', 'unrest', 'unrest0', 'ideology', 'govYears', 'govTerms',
  'nextElection', 'coupMem', 'growthEma', 'growthLong', 'misery0', 'youth0', 'polar0', 'rev0',
  // governance (static in Phase 1, WGI scale ≈ -2.5..2.5)
  'wgiVoice', 'wgiStability', 'wgiEffectiveness', 'wgiRuleOfLaw', 'wgiCorruption',
] as const;
export type Field = (typeof FIELDS)[number];

/** World-level variables (not per country). */
// oilLn: log real oil price relative to baseline; oilDln: its last quarterly change;
// coupBase: coup hazard offset, solved at t0 so the world attempt rate matches the observed base rate
export const GLOBALS = ['oilLn', 'oilDln', 'coupBase'] as const;
export type Global = (typeof GLOBALS)[number];

/** Single years of age 0..99 plus the open group 100+. */
export const AGES = 101;
/** Offset of (country, sex) in WorldState.cohorts; sex 0 = female, 1 = male. */
export const cohortIndex = (c: number, sex: number) => (c * 2 + sex) * AGES;

/** Yearly history series recorded for charts (Float32 to halve memory). */
export const HIST_FIELDS = ['pop', 'gdp', 'gdpPc', 'tfr', 'lifeExp', 'debtRatio', 'milCap', 'old'] as const;
export type HistField = (typeof HIST_FIELDS)[number];

export interface SimEvent {
  d: number;          // day
  k: string;          // kind
  c: number;          // country index
  o?: number;         // other country index
  v?: number;         // headline value
  x?: Record<string, number>; // causal inputs recorded at emission time
}

export interface WorldState {
  version: 1;
  seed: number;
  startDay: number;
  day: number;
  n: number;
  ids: string[];                 // country ids, index = country index (stable for the lifetime of a world)
  f: Record<Field, Float64Array>;
  cohorts: Float64Array;         // persons by country × sex × single age, see cohortIndex
  g: Record<Global, number>;
  nRel: number;                  // religion categories (baseline.meta.religions)
  religion: Float64Array;        // population shares by country × religion category
  regionOwner: Int16Array;       // region index -> country index (-1 = none). Territorial change = editing this.
  rng: Record<string, Uint32Array>;
  branches: { day: number; seed: number }[]; // reseeds applied during the timeline (replay honours them)
  events: SimEvent[];
  history: { years: number[]; data: Record<HistField, number[]> }; // data[f][yearIdx * n + c]
  milestones: Record<string, number>; // memo for chronicle threshold crossings (key -> last level)
}

export function createState(baseline: Baseline, seed: number, startDate?: string): WorldState {
  const cs = baseline.countries;
  const n = cs.length;
  const f = Object.fromEntries(FIELDS.map((k) => [k, new Float64Array(n)])) as Record<Field, Float64Array>;
  const idx = new Map(cs.map((c, i) => [c.id, i]));
  const startDay = parseDate(startDate ?? baseline.meta.startDate);
  const st: WorldState = {
    version: 1, seed: seed >>> 0, startDay, day: startDay, n, ids: cs.map((c) => c.id), f, cohorts: new Float64Array(n * 2 * AGES), g: { oilLn: 0, oilDln: 0, coupBase: 0 },
    nRel: baseline.meta.religions.length, religion: new Float64Array(n * baseline.meta.religions.length),
    regionOwner: Int16Array.from(baseline.regions.map((r) => (r.owner == null ? -1 : idx.get(r.owner) ?? -1))),
    rng: {}, branches: [], events: [], history: { years: [], data: Object.fromEntries(HIST_FIELDS.map((k) => [k, []])) as any },
    milestones: {},
  };
  return st;
}

export function totalPop(st: WorldState, c: number): number {
  return st.f.p0[c] + st.f.p1[c] + st.f.p2[c];
}

/** Deep copy (used for snapshots and tests). */
export function cloneState(st: WorldState): WorldState {
  return {
    ...st,
    ids: st.ids.slice(),
    f: Object.fromEntries(FIELDS.map((k) => [k, st.f[k].slice()])) as Record<Field, Float64Array>,
    cohorts: st.cohorts.slice(),
    g: { ...st.g },
    religion: st.religion.slice(),
    regionOwner: st.regionOwner.slice(),
    rng: Object.fromEntries(Object.entries(st.rng).map(([k, v]) => [k, v.slice()])),
    branches: st.branches.map((b) => ({ ...b })),
    events: st.events.map((e) => ({ ...e, x: e.x && { ...e.x } })),
    history: { years: st.history.years.slice(), data: Object.fromEntries(HIST_FIELDS.map((k) => [k, st.history.data[k].slice()])) as any },
    milestones: { ...st.milestones },
  };
}

/** FNV-1a over every byte of mutable state. Equal hashes => identical worlds (used by reproducibility tests). */
export function hashState(st: WorldState): string {
  let h = 0x811c9dc5;
  const mix = (bytes: Uint8Array) => { for (let i = 0; i < bytes.length; i++) h = Math.imul(h ^ bytes[i], 0x01000193); };
  const enc = new TextEncoder();
  mix(enc.encode(`${st.seed}|${st.day}|${st.n}|${JSON.stringify(st.branches)}|${JSON.stringify(st.g)}`));
  for (const k of FIELDS) mix(new Uint8Array(st.f[k].buffer, st.f[k].byteOffset, st.f[k].byteLength));
  mix(new Uint8Array(st.cohorts.buffer));
  mix(new Uint8Array(st.religion.buffer));
  mix(new Uint8Array(st.regionOwner.buffer));
  for (const k of Object.keys(st.rng).sort()) mix(new Uint8Array(st.rng[k].buffer));
  mix(enc.encode(JSON.stringify(st.events)));
  mix(enc.encode(JSON.stringify(st.history)));
  return (h >>> 0).toString(16).padStart(8, '0');
}
