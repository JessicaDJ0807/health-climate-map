import Link from "next/link";
import {
  DENSITY_COLORS,
  HEALTH,
  NON_RESIDENTIAL_COLOR,
  fmt,
  type HealthKey,
  type NtaProps,
  type TreeStats,
  type TreeSummary,
} from "@/lib/trees";
import type { TreesInView } from "./TreeMap";

type Props = {
  summary: TreeSummary;
  cityDensity: number;
  area: NtaProps | null; // hovered or selected neighborhood; null = citywide
  pinned: boolean;
  onClear: () => void;
  treesInView: TreesInView;
};

function healthCounts(s: TreeStats): Record<HealthKey, number> {
  return { good: s.good, fair: s.fair, poor: s.poor, dead: s.dead + s.stump };
}

function pct(n: number, total: number) {
  return total ? `${Math.round((n / total) * 100)}%` : "–";
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xl font-semibold text-[#0b0b0b]">{value}</div>
      <div className="text-xs text-[#52514e]">{label}</div>
    </div>
  );
}

function HealthBar({ stats }: { stats: TreeStats }) {
  const counts = healthCounts(stats);
  const total = stats.total;
  return (
    <section>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#52514e]">
        Tree condition
      </h3>
      {/* Stacked bar with 2px surface gaps between segments. */}
      <div className="flex h-3 gap-[2px] overflow-hidden rounded">
        {HEALTH.map((h) =>
          counts[h.key] ? (
            <div
              key={h.key}
              style={{ flexGrow: counts[h.key], background: h.color }}
              title={`${h.label}: ${fmt.format(counts[h.key])} (${pct(counts[h.key], total)})`}
            />
          ) : null,
        )}
      </div>
      <ul className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-[#52514e]">
        {HEALTH.map((h) => (
          <li key={h.key} className="flex items-center gap-1.5">
            <span className="size-2.5 shrink-0 rounded-full" style={{ background: h.color }} />
            <span className="text-[#0b0b0b]">{h.label}</span>
            <span className="ml-auto tabular-nums">{pct(counts[h.key], total)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function TopSpecies({ stats }: { stats: TreeStats }) {
  const max = stats.topSpecies[0]?.count ?? 1;
  return (
    <section>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#52514e]">
        Most common species
      </h3>
      <ul className="space-y-1.5">
        {stats.topSpecies.map((s) => (
          <li key={s.name} className="text-xs" title={`${s.name}: ${fmt.format(s.count)} trees`}>
            <div className="flex justify-between">
              <span className="capitalize text-[#0b0b0b]">{s.name}</span>
              <span className="tabular-nums text-[#52514e]">
                {fmt.format(s.count)} · {pct(s.count, stats.alive)}
              </span>
            </div>
            <div className="mt-0.5 h-1.5 rounded-r bg-[#f0efec]">
              <div className="h-full rounded-r bg-[#358a33]" style={{ width: `${(s.count / max) * 100}%` }} />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function DensityLegend({ breaks }: { breaks: number[] }) {
  const edges = [0, ...breaks];
  return (
    <section>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#52514e]">
        Living street trees per km²
      </h3>
      <div className="flex gap-[2px]">
        {DENSITY_COLORS.map((c) => (
          <div key={c} className="h-3 flex-1 first:rounded-l last:rounded-r" style={{ background: c }} />
        ))}
      </div>
      <div className="mt-1 flex text-[11px] tabular-nums text-[#898781]">
        {edges.map((e, i) => (
          <span key={e} className="flex-1">
            {i === edges.length - 1 ? `${fmt.format(e)}+` : fmt.format(e)}
          </span>
        ))}
      </div>
      <div className="mt-2 flex items-center gap-1.5 text-xs text-[#52514e]">
        <span className="h-3 w-5 rounded" style={{ background: NON_RESIDENTIAL_COLOR }} />
        Parks, cemeteries, airports (not scored)
      </div>
    </section>
  );
}

function TreesInViewNote({ status }: { status: TreesInView }) {
  if (!status.zoomedIn) {
    return <p className="text-xs text-[#52514e]">Zoom in to see individual trees. Click a neighborhood to pin it.</p>;
  }
  if (status.loading) return <p className="text-xs text-[#52514e]">Loading trees in view…</p>;
  return (
    <p className="text-xs text-[#52514e]">
      Showing {fmt.format(status.count)} trees in view
      {status.capped ? " (limit reached — zoom in further to see all)" : ""}, colored by condition. Dot size
      shows trunk diameter. Click a tree for details.
    </p>
  );
}

export default function TreePanel({ summary, cityDensity, area, pinned, onClear, treesInView }: Props) {
  const stats = area ?? summary.city;
  const density = area ? area.density : cityDensity;

  return (
    <aside className="absolute inset-x-4 bottom-20 max-h-[45vh] overflow-y-auto rounded-xl bg-[#fcfcfb] p-4 shadow-lg ring-1 ring-black/10 sm:inset-x-auto sm:bottom-auto sm:left-4 sm:top-4 sm:max-h-[calc(100vh-2rem)] sm:w-[340px]">
      <header className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-[#0b0b0b]">NYC Street Trees</h1>
          <p className="text-xs text-[#52514e]">
            {summary.censusYear} Street Tree Census (latest official count) · NYC Parks
          </p>
        </div>
        <Link href="/" className="shrink-0 text-xs text-[#2a78d6] hover:underline">
          Route planner
        </Link>
      </header>

      <div className="mb-3 flex items-start justify-between gap-2 border-t border-[#e1e0d9] pt-3">
        <div>
          <h2 className="font-semibold text-[#0b0b0b]">{area ? area.ntaname : "All five boroughs"}</h2>
          <p className="text-xs text-[#52514e]">{area ? `${area.boroname} · neighborhood` : "Citywide"}</p>
        </div>
        {pinned && (
          <button
            onClick={onClear}
            className="rounded px-2 py-1 text-xs text-[#52514e] ring-1 ring-black/10 hover:bg-[#f0efec]"
          >
            Show citywide
          </button>
        )}
      </div>

      <div className="mb-4 grid grid-cols-3 gap-3">
        <StatTile label="living trees" value={fmt.format(stats.alive)} />
        <StatTile label="per km²" value={area && !area.residential ? "–" : fmt.format(density)} />
        <StatTile label="species" value={fmt.format(stats.speciesCount)} />
      </div>

      <div className="space-y-4">
        <HealthBar stats={stats} />
        <TopSpecies stats={stats} />
        <DensityLegend breaks={summary.densityBreaks} />
        <TreesInViewNote status={treesInView} />
      </div>
    </aside>
  );
}
