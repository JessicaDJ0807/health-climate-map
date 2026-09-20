"use client";

// All trip state and the analyse → score pipeline, shared by the desktop and
// phone shells so both run one fetch and one scoring pass.
import { useEffect, useState } from "react";
import {
  fetchForecast,
  loadNtaTrees,
  loadStaticEnv,
  loadTreeGrid,
  type HourForecast,
  type TripSummary,
} from "@/lib/trip/env";
import { currentPlace, reverseGeocode, type SearchNear } from "@/lib/trip/geocode";
import { fetchCandidates } from "@/lib/trip/routing";
import {
  analyzeRoute,
  conditionsAt,
  pickRoles,
  sampleExposure,
  scoreTrip,
  type ProfileId,
  type RouteAnalysis,
  type Role,
} from "@/lib/trip/score";
import { distanceM, type LngLat } from "@/lib/trip/geo";
import type { Place } from "./PlaceInput";
import type { Endpoint } from "./TripMap";
import { ROLE_COLORS, exposureColor } from "./style";

/** One step of the exposure profile: where it is, and how exposed it is. */
export type ProfilePoint = { at: LngLat; value: number; color: string };

/** Sample trips where the three route options clearly differ. */
export const DEMO_TRIPS: { name: string; short: string; from: Place; to: Place }[] = [
  {
    name: "Grand Army Plaza → Barclays Center",
    short: "Grand Army → Barclays",
    from: { label: "Grand Army Plaza, Brooklyn", lng: -73.9701, lat: 40.6743 },
    to: { label: "Barclays Center, Brooklyn", lng: -73.9754, lat: 40.6826 },
  },
  {
    name: "Atlantic Terminal → Prospect Park West",
    short: "Atlantic → Prospect Pk W",
    from: { label: "Atlantic Terminal, Brooklyn", lng: -73.9772, lat: 40.6844 },
    to: { label: "Prospect Park West & 3rd St", lng: -73.9719, lat: 40.672 },
  },
];

export const HOURS_AHEAD = 12;
// Below this, start and destination are effectively the same place.
const MIN_TRIP_M = 50;
// Steps shown in the exposure strip and used as map gradient stops.
const PROFILE_STEPS = 60;
// Demo scenario for a mild forecast: a humid summer afternoon.
const HOT_DAY = { tempF: 92, humidity: 45, heatIndexF: 95 };

type Picks = { route: RouteAnalysis; roles: Role[] }[];
export type Status = { state: "idle" | "loading" | "ready" | "error"; message?: string };

function departureTime(offset: number, now: Date) {
  if (offset === 0) return now;
  const t = new Date(now);
  t.setMinutes(0, 0, 0);
  t.setHours(t.getHours() + offset);
  return t;
}

export const hourLabel = (d: Date) =>
  d.toLocaleTimeString("en-US", { hour: "numeric", minute: d.getMinutes() ? "2-digit" : undefined });

export function useTrip() {
  const [origin, setOrigin] = useState<Place | null>(null);
  const [destination, setDestination] = useState<Place | null>(null);
  const [profile, setProfile] = useState<ProfileId>("general");
  const [offset, setOffset] = useState(0);
  const [weather, setWeather] = useState<"forecast" | "hot">("forecast");
  const [forecast, setForecast] = useState<HourForecast[]>([]);
  const [summary, setSummary] = useState<TripSummary | null>(null);
  const [picks, setPicks] = useState<Picks>([]);
  const [status, setStatus] = useState<Status>({ state: "idle" });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mapView, setMapView] = useState<SearchNear | undefined>(undefined);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [hoverPoint, setHoverPoint] = useState<LngLat | null>(null);
  const [now] = useState(() => new Date());

  useEffect(() => {
    fetchForecast().then(setForecast).catch(() => setForecast([]));
    loadStaticEnv().then((env) => setSummary(env.summary));
  }, []);

  // Fetch and analyse routes once per origin/destination pair.
  useEffect(() => {
    if (!origin || !destination) return;
    const ctrl = new AbortController();
    (async () => {
      setStatus({ state: "loading" });
      setPicks([]);
      setSelectedId(null);
      const from: [number, number] = [origin.lng, origin.lat];
      const to: [number, number] = [destination.lng, destination.lat];
      if (distanceM(from, to) < MIN_TRIP_M) {
        setStatus({
          state: "error",
          message: "Start and destination are the same place. Pick two different points.",
        });
        return;
      }
      try {
        const env = await loadStaticEnv();
        let candidates;
        try {
          candidates = await fetchCandidates(from, to, ctrl.signal);
        } catch (err) {
          if ((err as Error).name === "AbortError") throw err;
          setStatus({ state: "error", message: "The walking-route service isn't responding. Try again in a moment." });
          return;
        }
        // Street-level trees if reachable; otherwise neighborhood tree density.
        const trees = await loadTreeGrid(candidates.map((c) => c.line), ctrl.signal);
        const ntaTrees = trees ? null : await loadNtaTrees();
        const analyses = candidates.map((c) => analyzeRoute(c, env, trees, ntaTrees));
        setPicks(pickRoles(analyses, env.summary));
        setStatus({
          state: "ready",
          message: trees ? undefined : "Street-level tree data is unavailable right now, so shade uses neighborhood averages.",
        });
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        setStatus({ state: "error", message: "Couldn't load this trip. Try again in a moment." });
      }
    })();
    return () => ctrl.abort();
  }, [origin, destination]);

  // Scoring is a cheap pure function, so profile / time changes re-rank on
  // every render without refetching (React Compiler memoizes this component).
  const departure = departureTime(offset, now);
  const hourly = weather === "hot" ? forecast.map((f) => ({ ...f, ...HOT_DAY })) : forecast;
  const center: [number, number] = origin && destination
    ? [(origin.lng + destination.lng) / 2, (origin.lat + destination.lat) / 2]
    : [-73.97, 40.73];
  // Hot-day scenario still works if the live forecast failed to load.
  const cond = conditionsAt(departure, weather === "hot" && !hourly.length ? [{ time: departure, ...HOT_DAY }] : hourly, center);
  const result = picks.length && summary ? scoreTrip(picks, profile, cond, summary) : null;
  const shownSelection = selectedId && result?.routes.some((r) => r.id === selectedId) ? selectedId : result?.recommendedId ?? null;

  // Exposure profile of the selected route: colour per step, for the strip in
  // its card and the gradient on the map.
  const selectedRoute = result?.routes.find((r) => r.id === shownSelection) ?? null;
  const profileSteps = selectedRoute ? Math.min(PROFILE_STEPS, selectedRoute.samples.length) : 0;
  const exposureProfile: ProfilePoint[] = selectedRoute
    ? Array.from({ length: profileSteps }, (_, i) => {
        const at = Math.round((i / Math.max(1, profileSteps - 1)) * (selectedRoute.samples.length - 1));
        const sample = selectedRoute.samples[at];
        const value = sampleExposure(sample, cond);
        return { at: sample.at, value, color: exposureColor(ROLE_COLORS[selectedRoute.roles[0]], value) };
      })
    : [];
  const gradient = selectedRoute && exposureProfile.length > 1
    ? {
        line: selectedRoute.line,
        stops: exposureProfile.map((p, i) => ({ t: i / (exposureProfile.length - 1), color: p.color })),
      }
    : null;

  // Map click / marker drag: look up the nearest address for the label, then set
  // the endpoint once (setting it triggers the route fetch).
  const pickOnMap = async (which: Endpoint, lng: number, lat: number) => {
    const place = await reverseGeocode(lng, lat);
    if (which === "origin") setOrigin(place);
    else setDestination(place);
  };

  const pickCurrentLocation = async (which: Endpoint) => {
    setLocationError(null);
    try {
      const place = await currentPlace();
      if (which === "origin") setOrigin(place);
      else setDestination(place);
    } catch (err) {
      setLocationError((err as Error).message);
    }
  };

  const changeProfile = (p: ProfileId) => { setProfile(p); setSelectedId(null); };
  const changeOffset = (o: number) => { setOffset(o); setSelectedId(null); };

  const weatherLine = cond.forecast
    ? `${cond.forecast.tempF}°F, feels like ${cond.forecast.heatIndexF}°F`
    : weather === "hot" ? `${HOT_DAY.tempF}°F, feels like ${HOT_DAY.heatIndexF}°F` : "Forecast unavailable";
  const sunLine = cond.sunAltitude <= 0 ? "sun down" : cond.sunAltitude < 20 ? "sun low" : "sun high";

  return {
    origin, setOrigin, destination, setDestination,
    profile, changeProfile, offset, changeOffset, departure,
    weather, setWeather, summary, status, cond, result,
    shownSelection, setSelectedId, exposureProfile, gradient,
    mapView, setMapView, locationError, hoverPoint, setHoverPoint,
    pickOnMap, pickCurrentLocation, weatherLine, sunLine,
  };
}
