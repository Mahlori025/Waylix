import { useSyncExternalStore } from 'react';
import { uuid } from '@waylix/engine';
import { DEFAULTS } from '../config';
import { asyncStore } from './storage';

export interface Settings {
  /** Server-issued device id once registered; a local anonymous id before that. */
  reporterId: string;
  /** Signed device token from POST /v1/devices (empty until registered). */
  deviceToken: string;
  apiUrl: string;
  styleUrl: string;
  driveRoutingUrl: string;
  walkRoutingUrl: string;
  geocoderUrl: string;
  voice: boolean;
  autoDetectPotholes: boolean;
  avoidHazards: boolean;
}

const KEY = 'waylix.settings.v1';

let state: Settings = {
  reporterId: '',
  deviceToken: '',
  apiUrl: DEFAULTS.apiUrl,
  styleUrl: DEFAULTS.styleUrl,
  driveRoutingUrl: DEFAULTS.driveRoutingUrl,
  walkRoutingUrl: DEFAULTS.walkRoutingUrl,
  geocoderUrl: DEFAULTS.geocoderUrl,
  voice: true,
  autoDetectPotholes: false,
  avoidHazards: true,
};
let loaded = false;
const listeners = new Set<() => void>();

export async function loadSettings(): Promise<Settings> {
  if (loaded) return state;
  try {
    const raw = await asyncStore.get(KEY);
    if (raw) state = { ...state, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    // corrupt settings: keep defaults
  }
  // Anonymous, random reporter id — no account, no PII.
  if (!state.reporterId) state = { ...state, reporterId: `anon-${uuid()}` };
  loaded = true;
  await asyncStore.set(KEY, JSON.stringify(state));
  listeners.forEach((l) => l());
  return state;
}

export function getSettings(): Settings {
  return state;
}

export async function updateSettings(patch: Partial<Settings>): Promise<void> {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
  await asyncStore.set(KEY, JSON.stringify(state));
}

export function useSettings(): Settings {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => state,
  );
}
