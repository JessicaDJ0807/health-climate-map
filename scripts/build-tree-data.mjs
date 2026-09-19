// Build the street-tree neighborhood layer from the 2015 NYC Street Tree Census.
//
//   node scripts/build-tree-data.mjs
//
// Downloads every census row (lat/long, status, health, species) from NYC Open
// Data, assigns each tree to a 2020 Neighborhood Tabulation Area by point-in-
// polygon (the census itself only carries 2010 NTA codes; 2020 NTAs match the
// Heat Vulnerability Index), and writes:
//   public/data/trees-by-nta.geojson  NTA polygons + per-NTA tree stats
//   public/data/trees-summary.json    citywide stats + density class breaks
//   public/data/tree-tiles/           living-tree locations in 0.02° tiles for
//                                     the trip planner (Int32 [lng×1e5, lat×1e5]
//                                     pairs, plus index.json of tile keys)
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import area from "@turf/area";
import { booleanPointInPolygon } from "@turf/boolean-point-in-polygon";

const TREES = "https://data.cityofnewyork.us/resource/uvpi-gqnh.json"; // 2015 census
const NTAS = "https://data.cityofnewyork.us/resource/9nt8-h7nd.geojson"; // 2020 NTAs
const PAGE = 50000;
const TOP_SPECIES = 5;
// Must match TILE_DEG in src/lib/trip/env.ts.
const TILE_DEG = 0.02;

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

function emptyStats() {
  return { alive: 0, dead: 0, stump: 0, good: 0, fair: 0, poor: 0, species: {} };
}

function addTree(stats, tree) {
  if (tree.status === "Dead") stats.dead++;
  else if (tree.status === "Stump") stats.stump++;
  else {
    stats.alive++;
    const health = tree.health?.toLowerCase();
    if (health in stats && health !== "species") stats[health]++;
    const name = tree.spc_common ?? "Unknown";
    stats.species[name] = (stats.species[name] ?? 0) + 1;
  }
}

function finishStats(stats) {
  const { species, ...counts } = stats;
  const topSpecies = Object.entries(species)
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP_SPECIES)
    .map(([name, count]) => ({ name, count }));
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

console.log("Fetching 2020 NTA boundaries…");
const ntas = await getJson(`${NTAS}?$limit=1000`);
const polys = ntas.features.map((f) => ({ feature: f, bbox: bboxOf(f.geometry), stats: emptyStats() }));

console.log("Fetching 2015 street tree census…");
const city = emptyStats();
const tiles = new Map(); // "x_y" -> [lngE5, latE5, ...]
let unmatched = 0;
for (let offset = 0; ; offset += PAGE) {
  const params = new URLSearchParams({
    $select: "tree_id,latitude,longitude,status,health,spc_common",
    $order: "tree_id",
    $limit: String(PAGE),
    $offset: String(offset),
  });
  const rows = await getJson(`${TREES}?${params}`);
  for (const tree of rows) {
    addTree(city, tree);
    const x = Number(tree.longitude), y = Number(tree.latitude);
    if (tree.status !== "Dead" && tree.status !== "Stump") {
      const key = `${Math.floor(x / TILE_DEG)}_${Math.floor(y / TILE_DEG)}`;
      if (!tiles.has(key)) tiles.set(key, []);
      tiles.get(key).push(Math.round(x * 1e5), Math.round(y * 1e5));
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
  censusYear: 2015,
  source: "NYC Open Data uvpi-gqnh (2015 Street Tree Census), 9nt8-h7nd (2020 NTAs)",
  builtAt: new Date().toISOString().slice(0, 10),
  unmatched,
  densityBreaks: quantileBreaks(densities, 5),
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
console.log(`Done. ${summary.city.total} trees, ${unmatched} outside any NTA.`);
console.log("Density breaks (trees/km²):", summary.densityBreaks);
