import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Topology } from 'topojson-specification';
import type { Baseline } from '../engine/types';
import type { SimEvent } from '../engine/state';
import { formatDate, civilFromDays, daysFromCivil } from '../engine/calendar';
import type { Frame, FromWorker, ToWorker, StepUnit } from '../worker/protocol';
import { MapView, type MapRegion } from './MapView';
import { CountryPanel } from './CountryPanel';
import { WorldPanel } from './WorldPanel';
import { EventFeed } from './EventFeed';
import { MAP_MODES, GOV_COLORS, GOV_LABELS, makeScale, politicalColor } from './mapModes';
import { putSave, getSave, downloadText } from './storage';
import { fmtNum } from './format';

const SPEEDS: [string, number][] = [['1 day/s', 1], ['1 week/s', 7], ['1 month/s', 30], ['1 year/s', 365], ['10 years/s', 3652], ['50 years/s', 18262]];
const randomSeed = () => Math.floor(Math.random() * 1e9);

export function App() {
  const worker = useRef<Worker | null>(null);
  const [baseline, setBaseline] = useState<Baseline | null>(null);
  const [topo, setTopo] = useState<Topology | null>(null);
  const [frame, setFrame] = useState<Frame | null>(null);
  const events = useRef<SimEvent[]>([]);
  const [modeId, setModeId] = useState('political');
  const [selected, setSelected] = useState<number | null>(null);
  const [hover, setHover] = useState<MapRegion | null>(null);
  const [speed, setSpeed] = useState(365);
  const [seedInput, setSeedInput] = useState('1');
  const [rewindYear, setRewindYear] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const pendingSave = useRef<'file' | 'quick'>('quick');

  const send = useCallback((m: ToWorker) => worker.current?.postMessage(m), []);

  useEffect(() => {
    const base = document.baseURI;
    Promise.all([fetch(new URL('data/baseline.json', base)).then((r) => r.json()), fetch(new URL('data/world.topo.json', base)).then((r) => r.json())])
      .then(([b, t]) => { setBaseline(b); setTopo(t); })
      .catch((e) => setMessage(`Failed to load data: ${e}`));
    const w = new Worker(new URL('../worker/sim.worker.ts', import.meta.url), { type: 'module' });
    worker.current = w;
    w.onmessage = (ev: MessageEvent<FromWorker>) => {
      const m = ev.data;
      if (m.type === 'frame') {
        if (m.resetEvents) events.current = m.newEvents; else if (m.newEvents.length) events.current = events.current.concat(m.newEvents);
        setFrame(m);
      } else if (m.type === 'saved') {
        if (pendingSave.current === 'file') { const s = JSON.parse(m.json); downloadText(`world-${formatDate(s.day)}-seed${s.seed}.json`, m.json); }
        else putSave('quick', m.json).then(() => setMessage('Quick-saved in this browser.')).catch((e) => setMessage(`Quick-save failed: ${e}`));
      } else if (m.type === 'error') setMessage(m.message);
    };
    w.postMessage({ type: 'init', baselineUrl: new URL('data/baseline.json', base).href, seed: 1 } satisfies ToWorker);
    return () => w.terminate();
  }, []);
  useEffect(() => { send({ type: 'select', c: selected }); }, [selected, send]);

  const name = useCallback((c: number) => baseline?.countries[c]?.name ?? '?', [baseline]);
  const regions = useMemo<MapRegion[]>(() => {
    if (!baseline) return [];
    const idx = new Map(baseline.countries.map((c, i) => [c.id, i]));
    return baseline.regions.map((r) => ({ id: r.id, name: r.name, owner: r.owner ? idx.get(r.owner) ?? -1 : -1 }));
  }, [baseline]);

  const mode = MAP_MODES.find((m) => m.id === modeId)!;
  const scale = useMemo(() => (frame && mode.metric ? makeScale(mode, frame.metrics[mode.metric]) : null), [frame, mode]);
  const fillFor = useCallback((owner: number) => {
    if (owner < 0) return '#2a2f3a';
    if (mode.kind === 'political') return politicalColor(owner);
    if (mode.id === 'government') return GOV_COLORS[baseline!.countries[owner].government.form];
    return scale && frame ? scale.color(frame.metrics[mode.metric!][owner]) : '#333';
  }, [mode, scale, frame, baseline]);
  const weight = useCallback((c: number) => frame?.metrics.pop[c] ?? 0, [frame]);

  if (!baseline || !topo || !frame) {
    return <div className="loading">{message ?? 'Loading world data…'}</div>;
  }

  const { y } = civilFromDays(frame.day);
  const hoverValue = hover && hover.owner >= 0 && mode.metric ? mode.fmt!(frame.metrics[mode.metric][hover.owner]) : null;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">WORLD <span>observer</span></div>
        <div className="date" aria-live="off">{formatDate(frame.day)}</div>
        <div className="controls">
          <button className="primary" onClick={() => send({ type: frame.playing ? 'pause' : 'play' })}>{frame.playing ? '❚❚ Pause' : '▶ Play'}</button>
          <select aria-label="Speed" value={speed} onChange={(e) => { setSpeed(+e.target.value); send({ type: 'speed', daysPerSecond: +e.target.value }); }}>
            {SPEEDS.map(([l, v]) => <option key={l} value={v}>{l}</option>)}
          </select>
          {(['day', 'month', 'year'] as StepUnit[]).map((u) => <button key={u} onClick={() => send({ type: 'step', unit: u })} title={`Advance one ${u}`}>+1 {u}</button>)}
        </div>
        <div className="controls">
          <label>Seed <input aria-label="Seed" value={seedInput} onChange={(e) => setSeedInput(e.target.value.replace(/\D/g, ''))} size={9} /></label>
          <button onClick={() => { send({ type: 'restart', seed: +seedInput || 0 }); setSelected(null); }} title="Start a new world from the baseline with this seed">Restart</button>
          <button onClick={() => { const s = randomSeed(); send({ type: 'branch', seed: s }); setMessage(`Branched: the future now follows seed ${s} from ${formatDate(frame.day)}.`); }} title="Keep the present, re-roll all future randomness">Branch</button>
          <label>Rewind to <input aria-label="Rewind to year" value={rewindYear} placeholder={String(y - 1)} onChange={(e) => setRewindYear(e.target.value.replace(/\D/g, ''))} size={5} /></label>
          <button disabled={!rewindYear} onClick={() => { const yr = +rewindYear; send({ type: 'rewind', day: Math.max(frame.startDay, Math.min(frame.day, daysFromCivil(yr, 1, 1))) }); setRewindYear(''); }}>Go</button>
        </div>
        <div className="controls">
          <button onClick={() => { pendingSave.current = 'quick'; send({ type: 'save' }); }}>Quick save</button>
          <button onClick={async () => { const s = await getSave('quick').catch(() => undefined); if (s) send({ type: 'load', json: s.json }); else setMessage('No quick save in this browser yet.'); }}>Quick load</button>
          <button onClick={() => { pendingSave.current = 'file'; send({ type: 'save' }); }}>Export</button>
          <button onClick={() => fileInput.current?.click()}>Import</button>
          <input ref={fileInput} type="file" accept="application/json" hidden onChange={async (e) => { const f = e.target.files?.[0]; if (f) send({ type: 'load', json: await f.text() }); e.target.value = ''; }} />
        </div>
      </header>

      {message && <div className="toast" role="status">{message} <button className="ghost" onClick={() => setMessage(null)} aria-label="Dismiss">✕</button></div>}

      <main className="main">
        <div className="map-col">
          <div className="modebar" role="tablist" aria-label="Map mode">
            {[...new Set(MAP_MODES.map((m) => m.group))].map((g) => (
              <div key={g} className="modegroup"><span>{g}</span>
                {MAP_MODES.filter((m) => m.group === g).map((m) => (
                  <button key={m.id} role="tab" aria-selected={m.id === modeId} className={m.id === modeId ? 'on' : ''} onClick={() => setModeId(m.id)}>{m.label}</button>
                ))}
              </div>
            ))}
          </div>
          <MapView topo={topo} regions={regions} fillFor={fillFor} selected={selected} onSelect={setSelected} onHover={setHover} version={frame.day} />
          <div className="legend">
            {hover ? <span className="hover"><b>{hover.owner >= 0 ? name(hover.owner) : hover.name}</b>{hover.owner >= 0 && hover.name !== name(hover.owner) ? ` · ${hover.name}` : ''}{hoverValue ? ` · ${hoverValue}` : ''}</span> : <span className="muted">Hover a country · drag to pan · scroll to zoom</span>}
            {scale && mode.fmt && (
              <span className="ramp"><span>{mode.fmt(scale.lo)}</span><i style={{ background: `linear-gradient(90deg, ${scale.stops.join(',')})` }} /><span>{mode.fmt(scale.hi)}</span></span>
            )}
            {mode.id === 'government' && (
              <span className="cats">{Object.entries(GOV_LABELS).map(([k, l]) => <span key={k}><i style={{ background: GOV_COLORS[k as keyof typeof GOV_COLORS] }} />{l}</span>)}</span>
            )}
            {mode.note && <span className="muted note">{mode.note}</span>}
          </div>
          <EventFeed events={events.current} name={name} weight={weight} onSelect={setSelected} />
        </div>
        <aside className="side">
          {frame.detail && selected !== null
            ? <CountryPanel baseline={baseline} detail={frame.detail} events={events.current} name={name} onClose={() => setSelected(null)} />
            : <WorldPanel frame={frame} name={name} onSelect={setSelected} />}
          <footer className="foot">
            Seed {frame.seed}{frame.branches.length ? ` · ${frame.branches.length} branch point(s)` : ''} · baseline {baseline.meta.referenceYear} data ·{' '}
            {frame.perf.msPerSimYear ? `${frame.perf.msPerSimYear.toFixed(1)} ms per simulated year · ` : ''}
            {fmtNum(frame.world.events)} events
          </footer>
        </aside>
      </main>
    </div>
  );
}
