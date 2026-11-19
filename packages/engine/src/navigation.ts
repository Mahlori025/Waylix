import { cumulativeDistances, haversine, projectOntoPolyline } from './geo.ts';
import type { LngLat } from './types.ts';

export type TravelMode = 'drive' | 'walk' | 'cycle' | 'fly';

export interface RouteStep {
  instruction: string;
  maneuver: string;
  name: string;
  distanceM: number;
  durationS: number;
  location: LngLat;
}

export interface Route {
  coordinates: LngLat[];
  distanceM: number;
  durationS: number;
  steps: RouteStep[];
  mode: TravelMode;
  provider: string;
  /** True when this route came from the offline cache or a fallback. */
  offline?: boolean;
}

export interface NavigationState {
  snapped: LngLat;
  progressM: number;
  remainingM: number;
  remainingS: number;
  offRoute: boolean;
  offsetM: number;
  stepIndex: number;
  nextStep?: RouteStep;
  distanceToNextStepM: number;
  arrived: boolean;
}

const OFF_ROUTE_M: Record<TravelMode, number> = { drive: 45, cycle: 30, walk: 25, fly: 60 };
const ARRIVE_M: Record<TravelMode, number> = { drive: 30, cycle: 20, walk: 12, fly: 15 };

/**
 * Turn-by-turn progress tracker. Works fully offline once a route is known:
 * it only needs the route geometry and the current position fix.
 */
export class NavigationTracker {
  private readonly cum: number[];
  private readonly stepAlong: number[];
  private lastProgress = 0;

  constructor(readonly route: Route) {
    this.cum = cumulativeDistances(route.coordinates);
    this.stepAlong = route.steps.map((s) => projectOntoPolyline(s.location, route.coordinates, this.cum).alongM);
  }

  get lengthM(): number {
    return this.cum[this.cum.length - 1] ?? 0;
  }

  update(position: LngLat, accuracyM = 10): NavigationState {
    const p = projectOntoPolyline(position, this.route.coordinates, this.cum);
    // Progress is monotone unless the user is clearly going back.
    const progress = p.alongM + 50 < this.lastProgress ? p.alongM : Math.max(p.alongM, this.lastProgress - 5);
    this.lastProgress = Math.max(progress, 0);
    const total = this.lengthM;
    const remainingM = Math.max(0, total - this.lastProgress);
    const remainingS = total > 0 ? this.route.durationS * (remainingM / total) : 0;
    let stepIndex = this.stepAlong.findIndex((a) => a > this.lastProgress + 1);
    if (stepIndex === -1) stepIndex = this.route.steps.length - 1;
    const nextStep = this.route.steps[stepIndex];
    const distanceToNextStepM = nextStep ? Math.max(0, (this.stepAlong[stepIndex] ?? total) - this.lastProgress) : remainingM;
    const end = this.route.coordinates[this.route.coordinates.length - 1]!;
    const threshold = OFF_ROUTE_M[this.route.mode] + Math.min(accuracyM, 50);
    return {
      snapped: p.snapped,
      progressM: this.lastProgress,
      remainingM,
      remainingS,
      offRoute: p.offsetM > threshold,
      offsetM: p.offsetM,
      stepIndex,
      ...(nextStep ? { nextStep } : {}),
      distanceToNextStepM,
      arrived: haversine(position, end) <= ARRIVE_M[this.route.mode] || remainingM <= ARRIVE_M[this.route.mode],
    };
  }
}

export function formatDistance(m: number): string {
  if (m < 50) return `${Math.max(5, Math.round(m / 5) * 5)} m`;
  if (m < 1000) return `${Math.round(m / 10) * 10} m`;
  return `${(m / 1000).toFixed(m < 10_000 ? 1 : 0)} km`;
}

export function formatDuration(s: number): string {
  const min = Math.round(s / 60);
  if (min < 60) return `${Math.max(1, min)} min`;
  return `${Math.floor(min / 60)} h ${min % 60} min`;
}
