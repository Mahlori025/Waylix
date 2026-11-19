import type { BBox, LngLat } from './types.ts';

const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';
const DECODE = new Map([...BASE32].map((c, i) => [c, i] as const));

/** Encode a position as a geohash string of `precision` characters. */
export function geohashEncode(p: LngLat, precision = 9): string {
  let minLat = -90, maxLat = 90, minLon = -180, maxLon = 180;
  let hash = '';
  let bit = 0;
  let ch = 0;
  let even = true;
  while (hash.length < precision) {
    if (even) {
      const mid = (minLon + maxLon) / 2;
      if (p[0] >= mid) { ch = (ch << 1) | 1; minLon = mid; } else { ch <<= 1; maxLon = mid; }
    } else {
      const mid = (minLat + maxLat) / 2;
      if (p[1] >= mid) { ch = (ch << 1) | 1; minLat = mid; } else { ch <<= 1; maxLat = mid; }
    }
    even = !even;
    if (++bit === 5) {
      hash += BASE32[ch];
      bit = 0;
      ch = 0;
    }
  }
  return hash;
}

/** Bounding box of a geohash cell. */
export function geohashBounds(hash: string): BBox {
  let minLat = -90, maxLat = 90, minLon = -180, maxLon = 180;
  let even = true;
  for (const c of hash) {
    const v = DECODE.get(c);
    if (v === undefined) throw new Error(`invalid geohash char: ${c}`);
    for (let n = 4; n >= 0; n--) {
      const bitN = (v >> n) & 1;
      if (even) {
        const mid = (minLon + maxLon) / 2;
        if (bitN) minLon = mid; else maxLon = mid;
      } else {
        const mid = (minLat + maxLat) / 2;
        if (bitN) minLat = mid; else maxLat = mid;
      }
      even = !even;
    }
  }
  return [minLon, minLat, maxLon, maxLat];
}

export function geohashDecode(hash: string): LngLat {
  const b = geohashBounds(hash);
  return [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];
}

/** Cell size in degrees for a precision. */
export function geohashCellSize(precision: number): { dLon: number; dLat: number } {
  const bits = precision * 5;
  const lonBits = Math.ceil(bits / 2);
  const latBits = Math.floor(bits / 2);
  return { dLon: 360 / 2 ** lonBits, dLat: 180 / 2 ** latBits };
}

/**
 * All geohash cells of `precision` that intersect `bbox`. Throws if more than
 * `maxCells` would be produced, so callers pick a coarser precision instead of
 * accidentally scanning a continent cell by cell.
 */
export function geohashCover(bbox: BBox, precision: number, maxCells = 4096): string[] {
  const { dLon, dLat } = geohashCellSize(precision);
  const minLon = Math.max(-180, bbox[0]);
  const maxLon = Math.min(180, bbox[2]);
  const minLat = Math.max(-90, bbox[1]);
  const maxLat = Math.min(90, bbox[3]);
  const cols = Math.floor(maxLon / dLon) - Math.floor(minLon / dLon) + 1;
  const rows = Math.floor(maxLat / dLat) - Math.floor(minLat / dLat) + 1;
  if (cols * rows > maxCells) {
    throw new RangeError(`bbox too large for precision ${precision}: ${cols * rows} cells`);
  }
  const out = new Set<string>();
  const lon0 = (Math.floor(minLon / dLon) + 0.5) * dLon;
  const lat0 = (Math.floor(minLat / dLat) + 0.5) * dLat;
  for (let r = 0; r < rows; r++) {
    const lat = Math.min(89.999999, lat0 + r * dLat);
    for (let c = 0; c < cols; c++) {
      const lon = Math.min(179.999999, lon0 + c * dLon);
      out.add(geohashEncode([lon, lat], precision));
    }
  }
  return [...out];
}
