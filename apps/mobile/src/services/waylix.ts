import { Platform } from 'react-native';
import {
  DirectLineProvider,
  registerDevice,
  type DeviceAuth,
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
import { getSettings, updateSettings, type Settings } from './settings';

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

/**
 * Lazily registers this install with the API and keeps the signed device
 * token in settings. Reports queued before registration are attributed to the
 * device by the server when they sync.
 */
function deviceAuth(apiUrl: string): DeviceAuth {
  let pending: Promise<string | undefined> | undefined;
  return {
    token: () => {
      const existing = getSettings().deviceToken;
      if (existing) return Promise.resolve(existing);
      pending ??= registerDevice(apiUrl, Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : 'web', fetchImpl)
        .then(async (d) => {
          await updateSettings({ deviceToken: d.token, reporterId: d.deviceId });
          return d.token;
        })
        .catch(() => undefined) // offline or server without registration: retry on the next write
        .finally(() => (pending = undefined));
      return pending;
    },
    invalidate: () => updateSettings({ deviceToken: '' }),
  };
}

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
    sync: new SyncClient(new HttpSyncTransport(s.apiUrl, fetchImpl, undefined, deviceAuth(s.apiUrl)), asyncStore),
    router: new ResilientRouter([osrm, new DirectLineProvider()], asyncStore),
    geocoder: new PhotonGeocoder(s.geocoderUrl, fetchImpl),
    alerts: new HazardAlertManager(taxonomy),
  };
  current = { key, services: svc };
  void svc.sync.init();
  return svc;
}
