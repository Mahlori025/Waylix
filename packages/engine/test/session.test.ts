import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DirectLineProvider, HazardFusionEngine, NavigationSession, Taxonomy, osrmInstruction, type LngLat, type Route } from '../src/index.ts';
import { JHB, T0, obs, offset } from './helpers.ts';

const east = (m: number): LngLat => offset(JHB, 90, m);
const route = (mode: Route['mode'] = 'walk'): Route => ({
  coordinates: [JHB, east(1000), east(2000)],
  distanceM: 2000,
  durationS: 1500,
  mode,
  provider: 'test',
  steps: [
    { instruction: 'Head out on Jorissen St', maneuver: 'depart', name: 'Jorissen St', distanceM: 1000, durationS: 750, location: JHB },
    { instruction: 'Continue onto Juta St', maneuver: 'continue', name: 'Juta St', distanceM: 1000, durationS: 750, location: east(1000) },
    { instruction: 'Arrive at your destination', maneuver: 'arrive', name: '', distanceM: 0, durationS: 0, location: east(2000) },
  ],
});
const tax = new Taxonomy();

test('start returns a full state immediately and the opening instruction (B2)', () => {
  const s = new NavigationSession(route(), { taxonomy: tax });
  const u = s.start({ position: JHB, accuracyM: 5 }, [], T0);
  assert.equal(u.speak[0], 'Head out on Jorissen St');
  assert.ok(Math.abs(u.state.remainingM - 2000) < 2);
  assert.equal(u.state.nextStep?.name, 'Juta St');
  assert.equal(u.arrived, false);
  // Works without any fix yet (cold GPS): state from the route start.
  assert.ok(new NavigationSession(route(), { taxonomy: tax }).start(undefined, [], T0).state.remainingM > 1990);
});

test('arrival wording is only used on arrival (B3)', () => {
  assert.equal(osrmInstruction({ distance: 0, duration: 0, name: '', maneuver: { type: 'arrive', location: [0, 0] } }), 'Arrive at your destination');
  const s = new NavigationSession(route(), { taxonomy: tax });
  s.start({ position: JHB, accuracyM: 5 }, [], T0);
  const mid = s.update({ position: east(1500), accuracyM: 5 }, [], T0 + 1);
  assert.equal(mid.state.nextStep?.instruction, 'Arrive at your destination');
  assert.ok(!mid.speak.includes('You have arrived'));
  const end = s.update({ position: east(1995), accuracyM: 5 }, [], T0 + 2);
  assert.equal(end.arrived, true);
  assert.deepEqual(end.speak, ['You have arrived']);
  assert.equal(s.isEnded, true);
});

test('direct-line routes also use the upcoming-arrival wording', async () => {
  const [r] = await new DirectLineProvider().route({ from: JHB, to: east(500), mode: 'walk' });
  assert.equal(r!.steps.at(-1)!.instruction, 'Arrive at your destination');
});

test('each manoeuvre is announced once, when it gets close', () => {
  const s = new NavigationSession(route('walk'), { taxonomy: tax });
  s.start({ position: JHB, accuracyM: 5 }, [], T0);
  assert.deepEqual(s.update({ position: east(500), accuracyM: 5 }, [], T0 + 1).speak, []);
  assert.deepEqual(s.update({ position: east(980), accuracyM: 5 }, [], T0 + 2).speak, ['Continue onto Juta St']);
  assert.deepEqual(s.update({ position: east(985), accuracyM: 5 }, [], T0 + 3).speak, []);
});

test('off-route for three fixes asks for one reroute, then cools down', () => {
  const s = new NavigationSession(route('drive'), { taxonomy: tax });
  s.start({ position: JHB, accuracyM: 5 }, [], T0);
  const off = offset(east(600), 0, 200);
  const r = [1, 2, 3, 4].map((i) => s.update({ position: off, accuracyM: 5 }, [], T0 + i * 1000).reroute);
  assert.deepEqual(r, [false, false, true, false]);
  s.replaceRoute(route('drive'));
  assert.equal(s.update({ position: east(700), accuracyM: 5 }, [], T0 + 5000).state.offRoute, false);
});

test('hazard alerts are spoken during navigation', () => {
  const e = new HazardFusionEngine();
  for (const r of ['a', 'b']) e.ingest(obs({ reporterId: r, position: east(300) }), T0);
  const s = new NavigationSession(route('walk'), { taxonomy: tax });
  s.start({ position: JHB, accuracyM: 5 }, e.query({}), T0);
  const u = s.update({ position: east(260), accuracyM: 5, speedMps: 1.4 }, e.query({}), T0 + 1000);
  assert.equal(u.alerts.length, 1);
  assert.match(u.speak.at(-1)!, /Pothole ahead in 40 m/);
});
