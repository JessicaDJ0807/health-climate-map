"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { fetchForecast, fetchTreeGrid, loadStaticEnv, type HourForecast, type TripSummary } from "@/lib/trip/env";
import { fetchCandidates } from "@/lib/trip/routing";
import {
  PROFILES,
  analyzeRoute,
  conditionsAt,
  pickRoles,
  scoreTrip,
  type ProfileId,
  type RouteAnalysis,
  type Role,
} from "@/lib/trip/score";
import PlaceInput, { type Place } from "./PlaceInput";
import RouteCard from "./RouteCard";

// MapLibre needs `window`, so skip server prerendering for the map.
const TripMap = dynamic(() => import("./TripMap"), { ssr: false });

// Sample trips where the three route options clearly differ.
const DEMO_TRIPS: { name: string; from: Place; to: Place }[] = [
  {
    name: "Grand Army Plaza → Barclays Center",
    from: { label: "Grand Army Plaza, Brooklyn", lng: -73.9701, lat: 40.6743 },
    to: { label: "Barclays Center, Brooklyn", lng: -73.9754, lat: 40.6826 },
  },
  {
    name: "Atlantic Terminal → Prospect Park West",
    from: { label: "Atlantic Terminal, Brooklyn", lng: -73.9772, lat: 40.6844 },
    to: { label: "Prospect Park West & 3rd St", lng: -73.9719, lat: 40.672 },
  },
];

const HOURS_AHEAD = 12;
// Demo scenario for a mild forecast: a humid summer afternoon.
const HOT_DAY = { tempF: 92, humidity: 45, heatIndexF: 95 };

type Picks = { route: RouteAnalysis; roles: Role[] }[];
type Status = { state: "idle" | "loading" | "ready" | "error"; message?: string };

function departureTime(offset: number, now: Date) {
  if (offset === 0) return now;
  const t = new Date(now);
  t.setMinutes(0, 0, 0);
  t.setHours(t.getHours() + offset);
  return t;
}

const hourLabel = (d: Date) => d.toLocaleTimeString("en-US", { hour: "numeric", minute: d.getMinutes() ? "2-digit" : undefined });

function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: { id: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex rounded-lg bg-[#f0efec] p-0.5">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={value === o.id}
          onClick={() => onChange(o.id)}
          className={`flex-1 rounded-md px-2 py-1.5 text-xs font-medium transition ${
            value === o.id ? "bg-white text-[#0b0b0b] shadow-sm" : "text-[#52514e] hover:text-[#0b0b0b]"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export default function TripPlanner() {
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
      try {
        const from: [number, number] = [origin.lng, origin.lat];
        const to: [number, number] = [destination.lng, destination.lat];
        const env = await loadStaticEnv();
        const candidates = await fetchCandidates(from, to, ctrl.signal);
        const trees = await fetchTreeGrid(candidates.map((c) => c.line), ctrl.signal);
        const analyses = candidates.map((c) => analyzeRoute(c, env, trees));
        setPicks(pickRoles(analyses, env.summary));
        setStatus({ state: "ready" });
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        setStatus({ state: "error", message: "Couldn't load walking routes right now. Try again in a moment." });
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

  const changeProfile = (p: ProfileId) => { setProfile(p); setSelectedId(null); };
  const changeOffset = (o: number) => { setOffset(o); setSelectedId(null); };

  const weatherLine = cond.forecast
    ? `${cond.forecast.tempF}°F, feels like ${cond.forecast.heatIndexF}°F`
    : weather === "hot" ? `${HOT_DAY.tempF}°F, feels like ${HOT_DAY.heatIndexF}°F` : "Forecast unavailable";
  const sunLine = cond.sunAltitude <= 0 ? "sun down" : cond.sunAltitude < 20 ? "sun low" : "sun high";

  return (
    <div className="relative h-full w-full">
      <TripMap
        origin={origin}
        destination={destination}
        routes={result?.routes ?? []}
        recommendedId={result?.recommendedId ?? null}
        selectedId={shownSelection}
        onSelect={setSelectedId}
      />

      <aside className="absolute inset-x-2 bottom-2 flex max-h-[52vh] flex-col overflow-hidden rounded-2xl bg-[#fcfcfb] shadow-xl ring-1 ring-black/10 sm:inset-x-auto sm:bottom-4 sm:left-4 sm:top-4 sm:max-h-none sm:w-[380px]">
        <div className="overflow-y-auto p-4">
          <header className="mb-3 flex items-start justify-between gap-3">
            <div>
              <h1 className="text-lg font-semibold text-[#0b0b0b]">Safer Walk NYC</h1>
              <p className="text-xs text-[#52514e]">Walking routes compared by estimated environmental exposure</p>
            </div>
            <Link href="/trees" className="shrink-0 text-xs text-[#2a78d6] hover:underline">
              Tree map
            </Link>
          </header>

          <div className="space-y-2">
            <PlaceInput label="From" marker="A" value={origin} onChange={setOrigin} placeholder="Starting point" />
            <PlaceInput label="To" marker="B" value={destination} onChange={setDestination} placeholder="Destination" />
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {DEMO_TRIPS.map((t) => (
              <button
                key={t.name}
                type="button"
                onClick={() => { setOrigin(t.from); setDestination(t.to); }}
                className="rounded-full px-2.5 py-1 text-[11px] text-[#52514e] ring-1 ring-black/10 hover:bg-[#f0efec]"
              >
                {t.name}
              </button>
            ))}
          </div>

          <div className="mt-4 space-y-3">
            <div>
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-[#52514e]">Health profile</div>
              <Segmented
                label="Health profile"
                value={profile}
                onChange={changeProfile}
                options={(Object.keys(PROFILES) as ProfileId[]).map((id) => ({ id, label: PROFILES[id].label }))}
              />
            </div>
            <div>
              <div className="mb-1 flex items-baseline justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-[#52514e]">Leave at</span>
                <span className="text-sm font-semibold text-[#0b0b0b]">{offset === 0 ? "Now" : hourLabel(departure)}</span>
              </div>
              <input
                type="range"
                min={0}
                max={HOURS_AHEAD}
                value={offset}
                onChange={(e) => changeOffset(Number(e.target.value))}
                aria-label="Departure time"
                aria-valuetext={offset === 0 ? "Now" : hourLabel(departure)}
                className="w-full accent-[#0b0b0b]"
              />
              <div className="flex items-center justify-between gap-2 text-xs text-[#52514e]">
                <span>{weatherLine} · {sunLine}</span>
                <Segmented
                  label="Weather"
                  value={weather}
                  onChange={setWeather}
                  options={[{ id: "forecast", label: "Forecast" }, { id: "hot", label: "Hot day" }]}
                />
              </div>
            </div>
          </div>

          <div className="mt-4">
            {status.state === "idle" && (
              <p className="text-sm text-[#52514e]">Choose a start and destination, or try a sample trip.</p>
            )}
            {status.state === "loading" && <p className="text-sm text-[#52514e]">Finding walking routes…</p>}
            {status.state === "error" && <p className="text-sm text-[#d03b3b]">{status.message}</p>}
            {result && (
              <>
                <p className="mb-3 rounded-lg bg-[#f0efec] px-3 py-2 text-sm text-[#0b0b0b]">{result.explanation}</p>
                <div className="space-y-2">
                  {result.routes.map((r) => (
                    <RouteCard
                      key={r.id}
                      route={r}
                      recommended={r.id === result.recommendedId}
                      profileLabel={PROFILES[profile].short}
                      selected={r.id === shownSelection}
                      onSelect={() => setSelectedId(r.id)}
                    />
                  ))}
                </div>
                {result.routes.length < 3 && (
                  <p className="mt-2 text-[11px] text-[#898781]">
                    Some options are the same route here, so their labels are combined.
                  </p>
                )}
              </>
            )}
          </div>

          <footer className="mt-4 border-t border-[#e1e0d9] pt-3 text-[11px] leading-relaxed text-[#898781]">
            Estimates from public NYC data: street trees (2015 census), air quality ({summary?.airYear ?? "2025"} annual
            averages by community district), NYC truck routes, and the National Weather Service forecast. Supports
            route choice only — not medical advice.
          </footer>
        </div>
      </aside>
    </div>
  );
}
