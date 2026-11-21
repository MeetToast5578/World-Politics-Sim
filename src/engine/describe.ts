// Renders chronicle events as a plain headline plus a short "why" line. Every word is built only from values stored
// in the event, so the news can never claim something the simulation did not produce.
import type { SimEvent } from './state';
import { partyName } from './systems/parties';

export interface Story { headline: string; why: string }

const pct = (v: number, d = 0) => `${(v * 100).toFixed(d)}%`;
const people = (v: number) => (v >= 1e9 ? `${+(v / 1e9).toFixed(1)} billion` : `${+(v / 1e6).toFixed(1)} million`);
const ordinal = (n: number) => `${n}${n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th'}`;
const deaths = (v: number) => (v >= 1e6 ? `${+(v / 1e6).toFixed(1)} million` : v >= 1e4 ? `${Math.round(v / 1e3)},000` : v >= 1000 ? `${(Math.round(v / 100) * 100).toLocaleString('en')}` : v >= 50 ? `${Math.round(v / 10) * 10}` : 'fewer than 50');
const years = (y: number) => (y < 1 ? `${Math.max(1, Math.round(y * 12))} month${Math.round(y * 12) === 1 ? '' : 's'}` : `${Math.round(y)} year${Math.round(y) === 1 ? '' : 's'}`);
const relation = (t: number) => (t < -0.5 ? 'deep distrust' : t < 0 ? 'mutual distrust' : t < 0.4 ? 'lukewarm relations' : 'good relations');

/** Names the news needs besides countries: organisations, and the real ruling party of a country (start data). */
export interface NewsContext { org?: (o: number) => string; party?: (c: number) => string | null | undefined; group?: (g: number) => string }

export function describeEvent(e: SimEvent, name: (c: number) => string, ctx: NewsContext = {}): Story {
  const org = ctx.org ?? (() => 'an international organisation');
  const party = (fam: number, rel: number, real: number) => (real && ctx.party?.(e.c)) || partyName(fam, rel);
  const c = e.c >= 0 ? name(e.c) : 'World', o = e.o !== undefined && e.o >= 0 ? name(e.o) : '', x = e.x ?? {};
  const s = (headline: string, why = ''): Story => ({ headline, why });
  const grp = (g: number | undefined) => (g !== undefined && g >= 0 && ctx.group ? ctx.group(g) : null);
  const rebels = grp(x.group);
  switch (e.k) {
    case 'oil_shock':
      return s(`Oil prices ${e.v! > 0 ? 'surge' : 'collapse'} ${pct(Math.abs(e.v!))} in a year`, `The oil price index is now ${(x.price * 100).toFixed(0)} (2023 = 100). Exporters gain, importers pay more.`);
    case 'inflation_high':
      return s(`Inflation tops 25% in ${c}`, `Prices are rising ${e.v!.toFixed(0)}% a year; people expected ${x.expected.toFixed(0)}%.`);
    case 'inflation_tamed':
      return s(`${c} gets inflation back under control`, `Inflation is down to ${e.v!.toFixed(1)}%.`);
    case 'recession_start':
      return s(`${c} falls into recession`, `The economy shrank ${pct(-e.v!, 1)} last quarter, the second fall in a row. Unemployment is ${x.unemp.toFixed(1)}%.`);
    case 'recession_end':
      return s(`${c}'s economy is growing again`, `After ${e.v} quarters of decline. Unemployment is ${x.unemp.toFixed(1)}%.`);
    case 'pop_above':
      return s(`${c} passes ${people(e.v!)} people`, `Women have ${x.tfr.toFixed(1)} children on average; life expectancy is ${x.lifeExp.toFixed(0)} years.`);
    case 'pop_below':
      return s(`${c}'s population falls below ${people(e.v!)}`, `Women have ${x.tfr.toFixed(1)} children on average, fewer than needed to replace each generation.`);
    case 'pop_peak':
      return s(`${c}'s population starts to shrink`, `It peaked at ${people(e.v!)}. Women have ${x.tfr.toFixed(1)} children on average and ${pct(x.old)} of people are over 65.`);
    case 'debt_above':
      return s(`${c}'s government debt passes ${pct(e.v!)} of its economy`, `It spends ${pct(x.primSpend)} of GDP before interest and collects ${pct(x.rev)}.`);
    case 'sovereign_default':
      return s(`${c} defaults on its debt`, `Interest payments took ${pct(x.burden)} of government revenue, with debt at ${pct(e.v!)} of GDP. Creditors take losses and the economy contracts.`);
    case 'gdp_rank_up':
      return s(`${c} overtakes ${o} as the world's ${ordinal(e.v!)} largest economy`);
    case 'election_won':
      return x.party !== undefined && x.party >= 0
        ? s(`${party(x.party, x.rel, x.real)} stay${x.real ? 's' : ''} in power in ${c}`, `${x.real ? 'It' : 'They'} won ${pct(x.share)} of the vote${x.parties > 1 ? ` and govern${x.real ? 's' : ''} with ${x.parties - 1} partner${x.parties > 2 ? 's' : ''}` : ''}. Approval was ${pct(x.approval)}.`)
        : s(`Government re-elected in ${c}`, `Approval was ${pct(x.approval)}.`);
    case 'election_lost':
      return x.party !== undefined && x.party >= 0
        ? s(`${party(x.party, x.rel, x.real)} win${x.real ? 's' : ''} the election in ${c}`, `With ${pct(x.share)} of the vote${x.parties > 1 ? `, leading a coalition of ${x.parties} parties` : ''}. The outgoing government had ${pct(x.approval)} approval; growth was ${pct(x.growth, 1)}.`)
        : s(`Voters throw out the government in ${c}`, `Approval had fallen to ${pct(x.approval)}; growth was ${pct(x.growth, 1)} and the hardship index ${x.misery.toFixed(0)}.`);
    case 'coup':
      return s(`Military seizes power in ${c}`, `Unrest was at ${pct(x.unrest)} and the government had little legitimacy left (${pct(x.legit)}).`);
    case 'coup_failed':
      return s(`Coup attempt fails in ${c}`, `Unrest ${pct(x.unrest)}, legitimacy ${pct(x.legit)}.`);
    case 'protests':
      return s(`Mass protests in ${c}`, `Approval ${pct(x.approval)}, hardship index ${x.misery.toFixed(0)}${x.polar > 0.6 ? ', deep religious divisions' : ''}.`);
    case 'government_collapse':
      return s(`${c}'s government falls amid protests`, 'Early elections have been called.');
    case 'revolution':
      return s(`Revolution in ${c} opens the way to democracy`, `Unrest reached ${pct(x.unrest)}; the old regime's legitimacy was ${pct(x.legit)}.`);
    case 'regime_overthrown':
      return s(`Uprising topples the government of ${c}`, 'New authoritarian leaders take over.');
    case 'democratization':
      return s(`${c} becomes a democracy`, `Its democracy score rose to ${e.v!.toFixed(2)} (0 = none, 1 = full).`);
    case 'autocratization':
      return s(`${c} slides into authoritarian rule`, `Its democracy score fell to ${e.v!.toFixed(2)}${x.approval > 0.55 ? `; a popular government (approval ${pct(x.approval)}) weakened the checks on its power` : ''}.`);
    case 'elections_restored':
      return s(`${c}'s rulers bring back elections`);
    case 'diplomatic_crisis':
      return s(`Crisis between ${c} and ${o}`, `The two have ${relation(x.trust)}${x.grievance > 0.5 ? ' and a history of conflict' : ''}.`);
    case 'sanctions_imposed':
      return s(`${c} imposes ${e.v! >= 1 ? 'broad economic' : 'targeted'} sanctions on ${o}`,
        [x.coupMemory > 0.3 ? `After a coup in ${o}.` : '', x.allies > 0 ? `${pct(x.allies)} of ${c}'s allies already sanction ${o}.` : '', x.tradeDep > 0.005 ? `Trade worth ${pct(x.tradeDep, 1)} of ${c}'s GDP is at stake.` : ''].filter(Boolean).join(' '));
    case 'un_sanctions_lifted':
      return s(`UN lifts sanctions on ${c}`, x.demo > x.demo0 ? 'After democratic reforms.' : '');
    case 'sanctions_lifted':
      return s(`${c} lifts sanctions on ${o}`);
    case 'alliance_joined':
      return s(`${c} joins an alliance with ${o} and others`, `The alliance now has ${e.v} members${x.threatFrom >= 0 ? `; ${c} feels threatened by ${name(x.threatFrom)}` : ''}.`);
    case 'alliance_left':
      return s(`${c} leaves its alliance with ${o || 'its partners'}`, `Relations with the other members had soured.`);
    case 'alliance_formed':
      return s(`${c} and ${o} sign a defence pact`, `Both feel threatened and trust each other.`);
    case 'civil_war_started':
      return s(rebels ? `${rebels} rise up in arms in ${c}` : `Armed rebellion breaks out in ${c}`, `${rebels ? `They are excluded from power. ` : ''}Unrest was ${pct(x.unrest)}${x.regime === 1 ? ' under an electoral autocracy' : ''}${x.polar > 0.5 ? ', with deep religious divisions' : ''}${x.income < 5000 ? ' in a poor country' : ''}. The chance of this in a given year was ${pct(x.hazard, 1)}.`);
    case 'civil_war_escalated':
      return s(`Fighting in ${c} becomes a full civil war`, `Battles are now killing about ${deaths(e.v!)} people a year.`);
    case 'civil_war_won':
      return s(`${c}'s government defeats the rebels`, `After ${years(x.years)} of fighting and ${deaths(x.deaths)} battle deaths.`);
    case 'rebels_won':
      return s(rebels ? `Rebels take power in ${c}; ${rebels} now share in government` : `Rebels take power in ${c}`, `After ${years(x.years)} of civil war and ${deaths(x.deaths)} battle deaths. ${e.v ? 'They promise elections.' : 'They rule without elections.'}`);
    case 'autonomy_won':
      return s(rebels ? `${rebels} in ${c} win self-rule for their homeland` : `Rebels in ${c} win self-rule for their region`, `After ${years(x.years)} of fighting. ${c} keeps its borders, but the region governs itself.`);
    case 'peace_deal':
      return s(`Peace agreement ends the fighting in ${c}`, `After ${years(x.years)} and ${deaths(x.deaths)} battle deaths.`);
    case 'conflict_faded':
      return s(`Fighting dies down in ${c}`, `No side won; the conflict lasted ${years(x.years)} and cost ${deaths(x.deaths)} lives in battle.`);
    case 'war_started':
      return s(`${c} goes to war with ${o}`, `The two had ${relation(x.trust)}${x.grievance > 0.5 ? ' and a history of conflict' : ''}.`);
    case 'war_joined':
      return s(`${c} enters the war against ${o}`, x.ally !== undefined ? `To defend its ally ${name(x.ally)}.` : 'To honour a defence treaty.');
    case 'war_won':
      return s(`${c} wins its war with ${o}`, `After ${years(x.years)} and ${deaths(x.deaths)} battle deaths.`);
    case 'ceasefire':
      return s(`Ceasefire between ${c} and ${o}`, `Neither side could win. The war lasted ${years(x.years)} and cost ${deaths(x.deaths)} lives in battle.`);
    case 'territory_annexed':
      return s(`${c} annexes territory from ${o}`, `It keeps the ${x.provinces > 1 ? `${x.provinces} provinces` : 'province'} its army holds, home to ${people(e.v!)} people (${pct(x.share)} of ${o}'s population).`);
    case 'regime_imposed':
      return s(`${c} installs a new government in ${o}`, `After defeating ${o}'s army.`);
    case 'group_included':
      return s(`${grp(e.v) ?? 'An excluded group'} gain a share of power in ${c}`, `${pct(x.size)} of the population, until now kept out of government.${x.demo > 0.5 ? ' Democracies include more groups.' : ''}`);
    case 'group_excluded':
      return s(`${grp(e.v) ?? 'A group'} pushed out of power in ${c}`, `${pct(x.size)} of the population lose their place in government${x.military ? ' under military rule' : ''}. Groups that lose power often take up arms within a few years.`);
    case 'org_joined':
      return s(`${c} joins ${org(e.v!)}`, x.trust !== undefined ? `It has ${relation(x.trust)} with the members.` : '');
    case 'org_left':
      return s(`${c} leaves ${org(e.v!)}`, x.suspended ? 'It had been suspended and chose to walk out.' : `Relations with the other members had soured (${relation(x.trust)}).`);
    case 'org_suspended':
      return s(`${org(e.v!)} suspends ${c}`, x.coup ? 'After an unconstitutional change of government.' : `Democracy has collapsed (score ${x.demo.toFixed(2)}).`);
    case 'org_readmitted':
      return s(`${org(e.v!)} readmits ${c}`, 'Constitutional rule is back.');
    case 'independence':
      return s(`${c} declares independence from ${o}`, `Rebels won their war for ${x.provinces > 1 ? `${x.provinces} provinces` : 'their province'}, home to ${people(e.v!)} people. The new state ${x.democratic ? 'promises elections' : 'is ruled by its former rebel commanders'}.`);
    case 'nuclear_strike':
      return s(`${c} uses nuclear weapons against ${o}`, `An estimated ${deaths(e.v!)} people are killed. ${c} was facing ${x.occ > 0.2 ? `the occupation of ${pct(x.occ)} of its territory` : 'defeat'}. Markets crash and fear spreads around the world.`);
    default:
      return s(`${c}: ${e.k.replace(/_/g, ' ')}`);
  }
}

/** One-line text (headless runner, logs). */
export const eventText = (e: SimEvent, name: (c: number) => string, ctx?: NewsContext) => { const t = describeEvent(e, name, ctx); return t.why ? `${t.headline}. ${t.why}` : t.headline; };

/** How newsworthy an event is: 3 = world-changing, 2 = major, 1 = routine. Scaled by the countries' size in the UI. */
export const IMPORTANCE: Record<string, number> = {
  oil_shock: 3, war_started: 3, war_joined: 3, war_won: 3, ceasefire: 3, territory_annexed: 3, regime_imposed: 3, nuclear_strike: 3,
  rebels_won: 3, civil_war_escalated: 3, independence: 3,
  group_included: 2, group_excluded: 2, org_joined: 2, org_left: 2, org_suspended: 2, org_readmitted: 1, coup: 3, revolution: 3, regime_overthrown: 3, sovereign_default: 3, alliance_joined: 3, alliance_left: 3, alliance_formed: 3,
  gdp_rank_up: 2, democratization: 2, autocratization: 2, government_collapse: 2, election_lost: 2, diplomatic_crisis: 2, sanctions_imposed: 2, un_sanctions_lifted: 2,
  civil_war_started: 2, civil_war_won: 2, autonomy_won: 2, peace_deal: 2, conflict_faded: 1,
  pop_peak: 2, inflation_high: 2, recession_start: 2, protests: 2, coup_failed: 2, elections_restored: 2,
  election_won: 1, recession_end: 1, debt_above: 1, pop_above: 1, pop_below: 1, sanctions_lifted: 1, inflation_tamed: 1,
};
