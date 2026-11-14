// Model parameters. Every number here is an assumption, not data; the comment states where it comes from.
// Parameters are part of a world's identity: they are stored in saves, and changing one changes the timeline.
export const DEFAULT_PARAMS = {
  // --- demography ---
  /** Years spent in the 0-14 cohort; flow 0-14 -> 15-64 = p0 / 15 per year (uniform-age-within-cohort assumption). */
  childYears: 15,
  /** Years spent in 15-64; flow 15-64 -> 65+ = p1 / 50 per year (same assumption; biased for non-stationary populations). */
  workYears: 50,
  /** Age-specific mortality m_i(e0) = a_i * exp(-b_i (e0 - 70)). Rough shape fitted by hand to typical UN WPP
   *  life-table patterns; the level is re-calibrated per country so baseline deaths match the WDI crude death rate. */
  mort: { a: [0.0012, 0.0035, 0.05], b: [0.13, 0.06, 0.025] },
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

  // --- military ---
  /** Annual depreciation of the military capital stock (equipment, training). Assumption. */
  milDepreciation: 0.08,
};
export type Params = typeof DEFAULT_PARAMS;
