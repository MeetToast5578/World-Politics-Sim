// Renders chronicle events as text. Every sentence is built only from values stored in the event.
import type { SimEvent } from './state';

const fmtPop = (v: number) => (v >= 1e9 ? `${v / 1e9} billion` : `${v / 1e6} million`);
const pct = (v: number, d = 1) => `${(v * 100).toFixed(d)}%`;

export function describeEvent(e: SimEvent, name: (c: number) => string): string {
  const c = e.c >= 0 ? name(e.c) : 'World', x = e.x ?? {};
  switch (e.k) {
    case 'oil_shock':
      return `World oil price ${e.v! > 0 ? 'surges' : 'collapses'} ${pct(Math.abs(e.v!), 0)} in a year (now ${(x.price * 100).toFixed(0)} on a 2023 = 100 scale).`;
    case 'inflation_high':
      return `${c}: inflation climbs above 25% (${e.v!.toFixed(1)}%; expected ${x.expected.toFixed(1)}%, oil price index ${(x.oil * 100).toFixed(0)}).`;
    case 'inflation_tamed':
      return `${c} brings inflation back below 10% (${e.v!.toFixed(1)}%; expectations ${x.expected.toFixed(1)}%).`;
    case 'recession_start':
      return `${c} enters recession: second consecutive quarter of contraction (${pct(e.v!)} q/q; output gap ${pct(x.gap ?? x.cycle)} of which domestic ${pct(x.cycle)}, unemployment ${x.unemp.toFixed(1)}%).`;
    case 'recession_end':
      return `${c} returns to growth after ${e.v} quarters of contraction (unemployment ${x.unemp.toFixed(1)}%).`;
    case 'pop_above':
      return `${c}'s population passes ${fmtPop(e.v!)} (fertility ${x.tfr.toFixed(2)}, life expectancy ${x.lifeExp.toFixed(1)}).`;
    case 'pop_below':
      return `${c}'s population falls below ${fmtPop(e.v!)} (fertility ${x.tfr.toFixed(2)}, life expectancy ${x.lifeExp.toFixed(1)}).`;
    case 'pop_peak':
      return `${c}'s population peaks at ${(e.v! / 1e6).toFixed(1)} million and begins to decline (fertility ${x.tfr.toFixed(2)}, ${pct(x.old, 0)} aged 65+).`;
    case 'debt_above':
      return `${c}'s public debt exceeds ${pct(e.v!, 0)} of GDP (primary spending ${pct(x.primSpend)} vs revenue ${pct(x.rev)} of GDP).`;
    case 'sovereign_default':
      return `${c} defaults on its public debt: interest payments reached ${pct(x.burden, 0)} of revenue with debt at ${pct(e.v!, 0)} of GDP. Debt is restructured and output contracts.`;
    case 'gdp_rank_up':
      return `${c} overtakes ${name(e.o!)} and becomes the world's #${e.v} economy at market exchange rates.`;
    // politics: every sentence cites the state that produced the event
    case 'election_won':
      return `${c}: the incumbent wins re-election (approval ${pct(x.approval, 0)}, democracy index ${x.demo.toFixed(2)}).`;
    case 'election_lost':
      return `${c}: the government loses the election (approval ${pct(x.approval, 0)}, misery index ${x.misery.toFixed(1)}, growth ${pct(x.growth)}); a new government takes office.`;
    case 'coup':
      return `${c}: military coup succeeds (unrest ${pct(x.unrest, 0)}, legitimacy ${pct(x.legit, 0)}, democracy index ${x.demo.toFixed(2)}, annual coup risk was ${pct(x.hazard, 0)}).`;
    case 'coup_failed':
      return `${c}: coup attempt fails (unrest ${pct(x.unrest, 0)}, legitimacy ${pct(x.legit, 0)}).`;
    case 'protests':
      return `${c}: mass protests (unrest ${pct(x.unrest, 0)}; approval ${pct(x.approval, 0)}, misery index ${x.misery.toFixed(1)}, religious polarisation ${x.polar.toFixed(2)}).`;
    case 'government_collapse':
      return `${c}: the government falls amid mass unrest (unrest ${pct(x.unrest, 0)}, legitimacy ${pct(x.legit, 0)}); early elections are called.`;
    case 'revolution':
      return `${c}: popular uprising topples the regime and opens a democratic transition (unrest ${pct(x.unrest, 0)}, legitimacy ${pct(x.legit, 0)}, religious polarisation ${x.polar.toFixed(2)}).`;
    case 'regime_overthrown':
      return `${c}: uprising overthrows the government; a new authoritarian leadership takes power (unrest ${pct(x.unrest, 0)}, legitimacy ${pct(x.legit, 0)}).`;
    case 'democratization':
      return `${c} becomes an electoral democracy (democracy index ${e.v!.toFixed(2)}, legitimacy ${pct(x.legit, 0)}).`;
    case 'autocratization':
      return `${c} slides into electoral autocracy (democracy index ${e.v!.toFixed(2)}; incumbent approval ${pct(x.approval, 0)}).`;
    case 'elections_restored':
      return `${c}: the ruling authorities restore elections (democracy index ${e.v!.toFixed(2)}).`;
    default:
      return `${c}: ${e.k}`;
  }
}
