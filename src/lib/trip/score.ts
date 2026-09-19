// Estimated environmental exposure for candidate walking routes.
//
// Routes are sampled once (analyzeRoute). Everything that depends on the
// health profile or departure time (scoreRoutes) is a cheap pure function, so
// toggles re-rank instantly. Outputs are estimated exposure, not medical risk.
import { getPosition } from "suncalc";
import { sampleLine, type LngLat, type PointGrid } from "./geo";
import type { Candidate } from "./routing";
import type { HourForecast, StaticEnv, TripSummary } from "./env";

const SAMPLE_M = 25;
const TREE_RADIUS_M = 15; // a street tree within ~15 m shades the sidewalk
const TRUCK_RADIUS_M = 30;
const PARK_SHADE = 0.7; // large parks: park trees aren't in the street census
// Roles other than Fastest must stay within 35% or 8 minutes of it, whichever is more.
const MAX_DETOUR = 1.35;
const MAX_DETOUR_MIN = 8;

export type RouteAnalysis = Candidate & {
  shade: number; // 0–1 share of the walk under tree cover
  shadeSource: "trees" | "neighborhood"; // street-level trees, or neighborhood-density fallback
  trafficShare: number; // 0–1 share of the walk within 30 m of a truck route
  pm25: number; // time-weighted mean, µg/m³ (district annual mean)
  no2: number; // ppb
  surfaceTemp: number | null; // °F, neighborhood mean surface temperature
};

// Fallback when street-level tree data is unreachable: neighborhood density
// mapped to shade. Calibrated so Park Slope (~1,900 trees/km²) ≈ 64% shade,
// close to its street-level estimate.
const DENSITY_FOR_FULL_SHADE = 3000;

type NtaTrees = { find(p: LngLat): { density: number } | null };

export function analyzeRoute(
  c: Candidate,
  env: StaticEnv,
  trees: PointGrid | null,
  ntaTrees: NtaTrees | null,
): RouteAnalysis {
  const pts = sampleLine(c.line, SAMPLE_M);
  let shade = 0, traffic = 0, pm25 = 0, no2 = 0, airN = 0, temp = 0, tempN = 0;
  for (const p of pts) {
    const nta = env.nta.find(p);
    // ~3 trees within reach ≈ a continuously shaded stretch of sidewalk.
    const treeShade = trees
      ? Math.min(1, trees.countWithin(p, TREE_RADIUS_M) / 3)
      : Math.min(1, (ntaTrees?.find(p)?.density ?? 0) / DENSITY_FOR_FULL_SHADE);
    shade += nta?.park ? Math.max(treeShade, PARK_SHADE) : treeShade;
    if (env.trucks.isWithin(p, TRUCK_RADIUS_M)) traffic++;
    const air = env.air.find(p);
    if (air) { pm25 += air.pm25; no2 += air.no2; airN++; }
    if (nta?.surfaceTemp != null) { temp += nta.surfaceTemp; tempN++; }
  }
  const { pm25: pmRange, no2: noRange } = env.summary;
  return {
    ...c,
    shade: shade / pts.length,
    shadeSource: trees ? "trees" : "neighborhood",
    trafficShare: traffic / pts.length,
    pm25: airN ? pm25 / airN : (pmRange.min + pmRange.max) / 2,
    no2: airN ? no2 / airN : (noRange.min + noRange.max) / 2,
    surfaceTemp: tempN ? temp / tempN : null,
  };
}

// --- profiles ------------------------------------------------------------------

export const PROFILES = {
  general: { label: "General", short: "general use", weights: { time: 0.5, air: 0.15, traffic: 0.15, heat: 0.2 } },
  asthma: { label: "Asthma", short: "asthma", weights: { time: 0.25, air: 0.25, traffic: 0.4, heat: 0.1 } },
  heat: { label: "Heat-sensitive", short: "heat sensitivity", weights: { time: 0.3, air: 0.05, traffic: 0.1, heat: 0.55 } },
} as const;

export type ProfileId = keyof typeof PROFILES;

// Fixed normalisation ranges (not relative to the other routes), so small
// differences between routes stay small.
const NORM = { minutes: 40, airDose: 30, trafficMin: 12, sunHeatMin: 20 };

export type Conditions = {
  time: Date;
  forecast: HourForecast | null;
  sunAltitude: number; // degrees
  sunFactor: number; // 0 (sun down) – 1 (high sun)
  heatFactor: number; // 0 (mild) – ~1.4 (extreme)
};

export function conditionsAt(time: Date, forecast: HourForecast[], at: LngLat): Conditions {
  const hour = forecast.find((f) => Math.abs(f.time.getTime() - time.getTime()) < 30 * 60 * 1000) ?? null;
  const sunAltitude = getPosition(time, at[1], at[0]).altitude;
  const sunFactor = Math.max(0, Math.min(1, Math.sin((sunAltitude * Math.PI) / 180) / Math.sin(Math.PI / 4)));
  const hi = hour?.heatIndexF ?? 75;
  const heatFactor = Math.max(0, Math.min(1.4, (hi - 65) / 25));
  return { time, forecast: hour, sunAltitude, sunFactor, heatFactor };
}

export type AirLevel = "Lower" | "Moderate" | "Higher";

export type RouteMetrics = {
  sunMinutes: number; // minutes in estimated direct sun at departure
  trafficMinutes: number;
  airIndex: number; // 0–1 within NYC's range of district averages
  airLevel: AirLevel;
  exposure: number; // 0–100 estimated environmental exposure (profile-independent)
  parts: { time: number; air: number; traffic: number; heat: number }; // normalised
};

function level(value: number, [lo, hi]: [number, number]): number {
  return value < lo ? 0 : value < hi ? 1 : 2;
}

export function metricsFor(r: RouteAnalysis, cond: Conditions, s: TripSummary): RouteMetrics {
  const norm = (v: number, { min, max }: { min: number; max: number }) => Math.max(0, Math.min(1, (v - min) / (max - min)));
  const airIndex = (norm(r.pm25, s.pm25) + norm(r.no2, s.no2)) / 2;
  const airLevel = (["Lower", "Moderate", "Higher"] as const)[
    Math.max(level(r.pm25, s.pm25.terciles), level(r.no2, s.no2.terciles))
  ];
  const sunMinutes = r.minutes * (1 - r.shade) * cond.sunFactor;
  // Hotter neighborhoods (surface temperature) add up to 30% to heat load.
  const surface = r.surfaceTemp == null ? 0.5 : norm(r.surfaceTemp, s.surfaceTemp);
  const sunHeat = sunMinutes * (0.25 + cond.heatFactor) * (0.85 + 0.3 * surface);
  const trafficMinutes = r.minutes * r.trafficShare;
  const parts = {
    time: r.minutes / NORM.minutes,
    air: (airIndex * r.minutes) / NORM.airDose,
    traffic: trafficMinutes / NORM.trafficMin,
    heat: sunHeat / NORM.sunHeatMin,
  };
  const exposure = Math.round(100 * Math.min(1, (parts.air + parts.traffic + parts.heat) / 3));
  return { sunMinutes, trafficMinutes, airIndex, airLevel, exposure, parts };
}

// --- roles & recommendation ------------------------------------------------------

export type Role = "fastest" | "lowerExposure" | "shaded";

export const ROLE_LABELS: Record<Role, string> = {
  fastest: "Fastest",
  lowerExposure: "Lower exposure",
  shaded: "Most shaded",
};

export type ScoredRoute = RouteAnalysis & {
  roles: Role[];
  metrics: RouteMetrics;
  score: number;
  extraMinutes: number;
};

export type TripResult = {
  routes: ScoredRoute[]; // up to 3, in role order
  recommendedId: string;
  explanation: string;
};

/** Pick the Fastest / Lower-exposure / Most-shaded routes (time-independent). */
export function pickRoles(routes: RouteAnalysis[], s: TripSummary): { route: RouteAnalysis; roles: Role[] }[] {
  const fastest = routes.reduce((a, b) => (b.minutes < a.minutes ? b : a));
  const limit = Math.max(fastest.minutes * MAX_DETOUR, fastest.minutes + MAX_DETOUR_MIN);
  const within = routes.filter((r) => r.minutes <= limit);
  // Lower exposure = air + traffic dose, which don't depend on time of day.
  const neutral = { time: new Date(), forecast: null, sunAltitude: 0, sunFactor: 0, heatFactor: 0 };
  const dose = (r: RouteAnalysis) => {
    const m = metricsFor(r, neutral, s);
    return m.parts.air + m.parts.traffic;
  };
  const lower = within.reduce((a, b) => (dose(b) < dose(a) - 0.01 ? b : a), fastest);
  const shaded = within.reduce((a, b) => (b.shade > a.shade + 0.01 ? b : a), fastest);

  const picks: { route: RouteAnalysis; roles: Role[] }[] = [];
  for (const [role, route] of [["fastest", fastest], ["lowerExposure", lower], ["shaded", shaded]] as const) {
    const existing = picks.find((p) => p.route.id === route.id);
    if (existing) existing.roles.push(role);
    else picks.push({ route, roles: [role] });
  }
  return picks;
}

const pct = (v: number) => `${Math.round(v * 100)}%`;

function explain(rec: ScoredRoute, fastest: ScoredRoute, profile: ProfileId, cond: Conditions): string {
  const who = `Recommended for ${PROFILES[profile].short}`;
  if (rec.id === fastest.id) {
    if (cond.sunFactor === 0 && profile === "heat") {
      return `${who}: the sun is down, so shade matters less — the fastest route keeps time outdoors shortest.`;
    }
    return `${who}: the fastest route, and the other options don't lower estimated exposure enough to justify the extra walk.`;
  }
  const w = PROFILES[profile].weights;
  const gains = [
    { key: "traffic", gain: w.traffic * (fastest.metrics.parts.traffic - rec.metrics.parts.traffic) },
    { key: "air", gain: w.air * (fastest.metrics.parts.air - rec.metrics.parts.air) },
    { key: "heat", gain: w.heat * (fastest.metrics.parts.heat - rec.metrics.parts.heat) },
  ].sort((a, b) => b.gain - a.gain);
  const reason =
    gains[0].key === "traffic"
      ? `avoids higher-traffic streets (${Math.round(rec.metrics.trafficMinutes)} vs ${Math.round(fastest.metrics.trafficMinutes)} min near truck routes)`
      : gains[0].key === "air"
        ? "passes through areas with lower average air pollution"
        : `more shade at this hour (${pct(rec.shade)} shaded vs ${pct(fastest.shade)} on the fastest route)`;
  const extra = Math.round(rec.extraMinutes);
  const cost = extra <= 1 ? "for about the same walking time" : `with only ${extra} extra minutes of walking`;
  return `${who}: ${reason}, ${cost}.`;
}

export function scoreTrip(
  picks: { route: RouteAnalysis; roles: Role[] }[],
  profile: ProfileId,
  cond: Conditions,
  s: TripSummary,
): TripResult {
  const w = PROFILES[profile].weights;
  const fastestMinutes = Math.min(...picks.map((p) => p.route.minutes));
  const routes: ScoredRoute[] = picks.map(({ route, roles }) => {
    const metrics = metricsFor(route, cond, s);
    const p = metrics.parts;
    return {
      ...route,
      roles,
      metrics,
      score: w.time * p.time + w.air * p.air + w.traffic * p.traffic + w.heat * p.heat,
      extraMinutes: route.minutes - fastestMinutes,
    };
  });
  const rec = routes.reduce((a, b) => (b.score < a.score ? b : a));
  const fastest = routes.find((r) => r.roles.includes("fastest"))!;
  return { routes, recommendedId: rec.id, explanation: explain(rec, fastest, profile, cond) };
}
