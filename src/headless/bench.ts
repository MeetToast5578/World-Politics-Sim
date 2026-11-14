// Benchmark: npm run bench
// Measures whole-simulation speed, per-subsystem cost, scaling with entity count, memory, save/load and replay cost,
// and checks run-to-run determinism.
import { loadBaseline } from './load';
import { Simulation } from '../engine/sim';
import { addMonths } from '../engine/calendar';
import { saveWorld, loadWorld } from '../engine/save';
import { Rng } from '../engine/rng';
import { demographyMonthly, demographyYearly } from '../engine/systems/demography';
import { economyQuarterly } from '../engine/systems/economy';
import { chronicleQuarterly, chronicleYearly } from '../engine/systems/chronicle';
import type { Baseline } from '../engine/types';

const b = loadBaseline();
const time = (fn: () => void) => { const t = performance.now(); fn(); return performance.now() - t; };
const years = (s: Simulation, n: number) => s.advanceTo(addMonths(s.st.day, 12 * n));
const mb = (x: number) => (x / 1024 / 1024).toFixed(1);

console.log(`countries=${b.countries.length} regions=${b.regions.length}\n`);

// 1. whole simulation
let sim!: Simulation;
const tInit = time(() => { sim = new Simulation(b, { seed: 1 }); });
const heap0 = process.memoryUsage().heapUsed;
const t300 = time(() => years(sim, 300));
const heap1 = process.memoryUsage().heapUsed;
console.log(`init                 ${tInit.toFixed(1)} ms`);
console.log(`300 simulated years  ${t300.toFixed(0)} ms  (${(t300 / 300).toFixed(2)} ms/year), ${sim.st.events.length} events`);
console.log(`heap growth          ${mb(heap1 - heap0)} MB (history + events; GC-dependent)`);

// 2. save / load / replay
let json = '';
const tSave = time(() => { json = saveWorld(sim); });
const tLoad = time(() => { loadWorld(b, json); });
const tRewind = time(() => sim.rewindTo(sim.st.day));
console.log(`save                 ${tSave.toFixed(0)} ms, ${mb(json.length)} MB`);
console.log(`load                 ${tLoad.toFixed(0)} ms`);
console.log(`rewind (replay 300y) ${tRewind.toFixed(0)} ms`);

// 3. per-subsystem cost (one year of calls on a fresh world)
const s2 = new Simulation(b, { seed: 2 });
const rng = new Rng(3);
const N = 50;
const dm = time(() => { for (let i = 0; i < 12 * N; i++) demographyMonthly(s2.st, s2.params); }) / N;
const dy = time(() => { for (let i = 0; i < N; i++) demographyYearly(s2.st, b, s2.params); }) / N;
const eq = time(() => { for (let i = 0; i < 4 * N; i++) economyQuarterly(s2.st, s2.params, rng); }) / N;
const cq = time(() => { for (let i = 0; i < 4 * N; i++) chronicleQuarterly(s2.st); }) / N;
const cy = time(() => { for (let i = 0; i < N; i++) chronicleYearly(s2.st); }) / N;
console.log(`\nper simulated year:  demography(monthly) ${dm.toFixed(3)} ms | demography(yearly) ${dy.toFixed(3)} ms | economy ${eq.toFixed(3)} ms | chronicle ${(cq + cy).toFixed(3)} ms`);

// 4. scaling: replicate the country set k times (synthetic, for cost only)
console.log('\nscaling (synthetic copies of the baseline):');
for (const k of [1, 2, 4, 8]) {
  const big: Baseline = { ...b, countries: Array.from({ length: k }, (_, j) => b.countries.map((c) => ({ ...c, id: `${c.id}_${j}` }))).flat(), regions: [] };
  const s = new Simulation(big, { seed: 1 });
  const t = time(() => years(s, 50));
  console.log(`  ${String(big.countries.length).padStart(5)} entities: ${(t / 50).toFixed(2)} ms/year`);
}

// 5. determinism
const hashes = [1, 2, 3].map(() => { const s = new Simulation(b, { seed: 77 }); years(s, 100); return s.hash(); });
console.log(`\ndeterminism (3 runs, seed 77, 100y): ${hashes.join(' ')} ${new Set(hashes).size === 1 ? 'OK' : 'MISMATCH'}`);
