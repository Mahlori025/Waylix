/**
 * AR registration study (white paper §5): how accurately can the Hazard
 * Fusion Engine place a hazard, and what angular misregistration does an AR
 * overlay suffer under GNSS-only vs VPS device positioning?
 * Run: npx tsx bench/ar-study.ts
 */
import { HazardFusionEngine, destination, haversine, type LngLat } from '../src/index.ts';

const TRUTH: LngLat = [28.0473, -26.2041];
const SIGMA_REPORT = 6; // per-report horizontal RMS error, metres (phone GNSS + tap)
const TRIALS = 2000;
const randn = () => Math.sqrt(-2 * Math.log(Math.random() || 1e-12)) * Math.cos(2 * Math.PI * Math.random());
const perAxis = SIGMA_REPORT / Math.SQRT2;
const noisy = (p: LngLat) => {
  const dx = randn() * perAxis, dy = randn() * perAxis;
  return destination(destination(p, 90, dx), 0, dy);
};

console.log('## A. Fused hazard position error vs number of independent reports');
console.log('n | RMS error (m) | 95th pct (m) | theory 6/sqrt(n)');
const fusedRms: Record<number, number> = {};
for (const n of [1, 2, 3, 5, 10, 20]) {
  const errs: number[] = [];
  for (let t = 0; t < TRIALS; t++) {
    const e = new HazardFusionEngine();
    let h;
    for (let i = 0; i < n; i++) h = e.ingest({ id: `t${t}-${i}`, type: 'pothole', position: noisy(TRUTH), accuracyM: SIGMA_REPORT, observedAt: 0, reporterId: `r${i}`, platform: 'vehicle', source: 'manual' }, 0).hazard;
    errs.push(haversine(h!.position, TRUTH));
  }
  errs.sort((a, b) => a - b);
  const rms = Math.sqrt(errs.reduce((s, x) => s + x * x, 0) / errs.length);
  fusedRms[n] = rms;
  console.log(`${n} | ${rms.toFixed(2)} | ${errs[Math.floor(0.95 * errs.length)]!.toFixed(2)} | ${(SIGMA_REPORT / Math.sqrt(n)).toFixed(2)}`);
}

console.log('\n## B. AR angular misregistration θ = atan(e/d), e = sqrt(σ_device² + σ_hazard²)');
console.log('Phone camera model: 63° horizontal FOV, 1080 px wide → px offset = θ/63·1080');
const devices = { 'GNSS (σ=5 m)': 5, 'VPS (σ=0.5 m)': 0.5 };
const hazardSigma = fusedRms[3]!; // a typical verified pothole (3 reporters)
console.log(`hazard σ (3 reporters, measured) = ${hazardSigma.toFixed(2)} m`);
console.log('distance | ' + Object.keys(devices).map((k) => `${k} θ° / px`).join(' | '));
for (const d of [15, 35, 60, 150, 400]) {
  const cells = Object.values(devices).map((sd) => {
    const e = Math.hypot(sd, hazardSigma);
    const th = (Math.atan(e / d) * 180) / Math.PI;
    return `${th.toFixed(1)}° / ${Math.round((th / 63) * 1080)} px`;
  });
  console.log(`${d} m | ${cells.join(' | ')}`);
}

console.log('\n## B2. Closing the loop: VPS device + VPS-anchored reports (σ_report = 1 m, 3 reporters → σ_hazard ≈ 1/√3 m)');
const vpsHazard = 1 / Math.sqrt(3);
console.log('distance | θ° / px | angular size of a 1 m pothole');
for (const d of [15, 35, 60]) {
  const th = (Math.atan(Math.hypot(0.5, vpsHazard) / d) * 180) / Math.PI;
  const size = (2 * Math.atan(0.5 / d) * 180) / Math.PI;
  console.log(`${d} m | ${th.toFixed(1)}° / ${Math.round((th / 63) * 1080)} px | ${size.toFixed(1)}°`);
}

console.log('\n## C. Look-ahead distance (alert engine: max(60, v·25 s), cap 1500 m)');
for (const [label, v] of [['walk 1.4 m/s', 1.4], ['urban drive 60 km/h', 16.7], ['highway 120 km/h', 33.3]] as const) {
  console.log(`${label}: ${Math.min(1500, Math.max(60, v * 25)).toFixed(0)} m`);
}

console.log('\n## D. Zone hazards (r = 400 m): fraction of the zone radius covered by registration error at 150 m');
console.log(`GNSS: ${((Math.hypot(5, hazardSigma) / 400) * 100).toFixed(1)}% of radius`);
