// Estimated environmental exposure for candidate walking routes.
//
// Routes are sampled once (analyzeRoute). Everything that depends on the
// health profile or departure time (scoreRoutes) is a cheap pure function, so
// toggles re-rank instantly. Outputs are estimated exposure, not medical risk.
import { getPosition } from "suncalc";
import { sampleLine, type LngLat, type PointGrid } from "./geo";
import type { Candidate } from "./routing";
import type { HourForecast, StaticEnv, TripSummary } from "./env";
import { pollenLevel, pollenSeasonFactor, type PollenLevel } from "./pollen";
import { SHOW_POLLEN } from "./features";

const SAMPLE_M = 25;
const TREE_RADIUS_M = 15; // a street tree within ~15 m shades the sidewalk
// Pollen carries much further than shade, so it is gathered over a wider
// circle. Class 2 genera count double class 1; POLLEN_SATURATION is the
// weighted count at which a block is treated as fully loaded. Calibrated on
// 4,000 tree locations sampled citywide: at 40 the index clips at 1.0 for only
// the densest 13% of the city, and its terciles fall at 0.25 and 0.5, which
// are the thresholds pollenLevel() reports against.
const POLLEN_RADIUS_M = 50;
const POLLEN_SATURATION = 40;
const TRUCK_RADIUS_M = 30;
// Floor for large parks. The Forestry inventory does include park interiors,
// but a uniform sample of Prospect Park still measures only ~0.44 shade
// because meadows, ballfields and the lake dilute it — while park *paths*,
// which is where routes actually go, are tree-lined. Until shade is sampled
// along paths rather than area, the floor stands in for that difference.
const PARK_SHADE = 0.7;
// Roles other than Fastest must stay within 35% or 8 minutes of it, whichever is more.
const MAX_DETOUR = 1.35;
const MAX_DETOUR_MIN = 8;

/** One sampled point along a route, kept for the exposure profile. */
export type RouteSample = {
  at: LngLat;
  t: number; // 0–1 position along the route
  shade: number; // 0–1
  pollen: number; // 0–1 allergenic-species load nearby (season applied later)
  truck: boolean; // within 30 m of a truck route
  air: number; // 0–1 within NYC's range
  surface: number; // 0–1 neighborhood surface temperature within NYC's range
};

export type RouteAnalysis = Candidate & {
  samples: RouteSample[];
  shade: number; // 0–1 share of the walk under tree cover
  shadeSource: "trees" | "neighborhood"; // street-level trees, or neighborhood-density fallback
  trafficShare: number; // 0–1 share of the walk within 30 m of a truck route
  pollenIndex: number; // 0–1 mean allergenic-species load along the walk
  pollenSource: "species" | null; // null when no tree source was reachable
  pm25: number; // time-weighted mean, µg/m³ (district annual mean)
  no2: number; // ppb
  surfaceTemp: number | null; // °F, neighborhood mean surface temperature
};

// Fallback when street-level tree data is unreachable: neighborhood density
// mapped to shade. Calibrated so Park Slope (~2,150 trees/km²) ≈ 64% shade,
// close to its street-level estimate.
const DENSITY_FOR_FULL_SHADE = 3400;

type NtaTrees = { find(p: LngLat): { density: number } | null };

export function analyzeRoute(
  c: Candidate,
  env: StaticEnv,
  trees: PointGrid | null,
  ntaTrees: NtaTrees | null,
): RouteAnalysis {
  const pts = sampleLine(c.line, SAMPLE_M);
  const samples: RouteSample[] = [];
  const norm = (v: number, { min, max }: { min: number; max: number }) => Math.max(0, Math.min(1, (v - min) / (max - min)));
  let shade = 0, pollen = 0, traffic = 0, pm25 = 0, no2 = 0, airN = 0, temp = 0, tempN = 0;
  for (const [i, p] of pts.entries()) {
    const nta = env.nta.find(p);
    // ~3 trees within reach ≈ a continuously shaded stretch of sidewalk.
    const treeShade = trees
      ? Math.min(1, trees.countWithin(p, TREE_RADIUS_M) / 3)
      : Math.min(1, (ntaTrees?.find(p)?.density ?? 0) / DENSITY_FOR_FULL_SHADE);
    // Without a tree source there is no species information, so pollen is
    // simply unknown — the neighborhood-density fallback says nothing about
    // which species those trees are.
    const pollenHere = SHOW_POLLEN && trees
      ? Math.min(1, trees.within(p, POLLEN_RADIUS_M).weight / POLLEN_SATURATION)
      : 0;
    pollen += pollenHere;
    shade += nta?.park ? Math.max(treeShade, PARK_SHADE) : treeShade;
    const nearTruck = env.trucks.isWithin(p, TRUCK_RADIUS_M);
    if (nearTruck) traffic++;
    const air = env.air.find(p);
    if (air) { pm25 += air.pm25; no2 += air.no2; airN++; }
    if (nta?.surfaceTemp != null) { temp += nta.surfaceTemp; tempN++; }
    samples.push({
      at: p,
      t: pts.length > 1 ? i / (pts.length - 1) : 0,
      shade: nta?.park ? Math.max(treeShade, PARK_SHADE) : treeShade,
      pollen: pollenHere,
      truck: nearTruck,
      air: air ? (norm(air.pm25, env.summary.pm25) + norm(air.no2, env.summary.no2)) / 2 : 0.5,
      surface: nta?.surfaceTemp == null ? 0.5 : norm(nta.surfaceTemp, env.summary.surfaceTemp),
    });
  }
  const { pm25: pmRange, no2: noRange } = env.summary;
  return {
    ...c,
    samples,
    shade: shade / pts.length,
    shadeSource: trees ? "trees" : "neighborhood",
    trafficShare: traffic / pts.length,
    pollenIndex: SHOW_POLLEN && trees ? pollen / pts.length : 0,
    pollenSource: SHOW_POLLEN && trees ? "species" : null,
    pm25: airN ? pm25 / airN : (pmRange.min + pmRange.max) / 2,
    no2: airN ? no2 / airN : (noRange.min + noRange.max) / 2,
    surfaceTemp: tempN ? temp / tempN : null,
  };
}

// --- profiles ------------------------------------------------------------------

// Weights sum to 1 within each profile.
//
// Asthma's pollen weight is 0 while the allergenic-tree axis is hidden (see
// features.ts). Allergic asthma would justify roughly 0.1 there, taken back
// out of air and traffic — restore that only alongside SHOW_POLLEN, so the
// ranking never depends on a factor the UI doesn't show.
export const PROFILES = {
  general: { label: "General", short: "general use", weights: { time: 0.5, air: 0.15, traffic: 0.15, heat: 0.2, pollen: 0 } },
  asthma: { label: "Asthma", short: "asthma", weights: { time: 0.25, air: 0.25, traffic: 0.4, heat: 0.1, pollen: 0 } },
  heat: { label: "Heat-sensitive", short: "heat sensitivity", weights: { time: 0.3, air: 0.05, traffic: 0.1, heat: 0.55, pollen: 0 } },
  allergy: { label: "Pollen-sensitive", short: "pollen sensitivity", weights: { time: 0.3, air: 0.1, traffic: 0.1, heat: 0.1, pollen: 0.4 } },
} as const;

export type ProfileId = keyof typeof PROFILES;

/** The profiles offered in the UI. Pollen-sensitive is hidden with its axis. */
export const VISIBLE_PROFILES = (Object.keys(PROFILES) as ProfileId[]).filter(
  (id) => SHOW_POLLEN || id !== "allergy",
);

// Fixed normalisation ranges (not relative to the other routes), so small
// differences between routes stay small.
const NORM = { minutes: 40, airDose: 30, trafficMin: 12, sunHeatMin: 20, pollenDose: 20 };

export type Conditions = {
  time: Date;
  forecast: HourForecast | null;
  sunAltitude: number; // degrees
  sunFactor: number; // 0 (sun down) – 1 (high sun)
  heatFactor: number; // 0 (mild) – ~1.4 (extreme)
  pollenFactor: number; // 0 (out of season) – 1 (April peak)
};

export function conditionsAt(time: Date, forecast: HourForecast[], at: LngLat): Conditions {
  const hour = forecast.find((f) => Math.abs(f.time.getTime() - time.getTime()) < 30 * 60 * 1000) ?? null;
  const sunAltitude = getPosition(time, at[1], at[0]).altitude;
  const sunFactor = Math.max(0, Math.min(1, Math.sin((sunAltitude * Math.PI) / 180) / Math.sin(Math.PI / 4)));
  const hi = hour?.heatIndexF ?? 75;
  const heatFactor = Math.max(0, Math.min(1.4, (hi - 65) / 25));
  return {
    time, forecast: hour, sunAltitude, sunFactor, heatFactor,
    pollenFactor: SHOW_POLLEN ? pollenSeasonFactor(time) : 0,
  };
}

export type AirLevel = "Lower" | "Moderate" | "Higher";

export type RouteMetrics = {
  sunMinutes: number; // minutes in estimated direct sun at departure
  trafficMinutes: number;
  airIndex: number; // 0–1 within NYC's range of district averages
  airLevel: AirLevel;
  pollenIndex: number; // 0–1 allergenic-species load, season applied
  pollenLevel: PollenLevel;
  pollenMinutes: number; // minutes beside wind-pollinated trees, in season
  exposure: number; // 0–100 estimated environmental exposure (profile-independent)
  parts: { time: number; air: number; traffic: number; heat: number; pollen: number }; // normalised
};

function level(value: number, [lo, hi]: [number, number]): number {
  return value < lo ? 0 : value < hi ? 1 : 2;
}

/**
 * Exposure *intensity* at one point, 0–1: the average of air, traffic and
 * sun/heat right there. (The card's exposure bar is the whole-walk dose, which
 * also grows with time; this is the local picture used by the profile strip.)
 */
export function sampleExposure(s: RouteSample, cond: Conditions): number {
  const heat = Math.min(1, ((1 - s.shade) * cond.sunFactor * (0.25 + cond.heatFactor) * (0.85 + 0.3 * s.surface)) / 1.2);
  return (s.air + (s.truck ? 1 : 0) + heat) / 3;
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
  const pollenIdx = r.pollenIndex * cond.pollenFactor;
  const pollenMinutes = r.minutes * pollenIdx;
  const parts = {
    time: r.minutes / NORM.minutes,
    air: (airIndex * r.minutes) / NORM.airDose,
    traffic: trafficMinutes / NORM.trafficMin,
    heat: sunHeat / NORM.sunHeatMin,
    pollen: pollenMinutes / NORM.pollenDose,
  };
  // Exposure stays the three year-round physical stressors, so the number on
  // the card means the same thing in April as in November. Pollen is shown as
  // its own metric instead.
  const exposure = Math.round(100 * Math.min(1, (parts.air + parts.traffic + parts.heat) / 3));
  return {
    sunMinutes, trafficMinutes, airIndex, airLevel, exposure, parts,
    pollenIndex: pollenIdx, pollenLevel: pollenLevel(pollenIdx), pollenMinutes,
  };
}

// --- roles & recommendation ------------------------------------------------------

export type Role = "fastest" | "leastTraffic" | "shaded";

export const ROLE_LABELS: Record<Role, string> = {
  fastest: "Fastest",
  leastTraffic: "Least traffic",
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
  // Least traffic = fewest minutes beside truck routes, air breaking ties.
  // Neither depends on the time of day. District air values are usually
  // identical along one trip, so traffic is what actually separates routes.
  const neutral = { time: new Date(), forecast: null, sunAltitude: 0, sunFactor: 0, heatFactor: 0, pollenFactor: 0 };
  const dose = (r: RouteAnalysis) => {
    const m = metricsFor(r, neutral, s);
    return m.parts.traffic + 0.1 * m.parts.air;
  };
  const leastTraffic = within.reduce((a, b) => (dose(b) < dose(a) - 0.01 ? b : a), fastest);
  const shaded = within.reduce((a, b) => (b.shade > a.shade + 0.01 ? b : a), fastest);

  const picks: { route: RouteAnalysis; roles: Role[] }[] = [];
  for (const [role, route] of [["fastest", fastest], ["leastTraffic", leastTraffic], ["shaded", shaded]] as const) {
    const existing = picks.find((p) => p.route.id === route.id);
    if (existing) existing.roles.push(role);
    else picks.push({ route, roles: [role] });
  }
  return picks;
}

const pct = (v: number) => `${Math.round(v * 100)}%`;

function explain(rec: ScoredRoute, fastest: ScoredRoute, profile: ProfileId, cond: Conditions): string {
  const who = `Recommended for ${PROFILES[profile].short}`;
  if (profile === "allergy" && cond.pollenFactor === 0) {
    const when = rec.id === fastest.id ? "the fastest route" : `this route, ${Math.round(rec.extraMinutes)} min longer`;
    return `${who}: tree pollen is out of season, so ${when} is ranked on traffic, air and shade alone.`;
  }
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
    { key: "pollen", gain: w.pollen * (fastest.metrics.parts.pollen - rec.metrics.parts.pollen) },
  ].sort((a, b) => b.gain - a.gain);
  const reason =
    gains[0].key === "traffic"
      ? `avoids higher-traffic streets (${Math.round(rec.metrics.trafficMinutes)} vs ${Math.round(fastest.metrics.trafficMinutes)} min near truck routes)`
      : gains[0].key === "air"
        ? "passes through areas with lower average air pollution"
        : gains[0].key === "pollen"
          ? `fewer wind-pollinated trees along the way (${Math.round(rec.metrics.pollenMinutes)} vs ${Math.round(fastest.metrics.pollenMinutes)} min beside them)`
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
      score: w.time * p.time + w.air * p.air + w.traffic * p.traffic + w.heat * p.heat + w.pollen * p.pollen,
      extraMinutes: route.minutes - fastestMinutes,
    };
  });
  const rec = routes.reduce((a, b) => (b.score < a.score ? b : a));
  const fastest = routes.find((r) => r.roles.includes("fastest"))!;
  return { routes, recommendedId: rec.id, explanation: explain(rec, fastest, profile, cond) };
}
