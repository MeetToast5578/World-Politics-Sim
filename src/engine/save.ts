// Save format: JSON with typed arrays as base64. Contains the complete mutable state plus params, so
// loading and continuing produces exactly the same future as never having saved.
import type { Baseline } from './types';
import { FIELDS, HIST_FIELDS, type Field, type WorldState } from './state';
import { Simulation } from './sim';
import type { Params } from './params';

const FORMAT = 'world-sim-save';
const VERSION = 1;

function toB64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function fromB64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
const f64 = (a: Float64Array) => toB64(new Uint8Array(a.buffer, a.byteOffset, a.byteLength));
const f32 = (a: number[]) => toB64(new Uint8Array(Float32Array.from(a).buffer));

export function saveWorld(sim: Simulation): string {
  const st = sim.st;
  return JSON.stringify({
    format: FORMAT, version: VERSION, params: sim.params, startDate: sim.startDate ?? null,
    seed: st.seed, startDay: st.startDay, day: st.day, ids: st.ids,
    f: Object.fromEntries(FIELDS.map((k) => [k, f64(st.f[k])])),
    regionOwner: Array.from(st.regionOwner),
    rng: Object.fromEntries(Object.entries(st.rng).map(([k, v]) => [k, Array.from(v)])),
    branches: st.branches, events: st.events, milestones: st.milestones,
    history: { years: st.history.years, data: Object.fromEntries(HIST_FIELDS.map((k) => [k, f32(st.history.data[k])])) },
  });
}

export function loadWorld(baseline: Baseline, json: string): Simulation {
  const s = JSON.parse(json);
  if (s.format !== FORMAT) throw new Error('Not a world save file');
  if (s.version !== VERSION) throw new Error(`Unsupported save version ${s.version}`);
  const ids: string[] = baseline.countries.map((c) => c.id);
  if (ids.length !== s.ids.length || ids.some((id, i) => id !== s.ids[i]))
    throw new Error('Save was made with a different baseline dataset (country list differs)');
  const sim = new Simulation(baseline, { seed: s.seed, startDate: s.startDate ?? undefined, params: s.params as Params });
  const n = ids.length;
  const st: WorldState = {
    version: 1, seed: s.seed, startDay: s.startDay, day: s.day, n, ids,
    f: Object.fromEntries(FIELDS.map((k) => {
      const a = new Float64Array(fromB64(s.f[k]).buffer);
      if (a.length !== n) throw new Error(`Corrupt save: field ${k}`);
      return [k, a];
    })) as Record<Field, Float64Array>,
    regionOwner: Int16Array.from(s.regionOwner),
    rng: Object.fromEntries(Object.entries(s.rng as Record<string, number[]>).map(([k, v]) => [k, Uint32Array.from(v)])),
    branches: s.branches, events: s.events, milestones: s.milestones,
    history: {
      years: s.history.years,
      data: Object.fromEntries(HIST_FIELDS.map((k) => [k, Array.from(new Float32Array(fromB64(s.history.data[k]).buffer))])) as any,
    },
  };
  sim.setState(st);
  return sim;
}
