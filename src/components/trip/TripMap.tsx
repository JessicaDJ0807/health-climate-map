"use client";

import { useEffect, useRef } from "react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { ScoredRoute } from "@/lib/trip/score";
import type { Place } from "./PlaceInput";
import { ROLE_COLORS, panelPadding } from "./style";

const BASEMAP_STYLE = "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";
const NYC_BOUNDS: [number, number, number, number] = [-74.26, 40.49, -73.69, 40.92];

type Props = {
  origin: Place | null;
  destination: Place | null;
  routes: ScoredRoute[];
  recommendedId: string | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
};

function markerEl(text: string) {
  const el = document.createElement("div");
  el.className =
    "flex size-7 items-center justify-center rounded-full bg-[#0b0b0b] text-xs font-semibold text-white ring-2 ring-white shadow";
  el.textContent = text;
  return el;
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

export default function TripMap({ origin, destination, routes, recommendedId, selectedId, onSelect }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const loaded = useRef(false);
  // Latest route data, applied once the style has loaded.
  const pendingRoutes = useRef(routeFeatures([], null, null));
  const markers = useRef<{ a?: maplibregl.Marker; b?: maplibregl.Marker }>({});
  const onSelectRef = useRef(onSelect);
  useEffect(() => {
    onSelectRef.current = onSelect;
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
      loaded.current = true;
    });

    map.on("click", "route-line", (e) => {
      const id = e.features?.[0]?.properties?.id;
      if (id) onSelectRef.current(String(id));
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
      markers.current[key] = place
        ? new maplibregl.Marker({ element: markerEl(text) }).setLngLat([place.lng, place.lat]).addTo(map)
        : undefined;
    }
  }, [origin, destination]);

  // Route lines (restyled on every selection / recommendation change).
  useEffect(() => {
    pendingRoutes.current = routeFeatures(routes, selectedId, recommendedId);
    if (loaded.current) mapRef.current?.getSource<maplibregl.GeoJSONSource>("routes")?.setData(pendingRoutes.current);
  }, [routes, selectedId, recommendedId]);

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

  return <div ref={containerRef} className="h-full w-full" />;
}
