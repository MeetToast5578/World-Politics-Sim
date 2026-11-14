import { describe, it, expect } from 'vitest';
import { loadBaseline } from '../src/headless/load';
import { Simulation } from '../src/engine/sim';
import { Rng } from '../src/engine/rng';
import { daysFromCivil, civilFromDays, addMonths, formatDate, parseDate } from '../src/engine/calendar';
import { saveWorld, loadWorld } from '../src/engine/save';
import { FIELDS, totalPop, cloneState } from '../src/engine/state';
import { demographyMonthly } from '../src/engine/systems/demography';
import { economyQuarterly, interestRate } from '../src/engine/systems/economy';

const b = loadBaseline();
const years = (sim: Simulation, n: number) => sim.advanceTo(addMonths(sim.st.day, 12 * n));
const worldPop = (sim: Simulation) => { let P = 0; for (let c = 0; c < sim.st.n; c++) P += totalPop(sim.st, c); return P; };

describe('rng', () => {
  it('is deterministic per seed and stream, and streams are independent', () => {
    const a = Rng.stream(42, 'economy'), a2 = Rng.stream(42, 'economy'), o = Rng.stream(42, 'politics');
    const xs = Array.from({ length: 5 }, () => a.nextU32());
    expect(Array.from({ length: 5 }, () => a2.nextU32())).toEqual(xs);
    expect(Array.from({ length: 5 }, () => o.nextU32())).not.toEqual(xs);
  });
  it('produces standard normals', () => {
    const r = new Rng(7);
    let s = 0, s2 = 0; const n = 200000;
    for (let i = 0; i < n; i++) { const x = r.normal(); s += x; s2 += x * x; }
    expect(Math.abs(s / n)).toBeLessThan(0.01);
    expect(Math.abs(s2 / n - 1)).toBeLessThan(0.02);
  });
});

describe('calendar', () => {
  it('round-trips civil dates including leap days', () => {
    for (let d = daysFromCivil(1600, 1, 1); d < daysFromCivil(2600, 1, 1); d += 37) {
      const { y, m, d: dd } = civilFromDays(d);
      expect(daysFromCivil(y, m, dd)).toBe(d);
    }
    expect(formatDate(parseDate('2024-02-29') + 1)).toBe('2024-03-01');
    expect(formatDate(parseDate('2100-02-28') + 1)).toBe('2100-03-01'); // 2100 is not a leap year
    expect(formatDate(addMonths(parseDate('2024-11-01'), 3))).toBe('2025-02-01');
  });
});

describe('baseline', () => {
  it('has ~200 political entities with sourced population and GDP', () => {
    expect(b.countries.length).toBeGreaterThanOrEqual(195);
    for (const c of b.countries) {
      expect(c.fields.pop?.v).toBeGreaterThan(0);
      expect(c.fields.gdp?.v).toBeGreaterThan(0);
      expect(['WDI', 'NE_EST', 'IMPUTED']).toContain(c.fields.pop!.s);
    }
    // countries without World Bank data must not all share identical starting conditions
    const imputed = b.countries.filter((c) => c.fields.tfr?.s === 'IMPUTED');
    expect(new Set(imputed.map((c) => c.fields.pop!.v)).size).toBe(imputed.length);
  });
  it('every region with an owner points to an existing country', () => {
    const ids = new Set(b.countries.map((c) => c.id));
    for (const r of b.regions) if (r.owner) expect(ids.has(r.owner)).toBe(true);
  });
  it('initial state reproduces baseline population and GDP exactly', () => {
    const sim = new Simulation(b, { seed: 1 });
    b.countries.forEach((bc, c) => {
      expect(totalPop(sim.st, c)).toBeCloseTo(bc.fields.pop!.v, 0);
      expect(sim.st.f.gdp[c]).toBeCloseTo(bc.fields.gdp!.v, -1);
    });
  });
});

describe('reproducibility', () => {
  it('same seed => identical world; different seed => different world', () => {
    const s1 = new Simulation(b, { seed: 123 }), s2 = new Simulation(b, { seed: 123 }), s3 = new Simulation(b, { seed: 124 });
    for (const s of [s1, s2, s3]) years(s, 50);
    expect(s1.hash()).toBe(s2.hash());
    expect(s1.hash()).not.toBe(s3.hash());
  });
  it('save -> load -> continue equals uninterrupted run', () => {
    const a = new Simulation(b, { seed: 9 });
    years(a, 10);
    const json = saveWorld(a);
    const loaded = loadWorld(b, json);
    expect(loaded.hash()).toBe(a.hash());
    years(a, 20); years(loaded, 20);
    expect(loaded.hash()).toBe(a.hash());
  });
  it('rewind by replay reproduces the earlier state', () => {
    const a = new Simulation(b, { seed: 5 });
    years(a, 15);
    const h15 = a.hash(), day15 = a.st.day;
    years(a, 15);
    a.rewindTo(day15);
    expect(a.hash()).toBe(h15);
  });
  it('branches diverge from the parent timeline and replay deterministically', () => {
    const parent = new Simulation(b, { seed: 5 });
    const child = new Simulation(b, { seed: 5 });
    years(parent, 10); years(child, 10);
    child.branch(777);
    years(parent, 10); years(child, 10);
    expect(child.hash()).not.toBe(parent.hash());
    const h = child.hash(), d = child.st.day;
    years(child, 5);
    child.rewindTo(d); // replay must re-apply the branch point
    expect(child.hash()).toBe(h);
  });
});

describe('invariants', () => {
  it('ageing and migration conserve people (births and deaths switched off)', () => {
    const sim = new Simulation(b, { seed: 1 });
    sim.st.f.fertK.fill(0); sim.st.f.mortK.fill(0);
    const P0 = worldPop(sim);
    for (let i = 0; i < 24; i++) demographyMonthly(sim.st, sim.params);
    expect(worldPop(sim) / P0 - 1).toBeLessThan(1e-12);
    expect(1 - worldPop(sim) / P0).toBeLessThan(1e-12);
  });
  it('public debt follows the budget identity', () => {
    const sim = new Simulation(b, { seed: 1 });
    const before = cloneState(sim.st);
    economyQuarterly(sim.st, sim.params, new Rng(1));
    const { f } = sim.st, p = sim.params;
    let checked = 0;
    for (let c = 0; c < sim.st.n; c++) {
      const Y = f.gdp[c], d = before.f.debt[c] / Y;
      if (before.f.debt[c] === 0) continue;
      const interest = interestRate(p, d, before.f.debtRatio0[c]) * before.f.debt[c];
      if (interest / (f.revShare[c] * Y) > p.defaultBurden) continue; // restructured this quarter
      const expected = before.f.debt[c] + ((f.primSpendShare[c] - f.revShare[c]) * Y + interest) * 0.25;
      if (expected <= 0) continue;
      expect(f.debt[c]).toBeCloseTo(expected, 3);
      checked++;
    }
    expect(checked).toBeGreaterThan(150);
  });
  it('no NaN, infinities or negative stocks after 200 years', () => {
    const sim = new Simulation(b, { seed: 3 });
    years(sim, 200);
    const { f } = sim.st;
    const nonNegative = ['p0', 'p1', 'p2', 'gdp', 'K', 'A', 'debt', 'milCap', 'tfr', 'lifeExp'] as const;
    for (const k of FIELDS) {
      if (k === 'urban' || k === 'inflation' || k === 'tradeShare') continue; // may be NaN = "no data"
      for (let c = 0; c < sim.st.n; c++) expect(Number.isFinite(f[k][c]), `${k}[${sim.st.ids[c]}]`).toBe(true);
    }
    for (const k of nonNegative) for (let c = 0; c < sim.st.n; c++) expect(f[k][c]).toBeGreaterThanOrEqual(0);
    expect(sim.st.history.years.length).toBe(201);
  });
});
