# HavenPath NY

**Two walking routes can take the same time and expose you to very different air, traffic and sun. HavenPath NY shows you the difference before you leave.**

New York City · walking only · built on NYC Open Data

![Comparing two walking routes from Atlantic Terminal to Prospect Park West](docs/screenshots/route-comparison.webp)

---

## The idea

Every map app answers one question: *what is fastest?* For a lot of people that is the wrong question.

If you have asthma, twenty minutes beside a truck route is not the same as twenty minutes on a side street. If you are elderly, or pushing a stroller in August, a sunny sidewalk and a shaded one are not the same walk. That difference is measurable from public data, and no routing app surfaces it.

HavenPath NY plans a walk the way those people actually choose one. It finds several real walking routes between two points, measures what each one exposes you to, and recommends the gentler option — while telling you exactly what it costs you in minutes.

In the screenshot above, the recommended route cuts time spent near truck routes from **18 minutes down to 5** and raises shade from **40% to 68%** — for about five extra minutes of walking.

## What it measures

Every 25 metres along every candidate route, against four public datasets:

| | Layer | What it reads |
|---|---|---|
| 🌳 | **Trees** | 888,335 living street and park trees — shade, and how dense it is |
| 🚛 | **Traffic** | NYC DOT truck routes, as a proxy for heavy vehicle exposure |
| 🌫️ | **Air** | PM2.5 and NO₂ annual means by community district |
| ☀️ | **Heat** | Neighborhood surface temperature, plus live forecast and sun position |

Each one is a map layer you can switch between, so you can see the city the route planner sees:

| Trees | Heat |
|---|---|
| ![Tree density layer](docs/screenshots/layer-trees.webp) | ![Surface heat layer](docs/screenshots/layer-heat.webp) |
| **Traffic** | **Air** |
| ![Truck route layer](docs/screenshots/layer-traffic.webp) | ![Air quality layer](docs/screenshots/layer-air.webp) |

Zoom in on the tree layer and every individual tree is drawn — all 888,335 of them, served from pre-built binary tiles.

## It ranks for *you*, not in general

The same two routes should not be recommended to everyone. A profile changes the weighting:

| Profile | Time | Air | Traffic | Sun × heat |
|---|---|---|---|---|
| General | 0.50 | 0.15 | 0.15 | 0.20 |
| Asthma | 0.25 | 0.25 | **0.40** | 0.10 |
| Heat-sensitive | 0.30 | 0.05 | 0.10 | **0.55** |

Set it once and every route is scored against it. The profile lives in your browser's local storage — there is no account, no server, and no password field, because a password that authenticates nothing only teaches people to reuse a real one.

| Profile | Assistant |
|---|---|
| ![Profile drawer](docs/screenshots/profile.webp) | ![Assistant drawer](docs/screenshots/assistant.webp) |

The assistant answers from the numbers already on screen — the same `TripResult` the cards render. It is not a language model and gives no medical advice.

<p align="center">
  <img src="docs/screenshots/mobile.webp" width="300" alt="HavenPath NY at phone width">
</p>

## Honest about what this is

The app reports **estimated environmental exposure**, not health risk. Every weight, radius and scaling constant is a design judgment, not a value from health research.

Known limits, stated up front:

- **Street-level differences come mainly from trees and truck routes.** Air pollution is a district annual average; surface heat is a neighborhood average. Those two do not vary much between routes a few blocks apart.
- **Shade means trees nearby, not computed shadow.** Building shadows are not modeled.
- **Truck routes mark where heavy vehicles are *allowed*,** not measured traffic volume.
- **Tree pollen is built but switched off.** The code measures allergenic species within 50 m, but pollen travels hundreds of metres and tree sex is unrecorded, so the axis could not be justified. It is disabled behind a flag rather than deleted — see [`features.ts`](src/lib/trip/features.ts).
- **Walking only, NYC only,** by design.

[`docs/HOW-IT-WORKS.md`](docs/HOW-IT-WORKS.md) documents every step, every constant, and every dataset that was considered and rejected.

## Running it

Requires Node 20+ (developed on 22).

```bash
git clone https://github.com/JessicaDJ0807/health-climate-map.git
cd health-climate-map
npm install
npm run dev
```

Open <http://localhost:3000>.

The pre-built data files are committed, so it runs immediately. To regenerate them from NYC Open Data:

```bash
npm run build:trip    # truck routes, air, neighborhood heat
npm run build:trees   # tree tiles + density (~90s, ~1.1M rows)
```

Without `public/data/tree-tiles/`, the app silently falls back to the live Socrata API on every map pan — much slower, and rate limited.

## How it fits together

```
src/
  app/                    Next.js App Router entry, global CSS
  components/trip/
    HavenPlanner.tsx      the whole UI — planner, drawers, modal
    TripMap.tsx           MapLibre map, routes, the four env layers
    useTrip.ts            trip state and the analyse → score pipeline
  lib/trip/
    routing.ts            Valhalla pedestrian routing
    env.ts                dataset loading, tree tiles + fallbacks
    score.ts              all scoring, profiles and weights
    assistant.ts          answers generated from the live result
  styles/haven/           design team's stylesheets, vendored verbatim
scripts/                  data build scripts
docs/HOW-IT-WORKS.md      the full method
```

**Stack:** Next.js 16 · React 19 · MapLibre GL · Valhalla · NYC Open Data

## Data sources

All public, all free, no API keys.

- [NYC Parks Forestry Tree Points](https://data.cityofnewyork.us/resource/hn5i-inap) — `hn5i-inap`, updated continuously
- [NYC DOT Truck Routes](https://data.cityofnewyork.us/resource/jjja-shxy) — `jjja-shxy`
- [NYC Environment & Health Data Portal](https://github.com/nychealth/EHDP-data) — PM2.5 and NO₂
- NYC Heat Vulnerability Index — surface temperature by NTA
- [2020 Neighborhood Tabulation Areas](https://data.cityofnewyork.us/resource/9nt8-h7nd) — `9nt8-h7nd`
- [NYC Planning Labs GeoSearch](https://geosearch.planninglabs.nyc/) + [Photon](https://photon.komoot.io/) — place search
- [Valhalla](https://valhalla1.openstreetmap.de/) on OpenStreetMap — pedestrian routing
- [National Weather Service](https://www.weather.gov/documentation/services-web-api) — hourly forecast

Tree inventory snapshot: **2026-09-09** · 888,335 living trees · 321 species.
