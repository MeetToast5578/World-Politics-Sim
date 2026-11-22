// New states. A civil war over territory that the rebels win can end in secession: the provinces they hold become a
// new country. The number of countries is fixed everywhere else in the engine, so a new state grows every structure
// by one country, in place and deterministically:
//   baseline   a copy with one more country (fields, religion and government copied from the parent and marked
//              DERIVED; centroid and area from its provinces) and one more map region (land neighbours from the
//              provinces around it)
//   trade      the new state trades with its parent's partners and the parent; other countries add it at the end
//              of their partner lists, so existing indices (and the diplomatic pairs that point at them) stay valid
//   pairs      new pairs with the parent, the parent's partners and the new trade partners, appended
//   state      every per-country array grows by one (copied from the parent, then adjusted by the caller);
//              history gets NaN for the years before independence
// On load (and on replay) the same structural steps run from the recorded NewState, so saves stay exact.
import type { Baseline, BaselineCountry, BaselineRegion } from '../types';
import type { Params } from '../params';
import type { WorldState } from '../state';
import { FIELDS, HIST_FIELDS, PAIR_FIELDS, AGES } from '../state';
import { contiguity, type TradeNet } from './trade';
import type { PairNet } from './diplomacy';

/** A state born during the simulation (stored in WorldState.newStates). */
export interface NewState { id: string; name: string; parent: string; provinces: number[]; neighbors: string[]; day: number }

const R = 6371;
function km([lon1, lat1]: [number, number], [lon2, lat2]: [number, number]): number {
  const r = Math.PI / 180, dLat = (lat2 - lat1) * r, dLon = (lon2 - lon1) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** A copy of the baseline with the new state appended as a country and a map region. */
export function extendBaseline(b: Baseline, ns: NewState): Baseline {
  const parent = b.countries.find((c) => c.id === ns.parent)!;
  let A = 0, x = 0, y = 0;
  for (const i of ns.provinces) { const p = b.provinces[i], a = Math.max(1, p.areaKm2); A += a; x += a * p.centroid[0]; y += a * p.centroid[1]; }
  const centroid: [number, number] = [+(x / A).toFixed(3), +(y / A).toFixed(3)];
  const nbRegions = new Set(ns.neighbors.map((id) => b.countries.find((c) => c.id === id)?.regions[0]).filter((r): r is string => !!r));
  const region: BaselineRegion = { id: ns.id, name: ns.name, owner: ns.id, dataCode: null, status: 'integral', areaKm2: Math.round(A), coastKm: 0, landNeighbors: [...nbRegions].sort(), centroid };
  const derived = Object.fromEntries(Object.entries(parent.fields).map(([k, o]) => [k, o && { ...o, s: 'DERIVED' as const }]));
  const country: BaselineCountry = {
    ...parent, id: ns.id, name: ns.name, status: 'partially_recognized', regions: [ns.id], fields: derived, groups: [], leader: null, // groups move in WorldState.groups
    geo: { ...parent.geo, areaKm2: Math.round(A), coastKm: 0, coreCoastKm: 0, centroid, s: 'DERIVED' },
  };
  return {
    ...b,
    countries: [...b.countries, country],
    regions: [...b.regions.map((r) => (nbRegions.has(r.id) ? { ...r, landNeighbors: [...r.landNeighbors, ns.id] } : r)), region],
  };
}

/** The new state (index c) takes its parent's trade partners and the parent; partners append it to their lists. */
export function extendTrade(t: TradeNet, b: Baseline, p: Params, parent: number, c: number): void {
  const cs = b.countries, contig = contiguity(b);
  const factor = (i: number, j: number) => {
    const d = Math.max(p.trade.minDistKm, km(cs[i].geo.centroid, cs[j].geo.centroid));
    return d ** -p.trade.distElasticity * (contig[i].has(cs[j].id) ? Math.exp(p.trade.contiguity) : 1);
  };
  const ps = Int32Array.from([...t.partners[parent], parent]);
  t.partners.push(ps);
  t.dist.push(Float64Array.from(ps, (j) => factor(c, j)));
  t.mult.push(new Float64Array(ps.length).fill(1));
  for (const j of ps) {
    t.partners[j] = Int32Array.from([...t.partners[j], c]);
    t.dist[j] = Float64Array.from([...t.dist[j], factor(j, c)]);
    t.mult[j] = Float64Array.from([...t.mult[j], 1]);
  }
  const grow = (a: Float64Array, v: number) => { const o = new Float64Array(a.length + 1); o.set(a); o[a.length] = v; return o; };
  t.a = grow(t.a, t.a[parent]); t.b = grow(t.b, t.b[parent]);
}

/** Pairs for the new state c (with its parent, the parent's pair partners and its trade partners), appended.
 *  Returns how many were added. n is the new number of countries. */
export function extendPairs(net: PairNet, b: Baseline, trade: TradeNet, n: number, parent: number, c: number): number {
  const others = new Set<number>([parent]);
  for (const q of net.of[parent]) others.add(net.i[q] === parent ? net.j[q] : net.i[q]);
  for (const j of trade.partners[c]) others.add(j);
  others.delete(c);
  const idx = new Int32Array(n * n).fill(-1), m = n - 1;
  for (let a = 0; a < m; a++) for (let d = 0; d < m; d++) idx[a * n + d] = net.idx[a * m + d];
  net.idx = idx;
  net.of.push([]);
  const contig = contiguity(b), list = [...others].sort((x, y) => x - y), P0 = net.i.length;
  const cat = <T extends Int32Array | Float64Array>(a: T, xs: number[]) => { const o = new (a.constructor as any)(a.length + xs.length) as T; o.set(a); o.set(xs, a.length); return o; };
  net.i = cat(net.i, list); net.j = cat(net.j, list.map(() => c));
  net.prox = cat(net.prox, list.map((a) => (contig[c].has(b.countries[a].id) ? 1 : Math.exp(-km(b.countries[a].geo.centroid, b.countries[c].geo.centroid) / 2500))));
  list.forEach((a, k) => {
    const q = P0 + k;
    net.idx[a * n + c] = q; net.idx[c * n + a] = q; net.of[a].push(q); net.of[c].push(q);
    net.tradeK.push(Int32Array.from([trade.partners[a].indexOf(c), trade.partners[c].indexOf(a)]));
  });
  return list.length;
}

/** Grow every per-country array of the state by one country, copying the parent's values (people and territory
 *  are moved by the caller); append `pairs` neutral pair entries (the parent pair hostile). */
export function growState(st: WorldState, ns: NewState, parent: number, net: PairNet, pairs: number): void {
  const n0 = st.n, n = n0 + 1, c = n0, R = st.nRel;
  for (const k of FIELDS) { const a = new Float64Array(n); a.set(st.f[k]); a[c] = st.f[k][parent]; st.f[k] = a; }
  const co = new Float64Array(n * 2 * AGES); co.set(st.cohorts); st.cohorts = co;
  const rel = new Float64Array(n * R); rel.set(st.religion); st.religion = rel;
  for (const k of HIST_FIELDS) {
    const old = st.history.data[k], H = st.history.years.length, out: number[] = new Array(H * n);
    for (let y = 0; y < H; y++) { for (let i = 0; i < n0; i++) out[y * n + i] = old[y * n0 + i]; out[y * n + c] = NaN; }
    st.history.data[k] = out;
  }
  const P0 = st.pair.trust.length;
  for (const k of PAIR_FIELDS) { const a = new Float64Array(P0 + pairs); a.set(st.pair[k]); st.pair[k] = a; }
  for (let q = P0; q < P0 + pairs; q++) {
    const other = net.i[q] === c ? net.j[q] : net.i[q];
    // relations start neutral (and settle toward their drivers within a few years); hostile with the old state
    const t = other === parent ? -0.6 : 0;
    st.pair.trust[q] = st.pair.trust0[q] = t;
    st.pair.grievance[q] = other === parent ? 2 : 0;
  }
  const grow8 = (a: Uint8Array) => { const o = new Uint8Array(n * st.nOrg); o.set(a); return o; }; // a new state belongs to nothing yet
  st.orgMember = grow8(st.orgMember); st.orgMember0 = grow8(st.orgMember0);
  st.n = n; st.ids.push(ns.id);
}
