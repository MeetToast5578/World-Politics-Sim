// Country colours from flags. Each country's flag (flagcdn.com, rendered from Wikimedia's public-domain flags) is
// decoded, its most characteristic colour chosen (pixel count weighted toward saturated colours, so white and black
// fields rarely win), softened to an atlas tone, and nudged in hue where land neighbours would look alike.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

/** Minimal PNG decoder: 8-bit RGB/RGBA/grey and palette images of any bit depth, not interlaced. */
function decodePng(buf) {
  let pos = 8, w = 0, h = 0, depth = 0, type = 0, palette = null, trns = null;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos), kind = buf.toString('ascii', pos + 4, pos + 8), data = buf.subarray(pos + 8, pos + 8 + len);
    if (kind === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); depth = data[8]; type = data[9]; if (data[12]) throw new Error('interlaced PNG'); }
    else if (kind === 'PLTE') palette = data;
    else if (kind === 'tRNS') trns = data;
    else if (kind === 'IDAT') idat.push(data);
    pos += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const ch = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[type], bpp = Math.max(1, (ch * depth) >> 3), stride = (w * ch * depth + 7) >> 3;
  const out = Buffer.alloc(stride * h), prev = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const ft = raw[y * (stride + 1)], line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)), cur = out.subarray(y * stride, (y + 1) * stride);
    const up = y ? out.subarray((y - 1) * stride, y * stride) : prev;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0, b = up[x], c = x >= bpp ? up[x - bpp] : 0;
      let v = line[x];
      if (ft === 1) v += a; else if (ft === 2) v += b; else if (ft === 3) v += (a + b) >> 1;
      else if (ft === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      cur[x] = v & 255;
    }
  }
  const px = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const row = out.subarray(y * stride, (y + 1) * stride);
    if (type === 3) {
      const bit = x * depth, i = (row[bit >> 3] >> (8 - depth - (bit & 7))) & ((1 << depth) - 1);
      if (trns && i < trns.length && trns[i] < 128) continue;
      px.push([palette[3 * i], palette[3 * i + 1], palette[3 * i + 2]]);
    } else if (type === 2 || type === 6) {
      const o = x * ch; if (type === 6 && row[o + 3] < 128) continue;
      px.push([row[o], row[o + 1], row[o + 2]]);
    } else { const g = row[x * ch]; px.push([g, g, g]); }
  }
  return px;
}

function rgbToHsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
  if (!d) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(h * 60 + 360) % 360, s, l];
}
export function hslToHex([h, s, l]) {
  const a = s * Math.min(l, 1 - l), f = (n) => { const k = (n + h / 30) % 12; return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))).toString(16).padStart(2, '0'); };
  return `#${f(0)}${f(8)}${f(4)}`;
}

/** The flag's characteristic colour as HSL: most frequent quantised colour, weighted toward saturated ones. */
function flagColour(px) {
  const count = new Map();
  for (const [r, g, b] of px) { const k = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4); count.set(k, (count.get(k) || 0) + 1); }
  let best = null, score = -1;
  for (const [k, n] of count) {
    const rgb = [((k >> 8) & 15) * 17, ((k >> 4) & 15) * 17, (k & 15) * 17], [h, s, l] = rgbToHsl(rgb);
    const sc = n * (0.15 + s) * (l > 0.92 || l < 0.08 ? 0.2 : 1);
    if (sc > score) { score = sc; best = [h, s, l]; }
  }
  return best;
}

/** Atlas tone: keep the hue, moderate saturation, light. */
const soften = ([h, s, l]) => [h, Math.min(0.52, Math.max(0.26, s * 0.6)), Math.min(0.8, Math.max(0.7, 0.64 + l * 0.18))];
const hueGap = (a, b) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));
const close = (a, b) => (a[1] < 0.3 && b[1] < 0.3 ? Math.abs(a[2] - b[2]) < 0.06 : hueGap(a[0], b[0]) < 18 && Math.abs(a[2] - b[2]) < 0.1);

/** countries: [{ id, pop }]; iso2: id -> ISO 3166 alpha-2 (or flagcdn code); neighbours: id -> Set(id);
 *  fallback: id -> HSL of the flag's colour where no image exists. */
export async function flagColours(cacheDir, countries, iso2, neighbours, fallback = {}) {
  const dir = path.join(cacheDir, 'flags');
  fs.mkdirSync(dir, { recursive: true });
  const base = {};
  for (const c of countries) {
    const code = iso2[c.id];
    if (!code) { if (fallback[c.id]) base[c.id] = soften(fallback[c.id]); continue; }
    const f = path.join(dir, `${code}.png`);
    if (!fs.existsSync(f)) {
      const r = await fetch(`https://flagcdn.com/w80/${code}.png`, { signal: AbortSignal.timeout(30000) });
      if (!r.ok) { console.warn('no flag for', c.id, code, r.status); continue; }
      fs.writeFileSync(f, Buffer.from(await r.arrayBuffer()));
    }
    try { base[c.id] = soften(flagColour(decodePng(fs.readFileSync(f)))); } catch (e) { console.warn('flag decode', c.id, e.message); }
  }
  // neighbours kept apart: larger countries keep their colour, smaller ones shift hue (then lightness) until distinct
  const out = {}, order = [...countries].sort((a, b) => b.pop - a.pop);
  for (const c of order) {
    let hsl = base[c.id] ?? [(countries.indexOf(c) * 137.508) % 360, 0.4, 0.76];
    const nb = [...(neighbours[c.id] ?? [])].map((id) => out[id]).filter(Boolean);
    for (let k = 1; k <= 12 && nb.some((o) => close(o, hsl)); k++) {
      hsl = [(hsl[0] + (k % 2 ? 1 : -1) * 14 * k + 360) % 360, Math.max(hsl[1], 0.3), k > 6 ? 0.68 + 0.02 * (k - 6) : hsl[2]];
    }
    out[c.id] = hsl;
  }
  return Object.fromEntries(Object.entries(out).map(([id, hsl]) => [id, hslToHex(hsl)]));
}
