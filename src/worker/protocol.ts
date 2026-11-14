// Messages between the UI thread and the simulation worker. The worker owns the only Simulation instance.
import type { SimEvent } from '../engine/state';

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
  diplomacy: {
    treaties: { label: string; members: number; since: number }[];
    /** every relation of the country, most trusted first; drivers decompose the trust target (the "why") */
    relations: { c: number; trust: number; grievance: number; sanctionsBy: number; sanctionsOn: number; drivers: Record<string, number> }[];
  };
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
  newEvents: SimEvent[];
  resetEvents: boolean; // true: newEvents is the full list (after load / rewind / restart)
  detail: CountryDetail | null;
  perf: { msPerSimYear: number };
}

export type FromWorker = Frame | { type: 'saved'; json: string } | { type: 'error'; message: string };
