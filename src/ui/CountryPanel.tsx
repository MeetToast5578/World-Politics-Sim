// Country inspector: current simulated state next to its sourced baseline, history charts, events, and raw model state.
import type { Baseline, Obs } from '../engine/types';
import type { CountryDetail } from '../worker/protocol';
import type { SimEvent } from '../engine/state';
import { describeEvent } from '../engine/describe';
import { formatDate } from '../engine/calendar';
import { LineChart } from './LineChart';
import { Pyramid } from './Pyramid';
import { fmtNum, fmtPct, fmtUsd } from './format';
import { GOV_LABELS } from './mapModes';

interface Props {
  baseline: Baseline;
  detail: CountryDetail;
  events: SimEvent[];
  name: (c: number) => string;
  onClose: () => void;
}

const STATUS: Record<string, string> = {
  recognized: 'UN member / widely recognised', partially_recognized: 'Partially recognised', unrecognized: 'Unrecognised (de facto state)', non_self_governing: 'Non-self-governing territory',
};

function Src({ o, b }: { o?: Obs; b: Baseline }) {
  if (!o) return <span className="src missing">no data</span>;
  const s = b.meta.sources[o.s];
  return <span className={`src ${o.s === 'IMPUTED' ? 'imputed' : ''}`} title={`${s?.name ?? o.s} — ${s?.license ?? ''}`}>{o.s} {o.y}</span>;
}

export function CountryPanel({ baseline: b, detail, events, name, onClose }: Props) {
  const bc = b.countries[detail.c], f = detail.fields, bf = bc.fields;
  const P = f.p0 + f.p1 + f.p2;
  const L = f.p1 * f.lfRate * (1 - f.unemp / 100);
  const rows: [string, string, string, string | undefined][] = [
    ['Population', fmtNum(P), fmtNum(bf.pop?.v ?? NaN), 'pop'],
    ['  aged 0–14 / 65+', `${fmtPct(f.p0 / P)} / ${fmtPct(f.p2 / P)}`, `${fmtNum(bf.pop0014?.v ?? NaN)}% / ${fmtNum(bf.pop65?.v ?? NaN)}%`, 'pop65'],
    ['Fertility (TFR)', f.tfr.toFixed(2), fmtNum(bf.tfr?.v ?? NaN), 'tfr'],
    ['Life expectancy F / M', `${f.e0F.toFixed(1)} / ${f.e0M.toFixed(1)}`, `${fmtNum(bf.lifeExpF?.v ?? NaN)} / ${fmtNum(bf.lifeExpM?.v ?? NaN)}`, 'lifeExpF'],
    ['Under-5 mortality F / M', `${(f.u5F * 1000).toFixed(1)} / ${(f.u5M * 1000).toFixed(1)} ‰`, `${fmtNum(bf.u5mrF?.v ?? NaN)} / ${fmtNum(bf.u5mrM?.v ?? NaN)} ‰`, 'u5mrF'],
    ['Births / deaths last year', `${fmtNum(f.births)} / ${fmtNum(f.deaths)}`, `CBR ${fmtNum(bf.cbr?.v ?? NaN)}‰ · CDR ${fmtNum(bf.cdr?.v ?? NaN)}‰`, 'cbr'],
    ['Net migration last year', fmtNum(f.netMig), fmtNum(bf.netMigration?.v ?? NaN), 'netMigration'],
    ['GDP (2023 USD)', fmtUsd(f.gdp), fmtUsd(bf.gdp?.v ?? NaN), 'gdp'],
    ['GDP per capita', fmtUsd(f.gdp / P), fmtUsd((bf.gdp?.v ?? NaN) / (bf.pop?.v ?? NaN)), undefined],
    ['GDP per capita (PPP)', fmtUsd((f.gdp * f.pppRatio) / P), fmtUsd((bf.gdpPpp?.v ?? NaN) / (bf.pop?.v ?? NaN)), 'gdpPpp'],
    ['Unemployment', `${f.unemp.toFixed(1)}%`, `${fmtNum(bf.unemployment?.v ?? NaN)}%`, 'unemployment'],
    ['Inflation', `${f.inflation.toFixed(1)}% (expected ${f.piE.toFixed(1)}%)`, `${fmtNum(bf.inflation?.v ?? NaN)}%`, 'inflation'],
    ['Investment / GDP', fmtPct(f.sInv), `${fmtNum(bf.investment?.v ?? NaN)}%`, 'investment'],
    ['Agriculture / industry', `${fmtPct(f.agriShare)} / ${fmtPct(f.indShare)}`, `${fmtNum(bf.agriShare?.v ?? NaN)}% / ${fmtNum(bf.industryShare?.v ?? NaN)}%`, 'agriShare'],
    ['Trade / GDP', `${f.tradeShare.toFixed(0)}%`, `${fmtNum(bf.trade?.v ?? NaN)}%`, 'trade'],
    ['Hydrocarbon rents / GDP', fmtPct(f.rents), '', 'oilRents'],
    ['Public debt / GDP', fmtPct(f.debt / f.gdp, 0), `${fmtNum(bf.govDebt?.v ?? NaN)}%`, 'govDebt'],
    ['Revenue / GDP', fmtPct(f.revShare), `${fmtNum(bf.govRevenue?.v ?? NaN)}%`, 'govRevenue'],
    ['Military spending / GDP', bf.milexShare ? fmtPct(f.milexShare) : '—', bf.milexShare ? `${fmtNum(bf.milexShare.v)}%` : '—', 'milexShare'],
    ['Armed forces', bf.armedForces ? fmtNum(f.afRate * f.p1) : '—', fmtNum(bf.armedForces?.v ?? NaN), 'armedForces'],
  ];
  const h = detail.history;
  const myEvents = events.filter((e) => e.c === detail.c || e.o === detail.c).slice(-40).reverse();

  return (
    <div className="panel country">
      <div className="panel-head">
        <div>
          <h2>{bc.name}</h2>
          <div className="sub">{STATUS[bc.status]} · {bc.wbRegion}</div>
        </div>
        <button className="ghost" onClick={onClose} aria-label="Close country panel">✕</button>
      </div>

      <section>
        <div className="kv"><span>Government</span><b title={bc.government.basis}>{GOV_LABELS[bc.government.form]}</b></div>
        <div className="kv small"><span>Basis</span><span>{bc.government.basis}{bc.government.raw ? ` — Wikidata: “${bc.government.raw}”` : ''}</span></div>
        <div className="kv"><span>Territory</span><span>{fmtNum(bc.geo.areaKm2)} km² · {bc.geo.landlocked ? 'landlocked' : `${fmtNum(bc.geo.coreCoastKm)} km coastline`} · {bc.regions.length} region{bc.regions.length > 1 ? 's' : ''}</span></div>
        <div className="kv"><span>Governance (WGI)</span><span>effectiveness {f.wgiEffectiveness.toFixed(2)} · voice {f.wgiVoice.toFixed(2)} · rule of law {f.wgiRuleOfLaw.toFixed(2)}</span></div>
      </section>

      <section className="charts">
        <Pyramid f={detail.pyramid.f} m={detail.pyramid.m} />
        <LineChart label="Population" years={h.years} values={h.series.pop} fmt={(v) => fmtNum(v)} />
        <LineChart label="GDP per capita (2023 USD)" years={h.years} values={h.series.gdpPc} fmt={fmtUsd} />
        <LineChart label="Fertility rate" years={h.years} values={h.series.tfr} fmt={(v) => v.toFixed(2)} />
        <LineChart label="Public debt / GDP" years={h.years} values={h.series.debtRatio} fmt={(v) => fmtPct(v, 0)} />
      </section>

      <section>
        <h3>Simulated now vs. baseline</h3>
        <table className="stats">
          <thead><tr><th></th><th>Now</th><th>Baseline</th><th>Source</th></tr></thead>
          <tbody>
            {rows.map(([label, now, base, key]) => (
              <tr key={label}><td>{label}</td><td>{now}</td><td>{base}</td><td>{key ? <Src o={bf[key]} b={b} /> : ''}</td></tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h3>Events</h3>
        {myEvents.length === 0 ? <p className="muted">No recorded events yet.</p> : (
          <ul className="events compact">{myEvents.map((e, i) => <li key={i}><time>{formatDate(e.d)}</time> {describeEvent(e, name)}</li>)}</ul>
        )}
      </section>

      <details>
        <summary>Inspector: model state</summary>
        <p className="muted">Raw state variables for this country. Labour force now: {fmtNum(L)}. Output = A·K^α·L^(1−α)·e^cycle.</p>
        <table className="stats mono">
          <tbody>{Object.entries(f).map(([k, v]) => <tr key={k}><td>{k}</td><td>{Math.abs(v) >= 1e4 ? v.toExponential(4) : v.toPrecision(5)}</td></tr>)}</tbody>
        </table>
      </details>
    </div>
  );
}
