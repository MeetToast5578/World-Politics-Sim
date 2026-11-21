// Calibration by simulated moments (docs/REALISM_PLAN.md step A): npm run calibrate
// Fits growth parameters on 2000→2010 (start: baseline-2000.json, target: baseline-2010.json), then checks them out of
// sample on 2010→2023 (baseline-2010.json → baseline.json), against the hand-set defaults. Writes docs/CALIBRATION.md.
//  stage 1, point forecast (no growth-regime shocks, 2 seeds): catch-up rate, frontier TFP growth and the return to
//          schooling minimise median |log error| of real GDP growth + 0.5 |median error| (bias)
//  stage 2, spread: the size and persistence of growth-regime shocks so that 80% of actual outcomes fall inside the
//          ensemble's 10-90% band (10 seeds)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Baseline } from '../engine/types';
import { Simulation } from '../engine/sim';
import { daysFromCivil } from '../engine/calendar';
import { totalPop } from '../engine/state';
import { DEFAULT_PARAMS as D, type Params } from '../engine/params';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (f: string): Baseline => JSON.parse(fs.readFileSync(path.join(root, 'public/data', f), 'utf8'));
const B = { 2000: read('baseline-2000.json'), 2010: read('baseline-2010.json'), 2023: read('baseline.json') };
const obs = (b: Baseline, c: number, k: string) => { const o = b.countries[c].fields[k]; return o && o.s !== 'IMPUTED' && o.s !== 'NE_EST' ? o.v : NaN; };
const q = (xs: number[], p: number) => { const t = xs.slice().sort((a, b) => a - b); const i = (t.length - 1) * p, lo = Math.floor(i); return t[lo] + (t[Math.ceil(i)] - t[lo]) * (i - lo); };

interface Score { mae: number; bias: number; cover: number; popMae: number; n: number }
/** Ensemble from `from` (reference year) to the start of the year after `to`, scored on real GDP growth and population. */
function score(from: 2000 | 2010, to: 2010 | 2023, params: Partial<Params>, seeds: number): Score {
  const b0 = B[from], b1 = B[to], n = b0.countries.length;
  const g: number[][] = [], pop: number[][] = [];
  for (let s = 1; s <= seeds; s++) {
    const sim = new Simulation(b0, { seed: s, params });
    const gdp0 = sim.st.f.gdp.slice();
    sim.advanceTo(daysFromCivil(to + 1, 1, 1));
    g.push(Array.from({ length: n }, (_, c) => sim.st.f.gdp[c] / gdp0[c]));
    pop.push(Array.from({ length: n }, (_, c) => totalPop(sim.st, c)));
  }
  const e: number[] = [], ep: number[] = [];
  let inside = 0;
  for (let c = 0; c < n; c++) {
    const act = obs(b1, c, 'gdpReal') / obs(b0, c, 'gdpReal'), ens = g.map((r) => r[c]);
    if (Number.isFinite(act) && act > 0 && ens.every(Number.isFinite)) {
      e.push(Math.log(q(ens, 0.5) / act));
      if (act >= q(ens, 0.1) && act <= q(ens, 0.9)) inside++;
    }
    const pa = obs(b1, c, 'pop');
    if (Number.isFinite(pa)) ep.push(Math.abs(Math.log(q(pop.map((r) => r[c]), 0.5) / pa)));
  }
  return { mae: q(e.map(Math.abs), 0.5), bias: q(e, 0.5), cover: inside / e.length, popMae: q(ep, 0.5), n: e.length };
}

const loss = (s: Score) => s.mae + 0.5 * Math.abs(s.bias);
const withParams = (catchUp: number, frontierGrowth: number, returnPerYear: number, sd: number, years: number): Partial<Params> =>
  ({ catchUp, frontierGrowth, education: { ...D.education, returnPerYear }, growthRegime: { sd, years } });
const pct = (x: number) => `${(100 * x).toFixed(1)}%`;
const t0 = performance.now();

// stage 1
let best = { catchUp: D.catchUp, frontierGrowth: D.frontierGrowth, returnPerYear: D.education.returnPerYear, l: Infinity, s: null as Score | null };
const rows1: string[] = [];
for (const catchUp of [0.01, 0.015, 0.02, 0.025, 0.03])
  for (const frontierGrowth of [0.006, 0.0083, 0.01, 0.012])
    for (const returnPerYear of [0.04, 0.08]) {
      const s = score(2000, 2010, withParams(catchUp, frontierGrowth, returnPerYear, 0, 8), 2);
      rows1.push(`| ${catchUp} | ${frontierGrowth} | ${returnPerYear} | ${pct(s.mae)} | ${pct(s.bias)} |`);
      if (loss(s) < best.l) best = { catchUp, frontierGrowth, returnPerYear, l: loss(s), s };
      process.stdout.write('.');
    }
console.log(`\nstage 1 best`, best);

// stage 2
let best2 = { sd: 0, years: 8, gap: Infinity, s: null as Score | null };
const rows2: string[] = [];
for (const years of [4, 8, 15])
  for (const sd of [0.005, 0.01, 0.015, 0.02, 0.03]) {
    const s = score(2000, 2010, withParams(best.catchUp, best.frontierGrowth, best.returnPerYear, sd, years), 10);
    rows2.push(`| ${sd} | ${years} | ${pct(s.cover)} | ${pct(s.mae)} | ${pct(s.bias)} |`);
    const gap = Math.abs(s.cover - 0.8) + s.mae; // coverage first, then accuracy
    if (gap < best2.gap) best2 = { sd, years, gap, s };
    process.stdout.write('.');
  }
console.log(`\nstage 2 best`, best2);

// out of sample: 2010 → 2023, 20 seeds
const fitted = withParams(best.catchUp, best.frontierGrowth, best.returnPerYear, best2.sd, best2.years);
const oldDefaults: Partial<Params> = { growthRegime: { sd: 0, years: 8 } }; // hand-set values before this step (no regime shocks)
const outDefault = score(2010, 2023, oldDefaults, 20), outFit = score(2010, 2023, fitted, 20);
const inDefault = score(2000, 2010, oldDefaults, 20), inFit = score(2000, 2010, fitted, 20);
const naive = (() => { // every country at the actual world-average growth 2010-2023 (hindsight)
  const b0 = B[2010], b1 = B[2023];
  let a = 0, z = 0; const r: number[] = [];
  for (let c = 0; c < b0.countries.length; c++) { const g0 = obs(b0, c, 'gdpReal'), g1 = obs(b1, c, 'gdpReal'); if (g0 > 0 && g1 > 0) { a += g0; z += g1; r.push(g1 / g0); } }
  return q(r.map((x) => Math.abs(Math.log(z / a / x))), 0.5);
})();
const secs = ((performance.now() - t0) / 1000).toFixed(0);

const md = `# Calibration (step A)

Generated by \`npm run calibrate\` on ${new Date().toISOString().slice(0, 10)} in ${secs} s. Parameters are fitted on
**2000→2010** (simulation from \`baseline-2000.json\`, compared with \`baseline-2010.json\`) and tested out of sample
on **2010→2023** (from \`baseline-2010.json\`, compared with \`baseline.json\`), so the test period played no part in
choosing them. The 2000→2023 backtest in \`docs/BACKTEST.md\` overlaps the fitting period and is no longer a clean test.

## Result

| | Fitted | Before |
|---|---|---|
| catch-up rate (share of log TFP gap closed per year) | ${best.catchUp} | ${D.catchUp} |
| frontier TFP growth per year | ${best.frontierGrowth} | ${D.frontierGrowth} |
| return per learning-adjusted year of school | ${best.returnPerYear} | ${D.education.returnPerYear} |
| growth-regime shocks: s.d. of TFP growth deviation / persistence (years) | ${best2.sd} / ${best2.years} | none |

| Real GDP growth | Median abs. log error | Bias | Actual inside the 10-90% band | Countries |
|---|---|---|---|---|
| 2000→2010, before (in sample) | ${pct(inDefault.mae)} | ${pct(inDefault.bias)} | ${pct(inDefault.cover)} | ${inDefault.n} |
| 2000→2010, fitted (in sample) | ${pct(inFit.mae)} | ${pct(inFit.bias)} | ${pct(inFit.cover)} | ${inFit.n} |
| **2010→2023, before (out of sample)** | ${pct(outDefault.mae)} | ${pct(outDefault.bias)} | ${pct(outDefault.cover)} | ${outDefault.n} |
| **2010→2023, fitted (out of sample)** | ${pct(outFit.mae)} | ${pct(outFit.bias)} | ${pct(outFit.cover)} | ${outFit.n} |
| 2010→2023, naive: actual world-average growth for all (hindsight) | ${pct(naive)} | — | — | — |

Population error 2010→2023: ${pct(outDefault.popMae)} before, ${pct(outFit.popMae)} fitted.

## Stage 1: point forecast (2 seeds, no regime shocks), loss = median |error| + 0.5 |bias|

| catch-up | frontier growth | return to schooling | median abs. error | bias |
|---|---|---|---|---|
${rows1.join('\n')}

## Stage 2: spread (10 seeds), target 80% coverage

| s.d. | persistence (years) | coverage | median abs. error | bias |
|---|---|---|---|---|
${rows2.join('\n')}

## Limits

* Ten years of fitting data and one outcome (GDP growth): parameters of politics, conflict and demography are still
  set from the literature and checked against event rates (\`npm run conflicts\`) and the backtest.
* A grid, not an optimiser; the grid points are the plausible ranges from the literature cited in \`params.ts\`.
* Growth regimes are random: they make the ensemble honest about uncertainty, not individual forecasts better.
`;
fs.writeFileSync(path.join(root, 'docs/CALIBRATION.md'), md);
console.log(md.slice(md.indexOf('## Result'), md.indexOf('## Stage 1')));
