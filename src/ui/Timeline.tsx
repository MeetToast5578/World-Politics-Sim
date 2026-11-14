// The history strip: the current date, a bar of the years simulated so far with marks where big things happened,
// and click (or arrow keys) to go back to any earlier year.
import { useMemo, useState, type KeyboardEvent, type MouseEvent } from 'react';
import type { SimEvent } from '../engine/state';
import { civilFromDays, daysFromCivil } from '../engine/calendar';
import { IMPORTANCE } from '../engine/describe';
import { monthName } from './format';

interface Props {
  startDay: number;
  day: number;
  events: SimEvent[];
  branches: { day: number }[];
  busy: boolean;
  /** population of a country: only dramatic news from countries of 20 million or more makes a mark */
  weight: (c: number) => number;
  onRewind: (day: number) => void;
}

export function Timeline({ startDay, day, events, branches, busy, weight, onRewind }: Props) {
  const y0 = civilFromDays(startDay).y, now = civilFromDays(day);
  const span = Math.max(day - startDay, 3652); // the bar shows at least ten years so early marks are not crushed
  const pos = (d: number) => ((d - startDay) / span) * 100;
  const [hoverYear, setHoverYear] = useState<number | null>(null);

  // the most eventful years: world-changing news weighted by the size of the countries involved; only the top 15%
  // of years get a mark, so the bar shows where history turned rather than a mark every year
  const marks = useMemo(() => {
    const byYear = new Map<number, number>();
    for (const e of events) {
      if ((IMPORTANCE[e.k] ?? 1) < 3) continue;
      const size = Math.max(e.c >= 0 ? weight(e.c) : 1e9, e.o !== undefined && e.o >= 0 ? weight(e.o) : 0);
      if (size < 2e7) continue;
      const yr = civilFromDays(e.d).y;
      byYear.set(yr, (byYear.get(yr) ?? 0) + Math.log10(size / 1e6));
    }
    const scores = [...byYear.values()].sort((a, b) => a - b), max = scores[scores.length - 1] ?? 1;
    const cut = scores.length > 6 ? scores[Math.floor(scores.length * 0.85)] : 0;
    return [...byYear].filter(([, v]) => v >= cut).map(([yr, v]) => ({ yr, h: 0.35 + 0.65 * (v / max) }));
  }, [events, weight]);

  const yearAt = (e: MouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const d = startDay + ((e.clientX - r.left) / r.width) * span;
    return civilFromDays(Math.round(d)).y;
  };
  const goTo = (yr: number) => {
    const d = Math.max(startDay, daysFromCivil(yr, 1, 1));
    if (d < day && !busy) onRewind(d);
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowLeft' || e.key === 'PageDown') { e.preventDefault(); goTo(now.y - (e.key === 'PageDown' ? 10 : (now.m === 1 && now.d === 1 ? 1 : 0))); }
    if (e.key === 'Home') { e.preventDefault(); goTo(y0); }
  };

  const ticks: number[] = [];
  const yrsShown = span / 365.25, step = yrsShown > 120 ? 50 : yrsShown > 60 ? 20 : yrsShown > 25 ? 10 : 5;
  for (let yr = Math.ceil(y0 / step) * step; daysFromCivil(yr, 1, 1) <= startDay + span; yr += step) if (pos(daysFromCivil(yr, 1, 1)) > 9) ticks.push(yr); // keep clear of the start label

  return (
    <footer className="timeline">
      <div className="now" aria-live="off">
        <span className="year">{now.y}</span>
        <span className="month">{monthName(now.m)}</span>
      </div>
      <div className="strip">
        <div
          className="track"
          role="slider"
          tabIndex={0}
          aria-label="History so far. Choose an earlier year to go back to it."
          aria-valuemin={y0} aria-valuemax={now.y} aria-valuenow={now.y} aria-valuetext={`${monthName(now.m)} ${now.y}`}
          onPointerMove={(e) => { const yr = yearAt(e); setHoverYear(yr < now.y || (yr === now.y && day > daysFromCivil(yr, 1, 1)) ? yr : null); }}
          onPointerLeave={() => setHoverYear(null)}
          onClick={(e) => goTo(yearAt(e))}
          onKeyDown={onKey}
        >
          <div className="past" style={{ width: `${pos(day)}%` }} />
          {marks.map((m) => <i key={m.yr} className="mark" style={{ left: `${pos(daysFromCivil(m.yr, 7, 1))}%`, height: `${m.h * 100}%` }} />)}
          {branches.map((b) => <b key={b.day} className="branch" style={{ left: `${pos(b.day)}%` }} title="The dice were rolled again here" />)}
          <div className="head" style={{ left: `${pos(day)}%` }} />
          {hoverYear !== null && (() => { const x = pos(daysFromCivil(hoverYear, 1, 1)); return <div className="hover-year" style={{ left: `${x}%`, transform: `translateX(${x > 85 ? -100 : x < 10 ? 0 : -50}%)` }}>Go back to {hoverYear}</div>; })()}
        </div>
        <div className="ticks" aria-hidden="true">
          <span style={{ left: 0 }}>{y0}</span>
          {ticks.map((t) => <span key={t} style={{ left: `${pos(daysFromCivil(t, 1, 1))}%` }}>{t}</span>)}
        </div>
      </div>
      <p className="hint">{busy ? 'Going back in time…' : day > startDay ? 'Click the bar to go back to an earlier year. Marks show years with dramatic news from large countries.' : 'The simulation starts from real 2023 data.'}</p>
    </footer>
  );
}
