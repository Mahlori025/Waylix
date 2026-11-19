import { HazardAlertManager, type HazardAlert } from './alerts.ts';
import { NavigationTracker, type NavigationState, type Route, type TravelMode } from './navigation.ts';
import type { Taxonomy } from './taxonomy.ts';
import type { Hazard, LngLat } from './types.ts';

export interface SessionFix {
  position: LngLat;
  accuracyM: number;
  speedMps?: number;
  headingDeg?: number;
}

export interface SessionUpdate {
  state: NavigationState;
  /** Lines to speak, in order (instructions first, then hazard alerts). */
  speak: string[];
  /** New hazard alerts (each hazard once per cooldown). */
  alerts: HazardAlert[];
  /** True when the caller should fetch a new route from the current position. */
  reroute: boolean;
  arrived: boolean;
}

export interface SessionOptions {
  taxonomy: Taxonomy;
  /** Shared alert manager so cooldowns survive across sessions and free driving. */
  alerts?: HazardAlertManager;
  /** Consecutive off-route fixes before asking for a reroute. */
  offRouteFixes?: number;
  rerouteCooldownMs?: number;
}

/** Announce a manoeuvre when it is this close, by travel mode. */
const ANNOUNCE_M: Record<TravelMode, number> = { drive: 160, cycle: 60, walk: 30, fly: 100 };

/**
 * One turn-by-turn navigation session: wraps the tracker, voice prompts,
 * hazard alerts, off-route detection and arrival in a pure, testable object.
 * The app only forwards GPS fixes and acts on the returned update, so the
 * same logic will drive a drone ground-station or an AR view later.
 */
export class NavigationSession {
  private tracker: NavigationTracker;
  private lastSpokenStep = -1;
  private offRouteCount = 0;
  private lastRerouteAt = -Infinity;
  private ended = false;
  private readonly alerts: HazardAlertManager;
  private readonly offRouteFixes: number;
  private readonly cooldownMs: number;

  constructor(private current: Route, opts: SessionOptions) {
    this.tracker = new NavigationTracker(current);
    this.alerts = opts.alerts ?? new HazardAlertManager(opts.taxonomy);
    this.offRouteFixes = opts.offRouteFixes ?? 3;
    this.cooldownMs = opts.rerouteCooldownMs ?? 15_000;
  }

  get route(): Route {
    return this.current;
  }

  get isEnded(): boolean {
    return this.ended;
  }

  /**
   * Begin the session. Returns a full state immediately (no waiting for the
   * next GPS fix) and the opening instruction to speak.
   */
  start(fix: SessionFix | undefined, hazards: readonly Hazard[], now: number = Date.now()): SessionUpdate {
    this.alerts.reset();
    const first = this.current.steps[0]?.instruction ?? 'Starting route';
    const u = this.update(fix ?? { position: this.current.coordinates[0]!, accuracyM: 10 }, hazards, now);
    return { ...u, speak: [first, ...u.speak] };
  }

  /** Feed one position fix. */
  update(fix: SessionFix, hazards: readonly Hazard[], now: number = Date.now()): SessionUpdate {
    const state = this.tracker.update(fix.position, fix.accuracyM);
    if (this.ended) return { state, speak: [], alerts: [], reroute: false, arrived: true };
    if (state.arrived) {
      this.ended = true;
      return { state, speak: ['You have arrived'], alerts: [], reroute: false, arrived: true };
    }
    const speak: string[] = [];
    const near = ANNOUNCE_M[this.current.mode];
    if (state.nextStep && state.stepIndex !== this.lastSpokenStep && state.distanceToNextStepM <= near) {
      this.lastSpokenStep = state.stepIndex;
      speak.push(state.nextStep.instruction);
    }
    let reroute = false;
    this.offRouteCount = state.offRoute ? this.offRouteCount + 1 : 0;
    if (this.offRouteCount >= this.offRouteFixes && now - this.lastRerouteAt > this.cooldownMs) {
      this.lastRerouteAt = now;
      this.offRouteCount = 0;
      reroute = true;
      speak.push('Recalculating');
    }
    const alerts = this.alerts.update(
      {
        position: fix.position,
        speedMps: fix.speedMps ?? 0,
        ...(fix.headingDeg !== undefined ? { headingDeg: fix.headingDeg } : {}),
        route: this.current.coordinates,
        progressM: state.progressM,
      },
      hazards,
      now,
    );
    if (alerts[0]) speak.push(alerts[0].message);
    return { state, speak, alerts, reroute, arrived: false };
  }

  /** Swap in a recalculated route without resetting alert cooldowns. */
  replaceRoute(route: Route): void {
    this.current = route;
    this.tracker = new NavigationTracker(route);
    this.lastSpokenStep = -1;
    this.offRouteCount = 0;
  }
}
