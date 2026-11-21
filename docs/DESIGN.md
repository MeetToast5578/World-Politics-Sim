# WORLD — Technical Design

This document answers the eight questions of the initial assignment and records what Phase 1 actually implements.
Sections marked **[implemented]** describe running code; **[design]** describes planned work that does not exist yet.

---

## 0. Status at a glance

| Area | Status |
|---|---|
| Baseline world from public data (200 political entities, 242 map regions, 4,595 provinces) | implemented |
| Deterministic engine: seeded RNG streams, integer-day calendar, boundary scheduler | implemented |
| Save / load, rewind (by replay), branching timelines | implemented |
| Demography: single-year age × sex cohort-component model, Siler life tables, migration, demographic transition | implemented (Phase 2, see §3.1) |
| Economy: growth + diffusion, business cycles with world shock, trade network, oil price, inflation, sectors, public debt, default | implemented (Phase 2, see §3.2) |
| Backtest 2000→2023 with naive benchmarks, ensemble coverage, sensitivity analysis | implemented (`docs/BACKTEST.md`) |
| Military capital stock (perpetual inventory of spending) | implemented; sets fighting strength (§3.6) |
| Chronicle/news events carrying their causal inputs | implemented |
| Observer UI: light, plain-language atlas of provinces with country names, animated news ripples, pulsing conflicts, marching front lines, occupied and rebel-held hatching; 32 map modes (8 featured), history bar with rewind, tabbed country view, world summary, news with explanations | implemented |
| Religion: 31 denominations/sects per country, secularisation, fractionalisation and polarisation | implemented (Phase 3, see §3.3) |
| Domestic politics: democracy index and regime, approval, legitimacy, unrest, elections, coups, uprisings, regime change; parties (eight families, real ruling party at the start), coalitions, military and council rule | implemented (Phase 3, see §3.4); business, regional and religious elites as separate actors still design |
| Diplomacy: relations (trust, grievance, threat), defence treaties, sanctions, crises, friend-shoring, "why" inspector; international organisations (EU, AU, ECOWAS, ASEAN, Mercosur, OPEC, OECD, BRICS, SCO) with accession, exit, suspension | implemented (Phase 3b-c, see §3.5) |
| Armed conflict: civil and interstate wars, fighting, casualties, refugees, war damage, allies, military aid, nuclear deterrence, endings, territorial change by province, rebel-held territory, new states from secession | implemented (Phase 4, see §3.6) |
| Education and learning: adults' schooling by cohort replacement, children's expected years, harmonised test scores; human capital in production; effects on fertility, democracy and civil-war risk | implemented (see §3.9) |
| Map colours from each country's flag, neighbours kept distinct | implemented |
| Technology, environment, culture/ideology | design only (Phase 5); full order of remaining work in `docs/REALISM_PLAN.md` |

Regime, democracy, approval, legitimacy, unrest, religion, relations, alliances and sanctions now evolve in the
simulation, and so do armed conflicts (starting from the 33 under way at the end of 2023). The constitutional form (Wikidata) and WGI governance scores remain static
baseline data, and the UI labels them as such. Governing-party orientation has no open data source and is drawn at the
start; the UI marks it "drawn".

---

## 1. Subsystems and dependencies

```
               ┌──────────── Geography (static + region ownership) ────────────┐
               │                                                               │
 Environment ──┼─▶ Demography ──▶ Economy ──▶ Public finance ──▶ Military capacity
  (Phase 5)    │      ▲  │           │  ▲            │                   │
               │      │  ▼           ▼  │            ▼                   ▼
               │   Society/Ideology ◀─ Domestic politics (actors, institutions) ──▶ Diplomacy ◀──▶ Conflict
               │      (Phase 5)            (Phase 3)          │                     (Phase 3)       (Phase 4)
               │                                              ▼                          │
               └──────────────── Technology diffusion ◀───────┴──────── Trade network ◀──┘
                                       (Phase 5)                          (Phase 5)
 Chronicle observes everything and writes events; it never changes state.
```

| Subsystem | Reads | Writes | Cadence |
|---|---|---|---|
| Demography [implemented] | cohorts, vital-rate targets, GDP per capita (transition), migration rates | cohorts, TFR, e0, u5, Siler parameters | yearly |
| Economy [implemented] | working-age pop, K, A, institutions (WGI), trade network, oil price, RNG | GDP, K, A, cycle, output gap, unemployment, inflation | quarterly (+ yearly structure) |
| World commodity market [implemented, minimal] | RNG | oil price | quarterly |
| Trade network [implemented] | baseline geography and GDP | partner sets and fit factors (derived cache) | built once |
| Public finance [implemented, inside economy] | GDP, debt, revenue, spending shares | debt, primary spending, default events | quarterly |
| Military capacity [implemented, minimal] | GDP, military spending share | military capital | quarterly |
| Chronicle [implemented] | everything | events, milestone memo | quarterly + yearly |
| Domestic politics [design] | economy, demography, institutions, events | government, policy levers, legitimacy, unrest | weekly / event-driven |
| Diplomacy [design] | relation graph, politics, military balance, trade | treaties, relation dimensions, sanctions | weekly / event-driven |
| Conflict [design] | military capacity, geography, politics | front lines, region ownership, casualties, damage | daily while active |
| Technology [design] | R&D, education, trade links | knowledge stocks, TFP frontier shifts | yearly |
| Environment [design] | climate scenario, geography, RNG | disaster shocks, yields, habitability | monthly / event |
| Society/ideology [design] | income, inequality, education, media, events | attitude distributions, movements | yearly |

**Rule that prevents feedback inconsistencies:** each subsystem owns the variables it writes; within one calendar
boundary, systems run in a fixed order and each reads the state as left by the systems before it (Gauss-Seidel
ordering). No system writes another system's variables. Policy levers (tax rates, spending shares, conscription) will be
written by politics and read by the economy/military on their next run.

---

## 2. State variables and data structures

### 2.1 Implemented

`WorldState` (src/engine/state.ts) holds **all** mutable state; save, hash and replay are complete by construction.

* **Per-country variables** — struct-of-arrays: one `Float64Array(n)` per field (`FIELDS`, ~80 fields). Country index is
  stable for a world's lifetime. Cache-friendly loops, trivially serialisable, maps 1:1 to a future Rust/WASM core.
* **Cohorts** — one `Float64Array(n × 2 × 101)`: persons by country, sex, single age 0..99 and 100+.
* **World variables** — `g` (oil price log deviation and its last change).
* **Trade network** — partner lists and fit factors; derived from the baseline only, so it is a cache rebuilt
  identically on load and replay rather than saved state.
* **Region ownership** — `regionOwner: Int16Array` (region → country). Territory is stored per region, not per country,
  so annexation, secession and unification become edits of this array plus creation/retirement of country slots.
* **RNG state** — one 128-bit xoshiro128\*\* state per named stream (`economy` now; `politics`, `conflict`… later).
  Streams are derived from (world seed, stream name), so adding draws to one system never perturbs another.
* **Branches** — list of (day, seed) reseed points; replay honours them.
* **Events** — append-only array of `{d, k, c, o?, v?, x?}`; `x` stores the numerical inputs that produced the event.
* **History** — yearly Float32-rounded series for 8 indicators × countries (charts, statistics, backtesting).
* **Static baseline** (public/data/baseline.json) — per country: every input as `{v, y, s}` (value, reference year,
  source id), government form with classification basis, geography (area, coastline, landlocked, neighbours).

### 2.2 Planned additions [design]

| Structure | Representation | Why |
|---|---|---|
| Relations | sparse adjacency: per pair with nonzero interaction, a small `Float32Array` of dimensions (trust, threat, trade dependence, ideological distance, grievance, alliance flags) | ~200² pairs but typically <15% matter; stored as CSR / hash map keyed `i*N+j` |
| Political actors | per country 3–8 actors (executive, legislature blocs, military, business, regional elites, opposition movement) in SoA tables: power, preferences (vector over policy dims), beliefs, risk tolerance, memory | bounded, inspectable, cheap |
| Treaties & organizations | entity tables with member lists, obligations, budgets | membership drives behaviour, not a scalar |
| Conflicts | implemented: entity per war (`WorldState.wars`): kind, sides, territory fought over, goal, score, occupied share, battle-death level and cumulative deaths; per country warLoad and conflict memory. Planned: front as contested provinces with control fractions | monthly while active |
| Beliefs | per actor estimates of others' capability/intent with noise and update lag | imperfect information |
| Provinces | implemented: Natural Earth admin-1 (4,595), owner per province in `WorldState.provinceOwner`; the map draws provinces | territory changes by province |

---

## 3. Mathematical and decision models

### 3.1 Demography [implemented, Phase 2]

Cohort-component projection, yearly on 1 January, single years of age 0..99 and 100+, by sex:

```
mortality   Siler hazard μ(x) = a1·e^(−1.5x) + c + a2·e^(0.09x),   c = 0.02·a1 + 0.0002
            a1, a2 solved per country and sex (Newton in log space) so the life table reproduces WDI under-5
            mortality and life expectancy; q(x) = 1 − exp(−∫ μ over [x, x+1))
ageing      P(x+1, t+1) = P(x, t)·(1 − q(x)),  open group 100+ accumulates
births      B = κ_f · TFR · Σ g(x) F(x),  g = discretised normal schedule (mean 28, sd 6) over ages 15-49
            κ_f calibrated so baseline births equal the WDI crude birth rate; sex ratio at birth from WDI
newborns    P(0) = B_sex · (1 − 0.8·q(0))
migration   net = rate × P, rate = 9-year WDI average decaying with τ = 25 y; outflows are removed by a fixed age
            profile, then inflows are scaled to what actually left (world population exactly conserved, tested)
transition  TFR, e0 and under-5 mortality (each sex) relax with τ = 15 y toward income curves (binned medians across
            countries vs. log PPP GDP per capita) plus a country residual decaying with τ = 40 y
            TFR curve drifts at the rate estimated from the decade before the baseline (fading, τ = 20 y)
            after TFR first falls below 2.0 the target blends toward a long-run level 1.75 (τ = 50 y; UN WPP "Phase III")
```

Initial single-year ages come from WDI 5-year groups (uniform within each group; the 80+ group is spread by
life-table survivorship).

**Drift estimation.** For each country, the 10-year change in TFR (or e0, u5) not explained by its income growth
along the curve is computed; the median per income tercile is the drift. For TFR the estimate is consistent in sign
across 1990-2000 and 2013-2023 (−0.6 to −1.5 %/yr), and it is applied. For life expectancy and child mortality it
changes sign between the two windows (AIDS in the 1990s, COVID in 2020-22), so mortality drift is **not** applied;
the backtest shows the cost of that choice (life expectancy under-predicted by ~4 years over 23 years).

**Limitations:** no secular mortality improvement independent of income (deferred to the Phase 5 health-technology
model); one fertility timing schedule for all countries (WDI adolescent fertility, which would pin it per country,
returns HTTP 400 from the API); migration has no push/pull model; income curves are cross-sectional correlations.

### 3.2 Economy, trade, prices and public finance [implemented, Phase 2]

Quarterly, values in constant base-year USD (annualised flows):

```
L   = P(15-64) · participation · (1 − u)
Y   = A · K^α · L^(1−α) · e^gap                       α = 0.35
K'  = K + (s·Y − δK)·Δt                               δ = 0.05, K₀ = 3·Y₀
s   = s_struct + 1.0·gap                              s_struct relaxes yearly to the investment income curve
ln A' = ln A + [g_F + λ·θ·max(0, ω(ln A_F − ln A) + (1−ω)(ln Ā_imports − ln A))]·Δt
        g_F = 1%, λ = 2%, θ = logistic(1.5·WGI effectiveness), ω = 0.5, Ā_imports = import-weighted partner TFP
u_c' = ρ u_c + σ_c(√w ε_world + √(1−w) ε_c)            domestic cycle; ρ = 0.8, w = 0.25, σ_c from growth volatility
gap  = u_c + 0.7·Σ_j (X_cj / Y_c) u_j + 0.5·oilExp_c·ln(P_oil)     one round of transmission, cannot explode
ln P_oil' = 0.95 ln P_oil + 0.10 ε                     oilExp = hydrocarbon rents − 0.06 × energy-import share
unemployment u = clamp(u* − 0.4·100·gap, 0.5, 60)      Okun
π_q  = π_e + 0.25·100·gap + 0.06·400·Δln P_oil          Phillips curve + energy pass-through (annual %)
π_e' = π_e + Δt[θ(3 − π_e) + (1−θ)(π_q − π_e)]           credibility θ anchors expectations to a 3% target
Debt' = Debt·e^(−(π_q − π_e)Δt/100) + [(G_prim − T) + r·Debt]·Δt      surprise inflation erodes real debt
r = 1.5% + 3%·max(0, d − max(0.6, d_ref)),  pb = pb₀ + 0.04(d − d_ref),  default if r·Debt/T > 0.30
yearly: agriculture / industry shares relax to income curves; trade openness recomputed
```

**Trade network.** Bilateral exports X_ij = a_i b_j Y_i Y_j / Y_W · D_ij^(−1) · e^(0.6·contiguity) over each
country's 20 largest gravity partners (symmetrised). a, b are fitted by iterative proportional fitting so every
country's exports and imports match its observed trade/GDP ratio. No bilateral trade data is used yet, so the
partner pattern is a model estimate. Dividing by world GDP (structural gravity) keeps shares stable under uniform
growth. The first version omitted this, and over two centuries export shares grew with world GDP until spillovers
blew up; the 300-year NaN test now guards this.

A is calibrated so baseline Y equals WDI GDP; A_F is the highest A among countries with ≥ 2 m workers. Every
parameter, with its source or the word "assumption", is in `src/engine/params.ts`.

**Limitations:** one good; no exchange rates (PPP ratio frozen) or monetary policy rates; resource rents are a fixed
share of GDP (no reserves or depletion); frontier growth is exogenous; fiscal reaction and default thresholds stand
in for decisions that Phase 3 politics will make.

### 3.3 Religion [implemented, Phase 3]

Each country holds population shares over the World Religion Project's 31 categories: Catholic, Protestant, Orthodox,
Anglican, other Christian; Sunni, Shia, Ibadi, Alawite, Ahmadiyya, Nation of Islam, other Muslim; Orthodox,
Conservative, Reform and other Jewish; Mahayana, Theravada, other Buddhist; Hindu, Sikh, Jain, Shinto, Taoist,
Confucian, Baha'i, Zoroastrian, syncretic, animist/folk, other, non-religious. Yearly:

```
secularisation   ds/dt = r·s·(1 − s/K)   s = non-religious share; r, K fitted by least squares on within-country WRP
                 changes over the 15 years before the WRP year (2023 baseline: 1995→2010, r = 0.030, K = 0.29;
                 2000 baseline: 1985→2000, r = 0.029, K = 0.20). Countries already above K are not pushed down.
                 Religious groups lose proportionally, so each country's denominational mix is preserved.
indices          fractionalisation F = 1 − Σ s²;  polarisation RQ = 4 Σ s²(1 − s) (Montalvo & Reynal-Querol 2005)
```

Population change carries the composition: world shares shift as countries grow at different rates (Islam reaches
parity with Christianity around 2100 in seed 1, the direction Pew's projections also show). Religion enters politics
through polarisation, which raises unrest and uprising risk (§3.4). It is a structural property; the model gives no
religion its own behaviour.

**Limitations:** WRP ends in 2010 (simulated forward from there), and its quality varies by country (reliability is
shown in the UI). Within-country fertility and migration do not differ by religion, and conversion only happens into
and out of non-religion. State religion policy and post-communist religious revival are not modelled. An earlier
version used an income cross-section instead of the panel fit and made the world *less* secular over time, which is
why the panel fit is used.

### 3.4 Domestic politics [implemented at aggregate level, Phase 3]

Quarterly, per country (`systems/politics.ts`; every weight is in `params.ts` with its source or "assumption"):

```
approval   → 0.5 + 1.5·(growth surprise) − 0.01·Δmisery − 0.015·max(0, years in office − 2) + noise    (economic voting)
legitimacy → baseline (WGI political stability) + 0.6·(remembered approval − 0.5) + 0.3·Δdemocracy
unrest     → logit⁻¹( logit(baseline) + 0.06·Δmisery + 3·(0.5 − approval) + 3·Δlegitimacy loss
                      + 4·Δreligious polarisation + 8·Δyouth share )                    each relative to the baseline
elections  every 4 years in electoral regimes; incumbent survives with p = logistic(6(approval − ½) + 4(1 − demo) − 0.3·terms)
coups      h = 0.35·logistic(3(1 − demo) + 2·unrest + 0.5·coup memory + 0.8·recession − 2·legitimacy − 0.8·ln(income/10k) + c)
           c solved at t0 so the world total is 3 attempts / year; success ≈ 50%; a success brings military rule,
           democracy × 0.6 and an output loss
uprisings  while unrest > 0.5: h ∝ (unrest − 0.5)·(1.5 − legitimacy)·e^(1.5(polarisation − 0.5)); outcome is a
           democratic revolution, an authoritarian overthrow or (in democracies) the fall of the government
democracy  drift toward partners' average (diffusion), pull toward the country's own baseline (institutional
           persistence, τ = 30 y), noise, fat-tailed episodes (18%/yr, sd 0.06), erosion by popular incumbents in
           weak electoral regimes (aggrandisement), and a recovery when they lose elections (U-turns)
regime     categories from the democracy index with hysteresis (democratise > 0.50, autocratise < 0.46)
policy     governing orientation moves revenue/GDP ±10% of its baseline; unrest above baseline costs output
```

**Calibration against base rates** (2024-2046, 8 seeds; V-Dem figures computed in the data build):

| Quantity | Simulated | Observed |
|---|---|---|
| coup attempts per year, world | ≈ 2.5 (2.4 in the 2000-2023 backtest) | ≈ 3 (Powell & Thyne, order of magnitude since 2000) |
| democracy/autocracy crossings per country-year | 0.015 | 0.0195 with the same index rule on V-Dem 2001-2023 (0.025 with RoW's extra criteria) |
| democratisations vs autocratisations | 1.1 vs 1.2 per year | 55 vs 49 over 2001-2023 |
| incumbent defeat in elections in democracies | 34% | no single comparable figure; order of magnitude of incumbent-party turnover |
| democracy index 2023 (backtest) | error 0.09-0.10, bias +0.04, 51% inside the 10-90% band | persistence forecast error 0.06 |

The model does **not** beat simple persistence for democracy over 23 years. Its pro-democratic bias comes from
diffusion (switching diffusion off removes it), consistent with 2000-2023 being a period of autocratisation that
diffusion models miss. The coup hazard saturates because an exponential version produced runaway coup traps (the
Central African Republic had 117 coups in 50 simulated years); coups now concentrate where they occur in reality
(Sahel, Central Africa) and become rarer as countries grow richer.

**Parties and governments** (`systems/parties.ts`). The party of the head of government (head of state in
presidential systems) at the end of the reference year comes from Wikidata (office holder and party membership valid
on 31 December, political alignment P1387; 116 countries for 2023, 72 for 2000); its alignment sets the government's
left-right orientation and its party family. All other parties are **simulated**, eight families with left-right
positions (Left −0.8, Social Democrats −0.45, Greens −0.35, Liberals 0.05, Centre-Right 0.3, Conservatives 0.55,
Nationalists 0.85, a religious party 0.6 named after the dominant religion); no open dataset covers party systems
worldwide (ParlGov: ~40 countries), and the interface says so.
```
start      vote shares from income (social democrats, liberals, greens), religiosity (conservatives, the religious
           party), polarisation and poverty (nationalists, left), + 0.18 for the governing family (0.35 in electoral
           and closed autocracies), × lognormal(0.25)
election   the calibrated model above decides whether the government survives; then governing families × e^0.05 (won)
           or × e^−0.4 (lost); nationalists × e^(0.04·Δhardship + 1.0·Δpolarisation + 0.6·Δunrest), left × e^(0.02·Δhardship),
           greens × e^(0.5·(income − 0.8)); noise sd 0.12. Seats: proportional with a 5% threshold (parliamentary,
           semi-presidential, constitutional monarchy) or the cube law (others). Government: the incumbent family (if
           it won) or the largest opposition family, plus the nearest families until a majority (at most four
           parties); orientation = seat-weighted position, which drives fiscal policy as before.
takeover   coups install military rule, overthrows and autocratic rebel victories a ruling council: no party governs
           until elections return
```
The real party's name is shown while it governs; it loses it at its first defeat. **Still design:** business, regional
and religious elites as separate veto players with their own preferences.

### 3.5 Diplomacy [implemented, Phase 3b]

Relations live on a sparse set of ~5,000 country pairs: trading partners, land neighbours, treaty co-members,
sanction pairs, pairs with a conflict history and all pairs among the 12 largest military powers. Yearly
(`systems/diplomacy.ts`, weights in `params.ts`):

```
trust      → tanh(0.9 − 0.35·|UN-voting gap| − 0.5·|democracy gap| + 0.5·ln(1 + 10·trade dependence)
                  + 0.8·[same defence treaty] + 0.4·(religious similarity − ½) − 0.5·grievance − 0.6·sanctions)
             relaxes over ~5 years; initial trust is the same formula at baseline
grievance  initial: conflict history (COW MIDs to 2014, UCDP interstate conflicts 2015-2023), each dispute-year
           weighted by hostility and decayed with a 15-year memory; adds from crises and sanctions; decays
threat     i's view of j = proximity × j's share of their combined military capital × (1 − trust)/2
UN voting  position moves with democratic change (cross-sectional slope 2.05, R² 0.50)
trade      bilateral flows × (1 − 0.6·sanction intensity) × e^(0.3·Δtrust)   ("friend-shoring")
```

Decisions are saturating hazards whose constants are solved at t0 to a base rate. Each records its inputs, and the
country panel shows the decomposition of every relationship's trust (the "why did X do Y" inspector).

| Decision | Drivers | Base rate | Simulated (2024-46) |
|---|---|---|---|
| Diplomatic crisis | proximity, threat, grievance, distrust, unrest | ≈ 4/yr (ICB order of magnitude) | ≈ 2.9/yr |
| Sanctions | need a trigger (coup, democratic crackdown, threat to the sender, serious conflict history); larger sender, distrust, allies already sanctioning (coalitions); deterred by trade at stake | 20 directed/yr (assumption, GSDB inaccessible) | ≈ 18/yr imposed, 16 lifted |
| UN sanctions | country-level status; lifted collectively, faster after democratisation | — | — |
| Join a treaty | multilateral treaties only; trust in members, protection against the main threat, proximity; members must trust the applicant | 1.8/yr (ATOP 2001-18) | ≈ 0.4/yr |
| Leave a treaty | only members that distrust their partners; protection keeps them | 1.8/yr | ≈ 0 |
| New bilateral pact | trust, shared threat, proximity | 0.39/yr | ≈ 0.1/yr |

**Findings and limits.** The 2001-2018 alliance base rates include post-Cold-War enlargement waves and post-Soviet
realignments. Today's data offer few candidates that meet the conditions, so the calibrated hazards cannot reach those
rates. That is reported, not forced. UN voting is the only observed alignment measure; it makes the US look distant
from most of the Global South (hence a low weight) and misses strategic partnerships (US–Saudi Arabia comes out cool,
Saudi Arabia–Iran warm). Without wars (Phase 4), grievances decay and the world drifts friendlier: mean trust rises
from 0.46 to 0.59 in 150 years and the sanctions stock falls from ~200 to ~50 directed pairs. Early versions showed
why the trigger and size rules exist: rich states sanctioned random small countries, and Malawi "lifted its
sanctions" on North Korea when UN sanctions were modelled as 199 bilateral ones.

**International organisations** (`systems/organisations.ts`, Phase 3c). Membership at the reference year is curated
from the organisations' membership pages, with joining (and leaving) years so the 2000 baseline is right too: EU
(27 in 2023), African Union (55; 6 suspended after coups), ECOWAS (15; 4 suspended), ASEAN, Mercosur (Venezuela
suspended), OPEC, OECD, BRICS (5), SCO (9). Status per country and organisation: none, member, suspended, former.
```
effects    relative to the start: trust + w per organisation two countries newly share (EU 0.3, BRICS 0.2, others
           0.1-0.15; a trust driver shown in the inspector), trade × e^w between members of a trade bloc (EU 0.5,
           Mercosur 0.3, ASEAN 0.2, ECOWAS 0.15) — so joining or leaving moves trust and trade, and 2023 is reproduced
suspend    AU and ECOWAS after a coup, an overthrow or an autocratic rebel victory in the past year; EU, Mercosur and
           OECD when democracy falls below half their threshold; readmission 50%/yr once elections are back; suspended
           ECOWAS members walk out at 25%/yr (Mali, Burkina Faso, Niger announced it in January 2024)
join       yearly hazard for eligible countries, at most one accession per organisation a year (the AU admits all):
           EU (European, democracy > 0.65, income $15k to 1.2 × the members' median, trust > 0.3, 1M+ people),
           OECD (democracy > 0.6, income > $25k, 1M+), ASEAN (Southeast Asia), Mercosur (South America), ECOWAS (West
           Africa, elections), AU (African and not unrecognised), OPEC (oil-income weight > 0.08), BRICS (30M+ people,
           close to China, not close to the US, not OECD), SCO (Asian, close to China and Russia); BRICS, SCO and ASEAN
           admit only fully recognised states; former members rejoin at a tenth of the rate
leave      0.1%/yr × e^(2.5·(0.3 − mean trust in the members)); OPEC members whose oil income fades
```
In 4 × 30 simulated years: EU accessions ≈ 0.07/yr (Moldova, North Macedonia, Albania, Kosovo), OECD ≈ 0.18/yr
(Romania, Croatia, Bulgaria, Argentina, Indonesia, Peru: the current applicants), BRICS ≈ 0.3/yr (Saudi Arabia,
Egypt, Iran, Algeria, Indonesia...), the Sahel juntas leave ECOWAS. Rates are assumptions of the observed order.

### 3.6 Armed conflict [implemented, Phase 4]

Unit: an armed conflict in UCDP's sense (organised violence with at least 25 battle deaths a year), either **civil**
(a government against rebels, at most one per country; foreign states may fight for the government or back the
rebels) or **interstate** (an attacker against a defender, each with allies; fighting is on the defender's territory).
Territory is held and transferred by **province** (Natural Earth 1:10m admin-1, 4,595 units; population per
province from Wikidata P1082 where available, 3,856 of them, scaled to the World Bank total; otherwise estimated from
city populations and area). Initial state: the 33 conflicts under way at the end of 2023 in the UCDP/PRIO Armed Conflict Dataset v26.1 (Russia
against Ukraine, Iran against Israel and 31 civil conflicts), with their 2023 battle deaths (UCDP Battle-Related Deaths
v26.1) as each conflict's intensity. Only Russia's occupation of Ukraine is curated (Donetsk, Luhansk and
Zaporizhzhia; Crimea and Sevastopol are Russian provinces in Natural Earth's admin-1 data, which follows control on the
ground); UCDP has no front lines.

```
onset      civil, per country-year (Fearon & Laitin 2003; Hegre & Sambanis 2006):
             p = 0.5 · logistic(c + 0.4 ln(pop/10M) − 0.9 ln(GDP pc PPP/5000) + 0.6 [electoral autocracy]
                 − 1.0 [liberal democracy] + 3 (unrest − 0.3) + 0.8 polarisation + 4 (youth share − 0.3)
                 + 1.5 conflict memory + 0.5 [a neighbour at war])
           interstate, per pair-year on the diplomatic pair list (Bremer 1992; Russett & Oneal 2001), only land
           neighbours, or pairs with one of the 15 largest militaries and a quarrel (grievance > 0.3), only countries
           not already in an interstate war:
             p = 0.08 · logistic(c + 2 [contiguous] + 1.2 grievance − 2 trust − 1.5 [both democracies]
                 + 0.8 parity − 1.2 [allies] − 2.5 nuclear umbrella + 1 max unrest)
           c is solved at t0 so the expected world rate equals UCDP's 1990-2023 rate (civil 4.8 country onsets a year,
           interstate 0.5). The attacker is the side with more usable force, discounted by democracy. Conflict memory
           starts from the last year of internal conflict (UCDP) and decays over 10 years.
allies     defence-treaty partners of the defender join with probability 0.2 · (1 + trust)/2 · reach (× 0.3 for
           multilateral treaties); of the attacker 0.05 ·…; members of a treaty with both sides stay out
fighting   monthly. Strength = military capital (floor: 1% of GDP accumulated) × reach (1 if contiguous, else
           1/(1 + km/2000)); defenders ×1.5 at home; a government ×(0.5 + legitimacy), rebels 0.6 × the state's
           capital × (0.5 + unrest); military aid from non-belligerents with trust(m, side) − trust(m, enemy) > 0.6
           (3% of their capital per unit above). score += 0.3 · (A − B)/(A + B) · dt + 0.5 √dt · ε, clamped to ±1.
           A winning attacker occupies the defender's territory at 0.1 × score a year (at most 50%): province by
           province from the border (most-surrounded first; across the sea, the nearest), given back in reverse
           order when the defender pushes back.
deaths     battle deaths per year = exp(sev + lvl): sev drawn per war (civil: ln 325 + 1.45 ε; interstate:
           ln 140 + 3.0 ε), lvl an AR(1) (0.94 monthly, sd 0.3). Combatants die among men 18-40; 0.3 civilians per
           battle death across ages; 30 refugees per battle death move to land neighbours at peace, by population.
           Caps: battle deaths ≤ 1% of the population a year, refugees ≤ 0.4% a month (Syria's worst years ≈ 0.35%
           and ≈ 0.5%); without them, heavy-tailed draws emptied small countries in 300-year runs.
damage     warLoad = ln(1 + battle deaths per person-year / 10⁻⁴) on the territory (≈ 3 for Ukraine 2023):
           capital × e^(−0.05·warLoad·dt), productivity × e^(−0.01·warLoad·dt); unrest rises 0.3 per unit above the
           2023 level. Belligerents' military spending moves toward 4% of GDP (+ up to 25% where the war is fought),
           then back to the pre-war level over ~5 years. Interstate wars add grievance (+1.5) and cut trust (−0.3)
           between the sides; both governments get a rally-round-the-flag bonus.
ending     monthly hazard α/(τ + t) · (1 + score²): civil α = 0.95, τ = 2.5 years; interstate α = 2.1, τ = 1 year
           (Lomax: the longer a war lasts, the less likely it ends in any given month, as in UCDP).
           civil: score > 0.75 government victory; < −0.75 rebel victory (a change of government, democratic with
           probability 0.25, or self-rule for a region if the war was over territory); otherwise a peace agreement
           (35%) or the fighting fades.
           interstate: |score| > 0.75 victory, otherwise a ceasefire on the current line. The attacker keeps the
           provinces it holds (if ≥ 5% of the defender's people) unless it lost: they change owner on the map, and
           their share of the defender's people, capital and output moves with them (public debt stays). A
           victorious attacker in a war over government imposes a new one.
rebels     in conflicts that have reached civil-war scale (1,000 battle deaths a year), rebels hold provinces: a
           share of the population 0.3 · 2/(1 + e^(3·score)) · √(min(1, deaths/1,000)), approached over ~6 months,
           starting from the province farthest from the most populous one and growing to its neighbours. Shown on
           the map; no effect on fighting yet.
nuclear    a nuclear-armed state (SIPRI 2023 list) whose own territory is > 25% occupied, or whose government a
           foreign army is about to overthrow, uses nuclear weapons with probability 0.5% a month: 2% of the
           target's population killed, a quarter of its capital destroyed, a world oil shock and recession; the
           target retaliates if it can (80%). Never triggered in the calibration runs below.
```

**Calibration** (10 worlds × the first 20 years, `npm run conflicts -- 10 20`; targets from the
data build, UCDP 1990-2023):

| Measure | Model | UCDP |
|---|---|---|
| civil conflict onsets per year (country level) | 4.95 | 4.8 |
| countries with a civil conflict (average) | 34.7 | 30.2 |
| civil spell length in calendar years, q25/q50/q75/q90 (wars started in the simulation) | 1/2/4/7 | 1/2/4/7 |
| interstate onsets per year | 0.53 | 0.50 |
| interstate duration in years, q25/q50/q75/q90 | 0.25/0.50/1.00/1.91 | 0/0.42/0.91/2.05 |
| battle deaths per year (mean) | 64,700 | 64,800 |
| civil endings: faded / peace agreement / government won / rebels won (incl. self-rule) | 46 / 26 / 18 / 6% (+ 4% self-rule) | ≈ 46 / 35 (agreements + ceasefires) / 10 / 6% (Kreutz 2010) |

Over 50 years both onset rates fall (≈ 4.4 civil, ≈ 0.35 interstate a year) because incomes rise and old grievances
fade; this is the model's mechanism, not a target. Extrapolated for centuries it ends in a world without armed
conflict (around 2400 in a typical run), because income strongly lowers the civil-conflict hazard and incomes keep
growing; whether conflict risk should depend on absolute or relative income is a question for Phase 6 calibration. The test suite checks these rates on 4 worlds × 20 years.

**New states.** Rebels who win a war over territory found a state with probability 0.4 (otherwise self-rule): the
provinces they hold (separatists hold at most 20% of the population and never the most populous province), their share
of the people, capital and output, half the rebels' share of the military, no debt, a new government (democratic with
probability 0.3), hostile relations with the old state (trust −0.6, grievance 2). It is named after the disputed
territory UCDP records (Kurdistan, Balochistan, Ambazonia...) or the rebels' heartland province. The engine grows by
one country in place (`systems/secession.ts`): the baseline copy, the trade network (the new state trades with its
parent's partners; others append it, so pair indices stay valid), the diplomatic pairs, the conflict geography, every
per-country array and the history (NaN before independence); saves record each new state and rebuild it on load.
In 6 worlds × 60 years: 11 new states (Kurdistan from Turkey, Duhok from Iraq, Al Mahrah from Yemen...), fewer than
the ~1 per decade since 1990. Rebel-held territory adds to the rebels' strength (× 1 + 1.5 × share held) and costs the
state output (0.1 × share a year on the cycle) and legitimacy.

**Limitations.** Province populations are fixed weights from the start (people moved with a province are the
province's share of the country's population at the time); land contiguity between existing countries is not updated
after annexations; one civil conflict per country stands for all of UCDP's dyads there; non-state and one-sided
violence (UCDP's other datasets) are not modelled. Distant wars need a major military and a quarrel; a simulated diplomatic crisis can still create one
with no historical analogue (about one in 100 interstate wars).

### 3.7 Technology, environment, society [design, Phase 5]

* Technology: knowledge stocks per domain (energy, computing/AI, manufacturing, agri/bio, transport, comms, medicine,
  aerospace) accumulated from R&D × researchers, diffusing along trade and alliance links with lags; domain stocks
  shift TFP, mortality curves, military quality, energy mix. No scripted tech tree.
* Environment: exogenous climate scenario (e.g. SSP pathway temperature) mapped to regional yield and disaster
  frequencies; disasters as Poisson events with condition-dependent rates; epidemics as SIR at country level with
  travel coupling.
* Society: distributions (not scalars) of attitudes per cohort; generational replacement drives slow change; material
  conditions, education, and media environment shift the distribution.

### 3.9 Education and learning [implemented]

Data: adults' mean years of schooling (age 25+) and children's expected years of school from the UNDP Human
Development Report 2025 time series (Barro-Lee and UNESCO based); harmonised test scores (PISA, TIMSS, PIRLS and
regional tests on one 300-625 scale) from the World Bank Human Capital Index. Test scores, not national "IQ" tables:
see `docs/REALISM_PLAN.md` for why.

Yearly (`systems/education.ts`):

* expected years relax toward their income curve (with the curve drift measured over the decade before the start,
  as for fertility: schooling spread faster than income in 1990-2010) plus a fading residual, times
  e^(−0.08·warLoad) (war keeps children out of school);
* test scores relax toward their income curve plus residual with a 20-year time constant;
* adults' schooling changes by cohort replacement: Δyears = r·(entrants − years), r = 1.3 × the share of 25-year-olds
  in the 25+ population (the extra 0.3 stands for older, less-schooled adults dying). Entrants' schooling at the
  start is set so the stock follows its observed trend of the previous ten years, then moves with 0.85 × the change of
  a 15-year pipeline that starts from expected years 15 years before the start (HDR) and follows today's;
* adults' learning is replaced the same way.

Effects: human capital per worker h = exp(0.08 · years · learning/625) (learning-adjusted years; 8% return per
year as in the Human Capital Index) enters production Y = A K^α (hL)^(1−α); TFP is calibrated net of h at the start,
and the frontier growth rate excludes the share of rich-country growth that came from rising schooling. Schooling
gained since the start lowers fertility (log TFR −0.05 per year) and raises the long-run democracy level (+0.02 per
year), and schooling above 8 years lowers civil-war log-odds (−0.08 per year; Thyne 2006).

Validation (2000→2023, `docs/BACKTEST.md`): adults' schooling median error 0.62 years against 1.00 for the 1990s
linear trend; expected years 1.21 against 2.23 for no change. Both are biased low: the expansion of schooling in the
poorest countries after 2000 (Education for All, Millennium Development Goals) was faster than income predicts. With
human capital in production the GDP growth error is 28% (25% without; the model already overshot growth and now
overshoots more in Latin America and East Asia); the macro return to schooling is contested (Pritchett 2001 against
Cohen & Soto 2007) and is a target of the planned calibration step (A).

### 3.8 Optional narrative layer

An LLM may later turn recorded events into prose. It receives only event records and state values and cannot write
state. Phase 1 already renders the news feed from event records with templates (`src/engine/describe.ts`).

---

## 4. Update order and time-step architecture [implemented]

The clock is an integer day (days since 1970-01-01, proleptic Gregorian; no `Date` objects). `advanceTo(day)` jumps
from calendar boundary to boundary:

```
1st of every month           conflict.monthly (fighting, casualties, refugees, war damage, mobilisation, endings)
1 Jan / Apr / Jul / Oct      economy.quarterly (oil price → TFP → domestic cycles → gaps → output, prices, debt)
                             → politics.quarterly (approval → legitimacy → unrest → elections → coups → uprisings
                               → regime categories) → chronicle.quarterly
every 1 Jan                  demography.yearly (cohort step → migration → transition) → economy.yearly → education.yearly
                             → religion.yearly (secularisation, indices) → diplomacy.yearly (UN position →
                               trust → crises, sanctions, alliances → trade multipliers, sanction costs)
                             → conflict.yearly (onsets of civil and interstate wars, allies joining)
                             → chronicle.yearly → history.record
```

Conflicts run monthly (cost ∝ wars under way). A **daily phase** and an **event queue** (priority queue keyed by day) for
discrete happenings: elections on their constitutional dates, treaty expiries, scheduled summits, hazard-drawn events.
Planned full order on a boundary: environment → demography → economy → politics → diplomacy → conflict →
chronicle → history. Days without boundaries or queued events cost nothing.

**Determinism**: fixed iteration order; RNG streams per system; every country draws in index order regardless of
state; no wall-clock or `Math.random` inside the engine. JS arithmetic is IEEE-754, but `Math.exp/log/pow` are not
specified bit-exactly across engines, so bit-identical replay is guaranteed for the same JS engine family (V8 for Node
and Chrome); a Rust/WASM core would make it cross-platform.

**Rewind and branching**: rewind = rebuild from the baseline with the same seed and replay to the target day,
re-applying recorded branch points. A branch reseeds every stream at the current day. Replaying 300 years costs
~1.5 s since Phase 2 (life tables are re-solved yearly); yearly snapshots as a replay cache are the next step if
politics/conflict raise the cost further (the replay path stays authoritative).

---

## 5. Computational cost and optimisation

Measured with `npm run bench` (Node 22, one core of a 2.1 GHz Xeon):

| Measurement | Result |
|---|---|
| 300 simulated years, 200 countries | 3.9 s (13.0 ms / year); Phase 1 0.84, Phase 2 5.2, Phase 3a 7.3, Phase 3b 13.4 ms / year |
| per year: demography / economy / politics / religion / diplomacy / conflict / chronicle | 3.5 / 0.9 / 1.0 / 0.02 / 5.1 / 1.6 / 0.2 ms |
| scaling: 200 / 400 / 800 / 1600 entities | 15.6 / 36.2 / 67.3 / 126.8 ms per year (≈ linear) |
| save (300 years of history and 80k events) | 327 ms, 15.6 MB JSON |
| load / full replay of 300 years | 357 ms / 3.9 s |
| determinism, 3 runs | identical hashes |

Demography dominates: each year every country re-solves two Siler parameters per sex (warm-started Newton with
precomputed age terms; the first version used bisection and cost 54 ms / year).

In the browser the worker posts a frame every 50 ms; the UI stays responsive at 50 simulated years per second.

**Expected expensive operations (future) and the plan for each**

| Operation | Naïve cost | Plan |
|---|---|---|
| Dyadic diplomacy | O(N²) per tick | done: ~5,000 relevant pairs, yearly; dense n×n pair index (the first version used a hash map and per-pair treaty scans and cost 26 ms / year) |
| Actor decisions | optimisation per actor per tick | small candidate sets, logit choice, decisions only on triggers or weekly |
| Trade network | O(N²) gravity flows | done: top-20 partners per country, flows computed on demand from GDP |
| Warfare | per-region daily | only for regions on active fronts; admin-1 detail loaded on demand |
| Events / history growth | unbounded | importance filtering; history thinning for very long runs; binary save format |
| Map rendering | re-projection | Path2D cached per region; only fills recomputed (already done) |

Optimisations must keep the hash test green; a profile must show a hotspot before code is made more complex.
The chronicle currently uses string-keyed memo maps and is the most expensive system — the first candidate if needed.

---

## 6. Data requirements and limitations

See `docs/DATA_SOURCES.md` for every source, licence, coverage count and override. Key points:

* Baseline reference year 2023 (latest observation 2015–2023 per field, year recorded). Start date 2024-01-01.
* A second baseline for 2000 (`npm run data -- --year 2000`, observations 1992–2000) drives the backtest; it uses
  today's borders and entities and current Wikidata government forms (not used by the dynamics).
* 200 political entities: 194 widely recognised states (UN members plus the Holy See), 4 partially recognised
  (Taiwan, Kosovo, Palestine, Northern Cyprus), 1 unrecognised de facto state (Somaliland) and 1 non-self-governing
  territory (Western Sahara). Dependencies are regions of their sovereign state.
* Missing values are explicit. Population/GDP fall back to Natural Earth estimates (flagged `NE_EST`); other fields to
  the regional median (flagged `IMPUTED`; extensive quantities use a per-capita median × own population so no two
  countries receive identical absolute values). Military spending and armed forces are **not** imputed.
* Country data and land neighbours come from Natural Earth's 1:50m countries (Crimea, Kashmir, etc. as in Natural
  Earth's default view). The map and territory are Natural Earth's 1:10m provinces, which follow control on the ground:
  Crimea and Sevastopol are Russian provinces there, so the map shows them as Russia from the start, while 2023
  country statistics are the World Bank's. Maritime neighbours are not yet computed.

**Data still missing for later phases**: UN WPP fertility/mortality schedules (Phase 2 uses WDI aggregates and
parametric schedules), trade matrices (UN Comtrade /
CEPII BACI), IGO membership (COW), regime histories (V-Dem — CC BY-SA,
licence compatibility to check), terrain/elevation rasters (Natural Earth / ETOPO), energy and mineral reserves
(EIA / USGS), infrastructure (OpenStreetMap — ODbL), admin-1 boundaries (Natural Earth).

---

## 7. Roadmap

| Phase | Deliverable | Exit test |
|---|---|---|
| 1 ✅ | Baseline data pipeline, engine core, demography & economy prototypes, save/load/rewind/branch, map UI | invariants + reproducibility tests green; UI drives the worker |
| 2 ✅ | Single-year age × sex cohorts; Siler life tables; sectors; oil price; inflation; procyclical investment; gravity trade network; 2000 baseline and backtest | backtest 2000→2023 reported per region with naive benchmarks and sensitivity (`docs/BACKTEST.md`). Deferred: resource reserves and depletion, exchange rates, bilateral trade data |
| 3 (part) ✅ | Religion (31 denominations, secularisation, polarisation); aggregate domestic politics: democracy, regimes, approval, legitimacy, unrest, elections, coups, uprisings | coup and regime-transition rates vs. Powell & Thyne and V-Dem 2001-2023 (§3.4); democracy in the backtest |
| 3b ✅ | Diplomacy: relations graph, ATOP defence treaties, sanctions (curated 2023 programmes, UN regimes), crises, friend-shoring; trust inspector | alliance and crisis rates vs. ATOP / ICB (§3.5) |
| 3c ✅ | Parties (real ruling party from Wikidata, simulated party families, seats, coalitions), military and council rule; international organisations with accession, exit and suspension | consistency tests; organisation rates of the observed order (§3.4, §3.5). Deferred: elites as separate veto players |
| 4 ✅ | Civil and interstate conflict from UCDP 2023, onset, fighting, casualties, refugees, war damage, allies, military aid, nuclear deterrence, endings; provinces (Natural Earth admin-1, Wikidata populations) as the map and the unit of occupation and annexation | onset, duration and battle-death distributions vs. UCDP 1990-2023 across seeds (§3.6) |
| 4c ✅ | New states from secession (variable number of countries), rebel-held territory with effects | exact save/load and replay with new states; conservation tests |
| 5 | Technology domains & diffusion; environment & disasters; migration push/pull; ideology & society | sensitivity analysis of long-run outcomes |
| 6 | Calibration (simulated method of moments over many seeds), pathology hunting, profiling-driven optimisation; Rust/WASM core if profiling justifies | 500-year runs without degenerate outcomes; ensemble statistics |
| 7 | Rich country histories, timeline replay scrubber, scenario comparison across branches, narrative generation | — |

---

## 8. Scientific and technical uncertainties

1. **Long-run fertility.** Below-replacement fertility is the dominant long-run driver. With the default UN-WPP-style
   recovery to 1.75, world population (seed 1) peaks at ≈ 10.25 bn in the 2080s and falls to ≈ 2.1 bn by 2324; with
   recovery switched off (`fertilityPhase3.on = false`) and the measured fertility drift, it falls much further. Both are
   scenarios, not forecasts; the parameter is exposed for that reason.
2. **Growth over centuries.** Exogenous 1% frontier TFP growth compounds without limit. Endogenous technology
   (Phase 5) and resource constraints are needed before multi-century economic outputs mean anything.
3. **Political behaviour is the least constrained component.** Utility parameters for actors cannot be measured
   directly; they must be calibrated to aggregate base rates (coups, wars, transitions), which are rare events — wide
   parameter uncertainty is unavoidable and must be reported.
4. **Rare-event calibration.** World wars and state collapses are too rare to calibrate per country; calibration has
   to target distributions across many seeds and accept that any single timeline is one draw.
5. **Imputation bias.** ~5–20% of entries for some fields are imputed; small and conflict-affected states are
   over-represented among them. Their trajectories are less trustworthy and the UI marks those fields.
6. **Determinism across platforms** (see §4) — acceptable now, solvable with a WASM core.
7. **Aggregation level.** Country-level aggregates hide sub-national conflict and inequality; admin-1 resolution
   on demand is planned but its data quality varies widely.
8. **Cross-sectional relationships used as dynamics** (income → fertility/longevity, institutions → technology
   absorption) are correlations; treating them as causal mechanisms is an explicit modelling assumption.
9. **The model is over-confident.** In the 2000→2023 backtest only 1-17% of actual outcomes fall inside the
   ensemble's 10-90% band: the stochastic shocks are far smaller than real history's wars, crises, pandemics and
   policy changes. Phase 3/4 mechanisms should widen the spread; until then single timelines understate uncertainty.
10. **Growth parameters.** The backtest overshoots real GDP growth by ~12-15% (median) with literature-based defaults;
   halving catch-up speed or frontier growth removes the bias (sensitivity table). Part of the overshoot is the absence
   of crises; the rest is a calibration question for Phase 6, deliberately not tuned on this backtest.
11. **Political parameters are weakly identified.** The politics weights reproduce aggregate base rates but many
   combinations would; the backtest shows the model does not beat persistence for democracy. Political outcomes
   should be read as plausible distributions, never as forecasts for a given country.
12. **Religion data age and definitions.** The composition is from 2010 (WRP) and definitions differ from Pew's
   (WRP counts China as 42% syncretic and 33% non-religious; Pew counts 52% unaffiliated), so the world
   non-religious share starts at ~10% rather than Pew's ~24%.
13. **Diplomacy calibration is thin.** Sanction rates have no validated target (the Global Sanctions Data Base needs
   registration), the alliance base rates come from an unusual period, and trust weights are assumptions anchored on one
   observed measure (UN voting). Relations are best read as directions and orders of magnitude.
