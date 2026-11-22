// Leader turnover against Archigos 1975-2015: npm run leaders -- [seeds=10] [years=30]
// Every change of leader is classified by what happened to the country that year: death or ill health, a regular
// change (election lost, government collapse, party handover) or an irregular one (coup, revolution, overthrow, rebels).
import { loadBaseline } from './load';
import { Simulation } from '../engine/sim';
import { daysFromCivil } from '../engine/calendar';

const b = loadBaseline(), A = b.meta.leaders!.archigos;
const seeds = +(process.argv[2] ?? 10), years = +(process.argv[3] ?? 30);
const IRREGULAR = new Set(['coup', 'revolution', 'regime_overthrown', 'rebels_won']);
const exits: Record<string, number> = {}, tenure: number[] = [], entry: number[] = [], exitAge: number[] = [];
let realLeft = 0, realStart = 0;
for (let s = 1; s <= seeds; s++) {
  const sim = new Simulation(b, { seed: s });
  realStart += sim.st.f.leaderReal.reduce((a, x) => a + x, 0);
  for (let y = 1; y <= years; y++) {
    const st = sim.st, n0 = st.n, since = st.f.leaderSince.slice(), born = st.f.leaderBorn.slice(), real = st.f.leaderReal.slice(), ev0 = st.events.length;
    sim.advanceTo(daysFromCivil(2024 + y, 1, 1));
    const f = sim.st.f, ev = sim.st.events.slice(ev0);
    for (let c = 0; c < n0; c++) {
      if (f.leaderSince[c] === since[c]) continue;
      const ks = new Set(ev.filter((e) => e.c === c).map((e) => e.k));
      const kind = ks.has('leader_died') ? 'Natural Death' : ks.has('leader_retired') ? 'Retired Due to Ill Health' : [...ks].some((k) => IRREGULAR.has(k)) ? 'Irregular' : 'Regular';
      exits[kind] = (exits[kind] ?? 0) + 1;
      tenure.push((f.leaderSince[c] - since[c]) / 365.25);
      exitAge.push((f.leaderSince[c] - born[c]) / 365.25);
      entry.push((f.leaderSince[c] - f.leaderBorn[c]) / 365.25);
      if (real[c]) realLeft++;
    }
  }
}
const med = (xs: number[]) => { const t = xs.slice().sort((a, z) => a - z); return t[t.length >> 1]; };
const N = tenure.length, sh = (k: string) => `${(100 * (exits[k] ?? 0) / N).toFixed(1)}% (Archigos ${(100 * (A.exitShares[k] ?? 0)).toFixed(1)}%)`;
console.log(`${N} leader changes in ${seeds} worlds × ${years} years (${(N / seeds / years).toFixed(1)} a year)`);
console.log(`how leaders left: regular ${sh('Regular')}, irregular ${sh('Irregular')}, natural death ${sh('Natural Death')}, ill health ${sh('Retired Due to Ill Health')}`);
console.log(`median tenure ${med(tenure).toFixed(1)} years (Archigos ${A.medianTenure}; tenures of leaders in office at the start count from their real start); age at entry ${med(entry).toFixed(0)} (${A.medianEntryAge}), at exit ${med(exitAge).toFixed(0)} (${A.medianExitAge})`);
console.log(`real leaders of 2023 still in office after ${years} years: ${(100 * (1 - realLeft / realStart)).toFixed(0)}%`);
