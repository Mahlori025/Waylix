import { bboxAround, haversine, inBBox } from './geo.ts';
import { geohashCover, geohashEncode } from './geohash.ts';
import type { BBox, LngLat } from './types.ts';

export interface Locatable {
  id: string;
  position: LngLat;
}

/**
 * Geohash-bucketed spatial index. Precision 6 (~1.2 km × 0.6 km cells) keeps
 * radius queries to a handful of buckets at city scale, and the same keys map
 * 1:1 onto server-side partitioning (e.g. a geohash prefix column in PostGIS
 * or a Redis key space) when the deployment grows.
 */
export class SpatialIndex<T extends Locatable> {
  private readonly cells = new Map<string, Map<string, T>>();
  private readonly cellOf = new Map<string, string>();

  constructor(private readonly precision = 6) {}

  get size(): number {
    return this.cellOf.size;
  }

  upsert(item: T): void {
    const cell = geohashEncode(item.position, this.precision);
    const prev = this.cellOf.get(item.id);
    if (prev !== undefined && prev !== cell) this.cells.get(prev)?.delete(item.id);
    let bucket = this.cells.get(cell);
    if (!bucket) {
      bucket = new Map();
      this.cells.set(cell, bucket);
    }
    bucket.set(item.id, item);
    this.cellOf.set(item.id, cell);
  }

  remove(id: string): void {
    const cell = this.cellOf.get(id);
    if (cell === undefined) return;
    const bucket = this.cells.get(cell);
    bucket?.delete(id);
    if (bucket && bucket.size === 0) this.cells.delete(cell);
    this.cellOf.delete(id);
  }

  get(id: string): T | undefined {
    const cell = this.cellOf.get(id);
    return cell === undefined ? undefined : this.cells.get(cell)?.get(id);
  }

  queryBBox(bbox: BBox): T[] {
    let keys: string[];
    try {
      keys = geohashCover(bbox, this.precision);
    } catch {
      // Very large box: a full scan is cheaper than enumerating cells.
      return this.all().filter((t) => inBBox(t.position, bbox));
    }
    const out: T[] = [];
    for (const k of keys) {
      const bucket = this.cells.get(k);
      if (!bucket) continue;
      for (const t of bucket.values()) if (inBBox(t.position, bbox)) out.push(t);
    }
    return out;
  }

  queryRadius(center: LngLat, radiusM: number): Array<{ item: T; distanceM: number }> {
    const out: Array<{ item: T; distanceM: number }> = [];
    for (const item of this.queryBBox(bboxAround(center, radiusM))) {
      const d = haversine(center, item.position);
      if (d <= radiusM) out.push({ item, distanceM: d });
    }
    return out.sort((a, b) => a.distanceM - b.distanceM);
  }

  all(): T[] {
    const out: T[] = [];
    for (const b of this.cells.values()) out.push(...b.values());
    return out;
  }
}
