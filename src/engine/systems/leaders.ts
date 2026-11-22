// Leaders. Each country starts with its real leader (Wikidata: name, birth year, date in office). A new, simulated
// leader takes over whenever the government changes (elections lost, coups, revolutions, rebel victories, new states),
// when a democratic party hands over to a new leader, or when the leader dies or retires ill. Yearly:
//  - death: the country's male Siler mortality at the leader's age × eliteMortality (leaders live longer than average
//    men); retirement for ill health in proportion (Archigos 1975-2015: 1.8% of exits vs 5.0% natural deaths)
//  - a death under an autocracy opens a succession crisis: legitimacy falls, coup risk and unrest rise
//  - in democracies the governing party replaces its leader at a rate rising with tenure (resignations, party
//    leadership contests, term limits)
// Validation against Archigos (tenure, how leaders leave office, ages): npm run leaders.
import type { Baseline } from '../types';
import type { Params } from '../params';
import { Rng } from '../rng';
import { daysFromCivil, parseDate } from '../calendar';
import type { SimEvent, WorldState } from '../state';

const YEAR = 365.25;
function emit(st: WorldState, e: Omit<SimEvent, 'd'>) { st.events.push({ d: st.day, ...e }); }

export const leaderAge = (st: WorldState, c: number) => (st.day - st.f.leaderBorn[c]) / YEAR;

/** A new (simulated) leader takes office today; age drawn from Archigos' entry ages. Deterministic per country and day. */
export function newLeader(st: WorldState, p: Params, c: number): void {
  const r = new Rng((Math.imul(st.seed, 2654435761) ^ Math.imul(c + 1, 40503) ^ st.day) >>> 0), L = p.leaders;
  const age = Math.min(85, Math.max(32, L.entryAge + L.entryAgeSd * r.normal()));
  st.f.leaderBorn[c] = st.day - age * YEAR; st.f.leaderSince[c] = st.day; st.f.leaderReal[c] = 0;
}

export function initLeaders(st: WorldState, b: Baseline, p: Params): void {
  const f = st.f;
  b.countries.forEach((bc, c) => {
    const L = bc.leader;
    f.leaderSince[c] = L?.since ? parseDate(L.since) : st.day - f.govYears[c] * YEAR;
    f.leaderBorn[c] = L ? daysFromCivil(L.born, 7, 1) : f.leaderSince[c] - p.leaders.entryAge * YEAR;
    f.leaderReal[c] = L ? 1 : 0;
  });
}

export function leadersYearly(st: WorldState, p: Params, rng: Rng): void {
  const f = st.f, L = p.leaders, S = p.siler;
  for (let c = 0; c < st.n; c++) {
    const uDie = rng.next(), uHand = rng.next(); // drawn for every country every year
    const age = leaderAge(st, c), tenure = (st.day - f.leaderSince[c]) / YEAR;
    const mu = f.silA1M[c] * Math.exp(-S.b1 * age) + S.cA1 * f.silA1M[c] + S.c0 + f.silA2M[c] * Math.exp(S.b2 * age);
    const qDie = L.eliteMortality * (1 - Math.exp(-mu));
    if (uDie < qDie * (1 + L.illHealth)) {
      const died = uDie < qDie, autocracy = f.regime[c] <= 1;
      emit(st, { k: died ? 'leader_died' : 'leader_retired', c, v: age, x: { tenure, real: f.leaderReal[c], autocracy: autocracy ? 1 : 0 } });
      if (died && autocracy) { // succession crisis
        f.legit[c] = Math.max(0.05, f.legit[c] - L.succession.legitimacy);
        f.coupMem[c] = Math.min(1, f.coupMem[c] + L.succession.coupMemory);
        f.unrest[c] = Math.min(0.99, f.unrest[c] + L.succession.unrest);
      }
      newLeader(st, p, c);
    } else if (f.regime[c] >= 2 && uHand < L.handover * (tenure >= L.handoverYears ? L.handoverLong : 1)) {
      emit(st, { k: 'leader_handover', c, v: tenure, x: { real: f.leaderReal[c], age } });
      newLeader(st, p, c);
    }
  }
}
