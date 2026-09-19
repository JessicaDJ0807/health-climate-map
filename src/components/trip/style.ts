import type { Role } from "@/lib/trip/score";

// Route identity uses the first three categorical slots (validated all-pairs,
// so they stay distinguishable as overlapping map lines). Colour follows the
// route's primary role, never its rank.
export const ROLE_COLORS: Record<Role, string> = {
  fastest: "#2a78d6",
  lowerExposure: "#eb6834",
  shaded: "#1baf7a",
};

// Room the map should leave for the panel when fitting routes.
export function panelPadding() {
  return window.innerWidth >= 640
    ? { top: 40, bottom: 40, right: 40, left: 420 }
    : { top: 32, bottom: window.innerHeight * 0.5 + 24, right: 24, left: 24 };
}
