import {
  DirectLineProvider,
  HazardAlertManager,
  HttpSyncTransport,
  OsrmRoutingProvider,
  PhotonGeocoder,
  ResilientRouter,
  SyncClient,
  Taxonomy,
  type FetchLike,
} from '@waylix/engine';
import { asyncStore } from './storage';
import type { Settings } from './settings';

const fetchImpl: FetchLike = (url, init) => fetch(url, init as RequestInit) as unknown as ReturnType<FetchLike>;

export const taxonomy = new Taxonomy();

/**
 * Wires the platform-agnostic engine to this device: AsyncStorage for
 * persistence, fetch for transport. Rebuilt whenever endpoints change.
 */
export interface WaylixServices {
  sync: SyncClient;
  router: ResilientRouter;
  geocoder: PhotonGeocoder;
  alerts: HazardAlertManager;
}

let current: { key: string; services: WaylixServices } | undefined;

export function services(s: Settings): WaylixServices {
  const key = [s.apiUrl, s.driveRoutingUrl, s.walkRoutingUrl, s.geocoderUrl].join('|');
  if (current?.key === key) return current.services;
  const osrm = new OsrmRoutingProvider(
    {
      drive: { baseUrl: s.driveRoutingUrl, profile: 'driving' },
      walk: { baseUrl: s.walkRoutingUrl, profile: 'driving' },
    },
    fetchImpl,
  );
  const svc: WaylixServices = {
    sync: new SyncClient(new HttpSyncTransport(s.apiUrl, fetchImpl), asyncStore),
    router: new ResilientRouter([osrm, new DirectLineProvider()], asyncStore),
    geocoder: new PhotonGeocoder(s.geocoderUrl, fetchImpl),
    alerts: new HazardAlertManager(taxonomy),
  };
  current = { key, services: svc };
  void svc.sync.init();
  return svc;
}
