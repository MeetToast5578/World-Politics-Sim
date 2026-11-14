// Global news feed: chronicle events filtered by kind and by the size of the country involved.
import { useMemo, useState } from 'react';
import type { SimEvent } from '../engine/state';
import { describeEvent } from '../engine/describe';
import { formatDate } from '../engine/calendar';

const KINDS: Record<string, string> = {
  gdp_rank_up: 'Economic rankings', sovereign_default: 'Sovereign defaults', recession_start: 'Recessions', recession_end: 'Recoveries',
  pop_peak: 'Population peaks', pop_above: 'Population milestones', pop_below: 'Population milestones', debt_above: 'Debt thresholds',
};

interface Props { events: SimEvent[]; name: (c: number) => string; weight: (c: number) => number; onSelect: (c: number) => void }

export function EventFeed({ events, name, weight, onSelect }: Props) {
  const [minPop, setMinPop] = useState(20e6);
  const [off, setOff] = useState<Set<string>>(new Set(['recession_end', 'debt_above']));
  const shown = useMemo(() => {
    const out: SimEvent[] = [];
    for (let i = events.length - 1; i >= 0 && out.length < 150; i--) {
      const e = events[i];
      if (off.has(e.k)) continue;
      if (e.k !== 'gdp_rank_up' && weight(e.c) < minPop) continue;
      out.push(e);
    }
    return out;
  }, [events, off, minPop, weight]);
  const groups = [...new Set(Object.values(KINDS))];
  const toggle = (g: string) => {
    const ks = Object.keys(KINDS).filter((k) => KINDS[k] === g);
    const s = new Set(off);
    const allOff = ks.every((k) => s.has(k));
    ks.forEach((k) => (allOff ? s.delete(k) : s.add(k)));
    setOff(s);
  };
  return (
    <div className="feed">
      <div className="feed-head">
        <h3>News feed</h3>
        <label>Countries over&nbsp;
          <select value={minPop} onChange={(e) => setMinPop(+e.target.value)}>
            <option value={0}>any size</option><option value={5e6}>5 m</option><option value={20e6}>20 m</option><option value={100e6}>100 m</option>
          </select>
        </label>
      </div>
      <div className="chips">
        {groups.map((g) => {
          const on = Object.keys(KINDS).some((k) => KINDS[k] === g && !off.has(k));
          return <button key={g} className={`chip ${on ? 'on' : ''}`} aria-pressed={on} onClick={() => toggle(g)}>{g}</button>;
        })}
      </div>
      <ul className="events">
        {shown.length === 0 && <li className="muted">Nothing yet. Press play.</li>}
        {shown.map((e, i) => (
          <li key={`${e.d}-${e.k}-${e.c}-${i}`} onClick={() => onSelect(e.c)}>
            <time>{formatDate(e.d)}</time> {describeEvent(e, name)}
          </li>
        ))}
      </ul>
    </div>
  );
}
