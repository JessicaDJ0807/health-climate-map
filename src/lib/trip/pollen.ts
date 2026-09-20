// Airborne tree pollen along a route.
//
// NYC's inventory records species but not pollen, so the load is inferred from
// the genus: wind-pollinated genera (oak, planetree, maple, elm, birch) shed
// pollen that travels, while insect-pollinated ones (honeylocust, linden,
// cherry, pear) shed almost none into the air. The split is real here — the
// city's two most planted trees, London planetree and honeylocust, sit at
// opposite ends of it.
//
// This is an exposure estimate from tree locations, not a pollen measurement
// and not medical advice. Three things it cannot see: pollen travels on the
// wind for hundreds of metres, so nearby trees are a loose proxy; male and
// female trees of the same species differ completely and the inventory does
// not record sex; and grass and ragweed, which drive late-summer symptoms,
// are not street trees at all.
import genera from "./pollen-genera.json";

/** 0 = negligible airborne pollen, 1 = moderate, 2 = major allergen. */
export type PollenClass = 0 | 1 | 2;

const BY_GENUS = new Map<string, PollenClass>([
  ...genera.high.map((g) => [g, 2] as const),
  ...genera.moderate.map((g) => [g, 1] as const),
]);

/** Classify a raw `genusspecies` value, e.g. "Quercus palustris - pin oak". */
export function pollenClassOf(genusspecies: string | null | undefined): PollenClass {
  if (!genusspecies) return 0;
  const genus = genusspecies
    .split(/\s[-–]\s/)[0] // a few rows use an en-dash
    .replace(/^\s*[x×]\s+/i, "") // × Chitalpa (intergeneric hybrid)
    .trim()
    .split(/\s+/)[0];
  return BY_GENUS.get(genus) ?? 0;
}

// Tree pollen in the New York area runs from around late February, when maple
// and elm start, through a mid-April peak of oak, planetree and birch, and
// tapers off by early June. Outside that window the axis is switched off
// rather than quietly scored as zero, so the UI can say why.
const SEASON_START = 55; // ~24 Feb
const SEASON_PEAK = 105; // ~15 Apr
const SEASON_END = 155; // ~4 Jun

function dayOfYear(d: Date) {
  return Math.floor((d.getTime() - new Date(d.getFullYear(), 0, 0).getTime()) / 86_400_000);
}

/** 0 outside the tree-pollen season, rising to 1 at the April peak. */
export function pollenSeasonFactor(when: Date): number {
  const doy = dayOfYear(when);
  if (doy <= SEASON_START || doy >= SEASON_END) return 0;
  return doy <= SEASON_PEAK
    ? (doy - SEASON_START) / (SEASON_PEAK - SEASON_START)
    : (SEASON_END - doy) / (SEASON_END - SEASON_PEAK);
}

export type PollenLevel = "Lower" | "Moderate" | "Higher";

/**
 * Against the rest of the city, not against an absolute scale: the cut points
 * are the citywide terciles of the index, so each level is roughly a third of
 * NYC. See POLLEN_SATURATION in score.ts for the calibration.
 */
export function pollenLevel(index: number): PollenLevel {
  return index < 0.25 ? "Lower" : index < 0.5 ? "Moderate" : "Higher";
}
