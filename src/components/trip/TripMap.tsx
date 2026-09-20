"use client";

import { useEffect, useImperativeHandle, useRef, type Ref } from "react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { ScoredRoute } from "@/lib/trip/score";
import type { LngLat } from "@/lib/trip/geo";
import type { Place } from "./PlaceInput";
import { ROLE_COLORS, panelPadding } from "./style";
import { ENV_LAYERS, ENV_LAYER_IDS, rampFor, type EnvLayerId } from "./envLayers";
import { loadTreePointsIn } from "@/lib/trip/env";

const BASEMAP_STYLE = "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";
const NYC_BOUNDS: [number, number, number, number] = [-74.26, 40.49, -73.69, 40.92];

export type Endpoint = "origin" | "destination";

/** Imperative hooks for the handoff's zoom / reset controls. */
export type MapHandle = {
  zoomIn: () => void;
  zoomOut: () => void;
  reset: () => void;
};

type Props = {
  origin: Place | null;
  destination: Place | null;
  routes: ScoredRoute[];
  recommendedId: string | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** A point chosen on the map (click menu or marker drag). */
  onPick: (which: Endpoint, lng: number, lat: number) => void;
  /** Map center and zoom after each move (used to rank search results). */
  onViewChange?: (view: { lng: number; lat: number; zoom: number }) => void;
  /** Exposure profile of the selected route: its line plus colour stops. */
  gradient?: { line: LngLat[]; stops: { t: number; color: string }[] } | null;
  /** Point highlighted from the exposure strip. */
  hoverPoint?: LngLat | null;
  /** Environmental layer shaded under the routes, or null for the plain map. */
  envLayer?: EnvLayerId | null;
  ref?: Ref<MapHandle>;
};

// Observed NYC ranges, so a colour means the same thing on every trip.
const ENV_RANGES = { trees: [200, 2600], surfaceTemp: [80.8, 90.8], air: [0, 1] } as const;

// Below this the viewport spans too many tiles to draw every tree, so the
// neighborhood shading carries the layer on its own.
const TREE_POINT_ZOOM = 13.5;

/**
 * Adds one environmental layer's source and fill/line the first time it is
 * shown, under the route lines. Data is the same public set the scoring uses;
 * the browser caches each file after the first fetch.
 */
async function ensureEnvLayer(map: maplibregl.Map, id: EnvLayerId) {
  if (map.getLayer(`env-${id}`)) return;
  const paletteOf = (k: EnvLayerId) => ENV_LAYERS[k].palette;
  if (id === "trees") {
    const data = await fetch("/data/trees-by-nta.geojson").then((r) => r.json());
    map.addSource("env-trees", { type: "geojson", data });
    map.addLayer({
      id: "env-trees",
      type: "fill",
      source: "env-trees",
      paint: {
        "fill-color": rampFor("density", paletteOf("trees"), ...ENV_RANGES.trees) as never,
        "fill-opacity": 0.55,
      },
    }, "route-casing");
    // Individual trees, drawn over the neighborhood shading once close enough.
    map.addSource("env-tree-points", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    map.addLayer({
      id: "env-tree-points",
      type: "circle",
      source: "env-tree-points",
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 13.5, 1.4, 16, 3, 18, 5],
        "circle-color": "#1f7346",
        "circle-opacity": ["interpolate", ["linear"], ["zoom"], 13.5, 0.35, 15, 0.8],
        "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 16, 0, 17, 0.6],
        "circle-stroke-color": "#ffffff",
      },
    }, "route-casing");
  } else if (id === "heat") {
    const data = await fetch("/data/nta-env.geojson").then((r) => r.json());
    map.addSource("env-heat", { type: "geojson", data });
    map.addLayer({
      id: "env-heat",
      type: "fill",
      source: "env-heat",
      paint: {
        "fill-color": rampFor("surfaceTemp", paletteOf("heat"), ...ENV_RANGES.surfaceTemp) as never,
        "fill-opacity": 0.55,
      },
    }, "route-casing");
  } else if (id === "air") {
    // Same combination the scoring uses: the mean of PM2.5 and NO2, each
    // normalised over its citywide range.
    const [data, summary] = await Promise.all([
      fetch("/data/air-by-cd.geojson").then((r) => r.json()),
      fetch("/data/trip-summary.json").then((r) => r.json()),
    ]);
    const norm = (v: number, { min, max }: { min: number; max: number }) => Math.max(0, Math.min(1, (v - min) / (max - min)));
    for (const f of data.features) {
      f.properties.airIndex = (norm(f.properties.pm25, summary.pm25) + norm(f.properties.no2, summary.no2)) / 2;
    }
    map.addSource("env-air", { type: "geojson", data });
    map.addLayer({
      id: "env-air",
      type: "fill",
      source: "env-air",
      paint: {
        "fill-color": rampFor("airIndex", paletteOf("air"), ...ENV_RANGES.air) as never,
        "fill-opacity": 0.55,
      },
    }, "route-casing");
  } else {
    const lines: number[][] = await fetch("/data/truck-routes.json").then((r) => r.json());
    map.addSource("env-traffic", {
      type: "geojson",
      data: {
        type: "Feature",
        properties: {},
        geometry: {
          type: "MultiLineString",
          coordinates: lines.map((flat) => {
            const pts: [number, number][] = [];
            for (let i = 0; i < flat.length; i += 2) pts.push([flat[i], flat[i + 1]]);
            return pts;
          }),
        },
      },
    });
    map.addLayer({
      id: "env-traffic",
      type: "line",
      source: "env-traffic",
      layout: { "line-cap": "round" },
      paint: { "line-color": ENV_LAYERS.traffic.palette[3], "line-width": 2.5, "line-opacity": 0.75 },
    }, "route-casing");
  }
}

function markerEl(text: string) {
  const el = document.createElement("div");
  el.className =
    "flex size-7 items-center justify-center rounded-full text-xs font-semibold text-white ring-2 ring-white shadow";
  el.style.background = text === "A" ? "#285b49" : "#ef9e86";
  el.textContent = text;
  return el;
}

// Click menu: "Start here" / "End here". Minimal markup; styling is left to the UI pass.
function pickMenu(onChoose: (which: Endpoint) => void) {
  const root = document.createElement("div");
  root.className = "flex flex-col gap-1 text-sm";
  for (const [which, text] of [["origin", "Start here"], ["destination", "End here"]] as const) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "rounded px-2 py-1 text-left hover:bg-black/5";
    btn.textContent = text;
    btn.addEventListener("click", () => onChoose(which));
    root.appendChild(btn);
  }
  return root;
}

function routeFeatures(routes: ScoredRoute[], selectedId: string | null, recommendedId: string | null) {
  return {
    type: "FeatureCollection" as const,
    features: routes.map((r) => ({
      type: "Feature" as const,
      geometry: { type: "LineString" as const, coordinates: r.line },
      properties: {
        id: r.id,
        color: ROLE_COLORS[r.roles[0]],
        selected: r.id === selectedId,
        // Draw the selected route on top, then the recommended one.
        sort: r.id === selectedId ? 2 : r.id === recommendedId ? 1 : 0,
      },
    })),
  };
}

export default function TripMap({
  origin,
  destination,
  routes,
  recommendedId,
  selectedId,
  onSelect,
  onPick,
  onViewChange,
  gradient,
  hoverPoint,
  envLayer = null,
  ref,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const loaded = useRef(false);
  // Latest route data, applied once the style has loaded.
  const pendingRoutes = useRef(routeFeatures([], null, null));
  const markers = useRef<{ a?: maplibregl.Marker; b?: maplibregl.Marker }>({});
  const onSelectRef = useRef(onSelect);
  const onPickRef = useRef(onPick);
  const onViewRef = useRef(onViewChange);
  useEffect(() => {
    onSelectRef.current = onSelect;
    onPickRef.current = onPick;
    onViewRef.current = onViewChange;
  });

  useEffect(() => {
    if (!containerRef.current) return;
    // See scripts/copy-maplibre-worker.mjs for why the worker lives in public/.
    maplibregl.setWorkerUrl(new URL("/maplibre/maplibre-gl-worker.mjs", window.location.origin).href);
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: BASEMAP_STYLE,
      bounds: NYC_BOUNDS,
      fitBoundsOptions: { padding: panelPadding() },
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");

    const reportView = () => {
      const c = map.getCenter();
      onViewRef.current?.({ lng: c.lng, lat: c.lat, zoom: map.getZoom() });
    };
    map.on("load", reportView);
    map.on("moveend", reportView);

    map.on("load", () => {
      map.addSource("routes", { type: "geojson", data: pendingRoutes.current });
      map.addLayer({
        id: "route-casing",
        type: "line",
        source: "routes",
        layout: { "line-join": "round", "line-cap": "round", "line-sort-key": ["get", "sort"] },
        paint: {
          "line-color": "#ffffff",
          "line-width": ["case", ["get", "selected"], 11, 8],
        },
      });
      map.addLayer({
        id: "route-line",
        type: "line",
        source: "routes",
        layout: { "line-join": "round", "line-cap": "round", "line-sort-key": ["get", "sort"] },
        paint: {
          "line-color": ["get", "color"],
          "line-width": ["case", ["get", "selected"], 7, 4.5],
          "line-opacity": ["case", ["get", "selected"], 1, 0.6],
        },
      });
      // Exposure profile of the selected route, drawn over its plain line.
      map.addSource("route-exposure", {
        type: "geojson",
        lineMetrics: true, // required for line-gradient
        data: { type: "FeatureCollection", features: [] },
      });
      map.addLayer({
        id: "route-exposure",
        type: "line",
        source: "route-exposure",
        layout: { "line-join": "round", "line-cap": "round" },
        paint: { "line-width": 7 },
      });
      map.addSource("hover-point", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({
        id: "hover-point",
        type: "circle",
        source: "hover-point",
        paint: {
          "circle-radius": 6,
          "circle-color": "#1d343c",
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 2,
        },
      });
      loaded.current = true;
    });

    // Clicking a route selects it; clicking anywhere else offers Start / End here.
    const menu = new maplibregl.Popup({ closeButton: false, offset: 6 });
    map.on("click", (e) => {
      const route = loaded.current ? map.queryRenderedFeatures(e.point, { layers: ["route-line"] })[0] : undefined;
      if (route?.properties?.id) {
        menu.remove();
        onSelectRef.current(String(route.properties.id));
        return;
      }
      const { lng, lat } = e.lngLat;
      menu
        .setLngLat(e.lngLat)
        .setDOMContent(pickMenu((which) => {
          menu.remove();
          onPickRef.current(which, lng, lat);
        }))
        .addTo(map);
    });
    map.on("mouseenter", "route-line", () => (map.getCanvas().style.cursor = "pointer"));
    map.on("mouseleave", "route-line", () => (map.getCanvas().style.cursor = ""));

    return () => {
      map.remove();
      mapRef.current = null;
      loaded.current = false;
    };
  }, []);

  // Origin / destination markers.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    for (const [key, place, text] of [["a", origin, "A"], ["b", destination, "B"]] as const) {
      markers.current[key]?.remove();
      if (!place) {
        markers.current[key] = undefined;
        continue;
      }
      const which: Endpoint = key === "a" ? "origin" : "destination";
      const marker = new maplibregl.Marker({ element: markerEl(text), draggable: true })
        .setLngLat([place.lng, place.lat])
        .addTo(map);
      marker.on("dragend", () => {
        const { lng, lat } = marker.getLngLat();
        onPickRef.current(which, lng, lat);
      });
      markers.current[key] = marker;
    }
  }, [origin, destination]);

  // Route lines (restyled on every selection / recommendation change).
  useEffect(() => {
    pendingRoutes.current = routeFeatures(routes, selectedId, recommendedId);
    if (loaded.current) mapRef.current?.getSource<maplibregl.GeoJSONSource>("routes")?.setData(pendingRoutes.current);
  }, [routes, selectedId, recommendedId]);

  // Exposure gradient for the selected route.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded.current) return;
    const source = map.getSource<maplibregl.GeoJSONSource>("route-exposure");
    if (!source) return;
    if (!gradient || gradient.stops.length < 2) {
      source.setData({ type: "FeatureCollection", features: [] });
      return;
    }
    source.setData({
      type: "FeatureCollection",
      features: [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: gradient.line } }],
    });
    map.setPaintProperty("route-exposure", "line-gradient", [
      "interpolate",
      ["linear"],
      ["line-progress"],
      ...gradient.stops.flatMap((s) => [s.t, s.color]),
    ] as maplibregl.ExpressionSpecification);
  }, [gradient]);

  // Point highlighted from the exposure strip.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded.current) return;
    map.getSource<maplibregl.GeoJSONSource>("hover-point")?.setData({
      type: "FeatureCollection",
      features: hoverPoint
        ? [{ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: hoverPoint } }]
        : [],
    });
  }, [hoverPoint]);

  // Fit the view when a new set of routes arrives (not on restyles).
  const routeKey = routes.map((r) => r.id + r.line.length).join("|");
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !routes.length) return;
    const bounds = new maplibregl.LngLatBounds();
    for (const r of routes) for (const p of r.line) bounds.extend(p);
    map.fitBounds(bounds, { padding: panelPadding(), maxZoom: 16, duration: 800 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeKey]);

  useImperativeHandle(ref, () => ({
    zoomIn: () => mapRef.current?.zoomIn(),
    zoomOut: () => mapRef.current?.zoomOut(),
    reset: () => mapRef.current?.fitBounds(NYC_BOUNDS, { padding: panelPadding() }),
  }), []);

  // Show one environmental layer at a time, adding it on first use.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    let cancelled = false;
    const apply = async () => {
      for (const id of ENV_LAYER_IDS) {
        if (map.getLayer(`env-${id}`)) map.setLayoutProperty(`env-${id}`, "visibility", "none");
      }
      if (map.getLayer("env-tree-points")) map.setLayoutProperty("env-tree-points", "visibility", "none");
      if (!envLayer) return;
      try {
        await ensureEnvLayer(map, envLayer);
      } catch {
        return; // the layer just stays off if its file can't be read
      }
      if (!cancelled && map.getLayer(`env-${envLayer}`)) {
        map.setLayoutProperty(`env-${envLayer}`, "visibility", "visible");
        if (envLayer === "trees" && map.getLayer("env-tree-points")) {
          map.setLayoutProperty("env-tree-points", "visibility", "visible");
        }
      }
    };
    if (loaded.current) apply();
    else map.once("load", apply);
    return () => { cancelled = true; };
  }, [envLayer]);

  // Individual trees for whatever is on screen, refreshed as the map moves.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || envLayer !== "trees") return;
    let cancelled = false;
    const ctrl = new AbortController();

    const refresh = async () => {
      const source = map.getSource("env-tree-points") as maplibregl.GeoJSONSource | undefined;
      if (!source) return;
      if (map.getZoom() < TREE_POINT_ZOOM) {
        source.setData({ type: "FeatureCollection", features: [] });
        return;
      }
      const b = map.getBounds();
      const points = await loadTreePointsIn(
        [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()],
        ctrl.signal,
      ).catch(() => null);
      if (cancelled || !points) return;
      source.setData({
        type: "FeatureCollection",
        features: points.map((at) => ({ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: at } })),
      });
    };

    if (loaded.current) refresh();
    const onMove = () => { refresh(); };
    map.on("moveend", onMove);
    return () => {
      cancelled = true;
      ctrl.abort();
      map.off("moveend", onMove);
    };
  }, [envLayer]);

  return <div ref={containerRef} className="h-full w-full" />;
}
