// Plain-language readings of model values. Thresholds are presentation choices, not model parameters.
export const REGIME_WORDS = ['Dictatorship', 'Rigged democracy', 'Democracy', 'Full democracy'];
export const REGIME_EXPLAIN = [
  'No real elections; power is held by a party, a monarch or the military.',
  'Elections are held, but they are not free or fair.',
  'Free elections, with some weaknesses in rights or checks and balances.',
  'Free elections, strong civil liberties and independent courts.',
];

/** World Bank income groups (2023 thresholds, GNI per capita; applied here to GDP per capita as an approximation). */
export function incomeWord(gdpPc: number): string {
  return gdpPc < 1145 ? 'low-income' : gdpPc < 4515 ? 'lower-middle-income' : gdpPc < 14005 ? 'upper-middle-income' : 'high-income';
}

export function unrestWord(u: number): [string, 'good' | 'warn' | 'bad'] {
  return u < 0.15 ? ['Calm', 'good'] : u < 0.3 ? ['Some tension', 'good'] : u < 0.45 ? ['Tense', 'warn'] : u < 0.6 ? ['Unrest', 'bad'] : ['Crisis', 'bad'];
}
export function approvalWord(a: number): [string, 'good' | 'warn' | 'bad'] {
  return a >= 0.6 ? ['Popular', 'good'] : a >= 0.45 ? ['Mixed', 'warn'] : ['Unpopular', 'bad'];
}
export function relationWord(t: number): [string, 'good' | 'warn' | 'bad'] {
  return t >= 0.7 ? ['Close', 'good'] : t >= 0.3 ? ['Friendly', 'good'] : t >= -0.1 ? ['Neutral', 'warn'] : t >= -0.5 ? ['Cool', 'warn'] : ['Hostile', 'bad'];
}
export function riskWord(p: number): string {
  return p < 0.005 ? 'very low' : p < 0.02 ? 'low' : p < 0.06 ? 'moderate' : p < 0.15 ? 'high' : 'very high';
}

/** Why two countries like or dislike each other, from the trust decomposition (largest effects first). */
export function relationReasons(drivers: Record<string, number>): string {
  const say: Record<string, [string, string]> = {
    foreignPolicy: ['vote alike at the UN', 'vote very differently at the UN'],
    regime: ['similar political systems', 'very different political systems'],
    trade: ['major trading partners', ''],
    alliance: ['allies', ''],
    religion: ['similar religions', 'different religions'],
    grievance: ['', 'history of conflict'],
    sanctions: ['', 'sanctions'],
  };
  return Object.entries(drivers)
    .filter(([k, v]) => Math.abs(v) >= 0.1 && say[k]?.[v > 0 ? 0 : 1] && !(k === 'foreignPolicy' && v > -0.3))
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 2)
    .map(([k, v]) => say[k][v > 0 ? 0 : 1]).join(', ');
}

/** Trend arrow from the last ~5 years of a yearly series. */
export function trend(series: number[] | undefined): '↑' | '↓' | '→' | '' {
  if (!series || series.length < 2) return '';
  const a = series[Math.max(0, series.length - 6)], b = series[series.length - 1];
  const r = a ? b / a - 1 : 0;
  return r > 0.02 ? '↑' : r < -0.02 ? '↓' : '→';
}
