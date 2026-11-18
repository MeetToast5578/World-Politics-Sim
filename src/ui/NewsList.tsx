// News: plain headlines, newest first. Click one to read why it happened (and jump to the country).
import { useMemo, useState } from 'react';
import type { SimEvent } from '../engine/state';
import { describeEvent, IMPORTANCE } from '../engine/describe';
import { civilFromDays } from '../engine/calendar';
import { monthName } from './format';

interface Props {
  events: SimEvent[];
  name: (c: number) => string;
  /** population of a country, to rank news from big countries higher */
  weight: (c: number) => number;
  onSelect?: (c: number) => void;
  /** only news involving this country */
  country?: number;
  limit?: number;
}

/** Major news: world-changing events anywhere, important events in sizeable countries. */
export function isMajor(e: SimEvent, weight: (c: number) => number): boolean {
  const imp = IMPORTANCE[e.k] ?? 1;
  const size = Math.max(e.c >= 0 ? weight(e.c) : 1e9, e.o !== undefined && e.o >= 0 ? weight(e.o) : 0);
  return imp >= 3 || (imp === 2 && size >= 15e6) || (imp === 1 && size >= 150e6);
}

export function NewsList({ events, name, weight, onSelect, country, limit = 60 }: Props) {
  const [all, setAll] = useState(country !== undefined);
  const [open, setOpen] = useState<string | null>(null);
  const shown = useMemo(() => {
    const out: SimEvent[] = [];
    for (let i = events.length - 1; i >= 0 && out.length < limit; i--) {
      const e = events[i];
      if (country !== undefined && e.c !== country && e.o !== country) continue;
      if (!all && !isMajor(e, weight)) continue;
      out.push(e);
    }
    return out;
  }, [events, all, weight, country, limit]);

  return (
    <div className="news">
      {country === undefined && (
        <div className="news-filter" role="radiogroup" aria-label="Which news to show">
          <button role="radio" aria-checked={!all} className={!all ? 'on' : ''} onClick={() => setAll(false)}>Major news</button>
          <button role="radio" aria-checked={all} className={all ? 'on' : ''} onClick={() => setAll(true)}>Everything</button>
        </div>
      )}
      {shown.length === 0 && <p className="empty">{country === undefined ? 'Nothing has happened yet. Press Play to start history.' : 'No news from here yet.'}</p>}
      <ol className="news-list">
        {shown.map((e, i) => {
          const key = `${e.d}-${e.k}-${e.c}-${e.o ?? ''}-${i}`, story = describeEvent(e, name), { y, m } = civilFromDays(e.d);
          const isOpen = open === key;
          return (
            <li key={key} className={`imp${IMPORTANCE[e.k] ?? 1}`}>
              <button className="story" aria-expanded={isOpen} onClick={() => { setOpen(isOpen ? null : key); if (e.c >= 0) onSelect?.(e.c); }}>
                <time>{monthName(m).slice(0, 3)} {y}</time>
                <span>{story.headline}</span>
              </button>
              {isOpen && story.why && <p className="why">{story.why}</p>}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
