import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HazardFusionEngine, ReputationLedger, Taxonomy, validateObservation, type HazardStatus } from '../src/index.ts';
import { DAY, HOUR, JHB, T0, obs, offset } from './helpers.ts';

test('single manual report is a candidate; second reporter activates; third verifies', () => {
  const e = new HazardFusionEngine();
  const r1 = e.ingest(obs({ reporterId: 'a' }), T0);
  assert.equal(r1.created, true);
  assert.equal(r1.hazard.status, 'candidate');
  const r2 = e.ingest(obs({ reporterId: 'b', position: offset(JHB, 45, 6) }), T0);
  assert.equal(r2.created, false);
  assert.equal(r2.hazard.id, r1.hazard.id);
  assert.equal(r2.hazard.status, 'active');
  const r3 = e.ingest(obs({ reporterId: 'c', position: offset(JHB, 200, 4) }), T0);
  assert.equal(r3.hazard.status, 'verified');
  assert.equal(r3.hazard.reporterCount, 3);
  assert.ok(r3.hazard.confidence > 0.85);
  assert.equal(e.size, 1);
});

test('reports of different types or far apart stay separate', () => {
  const e = new HazardFusionEngine();
  e.ingest(obs({ reporterId: 'a' }), T0);
  e.ingest(obs({ reporterId: 'b', type: 'sinkhole' }), T0);
  e.ingest(obs({ reporterId: 'c', position: offset(JHB, 90, 80) }), T0);
  assert.equal(e.size, 3);
});

test('spam resistance: one reporter repeating a report counts once', () => {
  const e = new HazardFusionEngine();
  let last;
  for (let i = 0; i < 50; i++) last = e.ingest(obs({ reporterId: 'spammer' }), T0);
  assert.equal(e.size, 1);
  assert.equal(last!.hazard.status, 'candidate');
  assert.equal(last!.hazard.reporterCount, 1);
});

test('ingest is idempotent on observation id', () => {
  const e = new HazardFusionEngine();
  const o = obs({ reporterId: 'a' });
  e.ingest(o, T0);
  const again = e.ingest(o, T0);
  assert.equal(again.duplicate, true);
  assert.equal(again.hazard.observationCount, 1);
});

test('time decay: an accident clears in hours, a pothole persists for weeks', () => {
  const e = new HazardFusionEngine();
  const acc = e.ingest(obs({ type: 'accident', reporterId: 'a' }), T0).hazard;
  e.ingest(obs({ type: 'accident', reporterId: 'b' }), T0);
  const pot = e.ingest(obs({ reporterId: 'a', position: offset(JHB, 0, 500) }), T0).hazard;
  e.ingest(obs({ reporterId: 'b', position: offset(JHB, 0, 500) }), T0);
  e.sweep(T0 + 12 * HOUR);
  assert.equal(e.get(acc.id)!.status, 'expired');
  assert.equal(e.get(pot.id)!.status, 'active');
  e.sweep(T0 + 200 * DAY);
  assert.equal(e.get(pot.id)!.status, 'expired');
});

test('dismissals resolve a hazard; the reporter retracting resolves immediately', () => {
  const e = new HazardFusionEngine();
  const h = e.ingest(obs({ reporterId: 'a' }), T0).hazard;
  e.vote({ id: 'v1', hazardId: h.id, reporterId: 'x', kind: 'dismiss', at: T0 + 1000 }, T0 + 1000);
  assert.equal(e.get(h.id)!.status, 'candidate');
  e.vote({ id: 'v2', hazardId: h.id, reporterId: 'y', kind: 'dismiss', at: T0 + 2000 }, T0 + 2000);
  assert.equal(e.get(h.id)!.status, 'resolved');

  const h2 = e.ingest(obs({ reporterId: 'r', position: offset(JHB, 90, 300) }), T0).hazard;
  e.vote({ id: 'v3', hazardId: h2.id, reporterId: 'r', kind: 'dismiss', at: T0 + 1 }, T0 + 1);
  assert.equal(e.get(h2.id)!.status, 'resolved');
});

test('a resolved hazard is not resurrected; new reports open a new one', () => {
  const e = new HazardFusionEngine();
  const h = e.ingest(obs({ reporterId: 'a' }), T0).hazard;
  e.vote({ id: 'v', hazardId: h.id, reporterId: 'a', kind: 'dismiss', at: T0 + 1 }, T0 + 1);
  const n = e.ingest(obs({ reporterId: 'b', observedAt: T0 + 5 * DAY }), T0 + 5 * DAY);
  assert.equal(n.created, true);
  assert.notEqual(n.hazard.id, h.id);
});

test('reputation: verified hazards raise reporter trust, refuted ones lower it', () => {
  const rep = new ReputationLedger();
  const e = new HazardFusionEngine({ reputation: rep });
  assert.equal(rep.trust('good'), 1);
  e.ingest(obs({ reporterId: 'good' }), T0);
  e.ingest(obs({ reporterId: 'b' }), T0);
  e.ingest(obs({ reporterId: 'c' }), T0);
  assert.ok(rep.trust('good') > 1);
  const bad = e.ingest(obs({ reporterId: 'liar', position: offset(JHB, 0, 900) }), T0).hazard;
  e.vote({ id: 'd1', hazardId: bad.id, reporterId: 'p', kind: 'dismiss', at: T0 }, T0);
  e.vote({ id: 'd2', hazardId: bad.id, reporterId: 'q', kind: 'dismiss', at: T0 }, T0);
  assert.equal(e.get(bad.id)!.status, 'resolved');
  assert.ok(rep.trust('liar') < 1);
});

test('a highly trusted reporter alone can activate a hazard', () => {
  const rep = new ReputationLedger([['pro', { alpha: 20, beta: 1 }]]);
  const e = new HazardFusionEngine({ reputation: rep });
  assert.equal(e.ingest(obs({ reporterId: 'pro' }), T0).hazard.status, 'active');
});

test('weak accelerometer signals accumulate across vehicles', () => {
  const e = new HazardFusionEngine();
  const statuses: HazardStatus[] = [];
  for (let i = 0; i < 10; i++) {
    const r = e.ingest(obs({ reporterId: `car${i}`, source: 'accelerometer', detectorConfidence: 0.8, accuracyM: 8, position: offset(JHB, i * 36, 4) }), T0);
    statuses.push(r.hazard.status);
  }
  assert.equal(statuses[0], 'candidate');
  assert.equal(e.size, 1);
  assert.equal(statuses.at(-1), 'verified');
});

test('fused position converges on the true location', () => {
  const e = new HazardFusionEngine();
  let h;
  for (let i = 0; i < 12; i++) h = e.ingest(obs({ reporterId: `u${i}`, position: offset(JHB, i * 30, 8), accuracyM: 10 }), T0).hazard;
  assert.ok(Math.abs(h!.position[0] - JHB[0]) < 2e-5 && Math.abs(h!.position[1] - JHB[1]) < 2e-5);
});

test('zones use their large merge radius', () => {
  const e = new HazardFusionEngine();
  e.ingest(obs({ type: 'high_accident_zone', reporterId: 'a' }), T0);
  const r = e.ingest(obs({ type: 'high_accident_zone', reporterId: 'b', position: offset(JHB, 10, 300) }), T0);
  assert.equal(r.created, false);
  assert.equal(r.hazard.radiusM, 400);
});

test('pedestrian reports of shared types land in the walkway domain; drones in air', () => {
  const e = new HazardFusionEngine();
  assert.equal(e.ingest(obs({ type: 'flooding', platform: 'pedestrian', reporterId: 'w' }), T0).hazard.domain, 'walkway');
  assert.equal(e.ingest(obs({ type: 'flooding', platform: 'vehicle', reporterId: 'v' }), T0).hazard.domain, 'road');
  assert.equal(e.ingest(obs({ type: 'aerial_obstacle', platform: 'drone', reporterId: 'd', altitudeM: 40 }), T0).hazard.domain, 'air');
});

test('air hazards at different altitudes do not merge', () => {
  const e = new HazardFusionEngine();
  e.ingest(obs({ type: 'aerial_obstacle', platform: 'drone', reporterId: 'd1', altitudeM: 20 }), T0);
  e.ingest(obs({ type: 'aerial_obstacle', platform: 'drone', reporterId: 'd2', altitudeM: 25 }), T0);
  e.ingest(obs({ type: 'aerial_obstacle', platform: 'drone', reporterId: 'd3', altitudeM: 150 }), T0);
  assert.equal(e.size, 2);
});

test('query filters by bbox, domain, type and confidence', () => {
  const e = new HazardFusionEngine();
  e.ingest(obs({ reporterId: 'a' }), T0);
  e.ingest(obs({ reporterId: 'b' }), T0);
  e.ingest(obs({ reporterId: 'c', type: 'flooding', position: offset(JHB, 0, 2000) }), T0);
  e.ingest(obs({ reporterId: 'd', position: offset(JHB, 0, 50_000) }), T0);
  const box: [number, number, number, number] = [JHB[0] - 0.05, JHB[1] - 0.05, JHB[0] + 0.05, JHB[1] + 0.05];
  assert.equal(e.query({ bbox: box }).length, 2);
  assert.equal(e.query({ bbox: box, types: ['flooding'] }).length, 1);
  assert.equal(e.query({ bbox: box, minConfidence: 0.5 }).length, 1);
  assert.equal(e.query({ near: { center: JHB, radiusM: 100 } }).length, 1);
});

test('snapshot round-trip preserves state and idempotency', () => {
  const e = new HazardFusionEngine();
  const o = obs({ reporterId: 'a' });
  e.ingest(o, T0);
  e.ingest(obs({ reporterId: 'b' }), T0);
  const copy = HazardFusionEngine.fromSnapshot(JSON.parse(JSON.stringify(e.toSnapshot())));
  assert.equal(copy.size, 1);
  assert.equal(copy.ingest(o, T0).duplicate, true);
  const r = copy.ingest(obs({ reporterId: 'c' }), T0);
  assert.equal(r.created, false);
  assert.equal(r.hazard.status, 'verified');
});

test('validateObservation rejects bad input', () => {
  const tax = new Taxonomy();
  assert.deepEqual(validateObservation(obs(), tax, T0), []);
  assert.ok(validateObservation({ ...obs(), type: 'ufo' }, tax, T0).length);
  assert.ok(validateObservation({ ...obs(), position: [200, 0] }, tax, T0).length);
  assert.ok(validateObservation({ ...obs(), observedAt: T0 + DAY }, tax, T0).length);
  assert.ok(validateObservation({ ...obs(), severity: 9 }, tax, T0).length);
  assert.ok(validateObservation(null, tax, T0).length);
});
