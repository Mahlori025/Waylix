/** Throughput benchmark: npx tsx bench/bench.ts */
import { HazardFusionEngine, analyzeRoute, destination, type LngLat, type Observation } from '../src/index.ts';

const JHB: LngLat = [28.0473, -26.2041];
const N = 100_000;
const types = ['pothole', 'pothole', 'pothole', 'surface_damage', 'flooding', 'traffic_light_outage', 'sinkhole'];
// 5,000 true hazard sites across a ~30 km radius; each observation reports one site with 6 m GPS noise.
const sites = Array.from({ length: 5000 }, (_, i) => ({ p: destination(JHB, (i * 137.5) % 360, Math.sqrt(i / 5000) * 30_000), t: types[i % types.length]! }));
const t0 = Date.UTC(2026, 10, 1);
const obs: Observation[] = Array.from({ length: N }, (_, i) => {
  const s = sites[Math.floor(Math.random() * sites.length)]!;
  return { id: `o${i}`, type: s.t, position: destination(s.p, Math.random() * 360, Math.abs(gauss()) * 6), accuracyM: 6, observedAt: t0 + i * 1000, reporterId: `u${Math.floor(Math.random() * 20_000)}`, platform: 'vehicle', source: Math.random() < 0.3 ? 'accelerometer' : 'manual' };
});
function gauss() { return Math.sqrt(-2 * Math.log(Math.random() || 1e-9)) * Math.cos(2 * Math.PI * Math.random()); }

const e = new HazardFusionEngine();
let start = performance.now();
for (const o of obs) e.ingest(o, o.observedAt);
const ingestMs = performance.now() - start;
const now = t0 + N * 1000;
start = performance.now();
const Q = 2000;
for (let i = 0; i < Q; i++) e.query({ near: { center: sites[i % sites.length]!.p, radiusM: 2000 } });
const qMs = (performance.now() - start) / Q;
const route = Array.from({ length: 400 }, (_, i) => destination(JHB, 60, i * 50)); // 20 km
const all = e.query({}, now);
start = performance.now();
const R = 200;
let hits = 0;
for (let i = 0; i < R; i++) hits = analyzeRoute(route, all).hits.length;
const rMs = (performance.now() - start) / R;
const mergedRatio = e.size / sites.length;
console.log(JSON.stringify({ observations: N, sites: sites.length, hazards: e.size, hazardsPerSite: +mergedRatio.toFixed(3), ingestPerSec: Math.round(N / (ingestMs / 1000)), radiusQueryMs: +qMs.toFixed(3), routeRisk20kmMs: +rMs.toFixed(2), routeHits: hits, node: process.version }, null, 2));
