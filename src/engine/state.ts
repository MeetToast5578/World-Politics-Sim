// World state: struct-of-arrays. Every per-country dynamic variable is one Float64Array indexed by country.
// All mutable simulation state lives in WorldState so that save / load / hash / replay are complete by construction.
import type { Baseline } from './types';
import { parseDate } from './calendar';
import type { NewState } from './systems/secession';

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
  'milexShare', 'milCap', 'afRate', 'milex0',
  // armed conflict: warLoad = log(1 + battle deaths per person-year on the territory / 1e-4); warMem: conflict-trap memory
  'warLoad', 'warLoad0', 'warMem',
  // religion (indices of the composition in WorldState.religion)
  'relFrac', 'relPolar', 'secCeil',
  // politics
  'demo', 'demo0', 'regime', 'approval', 'legit', 'legit0', 'perf', 'unrest', 'unrest0', 'ideology', 'govYears', 'govTerms',
  'nextElection', 'coupMem', 'growthEma', 'growthLong', 'misery0', 'youth0', 'polar0', 'rev0',
  // parties (systems/parties.ts): vote shares of the eight families, governing family (−1 military, −2 council),
  // governing coalition (bitmask), dominant religion family code, proportional representation (1) or not (0)
  'v0', 'v1', 'v2', 'v3', 'v4', 'v5', 'v6', 'v7', 'govLead', 'govMask', 'relFam', 'propRep',
  // 1 while the real party that governed at the start (baseline rulingParty) is still in power
  'realParty',
  // diplomacy: foreign-policy (UN voting) position, sanction pressure (share of world GDP sanctioning, × intensity)
  'fp', 'fp0', 'sanctionLoad', 'demoPrevY', 'unSanction',
  // education (systems/education.ts): adults' mean years of schooling (25+) and its start value, children's expected years
  // and residual, expected years ~15 years ago (pipeline), schooling of this year's 25-year-olds, test scores of pupils
  // and of the adult population, test-score residual
  'eduYears', 'eduYears0', 'eduExp', 'eduExpResid', 'eduPipe', 'eduEntry0', 'learn', 'learnAdult', 'learnResid',
  // governance (static in Phase 1, WGI scale ≈ -2.5..2.5)
  'wgiVoice', 'wgiStability', 'wgiEffectiveness', 'wgiRuleOfLaw', 'wgiCorruption',
] as const;
export type Field = (typeof FIELDS)[number];

/** World-level variables (not per country). */
// oilLn: log real oil price relative to baseline; oilDln: its last quarterly change;
// coupBase and off*: hazard offsets solved at t0 so world event rates match observed base rates
// offCivil, offWar: armed-conflict onset offsets (same method); warSeq: id of the next war
export const GLOBALS = ['oilLn', 'oilDln', 'coupBase', 'offCrisis', 'offSanction', 'offJoin', 'offLeave', 'offPact', 'offCivil', 'offWar', 'warSeq'] as const;

/** Per-pair diplomatic state (pair list in systems/diplomacy.ts PairNet; i < j). sancIJ: sanctions by i on j. */
export const PAIR_FIELDS = ['trust', 'trust0', 'grievance', 'sancIJ', 'sancJI'] as const;
export type PairField = (typeof PAIR_FIELDS)[number];
export interface Treaty { id: string; label: string | null; members: number[]; since: number }
export type Global = (typeof GLOBALS)[number];

/** An armed conflict. Civil: a[0] is the government (a[1..] states fighting for it), b the rebels' state backers.
 *  Interstate: a attacks b; fighting is on loc's territory (the defender's). */
export interface War {
  id: number;
  kind: 'interstate' | 'civil';
  a: number[]; b: number[]; loc: number;
  start: number;            // day
  goal: 'government' | 'territory';
  name: string | null;      // rebel group or disputed territory (UCDP) for conflicts under way at the start
  territory?: string | null; // disputed territory (UCDP), for wars over territory under way at the start
  sev: number;              // ln of the war's typical battle deaths per year (drawn at onset)
  lvl: number;              // current deviation of ln deaths from sev (AR(1) month to month)
  score: number;            // −1..1: > 0 side a (government / attacker) is winning
  occ: number;              // interstate: share of loc's territory held by the attacker (0..maxOccupation)
  held: number[];           // interstate: provinces of loc the attacker holds, in the order taken (approximates occ)
  deaths: number;           // cumulative battle deaths
  rate: number;             // battle deaths per year, current
  peak: number;             // highest yearly rate so far
}

/** Single years of age 0..99 plus the open group 100+. */
export const AGES = 101;
/** Offset of (country, sex) in WorldState.cohorts; sex 0 = female, 1 = male. */
export const cohortIndex = (c: number, sex: number) => (c * 2 + sex) * AGES;

/** Yearly history series recorded for charts (Float32 to halve memory). */
export const HIST_FIELDS = ['pop', 'gdp', 'gdpPc', 'tfr', 'lifeExp', 'debtRatio', 'milCap', 'old', 'school'] as const;
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
  pair: Record<PairField, Float64Array>; // diplomatic relations per pair (allocated once the pair list is built)
  treaties: Treaty[];            // defence treaties, members as country indices
  wars: War[];                   // armed conflicts under way
  newStates: NewState[];         // countries born during the simulation (index = baseline count + position)
  nOrg: number;                  // international organisations (baseline.meta.organisations)
  orgIds: string[];              // their ids, in that order
  orgMember: Uint8Array;         // country × organisation: 0 none, 1 member, 2 suspended
  orgMember0: Uint8Array;        // the same at the start (effects are relative to it)
  regionOwner: Int16Array;       // map region (admin-0 unit) -> country index at the start (-1 = none)
  provinceOwner: Int16Array;     // province -> country index; territorial change edits this
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
    version: 1, seed: seed >>> 0, startDay, day: startDay, n, ids: cs.map((c) => c.id), f, cohorts: new Float64Array(n * 2 * AGES), g: { oilLn: 0, oilDln: 0, coupBase: 0, offCrisis: 0, offSanction: 0, offJoin: 0, offLeave: 0, offPact: 0, offCivil: 0, offWar: 0, warSeq: 1 },
    pair: Object.fromEntries(PAIR_FIELDS.map((k) => [k, new Float64Array(0)])) as Record<PairField, Float64Array>, treaties: [], wars: [], newStates: [], nOrg: 0, orgIds: [], orgMember: new Uint8Array(0), orgMember0: new Uint8Array(0),
    nRel: baseline.meta.religions.length, religion: new Float64Array(n * baseline.meta.religions.length),
    regionOwner: Int16Array.from(baseline.regions.map((r) => (r.owner == null ? -1 : idx.get(r.owner) ?? -1))),
    provinceOwner: (() => { const ro = new Map(baseline.regions.map((r) => [r.id, r.owner == null ? -1 : idx.get(r.owner) ?? -1])); return Int16Array.from(baseline.provinces.map((p) => ro.get(p.region) ?? -1)); })(),
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
    pair: Object.fromEntries(PAIR_FIELDS.map((k) => [k, st.pair[k].slice()])) as Record<PairField, Float64Array>,
    treaties: st.treaties.map((t) => ({ ...t, members: t.members.slice() })),
    wars: st.wars.map((w) => ({ ...w, a: w.a.slice(), b: w.b.slice(), held: w.held.slice() })),
    newStates: st.newStates.map((s) => ({ ...s, provinces: s.provinces.slice(), neighbors: s.neighbors.slice() })),
    orgIds: st.orgIds.slice(), orgMember: st.orgMember.slice(), orgMember0: st.orgMember0.slice(),
    regionOwner: st.regionOwner.slice(),
    provinceOwner: st.provinceOwner.slice(),
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
  for (const k of PAIR_FIELDS) mix(new Uint8Array(st.pair[k].buffer));
  mix(enc.encode(JSON.stringify(st.treaties)));
  mix(enc.encode(JSON.stringify(st.wars)));
  mix(enc.encode(JSON.stringify(st.newStates)));
  mix(st.orgMember); mix(st.orgMember0);
  mix(new Uint8Array(st.regionOwner.buffer));
  mix(new Uint8Array(st.provinceOwner.buffer));
  for (const k of Object.keys(st.rng).sort()) mix(new Uint8Array(st.rng[k].buffer));
  mix(enc.encode(JSON.stringify(st.events)));
  mix(enc.encode(JSON.stringify(st.history)));
  return (h >>> 0).toString(16).padStart(8, '0');
}
