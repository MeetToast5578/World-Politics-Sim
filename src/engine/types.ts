// Shape of public/data/baseline.json (produced by scripts/build-data.mjs).

export type SourceId = 'NE' | 'WDI' | 'WGI' | 'IMF' | 'WD' | 'NE_EST' | 'IMPUTED' | 'DERIVED';

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
  geo: { areaKm2: number; coastKm: number; coreCoastKm: number; landlocked: boolean; centroid: [number, number]; s: SourceId };
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
export interface Curve { knots: [number, number][]; n: number; x: string }

export interface Baseline {
  meta: {
    referenceYear: number;
    startDate: string;
    generated: string;
    sources: Record<string, { name: string; url: string; license: string }>;
    indicators: Record<string, { source: string; code: string; agg: string }>;
    curves: { tfr: Curve; lifeExp: Curve };
    coverage: Record<string, Record<string, number>>;
  };
  countries: BaselineCountry[];
  regions: BaselineRegion[];
}
