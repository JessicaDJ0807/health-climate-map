# Safer Trip Planner — Hackathon Plan

> **Historical.** This is the plan written before the build, under the app's
> original name. The app shipped as **HavenPath NY** and several decisions here
> changed — the UI was rebuilt on the design team's handoff, and the pollen axis
> was built and then switched off. For how the app actually works today, read
> [`docs/HOW-IT-WORKS.md`](docs/HOW-IT-WORKS.md); for what it is, read the
> [README](README.md). Kept for the record of what was intended and why.

A condition-aware walking-route planner for NYC. Users enter an origin,
destination, departure time, and health profile (General, Asthma,
Heat-sensitive); the app compares 2–3 walking routes by **estimated
environmental exposure** — air pollution, traffic, shade, and heat — alongside
walking time, and recommends one for that profile and time.

It supports safer decision-making. It does **not** estimate medical risk or
give clinical advice.

Scope: walking trips only, built in ~1 day on the existing Next.js + MapLibre
app in this repo.

## Product shape

- **Layout:** full-screen map. Panel on the left on desktop, bottom sheet on
  phones.
- **Trip inputs:** origin and destination (address search), and a "Leave at"
  slider from now to +12 hours in 1-hour steps.
- **Health profile:** three buttons — General, Asthma, Heat-sensitive.
- **Weather:** live NWS forecast by default, plus a "Hot day" scenario
  (92°F, feels like 95°F) so the heat behaviour can be demoed on a mild day.
- **Three route cards,** each drawn in its own colour on the map:
  - **Fastest**
  - **Least traffic** — fewest minutes beside truck routes (renamed from
    "Lower-exposure", which didn't say exposure to what)
  - **Most shaded** — heat-conscious
- **Recommended route:** a "Recommended for asthma" style badge plus a
  one-line explanation, e.g. *"Avoids higher-traffic streets with only 3 extra
  minutes of walking."*
- **Each card shows:** walking time (and difference from fastest), shade %,
  air-quality level (Lower / Moderate / Higher), traffic exposure in minutes,
  temperature at departure, and an overall *estimated exposure* bar.
- **Instant toggles:** routes are fetched once per trip and sampled once.
  Changing profile or departure time only re-weights numbers in the browser,
  so the recommended badge moves immediately. This is the key demo moment.

## Datasets

| Factor | Source | Notes |
|---|---|---|
| Routes | Valhalla public router (`valhalla1.openstreetmap.de`), no key | Default route + 2 alternatives + 2 detours forced through a point on either side of the direct line |
| Shade | 2015 NYC Street Tree Census (`uvpi-gqnh`) + sun angle from `suncalc` | Share of route with trees within 15 m. Trees are from 2015 (latest official census) |
| Air pollution | NYC Environment & Health Data Portal (`nychealth/EHDP-data`): PM2.5 (indicator `2023`) and NO₂ (`2025`) annual averages by community district, latest year 2025; boundaries from `CD.geojson` | District-level: parallel streets get the same value |
| Traffic | NYC truck routes (`jjja-shxy`) | Minutes walked within 30 m of a truck route. Backup: EHDP traffic density by district (`2112`, 2019) |
| Temperature | National Weather Service hourly forecast (`api.weather.gov`), no key; neighbourhood surface temperature from the Heat Vulnerability Index (2020 NTAs) | Forecast is citywide and varies by hour |
| Address search | NYC GeoSearch (`geosearch.planninglabs.nyc`), no key | |
| Optional | EPA AirNow "today's AQI" banner | Needs a free key; nice-to-have only |

The forecast temperature applies to every route and changes by hour. Shade,
traffic and air pollution vary by route; shade also changes with departure
time through sun angle. So route choice comes from shade, traffic and air, and
the departure time changes how much heat matters.

## Picking the three routes

1. Generate 4–5 candidate routes; sample each every 25 m.
2. **Fastest** = shortest walking time.
3. **Least traffic** = fewest minutes beside truck routes (air breaks ties),
   among routes at most ~35% longer than fastest.
4. **Most shaded** = highest shade %, within the same limit.
5. If one route wins two roles, merge its badges ("Fastest · Most shaded")
   instead of showing a near-duplicate. This can legitimately happen, e.g. at
   night.

## Profile weights

| Profile | Time | Air | Traffic | Sun × heat |
|---|---|---|---|---|
| General | 0.5 | 0.15 | 0.15 | 0.2 |
| Asthma | 0.25 | 0.25 | 0.4 | 0.1 |
| Heat-sensitive | 0.3 | 0.05 | 0.1 | 0.55 |

- **Sun × heat** = unshaded minutes × sun-angle factor × heat-index factor.
  High at 1 PM on a hot day, near zero after sunset — so Heat-sensitive picks
  the shaded route at 1 PM and switches back to Fastest at 8 PM.
- Normalise each factor against fixed citywide ranges, not against the other
  routes, so small differences don't look dramatic.
- The explanation line is a template filled from the factor that most
  separates the recommended route from Fastest, plus the extra minutes.

## Wording rules

- Always "estimated environmental exposure". Never "risk", "safe" or "unsafe".
- "Recommended for asthma profiles", not "safe for asthma".
- Air level is relative to NYC ("Higher than most NYC neighborhoods"), not
  health thresholds.
- Footer: *"Estimates from public NYC data (trees 2015, air quality 2025 annual
  averages). Not medical advice."*
- Source years appear in each card's detail view.

## Build plan (1 day)

| Time | Build |
|---|---|
| 0–1h | Data prep script: community-district boundaries + PM2.5 + NO₂, truck routes, surface temperature → `public/data/`. Pick 2 demo trips where routes clearly differ. |
| 1–3h | Trip inputs + address search, candidate routes from Valhalla, 3 coloured routes on the map. |
| 3–5.5h | Sampling and scoring (the core): trees nearby, distance to truck routes, district air values, sun angle, forecast heat. Choose the 3 roles, merge duplicates. |
| 5.5–7.5h | Route cards, profile buttons, time slider with instant re-ranking, recommended badge, explanation line, mobile bottom sheet. |
| 7.5–9h | Polish (route hover highlight, card ↔ map selection), wording pass, saved demo trips, phone-width testing. |

With two people: one takes data prep + scoring (0–1h, 3–5.5h), the other
takes UI (1–3h, 5.5–7.5h); agree the route data format early.

**Day 2 stretch (pick one):** building shadows from building footprints,
AirNow banner, or cool-down stops along the route (Cool It! NYC cooling sites
`h2bn-gu9k`, NYC Parks drinking fountains `qnv7-p7a2`).

## Risks

- **Routes too similar.** Valhalla's alternatives often overlap; the detour
  candidates address this. Demo trips with an obvious difference (both built
  in as sample-trip buttons): Grand Army Plaza → Barclays Center (three
  distinct routes; each profile picks a different one on a hot afternoon) and
  Atlantic Terminal → Prospect Park West (26% vs 68% shade).
- **Public router outage or rate limits.** Save demo trips' routes to a file
  so the demo doesn't depend on the live server.
- **Air data is coarse** (district annual average). Traffic distance and shade
  carry the street-level difference — be ready to say so.
- **Statistics.** Verify the heat-mortality figures (88% / 44% / 490) against
  NYC's 2026 Heat Mortality Report before they go on a slide.
