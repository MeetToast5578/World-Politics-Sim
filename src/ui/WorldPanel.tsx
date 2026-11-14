import type { Frame } from '../worker/protocol';
import { LineChart } from './LineChart';
import { fmtNum, fmtPct, fmtUsd } from './format';

export function WorldPanel({ frame, name, onSelect }: { frame: Frame; name: (c: number) => string; onSelect: (c: number) => void }) {
  const w = frame.world, m = frame.metrics;
  const top = m.gdp.map((_, i) => i).sort((a, b) => m.gdp[b] - m.gdp[a]).slice(0, 15);
  return (
    <div className="panel">
      <div className="panel-head"><div><h2>World</h2><div className="sub">Click a country on the map to inspect it</div></div></div>
      <section className="kpis">
        <div><span>Population</span><b>{fmtNum(w.pop)}</b></div>
        <div><span>GDP (2023 USD)</span><b>{fmtUsd(w.gdp)}</b></div>
        <div><span>Aged 65+</span><b>{fmtPct(w.old)}</b></div>
        <div><span>Events</span><b>{w.events}</b></div>
      </section>
      <section className="charts">
        <LineChart label="World population" years={w.years} values={w.popSeries} fmt={(v) => fmtNum(v)} />
        <LineChart label="World GDP" years={w.years} values={w.gdpSeries} fmt={fmtUsd} />
      </section>
      <section>
        <h3>Largest economies</h3>
        <table className="stats clickable">
          <thead><tr><th>#</th><th>Country</th><th>GDP</th><th>per capita</th><th>growth</th></tr></thead>
          <tbody>
            {top.map((c, i) => (
              <tr key={c} onClick={() => onSelect(c)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onSelect(c)}>
                <td>{i + 1}</td><td>{name(c)}</td><td>{fmtUsd(m.gdp[c])}</td><td>{fmtUsd(m.gdpPc[c])}</td><td>{fmtPct(m.growth[c])}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
