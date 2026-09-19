"use client";

import { useEffect, useRef } from "react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

// Free Carto basemap — no API key required.
const BASEMAP_STYLE =
  "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";

// Rough bounding box around the five boroughs.
// [west, south, east, north]
const NYC_BOUNDS: [number, number, number, number] = [-74.26, 40.49, -73.69, 40.92];
// Keep panning roughly within the metro area.
const MAX_BOUNDS: [number, number, number, number] = [-74.8, 40.3, -73.2, 41.1];

const BOROUGH_COLORS: maplibregl.ExpressionSpecification = [
  "match",
  ["get", "boroname"],
  "Manhattan", "#4c78a8",
  "Brooklyn", "#f58518",
  "Queens", "#54a24b",
  "Bronx", "#e45756",
  "Staten Island", "#b279a2",
  "#999999",
];

export default function NycMap() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    // See scripts/copy-maplibre-worker.mjs for why the worker lives in public/.
    maplibregl.setWorkerUrl(new URL("/maplibre/maplibre-gl-worker.mjs", window.location.origin).href);

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: BASEMAP_STYLE,
      bounds: NYC_BOUNDS,
      fitBoundsOptions: { padding: 24 },
      maxBounds: MAX_BOUNDS,
    });
    map.addControl(new maplibregl.NavigationControl(), "top-right");
    map.addControl(new maplibregl.ScaleControl({ unit: "imperial" }), "bottom-left");

    const popup = new maplibregl.Popup({
      closeButton: false,
      closeOnClick: false,
      offset: 8,
      anchor: "bottom",
    });

    map.on("load", () => {
      map.addSource("boroughs", { type: "geojson", data: "/data/boroughs.geojson" });
      map.addLayer({
        id: "borough-fill",
        type: "fill",
        source: "boroughs",
        paint: { "fill-color": BOROUGH_COLORS, "fill-opacity": 0.15 },
      });
      map.addLayer({
        id: "borough-hover",
        type: "fill",
        source: "boroughs",
        paint: { "fill-color": BOROUGH_COLORS, "fill-opacity": 0.25 },
        filter: ["==", ["get", "boroname"], ""],
      });
      map.addLayer({
        id: "borough-outline",
        type: "line",
        source: "boroughs",
        paint: { "line-color": "#333", "line-width": 1 },
      });
    });

    map.on("mousemove", "borough-fill", (e) => {
      const name = String(e.features?.[0]?.properties?.boroname ?? "");
      map.setFilter("borough-hover", ["==", ["get", "boroname"], name]);
      map.getCanvas().style.cursor = "pointer";
      // setText (not setHTML) so feature data is never parsed as markup.
      popup.setLngLat(e.lngLat).setText(name).addTo(map);
    });

    map.on("mouseleave", "borough-fill", () => {
      map.setFilter("borough-hover", ["==", ["get", "boroname"], ""]);
      map.getCanvas().style.cursor = "";
      popup.remove();
    });

    return () => map.remove();
  }, []);

  return <div ref={containerRef} className="h-full w-full text-zinc-900" />;
}
