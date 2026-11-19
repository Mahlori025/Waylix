/**
 * Seeds a running Waylix API with demo reports around Johannesburg so the
 * app has something to show. Usage: npm run seed -- http://localhost:8787
 */
import { HttpSyncTransport, destination, uuid, type LngLat, type Observation } from '@waylix/engine';

const base = process.argv[2] ?? 'http://localhost:8787';
const t = new HttpSyncTransport(base);
const now = Date.now();

const spots: Array<{ type: string; at: LngLat; reporters: number; severity?: 1 | 2 | 3 | 4 | 5 }> = [
  { type: 'pothole', at: [28.0436, -26.1952], reporters: 3, severity: 4 }, // Braamfontein
  { type: 'pothole', at: [28.0567, -26.1467], reporters: 2 }, // Rosebank
  { type: 'sinkhole', at: [28.0402, -26.2079], reporters: 2, severity: 5 }, // CBD
  { type: 'traffic_light_outage', at: [28.0473, -26.1886], reporters: 2 },
  { type: 'missing_manhole_cover', at: [28.0339, -26.2001], reporters: 1, severity: 5 },
  { type: 'high_accident_zone', at: [28.0712, -26.1076], reporters: 4 }, // N1 / Grayston area
  { type: 'bad_driving_zone', at: [28.0052, -26.1796], reporters: 3 },
  { type: 'flooding', at: [28.0601, -26.1689], reporters: 2 },
  { type: 'broken_sidewalk', at: [28.0446, -26.1924], reporters: 2 },
];

const observations: Observation[] = [];
for (const s of spots) {
  for (let i = 0; i < s.reporters; i++) {
    observations.push({
      id: uuid(),
      type: s.type,
      position: destination(s.at, i * 97, 3 + i * 2),
      accuracyM: 6,
      observedAt: now - i * 60_000,
      reporterId: `seed-${s.type}-${i}`,
      platform: s.type === 'broken_sidewalk' ? 'pedestrian' : 'vehicle',
      source: 'manual',
      ...(s.severity ? { severity: s.severity } : {}),
    });
  }
}

const r = await t.pushObservations(observations);
console.log(`seeded ${r.accepted.length} observations (${r.rejected.length} rejected) into ${base}`);
