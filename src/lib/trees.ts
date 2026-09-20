// Shared types and colors for the street-tree views. Data is built by
// scripts/build-tree-data.mjs from the 2015 NYC Street Tree Census.

export type TreeStats = {
  alive: number;
  dead: number;
  stump: number;
  good: number;
  fair: number;
  poor: number;
  total: number;
  speciesCount: number;
  topSpecies: { name: string; count: number }[];
};

export type NtaProps = TreeStats & {
  nta2020: string;
  ntaname: string;
  boroname: string;
  residential: boolean;
  areaKm2: number;
  density: number; // living trees per km²
};

export type NtaCollection = GeoJSON.FeatureCollection<GeoJSON.Polygon | GeoJSON.MultiPolygon, NtaProps>;

export type TreeSummary = {
  dataUpdated: string; // ISO date the Forestry inventory last changed
  source: string;
  densityBreaks: number[];
  city: TreeStats;
};

// Sequential green ramp for trees per km², light → dark (5 quantile classes).
export const DENSITY_COLORS = ["#d7ecc9", "#a6d58f", "#6db55b", "#358a33", "#0f5c1f"];
// Parks, cemeteries, airports: street-tree density isn't meaningful there.
export const NON_RESIDENTIAL_COLOR = "#e1e0d9";

// Tree condition uses the status palette; always shown with text labels.
export const HEALTH = [
  { key: "good", label: "Good", color: "#0ca30c" },
  { key: "fair", label: "Fair", color: "#fab219" },
  { key: "poor", label: "Poor", color: "#ec835a" },
  { key: "dead", label: "Dead or stump", color: "#d03b3b" },
] as const;

export type HealthKey = (typeof HEALTH)[number]["key"];

// Individual trees are fetched live once the map is zoomed in this far.
export const TREE_MIN_ZOOM = 15;
export const TREE_FETCH_LIMIT = 10000;

export const fmt = new Intl.NumberFormat("en-US");
