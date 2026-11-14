import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Topology } from 'topojson-specification';
import type { Baseline } from '../engine/types';
import type { SimEvent } from '../engine/state';
import { formatDate, civilFromDays } from '../engine/calendar';
import type { Frame, FromWorker, ToWorker } from '../worker/protocol';
import { MapView, type MapRegion } from './MapView';
import { CountryPanel } from './CountryPanel';
import { WorldPanel } from './WorldPanel';
import { Timeline } from './Timeline';
import { MAP_MODES, categoryOf, makeScale, politicalColor, NO_DATA } from './mapModes';
import { putSave, getSave, downloadText } from './storage';
import { REGIME_WORDS } from './words';

const SPEEDS: [string, number, string][] = [
  ['Slow', 30, 'One month per second'], ['Normal', 365, 'One year per second'],
  ['Fast', 3652, 'Ten years per second'], ['Fastest', 18262, 'Fifty years per second'],
];
const randomSeed = () => Math.floor(Math.random() * 1e9);
const WELCOMED = 'world.welcomed';
function readFlag(): boolean { try { return localStorage.getItem(WELCOMED) === '1'; } catch { return false; } }
function writeFlag() { try { localStorage.setItem(WELCOMED, '1'); } catch { /* private mode: show the welcome again next time */ } }

export function App() {
  const worker = useRef<Worker | null>(null);
  const [baseline, setBaseline] = useState<Baseline | null>(null);
  const [topo, setTopo] = useState<Topology | null>(null);
  const [frame, setFrame] = useState<Frame | null>(null);
  const events = useRef<SimEvent[]>([]);
  const [modeId, setModeId] = useState('political');
  const [selected, setSelected] = useState<number | null>(null);
  const [hover, setHover] = useState<{ r: MapRegion; x: number; y: number } | null>(null);
  const [speed, setSpeed] = useState(365);
  const [message, setMessage] = useState<string | null>(null);
  const [welcome, setWelcome] = useState(() => !readFlag());
  const [busy, setBusy] = useState(false);
  const [seedInput, setSeedInput] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const menu = useRef<HTMLDetailsElement>(null);
  const pendingSave = useRef<'file' | 'quick'>('quick');

  const send = useCallback((m: ToWorker) => worker.current?.postMessage(m), []);

  useEffect(() => {
    const base = document.baseURI;
    Promise.all([fetch(new URL('data/baseline.json', base)).then((r) => r.json()), fetch(new URL('data/world.topo.json', base)).then((r) => r.json())])
      .then(([b, t]) => { setBaseline(b); setTopo(t); })
      .catch((e) => setMessage(`The world data could not be loaded (${e}). Reload the page to try again.`));
    const w = new Worker(new URL('../worker/sim.worker.ts', import.meta.url), { type: 'module' });
    worker.current = w;
    w.onmessage = (ev: MessageEvent<FromWorker>) => {
      const m = ev.data;
      if (m.type === 'frame') {
        if (m.resetEvents) { events.current = m.newEvents; setBusy(false); } else if (m.newEvents.length) events.current = events.current.concat(m.newEvents);
        setFrame(m);
      } else if (m.type === 'saved') {
        if (pendingSave.current === 'file') { const s = JSON.parse(m.json); downloadText(`world-${formatDate(s.day)}-seed${s.seed}.json`, m.json); setMessage('Save file downloaded.'); }
        else putSave('quick', m.json).then(() => setMessage('Saved in this browser.')).catch((e) => setMessage(`Saving failed: ${e}`));
      } else if (m.type === 'error') { setBusy(false); setMessage(m.message); }
    };
    w.postMessage({ type: 'init', baselineUrl: new URL('data/baseline.json', base).href, seed: 1 } satisfies ToWorker);
    return () => w.terminate();
  }, []);
  useEffect(() => { send({ type: 'select', c: selected }); }, [selected, send]);
  useEffect(() => { if (!message) return; const t = setTimeout(() => setMessage(null), 6000); return () => clearTimeout(t); }, [message]);

  const name = useCallback((c: number) => baseline?.countries[c]?.name ?? '?', [baseline]);
  const regions = useMemo<MapRegion[]>(() => {
    if (!baseline) return [];
    const idx = new Map(baseline.countries.map((c, i) => [c.id, i]));
    return baseline.regions.map((r) => ({ id: r.id, name: r.name, owner: r.owner ? idx.get(r.owner) ?? -1 : -1 }));
  }, [baseline]);

  const mode = MAP_MODES.find((m) => m.id === modeId)!;
  const modeActive = !mode.needsSelection || selected !== null;
  const scale = useMemo(() => (frame && mode.metric && mode.kind !== 'categorical' ? makeScale(mode, frame.metrics[mode.metric]) : null), [frame, mode]);
  const fillFor = useCallback((owner: number) => {
    if (mode.kind === 'political' || !modeActive) return politicalColor(owner);
    if (owner === selected && mode.needsSelection) return '#1f2f3a';
    if (mode.kind === 'categorical') return categoryOf(mode, owner, frame!.metrics, baseline!, frame!.blocLabels)[1];
    const v = frame!.metrics[mode.metric!][owner];
    return scale && Number.isFinite(v) ? scale.color(v) : NO_DATA;
  }, [mode, modeActive, scale, frame, baseline, selected]);
  const weight = useCallback((c: number) => frame?.metrics.pop[c] ?? 0, [frame]);
  const onHover = useCallback((r: MapRegion | null, x?: number, y?: number) => setHover(r ? { r, x: x ?? 0, y: y ?? 0 } : null), []);

  if (!baseline || !topo || !frame) {
    return <div className="loading"><p>{message ?? 'Loading the world…'}</p></div>;
  }

  const closeMenu = () => menu.current?.removeAttribute('open');
  const play = () => send({ type: frame.playing ? 'pause' : 'play' });
  const startWatching = () => { writeFlag(); setWelcome(false); if (!frame.playing) send({ type: 'play' }); };
  const rewind = (day: number) => { setBusy(true); send({ type: 'rewind', day }); setMessage(`Went back to ${civilFromDays(day).y}. Press Play to watch the same history again, or roll the dice for a different one.`); };

  const hoverText = (() => {
    if (!hover || hover.r.owner < 0) return null;
    const o = hover.r.owner;
    if (!modeActive || mode.kind === 'political') return null;
    if (mode.kind === 'categorical') return categoryOf(mode, o, frame.metrics, baseline, frame.blocLabels)[0];
    const v = frame.metrics[mode.metric!][o];
    return Number.isFinite(v) ? `${mode.label}: ${mode.fmt!(v)}` : 'No data';
  })();
  const featured = MAP_MODES.filter((m) => m.featured);
  const groups = [...new Set(MAP_MODES.filter((m) => !m.featured).map((m) => m.group))];
  const cats = mode.kind === 'categorical' && modeActive
    ? [...new Map(regions.filter((r) => r.owner >= 0).map((r) => categoryOf(mode, r.owner, frame.metrics, baseline, frame.blocLabels))).entries()].sort((x, y) => (mode.id === 'regime' ? REGIME_WORDS.indexOf(x[0]) - REGIME_WORDS.indexOf(y[0]) : x[0].localeCompare(y[0])))
    : [];

  return (
    <div className="app">
      <header className="topbar">
        <h1 className="brand">World</h1>
        <button className="play" onClick={play} aria-label={frame.playing ? 'Pause' : 'Play'}>
          <span aria-hidden="true">{frame.playing ? '❚❚' : '▶'}</span> {frame.playing ? 'Pause' : 'Play'}
        </button>
        <div className="speed" role="radiogroup" aria-label="Speed">
          {SPEEDS.map(([l, v, t]) => (
            <button key={l} role="radio" aria-checked={speed === v} className={speed === v ? 'on' : ''} title={t}
              onClick={() => { setSpeed(v); send({ type: 'speed', daysPerSecond: v }); }}>{l}</button>
          ))}
        </div>
        <details className="menu" ref={menu}>
          <summary>Menu</summary>
          <div className="menu-pop">
            <p className="menu-head">Time</p>
            <button onClick={() => { send({ type: 'step', unit: 'month' }); closeMenu(); }}>Move ahead one month</button>
            <button onClick={() => { send({ type: 'step', unit: 'year' }); closeMenu(); }}>Move ahead one year</button>
            <button onClick={() => { const s = randomSeed(); send({ type: 'branch', seed: s }); setMessage(`Rolled the dice again. From ${civilFromDays(frame.day).y} on, history will turn out differently.`); closeMenu(); }}>
              Roll the dice again from today
            </button>
            <button onClick={() => { setBusy(true); send({ type: 'restart', seed: randomSeed() }); setSelected(null); setMessage('Started a new world from the beginning.'); closeMenu(); }}>Start over from the beginning</button>
            <p className="menu-head">Saving</p>
            <button onClick={() => { pendingSave.current = 'quick'; send({ type: 'save' }); closeMenu(); }}>Save in this browser</button>
            <button onClick={async () => { closeMenu(); const s = await getSave('quick').catch(() => undefined); if (s) { setBusy(true); send({ type: 'load', json: s.json }); setMessage('Opened your browser save.'); } else setMessage('There is no save in this browser yet. Use “Save in this browser” first.'); }}>Open browser save</button>
            <button onClick={() => { pendingSave.current = 'file'; send({ type: 'save' }); closeMenu(); }}>Download save file</button>
            <button onClick={() => { fileInput.current?.click(); closeMenu(); }}>Open save file…</button>
            <p className="menu-head">Replay a world</p>
            <form className="seed" onSubmit={(e) => { e.preventDefault(); if (!seedInput) return; setBusy(true); send({ type: 'restart', seed: +seedInput }); setSelected(null); setMessage(`Started world number ${seedInput} from the beginning.`); closeMenu(); }}>
              <label>World number <input inputMode="numeric" value={seedInput} placeholder={String(frame.seed)} onChange={(e) => setSeedInput(e.target.value.replace(/\D/g, ''))} size={10} /></label>
              <button type="submit" disabled={!seedInput}>Start</button>
            </form>
            <p className="fine">The same number always gives the same history. This one is number {frame.seed}.</p>
          </div>
        </details>
        <input ref={fileInput} type="file" accept="application/json" hidden onChange={async (e) => { const f = e.target.files?.[0]; if (f) { setBusy(true); send({ type: 'load', json: await f.text() }); setMessage(`Opened ${f.name}.`); } e.target.value = ''; }} />
      </header>

      {message && <div className="toast" role="status">{message}<button className="ghost" onClick={() => setMessage(null)} aria-label="Dismiss">✕</button></div>}

      <main className="main">
        <section className="map-col" aria-label="Map">
          <nav className="modes" aria-label="What the map shows">
            {featured.map((m) => (
              <button key={m.id} aria-pressed={m.id === modeId} className={m.id === modeId ? 'on' : ''} onClick={() => setModeId(m.id)}>{m.label}</button>
            ))}
            <select aria-label="More maps" value={featured.some((m) => m.id === modeId) ? '' : modeId} onChange={(e) => e.target.value && setModeId(e.target.value)} className={featured.some((m) => m.id === modeId) ? '' : 'on'}>
              <option value="">More maps…</option>
              {groups.map((g) => <optgroup key={g} label={g}>{MAP_MODES.filter((m) => !m.featured && m.group === g).map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</optgroup>)}
            </select>
          </nav>
          <div className="map-area">
            <MapView topo={topo} regions={regions} fillFor={fillFor} selected={selected} onSelect={setSelected} onHover={onHover} version={frame.day + modeId.length + (selected ?? -1)} />
            {hover && (
              <div className="tip" style={{ left: hover.x + 14, top: hover.y + 14 }} role="presentation">
                <b>{hover.r.owner >= 0 ? name(hover.r.owner) : hover.r.name}</b>
                {hover.r.owner >= 0 && hover.r.name !== name(hover.r.owner) && <span className="fine">{hover.r.name}</span>}
                {hoverText && <span>{hoverText}</span>}
              </div>
            )}
            {welcome && (
              <div className="welcome" role="dialog" aria-labelledby="welcome-title">
                <h2 id="welcome-title">Watch history happen</h2>
                <p>This is the world as it really was in 2023, built from public data on every country’s people, economy, politics, religion and alliances.</p>
                <p>Press Play and the simulation takes over. Elections, recessions, coups, sanctions and new alliances all come out of the model; none of it is scripted.</p>
                <ul>
                  <li>Click a country to see what is happening there.</li>
                  <li>Use the buttons above the map to colour it by wealth, democracy, unrest and more.</li>
                  <li>Click the bar at the bottom to go back to an earlier year.</li>
                </ul>
                <div className="row">
                  <button className="play" onClick={startWatching}>Start watching</button>
                  <button className="ghost" onClick={() => { writeFlag(); setWelcome(false); }}>Look around first</button>
                </div>
              </div>
            )}
          </div>
          <div className="legend">
            {modeActive ? <p>{mode.about}</p> : <p>Choose a country on the map to see how everyone else feels about it.</p>}
            {scale && modeActive && mode.fmt && (
              <div className="ramp">
                <span>{mode.low ?? mode.fmt(scale.lo)}</span>
                <i style={{ background: `linear-gradient(90deg, ${scale.stops.join(',')})` }} title={`${mode.fmt(scale.lo)} to ${mode.fmt(scale.hi)}`} />
                <span>{mode.high ?? mode.fmt(scale.hi)}</span>
              </div>
            )}
            {cats.length > 0 && <ul className="cats">{cats.map(([l, col]) => <li key={l}><i style={{ background: col }} />{l}</li>)}</ul>}
          </div>
        </section>
        <aside className="side" aria-label={frame.detail && selected !== null ? 'Country' : 'World'}>
          {frame.detail && selected !== null
            ? <CountryPanel key={selected} baseline={baseline} detail={frame.detail} events={events.current} name={name} weight={weight}
                coupRisk={frame.metrics.coupRisk[selected]} onSelect={setSelected} onClose={() => setSelected(null)} />
            : <WorldPanel frame={frame} events={events.current} name={name} weight={weight} onSelect={setSelected} />}
        </aside>
      </main>

      <Timeline startDay={frame.startDay} day={frame.day} events={events.current} branches={frame.branches} busy={busy} onRewind={rewind} />
    </div>
  );
}
