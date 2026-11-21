// Simulation: owns a WorldState and advances it through a fixed, documented update order.
//
// Time-step architecture (see docs/DESIGN.md §4). The clock is an integer day. Systems run on calendar boundaries:
//   1st of each month  : conflict (fighting, casualties, refugees, war damage, war endings)
//   1 Jan/Apr/Jul/Oct  : economy (quarterly: oil price, TFP, cycle, inflation, debt) -> politics (quarterly)
//                        -> chronicle (quarterly)
//   every 1 Jan        : demography (cohort-component step + transition) -> economy (yearly structure)
//                        -> religion (secularisation) -> diplomacy (relations, crises, sanctions, alliances)
//                        -> conflict (yearly: onsets of civil and interstate wars, allies joining)
//                        -> chronicle (yearly) -> history record
// On 1 January the economy's quarter runs before demography, so both read the population of the year just ended.
// Order within a boundary is fixed so each system reads a consistent state. Days between boundaries have no
// scheduled work in Phase 1, so advancing jumps from boundary to boundary (cost is independent of day count).
import type { Baseline } from './types';
import { DEFAULT_PARAMS, type Params } from './params';
import { Rng } from './rng';
import { civilFromDays, nextMonthStart } from './calendar';
import { createState, totalPop, hashState, HIST_FIELDS, type WorldState } from './state';
import { initDemography, initTransitionResiduals, demographyYearly } from './systems/demography';
import { initEconomy, initEconomyResiduals, economyQuarterly, economyYearly } from './systems/economy';
import { initEducation, educationYearly } from './systems/education';
import { initEthnic, ethnicYearly, rescaleGroups } from './systems/ethnic';
import { buildTrade, type TradeNet } from './systems/trade';
import { initReligion, religionYearly } from './systems/religion';
import { initPolitics, politicsQuarterly } from './systems/politics';
import { buildPairs, initDiplomacy, diplomacyYearly, applyTradeEffects, baselineSanction, type PairNet } from './systems/diplomacy';
import { PAIR_FIELDS, type PairField } from './state';
import { chronicleQuarterly, chronicleYearly } from './systems/chronicle';
import { buildConflictNet, initConflict, conflictMonthly, conflictYearly, transferTerritory, type ConflictNet, type SecessionRequest } from './systems/conflict';
import { extendBaseline, extendTrade, extendPairs, growState, type NewState } from './systems/secession';
import { initOrganisations, organisationsYearly } from './systems/organisations';
import { initParties, seizePower } from './systems/parties';
import { aggregate } from './systems/demography';

export const RNG_STREAMS = ['economy', 'commodity', 'politics', 'diplomacy', 'conflict', 'organisations', 'parties', 'ethnic'] as const;

export interface SimConfig { seed: number; startDate?: string; params?: Partial<Params> }

export class Simulation {
  /** the data the world started from (rewind replays from it) */
  readonly baseline0: Baseline;
  /** the start data plus countries born during the run (structures below grow with it) */
  baseline: Baseline;
  readonly params: Params;
  readonly startDate?: string;
  st: WorldState;
  /** Gravity trade network: derived from the baseline only, so it is rebuilt identically on load and replay. */
  trade: TradeNet;
  /** Diplomatic pair list: derived from the baseline only (like the trade network). */
  pairs: PairNet;
  /** Distances, land borders and nuclear states for the conflict system (baseline only). */
  cnet: ConflictNet;
  private rngs: Record<string, Rng> = {};

  constructor(baseline: Baseline, cfg: SimConfig) {
    this.baseline = this.baseline0 = baseline;
    this.params = { ...DEFAULT_PARAMS, ...cfg.params };
    this.startDate = cfg.startDate;
    this.st = createState(baseline, cfg.seed, cfg.startDate);
    initDemography(this.st, baseline, this.params);
    initEconomy(this.st, baseline, this.params);
    initTransitionResiduals(this.st, baseline);
    initEconomyResiduals(this.st, baseline);
    initEducation(this.st, baseline, this.params);
    const sanc = baselineSanction(baseline);
    this.trade = buildTrade(baseline, this.st.f.gdp, this.params, (i, j) => 1 - this.params.diplomacy.sanctions.tradeCut * sanc(i, j));
    this.pairs = buildPairs(baseline, this.trade, this.st.f.milCap, this.params);
    this.st.pair = Object.fromEntries(PAIR_FIELDS.map((k) => [k, new Float64Array(this.pairs.i.length)])) as Record<PairField, Float64Array>;
    initReligion(this.st, baseline);
    this.reseed(this.st.seed);
    initPolitics(this.st, baseline, this.params, this.rngs.politics);
    initParties(this.st, baseline, this.rngs.parties);
    initOrganisations(this.st, baseline);
    initDiplomacy(this.st, baseline, this.params, this.trade, this.pairs);
    this.cnet = buildConflictNet(baseline);
    initEthnic(this.st, baseline, this.params);
    initConflict(this.st, baseline, this.params, this.cnet, this.pairs);
    chronicleYearly(this.st); // establishes milestone levels at t0 without emitting
    this.recordHistory();
  }

  private reseed(seed: number) {
    for (const s of RNG_STREAMS) this.st.rng[s] = Rng.stream(seed, s).s;
    this.bindRngs();
  }
  /** RNG objects share their state arrays with st.rng, so draws are always reflected in saved state. */
  private bindRngs() {
    for (const s of RNG_STREAMS) { const r = new Rng(1); r.s = this.st.rng[s]; this.rngs[s] = r; }
  }

  /** Advance the clock to `target` (a day number), running every system boundary on the way. */
  advanceTo(target: number): void {
    const st = this.st;
    while (true) {
      const b = nextMonthStart(st.day);
      if (b > target) break;
      st.day = b;
      this.boundary(b);
    }
    if (target > st.day) st.day = target;
  }

  advanceDays(n: number) { this.advanceTo(this.st.day + n); }

  private boundary(day: number) {
    const { m } = civilFromDays(day);
    const st = this.st, p = this.params;
    for (const r of conflictMonthly(st, p, this.rngs.conflict, this.cnet, this.pairs)) this.secede(r);
    if ((m - 1) % 3 === 0) {
      economyQuarterly(st, p, this.rngs.economy, this.rngs.commodity, this.trade, (c, x) => st.events.push({ d: st.day, k: 'sovereign_default', c, v: x.debtRatio, x }));
      politicsQuarterly(st, p, this.rngs.politics, this.trade);
      chronicleQuarterly(st);
    }
    if (m === 1) {
      demographyYearly(st, this.baseline, p);
      economyYearly(st, this.baseline, p, this.trade);
      educationYearly(st, this.baseline, p);
      religionYearly(st, this.baseline, p);
      diplomacyYearly(st, this.baseline, p, this.rngs.diplomacy, this.trade, this.pairs);
      organisationsYearly(st, this.baseline, p, this.rngs.organisations, this.pairs);
      ethnicYearly(st, this.baseline, p, this.rngs.ethnic);
      conflictYearly(st, p, this.rngs.conflict, this.cnet, this.pairs);
      applyTradeEffects(st, p, this.trade, this.pairs); // new wars cut trust between belligerents: trade follows at once
      chronicleYearly(st);
      this.recordHistory();
    }
  }

  private recordHistory() {
    const { f, n, history } = this.st;
    history.years.push(civilFromDays(this.st.day).y);
    const push = (k: (typeof HIST_FIELDS)[number], fn: (c: number) => number) => { for (let c = 0; c < n; c++) history.data[k].push(Math.fround(fn(c))); };
    push('pop', (c) => totalPop(this.st, c));
    push('gdp', (c) => f.gdp[c]);
    push('gdpPc', (c) => f.gdp[c] / totalPop(this.st, c));
    push('tfr', (c) => f.tfr[c]);
    push('lifeExp', (c) => f.lifeExp[c]);
    push('debtRatio', (c) => f.debt[c] / f.gdp[c]);
    push('milCap', (c) => f.milCap[c]);
    push('old', (c) => f.p2[c] / totalPop(this.st, c));
    push('school', (c) => f.eduYears[c]);
  }

  /** Grow the structures derived from the baseline (trade, pairs, conflict geography) by a new state.
   *  Used when a state is born and, from the recorded NewState, when a save is loaded. Returns the pairs added. */
  extendStructure(ns: NewState): number {
    const parent = this.baseline.countries.findIndex((c) => c.id === ns.parent), c = this.baseline.countries.length;
    this.baseline = extendBaseline(this.baseline, ns);
    extendTrade(this.trade, this.baseline, this.params, parent, c);
    const added = extendPairs(this.pairs, this.baseline, this.trade, c + 1, parent, c);
    this.cnet = buildConflictNet(this.baseline);
    return added;
  }

  /** Rebels who won their territory found a state: its provinces, their share of the people, capital and output,
   *  a new government (democratic with probability secession.democratic), no debt, a small army. */
  private secede(r: SecessionRequest) {
    const st = this.st, b = this.baseline, parent = r.parent, c = st.n, f = st.f;
    // named after the disputed territory (UCDP) or the rebels' heartland, the first province they took
    const core = (r.territory ?? b.provinces[r.provinces[0]].name).split(' and ')[0]
      .replace(/\s+(Autonomous Okrug|Autonomous Region|Autonomous Oblast|Krai|State|Province|Region|Oblast|Governorate|District|Department|Prefecture|Division|County)$/i, '');
    let name = /^(North|South|East|West|Central|Coast|Northern|Southern|Eastern|Western|Upper|Lower|Highlands?|Islands?)\b/i.test(core) ? `${core} Republic` : `Republic of ${core}`;
    if (b.countries.some((x) => x.name === name || x.name === core)) name = `${name} (${b.countries[parent].name})`; // e.g. Palestine exists already
    const taken = new Set(r.provinces), neighbors = new Set<string>();
    for (const i of r.provinces) for (const j of b.provinces[i].nb) if (!taken.has(j) && st.provinceOwner[j] >= 0) neighbors.add(st.ids[st.provinceOwner[j]]);
    const ns: NewState = { id: `NS${st.newStates.length + 1}`, name, parent: st.ids[parent], provinces: r.provinces.slice(), neighbors: [...neighbors].sort(), day: st.day };
    const pairs = this.extendStructure(ns);
    growState(st, ns, parent, this.pairs, pairs);
    // extensive quantities start at zero (the transfer below moves the parent's share); p0-p2 must be zero before it
    for (const k of ['p0', 'p1', 'p2', 'K', 'gdp', 'gdpPrevQ', 'gdpPrevY', 'debt', 'milCap', 'births', 'deaths', 'netMig'] as const) f[k][c] = 0;
    for (const i of r.provinces) st.provinceOwner[i] = c;
    const popParent = totalPop(st, parent);
    const moved = transferTerritory(st, parent, c, r.share);
    aggregate(st, c);
    // groups whose homeland is mostly in the new state move with it; the rebels' group rules it
    for (const g of st.groups) {
      if (g.c !== parent || !g.home.length) continue;
      if (g.home.filter((i) => taken.has(i)).length * 2 > g.home.length) { g.c = c; g.aut = 0; if (g.status >= 3) g.status = 1; }
    }
    rescaleGroups(st, parent, popParent);
    for (const g of st.groups) if (g.c === c) g.size = Math.min(1, (g.size * popParent) / Math.max(1, totalPop(st, c))); // shares of the new state
    if (r.group >= 0 && st.groups[r.group].c === c) st.groups[r.group].status = 4;
    // the rebel army becomes the new state's
    f.milCap[c] = 0.5 * r.share * f.milCap[parent]; f.milCap[parent] *= 1 - r.share;
    const democratic = r.u < this.params.conflict.outcome.secessionDemocratic;
    f.regime[c] = democratic ? 2 : 0; f.demo[c] = f.demo0[c] = democratic ? Math.max(0.5, f.demo[parent]) : Math.min(0.3, f.demo[parent]);
    f.legit[c] = f.legit0[c] = 0.45; f.unrest[c] = f.unrest0[c] = 0.35; f.approval[c] = 0.65; f.perf[c] = 0.5;
    f.govYears[c] = 0; f.govTerms[c] = 0; f.coupMem[c] = 0.5; f.warMem[c] = 1; f.warLoad[c] = f.warLoad0[c] = 0;
    if (!democratic) seizePower(st, c, false);
    f.nextElection[c] = democratic ? st.day + 365 : -1; f.debtRatio0[c] = 0; f.unSanction[c] = 0; f.sanctionLoad[c] = 0;
    st.newStates.push(ns);
    st.events.push({ d: st.day, k: 'independence', c, o: parent, v: moved, x: { share: r.share, provinces: r.provinces.length, democratic: democratic ? 1 : 0 } });
  }

  /** Start an alternative timeline from now: all random streams are reseeded. Recorded so replay reproduces it. */
  branch(seed: number) {
    this.st.branches.push({ day: this.st.day, seed: seed >>> 0 });
    this.reseed(seed);
  }

  /** Rebuild the world at `day` by deterministic replay from t0 (honouring branch points up to that day). */
  rewindTo(day: number): void {
    const branches = this.st.branches.filter((b) => b.day <= day);
    const fresh = new Simulation(this.baseline0, { seed: this.st.seed, startDate: this.startDate, params: this.params });
    for (const b of branches) { fresh.advanceTo(b.day); fresh.branch(b.seed); }
    fresh.advanceTo(Math.max(day, fresh.st.startDay));
    this.st = fresh.st;
    this.rngs = fresh.rngs;
    this.baseline = fresh.baseline; this.trade = fresh.trade; this.pairs = fresh.pairs; this.cnet = fresh.cnet;
  }

  /** Replace state (after load). */
  setState(st: WorldState) { this.st = st; this.bindRngs(); applyTradeEffects(st, this.params, this.trade, this.pairs); }

  hash() { return hashState(this.st); }
}
