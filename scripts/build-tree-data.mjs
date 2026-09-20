// Build the street-tree neighborhood layer from the NYC Forestry tree inventory.
//
//   node scripts/build-tree-data.mjs
//
// Downloads every tree point (location, structure, condition, species, trunk
// diameter) from NYC Open Data, assigns each tree to a 2020 Neighborhood
// Tabulation Area by point-in-polygon (2020 NTAs match the Heat Vulnerability
// Index), and writes:
//   public/data/trees-by-nta.geojson  NTA polygons + per-NTA tree stats
//   public/data/trees-summary.json    citywide stats + density class breaks
//   public/data/tree-tiles/           living-tree locations in 0.02° tiles for
//                                     the trip planner (Int32 triples of
//                                     [lng×1e5, lat×1e5, pollenClass], plus
//                                     index.json of tile keys)
//
// Source note: this is the continuously-maintained Forestry inventory
// (hn5i-inap), not the decennial Street Tree Census (uvpi-gqnh, last taken in
// 2015). It carries ~250k more living trees, including park interiors that the
// street census never surveyed, and is updated within days.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import area from "@turf/area";
import { booleanPointInPolygon } from "@turf/boolean-point-in-polygon";

const TREES = "https://data.cityofnewyork.us/resource/hn5i-inap.json"; // Forestry Tree Points
const TREES_META = "https://data.cityofnewyork.us/api/views/hn5i-inap.json";
const NTAS = "https://data.cityofnewyork.us/resource/9nt8-h7nd.geojson"; // 2020 NTAs
const PAGE = 50000;
const TOP_SPECIES = 5;
// Must match TILE_DEG in src/lib/trip/env.ts.
const TILE_DEG = 0.02;

async function getJson(url, tries = 4) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      return await res.json();
    } catch (err) {
      // Socrata throttles unauthenticated bulk reads; back off and retry.
      if (attempt === tries) throw new Error(`${err.message} — ${url}`);
      const wait = 2 ** attempt * 1000;
      console.log(`  retry ${attempt}/${tries - 1} in ${wait / 1000}s (${err.message})`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
}

// Shared with the app (src/lib/trip/pollen.ts) so both sides classify alike.
const POLLEN = JSON.parse(readFileSync("src/lib/trip/pollen-genera.json", "utf8"));
const POLLEN_CLASS = new Map([
  ...POLLEN.high.map((g) => [g, 2]),
  ...POLLEN.moderate.map((g) => [g, 1]),
]);

/** Scientific name, cultivar and variety stripped: "Gleditsia triacanthos". */
function sciName(genusspecies) {
  if (!genusspecies) return "Unknown";
  // A handful of rows use an en-dash instead of a hyphen.
  const cleaned = genusspecies
    .split(/\s[-–]\s/)[0]
    .replace(/'[^']*'/g, " ") // 'Green leaf'
    .replace(/\b(?:var|ssp|subsp|cv|f)\.\s*\S+/gi, " ") // var. inermis
    .replace(/\b(?:spp?)\./gi, " ") // Salix spp.
    .replace(/^\s*[x×]\s+/i, ""); // × Chitalpa (intergeneric hybrid)
  // The hybrid marker is dropped: it is a grouping key, not a printed name.
  const parts = cleaned.trim().split(/\s+/).filter((t) => !/^[x×]\.?$/i.test(t));
  return parts.slice(0, 2).join(" ") || "Unknown";
}

function genusOf(genusspecies) {
  return sciName(genusspecies).split(" ")[0];
}

/** 0 = negligible airborne pollen, 1 = moderate, 2 = major allergen. */
function pollenClass(genusspecies) {
  return POLLEN_CLASS.get(genusOf(genusspecies)) ?? 0;
}

function emptyStats() {
  return { alive: 0, dead: 0, stump: 0, good: 0, fair: 0, poor: 0, species: {} };
}

// The inventory's own vocabulary, mapped onto the census-era buckets the UI
// already renders. "Retired" points are records for trees that no longer
// exist, so they are dropped before we get here.
const STUMP = new Set(["Stump", "Stump - Uprooted"]);
const HEALTH = {
  Excellent: "good", Good: "good", Fair: "fair", Poor: "poor", Critical: "poor",
};

/** "Platanus x acerifolia - London planetree" -> "London planetree". */
function commonName(genusspecies) {
  if (!genusspecies) return "Unknown";
  // A handful of rows use an en-dash instead of a hyphen.
  const parts = genusspecies.split(/\s[-–]\s/);
  return (parts.length > 1 ? parts.slice(1).join(" - ") : genusspecies).trim();
}

function addTree(stats, tree) {
  if (STUMP.has(tree.tpstructure)) stats.stump++;
  else if (tree.tpcondition === "Dead") stats.dead++;
  else {
    stats.alive++;
    const health = HEALTH[tree.tpcondition]; // undefined for "Unknown"
    if (health) stats[health]++;
    // Keyed by species, not cultivar, so "Gleditsia triacanthos var. inermis"
    // and "Gleditsia triacanthos" are one taxon. The label shown is whichever
    // common name that taxon carries most often.
    const key = sciName(tree.genusspecies);
    const entry = (stats.species[key] ??= { count: 0, labels: {} });
    entry.count++;
    const label = commonName(tree.genusspecies);
    entry.labels[label] = (entry.labels[label] ?? 0) + 1;
  }
}

function finishStats(stats) {
  const { species, ...counts } = stats;
  const topSpecies = Object.values(species)
    .sort((a, b) => b.count - a.count)
    .slice(0, TOP_SPECIES)
    .map(({ count, labels }) => ({
      name: Object.entries(labels).sort((a, b) => b[1] - a[1])[0][0],
      count,
    }));
  return { ...counts, total: counts.alive + counts.dead + counts.stump, speciesCount: Object.keys(species).length, topSpecies };
}

function bboxOf(geometry) {
  let [w, s, e, n] = [Infinity, Infinity, -Infinity, -Infinity];
  const rings = geometry.type === "Polygon" ? geometry.coordinates : geometry.coordinates.flat();
  for (const ring of rings) {
    for (const [x, y] of ring) {
      w = Math.min(w, x); e = Math.max(e, x); s = Math.min(s, y); n = Math.max(n, y);
    }
  }
  return [w, s, e, n];
}

// Trim coordinates to ~1 m to keep the output small.
function roundCoords(c) {
  return typeof c[0] === "number" ? c.map((v) => Math.round(v * 1e5) / 1e5) : c.map(roundCoords);
}

function quantileBreaks(values, classes) {
  const sorted = [...values].sort((a, b) => a - b);
  return Array.from({ length: classes - 1 }, (_, i) =>
    Math.round(sorted[Math.floor(((i + 1) / classes) * sorted.length)]),
  );
}

console.log("Fetching dataset metadata…");
const meta = await getJson(TREES_META);
const dataUpdated = new Date(meta.rowsUpdatedAt * 1000).toISOString().slice(0, 10);
console.log(`  inventory last updated ${dataUpdated}`);

console.log("Fetching 2020 NTA boundaries…");
const ntas = await getJson(`${NTAS}?$limit=1000`);
const polys = ntas.features.map((f) => ({ feature: f, bbox: bboxOf(f.geometry), stats: emptyStats() }));

console.log("Fetching NYC Forestry tree inventory…");
const city = emptyStats();
const tiles = new Map(); // "x_y" -> [lngE5, latE5, ...]
let unmatched = 0, retired = 0, nolocation = 0;
const pollenMix = [0, 0, 0]; // living trees by pollen class
for (let offset = 0; ; offset += PAGE) {
  const params = new URLSearchParams({
    $select: "objectid,tpstructure,tpcondition,genusspecies,location",
    $order: "objectid",
    $limit: String(PAGE),
    $offset: String(offset),
  });
  const rows = await getJson(`${TREES}?${params}`);
  for (const tree of rows) {
    // Retired records describe trees that have been removed.
    if (tree.tpstructure === "Retired") { retired++; continue; }
    const coords = tree.location?.coordinates;
    if (!coords) { nolocation++; continue; }
    const [x, y] = coords;
    addTree(city, tree);
    const standing = !STUMP.has(tree.tpstructure) && tree.tpcondition !== "Dead";
    if (standing) {
      const key = `${Math.floor(x / TILE_DEG)}_${Math.floor(y / TILE_DEG)}`;
      if (!tiles.has(key)) tiles.set(key, []);
      const pollen = pollenClass(tree.genusspecies);
      pollenMix[pollen]++;
      tiles.get(key).push(Math.round(x * 1e5), Math.round(y * 1e5), pollen);
    }
    const hit = polys.find(
      (p) => x >= p.bbox[0] && x <= p.bbox[2] && y >= p.bbox[1] && y <= p.bbox[3] &&
        booleanPointInPolygon([x, y], p.feature),
    );
    if (hit) addTree(hit.stats, tree);
    else unmatched++;
  }
  console.log(`  ${offset + rows.length} rows`);
  if (rows.length < PAGE) break;
}

const features = polys.map(({ feature, stats }) => {
  const p = feature.properties;
  const areaKm2 = area(feature) / 1e6;
  const s = finishStats(stats);
  return {
    type: "Feature",
    geometry: { type: feature.geometry.type, coordinates: roundCoords(feature.geometry.coordinates) },
    properties: {
      nta2020: p.nta2020,
      ntaname: p.ntaname,
      boroname: p.boroname,
      // ntatype 0 = residential; others are parks, airports, cemeteries, etc.
      residential: p.ntatype === "0",
      areaKm2: Math.round(areaKm2 * 100) / 100,
      density: Math.round(s.alive / areaKm2),
      ...s,
    },
  };
});

// Class breaks from residential NTAs only, so large parks don't skew the scale.
const densities = features.filter((f) => f.properties.residential).map((f) => f.properties.density);
const summary = {
  dataUpdated,
  source: "NYC Open Data hn5i-inap (Forestry Tree Points), 9nt8-h7nd (2020 NTAs)",
  builtAt: new Date().toISOString().slice(0, 10),
  unmatched,
  densityBreaks: quantileBreaks(densities, 5),
  pollenMix: { low: pollenMix[0], moderate: pollenMix[1], high: pollenMix[2] },
  city: finishStats(city),
};

writeFileSync("public/data/trees-by-nta.geojson", JSON.stringify({ type: "FeatureCollection", features }));
writeFileSync("public/data/trees-summary.json", JSON.stringify(summary, null, 2) + "\n");

rmSync("public/data/tree-tiles", { recursive: true, force: true });
mkdirSync("public/data/tree-tiles", { recursive: true });
for (const [key, coords] of tiles) {
  writeFileSync(`public/data/tree-tiles/${key}.bin`, Buffer.from(new Int32Array(coords).buffer));
}
writeFileSync("public/data/tree-tiles/index.json", JSON.stringify([...tiles.keys()].sort()));
console.log(`Wrote ${tiles.size} tree tiles.`);
const pollenTotal = pollenMix.reduce((a, b) => a + b, 0);
console.log(
  `Pollen mix: ${((100 * pollenMix[2]) / pollenTotal).toFixed(1)}% high, ` +
    `${((100 * pollenMix[1]) / pollenTotal).toFixed(1)}% moderate, ` +
    `${((100 * pollenMix[0]) / pollenTotal).toFixed(1)}% low.`,
);
console.log(`Done. ${summary.city.total} trees, ${unmatched} outside any NTA.`);
console.log(`Skipped ${retired} retired records, ${nolocation} without a location.`);
console.log("Density breaks (trees/km²):", summary.densityBreaks);
