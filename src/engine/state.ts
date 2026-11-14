// World state: struct-of-arrays. Every per-country dynamic variable is one Float64Array indexed by country.
// All mutable simulation state lives in WorldState so that save / load / hash / replay are complete by construction.
import type { Baseline } from './types';
import { parseDate } from './calendar';

export const FIELDS = [
  // demography (persons; rates per year)
  'p0', 'p1', 'p2', 'tfr', 'lifeExp', 'fertK', 'mortK', 'migRate', 'tfrResid', 'leResid', 'urban',
  // economy (constant 2023 USD, annualised flows)
  'gdp', 'gdpPrevQ', 'gdpPrevY', 'K', 'A', 'cycle', 'cycleSd', 'sInv', 'pppRatio', 'unemp', 'unempStar', 'lfRate', 'negQ', 'absorb',
  // public finance
  'debt', 'revShare', 'primSpendShare', 'pb0', 'debtRatio0',
  // military
  'milexShare', 'milCap', 'afRate',
  // governance (static in Phase 1, WGI scale ≈ -2.5..2.5)
  'wgiVoice', 'wgiStability', 'wgiEffectiveness', 'wgiRuleOfLaw', 'wgiCorruption',
  // descriptive baseline values not yet modelled dynamically
  'inflation', 'tradeShare',
] as const;
export type Field = (typeof FIELDS)[number];

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
    version: 1, seed: seed >>> 0, startDay, day: startDay, n, ids: cs.map((c) => c.id), f,
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
  mix(enc.encode(`${st.seed}|${st.day}|${st.n}|${JSON.stringify(st.branches)}`));
  for (const k of FIELDS) mix(new Uint8Array(st.f[k].buffer, st.f[k].byteOffset, st.f[k].byteLength));
  mix(new Uint8Array(st.regionOwner.buffer));
  for (const k of Object.keys(st.rng).sort()) mix(new Uint8Array(st.rng[k].buffer));
  mix(enc.encode(JSON.stringify(st.events)));
  mix(enc.encode(JSON.stringify(st.history)));
  return (h >>> 0).toString(16).padStart(8, '0');
}
