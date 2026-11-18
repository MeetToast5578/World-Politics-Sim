// The world at a glance: a plain summary, two trend charts, the biggest economies and the news.
import type { Frame } from '../worker/protocol';
import type { SimEvent } from '../engine/state';
import { civilFromDays } from '../engine/calendar';
import { LineChart } from './LineChart';
import { WarList } from './WarList';
import { NewsList } from './NewsList';
import type { NewsContext } from '../engine/describe';
import { fmtNum, fmtPct, fmtUsd } from './format';

interface Props { frame: Frame; events: SimEvent[]; name: (c: number) => string; news: NewsContext; weight: (c: number) => number; onSelect: (c: number) => void }

export function WorldPanel({ frame, events, name, news, weight, onSelect }: Props) {
  const w = frame.world, m = frame.metrics, { y } = civilFromDays(frame.day);
  const top = m.gdp.map((_, i) => i).sort((a, b) => m.gdp[b] - m.gdp[a]).slice(0, 6);
  const democracies = m.regime.filter((r) => r >= 2).length;
  const inter = frame.wars.filter((x) => x.kind === 'interstate').length, civil = frame.wars.length - inter;
  const warSentence = frame.wars.length
    ? ` ${inter ? `${inter} war${inter > 1 ? 's' : ''} between countries and ` : ''}${civil} civil conflict${civil === 1 ? ' is' : 's are'} going on.`
    : ' The whole world is at peace.';
  return (
    <div className="panel">
      <h2 className="panel-title">The world in {y}</h2>
      <p className="lede">
        {fmtNum(w.pop)} people produce {fmtUsd(w.gdp)} a year. {democracies} of {m.regime.length} countries are democracies,
        and {fmtPct(w.old)} of people are over 65.{warSentence}
      </p>
      <div className="charts two">
        <LineChart label="People" years={w.years} values={w.popSeries} fmt={fmtNum} />
        <LineChart label="Economy" years={w.years} values={w.gdpSeries} fmt={fmtUsd} />
      </div>
      <h3>Wars and armed conflicts</h3>
      <WarList wars={frame.wars} name={name} onSelect={onSelect} startDay={frame.startDay} limit={6} />
      <h3>Largest economies</h3>
      <ol className="ranking">
        {top.map((c) => (
          <li key={c}><button onClick={() => onSelect(c)}><span>{name(c)}</span><span className="num">{fmtUsd(m.gdp[c])}</span></button></li>
        ))}
      </ol>
      <h3>What's happening</h3>
      <NewsList events={events} name={name} ctx={news} weight={weight} onSelect={onSelect} />
    </div>
  );
}
