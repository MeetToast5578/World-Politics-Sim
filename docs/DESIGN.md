# WORLD — Technical Design

This document answers the eight questions of the initial assignment and records what Phase 1 actually implements.
Sections marked **[implemented]** describe running code; **[design]** describes planned work that does not exist yet.

---

## 0. Status at a glance

| Area | Status |
|---|---|
| Baseline world from public data (200 political entities, 242 map regions) | implemented |
| Deterministic engine: seeded RNG streams, integer-day calendar, boundary scheduler | implemented |
| Save / load, rewind (by replay), branching timelines | implemented |
| Demography: single-year age × sex cohort-component model, Siler life tables, migration, demographic transition | implemented (Phase 2, see §3.1) |
| Economy: growth + diffusion, business cycles with world shock, trade network, oil price, inflation, sectors, public debt, default | implemented (Phase 2, see §3.2) |
| Backtest 2000→2023 with naive benchmarks, ensemble coverage, sensitivity analysis | implemented (`docs/BACKTEST.md`) |
| Military capital stock (perpetual inventory of spending) | implemented (no conflict use yet) |
| Chronicle/news events carrying their causal inputs | implemented |
| Observer UI: map with 19 modes, time controls, country inspector with population pyramid, world panel, news feed | implemented |
| Domestic politics, factions, elections, regime change | design only (Phase 3) |
| Diplomacy, alliances, organizations, sanctions | design only (Phase 3) |
| Conflict and warfare, territorial change | design only (Phase 4) — data structure for territorial change exists |
| Technology, environment, culture/ideology | design only (Phase 5) |

Nothing in the political, diplomatic or military columns of the UI is decided by the simulation yet. Government form and
WGI governance scores are static baseline data in Phase 1, and the UI labels them as such.

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
| Conflicts | entity per war: belligerents, objectives, front (list of contested regions with control fraction), casualties, exhaustion | event-driven, daily only while active |
| Beliefs | per actor estimates of others' capability/intent with noise and update lag | imperfect information |
| Sub-national regions | Natural Earth admin-1 (~4,600) loaded on demand for countries in crisis | multiresolution |

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

### 3.3 Domestic politics [design, Phase 3]

* **Actors** with power weights `w_a` (from institutions: seats, control of security forces, wealth), ideal points
  `x_a` on 4–6 policy dimensions (redistribution, openness, security, centralisation, religion-state, …), risk
  tolerance, beliefs.
* **Policy choice** by the executive: maximise its utility subject to institutional veto players (Tsebelis): a policy
  change passes only if every veto player prefers it to the status quo; magnitudes per period are capped
  (institutional inertia). Bounded rationality: evaluate a handful of candidate moves (status quo ± step on each
  dimension, plus pre-defined crisis responses), not a full optimisation; choose by logit (softmax) with temperature
  reflecting institutional quality and information.
* **Legitimacy / support** per group: f(material conditions vs. expectations, policy distance, repression, identity,
  performance memory with decay). Elections: party vote shares from group support with district/proportional rules.
* **Instability** as competing hazard rates (coup, mass protest, insurgency, constitutional breakdown) driven by
  identifiable variables: e.g. coup hazard rises with military autonomy, recent coups, economic contraction and low
  regime legitimacy — calibrated to Powell & Thyne coup data, not to fixed thresholds. Outcomes are resolved by the
  balance of power among actors, so "economic crisis" does not automatically mean "revolution".
* Government collapse changes the actor configuration; the state (borders, bureaucracy, debt) persists.

### 3.4 Diplomacy [design, Phase 3]

* Multi-dimensional dyadic relations (trade dependence, threat perception, trust, ideological distance, grievances,
  alliance obligations), each with its own update rule and decay; historical grievances decay but leave a floor.
* Actions chosen per country from a small action set (propose/accept treaty, sanction, recognise, mediate, join
  organisation) via the same bounded utility + logit choice as domestic politics, evaluated only for relevant pairs
  (neighbours, major trade partners, great powers, alliance partners) — sparse, not N².
* Treaties are bargaining outcomes (Nash bargaining over a surplus with outside options); obligations are stored and
  breaking them costs trust with all observers.

### 3.5 Conflict [design, Phase 4]

* **Onset** from the bargaining model of war (Fearon 1995): war becomes possible when perceived military balance and
  stakes differ between sides (private information, commitment problems, indivisible stakes) beyond the expected cost
  of fighting; domestic incentives (diversionary motives) and alliance commitments enter the utility.
* **Fighting** at region resolution: per front region, daily attrition with modified Lanchester equations scaled by
  force quality, logistics (distance through the transport graph), terrain (elevation/roughness), and supply; control
  fraction shifts with the force ratio. Engagement outcomes are stochastic.
* **Termination**: both sides update beliefs from battlefield results; settlement when the bargaining range reopens
  (war exhaustion, costs, external pressure). Peace terms from the bargaining position (region transfers, indemnities).
* **Nuclear**: deterrence enters the expected cost term; escalation ladder with explicit thresholds and probabilities;
  use triggers catastrophic, modelled humanitarian and economic consequences.

### 3.6 Technology, environment, society [design, Phase 5]

* Technology: knowledge stocks per domain (energy, computing/AI, manufacturing, agri/bio, transport, comms, medicine,
  aerospace) accumulated from R&D × researchers, diffusing along trade and alliance links with lags; domain stocks
  shift TFP, mortality curves, military quality, energy mix. No scripted tech tree.
* Environment: exogenous climate scenario (e.g. SSP pathway temperature) mapped to regional yield and disaster
  frequencies; disasters as Poisson events with condition-dependent rates; epidemics as SIR at country level with
  travel coupling.
* Society: distributions (not scalars) of attitudes per cohort; generational replacement drives slow change; material
  conditions, education, and media environment shift the distribution.

### 3.7 Optional narrative layer

An LLM may later turn recorded events into prose. It receives only event records and state values and cannot write
state. Phase 1 already renders the news feed from event records with templates (`src/engine/describe.ts`).

---

## 4. Update order and time-step architecture [implemented]

The clock is an integer day (days since 1970-01-01, proleptic Gregorian; no `Date` objects). `advanceTo(day)` jumps
from calendar boundary to boundary:

```
1 Jan / Apr / Jul / Oct      economy.quarterly (oil price → TFP → domestic cycles → gaps → output, prices, debt)
                             → chronicle.quarterly
every 1 Jan                  demography.yearly (cohort step → migration → transition) → economy.yearly
                             → chronicle.yearly → history.record
```

Phase 3/4 will add a **daily phase** (active conflicts only) and an **event queue** (priority queue keyed by day) for
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
| 300 simulated years, 200 countries | 1.56 s (5.2 ms / year); Phase 1 was 0.84 ms / year |
| per year: demography / economy / chronicle | 3.4 / 0.9 / 0.3 ms |
| scaling: 200 / 400 / 800 / 1600 entities | 5.3 / 9.9 / 21.7 / 49.7 ms per year (≈ linear) |
| save (300 years of history and 58k events) | 228 ms, 9.5 MB JSON |
| load / full replay of 300 years | 143 ms / 1.5 s |
| determinism, 3 runs | identical hashes |

Demography dominates: each year every country re-solves two Siler parameters per sex (warm-started Newton with
precomputed age terms; the first version used bisection and cost 54 ms / year).

In the browser the worker posts a frame every 50 ms; the UI stays responsive at 50 simulated years per second.

**Expected expensive operations (future) and the plan for each**

| Operation | Naïve cost | Plan |
|---|---|---|
| Dyadic diplomacy | O(N²) per tick | sparse relevant-pair graph (neighbours, partners, powers); update only on change or monthly |
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
* Borders are Natural Earth de facto boundaries at 1:50m; Crimea, Kashmir, etc. follow Natural Earth's default view.
  Land neighbours derive from shared topology arcs; maritime neighbours are not yet computed.

**Data still missing for later phases**: UN WPP fertility/mortality schedules (Phase 2 uses WDI aggregates and
parametric schedules), trade matrices (UN Comtrade /
CEPII BACI), alliances and IGO membership (COW / ATOP), conflict history (UCDP), regime histories (V-Dem — CC BY-SA,
licence compatibility to check), terrain/elevation rasters (Natural Earth / ETOPO), energy and mineral reserves
(EIA / USGS), infrastructure (OpenStreetMap — ODbL), admin-1 boundaries (Natural Earth).

---

## 7. Roadmap

| Phase | Deliverable | Exit test |
|---|---|---|
| 1 ✅ | Baseline data pipeline, engine core, demography & economy prototypes, save/load/rewind/branch, map UI | invariants + reproducibility tests green; UI drives the worker |
| 2 ✅ | Single-year age × sex cohorts; Siler life tables; sectors; oil price; inflation; procyclical investment; gravity trade network; 2000 baseline and backtest | backtest 2000→2023 reported per region with naive benchmarks and sensitivity (`docs/BACKTEST.md`). Deferred: resource reserves and depletion, exchange rates, bilateral trade data |
| 3 | Political actors, institutions, elections, legitimacy, unrest; diplomacy graph, treaties, sanctions, organisations; decision inspector ("why did X do Y") | distribution of government changes / regime transitions vs. historical base rates (Archigos, Powell & Thyne) |
| 4 | Military forces, conflict onset/bargaining, front-line model, occupation, settlements, territorial change, nuclear deterrence | conflict onset and duration distributions vs. UCDP/COW across many seeds |
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
