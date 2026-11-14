// Model parameters. Every number here is an assumption, not data; the comment states where it comes from.
// Parameters are part of a world's identity: they are stored in saves, and changing one changes the timeline.
export const DEFAULT_PARAMS = {
  // --- demography ---
  /** Siler mortality shape (a1, a2 are solved per country/sex from data):
   *  b1 childhood decline rate — with 1.5, ~78% of under-5 deaths fall in the first year, typical of life tables;
   *  b2 Gompertz slope — adult mortality doubles every ~7.7 years (b2 = 0.09; literature 0.08-0.10);
   *  background hazard c = cA1·a1 + c0 (assumption: tied to the childhood level). */
  siler: { b1: 1.5, b2: 0.09, cA1: 0.02, c0: 2e-4 },
  /** Mean age and spread (years) of the age-specific fertility schedule. World mean age of childbearing is ~28
   *  (UN WPP); one value for all countries until a per-country timing source is available. Assumption. */
  fertMean: 28,
  fertSd: 6.0,
  /** Share of first-year infant mortality incurred within the calendar year of birth (most infant deaths are
   *  neonatal; assumption). */
  infantSeparation: 0.8,
  /** TFR curve drift (estimated in the data build from the 10-year panel before the baseline) applied with fading:
   *  effective drift years = fadeYears·(1 − e^(−t/fadeYears)). fadeYears is an assumption: a decade-long trend is not
   *  extrapolated indefinitely. Long-run fertility is the largest demographic uncertainty (DESIGN.md §8). */
  fertilityDrift: { on: true, fadeYears: 20 },
  /** Post-transition fertility (scenario parameter). UN WPP models fertility after it falls below replacement as
   *  recovering toward a long-run level (Phase III; Alkema et al. 2011, Ševčíková et al. 2015, world mean ≈ 1.75-1.85).
   *  Whether recovery happens is contested: realised fertility in 2010-2023 kept falling in most low-fertility countries.
   *  on: false keeps the income curve (plateau ≈ 1.4) indefinitely. years: blending time constant (assumption). */
  fertilityPhase3: { on: true, level: 1.75, entry: 2.0, years: 50 },
  /** Decay time (years) of each country's net migration rate toward zero. UN WPP likewise assumes long-run convergence
   *  of migration; stands in for a push/pull migration model (Phase 5). Assumption. */
  migrationYears: 25,
  /** Cap on net emigration per year as a share of population (assumption; guards against frozen extreme rates). */
  maxEmigration: 0.02,
  /** Relaxation time (years) of TFR and life expectancy toward the income-implied level (assumption). */
  transitionYears: 15,
  /** Decay time (years) of each country's residual from the cross-sectional regression (assumption). */
  residualYears: 40,

  // --- economy (Solow growth with technology diffusion) ---
  /** Capital share in Cobb-Douglas output. Gollin (2002) finds ~0.3-0.4 after correcting for self-employment. */
  alpha: 0.35,
  /** Initial capital-output ratio K/Y. Penn World Table capital stocks cluster around 3 (assumption for all countries). */
  capitalOutput: 3.0,
  /** Annual depreciation rate of physical capital (PWT averages ~4-5%). */
  delta: 0.05,
  /** Growth rate of frontier TFP per year. Long-run US TFP growth ~1% (Fernald 2014 range 0.5-1.5%). */
  frontierGrowth: 0.01,
  /** Max share of the log-TFP gap closed per year with perfect absorptive capacity. Conditional convergence ~2%/yr (Barro 1991). */
  catchUp: 0.02,
  /** Absorptive capacity = logistic(slope * WGI government effectiveness). Assumption linking institutions to diffusion. */
  absorbSlope: 1.5,
  /** Labour force needed to count toward the TFP frontier (excludes micro-states and resource enclaves). */
  frontierMinLabor: 2e6,
  /** Quarterly persistence of the business-cycle component (assumption). */
  cycleRho: 0.8,
  /** Share of business-cycle innovation variance that is a common world shock. Kose, Otrok & Whiteman (2003) attribute
   *  roughly 10-40% of output-growth variance to a world factor (higher for advanced economies). Assumption: 0.25. */
  globalShockShare: 0.25,
  /** Investment-share response to the business cycle (pp per 1% output gap). Investment is ~2-3x as volatile as
   *  GDP in national accounts; 1.0 gives that order of magnitude with s ≈ 0.25. Assumption. */
  investCyclical: 1.0,
  /** Gravity trade network (systems/trade.ts). Distance elasticity ~0.9-1.0 and contiguity coefficient ~0.5-0.7 are
   *  the central estimates of Head & Mayer (2014). spillover = domestic value-added share of gross exports (~0.7, OECD
   *  TiVA) × income elasticity of partner import demand (~1): a partner's 1% domestic downturn lowers the exporter's
   *  output by 0.7 × (exports to that partner / GDP) percent. frontierWeight: share of the catch-up target given by the
   *  world frontier vs. the TFP of import sources (assumption, to calibrate). */
  trade: { partners: 20, distElasticity: 1.0, contiguity: 0.6, minDistKm: 150, spillover: 0.7, frontierWeight: 0.5 },
  /** World oil price: log deviation from baseline follows a quarterly AR(1). rho 0.95 ≈ 3.4-year half-life; sd 0.10 per
   *  quarter ≈ 20-30% annual volatility of real oil prices. energyCostShare ≈ energy spending / GDP (assumption),
   *  incomeEffect = share of the terms-of-trade windfall or loss (exposure × log price deviation) that shows up in output,
   *  cpiWeight ≈ energy weight in consumer price baskets. All assumptions. */
  oil: { rho: 0.95, sd: 0.1, energyCostShare: 0.06, incomeEffect: 0.5, cpiWeight: 0.06 },
  /** Inflation: target 3%/yr; Phillips slope 0.25 pp per 1% gap (estimates 0.1-0.3); expectations converge to the
   *  target at anchorSpeed × credibility and to realised inflation at adaptSpeed × (1 − credibility), per year;
   *  credibility = absorptive capacity (WGI government effectiveness). Assumptions. */
  inflation: { target: 3, phillips: 0.25, anchorSpeed: 1.0, adaptSpeed: 1.0 },
  /** Okun coefficient: unemployment-rate change (pp) per 1% output gap. Okun's law estimates ~0.3-0.5. */
  okun: 0.4,

  // --- public finance ---
  /** Real interest rate on public debt (assumption). */
  realRate: 0.015,
  /** Extra interest per unit of debt/GDP above 0.6 (risk premium; assumption). */
  riskPremium: 0.03,
  /** Default when interest / revenue exceeds this. Order of magnitude of IMF-World Bank LIC-DSF debt-service-to-revenue
   *  thresholds (14-23%) plus margin for market-access countries. Assumption. */
  defaultBurden: 0.3,
  /** Share of debt written off in a restructuring. Cruces & Trebesch (2013) average haircut ~37%. */
  defaultHaircut: 0.37,
  /** Immediate output loss from default (log points). Literature range ~2-5% (Borensztein & Panizza 2009). */
  defaultOutputLoss: 0.03,
  /** Fiscal reaction: primary balance responds by this much per unit debt/GDP above baseline (Bohn 1998 ~0.03-0.05). */
  bohn: 0.04,

  // --- religion ---
  /** Secularisation speed relative to the rate fitted on the WRP panel (1 = as observed; scenario parameter). */
  religion: { rateScale: 1 },

  // --- politics (systems/politics.ts) ---
  politics: {
    termYears: 4,          // years between elections (typical 4-5; one value for all electoral regimes, assumption)
    approvalYears: 0.5,    // approval adjusts to conditions within months
    approvalNoise: 0.03,   // quarterly news/scandal shocks to approval
    voteGrowth: 1.5,       // approval per unit growth surprise (1 pp growth ≈ 1.5 pp approval; economic-voting literature)
    voteMisery: 0.01,      // approval per misery-index point (unemployment + compressed inflation)
    fatigue: 0.015,        // approval lost per year in office after two years ("cost of ruling")
    perfYears: 8, legitYears: 4,
    unrestYears: 0.5, unrestNoise: 0.02,
    /** Unrest log-odds per unit change from baseline. Signs follow the conflict literature (misery, legitimacy,
     *  youth bulges: Urdal 2006; religious polarisation: Montalvo & Reynal-Querol 2005); magnitudes are assumptions. */
    unrestW: { misery: 0.06, approval: 3, legitimacy: 3, polarisation: 4, youth: 8 },
    instabilityCost: 0.02, // annual output loss per unit of unrest above baseline (Aisen & Veiga 2013 order of magnitude)
    ideologyFiscal: 0.1,   // revenue/GDP moves ±10% of baseline with governing orientation (partisan theory; assumption)
    policyYears: 4,
    diffusion: 0.03,       // per year, pull of democracy toward partners' average (Gleditsch & Ward 2006; assumption)
    demoNoise: 0.005,      // yearly s.d. of democracy drift (median |change| ≈ 0.004 in V-Dem 2001-2023)
    /** Episodes: probability per year and s.d. of a jump in the democracy index, plus a push in the direction of
     *  legitimacy change. Set so ~10% of country-years change by more than 0.034 (V-Dem 2001-2023 90th percentile). */
    episode: { perYear: 0.18, size: 0.06, legitimacy: 0.1 },
    election: { approval: 6, autocracy: 4, terms: 0.3 },
    /** Coups: world attempts per year at baseline (Powell & Thyne data: roughly 2-5 a year since 2000), log-hazard
     *  weights (signs from the coup literature: autocracy, unrest, coup traps, recessions, low legitimacy, and log
     *  income — coups are rare in rich countries, Londregan & Poole 1990), base
     *  success rate ≈ 50% (Powell & Thyne 2011), output loss on success. */
    coup: { attemptsPerYear: 3, maxPerYear: 0.35, autocracy: 3, unrest: 2, memory: 0.5, income: 0.8, recession: 0.8, legitimacy: 2, success: 0.5, outputLoss: 0.02, memoryYears: 10, demoFactor: 0.6 },
    protestThreshold: 0.55,
    /** Uprising hazard per year at maximum unrest (assumption), polarisation multiplier, share ending in democracy. */
    uprising: { rate: 0.25, polarisation: 1.5, democraticShare: 0.3, outputLoss: 0.03 },
    /** Democracy erosion per year by a popular incumbent: × (approval − 0.5) × (0.75 − demo) × years in office (≤ 8).
     *  Mechanism from the autocratisation literature (Lührmann & Lindberg 2019); magnitude is an assumption. */
    aggrandisement: 0.12,
    /** Democracy regained when an incumbent loses an election in a not-fully-liberal regime (assumption). */
    uTurn: 0.03,
    /** Pull per year of the democracy index toward the country's baseline level (institutional persistence; 1/30). */
    persistence: 0.033,
    /** Regime categories from the democracy index, with a narrow hysteresis band around V-Dem's ~0.5 boundary. */
    thresholds: { democratise: 0.5, autocratise: 0.46, liberal: 0.75, electoral: 0.3 },
  },

  // --- military ---
  /** Annual depreciation of the military capital stock (equipment, training). Assumption. */
  milDepreciation: 0.08,
};
export type Params = typeof DEFAULT_PARAMS;
