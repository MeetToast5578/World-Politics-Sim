// Canvas map: regions are pre-projected once into Path2D objects; redraws only refill colours.
// Pan with drag, zoom with wheel, click to select the owning country.
import { useEffect, useRef, useState } from 'react';
import { geoEqualEarth, geoPath, geoGraticule10 } from 'd3-geo';
import { feature } from 'topojson-client';
import type { Topology } from 'topojson-specification';

export interface MapRegion { id: string; name: string; owner: number }

interface Props {
  topo: Topology;
  regions: MapRegion[];               // same order as topology geometries
  fillFor: (owner: number) => string; // owner -1 => unowned
  selected: number | null;
  onSelect: (c: number | null) => void;
  onHover: (r: MapRegion | null) => void;
  version: number;                    // bump to force redraw
}

interface View { k: number; x: number; y: number }

export function MapView({ topo, regions, fillFor, selected, onSelect, onHover, version }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 800, h: 450 });
  const [view, setView] = useState<View>({ k: 1, x: 0, y: 0 });
  const paths = useRef<{ regions: Path2D[]; graticule: Path2D; sphere: Path2D } | null>(null);
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);

  useEffect(() => {
    const ro = new ResizeObserver(([e]) => setSize({ w: Math.max(200, e.contentRect.width), h: Math.max(150, e.contentRect.height) }));
    ro.observe(wrap.current!);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const fc = feature(topo, topo.objects.regions) as unknown as GeoJSON.FeatureCollection;
    const proj = geoEqualEarth().fitExtent([[8, 8], [size.w - 8, size.h - 8]], { type: 'Sphere' } as any);
    const gp = geoPath(proj);
    paths.current = {
      regions: fc.features.map((f) => new Path2D(gp(f) ?? '')),
      graticule: new Path2D(gp(geoGraticule10()) ?? ''),
      sphere: new Path2D(gp({ type: 'Sphere' } as any) ?? ''),
    };
  }, [topo, size.w, size.h]);

  useEffect(() => {
    const cv = canvas.current, P = paths.current;
    if (!cv || !P) return;
    const dpr = window.devicePixelRatio || 1;
    cv.width = size.w * dpr; cv.height = size.h * dpr;
    const ctx = cv.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#0d1117';
    ctx.fillRect(0, 0, size.w, size.h);
    ctx.setTransform(dpr * view.k, 0, 0, dpr * view.k, dpr * view.x, dpr * view.y);
    ctx.fillStyle = '#16213a'; ctx.fill(P.sphere);
    ctx.strokeStyle = 'rgba(255,255,255,0.05)'; ctx.lineWidth = 0.5 / view.k; ctx.stroke(P.graticule);
    regions.forEach((r, i) => { ctx.fillStyle = fillFor(r.owner); ctx.fill(P.regions[i]); });
    ctx.strokeStyle = 'rgba(13,17,23,0.85)'; ctx.lineWidth = 0.4 / view.k;
    P.regions.forEach((p) => ctx.stroke(p));
    if (selected !== null) {
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.6 / view.k;
      regions.forEach((r, i) => { if (r.owner === selected) ctx.stroke(P.regions[i]); });
    }
  }, [size, view, version, selected, regions, fillFor]);

  const hit = (ev: React.MouseEvent): MapRegion | null => {
    const P = paths.current, cv = canvas.current;
    if (!P || !cv) return null;
    const rect = cv.getBoundingClientRect();
    const x = (ev.clientX - rect.left - view.x) / view.k, y = (ev.clientY - rect.top - view.y) / view.k;
    const ctx = cv.getContext('2d')!;
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
    // iterate backwards so small regions drawn later win over large ones
    let found: MapRegion | null = null;
    for (let i = P.regions.length - 1; i >= 0; i--) if (ctx.isPointInPath(P.regions[i], x, y)) { found = regions[i]; break; }
    ctx.restore();
    return found;
  };

  const zoomAt = (mx: number, my: number, factor: number) => setView((v) => {
    const k = Math.min(40, Math.max(1, v.k * factor));
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
          } else onHover(hit(e));
        }}
        onMouseUp={(e) => {
          if (drag.current && !drag.current.moved) { const r = hit(e); onSelect(r && r.owner >= 0 ? r.owner : null); }
          drag.current = null;
        }}
        onMouseLeave={() => { drag.current = null; onHover(null); }}
      />
      <div className="map-zoom">
        <button onClick={() => zoomAt(size.w / 2, size.h / 2, 1.5)} aria-label="Zoom in">+</button>
        <button onClick={() => zoomAt(size.w / 2, size.h / 2, 1 / 1.5)} aria-label="Zoom out">−</button>
        <button onClick={() => setView({ k: 1, x: 0, y: 0 })} aria-label="Reset view">⟲</button>
      </div>
    </div>
  );
}
