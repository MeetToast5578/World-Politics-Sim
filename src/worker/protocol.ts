// Messages between the UI thread and the simulation worker. The worker owns the only Simulation instance.
import type { SimEvent } from '../engine/state';
import type { BaselineCountry } from '../engine/types';

export type StepUnit = 'day' | 'month' | 'year';

export type ToWorker =
  | { type: 'init'; baselineUrl: string; seed: number }
  | { type: 'restart'; seed: number }
  | { type: 'play' } | { type: 'pause' }
  | { type: 'speed'; daysPerSecond: number }
  | { type: 'step'; unit: StepUnit }
  | { type: 'select'; c: number | null }
  | { type: 'rewind'; day: number }
  | { type: 'branch'; seed: number }
  | { type: 'save' }
  | { type: 'load'; json: string };

export interface CountryDetail {
  c: number;
  fields: Record<string, number>;
  history: { years: number[]; series: Record<string, number[]> };
  pyramid: { f: number[]; m: number[] }; // persons by single year of age 0..100+
  religion: number[];                     // shares by baseline.meta.religions category
  orgs: number[];                         // membership per baseline.meta.organisations: 0 none, 1 member, 2 suspended, 3 former
  diplomacy: {
    treaties: { label: string; members: number; since: number }[];
    /** every relation of the country, most trusted first; drivers decompose the trust target (the "why") */
    relations: { c: number; trust: number; grievance: number; sanctionsBy: number; sanctionsOn: number; drivers: Record<string, number> }[];
  };
}

/** An armed conflict under way (see engine War). */
export interface WarInfo {
  id: number; kind: 'interstate' | 'civil'; a: number[]; b: number[]; loc: number; start: number;
  goal: 'government' | 'territory'; name: string | null;
  deaths: number;  // battle deaths since the simulation started
  rate: number;    // battle deaths per year now
  score: number;   // −1..1, > 0: side a (attacker / government) winning
  occ: number;     // share of loc held by the attacker (interstate)
  held: number[];  // provinces of loc held by the attacker
}

export interface Frame {
  type: 'frame';
  day: number;
  startDay: number;
  seed: number;
  playing: boolean;
  branches: { day: number; seed: number }[];
  metrics: Record<string, number[]>; // map mode -> value per country
  world: { pop: number; gdp: number; old: number; oil: number; events: number; years: number[]; popSeries: number[]; gdpSeries: number[] };
  blocLabels: string[]; // labels of multilateral defence treaties, index = metrics.bloc value
  wars: WarInfo[];
  /** owner (country index) per province; sent only when it changed (null otherwise) */
  provinceOwner: number[] | null;
  ownerVersion: number;
  /** countries born during the run (appended to the baseline's), sent when their number changed (null otherwise) */
  extraCountries: BaselineCountry[] | null;
  newEvents: SimEvent[];
  resetEvents: boolean; // true: newEvents is the full list (after load / rewind / restart)
  detail: CountryDetail | null;
  perf: { msPerSimYear: number };
}

export type FromWorker = Frame | { type: 'saved'; json: string } | { type: 'error'; message: string };
