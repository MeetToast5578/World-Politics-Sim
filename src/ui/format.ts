// Numbers for people: "335 million", "$27.9 trillion", "$82,000".
export function fmtNum(v: number): string {
  if (!Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  if (a >= 1e12) return `${(v / 1e12).toLocaleString('en', { maximumFractionDigits: a >= 1e14 ? 0 : 1 })} trillion`;
  if (a >= 1e9) return `${+(v / 1e9).toFixed(1)} billion`;
  if (a >= 1e6) return `${+(v / 1e6).toFixed(a >= 1e8 ? 0 : 1)} million`;
  if (a >= 1e4) return Math.round(v).toLocaleString('en');
  if (a >= 100) return v.toFixed(0);
  return +v.toFixed(1) + '';
}
export const fmtPct = (v: number, d = 0) => (Number.isFinite(v) ? `${(v * 100).toFixed(d)}%` : '—');
export const fmtUsd = (v: number) => (Number.isFinite(v) ? `$${fmtNum(v)}` : '—');
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const monthName = (m: number) => MONTHS[m - 1];
