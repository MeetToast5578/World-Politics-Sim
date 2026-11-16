// Provinces (Natural Earth 1:10m admin-1, public domain): the units territory changes hands in, and the map's shapes.
// Population per province: each map region's population (Natural Earth POP_EST, scaled to the country's World Bank
// total) is shared among its provinces in proportion to their latest Wikidata population (P1082, via the province's
// Wikidata id). Provinces without a Wikidata figure get a fallback estimate,
//   urban share × (share of the region's city population, Natural Earth populated places)
//   + rural share × (0.2 area share + 0.8 city-population share),
// and the provinces with figures share the rest.
import { topology } from 'topojson-server';
import { neighbors, quantize } from 'topojson-client';
import { presimplify, simplify, quantile } from 'topojson-simplify';
import { geoArea, geoCentroid, geoContains } from 'd3-geo';

const EARTH_R_KM = 6371.0088;
// admin-1 units whose admin-0 code is not a map region: assigned to their sovereign's core region; others dropped
const ADM0_FIX = { ESB: 'GBR', WSB: 'GBR', GIB: 'GBR', USG: 'USA', UMI: 'USA', KAB: 'KAZ', CSI: 'AUS', CLP: 'FRA' };
const SIMPLIFY_QUANTILE = 0.12; // keep the 88% most significant points (by planar triangle area)

/** regions: built map regions (id, owner, nePop); countries: entities with fields.pop and fields.urban. */
/** Latest population (P1082) per Wikidata item, in batches (cached per batch). */
async function wikidataPop(cached, qids) {
  const out = {};
  for (let k = 0; k * 400 < qids.length; k++) {
    const ids = qids.slice(k * 400, k * 400 + 400);
    const q = `SELECT ?c ?pop ?t WHERE { VALUES ?c { ${ids.map((x) => 'wd:' + x).join(' ')} } ?c p:P1082 ?st . ?st ps:P1082 ?pop . OPTIONAL { ?st pq:P585 ?t } }`;
    const txt = await cached(`wd_adm1_pop_${k}.json`, 'https://query.wikidata.org/sparql', {
      method: 'POST', body: 'query=' + encodeURIComponent(q),
      headers: { Accept: 'application/sparql-results+json', 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    for (const b of JSON.parse(txt).results.bindings) {
      const id = b.c.value.split('/').pop(), t = b.t ? Date.parse(b.t.value) || 0 : 0, v = +b.pop.value;
      if (v > 0 && (!out[id] || t > out[id].t)) out[id] = { v, t };
    }
  }
  return out;
}

export async function buildProvinces(cached, regions, countries) {
  const read = async (name) => JSON.parse(await cached(`${name}.geojson`, `https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/${name}.geojson`));
  const adm1 = await read('ne_10m_admin_1_states_provinces');
  const places = await read('ne_10m_populated_places_simple');
  const regionIds = new Set(regions.map((r) => r.id));
  const feats = [];
  for (const f of adm1.features) {
    const a = f.properties.adm0_a3, region = regionIds.has(a) ? a : ADM0_FIX[a];
    if (!region || !f.geometry) continue;
    feats.push({ f, region });
  }
  feats.sort((x, y) => (x.region + x.f.properties.adm1_code).localeCompare(y.region + y.f.properties.adm1_code));
  const missing = regions.filter((r) => !feats.some((x) => x.region === r.id)).map((r) => r.id);
  if (missing.length) throw new Error('regions without provinces: ' + missing);

  // city population per province (bbox prefilter, then point in polygon)
  const cityPop = new Float64Array(feats.length);
  const boxes = feats.map(({ f }) => f.bbox ?? [-180, -90, 180, 90]);
  let unplaced = 0;
  for (const p of places.features) {
    const [lon, lat] = p.geometry.coordinates, pop = p.properties.pop_max > 0 ? p.properties.pop_max : 0;
    let k = -1;
    for (let i = 0; i < feats.length && k < 0; i++) {
      const b = boxes[i];
      if (lon >= b[0] && lon <= b[2] && lat >= b[1] && lat <= b[3] && geoContains(feats[i].f, [lon, lat])) k = i;
    }
    if (k >= 0) cityPop[k] += pop; else unplaced++;
  }
  const area = feats.map(({ f }) => geoArea(f) * EARTH_R_KM ** 2);
  const wdPop = await wikidataPop(cached, [...new Set(feats.map(({ f }) => f.properties.wikidataid).filter(Boolean))]);
  const wd = feats.map(({ f }) => wdPop[f.properties.wikidataid]?.v ?? 0);

  // region populations: Natural Earth estimate, scaled so a country's regions add up to its World Bank population
  const country = new Map(countries.map((c) => [c.id, c]));
  const regionPop = new Map();
  for (const c of countries) {
    const rs = regions.filter((r) => r.owner === c.id), tot = rs.reduce((s, r) => s + (r.nePop > 0 ? r.nePop : 0), 0);
    for (const r of rs) regionPop.set(r.id, tot > 0 ? (c.fields.pop.v * (r.nePop > 0 ? r.nePop : 0)) / tot : c.fields.pop.v / rs.length);
  }
  const w = new Float64Array(feats.length);
  for (const r of regions) {
    const idx = feats.map((x, i) => (x.region === r.id ? i : -1)).filter((i) => i >= 0);
    const P = regionPop.get(r.id) ?? 0, u = (country.get(r.owner)?.fields.urban?.v ?? 50) / 100;
    const A = idx.reduce((s, i) => s + area[i], 0), C = idx.reduce((s, i) => s + cityPop[i], 0);
    for (const i of idx) {
      const as = A > 0 ? area[i] / A : 1 / idx.length, cs = C > 0 ? cityPop[i] / C : as;
      w[i] = P * (u * cs + (1 - u) * (0.2 * as + 0.8 * cs)); // fallback estimate
    }
    // Wikidata figures where they exist; the fallback only for the rest
    const known = idx.filter((i) => wd[i] > 0), K = known.reduce((s, i) => s + wd[i], 0);
    const rest = P - idx.filter((i) => !(wd[i] > 0)).reduce((s, i) => s + w[i], 0);
    if (K > 0 && rest > 0) for (const i of known) w[i] = (rest * wd[i]) / K;
    else if (K > 0 && known.length === idx.length) for (const i of known) w[i] = (P * wd[i]) / K;
  }

  const fc = { type: 'FeatureCollection', features: feats.map(({ f }, i) => ({ type: 'Feature', id: i, properties: {}, geometry: f.geometry })) };
  let topo = topology({ provinces: fc }, 1e6);
  const nb = neighbors(topo.objects.provinces.geometries);
  topo = presimplify(topo);
  topo = quantize(simplify(topo, quantile(topo, SIMPLIFY_QUANTILE)), 1e5);
  const provinces = feats.map(({ f, region }, i) => {
    const c = geoCentroid(f);
    return {
      id: f.properties.adm1_code, name: f.properties.name_en || f.properties.name, region,
      pop: Math.round(w[i]), areaKm2: Math.round(area[i]), centroid: [+c[0].toFixed(2), +c[1].toFixed(2)], nb: nb[i],
    };
  });
  console.log(`provinces=${provinces.length} cities unplaced=${unplaced} wikidata population for ${wd.filter((v) => v > 0).length}`);
  return { provinces, topo };
}

