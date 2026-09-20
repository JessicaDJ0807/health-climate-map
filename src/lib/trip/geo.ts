// Small geometry helpers for route sampling. Distances use a local
// equirectangular projection, which is accurate to well under 1% at NYC scale.

export type LngLat = [number, number];

const M_PER_DEG_LAT = 110_574;
const M_PER_DEG_LNG_NYC = 111_320 * Math.cos((40.7 * Math.PI) / 180);

export function toMeters([lng, lat]: LngLat): [number, number] {
  return [lng * M_PER_DEG_LNG_NYC, lat * M_PER_DEG_LAT];
}

export function distanceM(a: LngLat, b: LngLat) {
  const [ax, ay] = toMeters(a);
  const [bx, by] = toMeters(b);
  return Math.hypot(ax - bx, ay - by);
}

/** Decode a Valhalla polyline (precision 6) into [lng, lat] pairs. */
export function decodePolyline6(str: string): LngLat[] {
  const coords: LngLat[] = [];
  let index = 0, lat = 0, lng = 0;
  while (index < str.length) {
    for (const axis of [0, 1]) {
      let result = 0, shift = 0, byte: number;
      do {
        byte = str.charCodeAt(index++) - 63;
        result |= (byte & 0x1f) << shift;
        shift += 5;
      } while (byte >= 0x20);
      const delta = result & 1 ? ~(result >> 1) : result >> 1;
      if (axis === 0) lat += delta;
      else lng += delta;
    }
    coords.push([lng / 1e6, lat / 1e6]);
  }
  return coords;
}

/** Points every `stepM` metres along a line (including both ends). */
export function sampleLine(line: LngLat[], stepM: number): LngLat[] {
  const out: LngLat[] = [line[0]];
  let carry = 0;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1], b = line[i];
    const seg = distanceM(a, b);
    let d = stepM - carry;
    while (d <= seg) {
      const t = d / seg;
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      d += stepM;
    }
    carry = seg - (d - stepM);
  }
  out.push(line[line.length - 1]);
  return out;
}

export function bboxOf(lines: LngLat[][], padM = 0): [number, number, number, number] {
  let [w, s, e, n] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const line of lines) {
    for (const [x, y] of line) {
      w = Math.min(w, x); e = Math.max(e, x); s = Math.min(s, y); n = Math.max(n, y);
    }
  }
  const dx = padM / M_PER_DEG_LNG_NYC, dy = padM / M_PER_DEG_LAT;
  return [w - dx, s - dy, e + dx, n + dy];
}

/**
 * Uniform grid over projected metres for fast "anything within r metres"
 * queries. Each point carries a small integer weight; trees use it for the
 * pollen class, and callers that don't care leave it at 0.
 */
export class PointGrid {
  private cells = new Map<string, [number, number, number][]>();
  constructor(private cellM: number) {}

  private key(x: number, y: number) {
    return `${Math.floor(x / this.cellM)},${Math.floor(y / this.cellM)}`;
  }

  add(p: LngLat, weight = 0) {
    const [x, y] = toMeters(p);
    const k = this.key(x, y);
    const cell = this.cells.get(k);
    if (cell) cell.push([x, y, weight]);
    else this.cells.set(k, [[x, y, weight]]);
  }

  /** How many points lie within `r`, and the sum of their weights. */
  within(p: LngLat, r: number): { n: number; weight: number } {
    const [x, y] = toMeters(p);
    const cx = Math.floor(x / this.cellM), cy = Math.floor(y / this.cellM);
    const reach = Math.ceil(r / this.cellM);
    let n = 0, weight = 0;
    for (let i = cx - reach; i <= cx + reach; i++) {
      for (let j = cy - reach; j <= cy + reach; j++) {
        for (const [px, py, w] of this.cells.get(`${i},${j}`) ?? []) {
          if (Math.hypot(px - x, py - y) <= r) { n++; weight += w; }
        }
      }
    }
    return { n, weight };
  }

  countWithin(p: LngLat, r: number) {
    return this.within(p, r).n;
  }
}

/** Grid of line segments, for "is this point within r metres of any segment". */
export class SegmentGrid {
  private cells = new Map<string, number[]>(); // segment indices
  private segs: [number, number, number, number][] = [];
  constructor(private cellM: number) {}

  /** `flat` is [lng0, lat0, lng1, lat1, ...]. */
  addLine(flat: number[]) {
    for (let i = 2; i < flat.length; i += 2) {
      const [ax, ay] = toMeters([flat[i - 2], flat[i - 1]]);
      const [bx, by] = toMeters([flat[i], flat[i + 1]]);
      const idx = this.segs.push([ax, ay, bx, by]) - 1;
      const c = this.cellM;
      for (let cx = Math.floor(Math.min(ax, bx) / c); cx <= Math.floor(Math.max(ax, bx) / c); cx++) {
        for (let cy = Math.floor(Math.min(ay, by) / c); cy <= Math.floor(Math.max(ay, by) / c); cy++) {
          const k = `${cx},${cy}`;
          const cell = this.cells.get(k);
          if (cell) cell.push(idx);
          else this.cells.set(k, [idx]);
        }
      }
    }
  }

  isWithin(p: LngLat, r: number) {
    const [x, y] = toMeters(p);
    const cx = Math.floor(x / this.cellM), cy = Math.floor(y / this.cellM);
    const reach = Math.ceil(r / this.cellM);
    for (let i = cx - reach; i <= cx + reach; i++) {
      for (let j = cy - reach; j <= cy + reach; j++) {
        for (const idx of this.cells.get(`${i},${j}`) ?? []) {
          if (pointSegDist(x, y, this.segs[idx]) <= r) return true;
        }
      }
    }
    return false;
  }
}

function pointSegDist(x: number, y: number, [ax, ay, bx, by]: [number, number, number, number]) {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len2)) : 0;
  return Math.hypot(x - (ax + t * dx), y - (ay + t * dy));
}
