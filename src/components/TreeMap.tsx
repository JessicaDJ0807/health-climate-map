"use client";

import { useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import {
  DENSITY_COLORS,
  HEALTH,
  NON_RESIDENTIAL_COLOR,
  TREE_FETCH_LIMIT,
  TREE_MIN_ZOOM,
  type NtaCollection,
} from "@/lib/trees";

// Free Carto basemap — no API key required.
const BASEMAP_STYLE =
  "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";

// Rough bounding box around the five boroughs.
// [west, south, east, north]
const NYC_BOUNDS: [number, number, number, number] = [-74.26, 40.49, -73.69, 40.92];
// Keep panning roughly within the metro area.
const MAX_BOUNDS: [number, number, number, number] = [-74.8, 39.9, -73.2, 41.1];

// 2015 Street Tree Census on NYC Open Data (CORS-enabled SODA endpoint).
const TREES_API = "https://data.cityofnewyork.us/resource/uvpi-gqnh.json";

type TreeRow = {
  tree_id: string;
  latitude: string;
  longitude: string;
  status: string;
  health?: string;
  spc_common?: string;
  tree_dbh: string;
  address?: string;
};

export type TreesInView = { zoomedIn: boolean; loading: boolean; count: number; capped: boolean };

type Props = {
  ntas: NtaCollection;
  densityBreaks: number[];
  selectedId: string | null;
  onHover: (id: string | null) => void;
  onSelect: (id: string | null) => void;
  onTreesInView: (status: TreesInView) => void;
};

// Parse a MapLibre-style "#zoom/lat/lng" hash. Read during the first render,
// since a map torn down by React's dev double-mount rewrites the hash.
function viewFromHash(): { zoom: number; center: [number, number] } | null {
  const [zoom, lat, lng] = window.location.hash.slice(1).split("/").map(Number);
  if ([zoom, lat, lng].some((n) => !Number.isFinite(n)) || zoom === 0) return null;
  return { zoom, center: [lng, lat] };
}

function healthKey(row: TreeRow) {
  if (row.status !== "Alive") return "dead";
  return row.health?.toLowerCase() ?? "good";
}

function toFeatures(rows: TreeRow[]): GeoJSON.FeatureCollection<GeoJSON.Point> {
  return {
    type: "FeatureCollection",
    features: rows.map((r) => ({
      type: "Feature",
      id: Number(r.tree_id),
      geometry: { type: "Point", coordinates: [Number(r.longitude), Number(r.latitude)] },
      properties: {
        health: healthKey(r),
        species: r.spc_common ?? (r.status === "Alive" ? "Unknown species" : r.status),
        dbh: Number(r.tree_dbh) || 0,
        address: r.address ?? "",
      },
    })),
  };
}

// Built with textContent so API data is never parsed as markup.
function treePopupContent(p: Record<string, unknown>) {
  const root = document.createElement("div");
  root.className = "text-sm text-zinc-900";
  const title = document.createElement("div");
  title.className = "font-semibold capitalize";
  title.textContent = String(p.species);
  root.appendChild(title);
  const health = HEALTH.find((h) => h.key === p.health);
  for (const line of [
    `Condition: ${health?.label ?? "Unknown"}`,
    `Trunk diameter: ${p.dbh} in`,
    String(p.address ?? ""),
  ]) {
    if (!line) continue;
    const el = document.createElement("div");
    el.className = "text-zinc-600";
    el.textContent = line;
    root.appendChild(el);
  }
  return root;
}

export default function TreeMap({ ntas, densityBreaks, selectedId, onHover, onSelect, onTreesInView }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [initialView] = useState(viewFromHash);
  // Keep the latest callbacks without re-creating the map.
  const callbacks = useRef({ onHover, onSelect, onTreesInView });
  useEffect(() => {
    callbacks.current = { onHover, onSelect, onTreesInView };
  });

  useEffect(() => {
    if (!containerRef.current) return;

    // See scripts/copy-maplibre-worker.mjs for why the worker lives in public/.
    maplibregl.setWorkerUrl(new URL("/maplibre/maplibre-gl-worker.mjs", window.location.origin).href);

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: BASEMAP_STYLE,
      ...(initialView ?? {
        bounds: NYC_BOUNDS,
        // Leave room for the panel: left column on desktop, bottom sheet on phones.
        fitBoundsOptions: {
          padding: window.innerWidth >= 640
            ? { top: 24, bottom: 24, right: 24, left: 380 }
            : { top: 16, bottom: window.innerHeight * 0.45 + 80, right: 16, left: 16 },
        },
      }),
      maxBounds: MAX_BOUNDS,
      // Keep the view in the URL (#zoom/lat/lng) so it can be shared or reloaded.
      hash: true,
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl(), "top-right");
    map.addControl(new maplibregl.ScaleControl({ unit: "imperial" }), "bottom-right");

    const densityColor: maplibregl.ExpressionSpecification = [
      "case",
      ["!", ["get", "residential"]],
      NON_RESIDENTIAL_COLOR,
      [
        "step",
        ["get", "density"],
        DENSITY_COLORS[0],
        ...densityBreaks.flatMap((b, i) => [b, DENSITY_COLORS[i + 1]]),
      ] as maplibregl.ExpressionSpecification,
    ];
    const [firstHealth, ...otherHealth] = HEALTH;
    const healthColor: maplibregl.ExpressionSpecification = [
      "match",
      ["get", "health"],
      firstHealth.key,
      firstHealth.color,
      ...otherHealth.flatMap((h) => [h.key, h.color]),
      "#898781",
    ];

    map.on("load", () => {
      // Draw data under the basemap's labels so place names stay readable.
      const firstSymbol = map.getStyle().layers.find((l) => l.type === "symbol")?.id;

      map.addSource("ntas", { type: "geojson", data: ntas, promoteId: "nta2020" });
      map.addLayer(
        {
          id: "nta-fill",
          type: "fill",
          source: "ntas",
          paint: {
            "fill-color": densityColor,
            // Fade the neighborhood shading out as individual trees take over.
            "fill-opacity": ["interpolate", ["linear"], ["zoom"], 13, 0.8, TREE_MIN_ZOOM, 0.12],
          },
        },
        firstSymbol,
      );
      map.addLayer(
        {
          id: "nta-outline",
          type: "line",
          source: "ntas",
          paint: { "line-color": "#fcfcfb", "line-width": 0.75 },
        },
        firstSymbol,
      );
      map.addLayer({
        id: "nta-active",
        type: "line",
        source: "ntas",
        paint: {
          "line-color": "#0b0b0b",
          "line-width": [
            "case",
            ["boolean", ["feature-state", "selected"], false], 2.5,
            ["boolean", ["feature-state", "hover"], false], 1.5,
            0,
          ],
        },
      });

      map.addSource("boroughs", { type: "geojson", data: "/data/boroughs.geojson" });
      map.addLayer(
        {
          id: "borough-outline",
          type: "line",
          source: "boroughs",
          paint: { "line-color": "#52514e", "line-width": 1 },
        },
        firstSymbol,
      );

      map.addSource("trees", { type: "geojson", data: toFeatures([]) });
      map.addLayer({
        id: "trees",
        type: "circle",
        source: "trees",
        minzoom: TREE_MIN_ZOOM,
        paint: {
          "circle-color": healthColor,
          // Grow with zoom, and with trunk diameter (capped so giants don't dominate).
          "circle-radius": [
            "interpolate", ["linear"], ["zoom"],
            TREE_MIN_ZOOM, ["+", 2, ["/", ["min", ["get", "dbh"], 60], 30]],
            19, ["+", 5, ["/", ["min", ["get", "dbh"], 60], 6]],
          ],
          "circle-stroke-color": "#fcfcfb",
          "circle-stroke-width": 1,
        },
      });

      loadTrees();
    });

    // --- neighborhood hover / select -------------------------------------
    let hoveredId: string | null = null;
    const setHovered = (id: string | null) => {
      if (id === hoveredId) return;
      if (hoveredId) map.setFeatureState({ source: "ntas", id: hoveredId }, { hover: false });
      if (id) map.setFeatureState({ source: "ntas", id }, { hover: true });
      hoveredId = id;
      callbacks.current.onHover(id);
    };
    map.on("mousemove", "nta-fill", (e) => {
      if (map.getZoom() >= TREE_MIN_ZOOM) return setHovered(null);
      setHovered((e.features?.[0]?.id as string) ?? null);
      map.getCanvas().style.cursor = "pointer";
    });
    map.on("mouseleave", "nta-fill", () => {
      setHovered(null);
      map.getCanvas().style.cursor = "";
    });

    // --- individual trees --------------------------------------------------
    const popup = new maplibregl.Popup({ closeButton: true, offset: 8, maxWidth: "240px" });
    map.on("click", (e) => {
      const tree = map.queryRenderedFeatures(e.point, { layers: ["trees"] })[0];
      if (tree) {
        const [lng, lat] = (tree.geometry as GeoJSON.Point).coordinates;
        popup.setLngLat([lng, lat]).setDOMContent(treePopupContent(tree.properties)).addTo(map);
        return;
      }
      // Neighborhoods are only selectable while their shading is the focus.
      if (map.getZoom() >= TREE_MIN_ZOOM) return;
      const nta = map.queryRenderedFeatures(e.point, { layers: ["nta-fill"] })[0];
      callbacks.current.onSelect((nta?.id as string) ?? null);
    });
    map.on("mouseenter", "trees", () => (map.getCanvas().style.cursor = "pointer"));
    map.on("mouseleave", "trees", () => (map.getCanvas().style.cursor = ""));

    let request: AbortController | null = null;
    async function loadTrees() {
      request?.abort();
      const source = map.getSource<maplibregl.GeoJSONSource>("trees");
      if (!source) return;
      if (map.getZoom() < TREE_MIN_ZOOM) {
        source.setData(toFeatures([]));
        callbacks.current.onTreesInView({ zoomedIn: false, loading: false, count: 0, capped: false });
        return;
      }
      const b = map.getBounds();
      const where =
        `latitude between ${b.getSouth()} and ${b.getNorth()} ` +
        `and longitude between ${b.getWest()} and ${b.getEast()}`;
      const params = new URLSearchParams({
        $select: "tree_id,latitude,longitude,status,health,spc_common,tree_dbh,address",
        $where: where,
        $limit: String(TREE_FETCH_LIMIT),
      });
      request = new AbortController();
      callbacks.current.onTreesInView({ zoomedIn: true, loading: true, count: 0, capped: false });
      try {
        const res = await fetch(`${TREES_API}?${params}`, { signal: request.signal });
        const rows: TreeRow[] = await res.json();
        source.setData(toFeatures(rows));
        callbacks.current.onTreesInView({
          zoomedIn: true,
          loading: false,
          count: rows.length,
          capped: rows.length >= TREE_FETCH_LIMIT,
        });
      } catch (err) {
        if ((err as Error).name !== "AbortError") console.error("Tree fetch failed", err);
      }
    }
    map.on("moveend", loadTrees);

    return () => {
      request?.abort();
      map.remove();
      mapRef.current = null;
    };
    // The map is created once; data props are static after load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Mirror the selected neighborhood onto the map.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !selectedId) return;
    const apply = () => map.setFeatureState({ source: "ntas", id: selectedId }, { selected: true });
    if (map.getSource("ntas")) apply();
    else map.once("load", apply);
    return () => {
      if (map.getSource("ntas")) map.setFeatureState({ source: "ntas", id: selectedId }, { selected: false });
    };
  }, [selectedId]);

  return <div ref={containerRef} className="h-full w-full" />;
}

