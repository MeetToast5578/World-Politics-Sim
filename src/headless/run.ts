// Headless run: npm run headless -- [years=100] [seed=1]
// Prints world aggregates every decade plus the largest countries at the end, and the state hash.
import { loadBaseline } from './load';
import { Simulation } from '../engine/sim';
import { totalPop } from '../engine/state';
import { formatDate, addMonths } from '../engine/calendar';
import { eventText } from '../engine/describe';

const years = Number(process.argv[2] ?? 100);
const seed = Number(process.argv[3] ?? 1);
const b = loadBaseline();
const sim = new Simulation(b, { seed });
const name = (c: number) => b.countries[c].name;

const world = () => {
  const { f, n } = sim.st;
  let P = 0, Y = 0, old = 0;
  for (let c = 0; c < n; c++) { P += totalPop(sim.st, c); Y += f.gdp[c]; old += f.p2[c]; }
  return { P, Y, old: old / P };
};
const t0 = performance.now();
for (let y = 0; y <= years; y += 10) {
  const w = world();
  console.log(`${formatDate(sim.st.day)}  pop ${(w.P / 1e9).toFixed(2)} bn  GDP ${(w.Y / 1e12).toFixed(1)} tn USD(2023)  65+ ${(w.old * 100).toFixed(1)}%  events ${sim.st.events.length}`);
  if (y < years) sim.advanceTo(addMonths(sim.st.day, 12 * Math.min(10, years - y)));
}
const ms = performance.now() - t0;
const { f } = sim.st;
const top = Array.from({ length: sim.st.n }, (_, i) => i).sort((a, b) => f.gdp[b] - f.gdp[a]).slice(0, 12);
console.log('\nLargest economies:');
for (const c of top) {
  const P = totalPop(sim.st, c);
  console.log(`  ${name(c).padEnd(26)} GDP ${(f.gdp[c] / 1e12).toFixed(2).padStart(7)} tn  pop ${(P / 1e6).toFixed(0).padStart(5)} m  GDP/cap ${Math.round(f.gdp[c] / P).toString().padStart(7)}  TFR ${f.tfr[c].toFixed(2)}  e0 ${f.lifeExp[c].toFixed(1)}  debt ${(100 * f.debt[c] / f.gdp[c]).toFixed(0)}%`);
}
console.log('\nLast events:');
for (const e of sim.st.events.slice(-8)) console.log('  ' + formatDate(e.d) + '  ' + eventText(e, name));
console.log(`\n${years} years in ${ms.toFixed(0)} ms; state hash ${sim.hash()}`);
