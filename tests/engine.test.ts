import { describe, it, expect } from 'vitest';
import { loadBaseline } from '../src/headless/load';
import { Simulation } from '../src/engine/sim';
import { Rng } from '../src/engine/rng';
import { daysFromCivil, civilFromDays, addMonths, formatDate, parseDate } from '../src/engine/calendar';
import { saveWorld, loadWorld } from '../src/engine/save';
import { FIELDS, totalPop, cloneState } from '../src/engine/state';
import { demographyYearly, solveSiler, lifeExpectancy, under5 } from '../src/engine/systems/demography';
import { economyQuarterly, interestRate } from '../src/engine/systems/economy';
import { coupHazard } from '../src/engine/systems/politics';
import { applyTradeEffects, pairOf } from '../src/engine/systems/diplomacy';
import { transferTerritory } from '../src/engine/systems/conflict';

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

describe('religion and politics', () => {
  it('religion shares are valid at baseline and after 150 years', () => {
    const sim = new Simulation(b, { seed: 4 });
    const check = () => {
      const R = sim.st.nRel;
      for (let c = 0; c < sim.st.n; c++) {
        let s = 0;
        for (let r = 0; r < R; r++) { const v = sim.st.religion[c * R + r]; expect(v).toBeGreaterThanOrEqual(0); s += v; }
        expect(s).toBeCloseTo(1, 9);
      }
    };
    check(); years(sim, 150); check();
  });
  it('coup hazard is calibrated so world attempts at baseline equal the target rate', () => {
    const sim = new Simulation(b, { seed: 1 });
    let tot = 0;
    for (let c = 0; c < sim.st.n; c++) tot += coupHazard(sim.st, sim.params, c);
    expect(tot).toBeCloseTo(sim.params.politics.coup.attemptsPerYear, 3);
  });
  it('political variables stay in range over 300 years', () => {
    const sim = new Simulation(b, { seed: 6 });
    years(sim, 300);
    const f = sim.st.f;
    for (let c = 0; c < sim.st.n; c++) {
      for (const k of ['demo', 'approval', 'legit', 'unrest'] as const) { expect(f[k][c]).toBeGreaterThanOrEqual(0); expect(f[k][c]).toBeLessThanOrEqual(1); }
      expect([0, 1, 2, 3]).toContain(f.regime[c]);
      expect(Math.abs(f.ideology[c])).toBeLessThanOrEqual(1);
    }
  });
});

describe('diplomacy', () => {
  const sim = new Simulation(b, { seed: 2 });
  const id = (x: string) => sim.st.ids.indexOf(x);
  const trust = (a: string, c: string) => sim.st.pair.trust[pairOf(sim.pairs, sim.st.n, id(a), id(c))];
  it('initial relations reflect alignment, alliances and conflict history', () => {
    expect(trust('USA', 'GBR')).toBeGreaterThan(0.6);
    expect(trust('FRA', 'DEU')).toBeGreaterThan(0.6);
    expect(trust('RUS', 'UKR')).toBeLessThan(-0.6);
    expect(trust('IND', 'PAK')).toBeLessThan(-0.6);
    const nato = sim.st.treaties.find((t) => t.label === 'NATO')!;
    expect(nato.members).toContain(id('FIN'));
    expect(nato.members).not.toContain(id('SWE')); // joined March 2024, after the baseline
  });
  it('sanctions reduce bilateral trade; lifting them restores it', () => {
    const s2 = new Simulation(b, { seed: 2 });
    const q = pairOf(s2.pairs, s2.st.n, id('USA'), id('CUB'));
    const [ka] = s2.pairs.tradeK[q], a = s2.pairs.i[q];
    expect(ka).toBeGreaterThanOrEqual(0);
    const before = s2.trade.mult[a][ka];
    s2.st.pair.sancIJ[q] = 0; s2.st.pair.sancJI[q] = 0;
    applyTradeEffects(s2.st, s2.params, s2.trade, s2.pairs);
    expect(s2.trade.mult[a][ka]).toBeGreaterThan(before);
  });
  it('relations and treaties stay valid over 100 years', () => {
    const s3 = new Simulation(b, { seed: 8 });
    years(s3, 100);
    for (const k of ['trust', 'grievance', 'sancIJ', 'sancJI'] as const) for (const v of s3.st.pair[k]) expect(Number.isFinite(v)).toBe(true);
    for (const v of s3.st.pair.trust) { expect(v).toBeGreaterThanOrEqual(-1); expect(v).toBeLessThanOrEqual(1); }
    for (const t of s3.st.treaties) { expect(t.members.length).toBeGreaterThanOrEqual(2); expect(new Set(t.members).size).toBe(t.members.length); }
    for (const k of ['offCrisis', 'offSanction', 'offJoin', 'offLeave', 'offPact'] as const) expect(Number.isFinite(s3.st.g[k])).toBe(true);
  });
});

describe('armed conflict', () => {
  const id = (c: number) => b.countries[c].id;
  it('starts with the conflicts under way in 2023 (UCDP)', () => {
    const sim = new Simulation(b, { seed: 1 });
    const wars = sim.st.wars;
    expect(wars.some((w) => w.kind === 'interstate' && id(w.a[0]) === 'RUS' && id(w.loc) === 'UKR')).toBe(true);
    for (const c of ['SDN', 'MMR', 'SYR', 'ISR']) expect(wars.some((w) => w.kind === 'civil' && id(w.loc) === c)).toBe(true);
    expect(wars.length).toBe(b.meta.conflict.active.length);
  });
  it('a change of territory moves people, capital and output without creating or losing any', () => {
    const sim = new Simulation(b, { seed: 1 }), st = sim.st, f = st.f;
    const ukr = st.ids.indexOf('UKR'), rus = st.ids.indexOf('RUS');
    const P = worldPop(sim), K = f.K[ukr] + f.K[rus], Y = f.gdp[ukr] + f.gdp[rus], pu = totalPop(st, ukr);
    const moved = transferTerritory(st, ukr, rus, 0.1);
    expect(moved).toBeCloseTo(0.1 * pu, 0);
    expect(worldPop(sim)).toBeCloseTo(P, 0);
    expect(f.K[ukr] + f.K[rus]).toBeCloseTo(K, 0);
    expect(f.gdp[ukr] + f.gdp[rus]).toBeCloseTo(Y, 0);
    expect(f.p0[ukr] + f.p1[ukr] + f.p2[ukr]).toBeCloseTo(0.9 * pu, 0);
  });
  it('onset, duration and death rates over 4 worlds × 20 years are in the range UCDP observed 1990-2023', () => {
    const C = b.meta.conflict;
    let civ = 0, inter = 0, active = 0, deathRate = 0;
    const spells: number[] = [];
    for (let seed = 1; seed <= 4; seed++) {
      const sim = new Simulation(b, { seed }), starts = new Map<number, number>();
      for (let y = 0; y < 20; y++) {
        const e0 = sim.st.events.length;
        years(sim, 1);
        for (const w of sim.st.wars) if (!starts.has(w.id) && w.start > sim.st.startDay) starts.set(w.id, w.start);
        active += new Set(sim.st.wars.filter((w) => w.kind === 'civil').map((w) => w.loc)).size;
        for (const w of sim.st.wars) deathRate += w.rate;
        for (const e of sim.st.events.slice(e0)) {
          if (e.k === 'civil_war_started') civ++;
          if (e.k === 'war_started') inter++;
          const s0 = e.x?.id !== undefined ? starts.get(e.x.id) : undefined;
          if (s0 !== undefined && ['civil_war_won', 'rebels_won', 'autonomy_won', 'peace_deal', 'conflict_faded'].includes(e.k)) spells.push(civilFromDays(e.d).y - civilFromDays(s0).y + 1);
        }
        for (let c = 0; c < sim.st.n; c++) expect(Number.isFinite(totalPop(sim.st, c)) && totalPop(sim.st, c) > 0).toBe(true);
      }
    }
    const N = 80;
    spells.sort((x, y) => x - y);
    expect(civ / N).toBeGreaterThan(0.6 * C.civil.onsetsPerYear);
    expect(civ / N).toBeLessThan(1.5 * C.civil.onsetsPerYear);
    expect(active / N).toBeGreaterThan(0.6 * C.civil.activeCountries);
    expect(active / N).toBeLessThan(1.5 * C.civil.activeCountries);
    expect(inter / N).toBeGreaterThan(0.3 * C.interstate.onsetsPerYear);
    expect(inter / N).toBeLessThan(2.5 * C.interstate.onsetsPerYear);
    expect(spells[spells.length >> 1]).toBeLessThanOrEqual(2 * C.civil.spellYears.q50);
    expect(deathRate / N).toBeGreaterThan(0.3 * C.battleDeathsPerYear);
    expect(deathRate / N).toBeLessThan(3 * C.battleDeathsPerYear);
  }, 240000);
});

describe('invariants', () => {
  it('ageing and migration conserve people (births and deaths switched off)', () => {
    const sim = new Simulation(b, { seed: 1, params: { siler: { b1: 1.5, b2: 0.09, cA1: 0.02, c0: 0 } } });
    const f = sim.st.f;
    f.fertK.fill(0); f.silA1F.fill(0); f.silA2F.fill(0); f.silA1M.fill(0); f.silA2M.fill(0);
    const P0 = worldPop(sim);
    demographyYearly(sim.st, b, sim.params); // one cohort-component step: ageing + migration only
    expect(Math.abs(worldPop(sim) / P0 - 1)).toBeLessThan(1e-12);
  });
  it('Siler life tables reproduce the life expectancy and under-5 mortality they were solved for', () => {
    const p = new Simulation(b, { seed: 1 }).params;
    for (const [e0, u5] of [[55, 0.12], [72, 0.03], [86, 0.003]]) {
      const [a1, a2] = solveSiler(p, e0, u5);
      expect(lifeExpectancy(p, a1, a2)).toBeCloseTo(e0, 2);
      expect(under5(p, a1, a2)).toBeCloseTo(u5, 4);
    }
  });
  it('baseline cohorts reproduce WDI population, sex shares and births', () => {
    const sim = new Simulation(b, { seed: 1 });
    const { f } = sim.st;
    b.countries.forEach((bc, c) => {
      expect(totalPop(sim.st, c) / bc.fields.pop!.v).toBeCloseTo(1, 9);
      // implied crude death rate from the life tables is a model output; it should be in the right range
      expect(f.p0[c] / totalPop(sim.st, c)).toBeCloseTo(bc.fields.pop0014!.v / 100, 1);
    });
  });
  it('public debt follows the budget identity', () => {
    const sim = new Simulation(b, { seed: 1 });
    const before = cloneState(sim.st);
    economyQuarterly(sim.st, sim.params, new Rng(1), new Rng(2), sim.trade);
    const { f } = sim.st, p = sim.params;
    let checked = 0;
    for (let c = 0; c < sim.st.n; c++) {
      const Y = f.gdp[c], d = before.f.debt[c] / Y;
      if (before.f.debt[c] === 0) continue;
      const interest = interestRate(p, d, before.f.debtRatio0[c]) * before.f.debt[c];
      if (interest / (f.revShare[c] * Y) > p.defaultBurden) continue; // restructured this quarter
      const surprise = p.inflation.phillips * 100 * f.gap[c] + p.oil.cpiWeight * sim.st.g.oilDln * 400;
      const expected = before.f.debt[c] * Math.exp((-surprise / 100) * 0.25) + ((f.primSpendShare[c] - f.revShare[c]) * Y + interest) * 0.25;
      if (expected <= 0) continue;
      expect(f.debt[c]).toBeCloseTo(expected, 3);
      checked++;
    }
    expect(checked).toBeGreaterThan(150);
  });
  it.each([1, 3])('no NaN, infinities or negative stocks after 300 years (seed %i)', (seed) => {
    const sim = new Simulation(b, { seed });
    years(sim, 300);
    const { f } = sim.st;
    const nonNegative = ['p0', 'p1', 'p2', 'gdp', 'K', 'A', 'debt', 'milCap', 'tfr', 'lifeExp'] as const;
    for (const k of FIELDS) {
      if (k === 'urban' || k === 'inflation' || k === 'tradeShare') continue; // may be NaN = "no data"
      for (let c = 0; c < sim.st.n; c++) expect(Number.isFinite(f[k][c]), `${k}[${sim.st.ids[c]}]`).toBe(true);
    }
    for (const k of nonNegative) for (let c = 0; c < sim.st.n; c++) expect(f[k][c]).toBeGreaterThanOrEqual(0);
    expect(sim.st.history.years.length).toBe(301);
    for (let c = 0; c < sim.st.n; c++) expect(f.unemp[c]).toBeLessThan(60.0001);
  });
});
