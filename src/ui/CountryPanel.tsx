// One country, explained in plain language. Tabs keep each view short; the Data tab keeps every number and source.
import { useState } from 'react';
import type { Baseline, Obs } from '../engine/types';
import type { CountryDetail } from '../worker/protocol';
import type { SimEvent } from '../engine/state';
import { formatDate } from '../engine/calendar';
import { LineChart } from './LineChart';
import { Pyramid } from './Pyramid';
import { NewsList } from './NewsList';
import { WarList } from './WarList';
import type { WarInfo } from '../worker/protocol';
import { fmtNum, fmtPct, fmtUsd } from './format';
import { GOV_LABELS } from './mapModes';
import { REGIME_WORDS, REGIME_EXPLAIN, incomeWord, unrestWord, approvalWord, relationWord, relationReasons, riskWord, trend } from './words';

interface Props {
  baseline: Baseline;
  detail: CountryDetail;
  events: SimEvent[];
  name: (c: number) => string;
  weight: (c: number) => number;
  coupRisk: number;
  wars: WarInfo[];
  startDay: number;
  onSelect: (c: number) => void;
  onClose: () => void;
}

const TABS = ['Overview', 'People', 'Economy', 'Politics', 'Relations', 'Data'] as const;
type Tab = (typeof TABS)[number];

function Stat({ label, value, note, tone, arrow }: { label: string; value: string; note?: string; tone?: 'good' | 'warn' | 'bad'; arrow?: string }) {
  return (
    <div className={`stat ${tone ?? ''}`}>
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}{arrow ? <span className="arrow" aria-label={arrow === '↑' ? 'rising' : arrow === '↓' ? 'falling' : 'steady'}> {arrow}</span> : null}</span>
      {note && <span className="stat-note">{note}</span>}
    </div>
  );
}

function Src({ o, b }: { o?: Obs; b: Baseline }) {
  if (!o) return <span className="src missing">no data</span>;
  const s = b.meta.sources[o.s];
  return <span className={`src ${o.s === 'IMPUTED' ? 'imputed' : ''}`} title={`${s?.name ?? o.s} (${s?.license ?? ''})`}>{o.s === 'IMPUTED' ? 'estimated' : o.s} {o.y}</span>;
}

export function CountryPanel({ baseline: b, detail, events, name, weight, coupRisk, wars: allWars, startDay, onSelect, onClose }: Props) {
  const [tab, setTab] = useState<Tab>('Overview');
  const bc = b.countries[detail.c], f = detail.fields, bf = bc.fields, h = detail.history.series, years = detail.history.years;
  const P = f.p0 + f.p1 + f.p2, gdpPc = f.gdp / P;
  const growth = h.gdp.length >= 2 ? h.gdp[h.gdp.length - 1] / h.gdp[h.gdp.length - 2] - 1 : NaN;
  const [unrest, unrestTone] = unrestWord(f.unrest), [appr, apprTone] = approvalWord(f.approval);
  const wars = allWars.filter((w) => w.loc === detail.c || w.a.includes(detail.c) || w.b.includes(detail.c));
  const treaties = [...detail.diplomacy.treaties].sort((x, y) => y.members - x.members);
  const summary = `${a(incomeWord(gdpPc))} ${incomeWord(gdpPc)} ${REGIME_WORDS[f.regime].toLowerCase()} of ${fmtNum(P)} people.`
    + ` ${treaties.length ? `Member of ${treaties.length > 2 ? `${treaties.slice(0, 2).map((t) => t.label).join(', ')} and ${treaties.length - 2} other alliance${treaties.length > 3 ? 's' : ''}` : treaties.map((t) => t.label).join(' and ')}.` : 'Not in any military alliance.'}`
    + `${f.sanctionLoad > 0.05 || f.unSanction > 0 ? ' Under international sanctions.' : ''}`
    + wars.map((w) => (w.kind === 'civil' ? (w.loc === detail.c ? ` ${w.rate >= 1000 ? 'Torn by civil war' : 'Fighting an armed rebellion'}.` : ` Has troops in ${name(w.loc)}.`)
      : ` At war with ${(w.a.includes(detail.c) ? w.b : w.a).map(name).join(' and ')}.`)).join('');

  return (
    <div className="panel country">
      <header className="country-head">
        <div>
          <h2>{bc.name}</h2>
          <p className="lede">{summary}</p>
        </div>
        <button className="close" onClick={onClose} aria-label="Back to the world view">✕</button>
      </header>

      <div className="tabs" role="tablist" aria-label="Country details">
        {TABS.map((t) => <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>{t}</button>)}
      </div>

      {tab === 'Overview' && (
        <div role="tabpanel">
          {wars.length > 0 && <div className="callout war"><WarList wars={wars} name={name} onSelect={onSelect} startDay={startDay} /></div>}
          <div className="stats">
            <Stat label="People" value={fmtNum(P)} arrow={trend(h.pop)} />
            <Stat label="Income per person" value={fmtUsd(gdpPc)} arrow={trend(h.gdpPc)} note={incomeWord(gdpPc)} />
            <Stat label="Government" value={REGIME_WORDS[f.regime]} note={`democracy score ${f.demo.toFixed(2)}`} />
            <Stat label="Mood of the country" value={unrest} tone={unrestTone} note={`government is ${appr.toLowerCase()}`} />
          </div>
          <div className="charts two">
            <LineChart label="People" years={years} values={h.pop} fmt={fmtNum} />
            <LineChart label="Income per person" years={years} values={h.gdpPc} fmt={fmtUsd} />
          </div>
          <h3>News from {bc.name}</h3>
          <NewsList events={events} name={name} weight={weight} onSelect={onSelect} country={detail.c} limit={12} />
        </div>
      )}

      {tab === 'People' && (
        <div role="tabpanel">
          <div className="stats">
            <Stat label="Children per woman" value={f.tfr.toFixed(1)} arrow={trend(h.tfr)} note={f.tfr < 2.1 ? 'not enough to replace each generation' : 'population growing'} />
            <Stat label="Life expectancy" value={`${f.lifeExp.toFixed(0)} years`} note={`women ${f.e0F.toFixed(0)}, men ${f.e0M.toFixed(0)}`} />
            <Stat label="Over 65" value={fmtPct(f.p2 / P)} arrow={trend(h.old)} />
            <Stat label="Migration last year" value={`${f.netMig >= 0 ? '+' : '−'}${fmtNum(Math.abs(f.netMig))}`} note={f.netMig >= 0 ? 'more arriving than leaving' : 'more leaving than arriving'} />
          </div>
          <Pyramid f={detail.pyramid.f} m={detail.pyramid.m} />
          <h3>Religion</h3>
          <ul className="bars">
            {detail.religion.map((s, i) => [s, i] as const).filter(([s]) => s >= 0.01).sort((x, y) => y[0] - x[0]).slice(0, 8).map(([s, i]) => (
              <li key={i}><span>{b.meta.religions[i].label}{b.meta.religions[i].family !== b.meta.religions[i].label && b.meta.religions[i].family !== 'None' ? <em> {b.meta.religions[i].family}</em> : null}</span><i style={{ width: `${Math.max(1, s * 100)}%` }} /><b>{fmtPct(s)}</b></li>
            ))}
          </ul>
          <p className="fine">Religious divisions: {f.relPolar < 0.3 ? 'low' : f.relPolar < 0.6 ? 'moderate' : 'deep'}. Data: World Religion Project {bc.religion?.y ?? ''}, changed since by the simulation.</p>
        </div>
      )}

      {tab === 'Economy' && (
        <div role="tabpanel">
          <div className="stats">
            <Stat label="Size of economy" value={fmtUsd(f.gdp)} arrow={trend(h.gdp)} />
            <Stat label="Growth last year" value={fmtPct(growth, 1)} tone={growth < 0 ? 'bad' : growth > 0.02 ? 'good' : 'warn'} />
            <Stat label="Unemployment" value={`${f.unemp.toFixed(1)}%`} tone={f.unemp > 12 ? 'bad' : f.unemp > 7 ? 'warn' : 'good'} />
            <Stat label="Inflation" value={`${f.inflation.toFixed(1)}%`} tone={f.inflation > 15 ? 'bad' : f.inflation > 6 ? 'warn' : 'good'} />
            <Stat label="Government debt" value={fmtPct(f.debt / f.gdp)} note="of the economy" tone={f.debt / f.gdp > 1.2 ? 'bad' : f.debt / f.gdp > 0.8 ? 'warn' : undefined} />
            <Stat label="Trade" value={`${f.tradeShare.toFixed(0)}%`} note="exports + imports, of the economy" />
          </div>
          <div className="sectors" aria-label="What the economy is made of">
            <i style={{ flex: f.agriShare }} className="agri" title="Farming" /><i style={{ flex: f.indShare }} className="ind" title="Industry" /><i style={{ flex: Math.max(0, 1 - f.agriShare - f.indShare) }} className="serv" title="Services" />
          </div>
          <p className="fine">Farming {fmtPct(f.agriShare)}, industry {fmtPct(f.indShare)}, services {fmtPct(1 - f.agriShare - f.indShare)}.
            {f.oilExp > 0.03 ? ' A big oil and gas exporter: high oil prices help.' : f.oilExp < -0.02 ? ' Imports most of its energy: high oil prices hurt.' : ''}</p>
          <div className="charts two">
            <LineChart label="Income per person" years={years} values={h.gdpPc} fmt={fmtUsd} />
            <LineChart label="Government debt" years={years} values={h.debtRatio} fmt={(v) => fmtPct(v)} />
          </div>
        </div>
      )}

      {tab === 'Politics' && (
        <div role="tabpanel">
          <div className="callout">
            <b>{REGIME_WORDS[f.regime]}</b>
            <p>{REGIME_EXPLAIN[f.regime]}</p>
          </div>
          <div className="stats">
            <Stat label="Government approval" value={fmtPct(f.approval)} note={appr} tone={apprTone} />
            <Stat label="Unrest" value={unrest} tone={unrestTone} note={`${fmtPct(f.unrest)} (it started at ${fmtPct(f.unrest0)})`} />
            <Stat label="Legitimacy of the system" value={fmtPct(f.legit)} note="how much people accept how they are ruled" />
            <Stat label="Coup risk" value={riskWord(coupRisk)} note={`${fmtPct(coupRisk, 1)} chance this year`} tone={coupRisk > 0.06 ? 'bad' : coupRisk > 0.02 ? 'warn' : 'good'} />
          </div>
          <p className="plain">
            The current government has been in power for {f.govYears < 1 ? 'less than a year' : `${Math.floor(f.govYears)} year${Math.floor(f.govYears) === 1 ? '' : 's'}`}
            {f.govTerms > 0 ? ` and has been re-elected ${f.govTerms} time${f.govTerms > 1 ? 's' : ''}` : ''}.
            {f.regime >= 1 && f.nextElection >= 0 ? ` Next election: ${formatDate(f.nextElection).slice(0, 7)}.` : ' No elections are scheduled.'}
          </p>
          <p className="fine">Constitution: {GOV_LABELS[bc.government.form]}. Whether the government leans left or right is not known from data, so the simulation guessed it ({f.ideology > 0.2 ? 'right' : f.ideology < -0.2 ? 'left' : 'centre'}).</p>
        </div>
      )}

      {tab === 'Relations' && (
        <div role="tabpanel">
          <h3>Alliances</h3>
          {treaties.length ? <ul className="plain-list">{treaties.map((t) => <li key={t.label}>{t.label}{t.members > 2 && <span className="fine"> ({t.members} members)</span>}</li>)}</ul> : <p className="plain">Not in any military alliance.</p>}
          <h3>Sanctions</h3>
          <p className="plain">
            {listPhrase('Sanctioned by', [...(f.unSanction > 0 ? ['the UN Security Council'] : []), ...detail.diplomacy.relations.filter((r) => r.sanctionsOn > 0).map((r) => name(r.c))])}
            {' '}{listPhrase('Sanctions', detail.diplomacy.relations.filter((r) => r.sanctionsBy > 0).map((r) => name(r.c)))}
          </p>
          <h3>Closest friends</h3>
          <RelList rows={detail.diplomacy.relations.slice(0, 5)} name={name} onSelect={onSelect} />
          <h3>Biggest rivals</h3>
          <RelList rows={detail.diplomacy.relations.slice(-5).reverse()} name={name} onSelect={onSelect} />
          <p className="fine">Tip: choose the “Friends &amp; rivals” map to see how every country feels about {bc.name}.</p>
        </div>
      )}

      {tab === 'Data' && <DataTab b={b} detail={detail} />}
    </div>
  );
}

const a = (word: string) => (/^[aeiou]/i.test(word) ? 'An' : 'A');

function listPhrase(lead: string, names: string[]): string {
  if (!names.length) return lead === 'Sanctioned by' ? 'Not under sanctions.' : 'Imposes no sanctions.';
  return `${lead} ${names.slice(0, 5).join(', ')}${names.length > 5 ? ` and ${names.length - 5} others` : ''}.`;
}

function RelList({ rows, name, onSelect }: { rows: CountryDetail['diplomacy']['relations']; name: (c: number) => string; onSelect: (c: number) => void }) {
  return (
    <ul className="rel-list">
      {rows.map((r) => {
        const [word, tone] = relationWord(r.trust), why = relationReasons(r.drivers);
        return (
          <li key={r.c}>
            <button onClick={() => onSelect(r.c)}><b>{name(r.c)}</b><span className={`pill ${tone}`}>{word}</span></button>
            {why && <span className="fine">{why}</span>}
          </li>
        );
      })}
    </ul>
  );
}

/** Every number with its source, then the raw model state: for people who want to check the simulation. */
function DataTab({ b, detail }: { b: Baseline; detail: CountryDetail }) {
  const bc = b.countries[detail.c], f = detail.fields, bf = bc.fields, P = f.p0 + f.p1 + f.p2;
  const rows: [string, string, string, string | undefined][] = [
    ['Population', fmtNum(P), fmtNum(bf.pop?.v ?? NaN), 'pop'],
    ['Children per woman', f.tfr.toFixed(2), fmtNum(bf.tfr?.v ?? NaN), 'tfr'],
    ['Life expectancy (women / men)', `${f.e0F.toFixed(1)} / ${f.e0M.toFixed(1)}`, `${fmtNum(bf.lifeExpF?.v ?? NaN)} / ${fmtNum(bf.lifeExpM?.v ?? NaN)}`, 'lifeExpF'],
    ['Child deaths before 5, per 1,000', `${(f.u5F * 1000).toFixed(0)} / ${(f.u5M * 1000).toFixed(0)}`, `${fmtNum(bf.u5mrF?.v ?? NaN)} / ${fmtNum(bf.u5mrM?.v ?? NaN)}`, 'u5mrF'],
    ['GDP (2023 dollars)', fmtUsd(f.gdp), fmtUsd(bf.gdp?.v ?? NaN), 'gdp'],
    ['GDP per person, purchasing power', fmtUsd((f.gdp * f.pppRatio) / P), fmtUsd((bf.gdpPpp?.v ?? NaN) / (bf.pop?.v ?? NaN)), 'gdpPpp'],
    ['Unemployment %', f.unemp.toFixed(1), fmtNum(bf.unemployment?.v ?? NaN), 'unemployment'],
    ['Inflation %', f.inflation.toFixed(1), fmtNum(bf.inflation?.v ?? NaN), 'inflation'],
    ['Government debt % of GDP', (100 * f.debt / f.gdp).toFixed(0), fmtNum(bf.govDebt?.v ?? NaN), 'govDebt'],
    ['Military spending % of GDP', bf.milexShare ? (100 * f.milexShare).toFixed(1) : '—', bf.milexShare ? fmtNum(bf.milexShare.v) : '—', 'milexShare'],
    ['Democracy score (V-Dem)', f.demo.toFixed(2), fmtNum(bf.vdemEdi?.v ?? NaN), 'vdemEdi'],
    ['UN voting position', f.fp.toFixed(2), fmtNum(bf.unIdeal?.v ?? NaN), 'unIdeal'],
  ];
  return (
    <div role="tabpanel">
      <p className="fine">“Start” is the real 2023 value from public data; “Now” is the simulation. “Estimated” means the data was missing and filled in from similar countries.</p>
      <table className="data">
        <thead><tr><th scope="col"></th><th scope="col">Now</th><th scope="col">Start</th><th scope="col">Source</th></tr></thead>
        <tbody>{rows.map(([l, now, base, k]) => <tr key={l}><th scope="row">{l}</th><td>{now}</td><td>{base}</td><td>{k ? <Src o={bf[k]} b={b} /> : ''}</td></tr>)}</tbody>
      </table>
      <details>
        <summary>Model internals (every variable)</summary>
        <table className="data mono"><tbody>{Object.entries(f).map(([k, v]) => <tr key={k}><th scope="row">{k}</th><td>{Math.abs(v) >= 1e4 ? v.toExponential(3) : v.toPrecision(4)}</td></tr>)}</tbody></table>
      </details>
      <details>
        <summary>Why each relationship is what it is</summary>
        <table className="data mono">
          <tbody>{detail.diplomacy.relations.slice(0, 40).map((r) => <tr key={r.c}><th scope="row">{b.countries[r.c].name}</th><td>{r.trust.toFixed(2)}</td><td>{Object.entries(r.drivers).filter(([, v]) => Math.abs(v) >= 0.05).map(([k, v]) => `${k} ${v > 0 ? '+' : ''}${v.toFixed(2)}`).join(', ')}</td></tr>)}</tbody>
        </table>
      </details>
    </div>
  );
}
