// Canvas map of provinces. Provinces are projected once into Path2D objects and merged per owning country, so a
// redraw fills ~200 shapes; national borders are the province edges whose two sides have different owners, so they
// follow annexations. Occupied provinces are hatched. Pan with drag, zoom with wheel, click to select a country.
import { useEffect, useMemo, useRef, useState } from 'react';
import { geoEqualEarth, geoPath, geoGraticule10 } from 'd3-geo';
import { feature, mesh } from 'topojson-client';
import type { Topology, GeometryCollection } from 'topojson-specification';

export interface MapRegion { id: string; name: string; owner: number }

interface Props {
  topo: Topology;
  regions: MapRegion[];               // provinces, same order as the topology's geometries
  fillFor: (owner: number) => string; // owner -1 => unowned
  hatched?: Set<number>;              // provinces under occupation
  selected: number | null;
  onSelect: (c: number | null) => void;
  onHover: (r: MapRegion | null, x?: number, y?: number, i?: number) => void; // x, y: cursor position within the map
  version: number;                    // bump to force redraw
}

interface View { k: number; x: number; y: number }

export function MapView({ topo, regions, fillFor, hatched, selected, onSelect, onHover, version }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
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
      gp,
      provinces: fc.features.map((f) => new Path2D(gp(f) ?? '')),
      boxes: fc.features.map((f) => gp.bounds(f)),
      graticule: new Path2D(gp(geoGraticule10()) ?? ''),
      sphere: new Path2D(gp({ type: 'Sphere' } as any) ?? ''),
    };
  }, [topo, obj, size.w, size.h]);

  // merged shapes per owner and the borders: rebuilt only when ownership changes
  const byOwner = useMemo(() => {
    const m = new Map<number, Path2D>();
    regions.forEach((r, i) => { let p = m.get(r.owner); if (!p) m.set(r.owner, (p = new Path2D())); p.addPath(geo.provinces[i]); });
    const owner = (g: any) => regions[g.id as number]?.owner;
    const outlines = new Map<number, Path2D>();
    return {
      paths: m,
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

  const hatch = useMemo(() => {
    const c = document.createElement('canvas'); c.width = c.height = 8;
    const x = c.getContext('2d')!;
    // dark and light stripes, so occupation shows on pale and dark fills alike
    for (const [col, off] of [['rgba(31,47,58,0.6)', 0], ['rgba(255,255,255,0.75)', 4]] as const) {
      x.strokeStyle = col; x.lineWidth = 1.4; x.beginPath();
      for (const d of [-8, 0, 8]) { x.moveTo(d + off - 2, 10); x.lineTo(d + off + 10, -2); }
      x.stroke();
    }
    return c;
  }, []);

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
    if (hatched?.size) {
      const pat = ctx.createPattern(hatch, 'repeat')!;
      pat.setTransform(new DOMMatrix().scale(1 / view.k));
      ctx.fillStyle = pat;
      for (const i of hatched) ctx.fill(geo.provinces[i]);
    }
    if (view.k > 2) { ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 0.4 / view.k; ctx.stroke(byOwner.internal); }
    ctx.strokeStyle = 'rgba(255,255,255,0.95)'; ctx.lineWidth = 0.8 / view.k; ctx.stroke(byOwner.national);
    const ink = css.getPropertyValue('--ink') || '#1f2f3a';
    if (hovered >= 0 && hovered !== selected && byOwner.paths.has(hovered)) { ctx.strokeStyle = ink; ctx.lineWidth = 1 / view.k; ctx.stroke(byOwner.outline(hovered)); }
    if (selected !== null && byOwner.paths.has(selected)) { ctx.strokeStyle = ink; ctx.lineWidth = 2.2 / view.k; ctx.stroke(byOwner.outline(selected)); }
  }, [size, view, version, selected, geo, byOwner, fillFor, hovered, hatched, hatch]);

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
      <div className="map-zoom">
        <button onClick={() => zoomAt(size.w / 2, size.h / 2, 1.5)} aria-label="Zoom in">+</button>
        <button onClick={() => zoomAt(size.w / 2, size.h / 2, 1 / 1.5)} aria-label="Zoom out">−</button>
        <button onClick={() => setView({ k: 1, x: 0, y: 0 })} aria-label="Show the whole world" title="Show the whole world">⤢</button>
      </div>
    </div>
  );
}
