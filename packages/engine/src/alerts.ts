import { angleDiff, bearing, cumulativeDistances, haversine, projectOntoPolyline } from './geo.ts';
import { formatDistance } from './navigation.ts';
import type { Taxonomy } from './taxonomy.ts';
import type { Hazard, LngLat } from './types.ts';

export interface MotionState {
  position: LngLat;
  speedMps: number;
  headingDeg?: number;
  /** Active route; when present, alerts follow the route instead of the heading cone. */
  route?: readonly LngLat[];
  /** Current progress along `route`, metres. */
  progressM?: number;
}

export interface HazardAlert {
  hazard: Hazard;
  distanceM: number;
  message: string;
  /** 'warning' for severity ≥ 4 or very close; 'info' otherwise. */
  level: 'info' | 'warning';
}

export interface AlertOptions {
  /** Warn this many seconds before reaching a hazard at current speed. */
  lookaheadS?: number;
  minLookaheadM?: number;
  maxLookaheadM?: number;
  /** Half-angle of the forward cone used when no route is active. */
  coneDeg?: number;
  /** Lateral distance from the route within which a hazard is "on route". */
  corridorM?: number;
  minConfidence?: number;
  /** Do not re-announce a hazard within this period. */
  cooldownMs?: number;
}

/**
 * Stateful proximity alerting ("Pothole ahead in 200 m"). Time-based look-ahead
 * means a pedestrian gets warned ~30 m ahead and a car on the highway ~500 m
 * ahead with the same code. Runs entirely on-device against the cached
 * hazard set, so it keeps working with no signal.
 */
export class HazardAlertManager {
  private readonly o: Required<AlertOptions>;
  private readonly announced = new Map<string, number>();
  private routeRef: readonly LngLat[] | undefined;
  private routeCum: number[] = [];

  constructor(private readonly taxonomy: Taxonomy, opts: AlertOptions = {}) {
    this.o = {
      lookaheadS: opts.lookaheadS ?? 25,
      minLookaheadM: opts.minLookaheadM ?? 60,
      maxLookaheadM: opts.maxLookaheadM ?? 1500,
      coneDeg: opts.coneDeg ?? 35,
      corridorM: opts.corridorM ?? 20,
      minConfidence: opts.minConfidence ?? 0.45,
      cooldownMs: opts.cooldownMs ?? 10 * 60_000,
    };
  }

  reset(): void {
    this.announced.clear();
  }

  /** Returns only *new* alerts since the last call (each hazard once per cooldown). */
  update(state: MotionState, hazards: readonly Hazard[], now: number = Date.now()): HazardAlert[] {
    const lookahead = Math.min(this.o.maxLookaheadM, Math.max(this.o.minLookaheadM, state.speedMps * this.o.lookaheadS));
    const out: HazardAlert[] = [];
    for (const h of this.upcoming(state, hazards, lookahead)) {
      const last = this.announced.get(h.hazard.id);
      if (last !== undefined && now - last < this.o.cooldownMs) continue;
      this.announced.set(h.hazard.id, now);
      out.push(h);
    }
    for (const [id, t] of this.announced) if (now - t > this.o.cooldownMs * 3) this.announced.delete(id);
    return out;
  }

  /** All hazards ahead within `lookaheadM`, nearest first (stateless). */
  upcoming(state: MotionState, hazards: readonly Hazard[], lookaheadM: number): HazardAlert[] {
    const out: HazardAlert[] = [];
    const useRoute = state.route && state.route.length >= 2;
    if (useRoute && state.route !== this.routeRef) {
      this.routeRef = state.route;
      this.routeCum = cumulativeDistances(state.route!);
    }
    for (const h of hazards) {
      if (h.confidence < this.o.minConfidence || h.status === 'expired' || h.status === 'resolved') continue;
      const direct = haversine(state.position, h.position);
      if (direct > lookaheadM + h.radiusM + this.o.corridorM) continue;
      let distanceM: number;
      if (useRoute) {
        const p = projectOntoPolyline(h.position, state.route!, this.routeCum);
        if (p.offsetM > this.o.corridorM + h.radiusM) continue;
        const progress = state.progressM ?? projectOntoPolyline(state.position, state.route!, this.routeCum).alongM;
        distanceM = p.alongM - progress;
        // Zones: alert when entering, i.e. radius before the centre.
        if (distanceM < -h.radiusM || distanceM > lookaheadM + h.radiusM) continue;
        distanceM = Math.max(0, distanceM - (h.radiusM > 50 ? h.radiusM : 0));
      } else {
        const inside = direct <= h.radiusM;
        if (!inside) {
          if (state.headingDeg === undefined || state.speedMps < 0.5) {
            if (direct > lookaheadM / 2) continue; // stationary: only nearby
          } else if (Math.abs(angleDiff(state.headingDeg, bearing(state.position, h.position))) > this.o.coneDeg) {
            continue;
          }
        }
        distanceM = Math.max(0, direct - (h.radiusM > 50 ? h.radiusM : 0));
      }
      if (distanceM > lookaheadM) continue;
      const label = this.taxonomy.get(h.type)?.label ?? h.type;
      const zone = this.taxonomy.get(h.type)?.kind === 'zone';
      const message = distanceM < 15 ? (zone ? `Entering ${label.toLowerCase()}` : `${label} right ahead`) : zone ? `Entering ${label.toLowerCase()} in ${formatDistance(distanceM)}` : `${label} ahead in ${formatDistance(distanceM)}`;
      out.push({ hazard: h, distanceM, message, level: h.severity >= 4 || distanceM < 30 ? 'warning' : 'info' });
    }
    return out.sort((a, b) => a.distanceM - b.distanceM);
  }
}
