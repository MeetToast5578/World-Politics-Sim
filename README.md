# WORLD — a geopolitical simulation you observe

An autonomous world simulator: start from a documented 2023 baseline of the real world and watch it evolve on its own.
History is meant to emerge from interacting models, not from scripts. This repository currently contains **Phase 1**:
the data pipeline, a deterministic simulation engine with first demographic and economic models, and an observer UI.

**What runs today:** 200 political entities on a 1:50m world map; monthly demography (3 age cohorts, conserved
migration, income-driven demographic transition); quarterly economy (Solow growth with technology diffusion, business
cycles with a common world shock, unemployment, public debt with fiscal reaction and sovereign default, military
capital); an event chronicle that records the causes of each event; pause/play/speed/step, save/load, rewind and
branching timelines; 15 map modes and a per-country inspector that shows every model variable next to its sourced
baseline value.

**What does not exist yet:** politics, elections, diplomacy, alliances, wars and territorial change, technology,
environment, ideology. Government form and governance scores are static baseline data. See
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

`npm run headless -- <years> <seed>` prints world aggregates per decade, the largest economies and the state hash.
`npm run data` rebuilds the baseline from the public sources (needs network; see [docs/DATA_SOURCES.md](docs/DATA_SOURCES.md)).

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

Data: Natural Earth (public domain), World Bank (CC BY 4.0), IMF DataMapper (attribution), Wikidata (CC0).
