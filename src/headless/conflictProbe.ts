// Ensemble statistics of armed conflict against the UCDP targets in the baseline (calibration, docs/DESIGN.md §3.6).
// npm run conflicts -- [seeds] [years]
import { loadBaseline } from './load';
import { Simulation } from '../engine/sim';
import { daysFromCivil, civilFromDays } from '../engine/calendar';
import { totalPop } from '../engine/state';
import { exclusion } from '../engine/systems/ethnic';

const b = loadBaseline(), C = b.meta.conflict;
const seeds = +(process.argv[2] ?? 4), years = +(process.argv[3] ?? 50);
const q = (a: number[], p: number) => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[Math.floor(p * (s.length - 1))] : NaN; };
// onsets per country-year at peace, by whether 5%+ of people belong to excluded groups; wars over territory
const exp = { ex: 0, inc: 0, onEx: 0, onInc: 0 };
let territorial = 0, withGroup = 0;
let civOn = 0, intOn = 0, civActive = 0, deaths = 0, nukes = 0, annex = 0, joins = 0;
const civDur: number[] = [], intDur: number[] = [], outcomes: Record<string, number> = {}, yrRates: number[] = [];
const t0 = Date.now();
for (let s = 1; s <= seeds; s++) {
  const sim = new Simulation(b, { seed: s });
  const startIds = new Set(sim.st.wars.map((w) => w.id));
  const seen = new Map<number, { kind: string; start: number }>();
  const y0 = 2024;
  let popStart = 0; for (let c = 0; c < sim.st.n; c++) popStart += totalPop(sim.st, c);
  for (let y = 1; y <= years; y++) {
    const before = sim.st.events.length, excluded = new Set<number>(), peace = new Set<number>();
    for (let c = 0; c < sim.st.n; c++) {
      if (sim.st.wars.some((w) => w.kind === 'civil' && w.loc === c)) continue;
      peace.add(c);
      const e = exclusion(sim.st, c, 10);
      if (e.discriminated + e.powerless >= 0.05) { excluded.add(c); exp.ex++; } else exp.inc++;
    }
    const nWars = sim.st.wars.length;
    sim.advanceTo(daysFromCivil(y0 + y, 1, 1));
    for (const w of sim.st.wars) if (w.kind === 'civil' && w.start > daysFromCivil(y0 + y - 1, 1, 1) && !seen.has(w.id)) { if (w.goal === 'territory') territorial++; if ((w.group ?? -1) >= 0) withGroup++; }
    void nWars;
    for (const w of sim.st.wars) if (!seen.has(w.id)) seen.set(w.id, { kind: w.kind, start: w.start });
    civActive += new Set(sim.st.wars.filter((w) => w.kind === 'civil').map((w) => w.loc)).size;
    let yd = 0; for (const w of sim.st.wars) yd += w.rate; yrRates.push(yd);
    for (const e of sim.st.events.slice(before)) {
      if (e.k === 'civil_war_started') { civOn++; if (peace.has(e.c)) { if (excluded.has(e.c)) exp.onEx++; else exp.onInc++; } }
      if (e.k === 'war_started') intOn++;
      if (e.k === 'nuclear_strike') nukes++;
      if (e.k === 'territory_annexed') annex++;
      if (e.k === 'war_joined') joins++;
      if (['civil_war_won', 'rebels_won', 'autonomy_won', 'peace_deal', 'conflict_faded', 'war_won', 'ceasefire'].includes(e.k)) {
        outcomes[e.k] = (outcomes[e.k] ?? 0) + 1;
        const yrs = e.x?.years ?? NaN, wid = e.x?.id;
        // only wars that started in the simulation (no left-censoring); civil measured in calendar years spanned
        const id = wid !== undefined && seen.has(wid) ? ([wid, seen.get(wid)!] as const) : undefined;
        if (id && !startIds.has(id[0])) {
          if (['war_won', 'ceasefire'].includes(e.k)) intDur.push(yrs);
          else civDur.push(civilFromDays(e.d).y - civilFromDays(id[1].start).y + 1);
        }
      }
    }
  }
  for (const w of sim.st.wars) deaths += w.deaths;
  for (const e of sim.st.events) if (e.v && ['civil_war_won', 'rebels_won', 'autonomy_won', 'peace_deal', 'conflict_faded', 'war_won', 'ceasefire'].includes(e.k)) deaths += e.v;
  let pop = 0; for (let c = 0; c < sim.st.n; c++) pop += totalPop(sim.st, c);
  console.log(`seed ${s}: wars now ${sim.st.wars.length}, population ${(popStart / 1e9).toFixed(2)} -> ${(pop / 1e9).toFixed(2)} bn`);
}
const N = seeds * years;
console.log(`civil onsets/yr ${(civOn / N).toFixed(2)} (UCDP ${C.civil.onsetsPerYear}); countries in civil conflict ${(civActive / N).toFixed(1)} (UCDP ${C.civil.activeCountries})`);
console.log(`civil spell years q25/50/75/90 ${[0.25, 0.5, 0.75, 0.9].map((p) => q(civDur, p)).join('/')} (UCDP ${Object.values(C.civil.spellYears).join('/')}) n=${civDur.length}`);
console.log(`interstate onsets/yr ${(intOn / N).toFixed(2)} (UCDP ${C.interstate.onsetsPerYear}); durations q25/50/75/90 ${[0.25, 0.5, 0.75, 0.9].map((p) => q(intDur, p).toFixed(2)).join('/')} (UCDP ${Object.values(C.interstate.durationYears).join('/')}) n=${intDur.length}`);
console.log(`battle deaths/yr median ${Math.round(q(yrRates, 0.5))} mean ${Math.round(yrRates.reduce((a, x) => a + x, 0) / yrRates.length)} (UCDP mean ${C.battleDeathsPerYear}); allies joined ${joins}; annexations ${annex}; nuclear strikes ${nukes}`);
const rEx = exp.onEx / exp.ex, rInc = exp.onInc / exp.inc;
console.log(`civil onset rate where 5%+ are in excluded groups ${(100 * rEx).toFixed(2)}%/yr vs elsewhere ${(100 * rInc).toFixed(2)}%/yr (×${(rEx / rInc).toFixed(1)}; Cederman, Wimmer & Min 2010: excluded groups ~×2-3); wars over territory ${(100 * territorial / Math.max(1, civOn)).toFixed(0)}% of new civil wars, ${(100 * withGroup / Math.max(1, civOn)).toFixed(0)}% rooted in an excluded group`);
console.log('outcomes', JSON.stringify(outcomes), `${((Date.now() - t0) / N).toFixed(1)} ms per simulated year`);
