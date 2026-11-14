// Wars and armed conflicts under way, in plain words: who is fighting, since when, how deadly, who is winning.
import type { WarInfo } from '../worker/protocol';
import { civilFromDays } from '../engine/calendar';
import { fmtPct } from './format';

const deaths = (v: number) => (v >= 1e4 ? `${Math.round(v / 1e3).toLocaleString('en')},000` : v >= 1000 ? (Math.round(v / 100) * 100).toLocaleString('en') : v >= 50 ? `${Math.round(v / 10) * 10}` : 'fewer than 50');
const list = (cs: number[], name: (c: number) => string) => cs.map(name).join(', ');

export function warTitle(w: WarInfo, name: (c: number) => string): string {
  if (w.kind === 'interstate') return `${list(w.a, name)} against ${list(w.b, name)}`;
  return `${w.rate >= 1000 ? 'Civil war' : 'Armed conflict'} in ${name(w.loc)}${w.name ? ` (${w.name})` : ''}`;
}

function situation(w: WarInfo, name: (c: number) => string): string {
  const parts: string[] = [];
  if (w.kind === 'interstate') {
    parts.push(w.score > 0.3 ? `${name(w.a[0])} is gaining ground.` : w.score < -0.3 ? `${name(w.loc)} is pushing back.` : 'Neither side is winning.');
    if (w.occ >= 0.01) parts.push(`${name(w.a[0])} holds ${fmtPct(w.occ)} of ${name(w.loc)}.`);
  } else {
    parts.push(w.score > 0.3 ? 'The government has the upper hand.' : w.score < -0.3 ? 'The rebels have the upper hand.' : 'Neither side is winning.');
    if (w.a.length > 1) parts.push(`Foreign forces helping the government: ${list(w.a.slice(1), name)}.`);
    if (w.b.length) parts.push(`Rebels backed by ${list(w.b, name)}.`);
  }
  return parts.join(' ');
}

interface Props { wars: WarInfo[]; name: (c: number) => string; onSelect?: (c: number) => void; limit?: number; startDay: number }

export function WarList({ wars, name, onSelect, limit = 8, startDay }: Props) {
  if (!wars.length) return <p className="plain">No wars or armed conflicts are going on.</p>;
  const sorted = [...wars].sort((x, y) => y.rate - x.rate), shown = sorted.slice(0, limit), y0 = civilFromDays(startDay).y;
  return (
    <>
      <ul className="wars">
        {shown.map((w) => (
          <li key={w.id} className={w.kind === 'interstate' ? 'interstate' : w.rate >= 1000 ? 'civil' : 'minor'}>
            <button onClick={() => onSelect?.(w.loc)}>
              <b>{warTitle(w, name)}</b>
              <span>Since {civilFromDays(w.start).y}. About {deaths(w.rate)} battle deaths a year now{w.deaths >= 50 ? `, ${deaths(w.deaths)} since ${y0}` : ''}.</span>
              <span className="fine">{situation(w, name)}</span>
            </button>
          </li>
        ))}
      </ul>
      {sorted.length > shown.length && <p className="fine">And {sorted.length - shown.length} smaller conflict{sorted.length - shown.length === 1 ? '' : 's'}. Choose the “Wars” map to see them all.</p>}
    </>
  );
}
