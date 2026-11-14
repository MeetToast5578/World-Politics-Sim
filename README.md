# WORLD — a geopolitical simulation you observe

An autonomous world simulator: start from a documented 2023 baseline of the real world and watch it evolve on its own.
History is meant to emerge from interacting models, not from scripts. This repository currently contains **Phases 1, 2 and the first part of 3**:
the data pipeline, a deterministic simulation engine with demographic, economic, religious and political models,
a 2000→2023 backtest, and an observer UI.

**What runs today:** 200 political entities on a 1:50m world map; cohort-component demography by single year of age
and sex (life tables solved per country, conserved migration, demographic transition); a quarterly economy (growth
with technology diffusion through trade, business cycles with a world shock and trade transmission, a world oil price,
inflation, sector shares, public debt with fiscal reaction and sovereign default, military capital); religion by
31 denominations and sects (World Religion Project) with secularisation and religious polarisation; domestic politics
(V-Dem democracy and regime types, approval, legitimacy, unrest, elections, coups, uprisings, democratisation and
autocratisation, calibrated to observed base rates); an event
chronicle that records the causes of each event; pause/play/speed/step, save/load, rewind and branching timelines;
27 map modes and a per-country inspector (population pyramid, religious composition, politics, every model variable
next to its sourced baseline).
`docs/BACKTEST.md` reports how well the model reproduces 2000→2023 from 2000 data.

**What does not exist yet:** explicit political actors and parties, diplomacy, alliances, wars and territorial change,
technology, environment, ideology. Constitutional form and WGI governance scores are static baseline data. See
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

Data: Natural Earth (public domain), World Bank (CC BY 4.0), IMF DataMapper (attribution), Wikidata (CC0),
V-Dem via Our World in Data (CC BY-SA 4.0), World Religion Project via Correlates of War (research use with citation).
