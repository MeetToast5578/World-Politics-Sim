// Religion: population shares by denomination/sect (31 categories of the World Religion Project), yearly.
//  - secularisation: the non-religious share s follows logistic growth ds/dt = r·s·(1 − s/K), with r and K fitted on
//    within-country changes in the WRP panel (data build). Near-zero shares stay near zero; countries already above
//    K are not pushed down (post-communist religious revival is not modelled). Religious groups lose proportionally,
//    so each country's internal denominational mix is preserved.
//  - indices: fractionalisation F = 1 − Σs² and polarisation RQ = 4·Σ s²(1 − s) (Montalvo & Reynal-Querol 2005),
//    over all categories including the non-religious. Polarisation feeds political unrest (systems/politics.ts).
// Not modelled: differential fertility or migration by religion, conversion between religions (only into and out
// of non-religion), state religion policy. These are documented gaps, not assumptions of zero importance.
import type { Baseline } from '../types';
import type { Params } from '../params';
import type { WorldState } from '../state';

export const relIndex = (st: WorldState, c: number) => c * st.nRel;

export function initReligion(st: WorldState, b: Baseline): void {
  const R = st.nRel, none = R - 1;
  b.countries.forEach((bc, c) => {
    const sh = bc.religion?.shares;
    if (!sh || sh.length !== R) throw new Error(`baseline: ${bc.id} has no religion composition`);
    const tot = sh.reduce((a, x) => a + x, 0);
    for (let r = 0; r < R; r++) st.religion[c * R + r] = sh[r] / tot;
    st.f.secCeil[c] = Math.max(b.meta.secularisation.K, st.religion[c * R + none]);
  });
  for (let c = 0; c < st.n; c++) religionIndices(st, c);
}

export function religionIndices(st: WorldState, c: number): void {
  const R = st.nRel, o = c * R;
  let s2 = 0, rq = 0;
  for (let r = 0; r < R; r++) { const s = st.religion[o + r]; s2 += s * s; rq += s * s * (1 - s); }
  st.f.relFrac[c] = 1 - s2;
  st.f.relPolar[c] = 4 * rq;
}

export function religionYearly(st: WorldState, b: Baseline, p: Params): void {
  const R = st.nRel, none = R - 1, f = st.f, { r } = b.meta.secularisation;
  for (let c = 0; c < st.n; c++) {
    const o = c * R, cur = st.religion[o + none];
    const next = Math.min(f.secCeil[c], Math.max(0, cur + p.religion.rateScale * r * cur * (1 - cur / f.secCeil[c])));
    const scale = cur < 1 ? (1 - next) / (1 - cur) : 0;
    for (let k = 0; k < none; k++) st.religion[o + k] *= scale;
    st.religion[o + none] = next;
    religionIndices(st, c);
  }
}
