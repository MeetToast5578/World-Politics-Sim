// Gravity trade network (structural cache, rebuilt from the baseline at construction; not part of saved state).
//
// Bilateral exports X_ij = a_i · b_j · (Y_i · Y_j / Y_W) · Y_W0 · D_ij^(−θ) · e^(γ·contig_ij) over a sparse partner set (each
// country's top-K partners by gravity mass, made symmetric). a_i, b_j are fitted by iterative proportional fitting so
// that every country's exports and imports each equal half its observed trade/GDP ratio at baseline. Dividing by
// world GDP Y_W (structural gravity, Anderson & van Wincoop 2003) keeps trade shares stable under uniform growth;
// shares change only when a country grows faster or slower than its partners. No bilateral trade data is used yet: the partner pattern is a model estimate.
// mult[i][k] scales the pair's flows for political reasons (sanctions, trust; set by systems/diplomacy.ts). The fit uses
// the baseline multipliers, so observed openness is matched with the sanctions already in force.
import type { Baseline } from '../types';
import type { Params } from '../params';

export interface TradeNet {
  partners: Int32Array[];   // partners[i] = country indices
  dist: Float64Array[];     // distance factor D^(−θ)·e^(γ·contig) per partner
  mult: Float64Array[];     // political multiplier per partner (1 = neutral), symmetric
  a: Float64Array;          // exporter fit factor
  b: Float64Array;          // importer fit factor
  world0: number;           // world GDP at baseline
}

const R = 6371;
function haversine([lon1, lat1]: [number, number], [lon2, lat2]: [number, number]): number {
  const r = Math.PI / 180, dLat = (lat2 - lat1) * r, dLon = (lon2 - lon1) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Land contiguity between countries, from shared region borders. */
export function contiguity(b: Baseline): Set<string>[] {
  const owner = new Map(b.regions.map((r) => [r.id, r.owner]));
  const idx = new Map(b.countries.map((c, i) => [c.id, i]));
  const out = b.countries.map(() => new Set<string>());
  for (const r of b.regions) {
    if (!r.owner) continue;
    for (const nb of r.landNeighbors) {
      const o = owner.get(nb);
      if (o && o !== r.owner) out[idx.get(r.owner)!].add(o);
    }
  }
  return out;
}

export function buildTrade(b: Baseline, gdp: Float64Array, p: Params, baseMult: (i: number, j: number) => number = () => 1): TradeNet {
  const n = b.countries.length, cs = b.countries;
  const contig = contiguity(b);
  const factor = (i: number, j: number) => {
    const d = Math.max(p.trade.minDistKm, haversine(cs[i].geo.centroid, cs[j].geo.centroid));
    return d ** -p.trade.distElasticity * (contig[i].has(cs[j].id) ? Math.exp(p.trade.contiguity) : 1);
  };
  // top-K partners by gravity mass, then symmetrised
  const sets = Array.from({ length: n }, () => new Set<number>());
  for (let i = 0; i < n; i++) {
    const cand = [];
    for (let j = 0; j < n; j++) if (j !== i) cand.push([gdp[j] * factor(i, j), j]);
    cand.sort((x, y) => y[0] - x[0] || x[1] - y[1]);
    for (let k = 0; k < Math.min(p.trade.partners, cand.length); k++) { sets[i].add(cand[k][1]); sets[cand[k][1]].add(i); }
  }
  const partners = sets.map((s) => Int32Array.from([...s].sort((x, y) => x - y)));
  const mult = partners.map((ps, i) => Float64Array.from(ps, (j) => baseMult(i, j)));
  const dist = partners.map((ps, i) => Float64Array.from(ps, (j, k) => factor(i, j) * mult[i][k]));
  const target = Float64Array.from(cs, (c, i) => ((c.fields.trade?.v ?? 50) / 200) * gdp[i]); // exports = imports = half of (X+M)
  const a = new Float64Array(n).fill(1), bb = new Float64Array(n).fill(1);
  for (let it = 0; it < 60; it++) {
    for (let i = 0; i < n; i++) { // exports of i
      let s = 0;
      for (let k = 0; k < partners[i].length; k++) { const j = partners[i][k]; s += bb[j] * gdp[i] * gdp[j] * dist[i][k]; }
      a[i] = s > 0 ? target[i] / s : 0;
    }
    for (let j = 0; j < n; j++) { // imports of j (partner relation is symmetric, so j's partners are its sources)
      let s = 0;
      for (let k = 0; k < partners[j].length; k++) { const i = partners[j][k]; s += a[i] * gdp[i] * gdp[j] * dist[j][k]; }
      bb[j] = s > 0 ? target[j] / s : 0;
    }
  }
  // dist was fitted including the baseline multipliers; store the pure distance factor and the multipliers separately
  for (let i = 0; i < n; i++) for (let k = 0; k < partners[i].length; k++) dist[i][k] /= mult[i][k] || 1;
  return { partners, dist, mult, a, b: bb, world0: gdp.reduce((s, y) => s + y, 0) };
}

export const worldGdp = (gdp: Float64Array) => { let s = 0; for (let i = 0; i < gdp.length; i++) s += gdp[i]; return s; };

/** Exports of country i to its k-th partner as a share of i's GDP: X_ij / Y_i (world = current world GDP). */
export const exportShare = (t: TradeNet, gdp: Float64Array, world: number, i: number, k: number) =>
  (t.a[i] * t.b[t.partners[i][k]] * gdp[t.partners[i][k]] * t.dist[i][k] * t.mult[i][k] * t.world0) / world;

/** Exports + imports over GDP (%), with current GDPs. */
export function tradeOpenness(t: TradeNet, gdp: Float64Array, i: number, world = worldGdp(gdp)): number {
  let x = 0, m = 0;
  for (let k = 0; k < t.partners[i].length; k++) {
    const j = t.partners[i][k];
    const w = t.dist[i][k] * t.mult[i][k]; // both symmetric
    x += t.a[i] * t.b[j] * gdp[j] * w;
    m += t.a[j] * t.b[i] * gdp[j] * w;
  }
  return (100 * (x + m) * t.world0) / world;
}
