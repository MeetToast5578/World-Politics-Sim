// Population pyramid by 5-year age group (single-year cohorts summed), females right, males left.
export function Pyramid({ f, m }: { f: number[]; m: number[] }) {
  const groups = Array.from({ length: 21 }, (_, g) => {
    const sum = (a: number[]) => a.slice(g * 5, g === 20 ? a.length : g * 5 + 5).reduce((s, x) => s + x, 0);
    return { label: g === 20 ? '100+' : `${g * 5}`, f: sum(f), m: sum(m) };
  });
  const max = Math.max(...groups.map((g) => Math.max(g.f, g.m))) || 1;
  const total = [...f, ...m].reduce((s, x) => s + x, 0) || 1;
  const W = 260, rowH = 7, H = groups.length * rowH, mid = W / 2;
  return (
    <div className="chart">
      <div className="chart-head"><span>Population by age</span><b><span className="male">male</span> · <span className="female">female</span></b></div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ height: H }} role="img" aria-label="Population pyramid by five-year age group">
        {groups.map((g, i) => {
          const y = H - (i + 1) * rowH, wm = (g.m / max) * (mid - 18), wf = (g.f / max) * (mid - 18);
          return (
            <g key={g.label}>
              <rect x={mid - 14 - wm} y={y + 0.5} width={wm} height={rowH - 1} fill="var(--male)"><title>{`${g.label}: male ${(100 * g.m / total).toFixed(2)}%`}</title></rect>
              <rect x={mid + 14} y={y + 0.5} width={wf} height={rowH - 1} fill="var(--female)"><title>{`${g.label}: female ${(100 * g.f / total).toFixed(2)}%`}</title></rect>
              {i % 4 === 0 && <text x={mid} y={y + rowH - 0.5} textAnchor="middle" fontSize="6.5" fill="var(--muted)">{g.label}</text>}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
