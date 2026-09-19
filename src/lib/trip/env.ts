// Environmental data for the trip planner: static layers built by
// scripts/build-trip-data.mjs, plus live street trees and the NWS forecast.
import { booleanPointInPolygon } from "@turf/boolean-point-in-polygon";
import { PointGrid, SegmentGrid, bboxOf, type LngLat } from "./geo";

type Poly = GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>;

export type TripSummary = {
  airYear: string;
  pm25: { min: number; max: number; terciles: [number, number] };
  no2: { min: number; max: number; terciles: [number, number] };
  surfaceTemp: { min: number; max: number };
};

/** Point-in-polygon lookup with a bbox prefilter and a last-hit cache. */
class PolygonIndex<P> {
  private items: { f: Poly; bbox: number[]; props: P }[];
  private last: (typeof this.items)[number] | null = null;
  constructor(features: Poly[]) {
    this.items = features.map((f) => ({
      f,
      bbox: bboxOf(
        (f.geometry.type === "Polygon" ? f.geometry.coordinates : f.geometry.coordinates.flat()) as LngLat[][],
      ),
      props: f.properties as P,
    }));
  }
  find(p: LngLat): P | null {
    const hit = (it: (typeof this.items)[number]) =>
      p[0] >= it.bbox[0] && p[0] <= it.bbox[2] && p[1] >= it.bbox[1] && p[1] <= it.bbox[3] &&
      booleanPointInPolygon(p, it.f);
    if (this.last && hit(this.last)) return this.last.props;
    this.last = this.items.find(hit) ?? null;
    return this.last?.props ?? null;
  }
}

export type StaticEnv = {
  summary: TripSummary;
  air: PolygonIndex<{ pm25: number; no2: number; name: string }>;
  nta: PolygonIndex<{ surfaceTemp: number | null; park: boolean }>;
  trucks: SegmentGrid;
};

let staticEnv: Promise<StaticEnv> | null = null;

export function loadStaticEnv() {
  staticEnv ??= (async () => {
    const [summary, air, nta, trucks] = await Promise.all(
      ["trip-summary.json", "air-by-cd.geojson", "nta-env.geojson", "truck-routes.json"].map((f) =>
        fetch(`/data/${f}`).then((r) => r.json()),
      ),
    );
    const truckGrid = new SegmentGrid(60);
    for (const line of trucks as number[][]) truckGrid.addLine(line);
    return {
      summary,
      air: new PolygonIndex(air.features),
      nta: new PolygonIndex(nta.features),
      trucks: truckGrid,
    };
  })();
  return staticEnv;
}

// 2015 Street Tree Census on NYC Open Data (live, CORS-enabled).
const TREES_API = "https://data.cityofnewyork.us/resource/uvpi-gqnh.json";

export async function fetchTreeGrid(lines: LngLat[][], signal?: AbortSignal) {
  const [w, s, e, n] = bboxOf(lines, 40);
  const params = new URLSearchParams({
    $select: "latitude,longitude",
    $where: `status='Alive' and latitude between ${s} and ${n} and longitude between ${w} and ${e}`,
    $limit: "100000",
  });
  const res = await fetch(`${TREES_API}?${params}`, { signal });
  if (!res.ok) throw new Error(`Tree data failed (${res.status})`);
  const rows: { latitude: string; longitude: string }[] = await res.json();
  const grid = new PointGrid(20);
  for (const r of rows) grid.add([Number(r.longitude), Number(r.latitude)]);
  return grid;
}

// --- weather -----------------------------------------------------------------

export type HourForecast = { time: Date; tempF: number; humidity: number; heatIndexF: number };

// NWS grid cell covering lower/midtown Manhattan; close enough citywide for a
// departure-time comparison.
const NWS_HOURLY = "https://api.weather.gov/gridpoints/OKX/33,42/forecast/hourly";

/** NWS heat index (Rothfusz regression with the standard adjustments). */
export function heatIndexF(t: number, rh: number) {
  const simple = 0.5 * (t + 61 + (t - 68) * 1.2 + rh * 0.094);
  if ((simple + t) / 2 < 80) return simple;
  let hi = -42.379 + 2.04901523 * t + 10.14333127 * rh - 0.22475541 * t * rh -
    0.00683783 * t * t - 0.05481717 * rh * rh + 0.00122874 * t * t * rh +
    0.00085282 * t * rh * rh - 0.00000199 * t * t * rh * rh;
  if (rh < 13 && t >= 80 && t <= 112) hi -= ((13 - rh) / 4) * Math.sqrt((17 - Math.abs(t - 95)) / 17);
  else if (rh > 85 && t >= 80 && t <= 87) hi += ((rh - 85) / 10) * ((87 - t) / 5);
  return hi;
}

export async function fetchForecast(): Promise<HourForecast[]> {
  const res = await fetch(NWS_HOURLY, { headers: { Accept: "application/geo+json" } });
  if (!res.ok) throw new Error(`Forecast failed (${res.status})`);
  const data = await res.json();
  return data.properties.periods.map(
    (p: { startTime: string; temperature: number; relativeHumidity: { value: number } }) => ({
      time: new Date(p.startTime),
      tempF: p.temperature,
      humidity: p.relativeHumidity?.value ?? 50,
      heatIndexF: Math.round(heatIndexF(p.temperature, p.relativeHumidity?.value ?? 50)),
    }),
  );
}
