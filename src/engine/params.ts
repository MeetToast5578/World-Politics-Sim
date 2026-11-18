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

  // --- diplomacy (systems/diplomacy.ts) ---
  diplomacy: {
    powers: 12,            // the largest military powers are all paired with each other
    trustYears: 5,         // trust adjusts toward its drivers over ~5 years (assumption)
    grievanceYears: 15,    // grievances fade slowly: decades-old conflicts still weigh (assumption)
    friendShoring: 0.3,    // bilateral trade × e^(0.3·Δtrust) (political relations shape trade; magnitude assumption)
    /** Trust = tanh(c + Σ drivers). Weights are assumptions; UN-voting distance is the dominant term because it is
     *  the best observed proxy of foreign-policy alignment (Bailey, Strezhnev & Voeten 2017). */
    trust: { c: 0.9, fp: 0.35, ideo: 0.5, trade: 0.5, ally: 0.8, rel: 0.4, grievance: 0.5, sanctions: 0.6 },
    /** Crises: world rate ≈ 4 a year (International Crisis Behavior project order of magnitude since 1990). */
    crisis: { perYear: 4, max: 0.3, threat: 6, grievance: 2, trust: 2, unrest: 2, grievanceAdd: 0.4, trustLoss: 0.15 },
    /** Sanctions: new directed episodes per year (assumption, order of magnitude of the Global Sanctions Data Base,
     *  which counts a multilateral package once; here every sender counts); lifting ≈ 12%/yr at neutral trust;
     *  trade cut 60% for comprehensive measures (EU-Russia trade fell ~60% in 2021-23); productivity cost up to
     *  1%/yr (Neuenkirch & Neumeier 2015: −0.9 to −2 pp growth). */
    sanctions: { perYear: 20, max: 0.3, maxTrust: 0, trigger: 0.3, coup: 4, threat: 4, grievance: 1, trust: 4, trade: 0.5, size: 0.15, coalition: 4,
      grievanceAdd: 0.3, liftBase: 0.12, liftTrust: 1.5, tradeCut: 0.6, productivityCost: 0.01, loadScale: 1.5,
      /** UN Security Council regimes: lifting ≈ 3%/yr (regimes such as Iraq 1990-2003 and the DPRK since 2006 last
       *  decades), multiplied by e^(8·democratic gain) after regime change. Assumptions. */
      unLiftBase: 0.03, unLiftDemocracy: 8 },
    /** Alliances: hazards saturate at max/yr; rates calibrated to ATOP (data build). accept: members' mean trust
     *  needed; region: weight of mean proximity to the members (alliances are mostly regional). */
    alliances: { max: 0.3, trust: 3, threat: 3, accept: 0.3, region: 3, leaveTrust: 0.1 },
  },

  // --- military ---
  /** Annual depreciation of the military capital stock (equipment, training). Assumption. */
  milDepreciation: 0.08,

  // --- international organisations (systems/organisations.ts) ---
  organisations: {
    /** trust driver per organisation two countries newly share (lost when one leaves), relative to the start */
    trust: { EU: 0.3, AU: 0.1, ECOWAS: 0.1, ASEAN: 0.15, MERCOSUR: 0.15, OPEC: 0.1, OECD: 0.15, BRICS: 0.2, SCO: 0.15 } as Record<string, number>,
    /** trade between two members × e^w (customs unions and free-trade areas; EU membership raises trade by tens of
     *  per cent in gravity estimates, e.g. Baier & Bergstrand 2007 for FTAs; magnitudes are assumptions) */
    trade: { EU: 0.5, ASEAN: 0.2, MERCOSUR: 0.3, ECOWAS: 0.15 } as Record<string, number>,
    /** yearly accession hazard for eligible countries; suspension rules; walk-out of suspended members */
    rules: {
      EU: { join: 0.04, minDemocracy: 0.6, suspendCoup: false },
      AU: { join: 0.5, suspendCoup: true },
      ECOWAS: { join: 0.03, suspendCoup: true, suspendedExit: 0.25 },
      ASEAN: { join: 0.03 },
      MERCOSUR: { join: 0.01, minDemocracy: 0.4 },
      OPEC: { join: 0.01 },
      OECD: { join: 0.02, minDemocracy: 0.55 },
      BRICS: { join: 0.01 },
      SCO: { join: 0.005 },
    } as Record<string, { join: number; minDemocracy?: number; suspendCoup?: boolean; suspendedExit?: number }>,
    exitBase: 0.001, exitTrust: 2.5, readmit: 0.5,
    /** a former member's accession hazard is multiplied by this */
    formerRejoin: 0.1,
    /** OPEC: join above this oil-income weight, leave (10%/yr) below the other */
    opecJoin: 0.08, opecLeave: 0.02,
  },

  // --- armed conflict (systems/conflict.ts) ---
  // Onset rates and duration / deaths distributions are targets from UCDP (data build); weights are assumptions
  // informed by the quantitative conflict literature cited per line.
  conflict: {
    /** Civil-conflict onset (country-year logit; Fearon & Laitin 2003, Hegre & Sambanis 2006 signs and rough sizes):
     *  population (log), income (log), electoral autocracy ("anocracy"), unrest (instability), religious polarisation,
     *  youth bulge (Urdal 2006), conflict trap (Collier et al. 2003), a neighbour at war (contagion); liberal
     *  democracies are rarely the site of armed conflict (Hegre et al. 2001); microstates are excluded. */
    civil: { max: 0.5, pop: 0.4, income: 0.9, anocracy: 0.6, liberal: 1.0, unrest: 3, polarisation: 0.8, youth: 4, memory: 1.5, neighbour: 0.5, minPop: 2e5 },
    /** Interstate onset (pair-year logit; Bremer 1992 "dangerous dyads", Russett & Oneal 2001): contiguity,
     *  joint democracy, grievance (rivalry), distrust, power parity, shared alliance, nuclear deterrence. Saturates at
     *  max per pair-year: even enduring rivalries (India-Pakistan) fight a few times per half-century. */
    interstate: { max: 0.08, contiguity: 2, jointDemocracy: 1.5, grievance: 1.2, distrust: 2, parity: 0.8, alliance: 1.2, nuclear: 2.5, unrest: 1,
      /** Only the largest militaries project force: countries without a land border fight only if one of them
       *  ranks among the top `projection` by military capital and the pair has a quarrel (grievance above
       *  distantGrievance, from past disputes or crises). */
      projection: 15, distantGrievance: 0.3 },
    /** Duration: termination hazard α/(τ + t) per year (Lomax) times (1 + decisive·score²); fitted to UCDP medians
     *  and tails by the ensemble test. */
    duration: { civilAlpha: 0.95, civilTau: 2.5, interAlpha: 2.1, interTau: 1.0, decisive: 1 },
    /** Battle deaths per year: lognormal; persistent part drawn per war plus a monthly AR(1) deviation (stationary sd
     *  ≈ 0.9). UCDP BRD 1990-2023, summed per country-year for internal conflicts: median 325, 90th percentile 3,034
     *  (total ln-sd ≈ 1.74); interstate conflict-years: median 138, 90th percentile 7,927 (ln-sd ≈ 3.2). */
    deaths: { civilMedian: 325, civilSd: 1.45, interMedian: 140, interSd: 3.0, lvlRho: 0.94, lvlSd: 0.3 },
    /** Fighting: score drift from the balance of strength (κ per year) plus noise; home advantage of defenders;
     *  strength = military capital × reach (1 / (1 + distance / reachKm)); governments' strength scales with legitimacy. */
    fight: { kappa: 0.3, noise: 0.5, home: 1.5, reachKm: 2000, rebelBase: 0.6, maxOccupation: 0.5, occSpeed: 0.1,
      /** Rebel-held territory (share of the population) when neither side is winning, in a war of 1,000+ deaths a
       *  year; × 2/(1 + e^(3·score)) with the rebels' fortunes, × √(deaths/1,000) below that. Only conflicts that
       *  have reached civil-war scale (1,000 deaths a year) hold territory. Display and history only: no effect on
       *  fighting yet. Assumption (RSF in Sudan, Myanmar's resistance ≈ ⅓). */
      rebelTerritory: 0.3,
      /** separatists (wars over territory) hold at most this share of the population, never the most populous province */
      maxSeparatist: 0.2,
      /** rebels' strength × (1 + this × share they hold): territory brings recruits and revenue (assumption) */
      rebelTerritoryStrength: 1.5 },
    /** Military aid in interstate wars: a non-belligerent m helps side s when trust(m, s) − trust(m, enemy) > min,
     *  with share × (difference − min) of its military capital (US aid to Ukraine ≈ 5% of US military spending in
     *  2022-23; magnitude assumption). Aid is shipped, so distance does not reduce it. */
    aid: { share: 0.03, min: 0.6 },
    /** Consequences per unit warLoad (≈ 3 for Ukraine 2023, ≈ 0.1 for a minor insurgency): annual destruction of
     *  capital and productivity (Collier 1999: civil war costs ≈ 2% growth/yr; Ukraine 2022 −29% GDP), refugees per
     *  battle death (UNHCR: Ukraine, Syria order 20-40), civilians killed per battle death (assumption 0.3), unrest. */
    damage: { capital: 0.05, tfp: 0.01, refugeesPerDeath: 30, civiliansPerDeath: 0.3, unrest: 0.3,
      /** caps: battle deaths ≤ 1% of the population a year; refugees ≤ 0.4% a month (Syria 2012-16 ≈ 0.5%). */
      maxDeathShare: 0.01, maxRefugeeShare: 0.004,
      /** rebel-held territory costs the state output (domestic cycle, per year per share held) and legitimacy */
      rebelOutput: 0.1, rebelLegitimacy: 0.2 },
    /** Mobilisation: belligerents' military spending moves toward 4% of GDP plus up to 25% for the country fought
     *  over (Ukraine 2023 ≈ 37%, Russia ≈ 6%), relaxing back to the pre-war level after (≈ 5 years). */
    mobilise: { base: 0.04, home: 0.25, years: 1, demobYears: 5 },
    /** Allies: a defence-treaty partner joins the defender with probability join·(1 + trust)/2 × reach, halved for
     *  multilateral treaties. Leeds et al. (2000) find commitments honoured ≈ 75% of the time when formally invoked,
     *  but invocations are rare: since 1990 almost no UCDP interstate conflict had states joining as belligerents. */
    allies: { join: 0.2, attackerJoin: 0.05, multilateral: 0.3, grievance: 1.5 },
    /** Outcome thresholds: a side wins outright when the score passes ±victory; otherwise a peace agreement with
     *  probability peace (civil; Kreutz 2010: of civil conflict terminations ≈ 16% victories, ≈ 18% peace
     *  agreements, ≈ 17% ceasefires, ≈ 46% low activity). */
    outcome: { victory: 0.75, peace: 0.35,
      /** rebels who win a war over territory form their own state with this probability (otherwise self-rule);
       *  since 1990 a handful of states were born from conflict (Eritrea, East Timor, Kosovo, South Sudan), about one
       *  a decade (assumption). */
      secession: 0.4,
      /** a new state starts as a democracy with this probability, otherwise as an autocracy (assumption) */
      secessionDemocratic: 0.3 },
    /** Conflict-trap memory decays over ~10 years; rally-round-the-flag approval at the start of an interstate war. */
    memoryYears: 10, rally: 0.08,
    /** Nuclear use: only by a nuclear state whose own territory is substantially occupied or whose government is
     *  being overthrown by a foreign army; per month. Never observed since 1945, so tiny (assumption). */
    nuclear: { useMonthly: 0.005, occupied: 0.25, killShare: 0.02, capital: 0.25, tfp: 0.05, oilShock: 0.5, retaliate: 0.8 },
  },
};
export type Params = typeof DEFAULT_PARAMS;
