import { bboxOf, cumulativeDistances, expandBBox, inBBox, polylineLength, projectOntoPolyline } from './geo.ts';
import type { Hazard, LngLat } from './types.ts';

export interface RouteHazardHit {
  hazard: Hazard;
  /** Distance from route start to the hazard's closest point on the route. */
  alongM: number;
  /** Perpendicular distance from the route to the hazard centre. */
  offsetM: number;
  /** This hazard's contribution to the route risk score. */
  risk: number;
}

export interface RouteRisk {
  /** Sum of hazard risks; dimensionless. 0 = no known hazards. */
  score: number;
  /** Risk per km, comparable across routes of different length. */
  scorePerKm: number;
  lengthM: number;
  hits: RouteHazardHit[];
  countsByType: Record<string, number>;
}

export interface RouteRiskOptions {
  /** Buffer around the route within which point hazards count, metres. */
  corridorM?: number;
  minConfidence?: number;
}

/**
 * Score a route polyline against known hazards. A hazard counts if its
 * effective radius (zones are large) overlaps the corridor around the route.
 * Risk = severity² × confidence, so one sinkhole outweighs several minor cracks.
 */
export function analyzeRoute(route: readonly LngLat[], hazards: readonly Hazard[], opts: RouteRiskOptions = {}): RouteRisk {
  const corridor = opts.corridorM ?? 20;
  const minConf = opts.minConfidence ?? 0.35;
  const lengthM = polylineLength(route);
  const empty: RouteRisk = { score: 0, scorePerKm: 0, lengthM, hits: [], countsByType: {} };
  if (route.length < 2) return empty;
  const cum = cumulativeDistances(route);
  let maxR = 0;
  for (const h of hazards) maxR = Math.max(maxR, h.radiusM);
  const box = expandBBox(bboxOf(route), corridor + maxR);
  const hits: RouteHazardHit[] = [];
  const counts: Record<string, number> = {};
  let score = 0;
  for (const h of hazards) {
    if (h.confidence < minConf || !inBBox(h.position, box)) continue;
    if (h.status === 'expired' || h.status === 'resolved') continue;
    const p = projectOntoPolyline(h.position, route, cum);
    if (p.offsetM > corridor + h.radiusM) continue;
    const risk = h.severity * h.severity * h.confidence;
    hits.push({ hazard: h, alongM: p.alongM, offsetM: p.offsetM, risk });
    counts[h.type] = (counts[h.type] ?? 0) + 1;
    score += risk;
  }
  hits.sort((a, b) => a.alongM - b.alongM);
  return { score, scorePerKm: lengthM > 0 ? score / (lengthM / 1000) : 0, lengthM, hits, countsByType: counts };
}

export interface RankableRoute {
  coordinates: LngLat[];
  durationS: number;
}

export interface RankedRoute<R extends RankableRoute> {
  route: R;
  risk: RouteRisk;
  /** Generalised cost in seconds: duration + riskWeightS × risk score. */
  costS: number;
}

/**
 * Rank alternatives by generalised cost. `riskWeightS` is how many seconds of
 * extra travel a user would accept to avoid one unit of risk (≈ one
 * confident severity-1 hazard; a confident sinkhole is 25 units).
 */
export function rankRoutes<R extends RankableRoute>(
  routes: readonly R[],
  hazards: readonly Hazard[],
  opts: RouteRiskOptions & { riskWeightS?: number } = {},
): RankedRoute<R>[] {
  const w = opts.riskWeightS ?? 6;
  return routes
    .map((route) => {
      const risk = analyzeRoute(route.coordinates, hazards, opts);
      return { route, risk, costS: route.durationS + w * risk.score };
    })
    .sort((a, b) => a.costS - b.costS);
}
