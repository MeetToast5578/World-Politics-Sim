// Shape of public/data/baseline.json (produced by scripts/build-data.mjs).

export type SourceId = 'NE' | 'WDI' | 'WGI' | 'IMF' | 'WD' | 'NE_EST' | 'IMPUTED' | 'DERIVED' | 'VDEM' | 'WRP' | 'PROXY' | 'CIA_WFB' | 'ATOP' | 'UNGA' | 'CURATED' | 'UCDP' | 'SIPRI' | 'ORGS';

/** A sourced observation: value, reference year, source. */
export interface Obs { v: number; y: number; s: SourceId }

export type GovForm =
  | 'parliamentary' | 'presidential' | 'semi_presidential' | 'constitutional_monarchy' | 'absolute_monarchy'
  | 'one_party' | 'military' | 'theocracy' | 'monarchy_other' | 'republic_other' | 'unclassified';

export interface BaselineCountry {
  id: string;
  name: string;
  status: 'recognized' | 'partially_recognized' | 'unrecognized' | 'non_self_governing';
  wbRegion: string;
  continent: string;
  regions: string[];
  fields: Partial<Record<string, Obs>>;
  government: { form: GovForm; basis: string; raw: string | null; s: SourceId | null };
  religion: { s: SourceId; y: number; reliability?: string; proxy?: string; shares: number[] } | null;
  geo: { areaKm2: number; coastKm: number; coreCoastKm: number; landlocked: boolean; centroid: [number, number]; s: SourceId };
  /** party of the head of government (head of state in presidential systems) at the end of the reference year,
   *  with its left-right position (Wikidata P1387) and model party family; null where there is none */
  rulingParty?: { name: string; family: number; pos: number; s: SourceId } | null;
}

export interface BaselineRegion {
  id: string;
  name: string;
  owner: string | null;
  dataCode: string | null;
  status: string;
  areaKm2: number;
  coastKm: number;
  landNeighbors: string[];
  centroid: [number, number];
}

/** Piecewise-linear curve through [x, y] knots (binned medians), flat beyond the end knots. */
export interface Curve {
  knots: [number, number][]; n: number; x: string;
  /** Per-knot change per year not explained by income growth (log change if driftLog), from a 10-year panel. */
  drift?: number[]; driftLog?: boolean; driftFrom?: string;
}

/** A province (Natural Earth admin-1): the unit territory changes hands in. pop is an estimate for the reference
 *  year (Wikidata where available, scaled to the World Bank total). nb: land-neighbouring province indices. */
export interface BaselineProvince {
  id: string; name: string; region: string; pop: number; areaKm2: number; centroid: [number, number]; nb: number[];
}

export interface Baseline {
  meta: {
    referenceYear: number;
    startDate: string;
    generated: string;
    sources: Record<string, { name: string; url: string; license: string }>;
    indicators: Record<string, { source: string; code: string; agg: string }>;
    curves: Record<'tfr' | 'lifeExpF' | 'lifeExpM' | 'u5mrF' | 'u5mrM' | 'agriShare' | 'industryShare' | 'investment', Curve>;
    coverage: Record<string, Record<string, number>>;
    baseRates: { alliances: { window: string; accessionsPerYear: number; exitsPerYear: number; newTreatiesPerYear: number };
      window: string; regimeChangePerCountryYear: number; democracyBoundaryPerCountryYear: number; indexRuleCrossingsPerCountryYear: number; demoAbsChangeMedian: number; demoAbsChangeP90: number };
    religions: { label: string; family: string }[];
    diplomacy: {
      treaties: { id: string; label?: string | null; since: number; members: string[] }[];
      atopYear: number; allianceUpdates: string[]; sanctionsAsOf: number;
      /** sender 'UN' = UN Security Council regime (a country-level status in the model) */
      sanctions: { sender: string; target: string; intensity: number; since: number; programme: string }[];
      foreignPolicy: { slopeOnDemocracy: number; r2: number; n: number };
      /** Initial grievance per pair from conflict history (MIDs to 2014, UCDP interstate conflicts after). */
      grievances: { a: string; b: string; g: number }[];
    };
    /** UCDP armed conflicts: those under way at the reference year, and observed rates over the 34 years before it. */
    conflict: {
      window: string; deathsWindow: string; nuclear: string[]; battleDeathsPerYear: number;
      interstate: { onsetsPerYear: number; durationYears: Record<string, number>; deaths: Record<string, number> };
      civil: { onsetsPerYear: number; spellYears: Record<string, number>; deaths: Record<string, number>; countryDeaths: Record<string, number>; activeCountries: number;
        /** last calendar year of internal conflict, for countries at peace at the reference year */
        lastYear: Record<string, number> };
      /** a: government / first side (with state supporters), b: other side (states; rebels' state backers in civil conflicts) */
      active: { kind: 'interstate' | 'civil'; a: string[]; b: string[]; loc: string; start: string; goal: 'government' | 'territory'; deaths: number; name: string | null; territory?: string | null; intensity: number }[];
    };
    /** International organisations: members at the reference year (suspended: suspended at its end). */
    organisations: { id: string; name: string; kind: 'trade' | 'political' | 'economic' | 'club'; url: string; members: { id: string; since: number; suspended: boolean }[]; former: { id: string; left: number }[] }[];
    /** Logistic secularisation ds/dt = r·s·(1 − s/K) fitted on the World Religion Project panel. */
    secularisation: { r: number; K: number; n: number; window: string };
  };
  countries: BaselineCountry[];
  regions: BaselineRegion[];
  provinces: BaselineProvince[];
}
