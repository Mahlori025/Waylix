import { defaultFetch, type FetchLike } from './http.ts';
import type { LngLat } from './types.ts';

export interface Place {
  name: string;
  label: string;
  position: LngLat;
  kind?: string;
}

/**
 * Photon (komoot) — free OSM geocoder that permits search-as-you-type.
 * Self-host for production (it is a single Java service on top of OSM data).
 */
export class PhotonGeocoder {
  private readonly fetch: FetchLike;
  constructor(private readonly baseUrl = 'https://photon.komoot.io', fetchImpl?: FetchLike) {
    this.fetch = fetchImpl ?? defaultFetch();
  }

  async search(query: string, opts: { near?: LngLat; limit?: number; lang?: string } = {}): Promise<Place[]> {
    const q = query.trim();
    if (q.length < 2) return [];
    const params = [`q=${encodeURIComponent(q)}`, `limit=${opts.limit ?? 8}`];
    if (opts.near) params.push(`lon=${opts.near[0]}`, `lat=${opts.near[1]}`);
    if (opts.lang) params.push(`lang=${encodeURIComponent(opts.lang)}`);
    const res = await this.fetch(`${this.baseUrl}/api/?${params.join('&')}`);
    if (!res.ok) throw new Error(`geocoder HTTP ${res.status}`);
    const body = (await res.json()) as { features?: Array<{ geometry: { coordinates: [number, number] }; properties: Record<string, string | undefined> }> };
    return (body.features ?? []).map((f) => {
      const p = f.properties;
      const name = p.name ?? [p.housenumber, p.street].filter(Boolean).join(' ') ?? 'Unnamed place';
      const label = [p.street && p.name !== p.street ? p.street : undefined, p.district ?? p.locality, p.city, p.country].filter(Boolean).join(', ');
      return { name: name || 'Unnamed place', label, position: [f.geometry.coordinates[0], f.geometry.coordinates[1]] as LngLat, ...(p.osm_value ? { kind: p.osm_value } : {}) };
    });
  }
}
