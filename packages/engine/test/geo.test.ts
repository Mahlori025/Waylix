import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  SpatialIndex,
  angleDiff,
  bearing,
  destination,
  geohashBounds,
  geohashCover,
  geohashDecode,
  geohashEncode,
  haversine,
  pointAlong,
  projectOntoPolyline,
  type LngLat,
} from '../src/index.ts';
import { JHB, offset } from './helpers.ts';

test('haversine: Johannesburg → Pretoria ≈ 54 km', () => {
  const pta: LngLat = [28.1881, -25.7461];
  const d = haversine(JHB, pta);
  assert.ok(d > 50_000 && d < 58_000, `got ${d}`);
});

test('destination and bearing are inverse', () => {
  for (const brg of [0, 45, 133, 270, 359]) {
    const p = destination(JHB, brg, 1234);
    assert.ok(Math.abs(haversine(JHB, p) - 1234) < 0.01);
    assert.ok(Math.abs(angleDiff(brg, bearing(JHB, p))) < 0.01);
  }
});

test('angleDiff wraps correctly', () => {
  assert.equal(angleDiff(350, 10), 20);
  assert.equal(angleDiff(10, 350), -20);
  assert.equal(angleDiff(0, 180), 180);
});

test('projectOntoPolyline gives along-track and cross-track distances', () => {
  const a = JHB;
  const b = offset(a, 90, 1000);
  const c = offset(b, 0, 1000);
  const line = [a, b, c];
  const p = offset(offset(a, 90, 400), 0, 30); // 400 m along, 30 m left
  const r = projectOntoPolyline(p, line);
  assert.ok(Math.abs(r.alongM - 400) < 1, `along ${r.alongM}`);
  assert.ok(Math.abs(r.offsetM - 30) < 1, `offset ${r.offsetM}`);
  assert.equal(r.segmentIndex, 0);
  const q = offset(b, 0, 250);
  const r2 = projectOntoPolyline(q, line);
  assert.ok(Math.abs(r2.alongM - 1250) < 1);
  const mid = pointAlong(line, 1500);
  assert.ok(haversine(mid, offset(b, 0, 500)) < 1);
});

test('geohash round-trip and known value', () => {
  assert.equal(geohashEncode([-5.6, 42.6], 5), 'ezs42');
  const h = geohashEncode(JHB, 9);
  const back = geohashDecode(h);
  assert.ok(haversine(back, JHB) < 5);
  const [minX, minY, maxX, maxY] = geohashBounds(h);
  assert.ok(JHB[0] >= minX && JHB[0] <= maxX && JHB[1] >= minY && JHB[1] <= maxY);
});

test('geohashCover covers every point in the box', () => {
  const box: [number, number, number, number] = [28.0, -26.25, 28.1, -26.15];
  const cells = new Set(geohashCover(box, 5));
  for (let i = 0; i < 200; i++) {
    const p: LngLat = [28 + Math.random() * 0.1, -26.25 + Math.random() * 0.1];
    assert.ok(cells.has(geohashEncode(p, 5)));
  }
  assert.throws(() => geohashCover([-180, -90, 180, 90], 7), RangeError);
});

test('SpatialIndex radius and bbox queries', () => {
  const idx = new SpatialIndex<{ id: string; position: LngLat }>(6);
  for (let i = 0; i < 100; i++) idx.upsert({ id: `p${i}`, position: offset(JHB, (i * 37) % 360, i * 20) });
  const near = idx.queryRadius(JHB, 200);
  assert.ok(near.length >= 10 && near.length <= 11, `got ${near.length}`);
  assert.ok(near.every((r, i) => i === 0 || r.distanceM >= near[i - 1]!.distanceM));
  // moving an item updates its cell
  idx.upsert({ id: 'p0', position: offset(JHB, 0, 50_000) });
  assert.equal(idx.queryRadius(JHB, 5).length, 0);
  idx.remove('p1');
  assert.equal(idx.size, 99);
});
