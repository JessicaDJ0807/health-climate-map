import type { Role } from "@/lib/trip/score";

// Route identity uses the first three categorical slots (validated all-pairs,
// so they stay distinguishable as overlapping map lines). Colour follows the
// route's primary role, never its rank.
export const ROLE_COLORS: Record<Role, string> = {
  fastest: "#69aeca",
  leastTraffic: "#ef9e86",
  shaded: "#285b49",
};

// Room the map should leave for the panel when fitting routes.
export function panelPadding() {
  return window.innerWidth >= 640
    ? { top: 56, bottom: 56, right: 56, left: 56 }
    : { top: 32, bottom: window.innerHeight * 0.45 + 24, right: 24, left: 24 };
}

// --- exposure profile colours ---------------------------------------------
//
// Exposure is a magnitude, so it gets a single-hue light→dark ramp. The hue is
// the route's own identity colour, so a route stays recognisable while its
// pale stretches read as lower estimated exposure and dark ones as higher.

type Rgb = [number, number, number];

function toRgb(hex: string): Rgb {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return [0, 1, 2].map((i) => Math.round(a[i] + (b[i] - a[i]) * t)) as Rgb;
}

/** Colour for exposure `value` (0–1) on the ramp of `base` (a route colour). */
export function exposureColor(base: string, value: number) {
  const rgb = toRgb(base);
  const v = Math.max(0, Math.min(1, value));
  // 0 → 72% toward white; 1 → 40% toward black.
  const [r, g, b] = v < 0.5 ? mix(mix(rgb, [255, 255, 255], 0.72), rgb, v * 2) : mix(rgb, mix(rgb, [0, 0, 0], 0.4), (v - 0.5) * 2);
  return `rgb(${r}, ${g}, ${b})`;
}
