// Armed conflict: monthly fighting for wars under way, yearly onsets (after diplomacy).
//
// Onset (yearly). Civil conflict: a country-year logit (population, income, electoral autocracy, unrest, religious
//   polarisation, youth bulge, conflict trap, neighbours at war). Interstate: a pair-year logit over the diplomatic
//   pair list (contiguity, grievance, distrust, power parity, joint democracy, shared alliance, nuclear deterrence).
//   Both constants are solved at t0 so the expected world rate equals the UCDP rate of the 34 years before the start.
// Fighting (monthly). The score (−1..1) drifts with the balance of strength: military capital × reach (falls with
//   distance), defenders fight at home with an advantage, a government's strength scales with its legitimacy and
//   rebels' with unrest. Battle deaths per year are lognormal (a level drawn per war, a monthly AR(1) deviation);
//   combatants die among men 18-40, civilians across ages; refugees flee to land neighbours. Capital and productivity
//   are destroyed in proportion to the war load on the territory. Belligerents mobilise (military spending rises).
//   An attacker that is winning occupies part of the defender's territory, province by province from the border.
// Termination: Lomax hazard α/(τ + t) (long wars become ever less likely to end in any given month, as in UCDP),
//   raised when one side is clearly winning. Outcomes follow the score: victory, ceasefire on the current line
//   (occupied provinces change hands with their people, capital and output), imposed regime change, rebel victory
//   (regime change or autonomy), peace agreement, or fighting fading out.
// Nuclear use is possible only for a nuclear state whose own territory is heavily occupied or whose government a
//   foreign army is overthrowing; its consequences are catastrophic and global.
import type { Baseline } from '../types';
import type { Params } from '../params';
import { Rng } from '../rng';
import type { WorldState, War, SimEvent } from '../state';
import { cohortIndex, AGES, totalPop } from '../state';
import { parseDate } from '../calendar';
import { aggregate, gdpPppPc } from './demography';
import { youthShare } from './politics';
import { religionIndices } from './religion';
import { pairOf, allyFlags, type PairNet } from './diplomacy';

const MONTH = 1 / 12;
const logistic = (x: number) => 1 / (1 + Math.exp(-x));
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/** Geography for fighting, derived from the baseline only (rebuilt identically on load and replay). */
export interface ConflictNet {
  dist: Float64Array;   // n × n centroid distance, km
  contig: Uint8Array;   // n × n land neighbours
  nbrs: number[][];     // land neighbours per country
  nuclear: Uint8Array;  // nuclear-armed states
  provNb: number[][];   // land-neighbouring provinces
  provW: Float64Array;  // province population at the start (relative weights for territory)
  provC: [number, number][]; // province centroids
}

export function buildConflictNet(b: Baseline): ConflictNet {
  const n = b.countries.length, idx = new Map(b.countries.map((c, k) => [c.id, k]));
  const dist = new Float64Array(n * n), contig = new Uint8Array(n * n), nbrs: number[][] = Array.from({ length: n }, () => []);
  const r = Math.PI / 180;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const [lo1, la1] = b.countries[i].geo.centroid, [lo2, la2] = b.countries[j].geo.centroid;
    const h = Math.sin(((la2 - la1) * r) / 2) ** 2 + Math.cos(la1 * r) * Math.cos(la2 * r) * Math.sin(((lo2 - lo1) * r) / 2) ** 2;
    dist[i * n + j] = 2 * 6371 * Math.asin(Math.sqrt(h));
  }
  const owner = new Map(b.regions.map((rg) => [rg.id, rg.owner]));
  for (const rg of b.regions) {
    const i = rg.owner ? idx.get(rg.owner) : undefined;
    if (i === undefined) continue;
    for (const nb of rg.landNeighbors) {
      const o = owner.get(nb), j = o ? idx.get(o) : undefined;
      if (j !== undefined && j !== i && !contig[i * n + j]) { contig[i * n + j] = contig[j * n + i] = 1; nbrs[i].push(j); nbrs[j].push(i); }
    }
  }
  nbrs.forEach((l) => l.sort((x, y) => x - y));
  const nuclear = new Uint8Array(n);
  for (const id of b.meta.conflict.nuclear) nuclear[idx.get(id)!] = 1;
  return { dist, contig, nbrs, nuclear, provNb: b.provinces.map((p) => p.nb), provW: Float64Array.from(b.provinces.map((p) => p.pop)), provC: b.provinces.map((p) => p.centroid) };
}

/** Military capital, with a floor of 1% of GDP accumulated (SIPRI has no figure for some states at war, e.g. Syria). */
const effMil = (st: WorldState, p: Params, c: number) => Math.max(st.f.milCap[c], (0.01 * st.f.gdp[c]) / p.milDepreciation);
const reach = (net: ConflictNet, p: Params, n: number, c: number, loc: number) =>
  c === loc || net.contig[c * n + loc] ? 1 : 1 / (1 + net.dist[c * n + loc] / p.conflict.fight.reachKm);

function emit(st: WorldState, e: Omit<SimEvent, 'd'>) { st.events.push({ d: st.day, ...e }); }

/** Pairs that can fight: land neighbours; otherwise one of the largest militaries (power projection) and a quarrel
 *  (grievance from past disputes): great powers do not attack distant states they have no history with. */
function canFight(st: WorldState, p: Params, net: ConflictNet): (i: number, j: number, q: number) => boolean {
  const n = st.n, rank = Array.from({ length: n }, (_, c) => c).sort((x, y) => effMil(st, p, y) - effMil(st, p, x) || x - y);
  const major = new Uint8Array(n);
  for (const c of rank.slice(0, p.conflict.interstate.projection)) major[c] = 1;
  return (i, j, q) => net.contig[i * n + j] === 1 || ((major[i] === 1 || major[j] === 1) && st.pair.grievance[q] > p.conflict.interstate.distantGrievance);
}

/** 1 for countries fighting an interstate war. */
function interstateFlags(st: WorldState): Uint8Array {
  const out = new Uint8Array(st.n);
  for (const w of st.wars) if (w.kind === 'interstate') { for (const c of w.a) out[c] = 1; for (const c of w.b) out[c] = 1; }
  return out;
}
const inCivilWar = (st: WorldState, c: number) => st.wars.some((w) => w.kind === 'civil' && w.loc === c);

// ------------------------------------------------------------------ onset scores

function civilZ(st: WorldState, p: Params, net: ConflictNet, c: number): number {
  const f = st.f, k = p.conflict.civil;
  const nbrWar = net.nbrs[c].some((j) => f.warLoad[j] > 0.5) ? 1 : 0;
  return k.pop * Math.log(totalPop(st, c) / 1e7) - k.income * Math.log(gdpPppPc(st, c) / 5000) + k.anocracy * (f.regime[c] === 1 ? 1 : 0) - k.liberal * (f.regime[c] === 3 ? 1 : 0)
    + k.unrest * (f.unrest[c] - 0.3) + k.polarisation * f.relPolar[c] + k.youth * (youthShare(st, c) - 0.3) + k.memory * f.warMem[c] + k.neighbour * nbrWar;
}

/** Nuclear umbrella: own arsenal (1) or a defence treaty with a nuclear state (0.5). */
function umbrella(st: WorldState, net: ConflictNet): Float64Array {
  const u = new Float64Array(st.n);
  for (let c = 0; c < st.n; c++) if (net.nuclear[c]) u[c] = 1;
  for (const t of st.treaties) if (t.members.some((m) => net.nuclear[m])) for (const m of t.members) u[m] = Math.max(u[m], 0.5);
  return u;
}

function interZ(st: WorldState, p: Params, net: ConflictNet, pn: PairNet, q: number, ally: Uint8Array, umb: Float64Array): number {
  const f = st.f, k = p.conflict.interstate, i = pn.i[q], j = pn.j[q], n = st.n;
  const mi = effMil(st, p, i) * reach(net, p, n, i, j), mj = effMil(st, p, j) * reach(net, p, n, j, i);
  const parity = 1 - Math.min(1, Math.abs(Math.log((mi + 1) / (mj + 1))) / 3);
  return k.contiguity * (net.contig[i * n + j] ? 1 : 0) + k.grievance * st.pair.grievance[q] - k.distrust * st.pair.trust[q]
    - k.jointDemocracy * (f.demo[i] > 0.5 && f.demo[j] > 0.5 ? 1 : 0) + k.parity * parity - k.alliance * ally[q]
    - k.nuclear * Math.max(umb[i], umb[j]) + k.unrest * Math.max(f.unrest[i], f.unrest[j]);
}

/** Additive constant so Σ max·logistic(z + c) equals the target rate. */
function solveOffset(z: number[], max: number, target: number): number {
  let lo = -40, hi = 20;
  for (let it = 0; it < 60; it++) {
    const mid = (lo + hi) / 2;
    if (z.reduce((s, x) => s + max * logistic(x + mid), 0) > target) hi = mid; else lo = mid;
  }
  return (lo + hi) / 2;
}

// ------------------------------------------------------------------ init

export function initConflict(st: WorldState, b: Baseline, p: Params, net: ConflictNet, pn: PairNet): void {
  const f = st.f, idx = new Map(b.countries.map((c, k) => [c.id, k])), C = b.meta.conflict;
  for (let c = 0; c < st.n; c++) f.milex0[c] = f.milexShare[c];
  for (const a of C.active) {
    const loc = idx.get(a.loc);
    if (loc === undefined) continue;
    const side = (l: string[]) => l.map((x) => idx.get(x)).filter((x): x is number => x !== undefined);
    const A = side(a.a), B = side(a.b).filter((x) => !A.includes(x));
    if (a.kind === 'interstate' && (!A.length || !B.length)) continue;
    st.wars.push({
      id: st.g.warSeq++, kind: a.kind, a: a.kind === 'civil' ? [loc, ...A.filter((x) => x !== loc)] : A, b: B, loc,
      start: parseDate(a.start), goal: a.goal, name: a.name, sev: Math.log(Math.max(25, a.deaths)), lvl: 0, score: 0,
      occ: 0, held: [],
      deaths: 0, rate: Math.max(25, a.deaths), peak: Math.max(25, a.deaths),
    });
    f.warMem[loc] = 1;
  }
  // shortcut: occupation is curated only for Russia-Ukraine; UCDP has no front lines. At the end of 2023 Russia held
  // most of Luhansk and Donetsk and much of Zaporizhzhia (Crimea and Sevastopol are already Russian provinces in
  // Natural Earth's admin-1 data); here those three provinces. Other wars start with no occupation.
  for (const w of st.wars) {
    if (w.kind !== 'interstate' || st.ids[w.a[0]] !== 'RUS' || st.ids[w.loc] !== 'UKR') continue;
    w.held = b.provinces.map((pr, i) => (st.provinceOwner[i] === w.loc && /Luhansk|Donetsk|Zaporizh/.test(pr.name) ? i : -1)).filter((i) => i >= 0);
    w.occ = heldShare(st, net, w);
  }
  // conflict trap: memory of internal conflicts that ended before the start
  for (const [id, last] of Object.entries(C.civil.lastYear)) {
    const c = idx.get(id);
    if (c !== undefined && !f.warMem[c]) f.warMem[c] = Math.exp(-(b.meta.referenceYear - last) / p.conflict.memoryYears);
  }
  updateWarLoad(st);
  for (let c = 0; c < st.n; c++) f.warLoad0[c] = f.warLoad[c];
  // onset constants: expected world rates at t0 equal the UCDP rates
  const zc: number[] = [];
  for (let c = 0; c < st.n; c++) if (!inCivilWar(st, c) && totalPop(st, c) >= p.conflict.civil.minPop) zc.push(civilZ(st, p, net, c));
  st.g.offCivil = solveOffset(zc, p.conflict.civil.max, C.civil.onsetsPerYear);
  // same candidates as at run time: countries already in an interstate war start no second one
  const ally = allyFlags(st, pn), umb = umbrella(st, net), zi: number[] = [], fighting = interstateFlags(st), can = canFight(st, p, net);
  for (let q = 0; q < pn.i.length; q++) if (!fighting[pn.i[q]] && !fighting[pn.j[q]] && can(pn.i[q], pn.j[q], q)) zi.push(interZ(st, p, net, pn, q, ally, umb));
  st.g.offWar = solveOffset(zi, p.conflict.interstate.max, C.interstate.onsetsPerYear);
}

/** warLoad = ln(1 + battle deaths per person-year on the territory / 1e-4). */
function updateWarLoad(st: WorldState): void {
  const f = st.f;
  f.warLoad.fill(0);
  const rate = new Float64Array(st.n);
  for (const w of st.wars) rate[w.loc] += w.rate;
  for (let c = 0; c < st.n; c++) if (rate[c] > 0) f.warLoad[c] = Math.log1p(rate[c] / totalPop(st, c) / 1e-4);
}

// ------------------------------------------------------------------ people and territory

/** Remove n people from country c: combatants among men 18-40, civilians across all ages and both sexes. */
function kill(st: WorldState, c: number, n: number, combatants: boolean): void {
  const co = st.cohorts;
  if (combatants) {
    const o = cohortIndex(c, 1);
    let tot = 0;
    for (let x = 18; x <= 40; x++) tot += co[o + x];
    if (tot <= 0) return;
    const s = Math.min(0.5, n / tot);
    for (let x = 18; x <= 40; x++) co[o + x] *= 1 - s;
  } else {
    const P = totalPop(st, c);
    if (P <= 0) return;
    const s = Math.min(0.5, n / P);
    for (const sex of [0, 1]) { const o = cohortIndex(c, sex); for (let x = 0; x < AGES; x++) co[o + x] *= 1 - s; }
  }
}

/** Move a share of the population of `from` (all ages, both sexes) to `to`. */
function movePeople(st: WorldState, from: number, to: number, share: number): number {
  const co = st.cohorts, R = st.nRel;
  const moved = totalPop(st, from) * share, before = totalPop(st, to);
  for (let r = 0; r < R; r++) st.religion[to * R + r] = (st.religion[to * R + r] * before + st.religion[from * R + r] * moved) / (before + moved);
  for (const sex of [0, 1]) {
    const a = cohortIndex(from, sex), b = cohortIndex(to, sex);
    for (let x = 0; x < AGES; x++) { const m = co[a + x] * share; co[a + x] -= m; co[b + x] += m; }
  }
  return moved;
}

/** Share of loc's (start-of-history) population living in the provinces the attacker holds. */
function heldShare(st: WorldState, net: ConflictNet, w: War): number {
  let W = 0, H = 0;
  for (let i = 0; i < st.provinceOwner.length; i++) if (st.provinceOwner[i] === w.loc) W += net.provW[i];
  for (const i of w.held) H += net.provW[i];
  return W > 0 ? H / W : 0;
}

/** Move the front so the provinces held approximate the occupied share: advance from the border (provinces touching
 *  the attacker's territory or what it already holds, most-surrounded first), retreat in reverse order of capture. */
function updateHeld(st: WorldState, net: ConflictNet, w: War): void {
  const own = st.provinceOwner, loc = w.loc;
  w.held = w.held.filter((i) => own[i] === loc);
  let W = 0;
  for (let i = 0; i < own.length; i++) if (own[i] === loc) W += net.provW[i];
  if (W <= 0) { w.held.length = 0; return; }
  const held = new Set(w.held), side = new Set(w.kind === 'interstate' ? w.a : []); // rebels have no territory outside
  let share = w.held.reduce((s, i) => s + net.provW[i], 0) / W;
  while (w.held.length && share - w.occ > net.provW[w.held[w.held.length - 1]] / W / 2) { const i = w.held.pop()!; held.delete(i); share -= net.provW[i] / W; }
  for (let guard = 0; guard < 400; guard++) {
    let best = -1, bestScore = 0;
    for (let i = 0; i < own.length; i++) {
      if (own[i] !== loc || held.has(i)) continue;
      let sc = 0;
      for (const j of net.provNb[i]) if (held.has(j) || side.has(own[j])) sc++;
      if (sc > bestScore) { best = i; bestScore = sc; }
    }
    if (best < 0 && w.kind === 'civil') best = rebelSeed(st, net, w, held);
    if (best < 0) { // no land front (across the sea): the province nearest the attacker's territory
      let d = Infinity;
      const ac = net.provC.filter((_, i) => side.has(own[i]));
      for (let i = 0; i < own.length; i++) if (own[i] === loc && !held.has(i)) for (const [lo, la] of ac) {
        const dd = (net.provC[i][0] - lo) ** 2 + (net.provC[i][1] - la) ** 2;
        if (dd < d) { d = dd; best = i; }
      }
    }
    if (best < 0 || w.occ - share <= net.provW[best] / W / 2) break;
    w.held.push(best); held.add(best); share += net.provW[best] / W;
  }
}

/** Where a rebellion takes hold: the province farthest from the country's most populous one (the periphery). */
function rebelSeed(st: WorldState, net: ConflictNet, w: War, held: Set<number>): number {
  const own = st.provinceOwner;
  let core = -1, best = -1, d = -1;
  for (let i = 0; i < own.length; i++) if (own[i] === w.loc && (core < 0 || net.provW[i] > net.provW[core])) core = i;
  if (core < 0) return -1;
  const [lo0, la0] = net.provC[core], k = Math.cos((la0 * Math.PI) / 180);
  for (let i = 0; i < own.length; i++) {
    if (own[i] !== w.loc || held.has(i) || i === core) continue;
    const dd = ((net.provC[i][0] - lo0) * k) ** 2 + (net.provC[i][1] - la0) ** 2;
    if (dd > d) { d = dd; best = i; }
  }
  return best;
}

/** Territory changes hands: a share of the population, capital and output moves from `from` to `to`.
 *  Public debt stays with the state that owed it. Returns the number of people moved. */
export function transferTerritory(st: WorldState, from: number, to: number, share: number): number {
  const f = st.f;
  const moved = movePeople(st, from, to, share);
  for (const k of ['K', 'gdp', 'gdpPrevQ', 'gdpPrevY'] as const) { const m = f[k][from] * share; f[k][from] -= m; f[k][to] += m; }
  aggregate(st, from); aggregate(st, to);
  religionIndices(st, from); religionIndices(st, to);
  return moved;
}

// ------------------------------------------------------------------ monthly fighting

/** Military aid to `lead` from non-belligerents that trust it much more than its enemy. */
function aid(st: WorldState, p: Params, pn: PairNet, w: War, lead: number, enemy: number): number {
  const A = p.conflict.aid;
  let s = 0;
  for (const q of pn.of[lead]) {
    const m = pn.i[q] === lead ? pn.j[q] : pn.i[q];
    if (w.a.includes(m) || w.b.includes(m)) continue;
    const qe = pairOf(pn, st.n, m, enemy), d = st.pair.trust[q] - (qe >= 0 ? st.pair.trust[qe] : 0);
    if (d > A.min) s += A.share * (d - A.min) * effMil(st, p, m);
  }
  return s;
}

function strength(st: WorldState, p: Params, net: ConflictNet, pn: PairNet, w: War): [number, number] {
  const f = st.f, F = p.conflict.fight, n = st.n;
  let A = 0, B = 0;
  if (w.kind === 'civil') {
    for (const c of w.a) A += effMil(st, p, c) * reach(net, p, n, c, w.loc) * (c === w.loc ? 0.5 + f.legit[c] : 0.5);
    B = F.rebelBase * effMil(st, p, w.loc) * (0.5 + f.unrest[w.loc]);
    for (const c of w.b) B += 0.5 * effMil(st, p, c) * reach(net, p, n, c, w.loc); // backers send aid and advisers, not armies
  } else {
    for (const c of w.a) A += effMil(st, p, c) * reach(net, p, n, c, w.loc);
    for (const c of w.b) B += effMil(st, p, c) * reach(net, p, n, c, w.loc) * (c === w.loc ? F.home : 1);
    A += aid(st, p, pn, w, w.a[0], w.b[0]); B += aid(st, p, pn, w, w.b[0], w.a[0]);
  }
  return [A, B];
}

function changeGovernment(st: WorldState, c: number) {
  const f = st.f;
  f.govYears[c] = 0; f.govTerms[c] = 0; f.approval[c] = 0.5; f.legit[c] = Math.min(f.legit[c], 0.4);
}

function endWar(st: WorldState, p: Params, net: ConflictNet, w: War, u: number, forceCeasefire = false): void {
  const f = st.f, x = { score: w.score, deaths: w.deaths, years: (st.day - w.start) / 365.25, occ: w.occ, id: w.id };
  const loser = w.loc, att = w.a[0], O = p.conflict.outcome;
  if (w.kind === 'civil') {
    if (w.score > O.victory) emit(st, { k: 'civil_war_won', c: loser, v: w.deaths, x });
    else if (w.score < -O.victory) {
      if (w.goal === 'government') {
        const democratic = u < 0.25;
        emit(st, { k: 'rebels_won', c: loser, v: democratic ? 1 : 0, x });
        changeGovernment(st, loser);
        if (democratic) { f.regime[loser] = 2; f.demo[loser] = Math.max(f.demo[loser], 0.5); f.nextElection[loser] = st.day + 365; }
        else { f.regime[loser] = 0; f.demo[loser] *= 0.6; f.nextElection[loser] = -1; }
      } else {
        emit(st, { k: 'autonomy_won', c: loser, v: w.deaths, x });
        f.unrest[loser] = Math.max(0.05, f.unrest[loser] * 0.8);
      }
    } else if (u < O.peace) {
      emit(st, { k: 'peace_deal', c: loser, v: w.deaths, x });
      f.demo[loser] = Math.min(0.95, f.demo[loser] + 0.02); f.unrest[loser] = Math.max(0.05, f.unrest[loser] * 0.8);
    } else emit(st, { k: 'conflict_faded', c: loser, v: w.deaths, x });
  } else {
    const ceasefire = forceCeasefire || Math.abs(w.score) <= O.victory;
    if (!ceasefire && w.score > 0) emit(st, { k: 'war_won', c: att, o: loser, v: w.deaths, x });
    else if (!ceasefire) emit(st, { k: 'war_won', c: loser, o: att, v: w.deaths, x });
    else emit(st, { k: 'ceasefire', c: att, o: loser, v: w.deaths, x });
    // the attacker keeps what it holds unless it lost; a victorious attacker fighting over government imposes one
    if (w.held.length && w.occ >= 0.05 && (ceasefire || w.score > 0) && w.goal === 'territory') { // small gains are handed back in the settlement
      const share = heldShare(st, net, w), provinces = w.held.length;
      for (const i of w.held) st.provinceOwner[i] = att;
      const moved = transferTerritory(st, loser, att, share);
      emit(st, { k: 'territory_annexed', c: att, o: loser, v: moved, x: { ...x, share, provinces } });
    }
    if (!ceasefire && w.score > 0 && w.goal === 'government') {
      emit(st, { k: 'regime_imposed', c: att, o: loser, x });
      changeGovernment(st, loser);
      f.demo[loser] = (f.demo[loser] + f.demo[att]) / 2;
      f.regime[loser] = f.demo[loser] > 0.5 ? 2 : f.demo[att] > 0.5 ? 1 : 0;
    }
  }
  st.wars.splice(st.wars.indexOf(w), 1);
}

function nuclearStrike(st: WorldState, p: Params, user: number, target: number, w: War): void {
  const N = p.conflict.nuclear, f = st.f;
  const dead = N.killShare * totalPop(st, target);
  kill(st, target, dead, false); aggregate(st, target);
  f.K[target] *= 1 - N.capital; f.A[target] *= 1 - N.tfp;
  st.g.oilLn += N.oilShock;
  for (let c = 0; c < st.n; c++) { f.cycle[c] -= 0.02; f.unrest[c] = Math.min(0.99, f.unrest[c] + 0.05); }
  emit(st, { k: 'nuclear_strike', c: user, o: target, v: dead, x: { score: w.score, occ: w.occ } });
}

export function conflictMonthly(st: WorldState, p: Params, rng: Rng, net: ConflictNet, pn: PairNet): void {
  const f = st.f, P = p.conflict, n = st.n;
  const belligerent = new Uint8Array(n), home = new Uint8Array(n);
  for (const w of st.wars.slice()) {
    // fixed draws per war per month
    const u1 = rng.normal(), u2 = rng.normal(), uEnd = rng.next(), uOut = rng.next(), uNuc = rng.next(), uRet = rng.next();
    const [A, B] = strength(st, p, net, pn, w);
    const bal = A + B > 0 ? (A - B) / (A + B) : 0;
    w.score = clamp(w.score + P.fight.kappa * bal * MONTH + P.fight.noise * Math.sqrt(MONTH) * u1, -1, 1);
    w.lvl = P.deaths.lvlRho * w.lvl + P.deaths.lvlSd * u2;
    const wasMinor = w.peak < 1000;
    // at most maxDeathShare of the population a year (Syria's worst years ≈ 0.35%, Ukraine 2023 ≈ 0.2%)
    w.rate = Math.min(Math.exp(w.sev + w.lvl), P.damage.maxDeathShare * totalPop(st, w.loc)); w.peak = Math.max(w.peak, w.rate);
    if (w.kind === 'civil' && wasMinor && w.peak >= 1000) emit(st, { k: 'civil_war_escalated', c: w.loc, v: w.rate });
    const md = w.rate * MONTH;
    w.deaths += md;
    if (w.kind === 'interstate') { w.occ = clamp(w.occ + P.fight.occSpeed * w.score * MONTH, 0, P.fight.maxOccupation); updateHeld(st, net, w); }
    else {
      // rebel-held territory: grows with the rebels' fortunes and the war's intensity, relaxes over ~6 months
      const target = w.peak < 1000 ? 0 : P.fight.rebelTerritory / (1 + Math.exp(3 * w.score)) * Math.sqrt(Math.min(1, w.rate / 1000)); // insurgencies below civil-war scale hold no territory
      w.occ += (target - w.occ) * (1 - Math.exp(-MONTH / 0.5));
      updateHeld(st, net, w);
    }
    // casualties: in civil wars all on the territory; in interstate wars split by the other side's strength
    if (w.kind === 'civil') kill(st, w.loc, md, true);
    else {
      const sa = A + B > 0 ? B / (A + B) : 0.5;
      kill(st, w.a[0], md * sa, true); kill(st, w.loc, md * (1 - sa), true);
    }
    kill(st, w.loc, md * P.damage.civiliansPerDeath, false);
    // refugees to land neighbours, by population (lost if there is none); at most maxRefugeeShare of the population a month
    const refugees = Math.min(P.damage.maxRefugeeShare * totalPop(st, w.loc), md * P.damage.refugeesPerDeath), nb = net.nbrs[w.loc].filter((j) => !belligerent[j] && j !== w.a[0]);
    const nbPop = nb.reduce((s, j) => s + totalPop(st, j), 0);
    if (refugees > 0) {
      if (nbPop > 0) for (const j of nb) movePeople(st, w.loc, j, (refugees * totalPop(st, j)) / nbPop / totalPop(st, w.loc));
      else kill(st, w.loc, refugees, false);
    }
    for (const c of w.a) belligerent[c] = 1;
    for (const c of w.b) belligerent[c] = 1;
    home[w.loc] = 1;
    // nuclear use by a nuclear defender facing occupation or a foreign-imposed change of government
    if (w.kind === 'interstate' && net.nuclear[w.loc] && (w.occ > P.nuclear.occupied || (w.goal === 'government' && w.score > 0.7)) && uNuc < P.nuclear.useMonthly) {
      nuclearStrike(st, p, w.loc, w.a[0], w);
      if (net.nuclear[w.a[0]] && uRet < P.nuclear.retaliate) nuclearStrike(st, p, w.a[0], w.loc, w);
      w.occ = 0; w.held = [];
      endWar(st, p, net, w, uOut, true);
      continue;
    }
    const t = (st.day - w.start) / 365.25, D = P.duration;
    const h = (w.kind === 'civil' ? D.civilAlpha / (D.civilTau + t) : D.interAlpha / (D.interTau + t)) * (1 + D.decisive * w.score * w.score);
    if (uEnd < 1 - Math.exp(-h * MONTH)) endWar(st, p, net, w, uOut);
  }
  for (let c = 0; c < n; c++) if (home[c] || belligerent[c]) aggregate(st, c);
  updateWarLoad(st);
  const mem = Math.exp(-MONTH / P.memoryYears), M = P.mobilise;
  for (let c = 0; c < n; c++) {
    f.warMem[c] = home[c] ? 1 : f.warMem[c] * mem;
    if (f.warLoad[c] > 0) { f.K[c] *= Math.exp(-P.damage.capital * f.warLoad[c] * MONTH); f.A[c] *= Math.exp(-P.damage.tfp * f.warLoad[c] * MONTH); }
    // mobilisation: belligerents raise military spending; afterwards it returns to the pre-war level
    const target = belligerent[c] ? Math.max(f.milex0[c], M.base + M.home * Math.min(1, f.warLoad[c] / 3) * home[c]) : f.milex0[c];
    f.milexShare[c] += (target - f.milexShare[c]) * (1 - Math.exp(-MONTH / (belligerent[c] ? M.years : M.demobYears)));
  }
}

// ------------------------------------------------------------------ yearly onsets

export function conflictYearly(st: WorldState, p: Params, rng: Rng, net: ConflictNet, pn: PairNet): void {
  const f = st.f, P = p.conflict, n = st.n;
  // civil conflicts: every country draws the same numbers whatever happens (keeps branches comparable)
  for (let c = 0; c < n; c++) {
    const u = rng.next(), uSev = rng.normal(), uGoal = rng.next();
    if (inCivilWar(st, c) || totalPop(st, c) < P.civil.minPop) continue;
    const z = civilZ(st, p, net, c) + st.g.offCivil;
    if (u >= P.civil.max * logistic(z)) continue;
    const sev = Math.log(P.deaths.civilMedian) + P.deaths.civilSd * uSev;
    st.wars.push({ id: st.g.warSeq++, kind: 'civil', a: [c], b: [], loc: c, start: st.day, goal: uGoal < 0.5 ? 'territory' : 'government', name: null,
      sev, lvl: 0, score: 0, occ: 0, held: [], deaths: 0, rate: Math.exp(sev), peak: Math.exp(sev) });
    f.warMem[c] = 1;
    emit(st, { k: 'civil_war_started', c, v: Math.exp(sev), x: { unrest: f.unrest[c], income: gdpPppPc(st, c), regime: f.regime[c], polar: f.relPolar[c], hazard: P.civil.max * logistic(z) } });
  }
  // interstate wars
  const ally = allyFlags(st, pn), umb = umbrella(st, net), fighting = interstateFlags(st), can = canFight(st, p, net); // one interstate war at a time
  for (let q = 0; q < pn.i.length; q++) {
    const u = rng.next(), uSev = rng.normal(), uSub = rng.nextU32();
    const i = pn.i[q], j = pn.j[q];
    if (fighting[i] || fighting[j] || !can(i, j, q)) continue;
    const z = interZ(st, p, net, pn, q, ally, umb) + st.g.offWar;
    if (u >= P.interstate.max * logistic(z)) continue;
    // the attacker: the side with more usable force, discounted by democracy (democracies initiate less)
    const si = effMil(st, p, i) * reach(net, p, n, i, j) * (1.5 - f.demo[i]), sj = effMil(st, p, j) * reach(net, p, n, j, i) * (1.5 - f.demo[j]);
    const [att, def] = si >= sj ? [i, j] : [j, i];
    const sev = Math.log(P.deaths.interMedian) + P.deaths.interSd * uSev;
    const w: War = { id: st.g.warSeq++, kind: 'interstate', a: [att], b: [def], loc: def, start: st.day, goal: net.contig[att * n + def] ? 'territory' : 'government',
      name: null, sev, lvl: 0, score: 0, occ: 0, held: [], deaths: 0, rate: Math.exp(sev), peak: Math.exp(sev) };
    emit(st, { k: 'war_started', c: att, o: def, v: Math.exp(sev), x: { trust: st.pair.trust[q], grievance: st.pair.grievance[q], hazard: P.interstate.max * logistic(z) } });
    // allies honour defence treaties with a probability rising in trust; members of a treaty with both sides stay out
    const sub = new Rng(uSub);
    for (const [side, enemy, pJoin] of [[w.b, att, P.allies.join], [w.a, def, P.allies.attackerJoin]] as const) {
      const lead = side[0], cand = new Set<number>();
      const bilateral = new Set<number>();
      for (const t of st.treaties) if (t.members.includes(lead) && !t.members.includes(enemy)) for (const m of t.members) { cand.add(m); if (t.members.length === 2) bilateral.add(m); }
      for (const m of [...cand].sort((x, y) => x - y)) {
        const um = sub.next();
        if (m === att || m === def || w.a.includes(m) || w.b.includes(m) || fighting[m]) continue;
        const qm = pairOf(pn, n, m, lead), tr = qm >= 0 ? st.pair.trust[qm] : 0;
        const pm = pJoin * ((1 + tr) / 2) * reach(net, p, n, m, w.loc) * (bilateral.has(m) ? 1 : P.allies.multilateral);
        if (um < pm) { side.push(m); fighting[m] = 1; emit(st, { k: 'war_joined', c: m, o: enemy, x: { trust: tr, ally: lead } }); }
      }
    }
    for (const x of w.a) for (const y of w.b) {
      const qq = pairOf(pn, n, x, y);
      if (qq >= 0) { st.pair.grievance[qq] += P.allies.grievance; st.pair.trust[qq] = Math.max(-1, st.pair.trust[qq] - 0.3); }
    }
    f.approval[att] = Math.min(0.98, f.approval[att] + P.rally); f.approval[def] = Math.min(0.98, f.approval[def] + P.rally);
    fighting[att] = fighting[def] = 1;
    st.wars.push(w);
  }
}
