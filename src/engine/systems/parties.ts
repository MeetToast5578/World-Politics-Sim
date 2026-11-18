// Parties and governments. No open dataset covers party systems worldwide (ParlGov covers ~40 countries), so every
// country gets a simulated party landscape of eight families, labelled as simulated in the interface:
//   start      shares from income (social democrats, liberals, greens grow with it), religiosity (conservatives, a
//              religious party where a religion dominates), religious polarisation and poverty (nationalists, left),
//              plus a bonus for the family nearest the government's orientation (larger in electoral autocracies);
//              lognormal noise
//   elections  the calibrated election model (politics.ts) decides whether the government survives; the party model
//              decides who governs: governing families gain a little when they win and lose a third when they lose;
//              nationalists grow with hardship, polarisation and unrest above the country's own baseline, the left
//              with hardship; votes become seats by proportional representation (5% threshold) in parliamentary
//              systems or by the cube law (seats ∝ votes³, Kendall & Stuart 1950) in majoritarian ones; the largest party (the largest opposition
//              party after a defeat) forms the government with its nearest neighbours until it has a majority, and
//              the government's orientation becomes the seat-weighted position of its parties
//   takeovers  a coup or an overthrow replaces parties with military or revolutionary rule until elections return
import type { Baseline } from '../types';
import type { Rng } from '../rng';
import { Rng as RngClass } from '../rng';
import type { WorldState } from '../state';
import { misery } from './politics';
import { gdpPppPc } from './demography';

export const PARTY_FAMILIES = 8;
/** Position of each family on the left–right axis (−1 … +1). */
export const PARTY_POS = [-0.8, -0.45, -0.35, 0.05, 0.3, 0.55, 0.85, 0.6];
const NAMES = ['Left', 'Social Democrats', 'Greens', 'Liberals', 'Centre-Right', 'Conservatives', 'Nationalists'];
const RELIGIOUS = ['', 'Islamic party', 'Christian Democrats', 'Hindu nationalists', 'Buddhist party', 'Religious Zionists'];
/** Display name of a party family; relFam: dominant religion (0 none, 1 Islam, 2 Christianity, 3 Hinduism,
 *  4 Buddhism, 5 Judaism). govLead −1: military rule, −2: revolutionary or junta council. */
export const partyName = (fam: number, relFam: number) => (fam === -1 ? 'Military' : fam === -2 ? 'Ruling council' : fam === 7 ? RELIGIOUS[relFam] || 'Religious party' : NAMES[fam]);
export const VOTE_FIELDS = ['v0', 'v1', 'v2', 'v3', 'v4', 'v5', 'v6', 'v7'] as const;

const FAMILY_CODE: Record<string, number> = { Islam: 1, Christianity: 2, Hinduism: 3, Buddhism: 4, Judaism: 5 };
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const bits = (m: number) => { let k = 0; while (m) { k += m & 1; m >>= 1; } return k; };

function votes(st: WorldState, c: number): number[] { return VOTE_FIELDS.map((k) => st.f[k][c]); }
function setVotes(st: WorldState, c: number, v: number[]) { VOTE_FIELDS.forEach((k, i) => (st.f[k][c] = v[i])); }

/** Seats from votes: proportional with a 5% threshold, or the cube law for majoritarian systems. */
function seats(st: WorldState, c: number, v: number[]): number[] {
  const s = st.f.propRep[c] ? v.map((x) => (x >= 0.05 ? x : 0)) : v.map((x) => x * x * x);
  const t = s.reduce((a, b) => a + b, 0) || 1;
  return s.map((x) => x / t);
}

/** The lead family plus its nearest neighbours on the left–right axis until the coalition has a majority (at most four). */
function coalition(lead: number, seat: number[], keep = 0): number {
  let mask = keep | (1 << lead), total = seat.reduce((a, s, i) => a + ((mask >> i) & 1 ? s : 0), 0);
  while (total <= 0.5 && bits(mask) < 4) { // at most four parties; otherwise a minority government
    let best = -1, d = Infinity;
    for (let i = 0; i < PARTY_FAMILIES; i++) if (!((mask >> i) & 1) && seat[i] > 0 && Math.abs(PARTY_POS[i] - PARTY_POS[lead]) < d) { d = Math.abs(PARTY_POS[i] - PARTY_POS[lead]); best = i; }
    if (best < 0) break;
    mask |= 1 << best; total += seat[best];
  }
  return mask;
}

function orientation(mask: number, seat: number[]): number {
  let w = 0, s = 0;
  for (let i = 0; i < PARTY_FAMILIES; i++) if ((mask >> i) & 1) { w += seat[i]; s += seat[i] * PARTY_POS[i]; }
  return w > 0 ? clamp(s / w, -1, 1) : 0;
}

export function initParties(st: WorldState, b: Baseline, rng: Rng): void {
  const f = st.f, R = st.nRel;
  b.countries.forEach((bc, c) => {
    const noise = Array.from({ length: PARTY_FAMILIES }, () => rng.normal());
    let best = 0;
    for (let r = 1; r < R; r++) if (st.religion[c * R + r] > st.religion[c * R + best]) best = r;
    f.relFam[c] = FAMILY_CODE[b.meta.religions[best].family] ?? 0;
    f.propRep[c] = ['parliamentary', 'semi_presidential', 'constitutional_monarchy'].includes(bc.government.form) ? 1 : 0;
    const rich = clamp(Math.log(gdpPppPc(st, c) / 5000) / Math.log(10), 0, 1.3), relig = 1 - st.religion[c * R + R - 1], polar = f.relPolar[c];
    const v = [0.08 + 0.05 * (1 - rich), 0.12 + 0.12 * rich, 0.01 + 0.08 * Math.max(0, rich - 0.6), 0.06 + 0.06 * rich, 0.12 + 0.06 * rich,
      0.15 + 0.05 * relig, 0.06 + 0.1 * polar + 0.04 * (1 - rich), f.relFam[c] ? 0.03 + 0.2 * relig * (1 - Math.min(1, rich)) : 0];
    // the governing family: the real ruling party's (Wikidata), which also sets the government's orientation;
    // otherwise the family nearest the drawn orientation among plausible ones (in autocracies a left, conservative,
    // nationalist or religious ruling party; greens only in rich countries)
    const rp = bc.rulingParty;
    let lead: number;
    if (rp) { lead = rp.family; f.ideology[c] = rp.pos; f.realParty[c] = 1; if (lead === 7 && !v[7]) v[7] = 0.05; }
    else {
      const cand = (f.regime[c] <= 1 ? [0, 5, 6, 7] : [0, 1, 2, 3, 4, 5, 6, 7]).filter((i) => v[i] > 0 && (i !== 2 || rich > 0.8));
      lead = cand[0];
      for (const i of cand) if (Math.abs(PARTY_POS[i] - f.ideology[c]) < Math.abs(PARTY_POS[lead] - f.ideology[c])) lead = i;
    }
    v[lead] += f.regime[c] <= 1 ? 0.35 : 0.18; // governing party: dominant where elections are unfair
    const w = v.map((x, i) => x * Math.exp(0.25 * noise[i]));
    const t = w.reduce((a, x) => a + x, 0);
    setVotes(st, c, w.map((x) => x / t));
    const seat = seats(st, c, votes(st, c));
    f.govLead[c] = f.regime[c] === 0 && !rp ? -2 : lead; // one-party states keep their party (e.g. China)
    f.govMask[c] = f.regime[c] === 0 ? (rp ? 1 << lead : 0) : coalition(lead, seat);
  });
}

/** An election: votes swing, seats follow, a government forms. won: the calibrated outcome for the incumbents. */
export function holdElection(st: WorldState, c: number, won: boolean, u: number): { party: number; share: number; parties: number; rel: number; real: number } {
  const f = st.f, r = new RngClass(((u * 4294967296) >>> 0) ^ st.day);
  const mis = misery(st, c), hard = mis - f.misery0[c], rich = clamp(Math.log(gdpPppPc(st, c) / 5000) / Math.log(10), 0, 1.3);
  const old = f.govMask[c] | 0, v = votes(st, c);
  const k = v.map((x, i) => {
    let g = 0.12 * r.normal();
    if ((old >> i) & 1) g += won ? 0.05 : -0.4;
    if (i === 6) g += 0.04 * hard + 1.0 * (f.relPolar[c] - f.polar0[c]) + 0.6 * (f.unrest[c] - f.unrest0[c]);
    if (i === 0) g += 0.02 * hard;
    if (i === 2) g += 0.5 * (rich - 0.8);
    return Math.max(x, i === 7 && !f.relFam[c] ? 0 : 0.003) * Math.exp(g);
  });
  const t = k.reduce((a, x) => a + x, 0), nv = k.map((x) => x / t);
  const seat = seats(st, c, nv);
  let lead: number;
  if (won && f.govLead[c] >= 0) lead = f.govLead[c];
  else {
    lead = -1;
    for (let i = 0; i < PARTY_FAMILIES; i++) if (!((old >> i) & 1) && (lead < 0 || seat[i] > seat[lead])) lead = i;
    if (lead < 0) lead = seat.indexOf(Math.max(...seat));
  }
  const mask = coalition(lead, seat, won && f.govLead[c] >= 0 ? old & ~0 : 0);
  setVotes(st, c, nv);
  if (lead !== f.govLead[c]) f.realParty[c] = 0; // the party that governed at the start is out
  f.govLead[c] = lead; f.govMask[c] = mask;
  f.ideology[c] = orientation(mask, seat);
  return { party: lead, share: nv[lead], parties: bits(mask), rel: f.relFam[c], real: f.realParty[c] };
}

/** A coup or an overthrow: parties lose power to the military or a ruling council. */
export function seizePower(st: WorldState, c: number, military: boolean) { st.f.govLead[c] = military ? -1 : -2; st.f.govMask[c] = 0; st.f.realParty[c] = 0; }
