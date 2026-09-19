import { ROLE_LABELS, type ScoredRoute } from "@/lib/trip/score";
import { ROLE_COLORS } from "./style";

const AIR_TEXT = {
  Lower: "Lower than most NYC neighborhoods",
  Moderate: "Typical for NYC neighborhoods",
  Higher: "Higher than most NYC neighborhoods",
} as const;

type Props = {
  route: ScoredRoute;
  recommended: boolean;
  profileLabel: string;
  selected: boolean;
  onSelect: () => void;
};

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div title={hint}>
      <div className="text-[11px] text-[#898781]">{label}</div>
      <div className="text-sm font-medium text-[#0b0b0b]">{value}</div>
    </div>
  );
}

export default function RouteCard({ route, recommended, profileLabel, selected, onSelect }: Props) {
  const m = route.metrics;
  const color = ROLE_COLORS[route.roles[0]];
  const extra = Math.round(route.extraMinutes);
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`w-full rounded-xl p-3 text-left transition ${
        selected ? "bg-white shadow-md ring-2" : "bg-white/70 ring-1 ring-black/10 hover:bg-white"
      }`}
      style={selected ? ({ "--tw-ring-color": color } as React.CSSProperties) : undefined}
    >
      {recommended && (
        <div className="mb-2 inline-flex items-center gap-1 rounded-full bg-[#0b0b0b] px-2 py-0.5 text-[11px] font-semibold text-white">
          <span aria-hidden>★</span> Recommended for {profileLabel}
        </div>
      )}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="h-1.5 w-6 shrink-0 rounded-full" style={{ background: color }} aria-hidden />
          <span className="text-sm font-semibold text-[#0b0b0b]">{route.roles.map((r) => ROLE_LABELS[r]).join(" · ")}</span>
        </div>
        <div className="text-right">
          <div className="text-lg font-semibold leading-none text-[#0b0b0b]">{Math.round(route.minutes)} min</div>
          <div className="mt-0.5 text-[11px] text-[#52514e]">
            {extra > 0 ? `+${extra} min · ` : ""}
            {route.km.toFixed(1)} km
          </div>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-4 gap-2">
        <Stat label="Shade" value={`${Math.round(route.shade * 100)}%`} hint="Share of the walk near street trees or in large parks" />
        <Stat label="Air" value={m.airLevel} hint={`${AIR_TEXT[m.airLevel]} (annual averages)`} />
        <Stat label="Traffic" value={`${Math.round(m.trafficMinutes)} min`} hint="Minutes walking within 30 m of a truck route" />
        <Stat label="In sun" value={`${Math.round(m.sunMinutes)} min`} hint="Estimated minutes in direct sun at this departure time" />
      </div>

      <div className="mt-3">
        <div className="flex justify-between text-[11px] text-[#52514e]">
          <span>Estimated environmental exposure</span>
          <span className="tabular-nums">{m.exposure}/100</span>
        </div>
        <div className="mt-1 h-1.5 rounded-full bg-[#f0efec]">
          <div className="h-full rounded-full bg-[#52514e]" style={{ width: `${Math.max(3, m.exposure)}%` }} />
        </div>
      </div>
    </button>
  );
}
