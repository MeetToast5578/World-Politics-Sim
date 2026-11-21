// Map views: plain names, a one-line explanation, and words for each end of the colour scale.
import type { Baseline, GovForm } from '../engine/types';
import { fmtNum, fmtPct, fmtUsd } from './format';
import { REGIME_WORDS } from './words';

export interface MapMode {
  id: string;
  label: string;
  group: string;
  kind: 'political' | 'categorical' | 'sequential' | 'diverging';
  metric?: string;          // key in Frame.metrics
  log?: boolean;
  fmt?: (v: number) => string;
  about: string;            // what the colours show, in one sentence
  low?: string; high?: string; // words for the two ends of the scale
  featured?: boolean;       // shown as a main button; the rest live under "More maps"
  needsSelection?: boolean;
}

export const MAP_MODES: MapMode[] = [
  { id: 'political', label: 'Countries', group: 'Main', kind: 'political', featured: true, about: 'Each country in its own colour. Click one to see what is happening there.' },
  { id: 'gdpPc', label: 'Wealth', group: 'Main', kind: 'sequential', metric: 'gdpPc', log: true, fmt: fmtUsd, featured: true, about: 'Economic output per person, in 2023 dollars.', low: 'Poorer', high: 'Richer' },
  { id: 'pop', label: 'Population', group: 'Main', kind: 'sequential', metric: 'pop', log: true, fmt: fmtNum, featured: true, about: 'Number of people.', low: 'Fewer', high: 'More' },
  { id: 'regime', label: 'Democracy', group: 'Main', kind: 'categorical', metric: 'regime', featured: true, about: 'How each country is governed, from dictatorship to full democracy.' },
  { id: 'unrest', label: 'Unrest', group: 'Main', kind: 'sequential', metric: 'unrest', fmt: (v) => fmtPct(v), featured: true, about: 'How angry and restless people are. High unrest can lead to protests, coups and revolutions.', low: 'Calm', high: 'Crisis' },
  { id: 'war', label: 'Wars', group: 'Main', kind: 'categorical', metric: 'war', featured: true, about: 'Where people are fighting: wars between countries, civil wars, and smaller armed conflicts (at least 25 battle deaths a year, as counted by UCDP).' },
  { id: 'alliances', label: 'Alliances', group: 'Main', kind: 'categorical', metric: 'bloc', featured: true, about: "Each country's largest military alliance." },
  { id: 'relations', label: 'Friends & rivals', group: 'Main', kind: 'diverging', metric: 'relSel', fmt: (v) => v.toFixed(2), featured: true, needsSelection: true, about: 'How every country feels about the country you selected.', low: 'Hostile', high: 'Friendly' },

  { id: 'gdp', label: 'Size of economy', group: 'Economy', kind: 'sequential', metric: 'gdp', log: true, fmt: fmtUsd, about: 'Total economic output (GDP), in 2023 dollars.', low: 'Smaller', high: 'Larger' },
  { id: 'growth', label: 'Economic growth', group: 'Economy', kind: 'diverging', metric: 'growth', fmt: (v) => fmtPct(v, 1), about: 'How much the economy grew over the last year.', low: 'Shrinking', high: 'Growing' },
  { id: 'unemp', label: 'Unemployment', group: 'Economy', kind: 'sequential', metric: 'unemp', fmt: (v) => `${v.toFixed(1)}%`, about: 'Share of the workforce without a job.', low: 'Few jobless', high: 'Many jobless' },
  { id: 'inflation', label: 'Inflation', group: 'Economy', kind: 'sequential', metric: 'inflation', fmt: (v) => `${v.toFixed(1)}%`, about: 'How fast prices are rising each year.', low: 'Stable prices', high: 'Rising fast' },
  { id: 'debt', label: 'Government debt', group: 'Economy', kind: 'sequential', metric: 'debt', fmt: (v) => fmtPct(v), about: 'Government debt compared with the size of the economy.', low: 'Low', high: 'High' },
  { id: 'trade', label: 'Openness to trade', group: 'Economy', kind: 'sequential', metric: 'trade', log: true, fmt: (v) => `${v.toFixed(0)}%`, about: 'Exports plus imports, compared with the size of the economy.', low: 'Closed', high: 'Open' },
  { id: 'agri', label: 'Farming economy', group: 'Economy', kind: 'sequential', metric: 'agri', fmt: (v) => fmtPct(v), about: 'Share of the economy in agriculture.', low: 'Little farming', high: 'Mostly farming' },
  { id: 'oilExp', label: 'Who gains from oil', group: 'Economy', kind: 'diverging', metric: 'oilExp', fmt: (v) => fmtPct(v, 1), about: 'Whether a higher oil price helps (oil and gas exporters) or hurts (energy importers).', low: 'Hurt', high: 'Helped' },

  { id: 'tfr', label: 'Children per woman', group: 'People', kind: 'sequential', metric: 'tfr', fmt: (v) => v.toFixed(1), about: 'Average number of children a woman has. About 2.1 keeps a population stable.', low: 'Few', high: 'Many' },
  { id: 'lifeExp', label: 'Life expectancy', group: 'People', kind: 'sequential', metric: 'lifeExp', fmt: (v) => `${v.toFixed(0)} years`, about: 'How long a newborn can expect to live.', low: 'Shorter', high: 'Longer' },
  { id: 'old', label: 'Ageing', group: 'People', kind: 'sequential', metric: 'old', fmt: (v) => fmtPct(v), about: 'Share of people aged 65 or older.', low: 'Young', high: 'Old' },
  { id: 'school', label: 'Schooling', group: 'People', kind: 'sequential', metric: 'school', fmt: (v) => `${v.toFixed(1)} years`, about: 'Average years adults (25 and over) spent in school. Starts from UN Human Development Report data.', low: 'Little', high: 'Much' },
  { id: 'eys', label: 'Years in school (children)', group: 'People', kind: 'sequential', metric: 'eys', fmt: (v) => `${v.toFixed(1)} years`, about: 'How many years of school a child starting today can expect. War keeps children out of school.', low: 'Few', high: 'Many' },
  { id: 'learn', label: 'Learning', group: 'People', kind: 'sequential', metric: 'learn', fmt: (v) => v.toFixed(0), about: "What pupils actually learn: international test scores (PISA, TIMSS and regional tests) put on one scale by the World Bank. 625 is the top benchmark, 300 the minimum. Measures schooling quality, not people's innate ability.", low: 'Lower scores', high: 'Higher scores' },
  { id: 'religion', label: 'Religion', group: 'People', kind: 'categorical', metric: 'majorRel', about: 'The largest religious group or denomination.' },
  { id: 'relPolar', label: 'Religious divisions', group: 'People', kind: 'sequential', metric: 'relPolar', fmt: (v) => v.toFixed(2), about: 'How evenly split the population is between religious groups. Deep splits raise the risk of conflict.', low: 'United', high: 'Divided' },
  { id: 'nonrel', label: 'Non-religious', group: 'People', kind: 'sequential', metric: 'nonrel', fmt: (v) => fmtPct(v), about: 'Share of people with no religion.', low: 'Few', high: 'Many' },

  { id: 'democracy', label: 'Democracy score', group: 'Politics', kind: 'sequential', metric: 'demo', fmt: (v) => v.toFixed(2), about: 'How democratic a country is, from 0 (none) to 1 (full). Starts from V-Dem 2023.', low: 'Autocratic', high: 'Democratic' },
  { id: 'approval', label: 'Government approval', group: 'Politics', kind: 'sequential', metric: 'approval', fmt: (v) => fmtPct(v), about: 'How popular the government is. Starts at 50% everywhere (there is no worldwide polling data).', low: 'Unpopular', high: 'Popular' },
  { id: 'coupRisk', label: 'Coup risk', group: 'Politics', kind: 'sequential', metric: 'coupRisk', log: true, fmt: (v) => fmtPct(v, 1), about: 'Chance of a coup attempt in the next year.', low: 'Low', high: 'High' },
  { id: 'ideology', label: 'Left or right', group: 'Politics', kind: 'diverging', metric: 'ideology', fmt: (v) => (v < -0.15 ? 'left' : v > 0.15 ? 'right' : 'centre') + ` (${v.toFixed(2)})`, about: 'Where the governing parties stand, from left to right. Grey: no party government (military or junta rule).', low: 'Left', high: 'Right' },
  { id: 'tradeBlocs', label: 'Unions and blocs', group: 'Politics', kind: 'categorical', metric: 'tradeBloc', about: 'Membership of the European Union, ASEAN, Mercosur, ECOWAS and the African Union. Suspended members are shown separately.' },
  { id: 'government', label: 'Constitution', group: 'Politics', kind: 'categorical', about: 'Form of government written in the constitution (from Wikidata; does not change).' },
  { id: 'sanctioned', label: 'Sanctions', group: 'Politics', kind: 'sequential', metric: 'sanctionLoad', fmt: (v) => fmtPct(v), about: 'How much of the world economy is sanctioning the country.', low: 'None', high: 'Heavy' },

  { id: 'mil', label: 'Military strength', group: 'Military', kind: 'sequential', metric: 'mil', log: true, fmt: fmtUsd, about: 'Accumulated military investment. Grey: no data.', low: 'Weak', high: 'Strong' },
  { id: 'milexShare', label: 'Military spending', group: 'Military', kind: 'sequential', metric: 'milexShare', fmt: (v) => fmtPct(v, 1), about: 'Military spending as a share of the economy. Grey: no data.', low: 'Low', high: 'High' },
];

export const GOV_COLORS: Record<GovForm, string> = {
  parliamentary: '#7fa7cf', presidential: '#8fc49a', semi_presidential: '#9fd0cb', constitutional_monarchy: '#c7aa8e',
  absolute_monarchy: '#c79fc0', one_party: '#e4918a', military: '#eeb07a', theocracy: '#e9d27e',
  republic_other: '#b9dcb1', monarchy_other: '#dcc2d8', unclassified: '#d4d9dd',
};
export const GOV_LABELS: Record<GovForm, string> = {
  parliamentary: 'Parliamentary republic', presidential: 'Presidential republic', semi_presidential: 'Semi-presidential',
  constitutional_monarchy: 'Constitutional monarchy', absolute_monarchy: 'Absolute monarchy', one_party: 'One-party state',
  military: 'Military government', theocracy: 'Theocracy', republic_other: 'Republic (type unclear)',
  monarchy_other: 'Monarchy (type unclear)', unclassified: 'Unclassified',
};

export const REGIME_LABELS = REGIME_WORDS;
const REGIME_COLORS = ['#c0432f', '#e8a079', '#8ab8d9', '#2e6db4'];
export const WAR_LABELS = ['At peace', 'Armed conflict', 'Civil war', 'War with another country'];
const WAR_COLORS = ['#eef1f3', '#f0c48a', '#e07b54', '#a3271f'];

/** Colours per religion, by family hue (Christianity blues, Islam greens, Judaism gold, Buddhism orange…). */
const RELIGION_COLORS: Record<string, string> = {
  Catholic: '#5b8fc7', Protestant: '#93bde6', 'Orthodox Christian': '#8f7fc4', Anglican: '#b7d2ee', 'Other Christian': '#7aa0c9',
  Sunni: '#4fa264', Shia: '#9fd07f', Ibadi: '#2f7a5e', Alawite: '#72bf93', Ahmadiyya: '#bcdca5', 'Nation of Islam': '#4f8f3c', 'Other Muslim': '#68b06d',
  'Orthodox Jewish': '#e2b94a', 'Conservative Jewish': '#ecca70', 'Reform Jewish': '#f3dc94', 'Other Jewish': '#d6aa34',
  Mahayana: '#f0a55a', Theravada: '#f7c48c', 'Other Buddhist': '#e89042', Hindu: '#e27c6e', Sikh: '#f2a69d', Jain: '#cf7f98',
  Shinto: '#d98aa8', Taoist: '#b994b3', Confucian: '#ae8e74', "Baha'i": '#c3bcb7', Zoroastrian: '#d9b5cf', Syncretic: '#cfb0a8',
  'Animist / folk': '#a88b52', 'Other religion': '#a3a8ad', 'Non-religious': '#dfe3e6',
};
const BLOC_COLORS = ['#5b8fc7', '#f0a55a', '#68b06d', '#e27c6e', '#a98ec7', '#e2c25a', '#76b7b2', '#f2a6b7', '#ae8e74', '#9fb4c4', '#9fd07f', '#d98aa8'];
export const NO_DATA = '#e3e7ea';

/** Category label and colour of a country in a categorical map view. */
export function categoryOf(mode: MapMode, owner: number, metrics: Record<string, number[]>, b: Baseline, blocLabels: string[] = []): [string, string] {
  if (mode.id === 'alliances') { const k = metrics.bloc[owner]; return k < 0 ? ['No military alliance', NO_DATA] : [blocLabels[k], BLOC_COLORS[k % BLOC_COLORS.length]]; }
  if (mode.id === 'government') { const g = b.countries[owner].government.form; return [GOV_LABELS[g], GOV_COLORS[g]]; }
  if (mode.id === 'regime') { const r = metrics.regime[owner]; return [REGIME_LABELS[r], REGIME_COLORS[r]]; }
  if (mode.id === 'war') { const w = metrics.war[owner]; return [WAR_LABELS[w], WAR_COLORS[w]]; }
  if (mode.id === 'tradeBlocs') { const k = metrics.tradeBloc[owner]; return k === -1 ? ['Not in a bloc', NO_DATA] : k === -2 ? ['Suspended after a coup', '#e0a37c'] : [b.meta.organisations[k].name, BLOC_COLORS[k % BLOC_COLORS.length]]; }
  const label = b.meta.religions[metrics.majorRel[owner]].label;
  return [label, RELIGION_COLORS[label] ?? '#a3a8ad'];
}

// Light, sea-friendly ramps: pale sand to deep teal; red ↔ pale ↔ blue for two-sided measures.
const SEQ = ['#f4efd9', '#cfe3b4', '#8cc59c', '#4aa29a', '#24767f', '#1b4d63'];
const DIV = ['#c0432f', '#e8a079', '#f3eee6', '#8ab8d9', '#2e6db4'];
function ramp(stops: string[], t: number): string {
  t = Math.min(1, Math.max(0, t));
  const x = t * (stops.length - 1), i = Math.min(stops.length - 2, Math.floor(x)), u = x - i;
  const a = parseInt(stops[i].slice(1), 16), c = parseInt(stops[i + 1].slice(1), 16);
  const ch = (s: number) => Math.round(((a >> s) & 255) * (1 - u) + ((c >> s) & 255) * u);
  return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
}

export interface Scale { color: (v: number) => string; lo: number; hi: number; stops: string[] }

/** Colour scale over the current values (5th-95th percentile so outliers do not flatten the map). */
export function makeScale(mode: MapMode, values: number[]): Scale {
  const tr = (v: number) => (mode.log ? Math.log(Math.max(v, 1e-9)) : v);
  const xs = values.filter((v) => Number.isFinite(v) && (!mode.log || v > 0)).map(tr).sort((a, b) => a - b);
  let lo = xs[Math.floor(xs.length * 0.05)] ?? 0, hi = xs[Math.floor(xs.length * 0.95)] ?? 1;
  if (mode.kind === 'diverging') { const m = Math.max(Math.abs(lo), Math.abs(hi)) || 1; lo = -m; hi = m; }
  if (hi === lo) hi = lo + 1;
  const stops = mode.kind === 'diverging' ? DIV : SEQ;
  return {
    stops, lo: mode.log ? Math.exp(lo) : lo, hi: mode.log ? Math.exp(hi) : hi,
    color: (v) => (!Number.isFinite(v) || (mode.log && v <= 0) ? NO_DATA : ramp(stops, (tr(v) - lo) / (hi - lo))),
  };
}

/** Map colour: from the country's flag (build step); a state born during the run takes its parent's hue turned
 *  far enough to tell them apart; golden-angle pastels where there is no colour. */
export function politicalColor(c: { id: string; colour?: string } | undefined, i: number): string {
  const m = c?.colour && /^#(..)(..)(..)$/.exec(c.colour);
  if (!m) { const h = (i * 137.508) % 360, s = 38 + ((i * 7) % 3) * 8, l = 76 + ((i * 11) % 3) * 4; return `hsl(${h.toFixed(1)} ${s}% ${l}%)`; }
  if (!c!.id.startsWith('NS')) return c!.colour!;
  const [r, g, b] = m.slice(1).map((x) => parseInt(x, 16) / 255), mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn || 1e-9;
  const h = mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return `hsl(${(h * 60 + 50 + ((i * 37) % 80)) % 360} 45% 74%)`;
}
