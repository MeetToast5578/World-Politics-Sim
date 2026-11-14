// Simulation: owns a WorldState and advances it through a fixed, documented update order.
//
// Time-step architecture (see docs/DESIGN.md §4). The clock is an integer day. Systems run on calendar boundaries:
//   every 1st of month : demography (monthly)
//   1 Jan/Apr/Jul/Oct  : economy (quarterly) -> chronicle (quarterly)
//   every 1 Jan        : demography (yearly transition) -> chronicle (yearly) -> history record
// Order within a boundary is fixed so each system reads a consistent state. Days between boundaries have no
// scheduled work in Phase 1, so advancing jumps from boundary to boundary (cost is independent of day count).
import type { Baseline } from './types';
import { DEFAULT_PARAMS, type Params } from './params';
import { Rng } from './rng';
import { civilFromDays, nextMonthStart } from './calendar';
import { createState, totalPop, hashState, HIST_FIELDS, type WorldState } from './state';
import { initDemography, initTransitionResiduals, demographyMonthly, demographyYearly } from './systems/demography';
import { initEconomy, economyQuarterly } from './systems/economy';
import { chronicleQuarterly, chronicleYearly } from './systems/chronicle';

export const RNG_STREAMS = ['economy'] as const;

export interface SimConfig { seed: number; startDate?: string; params?: Partial<Params> }

export class Simulation {
  readonly baseline: Baseline;
  readonly params: Params;
  readonly startDate?: string;
  st: WorldState;
  private rngs: Record<string, Rng> = {};

  constructor(baseline: Baseline, cfg: SimConfig) {
    this.baseline = baseline;
    this.params = { ...DEFAULT_PARAMS, ...cfg.params };
    this.startDate = cfg.startDate;
    this.st = createState(baseline, cfg.seed, cfg.startDate);
    initDemography(this.st, baseline, this.params);
    initEconomy(this.st, baseline, this.params);
    initTransitionResiduals(this.st, baseline);
    this.reseed(this.st.seed);
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
    demographyMonthly(st, p);
    if ((m - 1) % 3 === 0) {
      economyQuarterly(st, p, this.rngs.economy, (c, x) => st.events.push({ d: st.day, k: 'sovereign_default', c, v: x.debtRatio, x }));
      chronicleQuarterly(st);
    }
    if (m === 1) {
      demographyYearly(st, this.baseline, p);
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
  }

  /** Start an alternative timeline from now: all random streams are reseeded. Recorded so replay reproduces it. */
  branch(seed: number) {
    this.st.branches.push({ day: this.st.day, seed: seed >>> 0 });
    this.reseed(seed);
  }

  /** Rebuild the world at `day` by deterministic replay from t0 (honouring branch points up to that day). */
  rewindTo(day: number): void {
    const branches = this.st.branches.filter((b) => b.day <= day);
    const fresh = new Simulation(this.baseline, { seed: this.st.seed, startDate: this.startDate, params: this.params });
    for (const b of branches) { fresh.advanceTo(b.day); fresh.branch(b.seed); }
    fresh.advanceTo(Math.max(day, fresh.st.startDay));
    this.st = fresh.st;
    this.rngs = fresh.rngs;
  }

  /** Replace state (after load). */
  setState(st: WorldState) { this.st = st; this.bindRngs(); }

  hash() { return hashState(this.st); }
}
