// MapLibre 6 loads its tile worker from a URL next to its own bundle, which
// Next.js relocates. Serve the worker (and the shared chunk it imports) from
// public/ instead; NycMap points MapLibre at it with setWorkerUrl().
import { copyFileSync, mkdirSync } from "node:fs";

const src = "node_modules/maplibre-gl/dist";
const dest = "public/maplibre";
mkdirSync(dest, { recursive: true });
for (const file of ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"]) {
  copyFileSync(`${src}/${file}`, `${dest}/${file}`);
}
