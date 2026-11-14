// Minimal SVG line chart for yearly series. The first point is the data baseline; later points are simulated.
interface Props { years: number[]; values: number[]; fmt: (v: number) => string; label: string; height?: number }

export function LineChart({ years, values, fmt, label, height = 64 }: Props) {
  const W = 260, H = height, pad = 2;
  const pts = values.map((v, i) => [years[i], v] as const).filter(([, v]) => Number.isFinite(v));
  if (pts.length < 2) {
    return <div className="chart"><div className="chart-head"><span>{label}</span><b>{pts.length ? fmt(pts[0][1]) : '—'}</b></div><div className="chart-empty">Run the simulation to build history</div></div>;
  }
  const x0 = pts[0][0], x1 = pts[pts.length - 1][0];
  let lo = Math.min(...pts.map((p) => p[1])), hi = Math.max(...pts.map((p) => p[1]));
  if (hi - lo < 1e-12) { hi += Math.abs(hi) * 0.05 + 1e-9; lo -= Math.abs(lo) * 0.05 + 1e-9; }
  const sx = (x: number) => pad + ((x - x0) / (x1 - x0 || 1)) * (W - 2 * pad);
  const sy = (y: number) => H - pad - ((y - lo) / (hi - lo)) * (H - 2 * pad);
  const d = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${sx(x).toFixed(1)},${sy(y).toFixed(1)}`).join('');
  const last = pts[pts.length - 1][1];
  return (
    <div className="chart">
      <div className="chart-head"><span>{label}</span><b>{fmt(last)}</b></div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`${label}: ${fmt(pts[0][1])} in ${x0} to ${fmt(last)} in ${x1}`}>
        <path d={d} fill="none" stroke="var(--accent)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="chart-axis"><span>{x0}</span><span>{fmt(lo)} – {fmt(hi)}</span><span>{x1}</span></div>
    </div>
  );
}
