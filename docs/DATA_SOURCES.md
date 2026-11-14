# Data sources

`npm run data` (scripts/build-data.mjs) downloads every input, records the source and reference year of each value,
and writes `public/data/baseline.json` and `public/data/world.topo.json`. Generated files are committed so the app
runs offline. Raw downloads are cached in `.cache/` (not committed). The baseline was generated on the date stored in
`baseline.json → meta.generated`.

## Sources and licences

| Id | Source | Used for | Licence |
|---|---|---|---|
| NE | Natural Earth 1:50m Admin 0 – Countries (v5.x), via github.com/nvkelso/natural-earth-vector | region geometry, sovereignty grouping, area, coastline, land neighbours, centroids | Public domain |
| NE_EST | Natural Earth `POP_EST`, `GDP_MD` attributes | fallback population/GDP where the World Bank has none | Public domain |
| WDI | World Bank World Development Indicators API (source 2) | demography, labour, GDP, investment, sectors, trade, military (SIPRI-derived) | CC BY 4.0; some third-party series (e.g. SIPRI military expenditure) carry their own terms |
| WGI | World Bank Worldwide Governance Indicators API (source 3) | six governance estimates | CC BY 4.0 |
| IMF | IMF DataMapper API (WEO / Fiscal Monitor) | gross debt, revenue, overall balance | IMF terms permit reuse with attribution; **verify before redistributing the generated file commercially** |
| WD | Wikidata SPARQL (P122 form of government, P31 instance of, P1906/P1313 offices) | government form | CC0 |
| DERIVED | computed from NE geometry | area (spherical), coastline (topology arcs not shared with another region), neighbours | Public domain |
| IMPUTED | median of countries in the same World Bank region | fields missing after fallbacks | model assumption |

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

Reference year: latest observation in 2015–2023 per country and field; the year is stored with every value
(`{v, y, s}`). Growth volatility (`growthSd`) is the standard deviation of annual real GDP growth 2000–2019.
GDP values from years before 2023 are treated as 2023 USD without deflating — a known approximation affecting the few
`NE_EST` entries (Eritrea 2011, North Korea 2016, Taiwan 2016, …).

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
