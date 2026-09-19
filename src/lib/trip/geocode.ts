// Place search and reverse lookup.
//
// NYC GeoSearch (NYC Planning Labs) is the city's address directory: excellent
// for addresses and buildings, weak for landmarks and points of interest
// (e.g. "MoMA" only finds MoMA PS1). Photon (komoot, OpenStreetMap data) fills
// that gap. Both are free, keyless and CORS-enabled; results are merged.
import { distanceM } from "./geo";

export type Place = { label: string; lng: number; lat: number };

/** Current map view, used to rank nearby results first. */
export type SearchNear = { lng: number; lat: number; zoom: number };

const GEOSEARCH = "https://geosearch.planninglabs.nyc/v2";
const PHOTON = "https://photon.komoot.io/api/";
const NYC_BBOX = "-74.26,40.49,-73.69,40.92";

// GeoSearch labels are upper case ("285 FULTON STREET, New York, NY, USA").
function tidy(label: string) {
  return label
    .replace(/, NY, USA$/, "")
    .toLowerCase()
    .replace(/\b([a-z])/g, (c) => c.toUpperCase());
}

async function geosearch(text: string, signal?: AbortSignal, near?: SearchNear): Promise<Place[]> {
  const params = new URLSearchParams({ text });
  if (near) {
    params.set("focus.point.lat", String(near.lat));
    params.set("focus.point.lon", String(near.lng));
  }
  const res = await fetch(`${GEOSEARCH}/autocomplete?${params}`, { signal });
  if (!res.ok) return [];
  const data = await res.json();
  return (data.features ?? []).map((f: GeoJSON.Feature<GeoJSON.Point, { label: string }>) => ({
    label: tidy(f.properties.label),
    lng: f.geometry.coordinates[0],
    lat: f.geometry.coordinates[1],
  }));
}

type PhotonProps = {
  name?: string;
  housenumber?: string;
  street?: string;
  district?: string;
  city?: string;
  state?: string;
};

async function photon(text: string, signal?: AbortSignal, near?: SearchNear): Promise<Place[]> {
  const params = new URLSearchParams({ q: text, limit: "6", bbox: NYC_BBOX, lang: "en" });
  if (near) {
    // Prefer results near the map view; the zoom sets how local "near" is.
    // Distinctive places (MoMA, Central Park) still outrank nearby weak matches.
    params.set("lat", String(near.lat));
    params.set("lon", String(near.lng));
    params.set("zoom", String(Math.round(Math.min(16, Math.max(10, near.zoom)))));
  }
  const res = await fetch(`${PHOTON}?${params}`, { signal });
  if (!res.ok) return [];
  const data = await res.json();
  return (data.features ?? []).flatMap((f: GeoJSON.Feature<GeoJSON.Point, PhotonProps>) => {
    const p = f.properties;
    // The NYC bounding box also covers parts of New Jersey.
    if (p.state && p.state !== "New York") return [];
    const street = [p.housenumber, p.street].filter(Boolean).join(" ");
    const name = p.name ?? street;
    if (!name) return [];
    const where = [p.name ? street : "", p.district ?? p.city].filter(Boolean).join(", ");
    return [{ label: where ? `${name}, ${where}` : name, lng: f.geometry.coordinates[0], lat: f.geometry.coordinates[1] }];
  });
}

/** Merged suggestions: addresses first for address-like input, places first otherwise. */
export async function searchPlaces(text: string, signal?: AbortSignal, near?: SearchNear): Promise<Place[]> {
  const [addresses, places] = await Promise.all([
    geosearch(text, signal, near).catch(() => []),
    photon(text, signal, near).catch(() => []),
  ]);
  const addressFirst = /^\d/.test(text.trim());
  const ordered = addressFirst ? [...addresses, ...places] : [...places, ...addresses];
  // Drop duplicates: identical labels (OSM splits long streets into many
  // pieces), or the same name at nearly the same spot from both sources.
  const out: Place[] = [];
  const name = (p: Place) => p.label.split(",")[0].toLowerCase();
  for (const p of ordered) {
    const dup = out.some(
      (q) => q.label.toLowerCase() === p.label.toLowerCase() ||
        (name(q) === name(p) && distanceM([p.lng, p.lat], [q.lng, q.lat]) < 40),
    );
    if (!dup) out.push(p);
    if (out.length === 6) break;
  }
  return out;
}

/** Nearest address for a clicked point; falls back to "Dropped pin". */
export async function reverseGeocode(lng: number, lat: number): Promise<Place> {
  const fallback = { label: "Dropped pin", lng, lat };
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 2000);
    const res = await fetch(`${GEOSEARCH}/reverse?point.lat=${lat}&point.lon=${lng}&size=1`, { signal: ctrl.signal });
    clearTimeout(timer);
    const data = await res.json();
    const label = data.features?.[0]?.properties?.label;
    // Keep the exact clicked point; the label is just the nearest address.
    return label ? { label: `Near ${tidy(label)}`, lng, lat } : fallback;
  } catch {
    return fallback;
  }
}
