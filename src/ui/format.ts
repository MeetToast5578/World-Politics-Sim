export function fmtNum(v: number, unit = ''): string {
  if (!Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  const s = a >= 1e15 ? v.toExponential(2) : a >= 1e12 ? `${(v / 1e12).toFixed(2)} tn` : a >= 1e9 ? `${(v / 1e9).toFixed(2)} bn` : a >= 1e6 ? `${(v / 1e6).toFixed(1)} m` : a >= 1e4 ? `${(v / 1e3).toFixed(0)}k` : a >= 100 ? v.toFixed(0) : v.toFixed(2);
  return unit ? `${s} ${unit}` : s;
}
export const fmtPct = (v: number, d = 1) => (Number.isFinite(v) ? `${(v * 100).toFixed(d)}%` : '—');
export const fmtUsd = (v: number) => (Number.isFinite(v) ? `$${fmtNum(v)}` : '—');
