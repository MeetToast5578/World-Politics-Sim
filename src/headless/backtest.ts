// Backtest: npm run backtest -- [seeds=20]
// Starts from the 2000 baseline (public/data/baseline-2000.json, built with `npm run data -- --year 2000`), simulates
// 2001-01-01 → 2024-01-01 for an ensemble of seeds, and compares with observed 2023 values from baseline.json.
// Writes docs/BACKTEST.md. Only countries with non-imputed observations at both ends enter each comparison.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Baseline } from '../engine/types';
import { Simulation } from '../engine/sim';
import { parseDate } from '../engine/calendar';
import { totalPop } from '../engine/state';
import { DEFAULT_PARAMS, type Params } from '../engine/params';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (f: string): Baseline => JSON.parse(fs.readFileSync(path.join(root, 'public/data', f), 'utf8'));
const b0 = read('baseline-2000.json'), b1 = read('baseline.json');
const seeds = Number(process.argv[2] ?? 20);
const end = parseDate('2024-01-01');
const n = b0.countries.length;
if (b1.countries.some((c, i) => c.id !== b0.countries[i].id)) throw new Error('baselines have different country lists');

// ---- ensemble
type Metric = 'pop' | 'gdpGrowth' | 'tfr' | 'lifeExp' | 'demo' | 'school' | 'eys';
let coupAttempts = 0;
function ensemble(nSeeds: number, params?: Partial<Params>): Record<Metric, Float64Array[]> {
const runs: Record<Metric, Float64Array[]> = { pop: [], gdpGrowth: [], tfr: [], lifeExp: [], demo: [], school: [], eys: [] };
for (let s = 1; s <= nSeeds; s++) {
  const sim = new Simulation(b0, { seed: s, params });
  const gdp0 = sim.st.f.gdp.slice();
  sim.advanceTo(end);
  runs.pop.push(Float64Array.from({ length: n }, (_, c) => totalPop(sim.st, c)));
  runs.gdpGrowth.push(Float64Array.from({ length: n }, (_, c) => sim.st.f.gdp[c] / gdp0[c]));
  runs.tfr.push(sim.st.f.tfr.slice());
  runs.lifeExp.push(Float64Array.from({ length: n }, (_, c) => (sim.st.f.e0F[c] + sim.st.f.e0M[c]) / 2));
  runs.demo.push(sim.st.f.demo.slice());
  runs.school.push(sim.st.f.eduYears.slice());
  runs.eys.push(sim.st.f.eduExp.slice());
  for (const e of sim.st.events) if (e.k === 'coup' || e.k === 'coup_failed') coupAttempts++;
}
return runs;
}
const t0 = performance.now();
const runs = ensemble(seeds);
const ms = performance.now() - t0;
const coupsPerYear = coupAttempts / seeds / 23;

// ---- observations
const obs = (bl: Baseline, c: number, k: string) => { const o = bl.countries[c].fields[k]; return o && o.s !== 'IMPUTED' && o.s !== 'NE_EST' ? o.v : NaN; };
const actual: Record<Metric, (c: number) => number> = {
  pop: (c) => obs(b1, c, 'pop'),
  gdpGrowth: (c) => obs(b1, c, 'gdpReal') / obs(b0, c, 'gdpReal'),
  tfr: (c) => obs(b1, c, 'tfr'),
  lifeExp: (c) => obs(b1, c, 'lifeExp'),
  demo: (c) => obs(b1, c, 'vdemEdi'),
  school: (c) => obs(b1, c, 'schoolYears'),
  eys: (c) => obs(b1, c, 'expectedYears'),
};
// naive benchmarks computed from 2000 information (+ one hindsight number for GDP, which makes that benchmark stronger)
const worldGrowth = (() => { let a = 0, z = 0; for (let c = 0; c < n; c++) { const g0 = obs(b0, c, 'gdpReal'), g1 = obs(b1, c, 'gdpReal'); if (g0 > 0 && g1 > 0) { a += g0; z += g1; } } return z / a; })();
const naive: Record<Metric, (c: number) => number> = {
  pop: (c) => obs(b0, c, 'pop') * Math.exp(((obs(b0, c, 'cbr') - obs(b0, c, 'cdr')) / 1000 + (b0.countries[c].fields.netMigration?.v ?? 0) / obs(b0, c, 'pop')) * 23),
  gdpGrowth: () => worldGrowth,
  tfr: (c) => obs(b0, c, 'tfr'),
  lifeExp: (c) => obs(b0, c, 'lifeExp'),
  demo: (c) => obs(b0, c, 'vdemEdi'),
  school: (c) => obs(b0, c, 'schoolYears') + 23 * obs(b0, c, 'schoolTrend'), // linear trend of the 1990s
  eys: (c) => obs(b0, c, 'expectedYears'),
};

const quantile = (xs: number[], q: number) => { const t = xs.slice().sort((a, b) => a - b); const i = (t.length - 1) * q, lo = Math.floor(i); return t[lo] + (t[Math.ceil(i)] - t[lo]) * (i - lo); };
const median = (xs: number[]) => quantile(xs, 0.5);
const pct = (x: number, d = 1) => `${(100 * x).toFixed(d)}%`;
const logMetric = (m: Metric) => m === 'pop' || m === 'gdpGrowth';
const err = (m: Metric, sim: number, act: number) => (logMetric(m) ? Math.log(sim / act) : sim - act);
const spearman = (x: number[], y: number[]) => {
  const rank = (v: number[]) => { const o = v.map((x, i) => [x, i]).sort((a, b) => a[0] - b[0]); const r = new Array(v.length); o.forEach(([, i], k) => (r[i] = k)); return r; };
  const rx = rank(x), ry = rank(y), m = (x.length - 1) / 2;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < x.length; i++) { sxy += (rx[i] - m) * (ry[i] - m); sxx += (rx[i] - m) ** 2; syy += (ry[i] - m) ** 2; }
  return sxy / Math.sqrt(sxx * syy);
};

interface Row { c: number; med: number; lo: number; hi: number; act: number; nai: number }
function rows(m: Metric, rs = runs): Row[] {
  const out: Row[] = [];
  for (let c = 0; c < n; c++) {
    const act = actual[m](c);
    const ens = rs[m].map((r) => r[c]);
    if (!Number.isFinite(act) || ens.some((x) => !Number.isFinite(x))) continue;
    out.push({ c, med: median(ens), lo: quantile(ens, 0.1), hi: quantile(ens, 0.9), act, nai: naive[m](c) });
  }
  return out;
}

const LABEL: Record<Metric, string> = {
  pop: 'Population 2023', gdpGrowth: 'Real GDP growth factor 2000→2023', tfr: 'Total fertility rate 2023', lifeExp: 'Life expectancy 2023',
  demo: 'Democracy index 2023 (V-Dem)', school: "Adults' mean years of schooling 2023 (HDR)", eys: 'Expected years of schooling 2023 (HDR)',
};
const unit = (m: Metric) => (logMetric(m) ? 'log error (≈ % error)' : m === 'tfr' ? 'children per woman' : m === 'demo' ? 'index points' : 'years');
let md = `# Backtest: 2000 → 2023

Generated by \`npm run backtest -- ${seeds}\` on ${new Date().toISOString().slice(0, 10)}. The model starts from the 2000
baseline (\`baseline-2000.json\`: same pipeline, observations from 1992-2000, growth volatility from 1980-1999, income
curves from the 2000 cross-section) and runs ${seeds} seeds from 2001-01-01 to 2024-01-01; the end state is compared with
2023 observations. Ensemble wall time: ${(ms / 1000).toFixed(1)} s. Simulated coup attempts: ${coupsPerYear.toFixed(1)} per
year worldwide (calibration target ${b0.countries.length ? '3' : ''}, Powell & Thyne order of magnitude).

What the model does **not** know: the 2008 financial crisis, COVID-19, which wars would break out (it starts from the
armed conflicts under way in 2000 and simulates new ones at historical rates), sanctions, commodity booms, policy
changes, and any data after 2000. Borders are today's (South Sudan, Kosovo etc. are simulated from their World Bank
back-cast data for 2000). Errors are reported against two naive forecasts that use only 2000 information:
population at constant 2000 natural increase and migration; adults' schooling on its 1990-2000 linear trend; other
indicators unchanged from 2000; real GDP at the *actual* world-average growth (hindsight,
which makes this benchmark harder to beat).

## Summary

| Metric | Countries | Median abs. error (model) | Median abs. error (naive) | Bias (median error) | Rank correlation with actual | Actual inside 10-90% band |
|---|---|---|---|---|---|---|
`;
const regional: string[] = [];
for (const m of ['pop', 'gdpGrowth', 'tfr', 'lifeExp', 'demo', 'school', 'eys'] as Metric[]) {
  const r = rows(m);
  const e = r.map((x) => err(m, x.med, x.act)), en = r.map((x) => err(m, x.nai, x.act)).filter(Number.isFinite);
  const fmt = (v: number) => (logMetric(m) ? pct(v) : v.toFixed(2));
  const rho = spearman(r.map((x) => x.med), r.map((x) => x.act));
  const cover = r.filter((x) => x.act >= x.lo && x.act <= x.hi).length / r.length;
  md += `| ${LABEL[m]} | ${r.length} | ${fmt(median(e.map(Math.abs)))} | ${m === 'gdpGrowth' ? fmt(median(en.map(Math.abs))) + ' ¹' : fmt(median(en.map(Math.abs)))} | ${fmt(median(e))} | ${rho.toFixed(2)} | ${pct(cover, 0)} |\n`;
  // by region
  const regions = [...new Set(b0.countries.map((c) => c.wbRegion))].sort();
  regional.push(`\n### ${LABEL[m]} by region (${unit(m)})\n\n| Region | n | Median abs. error | Bias |\n|---|---|---|---|\n` +
    regions.map((g) => { const ee = r.filter((x) => b0.countries[x.c].wbRegion === g).map((x) => err(m, x.med, x.act)); return ee.length ? `| ${g} | ${ee.length} | ${fmt(median(ee.map(Math.abs)))} | ${fmt(median(ee))} |` : ''; }).filter(Boolean).join('\n'));
  // largest misses
  const worst = r.map((x) => ({ x, e: err(m, x.med, x.act) })).sort((a, z) => Math.abs(z.e) - Math.abs(a.e)).slice(0, 8);
  regional.push(`\nLargest misses: ${worst.map(({ x, e }) => `${b0.countries[x.c].name} (${e > 0 ? '+' : ''}${fmt(e)})`).join(', ')}.`);
}
md += `\n¹ naive GDP = every country grows at the actual world-average rate (×${worldGrowth.toFixed(2)} over 23 years).\n`;
md += `\nErrors for population and GDP are log errors (0.10 ≈ 10%). "Bias" > 0 means the model overshoots. A
well-calibrated ensemble would put ~80% of actual outcomes inside its 10-90% band; a much lower share means the model is
over-confident (too little spread): its random shocks are far smaller than real history's crises, pandemics and policy
changes, and simulated wars rarely hit the same countries as real ones.

## Detail
${regional.join('\n')}

## Reading these results

* These numbers measure how far mechanisms calibrated on one cross-section carry forward over 23 years. They are not
  targets to tune every country toward; a timeline is supposed to diverge from history.
* Use them to find systematic biases (by region or level of development) that point at a missing or wrong mechanism.
`;
// ---- one-at-a-time sensitivity of the headline errors (5 seeds each)
const P = DEFAULT_PARAMS;
const variants: [string, Partial<Params>][] = [
  ['defaults', {}],
  ['catchUp 0.01 (default 0.02)', { catchUp: 0.01 }],
  ['catchUp 0.03', { catchUp: 0.03 }],
  ['frontierGrowth 0.005 (default 0.0083)', { frontierGrowth: 0.005 }],
  ['education.returnPerYear 0 (no human capital in production)', { education: { ...P.education, returnPerYear: 0 } }],
  ['capitalOutput 2.5 (default 3)', { capitalOutput: 2.5 }],
  ['trade.frontierWeight 1 (no diffusion via partners)', { trade: { ...P.trade, frontierWeight: 1 } }],
  ['trade.spillover 0 (no shock transmission)', { trade: { ...P.trade, spillover: 0 } }],
  ['oil.sd 0 (no oil shocks)', { oil: { ...P.oil, sd: 0 } }],
  ['fertilityDrift off', { fertilityDrift: { ...P.fertilityDrift, on: false } }],
  ['fertilityPhase3 off (no post-transition recovery)', { fertilityPhase3: { ...P.fertilityPhase3, on: false } }],
  ['transitionYears 8 (default 15)', { transitionYears: 8 }],
  ['politics.diffusion 0 (no democratic diffusion)', { politics: { ...P.politics, diffusion: 0 } }],
  ['politics.episode.perYear 0.09 (half as many regime episodes)', { politics: { ...P.politics, episode: { ...P.politics.episode, perYear: 0.09 } } }],
  ['politics.aggrandisement 0.24 (double)', { politics: { ...P.politics, aggrandisement: 0.24 } }],
];
md += `\n## Sensitivity (one parameter at a time, 5 seeds each)\n\nMedian absolute error / bias. The defaults are set from the literature
(see \`src/engine/params.ts\`), not tuned to this table; picking the best row would make the backtest in-sample.\n
| Variant | Population | Real GDP growth | Fertility | Life expectancy | Democracy |\n|---|---|---|---|---|---|\n`;
for (const [label, prm] of variants) {
  const rs = ensemble(5, prm);
  const cell = (m: Metric) => { const e = rows(m, rs).map((x) => err(m, x.med, x.act)); const f = (v: number) => (logMetric(m) ? pct(v) : v.toFixed(2)); return `${f(median(e.map(Math.abs)))} / ${f(median(e))}`; };
  md += `| ${label} | ${cell('pop')} | ${cell('gdpGrowth')} | ${cell('tfr')} | ${cell('lifeExp')} | ${cell('demo')} |\n`;
}
fs.writeFileSync(path.join(root, 'docs/BACKTEST.md'), md);
console.log(md.split('## Detail')[0]);
console.log(md.slice(md.indexOf('## Sensitivity')));
