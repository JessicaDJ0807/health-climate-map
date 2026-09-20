// The four environmental layers behind the map's layer picker, each painted
// from the same public data the scoring uses — no separate display dataset.
//
// Ranges are the observed NYC spread for each measure, so a colour means the
// same thing on every trip rather than being restretched per view.

export type EnvLayerId = "trees" | "traffic" | "air" | "heat";

export type EnvLayer = {
  id: EnvLayerId;
  label: string;
  /** What one shaded area means, shown under the picker. */
  legend: string;
  /** Low → high swatches, also used for the ramp. */
  palette: string[];
  scale: string;
  source: string;
};

// Sequential ramps, light → dark, one hue family per layer so the four stay
// distinguishable when switched.
export const ENV_LAYERS: Record<EnvLayerId, EnvLayer> = {
  trees: {
    id: "trees",
    label: "Trees",
    legend: "Living trees per km² by neighborhood, with every individual tree drawn once you zoom in.",
    palette: ["#eef7e6", "#cbe7b5", "#96cf87", "#57a765", "#1f7346"],
    scale: "Fewer → more trees",
    source: "NYC Parks Forestry tree inventory",
  },
  traffic: {
    id: "traffic",
    label: "Traffic",
    legend: "Designated truck routes. Scoring counts a route point within 30 m as near traffic.",
    palette: ["#fdead9", "#f9c99f", "#f0a06d", "#dc7048", "#b2452f"],
    scale: "Truck route",
    source: "NYC DOT truck routes",
  },
  air: {
    id: "air",
    label: "Air",
    legend: "Annual PM2.5 and NO₂ by community district, relative to the rest of NYC.",
    palette: ["#edf4fa", "#d0dff0", "#b1c3e0", "#9aa2cc", "#7c7aae"],
    scale: "Lower → higher",
    source: "NYC Environment & Health Data Portal",
  },
  heat: {
    id: "heat",
    label: "Heat",
    legend: "Neighborhood mean surface temperature from the Heat Vulnerability Index.",
    palette: ["#eaf4f4", "#ffe6b8", "#f9c383", "#ec9163", "#cf5c47"],
    scale: "Cooler → hotter",
    source: "NYC Heat Vulnerability Index",
  },
};

export const ENV_LAYER_IDS = Object.keys(ENV_LAYERS) as EnvLayerId[];

/**
 * A MapLibre `interpolate` expression over `property`, spreading `palette`
 * evenly between `min` and `max`.
 */
export function rampFor(property: string, palette: string[], min: number, max: number) {
  const stops = palette.flatMap((color, i) => [min + ((max - min) * i) / (palette.length - 1), color]);
  return ["interpolate", ["linear"], ["to-number", ["get", property], min], ...stops];
}
