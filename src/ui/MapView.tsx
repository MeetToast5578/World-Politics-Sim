// Canvas map of provinces, in two layers.
// Base: provinces merged per owning country (~200 fills a redraw), national borders that follow annexations,
//   province borders when zoomed in, hatching for occupied (dark) and rebel-held (orange) provinces, country names
//   placed largest-first without overlaps.
// Overlay (animated): a dot on every armed conflict, pulsing for wars and civil wars, scaled by battle deaths; front lines as marching dashes;
//   ripples with a short headline where news happens. Only the overlay runs every animation frame.
// Pan with drag, zoom with wheel, click to select a country.
import { useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import { geoEqualEarth, geoPath, geoGraticule10 } from 'd3-geo';
import { feature, mesh } from 'topojson-client';
import type { Topology, GeometryCollection } from 'topojson-specification';
import type { WarInfo } from '../worker/protocol';

export interface MapRegion { id: string; name: string; owner: number }
export interface MapLabel { c: number; name: string; lon: number; lat: number; pop: number }
export interface Ping { c: number; text: string; color: string; t: number }

interface Props {
  topo: Topology;
  regions: MapRegion[];               // provinces, same order as the topology's geometries
  fillFor: (owner: number) => string; // owner -1 => unowned
  occupied?: Set<number>;             // provinces held by a foreign army
  rebel?: Set<number>;                // provinces held by rebels
  labels: MapLabel[];                 // one per country: where its name (and its war glow, its news) goes
  wars: WarInfo[];
  frontKey: string;                   // changes when front lines should be recomputed (throttled by the caller)
  pings: MutableRefObject<Ping[]>;
  selected: number | null;
  onSelect: (c: number | null) => void;
  onHover: (r: MapRegion | null, x?: number, y?: number, i?: number) => void; // x, y: cursor position within the map
  version: number;                    // bump to force a redraw of the base layer
}

interface View { k: number; x: number; y: number }

function hatchPattern(dark: string, light: string): HTMLCanvasElement {
  const c = document.createElement('canvas'); c.width = c.height = 8;
  const x = c.getContext('2d')!;
  for (const [col, off] of [[dark, 0], [light, 4]] as const) {
    x.strokeStyle = col; x.lineWidth = 1.4; x.beginPath();
    for (const d of [-8, 0, 8]) { x.moveTo(d + off - 2, 10); x.lineTo(d + off + 10, -2); }
    x.stroke();
  }
  return c;
}

export function MapView({ topo, regions, fillFor, occupied, rebel, labels, wars, frontKey, pings, selected, onSelect, onHover, version }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const overlay = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 800, h: 450 });
  const [view, setView] = useState<View>({ k: 1, x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const [hovered, setHovered] = useState(-1);

  useEffect(() => {
    const ro = new ResizeObserver(([e]) => setSize({ w: Math.max(200, e.contentRect.width), h: Math.max(150, e.contentRect.height) }));
    ro.observe(wrap.current!);
    return () => ro.disconnect();
  }, []);

  const obj = topo.objects.provinces as GeometryCollection;
  // projected geometry: depends only on the topology and the canvas size
  const geo = useMemo(() => {
    const fc = feature(topo, obj) as unknown as GeoJSON.FeatureCollection;
    const proj = geoEqualEarth().fitExtent([[8, 8], [size.w - 8, size.h - 8]], { type: 'Sphere' } as any);
    const gp = geoPath(proj);
    return {
      gp, proj,
      provinces: fc.features.map((f) => new Path2D(gp(f) ?? '')),
      boxes: fc.features.map((f) => gp.bounds(f)),
      graticule: new Path2D(gp(geoGraticule10()) ?? ''),
      sphere: new Path2D(gp({ type: 'Sphere' } as any) ?? ''),
    };
  }, [topo, obj, size.w, size.h]);

  // merged shapes per owner, their extents, and the borders: rebuilt only when ownership changes
  const byOwner = useMemo(() => {
    const m = new Map<number, Path2D>(), box = new Map<number, [number, number, number, number]>();
    regions.forEach((r, i) => {
      let p = m.get(r.owner); if (!p) m.set(r.owner, (p = new Path2D())); p.addPath(geo.provinces[i]);
      const [[x0, y0], [x1, y1]] = geo.boxes[i], b = box.get(r.owner);
      box.set(r.owner, b ? [Math.min(b[0], x0), Math.min(b[1], y0), Math.max(b[2], x1), Math.max(b[3], y1)] : [x0, y0, x1, y1]);
    });
    const owner = (g: any) => regions[g.id as number]?.owner;
    const outlines = new Map<number, Path2D>();
    return {
      paths: m, box,
      national: new Path2D(geo.gp(mesh(topo, obj, (a, b) => a !== b && owner(a) !== owner(b))) ?? ''),
      internal: new Path2D(geo.gp(mesh(topo, obj, (a, b) => a !== b && owner(a) === owner(b))) ?? ''),
      /** a country's outer edge (land borders and coast), computed on first use */
      outline(c: number): Path2D {
        let p = outlines.get(c);
        if (!p) outlines.set(c, (p = new Path2D(geo.gp(mesh(topo, obj, (a, b) => (a === b ? owner(a) === c : (owner(a) === c) !== (owner(b) === c)))) ?? '')));
        return p;
      },
    };
  }, [regions, geo, topo, obj]);

  // front lines: edges between held and free provinces of the same country (one mesh for all wars)
  const fronts = useMemo(() => {
    const heldBy = new Map<number, number>();
    for (const w of wars) for (const i of w.held) heldBy.set(i, w.id);
    if (!heldBy.size) return null;
    const owner = (g: any) => regions[g.id as number]?.owner;
    return new Path2D(geo.gp(mesh(topo, obj, (a, b) => a !== b && owner(a) === owner(b) && (heldBy.get(a.id as number) ?? -1) !== (heldBy.get(b.id as number) ?? -1))) ?? '');
  }, [frontKey, geo, topo, obj]); // eslint-disable-line react-hooks/exhaustive-deps

  const patterns = useMemo(() => ({ occupied: hatchPattern('rgba(31,47,58,0.6)', 'rgba(255,255,255,0.75)'), rebel: hatchPattern('rgba(176,84,22,0.85)', 'rgba(255,240,220,0.8)') }), []);
  const labelAt = useMemo(() => {
    const m = new Map<number, [number, number]>();
    for (const l of labels) { const p = geo.proj([l.lon, l.lat]); if (p) m.set(l.c, p as [number, number]); }
    return m;
  }, [labels, geo]);

  // ---------------------------------------------------------------- base layer
  useEffect(() => {
    const cv = canvas.current;
    if (!cv) return;
    const dpr = window.devicePixelRatio || 1;
    cv.width = size.w * dpr; cv.height = size.h * dpr;
    const ctx = cv.getContext('2d')!;
    const css = getComputedStyle(cv);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.w, size.h);
    ctx.setTransform(dpr * view.k, 0, 0, dpr * view.k, dpr * view.x, dpr * view.y);
    ctx.fillStyle = css.getPropertyValue('--sea') || '#d6e6ee'; ctx.fill(geo.sphere);
    ctx.strokeStyle = 'rgba(31,47,58,0.07)'; ctx.lineWidth = 0.6 / view.k; ctx.stroke(geo.graticule);
    for (const [owner, p] of byOwner.paths) { ctx.fillStyle = owner < 0 ? '#f3f5f6' : fillFor(owner); ctx.fill(p); }
    for (const [set, pat] of [[occupied, patterns.occupied], [rebel, patterns.rebel]] as const) {
      if (!set?.size) continue;
      const fill = ctx.createPattern(pat, 'repeat')!;
      fill.setTransform(new DOMMatrix().scale(1 / view.k));
      ctx.fillStyle = fill;
      for (const i of set) ctx.fill(geo.provinces[i]);
    }
    if (view.k > 2) { ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 0.4 / view.k; ctx.stroke(byOwner.internal); }
    ctx.strokeStyle = 'rgba(255,255,255,0.95)'; ctx.lineWidth = 0.8 / view.k; ctx.stroke(byOwner.national);
    const ink = css.getPropertyValue('--ink') || '#1f2f3a';
    if (hovered >= 0 && hovered !== selected && byOwner.paths.has(hovered)) { ctx.strokeStyle = ink; ctx.lineWidth = 1 / view.k; ctx.stroke(byOwner.outline(hovered)); }
    if (selected !== null && byOwner.paths.has(selected)) { ctx.strokeStyle = ink; ctx.lineWidth = 2.2 / view.k; ctx.stroke(byOwner.outline(selected)); }

    // country names, in screen space: biggest populations first, skipped where they would overlap or not fit
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
    const placed: [number, number, number, number][] = [];
    for (const l of labels) {
      const p = labelAt.get(l.c), b = byOwner.box.get(l.c);
      if (!p || !b || !byOwner.paths.has(l.c)) continue;
      const sx = p[0] * view.k + view.x, sy = p[1] * view.k + view.y;
      if (sx < 0 || sy < 0 || sx > size.w || sy > size.h) continue;
      const fs = Math.min(16, 9 + 1.3 * Math.log10(Math.max(1, l.pop / 1e5)) + Math.log2(view.k));
      ctx.font = `${l.c === selected ? 700 : 600} ${fs.toFixed(1)}px Lexend, system-ui, sans-serif`;
      const tw = ctx.measureText(l.name).width, room = Math.min(b[2] - b[0], 3 * (b[3] - b[1])) * view.k;
      if (tw > room * 1.15 && l.c !== selected) continue;
      const r: [number, number, number, number] = [sx - tw / 2 - 3, sy - fs / 2 - 2, sx + tw / 2 + 3, sy + fs / 2 + 2];
      if (placed.some((q) => r[0] < q[2] && r[2] > q[0] && r[1] < q[3] && r[3] > q[1])) continue;
      placed.push(r);
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.strokeText(l.name, sx, sy);
      ctx.fillStyle = 'rgba(31,47,58,0.82)'; ctx.fillText(l.name, sx, sy);
    }
  }, [size, view, version, selected, geo, byOwner, fillFor, hovered, occupied, rebel, patterns, labels, labelAt]);

  // ---------------------------------------------------------------- animated overlay
  const live = useRef({ wars, view, fronts, labelAt, size });
  live.current = { wars, view, fronts, labelAt, size };
  useEffect(() => {
    const cv = overlay.current;
    if (!cv) return;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    let raf = 0;
    const draw = (now: number) => {
      const { wars, view, fronts, labelAt, size } = live.current;
      const dpr = window.devicePixelRatio || 1;
      if (cv.width !== size.w * dpr || cv.height !== size.h * dpr) { cv.width = size.w * dpr; cv.height = size.h * dpr; }
      const ctx = cv.getContext('2d')!;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, size.w, size.h);
      const at = (c: number) => { const p = labelAt.get(c); return p ? [p[0] * view.k + view.x, p[1] * view.k + view.y] as const : null; };
      // war glows: radius by battle deaths, a slow pulse; offset slightly so it does not cover the name
      for (const w of wars) {
        const p = at(w.loc);
        if (!p) continue;
        const r = (4 + 2.2 * Math.log10(Math.max(25, w.rate))) * Math.min(1, 0.4 + size.w / 1500), col = w.kind === 'interstate' ? '179,38,30' : w.rate >= 1000 ? '224,123,84' : '214,150,70';
        const ph = reduce ? 0.5 : ((now / 1800 + w.id * 0.37) % 1);
        const x = p[0], y = p[1] + 13;
        if (w.kind === 'interstate' || w.rate >= 1000) { ctx.beginPath(); ctx.arc(x, y, r * (1 + 1.2 * ph), 0, 2 * Math.PI); ctx.fillStyle = `rgba(${col},${0.35 * (1 - ph)})`; ctx.fill(); }
        ctx.beginPath(); ctx.arc(x, y, Math.max(2.5, r * 0.45), 0, 2 * Math.PI); ctx.fillStyle = `rgba(${col},0.9)`; ctx.fill();
        ctx.lineWidth = 1.2; ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.stroke();
      }
      // fronts: marching dashes
      if (fronts) {
        ctx.setTransform(dpr * view.k, 0, 0, dpr * view.k, dpr * view.x, dpr * view.y);
        ctx.lineCap = 'round';
        ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 3 / view.k; ctx.setLineDash([]); ctx.stroke(fronts);
        ctx.strokeStyle = 'rgba(160,28,22,0.95)'; ctx.lineWidth = 1.8 / view.k; ctx.setLineDash([5 / view.k, 4 / view.k]);
        ctx.lineDashOffset = reduce ? 0 : -(now / 60) / view.k; ctx.stroke(fronts);
        ctx.setLineDash([]); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
      // news ripples with a short headline
      const life = 4500;
      pings.current = pings.current.filter((g) => now - g.t < life);
      const used: number[][] = [];
      for (const g of pings.current) {
        const p = at(g.c);
        if (!p) continue;
        const a = (now - g.t) / life;
        for (const lag of [0, 0.18]) {
          const u = Math.max(0, Math.min(1, (a - lag) * 1.6));
          if (u <= 0 || u >= 1) continue;
          ctx.beginPath(); ctx.arc(p[0], p[1], 4 + 34 * u, 0, 2 * Math.PI);
          ctx.strokeStyle = g.color.replace('ALPHA', (0.9 * (1 - u)).toFixed(2)); ctx.lineWidth = 2.5; ctx.stroke();
        }
        if (a < 0.8) {
          ctx.font = '600 12px Lexend, system-ui, sans-serif';
          const tw = ctx.measureText(g.text).width, h = 20;
          let y = p[1] - 30;
          while (used.some(([ux, uy, uw]) => Math.abs(uy - y) < h && Math.abs(ux - p[0]) < (uw + tw) / 2 + 6)) y -= h + 2;
          used.push([p[0], y, tw]);
          const x0 = Math.min(Math.max(p[0] - tw / 2 - 8, 4), size.w - tw - 20);
          ctx.globalAlpha = a < 0.65 ? 1 : (0.8 - a) / 0.15;
          ctx.fillStyle = 'rgba(255,255,255,0.96)'; ctx.strokeStyle = g.color.replace('ALPHA', '1'); ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.roundRect(x0, y - h / 2, tw + 16, h, 10); ctx.fill(); ctx.stroke();
          ctx.fillStyle = '#1f2f3a'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(g.text, x0 + 8, y + 0.5);
          ctx.globalAlpha = 1;
        }
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [pings]);

  /** Province under the cursor (index), or −1. */
  const hit = (ev: React.MouseEvent): number => {
    const cv = canvas.current;
    if (!cv) return -1;
    const rect = cv.getBoundingClientRect();
    const x = (ev.clientX - rect.left - view.x) / view.k, y = (ev.clientY - rect.top - view.y) / view.k;
    const ctx = cv.getContext('2d')!;
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
    let found = -1;
    for (let i = geo.provinces.length - 1; i >= 0 && found < 0; i--) {
      const [[x0, y0], [x1, y1]] = geo.boxes[i];
      if (x >= x0 && x <= x1 && y >= y0 && y <= y1 && ctx.isPointInPath(geo.provinces[i], x, y)) found = i;
    }
    ctx.restore();
    return found;
  };

  const zoomAt = (mx: number, my: number, factor: number) => setView((v) => {
    const k = Math.min(60, Math.max(1, v.k * factor));
    return k === 1 ? { k, x: 0, y: 0 } : { k, x: mx - ((mx - v.x) * k) / v.k, y: my - ((my - v.y) * k) / v.k };
  });
  const onWheel = (ev: React.WheelEvent) => {
    const rect = canvas.current!.getBoundingClientRect();
    zoomAt(ev.clientX - rect.left, ev.clientY - rect.top, Math.exp(-ev.deltaY * 0.0015));
  };

  return (
    <div ref={wrap} className="map-wrap">
      <canvas
        ref={canvas}
        style={{ width: size.w, height: size.h }}
        role="img"
        aria-label="World map. Click a country to inspect it."
        onWheel={onWheel}
        onMouseDown={(e) => { drag.current = { x: e.clientX, y: e.clientY, moved: false }; }}
        onMouseMove={(e) => {
          const d = drag.current;
          if (d && e.buttons) {
            const dx = e.clientX - d.x, dy = e.clientY - d.y;
            if (Math.abs(dx) + Math.abs(dy) > 2) d.moved = true;
            d.x = e.clientX; d.y = e.clientY;
            setView((v) => ({ ...v, x: v.x + dx, y: v.y + dy }));
          } else {
            const i = hit(e), rect = canvas.current!.getBoundingClientRect();
            setHovered(i >= 0 ? regions[i].owner : -1);
            onHover(i >= 0 ? regions[i] : null, e.clientX - rect.left, e.clientY - rect.top, i);
          }
        }}
        onMouseUp={(e) => {
          if (drag.current && !drag.current.moved) { const i = hit(e); onSelect(i >= 0 && regions[i].owner >= 0 ? regions[i].owner : null); }
          drag.current = null;
        }}
        onMouseLeave={() => { drag.current = null; setHovered(-1); onHover(null); }}
      />
      <canvas ref={overlay} className="map-overlay" style={{ width: size.w, height: size.h }} aria-hidden="true" />
      <div className="map-zoom">
        <button onClick={() => zoomAt(size.w / 2, size.h / 2, 1.5)} aria-label="Zoom in">+</button>
        <button onClick={() => zoomAt(size.w / 2, size.h / 2, 1 / 1.5)} aria-label="Zoom out">−</button>
        <button onClick={() => setView({ k: 1, x: 0, y: 0 })} aria-label="Show the whole world" title="Show the whole world">⤢</button>
      </div>
    </div>
  );
}
