# Plan: the most realistic world simulation we can build

Phases 1-4 are complete: demography, economy and trade, religion, domestic politics with parties, diplomacy and
international organisations, armed conflict with provinces, occupation and new states. This plan lists everything
still to do, in the order that adds the most realism per unit of work. Every step ships as its own pull request with
its data sources, validation numbers and tests. Status is updated here as steps land.

## Principles

1. **Measured, not assumed.** Every new variable starts from a public dataset with a recorded source and year; where
   data is missing the interface says so (as with "simulated" parties).
2. **Validated against history.** A step is finished when its outputs are compared with what actually happened
   (backtests from 1990 and 2000 to 2023, event rates from conflict and political datasets).
3. **Mechanisms, not labels.** Outcomes come from causes the literature can defend (institutions, incentives,
   geography, history, exclusion), never from group identity as such.

## Steps

| # | Step | Data | Validation | Status |
|---|---|---|---|---|
| — | **Country colours** from each country's flag, toned for the map, with neighbours kept distinct | flag images (flagcdn.com, from Wikimedia) | visual check | done |
| B | **Education and learning**: adults' years of schooling, children's expected years, harmonised test scores; human capital in production; effects on fertility, democracy and conflict | Barro-Lee (World Bank EdStats), World Bank Human Capital Index (HLO test scores, expected years of school) | schooling and scores 2000-2023 in the backtest | done: adults' schooling error 0.62 years (naive 1.00), expected years 1.21 (naive 2.23); GDP error rose 25%→28%, to revisit in A |
| D | **Ethnic groups**: politically relevant groups, their size, power status and homelands; exclusion drives civil war; secession follows real homelands; inclusion and exclusion change with regimes | Ethnic Power Relations (EPR 2021), GeoEPR | onset risk by group status (Cederman, Wimmer & Min 2010) | done: onsets ×2.8 where groups are excluded (literature ×2-3), half of civil wars over territory (UCDP ~half) |
| A | **Calibration and validation**: start from 1990 and 2000, 50+ worlds, many indicators; simulated method of moments instead of hand tuning; coverage of the ensemble | everything in the model | backtest error vs naive forecasts, coverage of 10-90% bands | first round done (`docs/CALIBRATION.md`): growth parameters fitted on 2000→2010 overfit and were not adopted; persistent growth regimes added (out of sample 2010→2023: GDP error 17.8%→16.5%, coverage 28%→42%). Next: politics and conflict parameters by moments, more outcomes |
| C | **Demography matching the UN**: age-specific fertility schedules, urbanisation, mortality by age; long-run population decline only where the UN expects it | UN World Population Prospects 2024 | UN projections to 2100 | first round done (`docs/UN_COMPARISON.md`): each country's childbearing age from WPP, mortality progress; world 9.65 bn in 2050 and 10.46 bn in 2100 (UN 9.73, 10.26). Next: urbanisation, age-specific fertility shapes |
| E | **Real leaders and elites**: each country's real head of government at the start (name, age, years in office), term limits, death and succession; elites (military, business, clergy, regions) with veto and coup power | Wikidata, Archigos, V-Dem | tenure lengths, how leaders leave office | planned |
| F | **Real trade and migration networks**: observed bilateral trade instead of the gravity estimate; migrant stocks for where people move; refugee routes | CEPII BACI or IMF DOTS, UN DESA migrant stock | bilateral trade shares, migration corridors | planned |
| G | **Economy depth**: inequality and poverty, exchange rates, banking and currency crises, commodity reserves and depletion, energy transition | World Inequality Database, Energy Institute, IMF | crisis frequency, poverty trends | planned |
| H | **Climate, disasters, epidemics**: scenario temperature path hitting yields, heat and sea level; disasters at historical rates; epidemics along trade and travel links | IPCC SSP scenarios, EM-DAT, WHO | disaster losses, pandemic-scale shocks | planned |
| I | **Technology**: knowledge stocks per field (energy, computing/AI, medicine, military) diffusing through trade and alliances; nuclear proliferation | R&D spending, WIPO patents | productivity catch-up, proliferation history | planned |
| J | **Society and opinion**: attitudes by generation (religiosity, nationalism, trust, support for democracy), generational replacement, media freedom | World Values Survey, V-Dem | attitude trends 1990-2020 | planned |
| K | **War realism**: naval reach, terrain, manpower and conscription, terrorism | Global Terrorism Database, elevation data | UCDP and terrorism event rates | planned |
| L | **Presentation**: country histories, side-by-side alternative timelines, AI-written chronicle | — | — | planned |

## Two decisions and why

**Education and test scores rather than national IQ.** The widely circulated national IQ tables (Lynn & Vanhanen and
successors) rest on small, unrepresentative samples, fill many countries in from their neighbours, and are disputed
in the literature. Building them in would build in their errors. The World Bank's Harmonized Learning Outcomes put
PISA, TIMSS, PIRLS and regional assessments on one scale for about 170 countries; test-based cognitive skills are what
predicts growth in the economics literature (Hanushek & Woessmann), they respond to schooling, health and income (the
Flynn effect), and governments can change them. That is what the model uses.

**Ethnic groups rather than race.** Most countries do not record race; they record ethnicity, language or religion,
with categories that do not match across countries. The Ethnic Power Relations dataset codes the politically relevant
ethnic groups of every country, their population share, whether they hold, share or are excluded from power, and
where they live. Exclusion from power is one of the strongest predictors of civil war and secession, so the model
uses groups through that mechanism. It does not make income, intelligence or behaviour depend on group identity: there
is no evidence-based mechanism for that, and observed differences come from exclusion, discrimination, history and
geography, which the model represents directly.

## Order

Colours, B and D first (requested, and they plug into existing systems), then A so everything after is measured
against reality, then C, E, F, then G-K; L alongside.
