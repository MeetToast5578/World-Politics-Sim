// Small yearly trend chart. The first point is the 2023 data; later points are simulated.
interface Props { years: number[]; values: number[]; fmt: (v: number) => string; label: string; height?: number }

export function LineChart({ years, values, fmt, label, height = 56 }: Props) {
  const W = 260, H = height, pad = 3;
  const pts = values.map((v, i) => [years[i], v] as const).filter(([, v]) => Number.isFinite(v));
  const last = pts.length ? pts[pts.length - 1][1] : NaN;
  if (pts.length < 2) {
    return <figure className="chart"><figcaption><span>{label}</span><b>{fmt(last)}</b></figcaption><div className="chart-empty">History appears as time passes</div></figure>;
  }
  const x0 = pts[0][0], x1 = pts[pts.length - 1][0];
  let lo = Math.min(...pts.map((p) => p[1])), hi = Math.max(...pts.map((p) => p[1]));
  if (hi - lo < 1e-12) { hi += Math.abs(hi) * 0.05 + 1e-9; lo -= Math.abs(lo) * 0.05 + 1e-9; }
  const sx = (x: number) => pad + ((x - x0) / (x1 - x0 || 1)) * (W - 2 * pad);
  const sy = (y: number) => H - pad - ((y - lo) / (hi - lo)) * (H - 2 * pad);
  const d = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${sx(x).toFixed(1)},${sy(y).toFixed(1)}`).join('');
  return (
    <figure className="chart">
      <figcaption><span>{label}</span><b>{fmt(last)}</b></figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`${label}: ${fmt(pts[0][1])} in ${x0}, ${fmt(last)} in ${x1}`}>
        <path d={`${d}L${sx(x1).toFixed(1)},${H}L${sx(x0).toFixed(1)},${H}Z`} fill="var(--chart-fill)" />
        <path d={d} fill="none" stroke="var(--accent)" strokeWidth="1.8" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="chart-axis"><span>{x0}</span><span>{x1}</span></div>
    </figure>
  );
}
