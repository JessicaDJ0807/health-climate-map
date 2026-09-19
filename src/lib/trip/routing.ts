// Candidate walking routes from the public Valhalla server (OpenStreetMap).
// Valhalla's own alternates often overlap heavily, so we also request two
// detours forced through a point on either side of the straight line.
import { decodePolyline6, distanceM, sampleLine, toMeters, type LngLat } from "./geo";

const VALHALLA = "https://valhalla1.openstreetmap.de/route";

export type Candidate = {
  id: string;
  line: LngLat[];
  minutes: number;
  km: number;
};

type ValhallaTrip = {
  trip: { summary: { time: number; length: number }; legs: { shape: string }[] };
  alternates?: { trip: ValhallaTrip["trip"] }[];
};

async function requestRoute(points: { lng: number; lat: number; through?: boolean }[], alternates = 0, signal?: AbortSignal) {
  const res = await fetch(VALHALLA, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal,
    body: JSON.stringify({
      locations: points.map((p) => ({ lon: p.lng, lat: p.lat, ...(p.through ? { type: "through" } : {}) })),
      // Walking only: pedestrian costing never uses transit or bikes; also
      // strongly avoid ferry legs.
      costing: "pedestrian",
      costing_options: { pedestrian: { type: "foot", use_ferry: 0 } },
      alternates,
      directions_type: "none",
      units: "kilometers",
    }),
  });
  if (!res.ok) throw new Error(`Routing failed (${res.status})`);
  const data: ValhallaTrip = await res.json();
  return [data.trip, ...(data.alternates ?? []).map((a) => a.trip)];
}

function toCandidate(trip: ValhallaTrip["trip"], id: string): Candidate {
  return {
    id,
    line: trip.legs.flatMap((leg) => decodePolyline6(leg.shape)),
    minutes: trip.summary.time / 60,
    km: trip.summary.length,
  };
}

/** Share of `b`'s sample points that lie within 30 m of route `a`. */
function overlap(a: Candidate, b: Candidate) {
  const aPts = sampleLine(a.line, 30);
  const bPts = sampleLine(b.line, 30);
  const near = bPts.filter((p) => aPts.some((q) => distanceM(p, q) < 30)).length;
  return near / bPts.length;
}

/** Point offset perpendicular to the origin→destination line at its midpoint. */
function detourPoint(from: LngLat, to: LngLat, side: 1 | -1): { lng: number; lat: number } {
  const [ax, ay] = toMeters(from);
  const [bx, by] = toMeters(to);
  const len = Math.hypot(bx - ax, by - ay);
  const offset = Math.min(700, Math.max(200, len * 0.25)) * side;
  const mx = (ax + bx) / 2 - ((by - ay) / len) * offset;
  const my = (ay + by) / 2 + ((bx - ax) / len) * offset;
  // Back to lng/lat using the same scale factors as toMeters.
  const [sx, sy] = toMeters([1, 1]);
  return { lng: mx / sx, lat: my / sy };
}

export async function fetchCandidates(from: LngLat, to: LngLat, signal?: AbortSignal): Promise<Candidate[]> {
  const a = { lng: from[0], lat: from[1] };
  const b = { lng: to[0], lat: to[1] };
  const results = await Promise.allSettled([
    requestRoute([a, b], 2, signal),
    requestRoute([a, { ...detourPoint(from, to, 1), through: true }, b], 0, signal),
    requestRoute([a, { ...detourPoint(from, to, -1), through: true }, b], 0, signal),
  ]);
  if (results[0].status === "rejected") throw results[0].reason;

  const trips = results.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
  const all = trips.map((t, i) => toCandidate(t, `r${i}`));
  const fastest = Math.min(...all.map((c) => c.minutes));

  // Drop detours that are much longer, and near-duplicates of an earlier route.
  const kept: Candidate[] = [];
  for (const c of all.sort((x, y) => x.minutes - y.minutes)) {
    if (c.minutes > fastest * 1.5) continue;
    if (kept.some((k) => overlap(k, c) > 0.9)) continue;
    kept.push(c);
  }
  return kept;
}
