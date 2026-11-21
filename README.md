# WORLD — a geopolitical simulation you observe

An autonomous world simulator: start from a documented 2023 baseline of the real world and watch it evolve on its own.
History is meant to emerge from interacting models, not from scripts. This repository currently contains **Phases 1, 2 and 3**:
the data pipeline, a deterministic simulation engine with demographic, economic, religious, political and diplomatic models,
a 2000→2023 backtest, and an observer UI.

**What runs today:** 200 political entities on a 1:50m world map; cohort-component demography by single year of age
and sex (life tables solved per country, conserved migration, demographic transition); a quarterly economy (growth
with technology diffusion through trade, business cycles with a world shock and trade transmission, a world oil price,
inflation, sector shares, public debt with fiscal reaction and sovereign default, military capital); religion by
31 denominations and sects (World Religion Project) with secularisation and religious polarisation; domestic politics
(V-Dem democracy and regime types, approval, legitimacy, unrest, elections, coups, uprisings, democratisation and
autocratisation, calibrated to observed base rates; parties and coalition governments, starting from each country's real
ruling party); international organisations (EU, African Union, ECOWAS, ASEAN, Mercosur, OPEC, OECD, BRICS, SCO) that
countries join, leave or are suspended from; diplomacy (trust, grievance and threat between countries,
ATOP defence treaties, sanctions, crises, trade shaped by politics); armed conflict (the 33 conflicts UCDP recorded at
the end of 2023, new civil and interstate wars at UCDP's historical rates, casualties, refugees, war damage, allies,
military aid, nuclear deterrence, peace deals, ceasefires, annexations of provinces shown on the map, rebel-held
territory, and new states born from secession); education (adults' years of schooling, children's expected years
and harmonised test scores, feeding productivity, fertility, democracy and civil-war risk); ethnic groups from Ethnic
Power Relations (745 groups, who holds power and who is shut out, homelands on the map), with exclusion driving
rebellion and separatism; an event
chronicle that records the causes of each event; pause/play/speed/step, save/load, rewind and branching timelines.
The map is alive: country names, ripples where news happens, pulsing conflicts, front lines and occupied or rebel-held
provinces. The interface is written for people, not modellers: plain-language news with a "why" for every event, eight main maps
plus 25 more, a history bar to go back to any year, and a country view in tabs (overview, people, economy, politics,
relations, and a data tab with every source and the raw model state).
`docs/BACKTEST.md` reports how well the model reproduces 2000→2023 from 2000 data.

**What does not exist yet:** elites as separate political actors, technology, environment, ideology. Constitutional form and WGI governance scores are static baseline data. See
[docs/DESIGN.md](docs/DESIGN.md) for the architecture, the models of every subsystem (implemented and planned), the
roadmap and the main uncertainties.

## Run it

```bash
npm install
```

```bash
npm run dev
```

Then open the printed URL. Headless and test tools:

```bash
npm test
```

```bash
npm run headless -- 300 42
```

```bash
npm run bench
```

```bash
npm run backtest -- 20
```

`npm run headless -- <years> <seed>` prints world aggregates per decade, the largest economies and the state hash.
`npm run data` rebuilds the baseline from the public sources and `npm run data -- --year 2000` the backtest baseline
(needs network; see [docs/DATA_SOURCES.md](docs/DATA_SOURCES.md)). `npm run backtest` regenerates `docs/BACKTEST.md`.

## Layout

```
scripts/build-data.mjs   data ingestion: Natural Earth, World Bank WDI/WGI, IMF, Wikidata → public/data/
src/engine/              simulation core (no DOM): state, calendar, rng, params, systems/, save, sim
src/worker/              Web Worker that owns the simulation and streams frames to the UI
src/ui/                  React observer interface (canvas map, panels, news feed)
src/headless/            CLI runner and benchmark
tests/                   invariants, accounting and reproducibility tests
docs/                    design document and data sources
```

## Principles enforced in code

* Every baseline value carries its source and year; imputed values are flagged and shown as such in the UI.
* All model parameters live in `src/engine/params.ts`, each with its source or marked as an assumption.
* Same baseline + parameters + seed ⇒ bit-identical history (tested), including after save/load, rewind and branching.
* Events are generated from state and store the values that caused them; the news text is rendered from those values.

Data: Natural Earth countries, provinces and populated places (public domain), Wikidata province populations (CC0), World Bank (CC BY 4.0), IMF DataMapper (attribution), Wikidata (CC0),
V-Dem via Our World in Data (CC BY-SA 4.0), World Religion Project, MIDs and COW codes via Correlates of War and ATOP
(research use with citation), UN voting ideal points (CC0), UCDP/PRIO armed conflicts and UCDP battle-related deaths
(CC BY 4.0), the SIPRI Yearbook's list of nuclear-armed states.
