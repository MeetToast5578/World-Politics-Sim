// Data ingestion: downloads public datasets and writes the baseline world used by the engine.
//   public/data/world.topo.json   province geometry (Natural Earth 1:10m admin-1, simplified, public domain)
//   public/data/baseline.json     countries, regions, sourced indicators, fitted regressions
// Every country field is {v, y, s}: value, reference year, source id (see SOURCES).
// Run: npm run data                 -> baseline.json (reference year 2023) + world.topo.json
//      npm run data -- --year 2000   -> baseline-2000.json (for backtesting; same geometry and entities)
// Needs network; raw downloads are cached in .cache/.
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { topology } from 'topojson-server';
import { neighbors, feature, quantize } from 'topojson-client';
import { geoArea, geoLength, geoCentroid } from 'd3-geo';
import { buildProvinces } from './provinces.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const CACHE = path.join(ROOT, '.cache');
const OUT = path.join(ROOT, 'public', 'data');
fs.mkdirSync(CACHE, { recursive: true });
fs.mkdirSync(OUT, { recursive: true });

const yearArg = process.argv.indexOf('--year');
const REF_YEAR = yearArg > 0 ? Number(process.argv[yearArg + 1]) : 2023; // reference year; older observations accepted back to MIN_YEAR
const MIN_YEAR = REF_YEAR - 8;
const OUT_NAME = REF_YEAR === 2023 ? 'baseline.json' : `baseline-${REF_YEAR}.json`;
// Growth volatility window: the 20 years before the reference year, excluding the 2020 COVID shock.
const VOL_TO = Math.min(REF_YEAR - 1, 2019), VOL_FROM = VOL_TO - 19;
const AGE_GROUPS = ['0004', '0509', '1014', '1519', '2024', '2529', '3034', '3539', '4044', '4549', '5054', '5559', '6064', '6569', '7074', '7579', '80UP'];
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
  VDEM: { name: 'V-Dem v14 via Our World in Data: Electoral Democracy Index, Regimes of the World', url: 'https://ourworldindata.org/democracy', license: 'CC BY-SA 4.0 (V-Dem); derived fields of baseline.json inherit share-alike' },
  WRP: { name: 'World Religion Project, national data (Maoz & Henderson 2013), via Correlates of War', url: 'https://correlatesofwar.org/data-sets/world-religion-data/', license: 'Free for research use with citation (COW terms)' },
  PROXY: { name: 'Proxy: composition of a named related state (documented in DATA_SOURCES.md)', url: '', license: 'Model assumption' },
  CIA_WFB: { name: 'CIA World Factbook (South Sudan religion shares)', url: 'https://www.cia.gov/the-world-factbook/', license: 'Public domain' },
  ATOP: { name: 'Alliance Treaty Obligations and Provisions (ATOP) 5.1, Leeds et al.', url: 'http://www.atopdata.org/', license: 'Free for research use with citation (ATOP terms)' },
  UNGA: { name: 'UN General Assembly ideal points (Bailey, Strezhnev & Voeten), Harvard Dataverse doi:10.7910/DVN/LEJUQZ', url: 'https://dataverse.harvard.edu/dataset.xhtml?persistentId=doi:10.7910/DVN/LEJUQZ', license: 'CC0' },
  MID: { name: 'Correlates of War Dyadic Militarized Interstate Disputes 4.03 (to 2014)', url: 'https://correlatesofwar.org/data-sets/mids/', license: 'Free for research use with citation (COW terms)' },
  UCDP: { name: 'UCDP/PRIO Armed Conflict Dataset v26.1 and UCDP Battle-Related Deaths Dataset v26.1', url: 'https://ucdp.uu.se/downloads/', license: 'CC BY 4.0' },
  SIPRI: { name: 'SIPRI Yearbook 2023: World nuclear forces', url: 'https://www.sipri.org/yearbook/2023/07', license: 'Facts cited (list of nuclear-armed states)' },
  CURATED: { name: 'Curated from official sanctions lists (OFAC programmes, EU Sanctions Map, UK sanctions list, UN SC committees)', url: 'https://sanctionsmap.eu/', license: 'Facts compiled for this project' },
};

// --- Sanctions programmes (curated; the Global Sanctions Data Base requires registration) ---------------
// Only programmes with sectoral or economy-wide measures (plus Myanmar's post-2021-coup measures) are listed.
// intensity 1 = sectoral/comprehensive, 0.4 = targeted (individuals, arms, specific firms). 'UN' = all UN members.
const EU27 = ['AUT', 'BEL', 'BGR', 'HRV', 'CYP', 'CZE', 'DNK', 'EST', 'FIN', 'FRA', 'DEU', 'GRC', 'HUN', 'IRL', 'ITA', 'LVA', 'LTU', 'LUX', 'MLT', 'NLD', 'POL', 'PRT', 'ROU', 'SVK', 'SVN', 'ESP', 'SWE'];
const EU15 = ['AUT', 'BEL', 'DNK', 'FIN', 'FRA', 'DEU', 'GRC', 'IRL', 'ITA', 'LUX', 'NLD', 'PRT', 'ESP', 'SWE', 'GBR'];
const SANCTIONS = {
  2023: [
    { target: 'RUS', since: 2014, programme: 'Russia (Crimea 2014, invasion of Ukraine 2022)', senders: [['USA', 1], ['CAN', 1], ['GBR', 1], ...EU27.map((e) => [e, 1]), ['JPN', 1], ['AUS', 1], ['NZL', 1], ['NOR', 1], ['CHE', 1], ['ISL', 1], ['KOR', 0.4]] },
    { target: 'BLR', since: 2020, programme: 'Belarus (2020 election, support for the 2022 invasion)', senders: [['USA', 1], ['CAN', 1], ['GBR', 1], ...EU27.map((e) => [e, 1]), ['JPN', 0.4], ['AUS', 0.4], ['NOR', 1], ['CHE', 1]] },
    { target: 'IRN', since: 1995, programme: 'Iran (US comprehensive embargo; EU/UK/Canada/Australia targeted)', senders: [['USA', 1], ['CAN', 0.4], ['GBR', 0.4], ...EU27.map((e) => [e, 0.4]), ['AUS', 0.4]] },
    { target: 'PRK', since: 2006, programme: 'DPRK (UN Security Council resolution 1718 and successors)', senders: [['UN', 1]] },
    { target: 'SYR', since: 2011, programme: 'Syria (2011 crackdown)', senders: [['USA', 1], ['CAN', 1], ['GBR', 1], ...EU27.map((e) => [e, 1]), ['CHE', 1], ['AUS', 0.4]] },
    { target: 'VEN', since: 2017, programme: 'Venezuela (US financial and oil sanctions; others targeted)', senders: [['USA', 1], ['CAN', 0.4], ['GBR', 0.4], ...EU27.map((e) => [e, 0.4]), ['CHE', 0.4]] },
    { target: 'CUB', since: 1962, programme: 'Cuba (US embargo)', senders: [['USA', 1]] },
    { target: 'MMR', since: 2021, programme: 'Myanmar (2021 coup)', senders: [['USA', 0.4], ['CAN', 0.4], ['GBR', 0.4], ...EU27.map((e) => [e, 0.4]), ['AUS', 0.4]] },
  ],
  2000: [
    { target: 'IRQ', since: 1990, programme: 'Iraq (UN Security Council resolution 661 and successors)', senders: [['UN', 1]] },
    { target: 'CUB', since: 1962, programme: 'Cuba (US embargo)', senders: [['USA', 1]] },
    { target: 'IRN', since: 1995, programme: 'Iran (US embargo, Iran and Libya Sanctions Act 1996)', senders: [['USA', 1]] },
    { target: 'LBY', since: 1986, programme: 'Libya (US embargo; UN measures suspended 1999)', senders: [['USA', 1]] },
    { target: 'SDN', since: 1997, programme: 'Sudan (US embargo 1997)', senders: [['USA', 1]] },
    { target: 'PRK', since: 1950, programme: 'North Korea (US Trading with the Enemy Act)', senders: [['USA', 1]] },
    { target: 'MMR', since: 1997, programme: 'Myanmar (US 1997, EU 1996)', senders: [['USA', 0.4], ...EU15.map((e) => [e, 0.4])] },
    { target: 'SRB', since: 1998, programme: 'Federal Republic of Yugoslavia (Kosovo, 1998; EU/US)', senders: [['USA', 1], ...EU15.map((e) => [e, 1])] },
  ],
};
// Alliance membership changes after ATOP 5.1's last year (2018), applied when the reference year reaches them.
const ALLIANCE_UPDATES = [
  { year: 2020, treaty: 'NATO', add: 'MKD', note: 'North Macedonia joined NATO, 27 March 2020' },
  { year: 2020, treaty: 'EU mutual defence (TEU 42.7)', remove: 'GBR', note: 'United Kingdom left the EU, 31 January 2020' },
  { year: 2023, treaty: 'NATO', add: 'FIN', note: 'Finland joined NATO, 4 April 2023' },
];

// Religion categories of the World Religion Project, in model order: [WRP pct column, label, family].
const RELIGIONS = [
  ['chrstcatpct', 'Catholic', 'Christianity'], ['chrstprotpct', 'Protestant', 'Christianity'], ['chrstorthpct', 'Orthodox Christian', 'Christianity'],
  ['chrstangpct', 'Anglican', 'Christianity'], ['chrstothrpct', 'Other Christian', 'Christianity'],
  ['islmsunpct', 'Sunni', 'Islam'], ['islmshipct', 'Shia', 'Islam'], ['islmibdpct', 'Ibadi', 'Islam'], ['islmalwpct', 'Alawite', 'Islam'],
  ['islmahmpct', 'Ahmadiyya', 'Islam'], ['islmnatpct', 'Nation of Islam', 'Islam'], ['islmothrpct', 'Other Muslim', 'Islam'],
  ['judorthpct', 'Orthodox Jewish', 'Judaism'], ['judconspct', 'Conservative Jewish', 'Judaism'], ['judrefpct', 'Reform Jewish', 'Judaism'], ['judothrpct', 'Other Jewish', 'Judaism'],
  ['budmahpct', 'Mahayana', 'Buddhism'], ['budthrpct', 'Theravada', 'Buddhism'], ['budothrpct', 'Other Buddhist', 'Buddhism'],
  ['hindgenpct', 'Hindu', 'Hinduism'], ['sikhgenpct', 'Sikh', 'Sikhism'], ['jaingenpct', 'Jain', 'Jainism'], ['shntgenpct', 'Shinto', 'Shinto'],
  ['taogenpct', 'Taoist', 'Taoism'], ['confgenpct', 'Confucian', 'Confucianism'], ['bahgenpct', "Baha'i", "Baha'i"], ['zorogenpct', 'Zoroastrian', 'Zoroastrianism'],
  ['syncgenpct', 'Syncretic', 'Syncretic'], ['anmgenpct', 'Animist / folk', 'Folk religion'], ['othrgenpct', 'Other religion', 'Other'], ['nonreligpct', 'Non-religious', 'None'],
];
const FAMILY_TOTAL = { Christianity: 'chrstgenpct', Islam: 'islmgenpct', Judaism: 'judgenpct', Buddhism: 'budgenpct' };
// COW abbreviations whose country name does not match ours (2010 states); others match by name.
const COW_FIX = { BHM: 'BHS', SLU: 'LCA', SVG: 'VCT', AAB: 'ATG', SKN: 'KNA', CZR: 'CZE', MAC: 'MKD', YUG: 'SRB', CAP: 'CPV', STP: 'STP', CON: 'COG', TAZ: 'TZA', SWA: 'SWZ' };
// Entities absent from WRP: proxy state (documented) or a cited source.
const RELIGION_PROXY = { SOL: 'SOM', CYN: 'TUR', PSE: 'JOR', ESH: 'MAR' };
// South Sudan (independent 2011): CIA World Factbook 2020 est. Christian 60.5%, folk 32.9%, Muslim 6.2%, other 0.4%;
// denominations within Christianity and Islam are not given, so they go to 'Other Christian' / 'Other Muslim'.
const RELIGION_FIXED = {
  SSD: { s: 'CIA_WFB', y: 2020, shares: { chrstothrpct: 0.605, anmgenpct: 0.329, islmothrpct: 0.062, othrgenpct: 0.004 } },
  VAT: { s: 'PROXY', y: 2010, shares: { chrstcatpct: 1 } }, // the Holy See: Catholic by definition
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
  netMigration: ['WDI', 'SM.POP.NETM', 'sum', 'mean'], // mean over the window: single years carry episodic flows (wars, returns)
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
  gdpReal: ['WDI', 'NY.GDP.MKTP.KD', 'sum'],
  femaleShare: ['WDI', 'SP.POP.TOTL.FE.ZS', 'wavg'],
  srb: ['WDI', 'SP.POP.BRTH.MF', 'wavg'],
  // SP.ADO.TFRT (adolescent fertility) would pin the fertility schedule's timing, but the API returns HTTP 400 for it (Nov 2026).
  lifeExpF: ['WDI', 'SP.DYN.LE00.FE.IN', 'wavg'],
  lifeExpM: ['WDI', 'SP.DYN.LE00.MA.IN', 'wavg'],
  u5mrF: ['WDI', 'SH.DYN.MORT.FE', 'wavg'],
  u5mrM: ['WDI', 'SH.DYN.MORT.MA', 'wavg'],
  oilRents: ['WDI', 'NY.GDP.PETR.RT.ZS', 'gavg'],
  gasRents: ['WDI', 'NY.GDP.NGAS.RT.ZS', 'gavg'],
  coalRents: ['WDI', 'NY.GDP.COAL.RT.ZS', 'gavg'],
  mineralRents: ['WDI', 'NY.GDP.MINR.RT.ZS', 'gavg'],
  // 5-year age groups, % of the female / male population
  ...Object.fromEntries(AGE_GROUPS.flatMap((g) => [[`f${g}`, ['WDI', `SP.POP.${g}.FE.5Y`, 'wavg']], [`m${g}`, ['WDI', `SP.POP.${g}.MA.5Y`, 'wavg']]])),
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
// Resource rents: missing almost always means no extraction (small islands, city states); a regional median would invent oil.
// gdpReal is only a backtest target.
const NO_IMPUTE = new Set(['armedForces', 'netMigration', 'milexShare', 'oilRents', 'gasRents', 'coalRents', 'mineralRents', 'gdpReal']);

// --- V-Dem via Our World in Data (ISO codes; a few OWID-specific codes) ----------------
const OWID_CODE = { OWID_KOS: 'XKX', OWID_SML: 'SOL' };
const ROW = { 'Closed autocracy': 0, 'Electoral autocracy': 1, 'Electoral democracy': 2, 'Liberal democracy': 3 };
async function vdem() {
  const parse = (txt) => txt.trim().split('\n').slice(1).map((l) => l.split(','));
  const edi = parse(await cached('owid_edi.csv', 'https://ourworldindata.org/grapher/electoral-democracy-index.csv?v=1&csvType=full&useColumnShortNames=true'));
  const row = parse(await cached('owid_row.csv', 'https://ourworldindata.org/grapher/political-regime.csv?v=1&csvType=full&useColumnShortNames=true'));
  const code = (r) => OWID_CODE[r[1]] || r[1] || (r[0] === 'Palestine/West Bank' ? 'PSE' : null);
  const latest = (rows, val) => {
    const out = {};
    for (const r of rows) {
      const c = code(r), y = +r[2], v = val(r[3]);
      if (!c || y > REF_YEAR || y < MIN_YEAR || v == null || Number.isNaN(v)) continue;
      if (!out[c] || y > out[c].y) out[c] = { v, y };
    }
    return out;
  };
  // base rates over the 23 years before the reference year: Regimes-of-the-World category changes per country-year,
  // and the median absolute yearly change of the democracy index
  const series = {};
  for (const r of row) { const c = code(r), y = +r[2]; if (c && y >= REF_YEAR - 23 && y <= REF_YEAR) (series[c] ??= {})[y] = ROW[r[3]]; }
  let changes = 0, cy = 0, cross = 0;
  for (const s of Object.values(series)) for (let y = REF_YEAR - 22; y <= REF_YEAR; y++) if (s[y] != null && s[y - 1] != null) {
    cy++; if (s[y] !== s[y - 1]) changes++; if ((s[y] >= 2) !== (s[y - 1] >= 2)) cross++;
  }
  const ediS = {};
  for (const r of edi) { const c = code(r), y = +r[2]; if (c && y >= REF_YEAR - 23 && y <= REF_YEAR) (ediS[c] ??= {})[y] = +r[3]; }
  const dif = [];
  for (const s of Object.values(ediS)) for (let y = REF_YEAR - 22; y <= REF_YEAR; y++) if (s[y] != null && s[y - 1] != null) dif.push(Math.abs(s[y] - s[y - 1]));
  dif.sort((a, b) => a - b);
  // the same democracy/autocracy rule the model uses (index crossing 0.50 upward, 0.46 downward) applied to real data
  let ruleCross = 0, ruleCy = 0;
  for (const s of Object.values(ediS)) {
    let dem = null;
    for (let y = REF_YEAR - 23; y <= REF_YEAR; y++) {
      if (s[y] == null) continue;
      if (dem === null) { dem = s[y] >= 0.48; continue; }
      ruleCy++; const nd = dem ? s[y] >= 0.46 : s[y] > 0.5; if (nd !== dem) ruleCross++; dem = nd;
    }
  }
  return {
    edi: latest(edi, Number), row: latest(row, (s) => ROW[s]),
    baseRates: { window: `${REF_YEAR - 22}-${REF_YEAR}`, regimeChangePerCountryYear: +(changes / cy).toFixed(4), democracyBoundaryPerCountryYear: +(cross / cy).toFixed(4), indexRuleCrossingsPerCountryYear: +(ruleCross / ruleCy).toFixed(4), demoAbsChangeMedian: +dif[dif.length >> 1].toFixed(4), demoAbsChangeP90: +dif[Math.floor(dif.length * 0.9)].toFixed(4) },
  };
}

// --- Correlates of War code crosswalk (abbreviation and number -> our id) ------------------
async function cowCrosswalk(countries) {
  const cowNames = {}, numToAbb = {};
  for (const l of (await cached('COW-country-codes.csv', 'https://correlatesofwar.org/wp-content/uploads/COW-country-codes.csv')).split(/\r?\n|\r/).slice(1)) {
    const [abb, num, name] = l.split(','); if (abb) { cowNames[abb] = name; numToAbb[+num] = abb; }
  }
  const norm = (s) => s.toLowerCase().replace(/[^a-z]/g, '');
  const byName = new Map(countries.map((c) => [norm(c.name), c.id]));
  const abb = (a) => COW_FIX[a] || byName.get(norm(cowNames[a] || '')) || (countries.some((c) => c.id === a) ? a : null);
  return { abb, num: (n) => (numToAbb[+n] ? abb(numToAbb[+n]) : null), name: (a) => cowNames[a] };
}

// --- ATOP defence treaties ----------------------------------------------------------------
async function alliances(countries) {
  const zip = path.join(CACHE, 'atop5_1_csv.zip');
  if (!fs.existsSync(zip)) {
    const r = await fetch('https://www.atopdata.org/uploads/6/9/1/3/69134503/atop_5.1__.csv_.zip', { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(120000) });
    if (!r.ok) throw new Error(`ATOP download ${r.status}`);
    fs.writeFileSync(zip, Buffer.from(await r.arrayBuffer()));
  }
  const read = (f) => execFileSync('unzip', ['-p', zip, `ATOP 5.1 (.csv)/${f}`], { maxBuffer: 1 << 28 }).toString();
  const parse = (txt) => { const [h, ...rows] = txt.trim().split(/\r?\n/); const k = h.split(','); return rows.map((l) => Object.fromEntries(l.split(',').map((v, i) => [k[i], v]))); };
  const cw = await cowCrosswalk(countries);
  const Y = Math.min(REF_YEAR, 2018), yr = (x) => +x || 0;
  const mem = parse(read('atop5_1m.csv')).filter((r) => r.defense === '1');
  const founded = {};
  for (const r of mem) founded[r.atopid] = Math.min(founded[r.atopid] ?? 9999, yr(r.yrent));
  const activeAt = (r, y) => yr(r.yrent) <= y && (yr(r.yrexit) === 0 || yr(r.yrexit) > y);
  const treaties = {};
  for (const r of mem) {
    if (!activeAt(r, Y)) continue;
    const id = cw.num(r.member);
    if (!id) continue;
    (treaties[r.atopid] ??= { id: `ATOP${r.atopid}`, since: founded[r.atopid], members: new Set() }).members.add(id);
  }
  // name treaties only where membership identifies them unambiguously
  for (const t of Object.values(treaties)) {
    const m = t.members;
    if (m.has('USA') && m.has('CAN') && m.has('GBR') && m.has('TUR')) t.label = 'NATO';
    else if (m.has('IRL') && m.has('AUT') && m.has('FRA') && !m.has('USA') && m.size >= 20) t.label = 'EU mutual defence (TEU 42.7)';
  }
  const notes = [];
  for (const u of ALLIANCE_UPDATES) {
    if (u.year > REF_YEAR) continue;
    const t = Object.values(treaties).find((x) => x.label === u.treaty);
    if (!t) throw new Error('alliance update: treaty not found ' + u.treaty);
    if (u.add) t.members.add(u.add); if (u.remove) t.members.delete(u.remove);
    notes.push(u.note);
  }
  // base rates over the 18 years up to Y: accessions to existing treaties, exits, new treaties
  let acc = 0, exits = 0, fresh = new Set();
  for (const r of mem) {
    const e = yr(r.yrent), x = yr(r.yrexit);
    if (e >= Y - 17 && e <= Y) { if (e > founded[r.atopid]) acc++; else fresh.add(r.atopid); }
    if (x >= Y - 17 && x <= Y) exits++;
  }
  const list = Object.values(treaties).filter((t) => t.members.size >= 2).map((t) => ({ ...t, members: [...t.members].sort() }));
  return {
    treaties: list, notes, atopYear: Y,
    rates: { window: `${Y - 17}-${Y}`, accessionsPerYear: +(acc / 18).toFixed(3), exitsPerYear: +(exits / 18).toFixed(3), newTreatiesPerYear: +(fresh.size / 18).toFixed(3) },
  };
}

// --- Conflict history -> initial grievance between pairs ------------------------------------------
// Each dispute-year adds a hostility weight, decayed by age with the model's grievance memory (15 years):
// MIDs (COW) for years up to 2014, UCDP interstate conflicts for later years (no double counting).
const MID_WEIGHT = { 2: 0.05, 3: 0.1, 4: 0.3, 5: 1.0 };   // threat, display, use of force, war (assumption)
const UCDP_WEIGHT = { 1: 0.5, 2: 1.5 };                    // minor (25-999 deaths/yr), war (1000+) (assumption)
const GW_FIX = { 678: 'YEM', 260: 'DEU', 340: 'SRB' };     // Gleditsch-Ward codes that differ from COW numbers
const unz = async (name, url, entry) => {
  const zip = path.join(CACHE, name);
  if (!fs.existsSync(zip)) { const r = await fetch(url, { signal: AbortSignal.timeout(120000) }); if (!r.ok) throw new Error(`${r.status} ${url}`); fs.writeFileSync(zip, Buffer.from(await r.arrayBuffer())); }
  return execFileSync('unzip', ['-p', zip, entry], { maxBuffer: 1 << 28 }).toString();
};
const csvRows = (txt) => {
  const lines = txt.trim().split(/\r?\n/), split = (l) => [...l.matchAll(/("([^"]*)"|[^,]*)(,|$)/g)].map((m) => m[2] ?? m[1]).slice(0, -1);
  const h = split(lines[0]);
  return lines.slice(1).map((l) => Object.fromEntries(split(l).map((v, i) => [h[i], v])));
};
const ucdpAcd = async () => csvRows(await unz('ucdp_acd_261.zip', 'https://ucdp.uu.se/downloads/ucdpprio/ucdp-prio-acd-261-csv.zip', 'UcdpPrioConflict_v26_1.csv'));
async function conflictHistory(countries) {
  const cw = await cowCrosswalk(countries);
  const g = new Map(), add = (a, b, w, y) => {
    if (!a || !b || a === b || y > REF_YEAR) return;
    const k = [a, b].sort().join('-');
    g.set(k, (g.get(k) ?? 0) + w * Math.exp(-(REF_YEAR - y) / 15));
  };
  const mids = csvRows(await unz('dyadic_mid403.zip', 'https://correlatesofwar.org/wp-content/uploads/dyadic_mid_4.03_update.zip', 'dyadic_mid_4.03_update/dyadic_mid_4.03.csv'));
  for (const r of mids) if (+r.year >= REF_YEAR - 45) add(cw.num(r.statea), cw.num(r.stateb), MID_WEIGHT[+r.hihost] ?? 0, +r.year);
  const ucdp = await ucdpAcd();
  const gw = (x) => GW_FIX[+x] ?? cw.num(x);
  for (const r of ucdp) {
    if (r.type_of_conflict !== '2' || +r.year <= 2014) continue;
    for (const a of r.gwno_a.split(',')) for (const b of r.gwno_b.split(',')) add(gw(a.trim()), gw(b.trim()), UCDP_WEIGHT[+r.intensity_level] ?? 0, +r.year);
  }
  return [...g.entries()].filter(([, v]) => v >= 0.05).map(([k, v]) => { const [a, b] = k.split('-'); return { a, b, g: +v.toFixed(3) }; });
}

// --- UCDP armed conflicts: conflicts under way at the reference year, base rates, battle deaths ----------------
// Nuclear-armed states (SIPRI Yearbook 2023; Israel's arsenal is undeclared but documented there).
const NUCLEAR = ['USA', 'RUS', 'CHN', 'FRA', 'GBR', 'IND', 'PAK', 'ISR', 'PRK'];
async function conflicts(countries) {
  const cw = await cowCrosswalk(countries), gw = (x) => GW_FIX[+x] ?? cw.num(x);
  const ids = (list) => [...new Set(list.split(',').map((x) => x.trim()).filter(Boolean).map(gw).filter(Boolean))];
  const acd = await ucdpAcd();
  const brd = csvRows(await unz('ucdp_brd_261.zip', 'https://ucdp.uu.se/downloads/brd/ucdp-brd-conf-261-csv.zip', 'BattleDeaths_v26_1_conf.csv'));
  const deaths = new Map(brd.map((r) => [`${r.conflict_id}|${r.year}`, +r.bd_best]));
  const W1 = REF_YEAR, W0 = REF_YEAR - 33, D0 = Math.max(1989, W0); // battle deaths are recorded from 1989
  const q = (a, ps) => { a = a.slice().sort((x, y) => x - y); return Object.fromEntries(ps.map((p) => [`q${Math.round(p * 100)}`, +(a[Math.floor(p * (a.length - 1))] ?? NaN).toFixed(2)])); };
  // interstate: episodes (conflict id + episode start), durations from episode start to end date
  const eps = new Map();
  for (const r of acd) {
    if (+r.year > W1) continue;
    const k = `${r.conflict_id}|${r.start_date2}`, e = eps.get(k) ?? { r, years: [], end: null };
    e.years.push(+r.year); if (r.ep_end === '1') e.end = r.ep_end_date; eps.set(k, e);
  }
  const inter = [...eps.values()].filter((e) => e.r.type_of_conflict === '2' && +e.r.start_date2.slice(0, 4) >= W0);
  const interDur = inter.filter((e) => e.end).map((e) => (Date.parse(e.end) - Date.parse(e.r.start_date2)) / 864e5 / 365.25);
  // internal conflicts at country level: a spell is a run of consecutive calendar years with any internal conflict
  const byLoc = new Map();
  for (const r of acd) {
    if (!['3', '4'].includes(r.type_of_conflict) || +r.year > W1) continue;
    for (const g of ids(r.gwno_loc)) { const m = byLoc.get(g) ?? new Map(); m.set(+r.year, [...(m.get(+r.year) ?? []), r]); byLoc.set(g, m); }
  }
  const spells = [];
  for (const [loc, m] of byLoc) {
    const ys = [...m.keys()].sort((a, b) => a - b);
    let start = ys[0];
    for (let i = 0; i < ys.length; i++) if (i === ys.length - 1 || ys[i + 1] > ys[i] + 1) { spells.push({ loc, start, last: ys[i] }); start = ys[i + 1]; }
  }
  const civOn = spells.filter((s) => s.start >= W0);
  const civLen = civOn.filter((s) => s.last < W1).map((s) => s.last - s.start + 1);
  const bdYears = (types) => brd.filter((r) => types.includes(r.type_of_conflict) && +r.year >= D0 && +r.year <= W1).map((r) => +r.bd_best);
  // the model has one civil conflict per country: battle deaths summed over a country's internal conflicts per year
  const bdCountry = (() => {
    const m = new Map();
    for (const r of brd) if (['3', '4'].includes(r.type_of_conflict) && +r.year >= D0 && +r.year <= W1) for (const g of ids(r.gwno_loc)) m.set(`${g}|${r.year}`, (m.get(`${g}|${r.year}`) ?? 0) + +r.bd_best);
    return [...m.values()];
  })();
  // last year of internal conflict per country (conflict-trap memory at the start)
  const lastCivil = {};
  for (const sp of spells) if (sp.last < W1) lastCivil[sp.loc] = Math.max(lastCivil[sp.loc] ?? 0, sp.last);
  // under way at the reference year (active that year and the episode not ended within it)
  const active = [];
  for (const e of eps.values()) {
    const r = acd.find((x) => x.conflict_id === e.r.conflict_id && x.start_date2 === e.r.start_date2 && +x.year === W1);
    if (!r || e.r.type_of_conflict !== '2' || (r.ep_end === '1')) continue;
    const a = ids(r.gwno_a), b = ids(r.gwno_b);
    if (a.length && b.length) active.push({ kind: 'interstate', a, b, loc: b[0], start: e.r.start_date2, goal: r.incompatibility === '2' ? 'government' : 'territory', deaths: deaths.get(`${r.conflict_id}|${W1}`) ?? 25, name: r.territory_name || null, intensity: +r.intensity_level });
  }
  for (const s of spells.filter((x) => x.last === W1)) {
    const rows = byLoc.get(s.loc).get(W1).filter((r) => !(r.ep_end === '1' && !byLoc.get(s.loc).has(W1 + 1)));
    if (!rows.length) continue;
    const d = rows.map((r) => deaths.get(`${r.conflict_id}|${W1}`) ?? 25), main = rows[d.indexOf(Math.max(...d))];
    const small = (list) => { const x = ids(list); return x.length <= 4 ? x : []; }; // large coalitions (e.g. against IS) are not modelled as belligerents
    active.push({
      kind: 'civil', a: [s.loc, ...new Set(rows.flatMap((r) => small(r.gwno_a_2nd)))].filter((v, i, arr) => arr.indexOf(v) === i), b: [...new Set(rows.flatMap((r) => small(r.gwno_b_2nd)))].filter((x) => x !== s.loc),
      loc: s.loc, start: `${s.start}-01-01`, goal: rows.some((r) => r.incompatibility !== '1') ? 'government' : 'territory',
      deaths: d.reduce((x, y) => x + y, 0), name: (() => { const g = main.side_b.split(',').map((x) => x.trim()); return g.length > 3 ? `${g.slice(0, 2).join(', ')} and others` : g.join(', '); })(), intensity: Math.max(...rows.map((r) => +r.intensity_level)),
    });
  }
  return {
    window: `${W0}-${W1}`, deathsWindow: `${D0}-${W1}`, nuclear: NUCLEAR.filter((x) => countries.some((c) => c.id === x)),
    interstate: { onsetsPerYear: +(inter.length / (W1 - W0 + 1)).toFixed(3), durationYears: q(interDur, [0.25, 0.5, 0.75, 0.9]), deaths: q(bdYears(['2']), [0.5, 0.75, 0.9, 0.99]) },
    civil: { onsetsPerYear: +(civOn.length / (W1 - W0 + 1)).toFixed(3), spellYears: q(civLen, [0.25, 0.5, 0.75, 0.9]), deaths: q(bdYears(['3', '4']), [0.5, 0.75, 0.9, 0.99]), countryDeaths: q(bdCountry, [0.5, 0.75, 0.9, 0.99]), lastYear: lastCivil,
      activeCountries: +(Array.from({ length: W1 - W0 + 1 }, (_, i) => [...byLoc.values()].filter((m) => m.has(W0 + i)).length).reduce((x, y) => x + y, 0) / (W1 - W0 + 1)).toFixed(1) },
    battleDeathsPerYear: Math.round(brd.filter((r) => +r.year >= D0 && +r.year <= W1).reduce((x, r) => x + +r.bd_best, 0) / (W1 - D0 + 1)),
    active,
  };
}

// --- UN General Assembly ideal points (foreign-policy position) ----------------------------
async function ungaIdeal() {
  const txt = await cached('unga_ideal.csv', 'https://dataverse.harvard.edu/api/access/datafile/14098429');
  const [h, ...rows] = txt.trim().split(/\r?\n/);
  const k = h.split(',').map((x) => x.replace(/"/g, '')), iIso = k.indexOf('iso3c'), iY = k.indexOf('year'), iV = k.indexOf('IdealPointFP');
  const out = {};
  for (const l of rows) {
    const r = l.split(',').map((x) => x.replace(/"/g, ''));
    const iso = r[iIso], y = +r[iY], v = +r[iV];
    if (!iso || iso === 'NA' || y > REF_YEAR || y < MIN_YEAR || !Number.isFinite(v)) continue;
    if (!out[iso] || y > out[iso].y) out[iso] = { v, y };
  }
  return out;
}

// --- World Religion Project (COW codes) ----------------------------------------------
async function religion(countries) {
  const lines = (await cached('WRP_national.csv', 'https://correlatesofwar.org/wp-content/uploads/WRP_national.csv')).trim().split('\n');
  const head = lines[0].split(','), col = Object.fromEntries(head.map((h, i) => [h, i]));
  const cw = await cowCrosswalk(countries);
  const year = [...new Set(lines.slice(1).map((l) => +l.split(',')[0]))].filter((y) => y <= REF_YEAR).sort((a, b) => b - a)[0];
  const out = {};
  // rows of the reference WRP year first; states that did not exist yet (e.g. Montenegro, Timor-Leste in 2000) take
  // their own earliest later observation, flagged by its year
  const rows = lines.slice(1).map((l) => l.split(',')).filter((r) => +r[0] >= year)
    .sort((a, b) => (+a[0] === year ? 0 : +a[0]) - (+b[0] === year ? 0 : +b[0]));
  for (const r of rows) {
    const id = cw.abb(r[2]);
    if (!id) { if (+r[0] === year) console.warn('WRP: unmatched', r[2], cw.name(r[2])); continue; }
    if (out[id]) continue;
    const sh = RELIGIONS.map(([k]) => +r[col[k]] || 0);
    // a family total above the sum of its denominations goes to that family's "other" category
    for (const [fam, tot] of Object.entries(FAMILY_TOTAL)) {
      const idx = RELIGIONS.map((x, i) => (x[2] === fam ? i : -1)).filter((i) => i >= 0);
      const gap = (+r[col[tot]] || 0) - idx.reduce((s, i) => s + sh[i], 0);
      if (gap > 0) sh[idx[idx.length - 1]] += gap;
    }
    const tot = sh.reduce((a, b) => a + b, 0);
    out[id] = { s: 'WRP', y: +r[0], reliability: r[col.reliabilevel], shares: sh.map((x) => +(x / tot).toFixed(5)) };
  }
  for (const [id, f] of Object.entries(RELIGION_FIXED)) out[id] = { s: f.s, y: f.y, shares: RELIGIONS.map(([k]) => f.shares[k] || 0) };
  for (const [id, src] of Object.entries(RELIGION_PROXY)) if (out[src]) out[id] = { ...out[src], s: 'PROXY', proxy: src };
  return { year, byId: out };
}

const cachedSync = (name) => (fs.existsSync(path.join(CACHE, name)) ? fs.readFileSync(path.join(CACHE, name), 'utf8') : null);
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
async function wbIndicator(code, source, stat = 'latest', from = MIN_YEAR, to = REF_YEAR) {
  const src = source === 'WGI' ? '&source=3' : '&source=2'; // explicit source avoids slow/hanging API routes
  const url = (d) => `https://api.worldbank.org/v2/country/all/indicator/${code}?format=json&per_page=20000&date=${d}${src}`;
  let rows;
  try {
    rows = JSON.parse(await cached(`wb_${code}_${from}_${to}.json`, url(`${from}:${to}`)))[1] || [];
  } catch {
    // some series return 502 for multi-year ranges; fall back to one request per year
    rows = [];
    for (let y = to; y >= from; y--) rows.push(...(JSON.parse(await cached(`wb_${code}_${y}.json`, url(y)))[1] || []));
  }
  const best = {}, sum = {}; // iso3 -> {v, y}
  for (const r of rows) {
    const iso = r.countryiso3code || WB_NAME_FIX[r.country.value];
    if (!iso || r.value == null) continue;
    const y = +r.date;
    if (!best[iso] || y > best[iso].y) best[iso] = { v: r.value, y };
    (sum[iso] ??= []).push(r.value);
  }
  if (stat === 'mean') for (const iso of Object.keys(best)) best[iso].v = sum[iso].reduce((a, b) => a + b, 0) / sum[iso].length;
  return best;
}

// Standard deviation of annual real GDP growth over VOL_FROM..VOL_TO (excludes the COVID shock). Needs >= 10 observations.
async function growthVolatility() {
  const txt = await cached(`wb_growth_${VOL_FROM}_${VOL_TO}.json`, `https://api.worldbank.org/v2/country/all/indicator/NY.GDP.MKTP.KD.ZG?format=json&per_page=20000&date=${VOL_FROM}:${VOL_TO}&source=2`);
  const by = {};
  for (const r of JSON.parse(txt)[1] || []) if (r.countryiso3code && r.value != null) (by[r.countryiso3code] ??= []).push(r.value);
  const out = {};
  for (const [iso, xs] of Object.entries(by)) {
    if (xs.length < 10) continue;
    const m = xs.reduce((a, b) => a + b, 0) / xs.length;
    out[iso] = { v: Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1)), y: VOL_TO };
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
  // fetch World Bank series 6 at a time (the API is slow per request, not rate-limited at this level)
  const queue = Object.entries(WDI);
  await Promise.all(Array.from({ length: 6 }, async () => {
    for (let job = queue.shift(); job; job = queue.shift()) { const [field, [src, code, , stat]] = job; ind[field] = await wbIndicator(code, src, stat); process.stdout.write('.'); }
  }));
  for (const [field, [, code]] of Object.entries(IMF)) {
    const raw = await imfIndicator(code);
    ind[field] = {};
    for (const [k, v] of Object.entries(raw)) ind[field][IMF_ALIAS[k] || k] = v;
    process.stdout.write('.');
  }
  ind.growthSd = await growthVolatility();
  const vd = await vdem();
  ind.vdemEdi = vd.edi; ind.regimeRow = vd.row;
  ind.unIdeal = await ungaIdeal();
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

  const allFields = {
    ...WDI, ...IMF, growthSd: ['WDI', `NY.GDP.MKTP.KD.ZG (sd ${VOL_FROM}-${VOL_TO})`, 'gavg'],
    // political fields come from the core territory only (China's regime is not averaged with Hong Kong's)
    vdemEdi: ['VDEM', 'electdem_vdem (v2x_polyarchy)', 'core'], regimeRow: ['VDEM', 'regime_row_owid (v2x_regime)', 'core'],
    unIdeal: ['UNGA', 'IdealPointFP', 'core'],
  };
  for (const c of countries) {
    // weights for averages: data population / GDP of each member (or NE estimate)
    const w = (m, key) => ind[key][m.dataCode]?.v ?? (key === 'pop' ? m.nePop : m.neGdpMd * 1e6) ?? 0;
    for (const [field, [src, , agg]] of Object.entries(allFields)) {
      const obs = (agg === 'core' ? c.members.slice(0, 1) : c.members).map((m) => ({ m, o: ind[field][m.dataCode] })).filter((x) => x.o);
      if (!obs.length) continue;
      let v;
      if (agg === 'sum') v = obs.reduce((s, x) => s + x.o.v, 0);
      else if (agg === 'core') v = obs[0].o.v;
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
  const curves = Object.fromEntries(['tfr', 'lifeExpF', 'lifeExpM', 'u5mrF', 'u5mrM', 'agriShare', 'industryShare', 'investment'].map((k) => [k, curve(k)]));

  // Curve drift: the same binned curves from a cross-section EARLY_YEAR = REF_YEAR - 10 (latest observation in the five
  // years up to it), interpolated at the later knots. drift[k] = change per year at knot k (log change for TFR and
  // under-5 mortality). Only information up to REF_YEAR is used, so the 2000 baseline's drift (1990 -> 2000) keeps the
  // backtest out-of-sample.
  const EARLY = REF_YEAR - 10;
  const early = {};
  for (const k of ['pop', 'gdpPpp', 'tfr', 'lifeExpF', 'lifeExpM', 'u5mrF', 'u5mrM']) early[k] = await wbIndicator(WDI[k][1], 'WDI', 'latest', EARLY - 5, EARLY);
  const interp = (knots, x) => {
    if (x <= knots[0][0]) return knots[0][1];
    for (let i = 1; i < knots.length; i++) if (x <= knots[i][0]) { const t = (x - knots[i - 1][0]) / (knots[i][0] - knots[i - 1][0]); return knots[i - 1][1] + t * (knots[i][1] - knots[i - 1][1]); }
    return knots[knots.length - 1][1];
  };
  for (const k of ['tfr', 'lifeExpF', 'lifeExpM', 'u5mrF', 'u5mrM']) {
    // within-country change not explained by moving along today's curve, per year
    const log = k === 'tfr' || k.startsWith('u5');
    const tr = (y) => (log ? Math.log(y) : y);
    const pts = [];
    for (const c of countries) {
      const code = c.members[0].dataCode, f = c.fields;
      if (!(early.pop[code]?.v >= 5e5 && early.gdpPpp[code] && early[k][code] && f[k]?.s === 'WDI' && f.gdpPpp?.s === 'WDI')) continue;
      const x0 = Math.log(early.gdpPpp[code].v / early.pop[code].v), x1 = Math.log(f.gdpPpp.v / f.pop.v);
      const years = f[k].y - early[k][code].y;
      if (years < 5) continue;
      const unexplained = tr(f[k].v) - tr(early[k][code].v) - (tr(interp(curves[k].knots, x1)) - tr(interp(curves[k].knots, x0)));
      pts.push([x0, unexplained / years]);
    }
    pts.sort((p, q) => p[0] - q[0]);
    const med = (xs) => { const t = xs.slice().sort((p, q) => p - q); const m = t.length >> 1; return t.length % 2 ? t[m] : (t[m - 1] + t[m]) / 2; };
    const terc = [0, 1, 2].map((i) => med(pts.slice(Math.floor((i * pts.length) / 3), Math.floor(((i + 1) * pts.length) / 3)).map((p) => p[1])));
    const cut = [pts[Math.floor(pts.length / 3)][0], pts[Math.floor((2 * pts.length) / 3)][0]];
    curves[k].drift = curves[k].knots.map(([x]) => +terc[x < cut[0] ? 0 : x < cut[1] ? 1 : 2].toFixed(5));
    curves[k].driftLog = log;
    curves[k].driftFrom = `within-country change ${EARLY}-${REF_YEAR} not explained by income growth; median by income tercile (n=${pts.length})`;
  }

  // Religion: composition by denomination, and a secularisation law fitted on the WRP panel: for every state with
  // data at both ends of the 15 years before the WRP year, regress the yearly change of the non-religious share s on
  // [s, s²] without intercept (logistic growth ds/dt = r·s·(1 − s/K) ⇔ a·s + b·s², r = a, K = −a/b).
  const rel = await religion(countries);
  for (const c of countries) c.religion = rel.byId[c.id] ?? null;
  const secularisation = (() => {
    const L = (cachedSync('WRP_national.csv') || '').trim().split('\n');
    const head = L[0].split(','), iNone = head.indexOf('nonreligpct'), y1 = rel.year, y0 = rel.year - 15;
    const by = {};
    for (const l of L.slice(1)) { const r = l.split(','); if (+r[0] === y0 || +r[0] === y1) (by[r[2]] ??= {})[+r[0]] = +r[iNone]; }
    let sxx = 0, sxy = 0, syy = 0, sx = 0, sy = 0, n = 0;
    for (const v of Object.values(by)) {
      if (v[y0] == null || v[y1] == null || v[y0] > 0.5) continue; // exclude regime-driven collapses of irreligion
      const s0 = v[y0], d = (v[y1] - s0) / 15, x1 = s0, x2 = s0 * s0;
      sxx += x1 * x1; sxy += x1 * x2; syy += x2 * x2; sx += x1 * d; sy += x2 * d; n++;
    }
    const det = sxx * syy - sxy * sxy, a = (sx * syy - sy * sxy) / det, bq = (sy * sxx - sx * sxy) / det;
    return { r: +a.toFixed(5), K: +(-a / bq).toFixed(4), n, window: `${y0}-${y1}` };
  })();
  console.log('secularisation', JSON.stringify(secularisation));
  // Diplomacy: defence treaties, sanctions programmes in force, and the cross-sectional link between democracy and
  // UN voting position (used to move a country's foreign-policy position when its regime changes).
  const al = await alliances(countries);
  const grievances = await conflictHistory(countries);
  const conflict = await conflicts(countries);
  console.log('conflict', JSON.stringify({ ...conflict, active: conflict.active.length }), conflict.active.map((x) => `${x.kind[0]}:${x.loc}${x.kind === 'interstate' ? '<' + x.a : ''}:${x.deaths}`).join(' '));
  console.log('grievances', grievances.length, 'pairs; top', grievances.sort((x, y) => y.g - x.g).slice(0, 8).map((x) => `${x.a}-${x.b} ${x.g}`).join(', '));
  const ids = new Set(countries.map((c) => c.id));
  const sanctionYear = REF_YEAR >= 2022 ? 2023 : 2000;
  if (REF_YEAR !== sanctionYear) console.warn(`sanctions list is for ${sanctionYear}, reference year ${REF_YEAR}`);
  const sanctions = SANCTIONS[sanctionYear].flatMap((p) => p.senders.flatMap(([s, intensity]) =>
    [{ sender: s, target: p.target, intensity, since: p.since, programme: p.programme }]));
  // 'UN' = Security Council regime: one collective sender (the model treats it as a country-level status)
  for (const s of sanctions) if ((s.sender !== 'UN' && !ids.has(s.sender)) || !ids.has(s.target)) throw new Error(`sanction: unknown country ${s.sender}->${s.target}`);
  const foreignPolicy = (() => {
    const pts = countries.filter((c) => c.fields.unIdeal?.s === 'UNGA' && c.fields.vdemEdi?.s === 'VDEM').map((c) => [c.fields.vdemEdi.v, c.fields.unIdeal.v]);
    const n = pts.length, mx = pts.reduce((s, p) => s + p[0], 0) / n, my = pts.reduce((s, p) => s + p[1], 0) / n;
    let sxy = 0, sxx = 0, syy = 0;
    for (const [x, y] of pts) { sxy += (x - mx) * (y - my); sxx += (x - mx) ** 2; syy += (y - my) ** 2; }
    return { slopeOnDemocracy: +(sxy / sxx).toFixed(3), r2: +((sxy * sxy) / (sxx * syy)).toFixed(3), n };
  })();
  console.log('alliances', al.treaties.length, 'treaties;', JSON.stringify(al.rates), al.notes.join('; '));
  console.log('sanctions', sanctions.length, 'directed pairs; foreign policy', JSON.stringify(foreignPolicy));

  const relMissing = countries.filter((c) => !c.religion).map((c) => c.id);
  if (relMissing.length) console.warn('religion missing for', relMissing.join(' '));

  const coverage = {};
  for (const field of Object.keys(allFields)) {
    const by = {};
    for (const c of countries) by[c.fields[field]?.s ?? 'missing'] = (by[c.fields[field]?.s ?? 'missing'] || 0) + 1;
    coverage[field] = by;
  }

  const prov = await buildProvinces(cached, regions, countries);

  const baseline = {
    meta: {
      referenceYear: REF_YEAR, minYear: MIN_YEAR, startDate: `${REF_YEAR + 1}-01-01`,
      generated: new Date().toISOString().slice(0, 10), sources: SOURCES,
      indicators: Object.fromEntries(Object.entries(allFields).map(([k, [s, code, agg]]) => [k, { source: s, code, agg }])),
      curves, coverage, baseRates: { ...vd.baseRates, alliances: al.rates }, secularisation,
      diplomacy: { treaties: al.treaties, atopYear: al.atopYear, allianceUpdates: al.notes, sanctions, sanctionsAsOf: sanctionYear, foreignPolicy, grievances },
      conflict,
      religions: RELIGIONS.map(([, label, family]) => ({ label, family })),
    },
    countries: countries.map(({ members, ...c }) => c),
    regions: regions.map(({ idx, nePop, nePopYear, neGdpMd, neGdpYear, ...r }) => r),
    provinces: prov.provinces,
  };
  fs.writeFileSync(path.join(OUT, OUT_NAME), JSON.stringify(baseline));
  if (OUT_NAME === 'baseline.json') fs.writeFileSync(path.join(OUT, 'world.topo.json'), JSON.stringify(prov.topo));
  console.log(`countries=${countries.length} regions=${regions.length}`);
  for (const [k, cv] of Object.entries(curves)) if (cv.drift) console.log('drift', k, cv.drift.join(' '));
  for (const [k, v] of Object.entries(coverage)) console.log(k.padEnd(20), JSON.stringify(v));
}

main().catch((e) => { console.error(e); process.exit(1); });
