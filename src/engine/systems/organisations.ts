// International organisations (yearly, after diplomacy). Membership per country and organisation: 0 none, 1 member,
// 2 suspended, 3 former member (rejoins only rarely: Britain, Qatar, Ecuador...). Starts from the curated 2023 (or 2000) membership lists.
//   effects    relative to the start, so 2023 relations and trade are reproduced exactly: each organisation two
//              countries newly share adds trust (diplomacy driver "organisations"), and trade blocs (EU, ASEAN,
//              Mercosur, ECOWAS) raise the pair's trade by e^w when both are members (and lower it when one leaves)
//   suspension the African Union and ECOWAS suspend a member after a coup or an unconstitutional takeover (as with
//              Mali, Guinea, Burkina Faso, Niger, Gabon, Sudan 2020-23); Mercosur and the EU when democracy collapses;
//              readmission once elections are back; suspended ECOWAS members may walk out (Mali, Burkina Faso and Niger
//              announced their exit in January 2024)
//   accession  each organisation has its own eligibility (geography, democracy, income, oil, alignment) and a yearly
//              hazard; exits rise as trust in the other members falls
// Rates are assumptions of the right order (EU and OECD gain a member every few years; BRICS and SCO grew by several
// in 2017-24; one EU exit in 65 years).
import type { Baseline } from '../types';
import type { Params } from '../params';
import type { Rng } from '../rng';
import type { WorldState, SimEvent } from '../state';
import { totalPop } from '../state';
import { gdpPppPc } from './demography';
import { pairOf, type PairNet } from './diplomacy';

export const orgCount = (b: Baseline) => b.meta.organisations.length;
/** Membership status of country c in organisation o. */
export const orgStatus = (st: WorldState, c: number, o: number) => st.orgMember[c * st.nOrg + o];

function emit(st: WorldState, e: Omit<SimEvent, 'd'>) { st.events.push({ d: st.day, ...e }); }

export function initOrganisations(st: WorldState, b: Baseline): void {
  const idx = new Map(st.ids.map((id, k) => [id, k])), O = orgCount(b);
  st.nOrg = O; st.orgIds = b.meta.organisations.map((o) => o.id); st.orgMember = new Uint8Array(st.n * O); st.orgMember0 = new Uint8Array(st.n * O);
  b.meta.organisations.forEach((org, o) => {
    for (const m of org.former ?? []) { const c = idx.get(m.id); if (c !== undefined) st.orgMember[c * O + o] = st.orgMember0[c * O + o] = 3; }
    for (const m of org.members) { const c = idx.get(m.id)!; st.orgMember[c * O + o] = st.orgMember0[c * O + o] = m.suspended ? 2 : 1; }
  });
}

/** Shared full memberships of a pair, weighted (now and at the start), for the trust and trade effects. */
export function sharedOrgs(st: WorldState, weights: number[], a: number, c: number): number {
  const O = st.nOrg, m = st.orgMember, m0 = st.orgMember0;
  let s = 0;
  for (let o = 0; o < O; o++) s += weights[o] * ((m[a * O + o] === 1 && m[c * O + o] === 1 ? 1 : 0) - (m0[a * O + o] === 1 && m0[c * O + o] === 1 ? 1 : 0));
  return s;
}

const meanTrust = (st: WorldState, pn: PairNet, c: number, members: number[]) => {
  let s = 0, k = 0;
  for (const m of members) { if (m === c) continue; const q = pairOf(pn, st.n, c, m); if (q >= 0) { s += st.pair.trust[q]; k++; } }
  return k ? s / k : 0;
};
const trustWith = (st: WorldState, pn: PairNet, c: number, other: number) => { const q = other >= 0 ? pairOf(pn, st.n, c, other) : -1; return q >= 0 ? st.pair.trust[q] : 0; };

export function organisationsYearly(st: WorldState, b: Baseline, p: Params, rng: Rng, pn: PairNet): void {
  const f = st.f, P = p.organisations, O = st.nOrg, n = st.n;
  const orgs = b.meta.organisations, cs = b.countries;
  // unconstitutional changes of government in the past year
  const takeover = new Uint8Array(n);
  for (let i = st.events.length - 1; i >= 0 && st.events[i].d > st.day - 366; i--) {
    const e = st.events[i];
    if (e.k === 'coup' || e.k === 'regime_overthrown' || (e.k === 'rebels_won' && !e.v)) takeover[e.c] = 1;
  }
  const id = (x: string) => st.ids.indexOf(x), CHN = id('CHN'), USA = id('USA'), RUS = id('RUS');
  const members = orgs.map((_, o) => { const l: number[] = []; for (let c = 0; c < n; c++) if (st.orgMember[c * O + o] === 1) l.push(c); return l; });
  const median = (xs: number[]) => { const s = xs.slice().sort((a, b) => a - b); return s.length ? s[s.length >> 1] : 0; };
  for (let o = 0; o < O; o++) {
    const org = orgs[o], rule = P.rules[org.id];
    const richest = org.id === 'EU' ? 1.2 * median(members[o].map((m) => gdpPppPc(st, m))) : Infinity;
    let joined = 0; // enlargement is negotiated: at most one accession per organisation a year (the AU admits all)
    for (let c = 0; c < n; c++) {
      const u = rng.next(), k = c * O + o, s = st.orgMember[k];
      if (!rule || totalPop(st, c) <= 0) continue;
      const bc = cs[c], [lon, lat] = bc.geo.centroid, y = gdpPppPc(st, c), trust = meanTrust(st, pn, c, members[o]);
      if (s === 1) {
        // suspension
        if ((rule.suspendCoup && takeover[c]) || (rule.minDemocracy && f.demo[c] < rule.minDemocracy * 0.5)) {
          st.orgMember[k] = 2; emit(st, { k: 'org_suspended', c, v: o, x: { demo: f.demo[c], coup: takeover[c] } });
        } else if (u < P.exitBase * Math.exp(P.exitTrust * (0.3 - trust)) || (org.id === 'OPEC' && f.oilExp[c] < P.opecLeave && u < 0.1)) {
          st.orgMember[k] = 3; emit(st, { k: 'org_left', c, v: o, x: { trust } });
        }
      } else if (s === 2) {
        if (f.regime[c] >= 1 && !takeover[c] && f.demo[c] >= (rule.minDemocracy ?? 0) * 0.5 && u < P.readmit) { st.orgMember[k] = 1; emit(st, { k: 'org_readmitted', c, v: o }); }
        else if (rule.suspendedExit && u > 1 - rule.suspendedExit) { st.orgMember[k] = 3; emit(st, { k: 'org_left', c, v: o, x: { trust, suspended: 1 } }); }
      } else {
        // accession: eligibility, then a yearly hazard
        // microstates do not join the EU or OECD; China-centred clubs admit only recognised states (not Taiwan)
        const big = totalPop(st, c) >= 1e6, recognised = bc.status === 'recognized';
        let ok = false;
        switch (org.id) {
          // rich non-members (Norway, Switzerland, Iceland) have repeatedly chosen to stay out
          case 'EU': ok = bc.continent === 'Europe' && big && f.demo[c] > 0.65 && y > 15000 && y < richest && trust > 0.3; break;
          case 'OECD': ok = big && f.demo[c] > 0.6 && y > 25000 && trust > 0.2; break;
          case 'ASEAN': ok = recognised && bc.wbRegion === 'East Asia & Pacific' && lon > 92 && lon < 128 && lat > -11 && lat < 28; break; // Southeast Asia (Timor-Leste)
          case 'MERCOSUR': ok = bc.continent === 'South America' && trust > 0.3; break;
          case 'ECOWAS': ok = bc.continent === 'Africa' && lon > -18 && lon < 16 && lat > 4 && lat < 17 && trust > 0.2 && f.regime[c] >= 1; break;
          case 'AU': ok = bc.continent === 'Africa' && bc.status !== 'unrecognized'; break; // e.g. Somaliland is not admitted
          case 'OPEC': ok = f.oilExp[c] > P.opecJoin; break;
          case 'BRICS': ok = recognised && totalPop(st, c) > 3e7 && trustWith(st, pn, c, CHN) > 0.3 && trustWith(st, pn, c, USA) < 0.3 && st.orgMember[c * O + orgs.findIndex((x) => x.id === 'OECD')] !== 1; break;
          case 'SCO': ok = recognised && bc.continent === 'Asia' && trustWith(st, pn, c, CHN) > 0.2 && trustWith(st, pn, c, RUS) > 0.2; break;
        }
        if (ok && u < rule.join * (s === 3 ? P.formerRejoin : 1) && (org.id === 'AU' || !joined)) { joined++; st.orgMember[k] = 1; emit(st, { k: 'org_joined', c, v: o, x: { trust, demo: f.demo[c], income: y } }); }
      }
    }
  }
}
