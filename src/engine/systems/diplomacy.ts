// Diplomacy (yearly). Relations live on a sparse set of country pairs: trading partners, land neighbours, treaty
// co-members, sanction pairs and all pairs among the largest military powers. Per pair:
//   trust      (−1..1) relaxes toward tanh(c + D), D = −fp·|UN-voting position gap| − ideo·|democracy gap|
//              + trade·ln(1 + 10·trade dependence) + ally·[co-members] + rel·(religious similarity − ½)
//              − grievance·g − sanctions·s. Initial trust is the same formula at baseline (no separate data).
//   grievance  accumulates from crises and sanctions, decays slowly (long memory of conflicts)
//   threat     i's perception of j = proximity × j's share of their combined military capital × (1 − trust)/2
// Decisions, each a saturating hazard whose constant is solved at t0 to the observed base rate:
//   crises     between nearby, threatening, distrustful pairs (target: ICB order of magnitude)
//   sanctions  directed; driven by threat, grievance, the target's recent coups (democratic senders), allies already
//              sanctioning (coalitions), relative size; deterred by trade dependence and trust. Lifted at a rate
//              rising with trust. Effects: bilateral trade cut, productivity loss for the target, grievance.
//              UN Security Council regimes are a country-level status (unSanction): they cut trade with every partner
//              and are lifted only collectively (regime change makes lifting more likely); none are imposed anew yet.
//   alliances  joining an existing defence treaty (trust in members + protection against the main threat),
//              leaving one (distrust of members), forming a new bilateral pact (trust + shared threat); targets from
//              ATOP 2001-2018 accession, exit and formation rates
// Trust also moves trade ("friend-shoring"): pair flows scale with exp(friendShoring·(trust − baseline trust)).
// Every decision event stores the inputs of its utility, which the UI shows as the reason.
import type { Baseline } from '../types';
import type { Params } from '../params';
import type { Rng } from '../rng';
import type { WorldState, SimEvent, Treaty } from '../state';
import { contiguity, worldGdp, exportShare, type TradeNet } from './trade';

const logistic = (x: number) => 1 / (1 + Math.exp(-x));

/** Structural pair list (derived from the baseline, identical on load and replay). */
export interface PairNet {
  i: Int32Array; j: Int32Array;           // i < j
  prox: Float64Array;                     // 1 if land neighbours, else exp(−distance / 2500 km)
  of: number[][];                         // pair indices per country
  idx: Int32Array;                        // dense n × n lookup: a * n + b → pair index, −1 if none (both orders)
  tradeK: Int32Array[];                   // [ki, kj]: index of j in i's trade partners and vice versa, −1 if none
}

export const pairOf = (net: PairNet, n: number, a: number, b: number) => net.idx[a * n + b];

const R = 6371;
function km([lon1, lat1]: [number, number], [lon2, lat2]: [number, number]): number {
  const r = Math.PI / 180, dLat = (lat2 - lat1) * r, dLon = (lon2 - lon1) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Baseline sanction intensity between two countries (either direction), for the trade fit. */
export function baselineSanction(b: Baseline): (i: number, j: number) => number {
  const idx = new Map(b.countries.map((c, k) => [c.id, k]));
  const m = new Map<number, number>();
  const n = b.countries.length;
  const un = new Float64Array(n);
  for (const s of b.meta.diplomacy.sanctions) {
    const t = idx.get(s.target)!;
    if (s.sender === 'UN') { un[t] = Math.max(un[t], s.intensity); continue; }
    const a = idx.get(s.sender)!, k = Math.min(a, t) * n + Math.max(a, t);
    m.set(k, Math.max(m.get(k) ?? 0, s.intensity));
  }
  return (i, j) => Math.max(m.get(Math.min(i, j) * n + Math.max(i, j)) ?? 0, un[i], un[j]);
}

export function buildPairs(b: Baseline, trade: TradeNet, milCap: Float64Array, p: Params): PairNet {
  const n = b.countries.length, idx = new Map(b.countries.map((c, k) => [c.id, k]));
  const set = new Set<number>();
  const add = (a: number, c: number) => { if (a !== c) set.add(Math.min(a, c) * n + Math.max(a, c)); };
  trade.partners.forEach((ps, a) => ps.forEach((c) => add(a, c)));
  contiguity(b).forEach((s, a) => s.forEach((id) => add(a, idx.get(id)!)));
  for (const t of b.meta.diplomacy.treaties) for (const x of t.members) for (const y of t.members) add(idx.get(x)!, idx.get(y)!);
  for (const s of b.meta.diplomacy.sanctions) if (s.sender !== 'UN') add(idx.get(s.sender)!, idx.get(s.target)!);
  for (const g of b.meta.diplomacy.grievances) add(idx.get(g.a)!, idx.get(g.b)!);
  const powers = Array.from({ length: n }, (_, k) => k).sort((x, y) => milCap[y] - milCap[x] || x - y).slice(0, p.diplomacy.powers);
  for (const x of powers) for (const y of powers) add(x, y);
  const keys = [...set].sort((x, y) => x - y), P = keys.length;
  const net: PairNet = { i: new Int32Array(P), j: new Int32Array(P), prox: new Float64Array(P), of: Array.from({ length: n }, () => []), idx: new Int32Array(n * n).fill(-1), tradeK: [] };
  const contig = contiguity(b);
  keys.forEach((k, q) => {
    const a = Math.floor(k / n), c = k % n;
    net.i[q] = a; net.j[q] = c; net.idx[a * n + c] = q; net.idx[c * n + a] = q; net.of[a].push(q); net.of[c].push(q);
    net.prox[q] = contig[a].has(b.countries[c].id) ? 1 : Math.exp(-km(b.countries[a].geo.centroid, b.countries[c].geo.centroid) / 2500);
    net.tradeK.push(Int32Array.from([trade.partners[a].indexOf(c), trade.partners[c].indexOf(a)]));
  });
  return net;
}

/** Cosine similarity of two countries' religious compositions. */
function relSim(st: WorldState, a: number, c: number): number {
  const R = st.nRel;
  let ab = 0, aa = 0, cc = 0;
  for (let r = 0; r < R; r++) { const x = st.religion[a * R + r], y = st.religion[c * R + r]; ab += x * y; aa += x * x; cc += y * y; }
  return aa > 0 && cc > 0 ? ab / Math.sqrt(aa * cc) : 0;
}

/** Share of a's GDP traded with c (exports + imports), with current GDPs and multipliers. */
function tradeDep(st: WorldState, trade: TradeNet, net: PairNet, q: number, W: number): number {
  const [ka] = net.tradeK[q], a = net.i[q];
  return ka < 0 ? 0 : 2 * exportShare(trade, st.f.gdp, W, a, ka);
}

/** 1 for pairs that share a defence treaty (recomputed whenever treaties may have changed). */
export function allyFlags(st: WorldState, net: PairNet): Uint8Array {
  const out = new Uint8Array(net.i.length);
  for (const t of st.treaties) for (let x = 0; x < t.members.length; x++) for (let y = x + 1; y < t.members.length; y++) {
    const q = pairOf(net, st.n, t.members[x], t.members[y]);
    if (q >= 0) out[q] = 1;
  }
  return out;
}

const DRIVERS = ['foreignPolicy', 'regime', 'trade', 'alliance', 'religion', 'grievance', 'sanctions'] as const;
const scratch = new Float64Array(DRIVERS.length);

/** Trust drivers of pair q written into `out` (order of DRIVERS); returns the trust target's argument c + Σ. */
function driverValues(st: WorldState, p: Params, trade: TradeNet, net: PairNet, q: number, W: number, ally: Uint8Array, out: Float64Array): number {
  const f = st.f, a = net.i[q], c = net.j[q], k = p.diplomacy.trust;
  out[0] = -k.fp * Math.abs(f.fp[a] - f.fp[c]);
  out[1] = -k.ideo * Math.abs(f.demo[a] - f.demo[c]);
  out[2] = k.trade * Math.log(1 + 10 * tradeDep(st, trade, net, q, W));
  out[3] = ally[q] ? k.ally : 0;
  out[4] = k.rel * (relSim(st, a, c) - 0.5);
  out[5] = -k.grievance * st.pair.grievance[q];
  out[6] = -k.sanctions * Math.max(st.pair.sancIJ[q], st.pair.sancJI[q]);
  return k.c + out[0] + out[1] + out[2] + out[3] + out[4] + out[5] + out[6];
}

/** Trust drivers D for pair q as named parts (the inspector's "why"). */
export function trustDrivers(st: WorldState, p: Params, trade: TradeNet, net: PairNet, q: number, W: number, ally: Uint8Array) {
  const total = driverValues(st, p, trade, net, q, W, ally, scratch);
  return { parts: Object.fromEntries(DRIVERS.map((k, i) => [k, scratch[i]])) as Record<(typeof DRIVERS)[number], number>, total };
}

/** i's perception of threat from j over pair q. */
const threatOf = (st: WorldState, net: PairNet, q: number, from: number, to: number) =>
  net.prox[q] * (st.f.milCap[to] / (st.f.milCap[from] + st.f.milCap[to] + 1)) * (1 - st.pair.trust[q]) / 2;

/** Solve the additive constant so a set of saturating hazards sums to a target rate. */
function solveOffset(z: number[], hmax: number, target: number): number {
  let lo = -60, hi = 30;
  for (let it = 0; it < 80; it++) {
    const mid = (lo + hi) / 2, tot = z.reduce((s, x) => s + hmax * logistic(x + mid), 0);
    if (tot > target) hi = mid; else lo = mid;
  }
  return (lo + hi) / 2;
}

export function initDiplomacy(st: WorldState, b: Baseline, p: Params, trade: TradeNet, net: PairNet): void {
  const idx = new Map(b.countries.map((c, k) => [c.id, k])), f = st.f;
  st.treaties = b.meta.diplomacy.treaties.map((t) => ({ id: t.id, label: t.label ?? null, members: t.members.map((m) => idx.get(m)!).sort((x, y) => x - y), since: t.since }));
  for (let c = 0; c < st.n; c++) { f.fp[c] = f.fp0[c] = b.countries[c].fields.unIdeal!.v; f.demoPrevY[c] = f.demo[c]; }
  for (const s of b.meta.diplomacy.sanctions) {
    if (s.sender === 'UN') { f.unSanction[idx.get(s.target)!] = s.intensity; continue; }
    const a = idx.get(s.sender)!, c = idx.get(s.target)!, q = pairOf(net, st.n, a, c);
    if (a < c) st.pair.sancIJ[q] = Math.max(st.pair.sancIJ[q], s.intensity); else st.pair.sancJI[q] = Math.max(st.pair.sancJI[q], s.intensity);
  }
  for (const g of b.meta.diplomacy.grievances) st.pair.grievance[pairOf(net, st.n, idx.get(g.a)!, idx.get(g.b)!)] = g.g;
  const W = worldGdp(f.gdp), ally = allyFlags(st, net);
  for (let q = 0; q < net.i.length; q++) st.pair.trust[q] = st.pair.trust0[q] = Math.tanh(driverValues(st, p, trade, net, q, W, ally, scratch));
  applyTradeEffects(st, p, trade, net);
  // hazard constants: world totals at baseline = observed base rates
  const P = p.diplomacy, z = scores(st, p, trade, net, W, ally);
  st.g.offCrisis = solveOffset(z.crisis, P.crisis.max, P.crisis.perYear);
  st.g.offSanction = solveOffset(z.sanction, P.sanctions.max, P.sanctions.perYear);
  st.g.offJoin = solveOffset(z.join, P.alliances.max, b.meta.baseRates.alliances.accessionsPerYear);
  st.g.offLeave = solveOffset(z.leave, P.alliances.max, b.meta.baseRates.alliances.exitsPerYear);
  st.g.offPact = solveOffset(z.pact, P.alliances.max, b.meta.baseRates.alliances.newTreatiesPerYear);
}

/** Recompute the political trade multipliers from sanctions and trust (also called after load). */
export function applyTradeEffects(st: WorldState, p: Params, trade: TradeNet, net: PairNet): void {
  const un = st.f.unSanction;
  for (let q = 0; q < net.i.length; q++) {
    const [ka, kc] = net.tradeK[q];
    if (ka < 0) continue;
    const m = (1 - p.diplomacy.sanctions.tradeCut * Math.max(st.pair.sancIJ[q], st.pair.sancJI[q], un[net.i[q]], un[net.j[q]]))
      * Math.exp(p.diplomacy.friendShoring * (st.pair.trust[q] - st.pair.trust0[q]));
    trade.mult[net.i[q]][ka] = m; trade.mult[net.j[q]][kc] = m;
  }
}

/** Main threat of each country (max perceived threat from non-allies) and its source. */
function mainThreats(st: WorldState, net: PairNet, ally: Uint8Array) {
  const T = new Float64Array(st.n), src = new Int32Array(st.n).fill(-1);
  for (let q = 0; q < net.i.length; q++) {
    const a = net.i[q], c = net.j[q];
    if (ally[q]) continue;
    const ta = threatOf(st, net, q, a, c), tc = threatOf(st, net, q, c, a);
    if (ta > T[a]) { T[a] = ta; src[a] = c; }
    if (tc > T[c]) { T[c] = tc; src[c] = a; }
  }
  return { T, src };
}

/** Risk scores (before the calibrated constant) for every candidate decision, in a fixed order. */
function scores(st: WorldState, p: Params, trade: TradeNet, net: PairNet, W: number, ally: Uint8Array) {
  const f = st.f, P = p.diplomacy, n = st.n;
  const crisis: number[] = [], sanction: number[] = [], join: number[] = [], leave: number[] = [], pact: number[] = [];
  const { T, src } = mainThreats(st, net, ally);
  // share of each country's treaty partners already sanctioning a target (coalitions)
  for (let q = 0; q < net.i.length; q++) {
    const a = net.i[q], c = net.j[q], tr = st.pair.trust[q], g = st.pair.grievance[q];
    const ta = threatOf(st, net, q, a, c), tc = threatOf(st, net, q, c, a);
    const k = P.crisis;
    crisis.push(net.prox[q] < 0.3 ? -Infinity : k.threat * (ta + tc) + k.grievance * g - k.trust * tr + k.unrest * Math.max(f.unrest[a], f.unrest[c]));
    for (let dir = 0; dir < 2; dir++) {
      const s = dir ? c : a, t = dir ? a : c, on = dir ? st.pair.sancJI[q] : st.pair.sancIJ[q];
      // sanctions need a trigger on the target (a coup, a democratic crackdown, a security threat to the sender or an
      // active conflict); distrust alone (e.g. different UN voting) is not one. Senders are almost always the larger
      // economy, and do not sanction partners they trust; sanctions in force cannot start again.
      const trigger = f.coupMem[t] + 5 * Math.max(0, f.demoPrevY[t] - f.demo[t]) + threatOf(st, net, q, s, t) + Math.max(0, g - 1); // only serious conflict history
      if (on > 0 || f.gdp[s] < f.gdp[t] || tr > P.sanctions.maxTrust || trigger < P.sanctions.trigger) { sanction.push(-Infinity); continue; }
      const ks = P.sanctions;
      sanction.push(ks.coup * f.demo[s] * f.coupMem[t] + ks.threat * threatOf(st, net, q, s, t) + ks.grievance * g - ks.trust * tr
        - ks.trade * tradeDep(st, trade, net, q, W) * 10 + ks.size * Math.log(f.gdp[s] / f.gdp[t]) + ks.coalition * allySanctioning(st, net, s, t));
    }
    const sharedThreat = Math.sqrt(T[a] * T[c]);
    pact.push(ally[q] || tr < P.alliances.accept ? -Infinity : P.alliances.trust * tr + P.alliances.threat * sharedThreat * 10 + P.alliances.region * net.prox[q]);
  }
  for (let c = 0; c < n; c++) {
    for (const t of st.treaties) {
      const meanTrust = treatyTrust(st, net, c, t);
      let cap = 0; for (const m of t.members) if (m !== c) cap += f.milCap[m];
      const prot = src[c] >= 0 ? cap / (cap + f.milCap[src[c]] + 1) : 0;
      // members weigh distrust of their partners against the protection the treaty gives
      // exits come from members whose alignment has changed (distrust of partners); trusted alliances do not decay by noise
      if (t.members.includes(c)) { leave.push(meanTrust > P.alliances.leaveTrust ? -Infinity : -P.alliances.trust * meanTrust - P.alliances.threat * T[c] * prot * 10); join.push(-Infinity); continue; }
      leave.push(-Infinity);
      // only multilateral treaties take new members (bilateral pacts are not open to accession), and members must
      // trust the applicant on average (checked here so the calibrated rate already includes acceptance)
      if (Number.isNaN(meanTrust) || t.members.length < 3 || meanTrust <= P.alliances.accept) { join.push(-Infinity); continue; }
      join.push(P.alliances.trust * meanTrust + P.alliances.threat * T[c] * prot * 10 + P.alliances.region * treatyProx(st, net, c, t));
    }
  }
  return { crisis, sanction, join, leave, pact, T, src };
}

/** Mean trust between c and a treaty's (other) members; members without a relation count as neutral (0).
 *  NaN if c has no relation with any member. */
function treatyTrust(st: WorldState, net: PairNet, c: number, t: Treaty): number {
  let s = 0, k = 0, known = 0;
  for (const m of t.members) {
    if (m === c) continue;
    k++;
    const q = pairOf(net, st.n, c, m);
    if (q >= 0) { s += st.pair.trust[q]; known++; }
  }
  return known ? s / k : NaN;
}

/** Mean proximity between c and a treaty's members (alliances are mostly regional). */
function treatyProx(st: WorldState, net: PairNet, c: number, t: Treaty): number {
  let s = 0, k = 0;
  for (const m of t.members) { if (m === c) continue; k++; const q = pairOf(net, st.n, c, m); if (q >= 0) s += net.prox[q]; }
  return k ? s / k : 0;
}

function allySanctioning(st: WorldState, net: PairNet, s: number, t: number): number {
  let allies = 0, on = 0;
  for (const tr of st.treaties) {
    if (!tr.members.includes(s)) continue;
    for (const m of tr.members) {
      if (m === s || m === t) continue;
      allies++;
      const q = pairOf(net, st.n, m, t);
      if (q >= 0 && (m < t ? st.pair.sancIJ[q] : st.pair.sancJI[q]) > 0) on++;
    }
  }
  return allies ? on / allies : 0;
}

function emit(st: WorldState, e: Omit<SimEvent, 'd'>) { st.events.push({ d: st.day, ...e }); }

export function diplomacyYearly(st: WorldState, b: Baseline, p: Params, rng: Rng, trade: TradeNet, net: PairNet): void {
  const f = st.f, P = p.diplomacy, n = st.n, W = worldGdp(f.gdp);
  const relax = 1 - Math.exp(-1 / P.trustYears), gDecay = Math.exp(-1 / P.grievanceYears);
  // foreign-policy position moves with regime change (cross-sectional UN-voting slope on democracy)
  for (let c = 0; c < n; c++) f.fp[c] = f.fp0[c] + b.meta.diplomacy.foreignPolicy.slopeOnDemocracy * (f.demo[c] - f.demo0[c]);
  // 1. relations
  const ally = allyFlags(st, net);
  for (let q = 0; q < net.i.length; q++) {
    st.pair.grievance[q] *= gDecay;
    st.pair.trust[q] += (Math.tanh(driverValues(st, p, trade, net, q, W, ally, scratch)) - st.pair.trust[q]) * relax;
  }
  // 2. decisions: scores are computed once from the state at the start of the step (order independence);
  //    every candidate always consumes one random number
  const z = scores(st, p, trade, net, W, ally);
  let iC = 0, iS = 0, iP = 0;
  for (let q = 0; q < net.i.length; q++) {
    const a = net.i[q], c = net.j[q];
    const uC = rng.next(), uS1 = rng.next(), uS2 = rng.next(), uL1 = rng.next(), uL2 = rng.next(), uP = rng.next();
    const tr = st.pair.trust[q];
    const why = () => ({ trust: tr, grievance: st.pair.grievance[q], threatAB: threatOf(st, net, q, a, c), threatBA: threatOf(st, net, q, c, a) });
    // crises
    const zc = z.crisis[iC++];
    if (uC < P.crisis.max * logistic(zc + st.g.offCrisis)) {
      emit(st, { k: 'diplomatic_crisis', c: a, o: c, x: { ...why(), unrest: Math.max(f.unrest[a], f.unrest[c]) } });
      st.pair.grievance[q] += P.crisis.grievanceAdd; st.pair.trust[q] = Math.max(-1, tr - P.crisis.trustLoss);
    }
    // sanctions, both directions
    for (const [s, t, field, uS, uL] of [[a, c, 'sancIJ', uS1, uL1], [c, a, 'sancJI', uS2, uL2]] as const) {
      const zs = z.sanction[iS++];
      if (st.pair[field][q] > 0) {
        if (uL < P.sanctions.liftBase * Math.exp(P.sanctions.liftTrust * tr)) {
          st.pair[field][q] = 0;
          emit(st, { k: 'sanctions_lifted', c: s, o: t, x: why() });
        }
      } else if (uS < P.sanctions.max * logistic(zs + st.g.offSanction)) {
        const intensity = tr < -0.5 ? 1 : 0.4;
        st.pair[field][q] = intensity; st.pair.grievance[q] += P.sanctions.grievanceAdd;
        emit(st, { k: 'sanctions_imposed', c: s, o: t, v: intensity, x: { ...why(), coupMemory: f.coupMem[t], allies: allySanctioning(st, net, s, t), tradeDep: tradeDep(st, trade, net, q, W) } });
      }
    }
    // new bilateral defence pact
    const zp = z.pact[iP++];
    if (uP < P.alliances.max * logistic(zp + st.g.offPact)) {
      const id = `SIM${st.events.length}`;
      st.treaties.push({ id, label: null, members: [a, c], since: Math.floor(st.day / 365.25) + 1970 });
      emit(st, { k: 'alliance_formed', c: a, o: c, x: { ...why(), threatA: z.T[a], threatB: z.T[c] } });
    }
  }
  // treaty accession / exit (per country × treaty, fixed order; treaty list may grow above, new ones are skipped)
  let iT = 0;
  const nT = z.join.length / n;
  for (let c = 0; c < n; c++) {
    for (let k = 0; k < nT; k++, iT++) {
      const uJ = rng.next(), uX = rng.next(), t = st.treaties[k];
      if (t.members.includes(c)) {
        if (uX < P.alliances.max * logistic(z.leave[iT] + st.g.offLeave)) {
          t.members = t.members.filter((m) => m !== c);
          emit(st, { k: 'alliance_left', c, o: t.members[0] ?? -1, v: t.members.length, x: { trustInMembers: treatyTrust(st, net, c, t) } });
        }
      } else if (Number.isFinite(z.join[iT]) && uJ < P.alliances.max * logistic(z.join[iT] + st.g.offJoin)) {
        t.members = [...t.members, c].sort((x, y) => x - y);
        emit(st, { k: 'alliance_joined', c, o: t.members.find((m) => m !== c) ?? -1, v: t.members.length, x: { trustInMembers: treatyTrust(st, net, c, t), threat: z.T[c], threatFrom: z.src[c] } });
      }
    }
  }
  st.treaties = st.treaties.filter((t) => t.members.length >= 2);
  // UN Security Council regimes: lifted collectively, more likely after democratisation (fixed draw per country)
  for (let c = 0; c < n; c++) {
    const u = rng.next();
    if (f.unSanction[c] > 0 && u < P.sanctions.unLiftBase * Math.exp(P.sanctions.unLiftDemocracy * Math.max(0, f.demo[c] - f.demo0[c]))) {
      f.unSanction[c] = 0;
      emit(st, { k: 'un_sanctions_lifted', c, x: { demo: f.demo[c], demo0: f.demo0[c] } });
    }
  }
  // 3. consequences: trade multipliers, productivity loss of sanctioned countries
  applyTradeEffects(st, p, trade, net);
  const load = Float64Array.from(f.unSanction, (u, c) => u * (1 - f.gdp[c] / W));
  for (let q = 0; q < net.i.length; q++) {
    load[net.j[q]] += st.pair.sancIJ[q] * f.gdp[net.i[q]] / W;
    load[net.i[q]] += st.pair.sancJI[q] * f.gdp[net.j[q]] / W;
  }
  for (let c = 0; c < n; c++) {
    f.demoPrevY[c] = f.demo[c];
    f.sanctionLoad[c] = load[c];
    f.A[c] *= Math.exp(-P.sanctions.productivityCost * Math.min(1, P.sanctions.loadScale * load[c]));
  }
}

/** Treaty label for display: the curated name, or the largest members. */
export function treatyLabel(t: Treaty, name: (c: number) => string): string {
  return t.label ?? `${t.members.length === 2 ? 'Pact' : 'Treaty'}: ${t.members.slice(0, 3).map(name).join(', ')}${t.members.length > 3 ? ` +${t.members.length - 3}` : ''}`;
}
