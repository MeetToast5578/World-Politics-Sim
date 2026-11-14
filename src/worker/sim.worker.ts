/// <reference lib="webworker" />
// Runs the simulation off the UI thread and streams compact frames back.
import type { Baseline } from '../engine/types';
import { Simulation } from '../engine/sim';
import { saveWorld, loadWorld } from '../engine/save';
import { FIELDS, HIST_FIELDS, totalPop } from '../engine/state';
import { addMonths } from '../engine/calendar';
import type { ToWorker, Frame, FromWorker } from './protocol';

let baseline: Baseline;
let sim: Simulation;
let playing = false;
let daysPerSecond = 365;
let selected: number | null = null;
let sentEvents = 0;
let resetEvents = true;
let carry = 0; // fractional days not yet simulated
let msPerSimYear = 0;
const TICK_MS = 50;

const post = (m: FromWorker) => (self as unknown as Worker).postMessage(m);

function metrics(): Record<string, number[]> {
  const { f, n, history } = sim.st;
  const out: Record<string, number[]> = { pop: [], gdp: [], gdpPc: [], growth: [], tfr: [], lifeExp: [], old: [], debt: [], mil: [], milexShare: [], effectiveness: [], voice: [], unemp: [] };
  const H = history.years.length, g = history.data.gdp;
  for (let c = 0; c < n; c++) {
    const P = totalPop(sim.st, c);
    out.pop.push(P);
    out.gdp.push(f.gdp[c]);
    out.gdpPc.push(f.gdp[c] / P);
    out.growth.push(H >= 2 ? g[(H - 1) * n + c] / g[(H - 2) * n + c] - 1 : NaN);
    out.tfr.push(f.tfr[c]);
    out.lifeExp.push(f.lifeExp[c]);
    out.old.push(f.p2[c] / P);
    out.debt.push(f.debt[c] / f.gdp[c]);
    const noMilData = !baseline.countries[c].fields.milexShare; // shown as "no data", not as zero
    out.mil.push(noMilData ? NaN : f.milCap[c]);
    out.milexShare.push(noMilData ? NaN : f.milexShare[c]);
    out.effectiveness.push(f.wgiEffectiveness[c]);
    out.voice.push(f.wgiVoice[c]);
    out.unemp.push(f.unemp[c]);
  }
  return out;
}

function frame(): Frame {
  const st = sim.st, m = metrics();
  let pop = 0, gdp = 0, old = 0;
  for (let c = 0; c < st.n; c++) { pop += m.pop[c]; gdp += m.gdp[c]; old += st.f.p2[c]; }
  const H = st.history.years.length, popSeries: number[] = [], gdpSeries: number[] = [];
  for (let y = 0; y < H; y++) {
    let p = 0, g = 0;
    for (let c = 0; c < st.n; c++) { p += st.history.data.pop[y * st.n + c]; g += st.history.data.gdp[y * st.n + c]; }
    popSeries.push(p); gdpSeries.push(g);
  }
  const newEvents = resetEvents ? st.events.slice() : st.events.slice(sentEvents);
  const fr: Frame = {
    type: 'frame', day: st.day, startDay: st.startDay, seed: st.seed, playing, branches: st.branches, metrics: m,
    world: { pop, gdp, old: old / pop, events: st.events.length, years: st.history.years, popSeries, gdpSeries },
    newEvents, resetEvents, detail: null, perf: { msPerSimYear },
  };
  sentEvents = st.events.length;
  resetEvents = false;
  if (selected !== null) {
    const c = selected;
    const series: Record<string, number[]> = {};
    for (const k of HIST_FIELDS) series[k] = Array.from({ length: H }, (_, y) => st.history.data[k][y * st.n + c]);
    fr.detail = { c, fields: Object.fromEntries(FIELDS.map((k) => [k, st.f[k][c]])), history: { years: st.history.years, series } };
  }
  return fr;
}

function guarded(fn: () => void) {
  try { fn(); } catch (e) { playing = false; post({ type: 'error', message: e instanceof Error ? e.message : String(e) }); }
}

function tick() {
  if (!playing) return;
  guarded(() => {
    const t0 = performance.now();
    const before = sim.st.day;
    carry += (daysPerSecond * TICK_MS) / 1000;
    const whole = Math.floor(carry);
    carry -= whole;
    if (whole > 0) sim.advanceDays(whole);
    const simulated = sim.st.day - before;
    if (simulated > 300) msPerSimYear = ((performance.now() - t0) / simulated) * 365.25;
    post(frame());
  });
}
setInterval(tick, TICK_MS);

self.onmessage = async (ev: MessageEvent<ToWorker>) => {
  const m = ev.data;
  if (m.type === 'init') {
    try {
      baseline = await (await fetch(m.baselineUrl)).json();
      sim = new Simulation(baseline, { seed: m.seed });
      resetEvents = true;
      post(frame());
    } catch (e) { post({ type: 'error', message: `Could not load baseline: ${e}` }); }
    return;
  }
  if (!sim) return;
  guarded(() => {
    switch (m.type) {
      case 'restart': sim = new Simulation(baseline, { seed: m.seed }); resetEvents = true; break;
      case 'play': playing = true; break;
      case 'pause': playing = false; break;
      case 'speed': daysPerSecond = m.daysPerSecond; carry = 0; break;
      case 'select': selected = m.c; break;
      case 'step': {
        const d = sim.st.day;
        sim.advanceTo(m.unit === 'day' ? d + 1 : addMonths(d, m.unit === 'month' ? 1 : 12));
        break;
      }
      case 'rewind': playing = false; sim.rewindTo(m.day); resetEvents = true; break;
      case 'branch': sim.branch(m.seed); break;
      case 'save': post({ type: 'saved', json: saveWorld(sim) }); return;
      case 'load': playing = false; sim = loadWorld(baseline, m.json); resetEvents = true; break;
    }
    post(frame());
  });
};
