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
| Demography: 3 age cohorts, births/deaths/ageing, conserved migration, income-driven transition | implemented (simplified, see §3.1) |
| Economy: Solow growth + technology diffusion, AR(1) cycle with world shock, unemployment, public debt, sovereign default | implemented (simplified, see §3.2) |
| Military capital stock (perpetual inventory of spending) | implemented (no conflict use yet) |
| Chronicle/news events carrying their causal inputs | implemented |
| Observer UI: map with 15 modes, time controls, country inspector, world panel, news feed | implemented |
| Domestic politics, factions, elections, regime change | design only (Phase 3) |
| Diplomacy, alliances, organizations, sanctions, trade network | design only (Phase 3/5) |
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
| Demography [implemented] | cohorts, TFR, e0, GDP (for transition), migration rates | cohorts, TFR, e0 | monthly + yearly |
| Economy [implemented] | working-age pop, K, A, institutions (WGI), RNG | GDP, K, A, cycle, unemployment | quarterly |
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

* **Per-country variables** — struct-of-arrays: one `Float64Array(n)` per field (`FIELDS`, 41 fields). Country index is
  stable for a world's lifetime. Cache-friendly loops, trivially serialisable, maps 1:1 to a future Rust/WASM core.
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

### 3.1 Demography [implemented]

Cohorts: P₀ (0–14), P₁ (15–64), P₂ (65+). Monthly step Δt = 1/12 year:

```
births   = κ_f · TFR · P₁ · Δt
deaths_i = κ_m · m_i(e₀) · P_i · Δt,      m_i(e₀) = a_i · exp(−b_i (e₀ − 70))
ageing   = P₀/15 · Δt  (0–14 → 15–64),   P₁/50 · Δt  (15–64 → 65+)
migration: net flows scaled so Σ inflows = Σ outflows (world population conserved)
```

* κ_f, κ_m are calibrated per country so baseline births/deaths equal the WDI crude birth/death rates exactly.
* Yearly, TFR and e₀ relax (τ = 15 y) toward an **income curve**: binned medians of TFR and e₀ against log PPP GDP
  per capita across 164 countries (10 equal-count bins, built by the data script), times/plus the country's own
  residual, which decays with τ = 40 y. Flat outside the observed income range — no extrapolation.
* **Limitations:** uniform-age-within-cohort ageing biases flows for young/old-skewed populations; mortality shape is
  a hand-fitted approximation; no sex structure; migration rates are frozen at baseline (no push/pull model); the
  income curve is a cross-section, not a causal law. Phase 2 replaces cohorts with 5-year age × sex groups from UN WPP.

### 3.2 Economy and public finance [implemented]

Quarterly, all values in constant 2023 USD (annualised flows):

```
L   = P₁ · participation · (1 − u)
Y   = A · K^α · L^(1−α) · e^c                         α = 0.35
K'  = K + (s·Y − δK)·Δt                               s = observed investment share, δ = 0.05, K₀ = 3·Y₀
ln A' = ln A + [g_F + λ · θ · max(0, ln A_F − ln A)]·Δt     g_F = 1%, λ = 2%, θ = logistic(1.5 · WGI effectiveness)
c'  = ρ c + σ_i (√w · ε_world + √(1−w) · ε_i)          ρ = 0.8, w = 0.25, σ_i from 2000–19 growth s.d.
u   = max(0.5, u* − 0.4 · 100c)                        Okun
r   = r₀ + π · max(0, d − max(0.6, d_ref))             r₀ = 1.5%, π = 0.03
pb  = pb₀ + 0.04 · (d − d_ref)                          Bohn fiscal reaction
Debt' = Debt + [(G_prim − T) + r·Debt]·Δt               budget identity (tested)
if r·Debt / T > 0.30: default — haircut 37%, output −3%, d_ref reset   (event recorded)
Military capital' = M + (m·Y − 0.08 M)·Δt
```

A is calibrated so baseline Y equals WDI GDP. A_F (frontier) is the highest A among countries with ≥ 2 m workers.
Every parameter, with its source or the words "assumption", is in `src/engine/params.ts`.

**Limitations:** one sector; no prices, inflation, interest-rate policy, exchange rates (PPP ratio frozen), trade
flows, or resource constraints; investment share is frozen; frontier growth is exogenous; growth is unbounded over
centuries. Fiscal reaction and default thresholds stand in for decisions that Phase 3 politics will make.

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
every 1st of month           demography.monthly
1 Jan / Apr / Jul / Oct      economy.quarterly → chronicle.quarterly
every 1 Jan                  demography.yearly → chronicle.yearly → history.record
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
~0.2 s, so in-memory snapshots are unnecessary for now; once politics/conflict raise the cost, yearly snapshots will
be added as a cache (the replay path stays authoritative).

---

## 5. Computational cost and optimisation

Measured with `npm run bench` (Node 22, one core of a 2.1 GHz Xeon):

| Measurement | Result |
|---|---|
| 300 simulated years, 200 countries | 251 ms (0.84 ms / year) |
| per year: demography (12 monthly steps) / economy (4 quarters) / chronicle | 0.08 / 0.18 / 0.22 ms |
| scaling: 200 / 400 / 800 / 1600 entities | 0.75 / 1.37 / 3.33 / 6.45 ms per year (≈ linear) |
| save (300 years of history and 54k events) | 174 ms, 7.9 MB JSON |
| load / full replay of 300 years | 76 ms / 222 ms |
| determinism, 3 runs | identical hashes |

In the browser the worker posts a frame every 50 ms; the UI stays responsive at 50 simulated years per second.

**Expected expensive operations (future) and the plan for each**

| Operation | Naïve cost | Plan |
|---|---|---|
| Dyadic diplomacy | O(N²) per tick | sparse relevant-pair graph (neighbours, partners, powers); update only on change or monthly |
| Actor decisions | optimisation per actor per tick | small candidate sets, logit choice, decisions only on triggers or weekly |
| Trade network | O(N²) gravity flows | gravity model on top-k partners per country, recomputed yearly, incremental shocks |
| Warfare | per-region daily | only for regions on active fronts; admin-1 detail loaded on demand |
| Events / history growth | unbounded | importance filtering; history thinning for very long runs; binary save format |
| Map rendering | re-projection | Path2D cached per region; only fills recomputed (already done) |

Optimisations must keep the hash test green; a profile must show a hotspot before code is made more complex.
The chronicle currently uses string-keyed memo maps and is the most expensive system — the first candidate if needed.

---

## 6. Data requirements and limitations

See `docs/DATA_SOURCES.md` for every source, licence, coverage count and override. Key points:

* Baseline reference year 2023 (latest observation 2015–2023 per field, year recorded). Start date 2024-01-01.
* 200 political entities: 194 widely recognised states (UN members plus the Holy See), 4 partially recognised
  (Taiwan, Kosovo, Palestine, Northern Cyprus), 1 unrecognised de facto state (Somaliland) and 1 non-self-governing
  territory (Western Sahara). Dependencies are regions of their sovereign state.
* Missing values are explicit. Population/GDP fall back to Natural Earth estimates (flagged `NE_EST`); other fields to
  the regional median (flagged `IMPUTED`; extensive quantities use a per-capita median × own population so no two
  countries receive identical absolute values). Military spending and armed forces are **not** imputed.
* Borders are Natural Earth de facto boundaries at 1:50m; Crimea, Kashmir, etc. follow Natural Earth's default view.
  Land neighbours derive from shared topology arcs; maritime neighbours are not yet computed.

**Data still missing for later phases**: UN WPP age × sex cohorts and projections, trade matrices (UN Comtrade /
CEPII BACI), alliances and IGO membership (COW / ATOP), conflict history (UCDP), regime histories (V-Dem — CC BY-SA,
licence compatibility to check), terrain/elevation rasters (Natural Earth / ETOPO), energy and mineral reserves
(EIA / USGS), infrastructure (OpenStreetMap — ODbL), admin-1 boundaries (Natural Earth).

---

## 7. Roadmap

| Phase | Deliverable | Exit test |
|---|---|---|
| 1 ✅ | Baseline data pipeline, engine core, demography & economy prototypes, save/load/rewind/branch, map UI | invariants + reproducibility tests green; UI drives the worker |
| 2 | 5-year age × sex cohorts (UN WPP); sectors (agri/industry/services/energy); prices & inflation; endogenous investment; trade via gravity model; resource stocks | backtest 2000→2023 starting from 2000 data: GDP growth and population errors reported per region |
| 3 | Political actors, institutions, elections, legitimacy, unrest; diplomacy graph, treaties, sanctions, organisations; decision inspector ("why did X do Y") | distribution of government changes / regime transitions vs. historical base rates (Archigos, Powell & Thyne) |
| 4 | Military forces, conflict onset/bargaining, front-line model, occupation, settlements, territorial change, nuclear deterrence | conflict onset and duration distributions vs. UCDP/COW across many seeds |
| 5 | Technology domains & diffusion; environment & disasters; migration push/pull; ideology & society | sensitivity analysis of long-run outcomes |
| 6 | Calibration (simulated method of moments over many seeds), pathology hunting, profiling-driven optimisation; Rust/WASM core if profiling justifies | 500-year runs without degenerate outcomes; ensemble statistics |
| 7 | Rich country histories, timeline replay scrubber, scenario comparison across branches, narrative generation | — |

---

## 8. Scientific and technical uncertainties

1. **Long-run fertility.** The income curve plateaus at TFR ≈ 1.4 for rich countries; with no other force, world
   population peaks ≈ 10.3 bn around 2110 and then declines (7.6 bn by 2324 in seed 1). Whether fertility recovers
   is genuinely unknown; the model must expose this as a scenario parameter rather than pretend to know.
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
