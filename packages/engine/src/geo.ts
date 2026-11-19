import type { BBox, LngLat } from './types.ts';

export const EARTH_RADIUS_M = 6_371_008.8;
const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

export const toRad = (d: number): number => d * RAD;
export const toDeg = (r: number): number => r * DEG;

/** Great-circle distance in metres. */
export function haversine(a: LngLat, b: LngLat): number {
  const dLat = toRad(b[1] - a[1]);
  const dLon = toRad(b[0] - a[0]);
  const s =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Initial bearing from a to b, degrees clockwise from north, [0, 360). */
export function bearing(a: LngLat, b: LngLat): number {
  const φ1 = toRad(a[1]);
  const φ2 = toRad(b[1]);
  const Δλ = toRad(b[0] - a[0]);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/** Point reached travelling `distanceM` from `origin` on `bearingDeg`. */
export function destination(origin: LngLat, bearingDeg: number, distanceM: number): LngLat {
  const δ = distanceM / EARTH_RADIUS_M;
  const θ = toRad(bearingDeg);
  const φ1 = toRad(origin[1]);
  const λ1 = toRad(origin[0]);
  const φ2 = Math.asin(Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ));
  const λ2 = λ1 + Math.atan2(Math.sin(θ) * Math.sin(δ) * Math.cos(φ1), Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2));
  return [((toDeg(λ2) + 540) % 360) - 180, toDeg(φ2)];
}

/** Smallest signed difference b − a in degrees, in (−180, 180]. */
export function angleDiff(a: number, b: number): number {
  let d = (b - a) % 360;
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
}

/** Bounding box of `center` expanded by `radiusM` in every direction. */
export function bboxAround(center: LngLat, radiusM: number): BBox {
  const dLat = toDeg(radiusM / EARTH_RADIUS_M);
  const cos = Math.max(1e-6, Math.cos(toRad(center[1])));
  const dLon = Math.min(180, dLat / cos);
  return [center[0] - dLon, center[1] - dLat, center[0] + dLon, center[1] + dLat];
}

export function bboxOf(points: readonly LngLat[]): BBox {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of points) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return [minX, minY, maxX, maxY];
}

export function expandBBox(b: BBox, marginM: number): BBox {
  const midLat = (b[1] + b[3]) / 2;
  const dLat = toDeg(marginM / EARTH_RADIUS_M);
  const dLon = dLat / Math.max(1e-6, Math.cos(toRad(midLat)));
  return [b[0] - dLon, b[1] - dLat, b[2] + dLon, b[3] + dLat];
}

export function inBBox(p: LngLat, b: BBox): boolean {
  return p[0] >= b[0] && p[0] <= b[2] && p[1] >= b[1] && p[1] <= b[3];
}

export function polylineLength(line: readonly LngLat[]): number {
  let total = 0;
  for (let i = 1; i < line.length; i++) total += haversine(line[i - 1]!, line[i]!);
  return total;
}

export interface PolylineProjection {
  /** Distance along the line from its start to the projected point, metres. */
  alongM: number;
  /** Perpendicular distance from the point to the line, metres. */
  offsetM: number;
  /** Index of the segment [i, i+1] the point projects onto. */
  segmentIndex: number;
  /** The projected (snapped) point on the line. */
  snapped: LngLat;
}

/**
 * Project a point onto a polyline using a local equirectangular plane per
 * segment. Accurate to well under a metre for segments shorter than a few km,
 * which is what routing engines return.
 */
export function projectOntoPolyline(p: LngLat, line: readonly LngLat[], cumulative?: readonly number[]): PolylineProjection {
  if (line.length === 0) throw new Error('empty polyline');
  if (line.length === 1) {
    return { alongM: 0, offsetM: haversine(p, line[0]!), segmentIndex: 0, snapped: line[0]! };
  }
  const cum = cumulative ?? cumulativeDistances(line);
  let best: PolylineProjection = { alongM: 0, offsetM: Infinity, segmentIndex: 0, snapped: line[0]! };
  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i]!;
    const b = line[i + 1]!;
    const kx = Math.cos(toRad((a[1] + b[1]) / 2)) * RAD * EARTH_RADIUS_M;
    const ky = RAD * EARTH_RADIUS_M;
    const bx = (b[0] - a[0]) * kx;
    const by = (b[1] - a[1]) * ky;
    const px = (p[0] - a[0]) * kx;
    const py = (p[1] - a[1]) * ky;
    const len2 = bx * bx + by * by;
    let t = len2 > 0 ? (px * bx + py * by) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    const dx = px - t * bx;
    const dy = py - t * by;
    const off = Math.sqrt(dx * dx + dy * dy);
    if (off < best.offsetM) {
      const segLen = cum[i + 1]! - cum[i]!;
      best = {
        alongM: cum[i]! + t * segLen,
        offsetM: off,
        segmentIndex: i,
        snapped: [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])],
      };
    }
  }
  return best;
}

export function cumulativeDistances(line: readonly LngLat[]): number[] {
  const out = new Array<number>(line.length);
  out[0] = 0;
  for (let i = 1; i < line.length; i++) out[i] = out[i - 1]! + haversine(line[i - 1]!, line[i]!);
  return out;
}

/** Point at `alongM` metres along the polyline. */
export function pointAlong(line: readonly LngLat[], alongM: number, cumulative?: readonly number[]): LngLat {
  const cum = cumulative ?? cumulativeDistances(line);
  if (alongM <= 0) return line[0]!;
  const total = cum[cum.length - 1]!;
  if (alongM >= total) return line[line.length - 1]!;
  let i = 0;
  while (i < cum.length - 2 && cum[i + 1]! < alongM) i++;
  const segLen = cum[i + 1]! - cum[i]!;
  const t = segLen > 0 ? (alongM - cum[i]!) / segLen : 0;
  const a = line[i]!;
  const b = line[i + 1]!;
  return [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
}

export function isValidLngLat(p: unknown): p is LngLat {
  return (
    Array.isArray(p) &&
    p.length === 2 &&
    typeof p[0] === 'number' &&
    typeof p[1] === 'number' &&
    Number.isFinite(p[0]) &&
    Number.isFinite(p[1]) &&
    p[0] >= -180 &&
    p[0] <= 180 &&
    p[1] >= -90 &&
    p[1] <= 90
  );
}

/** Web-Mercator XYZ tile index containing a point at zoom z. */
export function tileOf(p: LngLat, z: number): [x: number, y: number] {
  const n = 2 ** z;
  const lat = Math.max(-85.05112878, Math.min(85.05112878, p[1]));
  const s = Math.sin(toRad(lat));
  const x = Math.floor(((p[0] + 180) / 360) * n);
  const y = Math.floor((0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n);
  return [Math.min(n - 1, Math.max(0, x)), Math.min(n - 1, Math.max(0, y))];
}

/** Number of map tiles an offline download of `bbox` needs across [minZoom, maxZoom]. */
export function tileCount(bbox: BBox, minZoom: number, maxZoom: number): number {
  let total = 0;
  for (let z = minZoom; z <= maxZoom; z++) {
    const [x0, y0] = tileOf([bbox[0], bbox[3]], z);
    const [x1, y1] = tileOf([bbox[2], bbox[1]], z);
    total += (x1 - x0 + 1) * (y1 - y0 + 1);
  }
  return total;
}

/** Area of a bbox in km² (equirectangular approximation, fine below ~100 km). */
export function bboxAreaKm2(b: BBox): number {
  const w = haversine([b[0], (b[1] + b[3]) / 2], [b[2], (b[1] + b[3]) / 2]);
  const h = haversine([b[0], b[1]], [b[0], b[3]]);
  return (w * h) / 1e6;
}
