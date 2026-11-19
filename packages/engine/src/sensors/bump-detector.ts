import type { LngLat, Severity } from '../types.ts';

export interface AccelSample {
  /** Epoch ms. */
  t: number;
  /** Acceleration in g along device axes (gravity included, as phones report it). */
  x: number;
  y: number;
  z: number;
}

export interface BumpEvent {
  t: number;
  position: LngLat;
  accuracyM: number;
  /** Peak dynamic acceleration magnitude, g. */
  peakG: number;
  severity: Severity;
  /** 0..1 heuristic confidence that this was a pothole rather than noise. */
  confidence: number;
  speedMps: number;
}

export interface BumpDetectorOptions {
  /** Dynamic acceleration (|a| − gravity) that counts as a jolt, g. */
  thresholdG?: number;
  /** Ignore jolts below this speed (parking, handling the phone). */
  minSpeedMps?: number;
  /** Only one event per this many ms. */
  refractoryMs?: number;
  /** Gravity low-pass smoothing factor 0..1 (higher = slower). */
  gravityAlpha?: number;
}

/**
 * Passive pothole detection from the phone accelerometer while driving.
 * Orientation-independent: works on the total acceleration magnitude minus a
 * slowly tracked gravity estimate, so the phone can sit in any mount.
 * Produces *weak* evidence (source 'accelerometer'); the fusion engine only
 * promotes it once several vehicles hit the same spot.
 */
export class BumpDetector {
  private gravity = 1;
  private lastEventAt = -Infinity;
  private peak = 0;
  private peakAt = 0;
  private readonly o: Required<BumpDetectorOptions>;

  constructor(opts: BumpDetectorOptions = {}) {
    this.o = {
      thresholdG: opts.thresholdG ?? 0.6,
      minSpeedMps: opts.minSpeedMps ?? 4.2, // ~15 km/h
      refractoryMs: opts.refractoryMs ?? 2000,
      gravityAlpha: opts.gravityAlpha ?? 0.98,
    };
  }

  /**
   * Feed one sample with the latest location fix. Returns an event when a
   * jolt completes (the signal falls back below threshold), else null.
   */
  push(s: AccelSample, fix: { position: LngLat; accuracyM: number; speedMps: number }): BumpEvent | null {
    const mag = Math.sqrt(s.x * s.x + s.y * s.y + s.z * s.z);
    const dyn = Math.abs(mag - this.gravity);
    // Only track gravity on quiet samples so a jolt doesn't drag the baseline.
    if (dyn < this.o.thresholdG / 2) this.gravity = this.o.gravityAlpha * this.gravity + (1 - this.o.gravityAlpha) * mag;
    if (fix.speedMps < this.o.minSpeedMps) {
      this.peak = 0;
      return null;
    }
    if (dyn >= this.o.thresholdG) {
      if (dyn > this.peak) {
        this.peak = dyn;
        this.peakAt = s.t;
      }
      return null;
    }
    if (this.peak > 0 && s.t - this.lastEventAt > this.o.refractoryMs) {
      const peakG = this.peak;
      this.peak = 0;
      this.lastEventAt = s.t;
      const severity = (peakG > 2 ? 5 : peakG > 1.4 ? 4 : peakG > 1 ? 3 : 2) as Severity;
      const confidence = Math.min(0.9, 0.35 + (peakG - this.o.thresholdG) * 0.4);
      // Position error grows with speed × sensor/GPS latency (~0.5 s).
      return { t: this.peakAt, position: fix.position, accuracyM: Math.hypot(fix.accuracyM, fix.speedMps * 0.5), peakG, severity, confidence, speedMps: fix.speedMps };
    }
    this.peak = 0;
    return null;
  }
}
