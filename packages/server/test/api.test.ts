import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, before, test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { destination, type Hazard, type LngLat, type Observation } from '@waylix/engine';
import { createApp } from '../src/app.ts';
import { HazardService } from '../src/service.ts';
import { Store } from '../src/store.ts';

const JHB: LngLat = [28.0473, -26.2041];
const dir = mkdtempSync(join(tmpdir(), 'waylix-'));
const dbPath = join(dir, 'test.db');
let store: Store;
let base = '';
let server: ReturnType<typeof createApp>;

const o = (id: string, reporterId: string, extra: Partial<Observation> = {}): Observation => ({
  id, type: 'pothole', position: JHB, accuracyM: 5, observedAt: Date.now(), reporterId, platform: 'vehicle', source: 'manual', ...extra,
});
const post = async (path: string, body: unknown, headers: Record<string, string> = {}) => {
  const r = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  return { status: r.status, body: (await r.json()) as any };
};
const get = async (path: string) => {
  const r = await fetch(base + path);
  return { status: r.status, body: (await r.json()) as any };
};
const BOX = `bbox=${JHB[0] - 0.01},${JHB[1] - 0.01},${JHB[0] + 0.01},${JHB[1] + 0.01}`;

before(async () => {
  store = new Store(dbPath);
  server = createApp(new HazardService(store));
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => {
  server.close();
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

test('health and taxonomy', async () => {
  const h = await get('/health');
  assert.equal(h.status, 200);
  assert.equal(h.body.ok, true);
  const t = await get('/v1/taxonomy');
  assert.ok(t.body.types.some((x: { id: string }) => x.id === 'sinkhole'));
});

test('observations fuse, validate and are idempotent', async () => {
  const r1 = await post('/v1/observations', { observations: [o('a1', 'alice'), o('b1', 'bob', { position: destination(JHB, 90, 5) }), { id: 'bad', type: 'ufo' }] });
  assert.equal(r1.status, 200);
  assert.deepEqual(r1.body.accepted, ['a1', 'b1']);
  assert.equal(r1.body.rejected[0].id, 'bad');
  assert.equal(r1.body.hazards.length, 1);
  assert.equal(r1.body.hazards[0].status, 'active');
  const again = await post('/v1/observations', { observations: [o('a1', 'alice')] });
  assert.deepEqual(again.body.accepted, ['a1']);
  assert.equal(again.body.hazards[0].observationCount, 2);
});

test('hazards query by bbox and incremental since', async () => {
  const r = await get(`/v1/hazards?${BOX}`);
  assert.equal(r.body.hazards.length, 1);
  const since = r.body.serverTime;
  const none = await get(`/v1/hazards?${BOX}&since=${since}`);
  assert.equal(none.body.hazards.length, 0);
  await post('/v1/observations', { observations: [o('c1', 'carol')] });
  const delta = await get(`/v1/hazards?${BOX}&since=${since}`);
  assert.equal(delta.body.hazards.length, 1);
  assert.equal(delta.body.hazards[0].status, 'verified');
  const geo = await get(`/v1/hazards.geojson?${BOX}`);
  assert.equal(geo.body.type, 'FeatureCollection');
  assert.equal((await get('/v1/hazards')).status, 400, 'bbox required');
});

test('votes resolve hazards and closures propagate via since', async () => {
  const created = await post('/v1/observations', { observations: [o('far', 'dave', { type: 'debris', position: destination(JHB, 0, 600) })] });
  const id = created.body.hazards[0].id as string;
  const { serverTime } = (await get(`/v1/hazards?${BOX}`)).body;
  const v = await post('/v1/votes', { votes: [{ id: 'v1', hazardId: id, reporterId: 'dave', kind: 'dismiss', at: Date.now() }, { id: 'v2', hazardId: 'nope', reporterId: 'x', kind: 'dismiss', at: Date.now() }] });
  assert.deepEqual(v.body.accepted, ['v1']);
  assert.equal(v.body.hazards[0].status, 'resolved');
  const delta = await get(`/v1/hazards?${BOX}&since=${serverTime}`);
  assert.ok(delta.body.hazards.some((h: Hazard) => h.id === id && h.status === 'resolved'));
  const open = await get(`/v1/hazards?${BOX}`);
  assert.ok(!open.body.hazards.some((h: Hazard) => h.id === id));
});

test('route risk', async () => {
  const r = await post('/v1/route-risk', { coordinates: [destination(JHB, 270, 500), destination(JHB, 90, 500)] });
  assert.equal(r.status, 200);
  assert.equal(r.body.hits.length, 1);
  assert.ok(r.body.score > 0);
  assert.equal((await post('/v1/route-risk', { coordinates: [[0, 0]] })).status, 400);
});

test('state and hazard ids survive a restart (event-log replay)', async () => {
  const before = (await get(`/v1/hazards?${BOX}`)).body.hazards as Hazard[];
  const s2 = new Store(dbPath);
  const svc = new HazardService(s2);
  const after = svc.hazards({ bbox: [JHB[0] - 0.01, JHB[1] - 0.01, JHB[0] + 0.01, JHB[1] + 0.01] }).hazards;
  assert.deepEqual(after.map((h) => [h.id, h.status, h.reporterCount]).sort(), before.map((h) => [h.id, h.status, h.reporterCount]).sort());
  s2.close();
});

test('bad requests are rejected cleanly', async () => {
  const r = await fetch(base + '/v1/observations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{nope' });
  assert.equal(r.status, 400);
  const big = await post('/v1/observations', { observations: [] });
  assert.equal(big.status, 400);
  assert.equal((await get('/v1/nothing')).status, 404);
});

test('API keys protect writes when configured', async () => {
  const s = new Store(':memory:');
  const srv = createApp(new HazardService(s), { apiKeys: ['secret'] });
  await new Promise<void>((r) => srv.listen(0, r));
  const url = `http://127.0.0.1:${(srv.address() as AddressInfo).port}/v1/observations`;
  const body = JSON.stringify({ observations: [o('k1', 'kim')] });
  assert.equal((await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })).status, 401);
  assert.equal((await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer secret' }, body })).status, 200);
  srv.close();
  s.close();
});
