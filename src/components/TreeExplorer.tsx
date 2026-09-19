"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import type { NtaCollection, NtaProps, TreeSummary } from "@/lib/trees";
import type { TreesInView } from "./TreeMap";
import TreePanel from "./TreePanel";

// MapLibre needs `window`, so skip server prerendering for the map.
const TreeMap = dynamic(() => import("./TreeMap"), { ssr: false });

export default function TreeExplorer() {
  const [ntas, setNtas] = useState<NtaCollection | null>(null);
  const [summary, setSummary] = useState<TreeSummary | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [treesInView, setTreesInView] = useState<TreesInView>({
    zoomedIn: false,
    loading: false,
    count: 0,
    capped: false,
  });

  useEffect(() => {
    Promise.all([
      fetch("/data/trees-by-nta.geojson").then((r) => r.json()),
      fetch("/data/trees-summary.json").then((r) => r.json()),
    ]).then(([n, s]) => {
      setNtas(n);
      setSummary(s);
    });
  }, []);

  const byId = useMemo(
    () => new Map<string, NtaProps>(ntas?.features.map((f) => [f.properties.nta2020, f.properties]) ?? []),
    [ntas],
  );

  // Citywide density over the land area of all NTAs.
  const cityDensity = useMemo(() => {
    if (!ntas || !summary) return 0;
    const km2 = ntas.features.reduce((sum, f) => sum + f.properties.areaKm2, 0);
    return Math.round(summary.city.alive / km2);
  }, [ntas, summary]);

  if (!ntas || !summary) {
    return <div className="flex h-full items-center justify-center text-sm text-zinc-500">Loading tree data…</div>;
  }

  const activeId = hoveredId ?? selectedId;

  return (
    <>
      <TreeMap
        ntas={ntas}
        densityBreaks={summary.densityBreaks}
        selectedId={selectedId}
        onHover={setHoveredId}
        onSelect={setSelectedId}
        onTreesInView={setTreesInView}
      />
      <TreePanel
        summary={summary}
        cityDensity={cityDensity}
        area={activeId ? (byId.get(activeId) ?? null) : null}
        pinned={selectedId !== null}
        onClear={() => setSelectedId(null)}
        treesInView={treesInView}
      />
    </>
  );
}
