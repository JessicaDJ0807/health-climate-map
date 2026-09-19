// Build the static environmental layers used by the trip planner.
//
//   node scripts/build-trip-data.mjs
//
// Writes to public/data/:
//   air-by-cd.geojson    community districts + latest annual PM2.5 / NO2 (EHDP)
//   truck-routes.json    NYC truck route segments as flat coordinate arrays
//   nta-env.geojson      2020 NTAs with surface temperature (Heat Vulnerability
//                        Index) and a park flag (street-tree data has no park trees)
//   trip-summary.json    source years + citywide ranges used to normalise scores
import { writeFileSync } from "node:fs";

const EHDP = "https://raw.githubusercontent.com/nychealth/EHDP-data/production";
const TRUCK_ROUTES = "https://data.cityofnewyork.us/resource/jjja-shxy.geojson";
const NTAS = "https://data.cityofnewyork.us/resource/9nt8-h7nd.geojson"; // 2020 NTAs

// EHDP indicator / measure ids for annual means (see metadata.json).
const AIR = {
  pm25: { indicator: 2023, measure: 1425 }, // Fine particles (PM 2.5), µg/m³
  no2: { indicator: 2025, measure: 1431 }, // Nitrogen dioxide (NO2), ppb
};

async function get(url, as = "json") {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return as === "json" ? res.json() : res.text();
}

const round = (v) => Math.round(v * 1e5) / 1e5;
const roundCoords = (c) => (typeof c[0] === "number" ? c.map(round) : c.map(roundCoords));

function tercileBreaks(values) {
  const s = [...values].sort((a, b) => a - b);
  return [s[Math.floor(s.length / 3)], s[Math.floor((2 * s.length) / 3)]];
}

// --- air quality by community district -------------------------------------
console.log("Fetching EHDP air quality…");
const periods = await get(`${EHDP}/indicators/metadata/TimePeriods.json`);
const periodName = Object.fromEntries(periods.map((p) => [p.TimePeriodID, p.TimePeriod]));

async function latestByCd({ indicator, measure }) {
  const d = await get(`${EHDP}/indicators/data/${indicator}.json`);
  const rows = d.MeasureID.map((_, i) => ({
    measure: d.MeasureID[i], geoType: d.GeoType[i], geoId: d.GeoID[i],
    period: d.TimePeriodID[i], value: d.Value[i],
  })).filter((r) => r.measure === measure && r.geoType === "CD");
  // Only annual periods (named as a plain year) count as "latest annual mean".
  const annual = rows.filter((r) => /^\d{4}$/.test(periodName[r.period] ?? ""));
  const latest = Math.max(...annual.map((r) => r.period));
  return {
    year: periodName[latest],
    byCd: Object.fromEntries(annual.filter((r) => r.period === latest).map((r) => [r.geoId, r.value])),
  };
}

const pm25 = await latestByCd(AIR.pm25);
const no2 = await latestByCd(AIR.no2);
const cds = await get(`${EHDP}/geography/CD.geojson`);
const cdFeatures = cds.features
  .filter((f) => pm25.byCd[f.properties.GEOCODE] != null && no2.byCd[f.properties.GEOCODE] != null)
  .map((f) => ({
    type: "Feature",
    geometry: { type: f.geometry.type, coordinates: roundCoords(f.geometry.coordinates) },
    properties: {
      cd: f.properties.GEOCODE,
      name: f.properties.GEONAME,
      pm25: Math.round(pm25.byCd[f.properties.GEOCODE] * 100) / 100,
      no2: Math.round(no2.byCd[f.properties.GEOCODE] * 100) / 100,
    },
  }));
writeFileSync("public/data/air-by-cd.geojson", JSON.stringify({ type: "FeatureCollection", features: cdFeatures }));
console.log(`  ${cdFeatures.length} districts (PM2.5 ${pm25.year}, NO2 ${no2.year})`);

// --- truck routes ------------------------------------------------------------
console.log("Fetching truck routes…");
const trucks = await get(`${TRUCK_ROUTES}?$limit=100000`);
const segments = [];
for (const f of trucks.features) {
  if (!f.geometry) continue;
  const lines = f.geometry.type === "LineString" ? [f.geometry.coordinates] : f.geometry.coordinates;
  for (const line of lines) segments.push(line.flatMap(([x, y]) => [round(x), round(y)]));
}
writeFileSync("public/data/truck-routes.json", JSON.stringify(segments));
console.log(`  ${segments.length} segments`);

// --- neighborhood surface temperature (HVI, 2020 NTAs) ----------------------
console.log("Fetching Heat Vulnerability Index…");
const csv = await get(`${EHDP}/key-topics/heat-vulnerability-index/hvi-nta-2020.csv`, "text");
const [header, ...lines] = csv.trim().split(/\r?\n/);
const cols = header.split(",");
const ntaCol = cols.indexOf("NTACode");
const tempCol = cols.indexOf("SURFACE_TEMP");
const heat = {};
for (const line of lines) {
  const cells = line.split(",");
  const t = Number(cells[tempCol]);
  if (Number.isFinite(t)) heat[cells[ntaCol]] = Math.round(t * 10) / 10;
}

const ntas = await get(`${NTAS}?$limit=1000`);
const ntaFeatures = ntas.features.map((f) => ({
  type: "Feature",
  geometry: { type: f.geometry.type, coordinates: roundCoords(f.geometry.coordinates) },
  properties: {
    nta: f.properties.nta2020,
    surfaceTemp: heat[f.properties.nta2020] ?? null,
    park: f.properties.ntatype === "9", // large parks
  },
}));
writeFileSync("public/data/nta-env.geojson", JSON.stringify({ type: "FeatureCollection", features: ntaFeatures }));
console.log(`  ${Object.keys(heat).length} neighborhoods with surface temperature, ${ntaFeatures.filter((f) => f.properties.park).length} parks`);

// --- summary -----------------------------------------------------------------
const pmValues = cdFeatures.map((f) => f.properties.pm25);
const no2Values = cdFeatures.map((f) => f.properties.no2);
const temps = Object.values(heat);
const summary = {
  builtAt: new Date().toISOString().slice(0, 10),
  sources: {
    air: `NYC Environment & Health Data Portal, annual means by community district (PM2.5 ${pm25.year}, NO2 ${no2.year})`,
    trucks: "NYC DOT truck routes (NYC Open Data jjja-shxy)",
    heat: "NYC Heat Vulnerability Index, surface temperature by 2020 NTA",
    parks: "2020 NTAs of type 9 (large parks), NYC Open Data 9nt8-h7nd",
  },
  airYear: pm25.year,
  pm25: { min: Math.min(...pmValues), max: Math.max(...pmValues), terciles: tercileBreaks(pmValues) },
  no2: { min: Math.min(...no2Values), max: Math.max(...no2Values), terciles: tercileBreaks(no2Values) },
  surfaceTemp: { min: Math.min(...temps), max: Math.max(...temps) },
};
writeFileSync("public/data/trip-summary.json", JSON.stringify(summary, null, 2) + "\n");
console.log("Done.", JSON.stringify({ pm25: summary.pm25, no2: summary.no2, surfaceTemp: summary.surfaceTemp }));
