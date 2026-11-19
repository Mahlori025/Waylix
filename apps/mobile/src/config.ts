import type { LngLat } from '@waylix/engine';

/**
 * Defaults point at free, keyless community services so the app works out of
 * the box. All of them are user-configurable in Settings and should be
 * swapped for self-hosted instances (see infra/) before a public launch.
 */
export const DEFAULTS = {
  /** OpenFreeMap — free OSM vector tiles, no API key. */
  styleUrl: 'https://tiles.openfreemap.org/styles/liberty',
  darkStyleUrl: 'https://tiles.openfreemap.org/styles/dark',
  /**
   * Waylix API (packages/server). Set EXPO_PUBLIC_WAYLIX_API_URL at build time
   * (e.g. in eas.json) for real devices; 10.0.2.2 reaches the host from the Android emulator.
   */
  apiUrl: process.env.EXPO_PUBLIC_WAYLIX_API_URL || 'http://10.0.2.2:8787',
  /** FOSSGIS OSRM — free, volunteer-run, max ~1 req/s. Self-host for production. */
  driveRoutingUrl: 'https://routing.openstreetmap.de/routed-car',
  walkRoutingUrl: 'https://routing.openstreetmap.de/routed-foot',
  geocoderUrl: 'https://photon.komoot.io',
  /** Johannesburg, where Waylix is piloted. */
  initialCenter: [28.0473, -26.2041] as LngLat,
  initialZoom: 12,
};

export const OFFLINE = {
  minZoom: 10,
  maxZoom: 16,
  /** Refuse downloads needing more tiles than this (also set as MapLibre's tile limit). */
  maxTiles: 12_000,
  /** Average OpenFreeMap vector tile size for the estimate shown before download, KB. */
  avgTileKb: 20,
};
