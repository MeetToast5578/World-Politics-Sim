import type { GovForm } from '../engine/types';
import { fmtNum, fmtPct, fmtUsd } from './format';

export interface MapMode {
  id: string;
  label: string;
  group: string;
  kind: 'political' | 'categorical' | 'sequential' | 'diverging';
  metric?: string;   // key in Frame.metrics
  log?: boolean;
  fmt?: (v: number) => string;
  note?: string;
}

export const MAP_MODES: MapMode[] = [
  { id: 'political', label: 'Political', group: 'Politics', kind: 'political' },
  { id: 'government', label: 'Government form', group: 'Politics', kind: 'categorical', note: 'Baseline classification from Wikidata (static in Phase 1).' },
  { id: 'effectiveness', label: 'Govt effectiveness (WGI)', group: 'Politics', kind: 'diverging', metric: 'effectiveness', fmt: (v) => v.toFixed(2), note: 'World Bank WGI estimate, static in Phase 1.' },
  { id: 'voice', label: 'Voice & accountability (WGI)', group: 'Politics', kind: 'diverging', metric: 'voice', fmt: (v) => v.toFixed(2), note: 'World Bank WGI estimate, static in Phase 1.' },
  { id: 'pop', label: 'Population', group: 'Demography', kind: 'sequential', metric: 'pop', log: true, fmt: (v) => fmtNum(v) },
  { id: 'tfr', label: 'Fertility rate', group: 'Demography', kind: 'sequential', metric: 'tfr', fmt: (v) => v.toFixed(2) },
  { id: 'lifeExp', label: 'Life expectancy', group: 'Demography', kind: 'sequential', metric: 'lifeExp', fmt: (v) => v.toFixed(1) },
  { id: 'old', label: 'Population 65+', group: 'Demography', kind: 'sequential', metric: 'old', fmt: (v) => fmtPct(v) },
  { id: 'gdp', label: 'GDP', group: 'Economy', kind: 'sequential', metric: 'gdp', log: true, fmt: fmtUsd },
  { id: 'gdpPc', label: 'GDP per capita', group: 'Economy', kind: 'sequential', metric: 'gdpPc', log: true, fmt: fmtUsd },
  { id: 'growth', label: 'GDP growth (last year)', group: 'Economy', kind: 'diverging', metric: 'growth', fmt: (v) => fmtPct(v) },
  { id: 'inflation', label: 'Inflation', group: 'Economy', kind: 'sequential', metric: 'inflation', fmt: (v) => `${v.toFixed(1)}%` },
  { id: 'trade', label: 'Trade / GDP', group: 'Economy', kind: 'sequential', metric: 'trade', log: true, fmt: (v) => `${v.toFixed(0)}%`, note: 'Exports + imports from the gravity trade model.' },
  { id: 'agri', label: 'Agriculture share', group: 'Economy', kind: 'sequential', metric: 'agri', fmt: (v) => fmtPct(v) },
  { id: 'oilExp', label: 'Oil price exposure', group: 'Economy', kind: 'diverging', metric: 'oilExp', fmt: (v) => fmtPct(v), note: 'Hydrocarbon rents minus energy-import cost, % of GDP: blue gains from a higher oil price, red loses.' },
  { id: 'unemp', label: 'Unemployment', group: 'Economy', kind: 'sequential', metric: 'unemp', fmt: (v) => `${v.toFixed(1)}%` },
  { id: 'debt', label: 'Public debt / GDP', group: 'Economy', kind: 'sequential', metric: 'debt', fmt: (v) => fmtPct(v, 0) },
  { id: 'mil', label: 'Military capital', group: 'Military', kind: 'sequential', metric: 'mil', log: true, fmt: fmtUsd, note: 'Perpetual inventory of military spending (SIPRI via WDI). Grey = no data.' },
  { id: 'milexShare', label: 'Military spending / GDP', group: 'Military', kind: 'sequential', metric: 'milexShare', fmt: (v) => fmtPct(v) },
];

export const GOV_COLORS: Record<GovForm, string> = {
  parliamentary: '#4e79a7', presidential: '#59a14f', semi_presidential: '#76b7b2', constitutional_monarchy: '#9c755f',
  absolute_monarchy: '#b07aa1', one_party: '#e15759', military: '#f28e2b', theocracy: '#edc948',
  republic_other: '#8cd17d', monarchy_other: '#d4a6c8', unclassified: '#5a5f6a',
};
export const GOV_LABELS: Record<GovForm, string> = {
  parliamentary: 'Parliamentary', presidential: 'Presidential', semi_presidential: 'Semi-presidential',
  constitutional_monarchy: 'Constitutional monarchy', absolute_monarchy: 'Absolute monarchy', one_party: 'One-party state',
  military: 'Military government', theocracy: 'Theocracy', republic_other: 'Republic (type unclassified)',
  monarchy_other: 'Monarchy (type unclassified)', unclassified: 'Unclassified',
};

// Viridis-like sequential ramp and a blue-grey-red diverging ramp (perceptually ordered, colour-blind safe).
const SEQ = ['#440154', '#3b528b', '#21918c', '#5ec962', '#fde725'];
const DIV = ['#b2182b', '#ef8a62', '#e8e8e8', '#67a9cf', '#2166ac'];
function ramp(stops: string[], t: number): string {
  t = Math.min(1, Math.max(0, t));
  const x = t * (stops.length - 1), i = Math.min(stops.length - 2, Math.floor(x)), u = x - i;
  const a = parseInt(stops[i].slice(1), 16), b = parseInt(stops[i + 1].slice(1), 16);
  const ch = (s: number) => Math.round(((a >> s) & 255) * (1 - u) + ((b >> s) & 255) * u);
  return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
}

export interface Scale { color: (v: number) => string; lo: number; hi: number; stops: string[] }

/** Colour scale over the current values (5th-95th percentile so outliers do not flatten the map). */
export function makeScale(mode: MapMode, values: number[]): Scale {
  const tr = (v: number) => (mode.log ? Math.log(Math.max(v, 1e-9)) : v);
  const xs = values.filter((v) => Number.isFinite(v) && (!mode.log || v > 0)).map(tr).sort((a, b) => a - b);
  let lo = xs[Math.floor(xs.length * 0.05)] ?? 0, hi = xs[Math.floor(xs.length * 0.95)] ?? 1;
  if (mode.kind === 'diverging') { const m = Math.max(Math.abs(lo), Math.abs(hi)); lo = -m; hi = m; }
  if (hi === lo) hi = lo + 1;
  const stops = mode.kind === 'diverging' ? DIV : SEQ;
  return {
    stops, lo: mode.log ? Math.exp(lo) : lo, hi: mode.log ? Math.exp(hi) : hi,
    color: (v) => (!Number.isFinite(v) || (mode.log && v <= 0) ? '#3a3f4b' : ramp(stops, (tr(v) - lo) / (hi - lo))),
  };
}

/** Stable, distinct-ish colour per country for the political map. */
export function politicalColor(i: number): string {
  const h = (i * 137.508) % 360, s = 38 + ((i * 7) % 3) * 9, l = 46 + ((i * 11) % 4) * 6;
  return `hsl(${h.toFixed(1)} ${s}% ${l}%)`;
}
