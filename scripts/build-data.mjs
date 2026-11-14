// Data ingestion: downloads public datasets and writes the baseline world used by the engine.
//   public/data/world.topo.json   region geometry (Natural Earth 1:50m, public domain)
//   public/data/baseline.json     countries, regions, sourced indicators, fitted regressions
// Every country field is {v, y, s}: value, reference year, source id (see SOURCES).
// Run: npm run data   (needs network; raw downloads are cached in .cache/)
import fs from 'node:fs';
import path from 'node:path';
import { topology } from 'topojson-server';
import { neighbors, feature, quantize } from 'topojson-client';
import { geoArea, geoLength, geoCentroid } from 'd3-geo';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const CACHE = path.join(ROOT, '.cache');
const OUT = path.join(ROOT, 'public', 'data');
fs.mkdirSync(CACHE, { recursive: true });
fs.mkdirSync(OUT, { recursive: true });

const REF_YEAR = 2023; // baseline reference year; older observations accepted back to MIN_YEAR
const MIN_YEAR = 2015;
const EARTH_R_KM = 6371.0088;

const SOURCES = {
  NE: { name: 'Natural Earth 1:50m Admin 0 Countries (v5.x)', url: 'https://www.naturalearthdata.com/', license: 'Public domain' },
  WDI: { name: 'World Bank, World Development Indicators', url: 'https://data.worldbank.org/', license: 'CC BY 4.0 (some third-party series, e.g. SIPRI military data, carry their own terms)' },
  WGI: { name: 'World Bank, Worldwide Governance Indicators', url: 'https://www.worldbank.org/en/publication/worldwide-governance-indicators', license: 'CC BY 4.0' },
  IMF: { name: 'IMF DataMapper (World Economic Outlook / Fiscal Monitor)', url: 'https://www.imf.org/external/datamapper/', license: 'IMF copyright, reuse with attribution per IMF terms — verify before redistribution' },
  WD: { name: 'Wikidata, basic form of government (P122)', url: 'https://www.wikidata.org/', license: 'CC0' },
  NE_EST: { name: 'Natural Earth POP_EST / GDP_MD attribute (fallback)', url: 'https://www.naturalearthdata.com/', license: 'Public domain' },
  IMPUTED: { name: 'Imputed: median of countries in the same World Bank region', url: '', license: 'Model assumption' },
  DERIVED: { name: 'Derived from geometry (Natural Earth 1:50m)', url: '', license: 'Public domain' },
};

// field -> [source, indicator code, aggregation]  ('sum' for stocks/counts, 'wavg' pop-weighted, 'gavg' GDP-weighted)
const WDI = {
  pop: ['WDI', 'SP.POP.TOTL', 'sum'],
  pop0014: ['WDI', 'SP.POP.0014.TO.ZS', 'wavg'],
  pop1564: ['WDI', 'SP.POP.1564.TO.ZS', 'wavg'],
  pop65: ['WDI', 'SP.POP.65UP.TO.ZS', 'wavg'],
  cbr: ['WDI', 'SP.DYN.CBRT.IN', 'wavg'],
  cdr: ['WDI', 'SP.DYN.CDRT.IN', 'wavg'],
  tfr: ['WDI', 'SP.DYN.TFRT.IN', 'wavg'],
  lifeExp: ['WDI', 'SP.DYN.LE00.IN', 'wavg'],
  urban: ['WDI', 'SP.URB.TOTL.IN.ZS', 'wavg'],
  netMigration: ['WDI', 'SM.POP.NETM', 'sum'],
  laborForce: ['WDI', 'SL.TLF.TOTL.IN', 'sum'],
  unemployment: ['WDI', 'SL.UEM.TOTL.ZS', 'wavg'],
  gdp: ['WDI', 'NY.GDP.MKTP.CD', 'sum'],
  gdpPpp: ['WDI', 'NY.GDP.MKTP.PP.CD', 'sum'],
  inflation: ['WDI', 'FP.CPI.TOTL.ZG', 'gavg'],
  investment: ['WDI', 'NE.GDI.TOTL.ZS', 'gavg'],
  trade: ['WDI', 'NE.TRD.GNFS.ZS', 'gavg'],
  agriShare: ['WDI', 'NV.AGR.TOTL.ZS', 'gavg'],
  industryShare: ['WDI', 'NV.IND.TOTL.ZS', 'gavg'],
  servicesShare: ['WDI', 'NV.SRV.TOTL.ZS', 'gavg'],
  milexShare: ['WDI', 'MS.MIL.XPND.GD.ZS', 'gavg'],
  armedForces: ['WDI', 'MS.MIL.TOTL.P1', 'sum'],
  arableShare: ['WDI', 'AG.LND.ARBL.ZS', 'wavg'],
  energyImportsShare: ['WDI', 'EG.IMP.CONS.ZS', 'wavg'],
  wgiVoice: ['WGI', 'GOV_WGI_VA.EST', 'wavg'],
  wgiStability: ['WGI', 'GOV_WGI_PV.EST', 'wavg'],
  wgiEffectiveness: ['WGI', 'GOV_WGI_GE.EST', 'wavg'],
  wgiRegulatory: ['WGI', 'GOV_WGI_RQ.EST', 'wavg'],
  wgiRuleOfLaw: ['WGI', 'GOV_WGI_RL.EST', 'wavg'],
  wgiCorruption: ['WGI', 'GOV_WGI_CC.EST', 'wavg'],
};
const IMF = {
  govDebt: ['IMF', 'GGXWDG_NGDP', 'gavg'],
  govRevenue: ['IMF', 'GGR_G01_GDP_PT', 'gavg'],
  govBalance: ['IMF', 'GGXCNL_NGDP', 'gavg'],
};
// Fields where a missing value is better left missing than imputed (shown as "no data").
// milexShare: missing mostly means "no armed forces" (Iceland-type) or "no reliable data" (e.g. North Korea); neither is a regional median.
const NO_IMPUTE = new Set(['armedForces', 'netMigration', 'milexShare']);

async function cached(name, url, opts = {}) {
  const f = path.join(CACHE, name);
  if (fs.existsSync(f)) return fs.readFileSync(f, 'utf8');
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const r = await fetch(url, { method: opts.method, body: opts.body, signal: AbortSignal.timeout(90000), headers: { 'User-Agent': 'world-sim-data-build/0.1', ...(opts.headers || {}) } });
      if (!r.ok) throw new Error(`${r.status} ${url}`);
      const t = await r.text();
      fs.writeFileSync(f, t);
      return t;
    } catch (e) {
      if (attempt === 3) throw e;
      await new Promise((res) => setTimeout(res, 2000 * (attempt + 1)));
    }
  }
}

// --- World Bank -------------------------------------------------------------
const WB_NAME_FIX = { 'Taiwan, China': 'TWN' };
async function wbIndicator(code, source) {
  const src = source === 'WGI' ? '&source=3' : '&source=2'; // explicit source avoids slow/hanging API routes
  const url = (d) => `https://api.worldbank.org/v2/country/all/indicator/${code}?format=json&per_page=20000&date=${d}${src}`;
  let rows;
  try {
    rows = JSON.parse(await cached(`wb_${code}.json`, url(`${MIN_YEAR}:${REF_YEAR}`)))[1] || [];
  } catch {
    // some series return 502 for multi-year ranges; fall back to one request per year
    rows = [];
    for (let y = REF_YEAR; y >= MIN_YEAR; y--) rows.push(...(JSON.parse(await cached(`wb_${code}_${y}.json`, url(y)))[1] || []));
  }
  const best = {}; // iso3 -> {v, y}
  for (const r of rows) {
    const iso = r.countryiso3code || WB_NAME_FIX[r.country.value];
    if (!iso || r.value == null) continue;
    const y = +r.date;
    if (!best[iso] || y > best[iso].y) best[iso] = { v: r.value, y };
  }
  return best;
}

// Standard deviation of annual real GDP growth 2000-2019 (excludes the COVID shock). Needs >= 10 observations.
async function growthVolatility() {
  const txt = await cached('wb_growth_2000_2019.json', 'https://api.worldbank.org/v2/country/all/indicator/NY.GDP.MKTP.KD.ZG?format=json&per_page=20000&date=2000:2019&source=2');
  const by = {};
  for (const r of JSON.parse(txt)[1] || []) if (r.countryiso3code && r.value != null) (by[r.countryiso3code] ??= []).push(r.value);
  const out = {};
  for (const [iso, xs] of Object.entries(by)) {
    if (xs.length < 10) continue;
    const m = xs.reduce((a, b) => a + b, 0) / xs.length;
    out[iso] = { v: Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1)), y: 2019 };
  }
  return out;
}

// --- IMF --------------------------------------------------------------------
async function imfIndicator(code) {
  const txt = await cached(`imf_${code}.json`, `https://www.imf.org/external/datamapper/api/v1/${code}`);
  const vals = JSON.parse(txt).values?.[code] || {};
  const best = {};
  for (const [iso, series] of Object.entries(vals)) {
    for (let y = REF_YEAR; y >= MIN_YEAR; y--) {
      if (series[y] != null) { best[iso] = { v: series[y], y }; break; }
    }
  }
  return best;
}
const IMF_ALIAS = { UVK: 'XKX', WBG: 'PSE' }; // IMF code -> our data code

// --- Wikidata: form of government -------------------------------------------
// Queried by the Wikidata QID that Natural Earth stores for each feature. Collects:
//  gov  = labels of "basic form of government" (P122)
//  kind = labels of "instance of" (P31), e.g. "communist state", "Commonwealth realm"
//  sameOffice = head of state office (P1906) equals head of government office (P1313)
async function wikidataGov(qids) {
  const q = `SELECT ?c (GROUP_CONCAT(DISTINCT ?gl; separator="; ") AS ?gov) (GROUP_CONCAT(DISTINCT ?kl; separator="; ") AS ?kind)
    (GROUP_CONCAT(DISTINCT STR(?hos); separator=" ") AS ?hosO) (GROUP_CONCAT(DISTINCT STR(?hog); separator=" ") AS ?hogO) WHERE {
    VALUES ?c { ${qids.map((q) => 'wd:' + q).join(' ')} }
    OPTIONAL { ?c wdt:P122 ?g . ?g rdfs:label ?gl FILTER(lang(?gl)="en") }
    OPTIONAL { ?c wdt:P31 ?k . ?k rdfs:label ?kl FILTER(lang(?kl)="en") }
    OPTIONAL { ?c wdt:P1906 ?hos } OPTIONAL { ?c wdt:P1313 ?hog }
  } GROUP BY ?c`;
  const txt = await cached('wd_gov_v2.json', 'https://query.wikidata.org/sparql', {
    method: 'POST', body: 'query=' + encodeURIComponent(q),
    headers: { Accept: 'application/sparql-results+json', 'Content-Type': 'application/x-www-form-urlencoded' },
  });
  const out = {};
  for (const b of JSON.parse(txt).results.bindings) {
    const hos = (b.hosO?.value || '').split(' ').filter(Boolean), hog = (b.hogO?.value || '').split(' ').filter(Boolean);
    out[b.c.value.split('/').pop()] = { gov: b.gov?.value || '', kind: b.kind?.value || '', sameOffice: hos.length > 0 && hos.some((h) => hog.includes(h)) };
  }
  return out;
}
// Keyword classification. Order = priority. Raw labels are kept in the output so every classification is auditable.
const GOV_RULES = [
  ['military', /military junta|military dictatorship|stratocracy/],
  ['one_party', /one-party|single-party|communist state|socialist state|juche|marxist/],
  ['absolute_monarchy', /absolute monarchy/],
  ['theocracy', /theocracy|islamic republic/],
  ['constitutional_monarchy', /constitutional monarchy|parliamentary monarchy|commonwealth realm|federal monarchy|elective monarchy/],
  ['semi_presidential', /semi-presidential/],
  ['presidential', /presidential system|presidential republic/],
  ['parliamentary', /parliamentary/],
  ['monarchy_other', /monarchy/],
];
// Curated corrections where Wikidata labels are missing or misleading. Each states its basis; keep this list short.
const GOV_OVERRIDE = {
  CHN: ['one_party', 'curated: Constitution of the PRC, Art. 1 (leadership of the Communist Party of China)'],
  LAO: ['one_party', 'curated: Constitution of the Lao PDR, Art. 3 (Lao People\'s Revolutionary Party)'],
  MMR: ['military', 'curated: military State Administration Council governing since the February 2021 coup'],
  AUS: ['constitutional_monarchy', 'curated: Commonwealth realm, Australian Constitution s.2/s.61'],
  IND: ['parliamentary', 'curated: Constitution of India, Art. 74-75 (council of ministers responsible to Lok Sabha)'],
  KEN: ['presidential', 'curated: Constitution of Kenya 2010, Art. 130-131'],
};
function classifyGov(w) {
  if (!w) return { form: 'unclassified', basis: 'no Wikidata entry' };
  const s = `${w.gov}; ${w.kind}`.toLowerCase();
  for (const [k, re] of GOV_RULES) if (re.test(s)) return { form: k, basis: 'P122/P31 labels' };
  // Fallback: a republic whose head of state also heads the government is presidential; otherwise unknown.
  if (/republic/.test(s) && w.sameOffice) return { form: 'presidential', basis: 'head of state office = head of government office (P1906/P1313)' };
  if (/republic|democracy/.test(s)) return { form: 'republic_other', basis: 'P122/P31 labels' };
  return { form: 'unclassified', basis: 'no matching labels' };
}

// --- Regions and entities from Natural Earth ---------------------------------
// Natural Earth groups features by sovereignty (SOV_A3). We follow it, with explicit overrides where the
// NE grouping does not match the entity we want to simulate. Each override is documented in DATA_SOURCES.md.
const ENTITY_OVERRIDE = {
  PSX: { entity: 'PSE', status: 'partially_recognized' }, // NE files Palestine under Israel's sovereignty group
  SAH: { entity: 'ESH', status: 'non_self_governing' },   // Western Sahara: status unresolved; de facto Moroccan administration of most of it is NOT modelled yet
  KAS: { entity: null, status: 'contested_unowned' },     // Siachen Glacier
  ATA: { entity: null, status: 'antarctic_treaty' },
};
const STATUS_BY_SOV = { TWN: 'partially_recognized', KOS: 'partially_recognized', CYN: 'partially_recognized', SOL: 'unrecognized' };
const WB_ALIAS = { KSV: 'XKX', WBG: 'PSE', IMY: 'IMN', CHI: null };
const dataCode = (p) => {
  const c = [p.ISO_A3_EH, p.ISO_A3, p.WB_A3, p.ADM0_A3].find((x) => x && x !== '-99'); // NE's WB_A3 uses some retired codes (ROM, ZAR, TMP, ADO)
  return c in WB_ALIAS ? WB_ALIAS[c] : c;
};

async function main() {
  const ne = JSON.parse(await cached('ne50.geojson', 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_countries.geojson'));
  const feats = ne.features.sort((a, b) => a.properties.ADM0_A3.localeCompare(b.properties.ADM0_A3));

  // Entity code for each sovereignty group = data code of its HOMEPART core feature.
  const sovCore = {};
  for (const f of feats) {
    const p = f.properties;
    if (p.ADMIN === p.SOVEREIGNT && !ENTITY_OVERRIDE[p.ADM0_A3]) sovCore[p.SOV_A3] = { code: dataCode(p) || p.ADM0_A3, name: p.SOVEREIGNT };
  }
  const missingCore = [...new Set(feats.map((f) => f.properties.SOV_A3))].filter((s) => !sovCore[s] && !feats.every((f) => f.properties.SOV_A3 !== s || ENTITY_OVERRIDE[f.properties.ADM0_A3]));
  if (missingCore.length) throw new Error('no core feature for sovereignty ' + missingCore);

  const regions = feats.map((f, i) => {
    const p = f.properties;
    const ov = ENTITY_OVERRIDE[p.ADM0_A3];
    const owner = ov ? ov.entity : sovCore[p.SOV_A3].code;
    return {
      id: p.ADM0_A3, name: p.NAME, owner, dataCode: dataCode(p), wbRegion: p.REGION_WB, continent: p.CONTINENT,
      neType: p.TYPE, homepart: p.HOMEPART === 1, wikidata: p.WIKIDATAID,
      status: ov?.status ?? (p.TYPE === 'Dependency' ? 'dependency' : 'integral'),
      nePop: p.POP_EST, nePopYear: p.POP_YEAR, neGdpMd: p.GDP_MD, neGdpYear: p.GDP_YEAR, idx: i,
    };
  });

  // Geometry: build a topology so shared arcs give land borders and unshared arcs give coastline.
  const fc = { type: 'FeatureCollection', features: feats.map((f, i) => ({ type: 'Feature', id: regions[i].id, properties: { name: regions[i].name }, geometry: f.geometry })) };
  const topo = topology({ regions: fc });
  const geoms = topo.objects.regions.geometries;
  const nb = neighbors(geoms);
  const arcUse = new Map();
  const collectArcs = (g, fn) => {
    const walk = (a) => (Array.isArray(a) ? a.forEach(walk) : fn(a < 0 ? ~a : a));
    walk(g.arcs || []);
  };
  geoms.forEach((g, i) => collectArcs(g, (a) => arcUse.set(a, (arcUse.get(a) || 0) + 1)));
  const arcLenKm = (a) => geoLength(feature(topo, { type: 'LineString', arcs: [a] })) * EARTH_R_KM;
  const gj = feature(topo, topo.objects.regions);
  regions.forEach((r, i) => {
    const f = gj.features[i];
    r.areaKm2 = Math.round(geoArea(f) * EARTH_R_KM ** 2);
    const c = geoCentroid(f);
    r.centroid = [+c[0].toFixed(3), +c[1].toFixed(3)];
    let coast = 0;
    collectArcs(geoms[i], (a) => { if (arcUse.get(a) === 1) coast += arcLenKm(a); });
    r.coastKm = Math.round(coast);
    r.landNeighbors = nb[i].map((j) => regions[j].id);
  });

  // Indicators
  const ind = {};
  for (const [field, [src, code]] of Object.entries(WDI)) { ind[field] = await wbIndicator(code, src); process.stdout.write('.'); }
  for (const [field, [, code]] of Object.entries(IMF)) {
    const raw = await imfIndicator(code);
    ind[field] = {};
    for (const [k, v] of Object.entries(raw)) ind[field][IMF_ALIAS[k] || k] = v;
    process.stdout.write('.');
  }
  ind.growthSd = await growthVolatility();
  const gov = await wikidataGov([...new Set(regions.map((r) => r.wikidata).filter(Boolean))]);
  console.log();

  // Aggregate member regions into entities.
  const entityIds = [...new Set(regions.map((r) => r.owner).filter(Boolean))].sort();
  const countries = entityIds.map((id) => {
    const members = regions.filter((r) => r.owner === id);
    const core = members.find((r) => r.dataCode === id) || members.find((r) => r.homepart) || members[0];
    const sov = Object.values(sovCore).find((s) => s.code === id);
    const status = members.map((m) => ENTITY_OVERRIDE[m.id]?.status).find(Boolean) || STATUS_BY_SOV[feats[core.idx].properties.SOV_A3] || 'recognized';
    return {
      id, name: sov?.name || core.name, status, wbRegion: core.wbRegion, continent: core.continent,
      regions: members.map((m) => m.id), fields: {}, members: [core, ...members.filter((m) => m !== core)],
    };
  });

  const allFields = { ...WDI, ...IMF, growthSd: ['WDI', 'NY.GDP.MKTP.KD.ZG (sd 2000-2019)', 'gavg'] };
  for (const c of countries) {
    // weights for averages: data population / GDP of each member (or NE estimate)
    const w = (m, key) => ind[key][m.dataCode]?.v ?? (key === 'pop' ? m.nePop : m.neGdpMd * 1e6) ?? 0;
    for (const [field, [src, , agg]] of Object.entries(allFields)) {
      const obs = c.members.map((m) => ({ m, o: ind[field][m.dataCode] })).filter((x) => x.o);
      if (!obs.length) continue;
      let v;
      if (agg === 'sum') v = obs.reduce((s, x) => s + x.o.v, 0);
      else {
        const key = agg === 'wavg' ? 'pop' : 'gdp';
        const tw = obs.reduce((s, x) => s + w(x.m, key), 0);
        v = tw > 0 ? obs.reduce((s, x) => s + x.o.v * w(x.m, key), 0) / tw : obs[0].o.v;
      }
      // core member's year represents the field; mixed years across members are rare (small dependencies)
      const y = (obs.find((x) => x.m === c.members[0]) || obs[0]).o.y;
      c.fields[field] = { v: +v.toPrecision(6), y, s: src };
    }
    // Fallbacks for population and GDP: Natural Earth estimates (e.g. Taiwan, N. Cyprus, Somaliland, W. Sahara).
    for (const [field, neKey, neYear, mult] of [['pop', 'nePop', 'nePopYear', 1], ['gdp', 'neGdpMd', 'neGdpYear', 1e6]]) {
      if (c.fields[field]) continue;
      const v = c.members.reduce((s, m) => s + (m[neKey] > 0 ? m[neKey] * mult : 0), 0);
      if (v > 0) c.fields[field] = { v, y: c.members[0][neYear], s: 'NE_EST' };
    }
    const wd = gov[c.members[0].wikidata];
    const ov = GOV_OVERRIDE[c.id];
    c.government = { ...(ov ? { form: ov[0], basis: ov[1] } : classifyGov(wd)), raw: wd ? `${wd.gov} | ${wd.kind}` : null, s: wd ? 'WD' : null };
    const core = c.members[0];
    c.geo = {
      areaKm2: c.members.reduce((s, m) => s + m.areaKm2, 0),
      coastKm: c.members.reduce((s, m) => s + m.coastKm, 0),
      coreCoastKm: core.coastKm,
      landlocked: core.coastKm === 0,
      centroid: core.centroid,
      s: 'DERIVED',
    };
  }

  // Imputation: regional median for fields still missing. Flagged with s: 'IMPUTED'.
  for (const field of Object.keys(allFields)) {
    if (NO_IMPUTE.has(field)) continue;
    for (const c of countries) {
      if (c.fields[field]) continue;
      const peers = countries.filter((d) => d.wbRegion === c.wbRegion && d.fields[field] && d.fields[field].s !== 'IMPUTED');
      const vals = peers.map((d) => d.fields[field].v).sort((a, b) => a - b);
      if (!vals.length) continue;
      let v = vals[vals.length >> 1];
      if (allFields[field][2] === 'sum') { // per-capita median scaled by own population, never copy an absolute
        const pc = peers.map((d) => d.fields[field].v / d.fields.pop.v).sort((a, b) => a - b);
        v = pc[pc.length >> 1] * (c.fields.pop?.v || 0);
      }
      c.fields[field] = { v: +v.toPrecision(6), y: REF_YEAR, s: 'IMPUTED' };
    }
  }

  // Cross-sectional income curves used by the demographic-transition model (descriptive, not causal):
  // countries with >= 500k people and non-imputed data, sorted by log PPP GDP per capita, split into 10 equal-count
  // bins; each knot = (median x, median y) of a bin. Non-parametric so the rich-country plateau is not extrapolated.
  const curve = (yField) => {
    const pts = countries.filter((c) => c.fields.pop?.v >= 5e5 && c.fields.gdpPpp && c.fields[yField] && c.fields[yField].s !== 'IMPUTED' && c.fields.gdpPpp.s !== 'IMPUTED')
      .map((c) => [Math.log(c.fields.gdpPpp.v / c.fields.pop.v), c.fields[yField].v]).sort((p, q) => p[0] - q[0]);
    const med = (xs) => { const t = xs.slice().sort((p, q) => p - q); const m = t.length >> 1; return t.length % 2 ? t[m] : (t[m - 1] + t[m]) / 2; };
    const knots = [];
    for (let i = 0; i < 10; i++) {
      const bin = pts.slice(Math.floor((i * pts.length) / 10), Math.floor(((i + 1) * pts.length) / 10));
      knots.push([+med(bin.map((p) => p[0])).toFixed(4), +med(bin.map((p) => p[1])).toFixed(3)]);
    }
    return { knots, n: pts.length, x: 'ln(PPP GDP per capita, current intl $)' };
  };
  const curves = { tfr: curve('tfr'), lifeExp: curve('lifeExp') };

  const coverage = {};
  for (const field of Object.keys(allFields)) {
    const by = {};
    for (const c of countries) by[c.fields[field]?.s ?? 'missing'] = (by[c.fields[field]?.s ?? 'missing'] || 0) + 1;
    coverage[field] = by;
  }

  const baseline = {
    meta: {
      referenceYear: REF_YEAR, minYear: MIN_YEAR, startDate: `${REF_YEAR + 1}-01-01`,
      generated: new Date().toISOString().slice(0, 10), sources: SOURCES,
      indicators: Object.fromEntries(Object.entries(allFields).map(([k, [s, code, agg]]) => [k, { source: s, code, agg }])),
      curves, coverage,
    },
    countries: countries.map(({ members, ...c }) => c),
    regions: regions.map(({ idx, nePop, nePopYear, neGdpMd, neGdpYear, ...r }) => r),
  };
  fs.writeFileSync(path.join(OUT, 'baseline.json'), JSON.stringify(baseline));
  fs.writeFileSync(path.join(OUT, 'world.topo.json'), JSON.stringify(quantize(topo, 1e5)));
  console.log(`countries=${countries.length} regions=${regions.length}`);
  console.log('curves', JSON.stringify(curves));
  for (const [k, v] of Object.entries(coverage)) console.log(k.padEnd(20), JSON.stringify(v));
}

main().catch((e) => { console.error(e); process.exit(1); });
