import { bearing, haversine, pointAlong, polylineLength } from './geo.ts';
import { defaultFetch, type FetchLike, type KeyValueStore } from './http.ts';
import type { Route, RouteStep, TravelMode } from './navigation.ts';
import { rankRoutes, type RankedRoute } from './route-risk.ts';
import type { Hazard, LngLat } from './types.ts';

export interface RouteRequest {
  from: LngLat;
  to: LngLat;
  mode: TravelMode;
  alternatives?: boolean;
}

export interface RoutingProvider {
  readonly name: string;
  supports(mode: TravelMode): boolean;
  route(req: RouteRequest): Promise<Route[]>;
}

export interface OsrmEndpoint {
  /** e.g. https://router.project-osrm.org */
  baseUrl: string;
  /** Profile path segment, e.g. 'driving' or 'foot'. */
  profile: string;
}

/**
 * Free public OSRM endpoints. These are community services with fair-use
 * limits — fine for development and pilots; production deployments should
 * point at a self-hosted OSRM/Valhalla (see infra/docker-compose.yml).
 */
export const PUBLIC_OSRM: Readonly<Partial<Record<TravelMode, OsrmEndpoint>>> = {
  drive: { baseUrl: 'https://routing.openstreetmap.de/routed-car', profile: 'driving' },
  walk: { baseUrl: 'https://routing.openstreetmap.de/routed-foot', profile: 'driving' },
  cycle: { baseUrl: 'https://routing.openstreetmap.de/routed-bike', profile: 'driving' },
};

interface OsrmManeuver { type: string; modifier?: string; location: [number, number]; exit?: number }
interface OsrmStep { distance: number; duration: number; name: string; maneuver: OsrmManeuver }
interface OsrmRoute { distance: number; duration: number; geometry: { coordinates: [number, number][] }; legs: Array<{ steps: OsrmStep[] }> }

export class OsrmRoutingProvider implements RoutingProvider {
  readonly name = 'osrm';
  private readonly fetch: FetchLike;

  constructor(
    private readonly endpoints: Partial<Record<TravelMode, OsrmEndpoint>> = PUBLIC_OSRM,
    fetchImpl?: FetchLike,
    private readonly userAgent = 'Waylix/0.1 (AIDotLix)',
  ) {
    this.fetch = fetchImpl ?? defaultFetch();
  }

  supports(mode: TravelMode): boolean {
    return this.endpoints[mode] !== undefined;
  }

  async route(req: RouteRequest): Promise<Route[]> {
    const ep = this.endpoints[req.mode];
    if (!ep) throw new Error(`OSRM: no endpoint for mode ${req.mode}`);
    const coords = `${req.from[0]},${req.from[1]};${req.to[0]},${req.to[1]}`;
    const qs = `overview=full&geometries=geojson&steps=true&alternatives=${req.alternatives ? 'true' : 'false'}`;
    const url = `${ep.baseUrl.replace(/\/$/, '')}/route/v1/${ep.profile}/${coords}?${qs}`;
    const res = await this.fetch(url, { headers: { 'User-Agent': this.userAgent } });
    if (!res.ok) throw new Error(`OSRM HTTP ${res.status}`);
    const body = (await res.json()) as { code: string; message?: string; routes?: OsrmRoute[] };
    if (body.code !== 'Ok' || !body.routes) throw new Error(`OSRM: ${body.code} ${body.message ?? ''}`.trim());
    return body.routes.map((r) => parseOsrmRoute(r, req.mode, this.name));
  }
}

export function parseOsrmRoute(r: OsrmRoute, mode: TravelMode, provider: string): Route {
  const steps: RouteStep[] = [];
  for (const leg of r.legs) {
    for (const s of leg.steps) {
      steps.push({
        instruction: osrmInstruction(s),
        maneuver: s.maneuver.modifier ? `${s.maneuver.type}:${s.maneuver.modifier}` : s.maneuver.type,
        name: s.name,
        distanceM: s.distance,
        durationS: s.duration,
        location: s.maneuver.location,
      });
    }
  }
  return {
    coordinates: r.geometry.coordinates.map(([x, y]) => [x, y] as LngLat),
    distanceM: r.distance,
    durationS: r.duration,
    steps,
    mode,
    provider,
  };
}

export function osrmInstruction(s: OsrmStep): string {
  const { type, modifier, exit } = s.maneuver;
  const onto = s.name ? ` onto ${s.name}` : '';
  const dir = modifier ? modifier.replace('slight ', 'slightly ').replace('sharp ', 'sharp ') : '';
  switch (type) {
    case 'depart': return `Head out${s.name ? ` on ${s.name}` : ''}`;
    case 'arrive': return 'You have arrived';
    case 'turn': case 'end of road': case 'fork':
      return dir === 'straight' ? `Continue straight${onto}` : `Turn ${dir}${onto}`;
    case 'merge': return `Merge${onto}`;
    case 'on ramp': return `Take the ramp${onto}`;
    case 'off ramp': return `Take the exit${onto}`;
    case 'roundabout': case 'rotary': case 'roundabout turn':
      return exit ? `At the roundabout, take exit ${exit}${onto}` : `Enter the roundabout${onto}`;
    case 'exit roundabout': case 'exit rotary': return `Exit the roundabout${onto}`;
    case 'new name': case 'continue': return `Continue${onto}`;
    default: return dir ? `Go ${dir}${onto}` : `Continue${onto}`;
  }
}

/**
 * Straight-line (great-circle) routing. Used for the `fly` mode (drones
 * fly direct unless airspace hazards say otherwise) and as a last-resort
 * offline fallback for walking, clearly flagged as such.
 */
export class DirectLineProvider implements RoutingProvider {
  readonly name = 'direct';
  constructor(private readonly speedsMps: Partial<Record<TravelMode, number>> = { fly: 12, walk: 1.35 }) {}

  supports(mode: TravelMode): boolean {
    return this.speedsMps[mode] !== undefined;
  }

  async route(req: RouteRequest): Promise<Route[]> {
    const speed = this.speedsMps[req.mode];
    if (!speed) throw new Error(`direct: unsupported mode ${req.mode}`);
    const d = haversine(req.from, req.to);
    const n = Math.max(2, Math.min(100, Math.ceil(d / 200)));
    const line: LngLat[] = [req.from, req.to];
    const coords: LngLat[] = [];
    for (let i = 0; i <= n; i++) coords.push(pointAlong(line, (d * i) / n));
    const brg = Math.round(bearing(req.from, req.to));
    return [{
      coordinates: coords,
      distanceM: polylineLength(coords),
      durationS: d / speed,
      mode: req.mode,
      provider: this.name,
      steps: [
        { instruction: `Head ${compass(brg)} (${brg}°) — direct line`, maneuver: 'depart', name: '', distanceM: d, durationS: d / speed, location: req.from },
        { instruction: 'You have arrived', maneuver: 'arrive', name: '', distanceM: 0, durationS: 0, location: req.to },
      ],
    }];
  }
}

function compass(deg: number): string {
  return ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'][Math.round(deg / 45) % 8]!;
}

/**
 * Offline-first wrapper: caches every successful route, and when the network
 * provider fails, serves a cached route whose endpoints are close to the
 * request, then falls back to the next provider in the chain.
 */
export class ResilientRouter implements RoutingProvider {
  readonly name = 'resilient';
  private static readonly KEY = 'waylix.routes.v1';
  private static readonly MAX = 25;

  constructor(
    private readonly chain: RoutingProvider[],
    private readonly store?: KeyValueStore,
    private readonly matchToleranceM = 150,
  ) {}

  supports(mode: TravelMode): boolean {
    return this.chain.some((p) => p.supports(mode));
  }

  async route(req: RouteRequest): Promise<Route[]> {
    let lastError: unknown;
    for (const [i, p] of this.chain.entries()) {
      if (!p.supports(req.mode)) continue;
      try {
        const routes = await p.route(req);
        if (routes.length) {
          if (p.name !== 'direct') await this.remember(req, routes[0]!);
          return p.name === 'direct' && req.mode !== 'fly' ? routes.map((r) => ({ ...r, offline: true })) : routes;
        }
      } catch (e) {
        lastError = e;
        if (i === 0) {
          const cached = await this.recall(req);
          if (cached) return [{ ...cached, offline: true }];
        }
      }
    }
    throw lastError instanceof Error ? lastError : new Error('no routing provider available');
  }

  private async load(): Promise<Array<{ from: LngLat; to: LngLat; route: Route }>> {
    if (!this.store) return [];
    try {
      const raw = await this.store.get(ResilientRouter.KEY);
      return raw ? (JSON.parse(raw) as Array<{ from: LngLat; to: LngLat; route: Route }>) : [];
    } catch {
      return [];
    }
  }

  private async remember(req: RouteRequest, route: Route): Promise<void> {
    if (!this.store) return;
    const all = (await this.load()).filter((e) => !(e.route.mode === req.mode && haversine(e.from, req.from) < 30 && haversine(e.to, req.to) < 30));
    all.unshift({ from: req.from, to: req.to, route });
    await this.store.set(ResilientRouter.KEY, JSON.stringify(all.slice(0, ResilientRouter.MAX)));
  }

  private async recall(req: RouteRequest): Promise<Route | undefined> {
    const tol = this.matchToleranceM;
    return (await this.load()).find((e) => e.route.mode === req.mode && haversine(e.from, req.from) <= tol && haversine(e.to, req.to) <= tol)?.route;
  }
}

/** Ask for alternatives and rank them by time + hazard risk. */
export async function hazardAwareRoute(
  provider: RoutingProvider,
  req: RouteRequest,
  hazards: readonly Hazard[],
  riskWeightS = 6,
): Promise<RankedRoute<Route>[]> {
  const routes = await provider.route({ ...req, alternatives: true });
  const corridorM = req.mode === 'walk' ? 12 : 20;
  return rankRoutes(routes, hazards, { riskWeightS, corridorM });
}
