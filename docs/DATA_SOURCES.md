# Data sources

`npm run data` (scripts/build-data.mjs) downloads every input, records the source and reference year of each value,
and writes `public/data/baseline.json` and `public/data/world.topo.json`. Generated files are committed so the app
runs offline. Raw downloads are cached in `.cache/` (not committed). The baseline was generated on the date stored in
`baseline.json → meta.generated`.

## Sources and licences

| Id | Source | Used for | Licence |
|---|---|---|---|
| NE | Natural Earth 1:50m Admin 0 – Countries (v5.x), via github.com/nvkelso/natural-earth-vector | region geometry, sovereignty grouping, area, coastline, land neighbours, centroids | Public domain |
| NE10 | Natural Earth 1:10m Admin 1 – States, Provinces and 1:10m Populated Places (simple) | province geometry (the map), province neighbours, city populations for the fallback province population estimate | Public domain |
| WD_POP | Wikidata P1082 (population) of each province's Wikidata item, latest value | relative province populations (3,856 of 4,595 provinces), scaled to the World Bank country total | CC0 |
| NE_EST | Natural Earth `POP_EST`, `GDP_MD` attributes | fallback population/GDP where the World Bank has none | Public domain |
| WDI | World Bank World Development Indicators API (source 2) | demography, labour, GDP, investment, sectors, trade, military (SIPRI-derived) | CC BY 4.0; some third-party series (e.g. SIPRI military expenditure) carry their own terms |
| WGI | World Bank Worldwide Governance Indicators API (source 3) | six governance estimates | CC BY 4.0 |
| IMF | IMF DataMapper API (WEO / Fiscal Monitor) | gross debt, revenue, overall balance | IMF terms permit reuse with attribution; **verify before redistributing the generated file commercially** |
| WD | Wikidata SPARQL (P122 form of government, P31 instance of, P1906/P1313 offices) | government form | CC0 |
| DERIVED | computed from NE geometry | area (spherical), coastline (topology arcs not shared with another region), neighbours | Public domain |
| IMPUTED | median of countries in the same World Bank region | fields missing after fallbacks | model assumption |
| ORGS | Membership pages of the EU, African Union, ECOWAS, ASEAN, Mercosur, OPEC, OECD, BRICS and SCO (curated in `scripts/build-data.mjs` with joining and leaving years and suspensions) | international organisations at the reference year | facts cited |
| WD_PARTY | Wikidata: head of government (P6) / head of state (P35) on 31 December of the reference year, their party (P102) at that date, its political alignment (P1387) | the ruling party at the start (116 countries for 2023) | CC0 |
| UCDP | UCDP/PRIO Armed Conflict Dataset v26.1 and UCDP Battle-Related Deaths Dataset v26.1 (conflict level) | armed conflicts under way at the reference year (sides, start, goal, battle deaths), onset, duration and battle-death rates 1990-2023, last year of internal conflict per country, interstate conflict history (grievance) | CC BY 4.0 |
| SIPRI | SIPRI Yearbook 2023, World nuclear forces | list of the nine nuclear-armed states | facts cited |
| WPP | UN World Population Prospects 2024, demographic indicators, medium variant (`WPP2024_Demographic_Indicators_Medium.csv.gz`) | mean age of childbearing at the reference year (model input; 198 entities); projections of population, fertility and life expectancy for 2050 and 2100 (`meta.unProjections`, validation only) | CC BY 3.0 IGO |
| HDR | UNDP Human Development Report 2025, composite indices complete time series (`mys_*`, `eys_*`) | adults' mean years of schooling (25+), its trend over the previous ten years, children's expected years of school now, 10 and 15 years before (curve drift, pipeline) | CC BY 3.0 IGO |
| HCI | World Bank Human Capital Index (source 63), `HD.HCI.HLOS` harmonised test scores | learning (2010-2020 values; the 2000 baseline uses 2010, the earliest) | CC BY 4.0 |
| EPR | Ethnic Power Relations 2021 core dataset (`EPR-2021.csv`) and GeoEPR 2021 settlement polygons (Vogt et al. 2015, "Integrating data on ethnicity, geography, and conflict", JCR 59(7)), icr.ethz.ch | ethnic groups at min(reference year, 2021): size, power status, regional autonomy, last loss of power; homeland provinces (province centroid inside the group's polygon); base rates of inclusion and exclusion over the previous 20 years | free for research with citation |
| FLAGS | Flag images from flagcdn.com (PNG renderings of the public-domain flags on Wikimedia Commons); Northern Cyprus and Somaliland, which flagcdn lacks, from their flag descriptions | map colours only: the flag's most characteristic colour (pixel share weighted toward saturated colours), softened for the map; land neighbours with similar colours are shifted in hue, smaller country first | Public domain (national flags) |

## Field coverage (200 entities)

Columns: observed from the primary source / Natural Earth fallback / imputed / missing.

| Field | Source | Observed | NE_EST | Imputed | Missing |
|---|---|---|---|---|---|
| `pop` | WDI `SP.POP.TOTL` | 195 | 5 | 0 | 0 |
| `pop0014` | WDI `SP.POP.0014.TO.ZS` | 195 | 0 | 5 | 0 |
| `pop1564` | WDI `SP.POP.1564.TO.ZS` | 195 | 0 | 5 | 0 |
| `pop65` | WDI `SP.POP.65UP.TO.ZS` | 195 | 0 | 5 | 0 |
| `cbr` | WDI `SP.DYN.CBRT.IN` | 195 | 0 | 5 | 0 |
| `cdr` | WDI `SP.DYN.CDRT.IN` | 195 | 0 | 5 | 0 |
| `tfr` | WDI `SP.DYN.TFRT.IN` | 195 | 0 | 5 | 0 |
| `lifeExp` | WDI `SP.DYN.LE00.IN` | 195 | 0 | 5 | 0 |
| `urban` | WDI `SP.URB.TOTL.IN.ZS` | 195 | 0 | 5 | 0 |
| `netMigration` | WDI `SM.POP.NETM` | 195 | 0 | 0 | 5 |
| `laborForce` | WDI `SL.TLF.TOTL.IN` | 179 | 0 | 21 | 0 |
| `unemployment` | WDI `SL.UEM.TOTL.ZS` | 179 | 0 | 21 | 0 |
| `gdp` | WDI `NY.GDP.MKTP.CD` | 193 | 6 | 1 | 0 |
| `gdpPpp` | WDI `NY.GDP.MKTP.PP.CD` | 188 | 0 | 12 | 0 |
| `inflation` | WDI `FP.CPI.TOTL.ZG` | 183 | 0 | 17 | 0 |
| `investment` | WDI `NE.GDI.TOTL.ZS` | 169 | 0 | 31 | 0 |
| `trade` | WDI `NE.TRD.GNFS.ZS` | 173 | 0 | 27 | 0 |
| `agriShare` | WDI `NV.AGR.TOTL.ZS` | 189 | 0 | 11 | 0 |
| `industryShare` | WDI `NV.IND.TOTL.ZS` | 190 | 0 | 10 | 0 |
| `servicesShare` | WDI `NV.SRV.TOTL.ZS` | 189 | 0 | 11 | 0 |
| `milexShare` | WDI `MS.MIL.XPND.GD.ZS` | 159 | 0 | 0 | 41 |
| `armedForces` | WDI `MS.MIL.TOTL.P1` | 170 | 0 | 0 | 30 |
| `arableShare` | WDI `AG.LND.ARBL.ZS` | 191 | 0 | 9 | 0 |
| `energyImportsShare` | WDI `EG.IMP.CONS.ZS` | 141 | 0 | 59 | 0 |
| `wgiVoice` | WGI `GOV_WGI_VA.EST` | 196 | 0 | 4 | 0 |
| `wgiStability` | WGI `GOV_WGI_PV.EST` | 196 | 0 | 4 | 0 |
| `wgiEffectiveness` | WGI `GOV_WGI_GE.EST` | 196 | 0 | 4 | 0 |
| `wgiRegulatory` | WGI `GOV_WGI_RQ.EST` | 196 | 0 | 4 | 0 |
| `wgiRuleOfLaw` | WGI `GOV_WGI_RL.EST` | 196 | 0 | 4 | 0 |
| `wgiCorruption` | WGI `GOV_WGI_CC.EST` | 196 | 0 | 4 | 0 |
| `govDebt` | IMF `GGXWDG_NGDP` | 189 | 0 | 11 | 0 |
| `govRevenue` | IMF `GGR_G01_GDP_PT` | 190 | 0 | 10 | 0 |
| `govBalance` | IMF `GGXCNL_NGDP` | 192 | 0 | 8 | 0 |
| `growthSd` | WDI `NY.GDP.MKTP.KD.ZG (sd 2000-2019)` | 192 | 0 | 8 | 0 |
| `schoolYears` | HDR `mys` (mean years of schooling, 25+) | 192 | 0 | 8 | 0 |
| `schoolTrend` | HDR `mys`, change per year over the previous ten years | 191 | 0 | 9 | 0 |
| `expectedYears` | HDR `eys` (expected years of schooling) | 194 | 0 | 6 | 0 |
| `expectedYearsLag` | HDR `eys` 15 years before the reference year | 190 | 0 | 10 | 0 |
| `learning` | HCI `HD.HCI.HLOS` (harmonised test scores, 2020 or latest) | 170 | 0 | 30 | 0 |

### Phase 2 additions

| Field | Source | Used for |
|---|---|---|
| `f0004`…`f80UP`, `m0004`…`m80UP` | WDI `SP.POP.{group}.FE.5Y` / `.MA.5Y` (% of female/male population) | initial single-year age structure |
| `femaleShare`, `srb` | WDI `SP.POP.TOTL.FE.ZS`, `SP.POP.BRTH.MF` | sex split, sex ratio at birth |
| `lifeExpF/M`, `u5mrF/M` | WDI `SP.DYN.LE00.FE/MA.IN`, `SH.DYN.MORT.FE/MA` | Siler life tables per sex |
| `oilRents`, `gasRents`, `coalRents`, `mineralRents` | WDI `NY.GDP.{PETR,NGAS,COAL,MINR}.RT.ZS` | oil-price exposure (not imputed: missing = no extraction) |
| `gdpReal` | WDI `NY.GDP.MKTP.KD` | backtest target only |

* `SP.ADO.TFRT` (adolescent fertility) would set each country's fertility timing, but the World Bank API returned
  HTTP 400 for it in every query form (November 2026), so one timing schedule is used for all countries.
* Net migration is the **mean** over the 9-year window, not the latest year: single years carry episodic flows
  (Sudan 2023, Syria returns, Armenia 2023).
* Income curves and their drift: see DESIGN.md §3.1. Drift uses a second cross-section ten years before the
  reference year (fetched with the same indicators), so the 2000 baseline only uses data up to 2000.
* `npm run data -- --year 2000` builds `baseline-2000.json` with the same pipeline (window 1992–2000; growth
  volatility 1980–1999). Fiscal and governance coverage is thinner for 2000 (see its `meta.coverage`).

Reference year: latest observation in 2015–2023 per country and field; the year is stored with every value
(`{v, y, s}`). Growth volatility (`growthSd`) is the standard deviation of annual real GDP growth 2000–2019.
GDP values from years before 2023 are treated as 2023 USD without deflating — a known approximation affecting the few
`NE_EST` entries (Eritrea 2011, North Korea 2016, Taiwan 2016, …).

### Phase 3 additions: religion and political regimes

| Field | Source | Notes |
|---|---|---|
| `religion.shares` (31 categories) | World Religion Project national data (Maoz & Henderson 2013), Correlates of War, `WRP_national.csv` | latest year ≤ reference year (2010; 2000 for the backtest baseline); a family total above the sum of its denominations goes to that family's "other" category; free for research with citation (COW terms) |
| `vdemEdi` | V-Dem Electoral Democracy Index (v2x_polyarchy) via Our World in Data | core territory only; **CC BY-SA 4.0**, so the derived fields of `baseline.json` are share-alike |
| `regimeRow` | V-Dem Regimes of the World (v2x_regime) via Our World in Data | 0 closed autocracy … 3 liberal democracy |
| `meta.baseRates` | computed from the same V-Dem series, 23 years before the reference year | calibration targets (DESIGN.md §3.4) |
| `meta.secularisation` | least-squares logistic fit on the WRP panel, 15 years before the WRP year | DESIGN.md §3.3 |

* **COW → ISO crosswalk:** names matched against our country names; 13 codes fixed by hand (BHM→BHS, SLU→LCA,
  SVG→VCT, AAB→ATG, SKN→KNA, CZR→CZE, MAC→MKD, YUG→SRB (Serbia in 2010), CAP→CPV, CON→COG, TAZ→TZA, SWA→SWZ, STP).
* **Entities missing from WRP:** Somaliland ← Somalia, Northern Cyprus ← Turkey, Palestine ← Jordan, Western Sahara ←
  Morocco (proxies, flagged `PROXY`); the Holy See = 100% Catholic; South Sudan from the CIA World Factbook (2020 est.:
  Christian 60.5%, folk 32.9%, Muslim 6.2%, other 0.4%; denominations not given, so "other Christian"/"other Muslim").
* States that did not exist in the WRP year take their own earliest later WRP observation (2000 baseline: Montenegro,
  Kosovo from 2010, Timor-Leste from 2005). This is minor post-2000 information in the backtest baseline.
* V-Dem has no data for Northern Cyprus, Western Sahara, the Holy See and most microstates (24 entities); their
  democracy fields are regional medians, flagged `IMPUTED`. Palestine uses V-Dem's "Palestine/West Bank".
* Known WRP coding choices that differ from other sources: Israel's Jewish population is coded mostly "Orthodox
  Jewish"; Japan's Shinto and Buddhist shares follow WRP's single-affiliation split; China is 42% syncretic.

### Phase 3b additions: diplomacy

| Data | Source | Notes |
|---|---|---|
| Defence treaties (`meta.diplomacy.treaties`) | ATOP 5.1 (Leeds et al.), member file, treaties with a defence obligation active in min(reference year, 2018) | COW numbers → our ids via the COW crosswalk; NATO and the EU's TEU 42.7 clause named from their membership, others labelled by members; free for research with citation |
| Post-2018 membership changes | documented in `ALLIANCE_UPDATES` (build script) | North Macedonia joins NATO (2020), UK leaves the EU (2020), Finland joins NATO (2023); Sweden (2024) is after the baseline |
| Alliance base rates | ATOP member file, 18 years up to 2018 | accessions 1.78/yr, exits 1.78/yr, new treaties 0.39/yr (2001-2018) |
| UN voting position (`unIdeal`) | Bailey, Strezhnev & Voeten ideal points (`IdealpointestimatesFP_2026FP.csv`, Harvard Dataverse, CC0) | latest ≤ reference year; 7 entities imputed (Taiwan, Kosovo, Palestine, …) |
| Conflict history (`meta.diplomacy.grievances`) | COW Dyadic MIDs 4.03 (to 2014), UCDP/PRIO Armed Conflict Dataset v26.1 (interstate, 2015-reference year, CC BY 4.0) | weights: MID threat 0.05, display 0.1, use of force 0.3, war 1.0; UCDP minor 0.5, war 1.5 per year; decayed with a 15-year memory |
| Sanctions in force (`meta.diplomacy.sanctions`) | curated from OFAC programme pages, EU Sanctions Map, UK sanctions list, UN SC committees | major programmes only (Russia, Belarus, Iran, DPRK (UN), Syria, Venezuela, Cuba, Myanmar for 2023; Iraq (UN), Cuba, Iran, Libya, Sudan, DPRK, Myanmar, FR Yugoslavia for 2000); intensity 1 sectoral, 0.4 targeted |

* The Global Sanctions Data Base would provide complete sanction histories but requires registration, so the sanction
  list is partial (programmes with mostly individual listings are omitted) and sanction rates are not validated.
* Gleditsch-Ward codes differing from COW numbers are fixed for Yemen (678), Germany (260) and Serbia (340).
* The build needs the `unzip` command-line tool (ATOP, MID and UCDP come as zip archives).

## Entity rules and overrides

* One simulated country per Natural Earth sovereignty group (`SOV_A3`). Dependencies (e.g. Greenland, Puerto Rico,
  Hong Kong, French Polynesia) are regions owned by the sovereign; their World Bank data is **added** to the
  sovereign's totals (sums for stocks, population- or GDP-weighted means for rates).
* Overrides of the Natural Earth grouping:
  * Palestine (NE files it under Israel's group) → its own entity, `partially_recognized`.
  * Western Sahara → its own entity, `non_self_governing`. De facto Moroccan administration of most of the territory
    is **not** represented yet.
  * Siachen Glacier and Antarctica → unowned regions.
  * Status labels: Taiwan, Kosovo, Northern Cyprus `partially_recognized`; Somaliland `unrecognized`.
* Natural Earth's own `WB_A3` uses some retired codes (ROM, ZAR, TMP, ADO); the script prefers `ISO_A3_EH`.
  Kosovo maps to World Bank `XKX`, West Bank & Gaza to `PSE`.

## Government form

Classified by keyword rules over Wikidata labels (P122 basic form of government + P31 instance of), in priority order:
military → one-party → absolute monarchy → theocracy → constitutional monarchy → semi-presidential → presidential →
parliamentary. A republic whose head-of-state office equals its head-of-government office is classed as presidential.
Six curated corrections where Wikidata labels are missing or misleading (China, Laos, Myanmar, Australia, India, Kenya),
each with its constitutional/factual basis in the script. Each country carries `government.basis` and the raw labels,
visible in the UI. 22 entities remain `unclassified`; they are shown as such, not guessed.

## Known data limitations

* Natural Earth boundaries are de facto lines at 1:50m; tiny states and islands are approximate; maritime neighbours
  are not computed.
* World Bank aggregates for some small territories are older than 2023.
* The IMF fiscal series mix general and central government depending on country coverage.
* No sub-national data, trade matrices, alliances, conflict history or resource reserves yet (see DESIGN.md §6).
