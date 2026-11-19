import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  BumpDetector,
  DirectLineProvider,
  DroneObservationAdapter,
  HazardAlertManager,
  HazardFusionEngine,
  MemoryStore,
  NavigationTracker,
  OsrmRoutingProvider,
  PositionFuser,
  ResilientRouter,
  SyncClient,
  Taxonomy,
  analyzeRoute,
  haversine,
  projectPixelToGround,
  rankRoutes,
  type FetchLike,
  type Hazard,
  type LngLat,
  type Observation,
  type Route,
  type SyncTransport,
} from '../src/index.ts';
import { JHB, T0, obs, offset } from './helpers.ts';

const east = (m: number): LngLat => offset(JHB, 90, m);
const straight: LngLat[] = [JHB, east(500), east(1000), east(2000)];

function activeHazards(e: HazardFusionEngine): Hazard[] {
  return e.query({});
}

test('analyzeRoute finds on-route hazards in order and ignores off-route ones', () => {
  const e = new HazardFusionEngine();
  for (const r of ['a', 'b']) {
    e.ingest(obs({ reporterId: r, position: offset(east(1500), 0, 5) }), T0);
    e.ingest(obs({ reporterId: r, type: 'sinkhole', position: east(300) }), T0);
    e.ingest(obs({ reporterId: r, position: offset(east(800), 0, 200) }), T0); // 200 m off route
  }
  const risk = analyzeRoute(straight, activeHazards(e));
  assert.equal(risk.hits.length, 2);
  assert.equal(risk.hits[0]!.hazard.type, 'sinkhole');
  assert.ok(Math.abs(risk.hits[0]!.alongM - 300) < 2);
  assert.ok(Math.abs(risk.hits[1]!.alongM - 1500) < 2);
  assert.ok(risk.score > 0);
});

test('rankRoutes prefers a slightly slower but much safer route', () => {
  const e = new HazardFusionEngine();
  for (const r of ['a', 'b', 'c']) e.ingest(obs({ reporterId: r, type: 'sinkhole', position: east(300) }), T0);
  const north: LngLat[] = [JHB, offset(JHB, 0, 300), offset(east(2000), 0, 300), east(2000)];
  const ranked = rankRoutes([{ coordinates: straight, durationS: 120 }, { coordinates: north, durationS: 150 }], activeHazards(e));
  assert.equal(ranked[0]!.route.coordinates, north);
});

test('alerts: route-following warning fires once with distance', () => {
  const e = new HazardFusionEngine();
  for (const r of ['a', 'b']) e.ingest(obs({ reporterId: r, position: east(400) }), T0);
  const am = new HazardAlertManager(new Taxonomy());
  const state = { position: JHB, speedMps: 16.7, route: straight, progressM: 0 };
  const a1 = am.update(state, activeHazards(e), T0);
  assert.equal(a1.length, 1);
  assert.match(a1[0]!.message, /Pothole ahead in 4\d0 m/);
  assert.equal(am.update(state, activeHazards(e), T0 + 1000).length, 0, 'not repeated');
  // A walker 400 m away is not warned yet (look-ahead scales with speed).
  const walker = new HazardAlertManager(new Taxonomy());
  assert.equal(walker.update({ position: JHB, speedMps: 1.4, route: straight, progressM: 0 }, activeHazards(e), T0).length, 0);
});

test('alerts: heading cone when no route', () => {
  const e = new HazardFusionEngine();
  for (const r of ['a', 'b']) e.ingest(obs({ reporterId: r, position: east(200) }), T0);
  const am = new HazardAlertManager(new Taxonomy());
  assert.equal(am.update({ position: JHB, speedMps: 14, headingDeg: 270 }, activeHazards(e), T0).length, 0, 'behind');
  assert.equal(am.update({ position: JHB, speedMps: 14, headingDeg: 85 }, activeHazards(e), T0).length, 1, 'ahead');
});

test('NavigationTracker tracks progress, steps, off-route and arrival', () => {
  const route: Route = {
    coordinates: straight,
    distanceM: 2000,
    durationS: 200,
    mode: 'drive',
    provider: 'test',
    steps: [
      { instruction: 'Head east', maneuver: 'depart', name: 'A', distanceM: 1000, durationS: 100, location: JHB },
      { instruction: 'Continue', maneuver: 'continue', name: 'B', distanceM: 1000, durationS: 100, location: east(1000) },
      { instruction: 'Arrive', maneuver: 'arrive', name: '', distanceM: 0, durationS: 0, location: east(2000) },
    ],
  };
  const t = new NavigationTracker(route);
  const s1 = t.update(offset(east(600), 0, 5));
  assert.ok(Math.abs(s1.progressM - 600) < 2);
  assert.equal(s1.nextStep?.name, 'B');
  assert.ok(Math.abs(s1.distanceToNextStepM - 400) < 2);
  assert.ok(Math.abs(s1.remainingS - 140) < 1);
  assert.equal(s1.offRoute, false);
  assert.equal(t.update(offset(east(700), 0, 150)).offRoute, true);
  assert.equal(t.update(east(1995)).arrived, true);
});

test('OSRM provider parses routes and builds instructions', async () => {
  const fakeFetch: FetchLike = async (url) => {
    assert.match(url, /routed-foot\/route\/v1\/driving\/28\.0473,-26\.2041;/);
    return {
      ok: true,
      status: 200,
      text: async () => '',
      json: async () => ({
        code: 'Ok',
        routes: [{
          distance: 1000, duration: 700,
          geometry: { coordinates: [JHB, east(1000)] },
          legs: [{ steps: [
            { distance: 600, duration: 400, name: 'Commissioner St', maneuver: { type: 'depart', location: JHB } },
            { distance: 400, duration: 300, name: 'Rissik St', maneuver: { type: 'turn', modifier: 'left', location: east(600) } },
            { distance: 0, duration: 0, name: '', maneuver: { type: 'arrive', location: east(1000) } },
          ] }],
        }],
      }),
    };
  };
  const p = new OsrmRoutingProvider(undefined, fakeFetch);
  const [r] = await p.route({ from: JHB, to: east(1000), mode: 'walk' });
  assert.equal(r!.steps[1]!.instruction, 'Turn left onto Rissik St');
  assert.equal(r!.steps[0]!.instruction, 'Head out on Commissioner St');
  assert.equal(r!.mode, 'walk');
});

test('ResilientRouter serves cached routes offline, then direct-line fallback', async () => {
  let online = true;
  const net = {
    name: 'net',
    supports: () => true,
    route: async (req: { from: LngLat; to: LngLat; mode: 'walk' }) => {
      if (!online) throw new Error('offline');
      return [{ coordinates: [req.from, req.to], distanceM: 1, durationS: 1, steps: [], mode: req.mode, provider: 'net' }] as Route[];
    },
  };
  const router = new ResilientRouter([net, new DirectLineProvider()], new MemoryStore());
  await router.route({ from: JHB, to: east(1000), mode: 'walk' });
  online = false;
  const cached = await router.route({ from: offset(JHB, 0, 40), to: east(1010), mode: 'walk' });
  assert.equal(cached[0]!.provider, 'net');
  assert.equal(cached[0]!.offline, true);
  const fallback = await router.route({ from: east(5000), to: east(6000), mode: 'walk' });
  assert.equal(fallback[0]!.provider, 'direct');
  assert.equal(fallback[0]!.offline, true);
});

test('drone: nadir camera projects centre pixel straight down; forward pixels ahead', () => {
  const cam = { widthPx: 4000, heightPx: 3000, horizontalFovDeg: 84, verticalFovDeg: 66 };
  const pose = { position: JHB, altitudeAglM: 60, headingDeg: 90, gimbalPitchDeg: 90, accuracyM: 1.5 };
  const c = projectPixelToGround(pose, cam, 2000, 1500)!;
  assert.ok(c.groundRangeM < 0.01);
  const top = projectPixelToGround(pose, cam, 2000, 0)!; // top of frame = ahead (east)
  assert.ok(Math.abs(top.groundRangeM - 60 * Math.tan((33 * Math.PI) / 180)) < 0.5);
  assert.ok(top.position[0] > JHB[0]);
  assert.equal(projectPixelToGround({ ...pose, gimbalPitchDeg: 10 }, cam, 2000, 0), null, 'above horizon');
  const adapter = new DroneObservationAdapter('drone-7', cam);
  const out = adapter.toObservations(pose, [
    { type: 'pothole', u: 2000, v: 1500, confidence: 0.9, timestamp: T0 },
    { type: 'aerial_obstacle', u: 10, v: 10, confidence: 0.8, timestamp: T0 },
    { type: 'pothole', u: 0, v: 0, confidence: 0.1, timestamp: T0 },
  ]);
  assert.equal(out.length, 2);
  assert.equal(out[1]!.altitudeM, 60);
  // Drone observations fuse with phone reports of the same pothole.
  const e = new HazardFusionEngine();
  e.ingest(obs({ reporterId: 'driver' }), T0);
  assert.equal(e.ingest(out[0]!, T0).created, false);
});

test('bump detector: fires on a jolt at speed, not when parked', () => {
  const d = new BumpDetector();
  const fix = { position: JHB, accuracyM: 5, speedMps: 12 };
  let t = T0;
  const quiet = () => d.push({ t: (t += 20), x: 0, y: 0, z: 1 }, fix);
  for (let i = 0; i < 50; i++) assert.equal(quiet(), null);
  assert.equal(d.push({ t: (t += 20), x: 0.2, y: 0.1, z: 2.3 }, fix), null);
  const ev = quiet();
  assert.ok(ev && ev.peakG > 1.2 && ev.severity >= 3);
  const parked = new BumpDetector();
  parked.push({ t: T0, x: 0, y: 0, z: 2.5 }, { ...fix, speedMps: 0 });
  assert.equal(parked.push({ t: T0 + 20, x: 0, y: 0, z: 1 }, { ...fix, speedMps: 0 }), null);
});

test('PositionFuser lets a VPS fix dominate GNSS and rejects jumps', () => {
  const f = new PositionFuser();
  f.push({ position: offset(JHB, 0, 8), accuracyM: 10, timestamp: T0, source: 'gnss' });
  const fused = f.push({ position: JHB, accuracyM: 0.5, timestamp: T0 + 100, source: 'vps' })!;
  assert.equal(fused.source, 'fused');
  assert.ok(haversine(fused.position, JHB) < 0.1);
  const jump = f.push({ position: offset(JHB, 0, 5000), accuracyM: 5, timestamp: T0 + 1100, source: 'gnss' })!;
  assert.ok(haversine(jump.position, JHB) < 1, 'outlier rejected');
});

test('SyncClient keeps reports through outages and drains when back online', async () => {
  let online = false;
  const server: Observation[] = [];
  const transport: SyncTransport = {
    pushObservations: async (o) => {
      if (!online) throw new Error('no network');
      server.push(...o);
      return { accepted: o.map((x) => x.id), rejected: [] };
    },
    pushVotes: async (v) => ({ accepted: v.map((x) => x.id), rejected: [] }),
    pullHazards: async () => ({ hazards: [], serverTime: T0 }),
  };
  const store = new MemoryStore();
  const c = new SyncClient(transport, store);
  await c.queueObservation(obs());
  await c.queueObservation(obs());
  await c.flush();
  assert.equal(c.getStatus().pending, 2);
  assert.equal(c.getStatus().online, false);
  // App restarts: outbox survives.
  const c2 = new SyncClient(transport, store);
  await c2.init();
  assert.equal(c2.getStatus().pending, 2);
  online = true;
  await c2.flush();
  assert.equal(c2.getStatus().pending, 0);
  assert.equal(server.length, 2);
});
