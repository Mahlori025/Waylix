import { destination, type LngLat, type Observation } from '../src/index.ts';

export const JHB: LngLat = [28.0473, -26.2041]; // Johannesburg CBD
export const T0 = Date.UTC(2026, 10, 19, 8, 0, 0);
export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;

let n = 0;
export function obs(partial: Partial<Observation> & { reporterId?: string } = {}): Observation {
  n++;
  return {
    id: `obs-${n}`,
    type: 'pothole',
    position: JHB,
    accuracyM: 5,
    observedAt: T0,
    reporterId: `user-${n}`,
    platform: 'vehicle',
    source: 'manual',
    ...partial,
  };
}

export const offset = (p: LngLat, bearingDeg: number, m: number): LngLat => destination(p, bearingDeg, m);
