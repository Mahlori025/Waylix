import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import type { Observation } from '@waylix/engine';
import { createApp } from '../src/app.ts';
import { DeviceRegistry, type AttestationVerifier } from '../src/devices.ts';
import { HazardService } from '../src/service.ts';
import { Store } from '../src/store.ts';

const JHB: [number, number] = [28.0473, -26.2041];
const o = (id: string, reporterId = 'claimed-by-client'): Observation => ({
  id, type: 'pothole', position: JHB, accuracyM: 5, observedAt: Date.now(), reporterId, platform: 'vehicle', source: 'manual',
});

async function boot(opts: { perIpPerDay?: number; attestation?: AttestationVerifier; requireAttestation?: boolean } = {}) {
  const store = new Store(':memory:');
  const devices = new DeviceRegistry(store, { secret: 'test-secret', ...opts });
  const service = new HazardService(store, Date.now, devices);
  const server = createApp(service, { devices, requireDevice: true });
  await new Promise<void>((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post = async (path: string, body: unknown, token?: string) => {
    const r = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { 'X-Waylix-Device': token } : {}) }, body: JSON.stringify(body) });
    return { status: r.status, body: (await r.json()) as any };
  };
  return { store, devices, service, server, post, close: () => { server.close(); store.close(); } };
}

test('writes need a server-issued device token; client-claimed IDs are ignored (B4)', async () => {
  const t = await boot();
  assert.equal((await t.post('/v1/observations', { observations: [o('a')] })).status, 401);
  const reg = await t.post('/v1/devices', { platform: 'android' });
  assert.equal(reg.status, 201);
  assert.match(reg.body.deviceId, /^dev_/);
  assert.equal(reg.body.attested, false);
  const ok = await t.post('/v1/observations', { observations: [o('b')] }, reg.body.token);
  assert.equal(ok.status, 200);
  const evidence = t.service.engine.evidenceOf(ok.body.hazards[0].id);
  assert.equal(evidence[0]!.reporterId, reg.body.deviceId, 'attributed to the device, not the claimed id');
  // Forged and tampered tokens are rejected.
  assert.equal((await t.post('/v1/observations', { observations: [o('c')] }, 'dev_fake.AAAA')).status, 401);
  assert.equal((await t.post('/v1/observations', { observations: [o('d')] }, reg.body.token.slice(0, -2) + 'xx')).status, 401);
  // Revoked devices lose write access.
  t.devices.revoke(reg.body.deviceId);
  assert.equal((await t.post('/v1/observations', { observations: [o('e')] }, reg.body.token)).status, 401);
  t.close();
});

test('one network cannot mint unlimited identities', async () => {
  const t = await boot({ perIpPerDay: 3 });
  const codes = [];
  for (let i = 0; i < 5; i++) codes.push((await t.post('/v1/devices', { platform: 'ios' })).status);
  assert.deepEqual(codes, [201, 201, 201, 429, 429]);
  t.close();
});

test('three unattested devices can no longer verify a hazard on their own', async () => {
  const t = await boot({ perIpPerDay: 10 });
  let last;
  for (let i = 0; i < 3; i++) {
    const { body } = await t.post('/v1/devices', { platform: 'android' });
    last = await t.post('/v1/observations', { observations: [o(`s${i}`)] }, body.token);
  }
  assert.equal(last!.body.hazards[0].status, 'active', 'needs a 4th device or an attested one');
  t.close();
});

test('attestation hook: attested devices start at full trust; can be made mandatory', async () => {
  const verifier: AttestationVerifier = { verify: async (_p, a) => a === 'valid-integrity-token' };
  const t = await boot({ attestation: verifier, requireAttestation: true });
  assert.equal((await t.post('/v1/devices', { platform: 'android' })).status, 403);
  const reg = await t.post('/v1/devices', { platform: 'android', attestation: 'valid-integrity-token' });
  assert.equal(reg.body.attested, true);
  assert.equal(t.service.engine.reputation.trust(reg.body.deviceId), 1);
  t.close();
});

test('tokens survive a restart (secret persisted in the database)', () => {
  const store = new Store(':memory:');
  const a = new DeviceRegistry(store);
  return a.register('1.2.3.4', 'android').then((d) => {
    const b = new DeviceRegistry(store);
    assert.equal(b.verify(d.token)?.deviceId, d.deviceId);
    store.close();
  });
});
