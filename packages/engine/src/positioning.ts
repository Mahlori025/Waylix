import { haversine } from './geo.ts';
import type { LngLat } from './types.ts';

/**
 * Positioning abstraction. Today the app feeds GNSS fixes; the Visual
 * Positioning System (VPS) planned for the next phase plugs in as another
 * `PositionSource` that emits fixes with `source: 'vps'` and (typically)
 * sub-metre accuracy and a reliable heading. Nothing downstream — fusion,
 * alerts, navigation — needs to change.
 */
export type PositionSourceKind = 'gnss' | 'vps' | 'network' | 'dead_reckoning' | 'fused';

export interface PositionFix {
  position: LngLat;
  /** Horizontal 1-sigma accuracy, metres. */
  accuracyM: number;
  altitudeM?: number;
  headingDeg?: number;
  speedMps?: number;
  timestamp: number;
  source: PositionSourceKind;
}

export interface PositionSource {
  readonly kind: PositionSourceKind;
  start(onFix: (fix: PositionFix) => void): void | Promise<void>;
  stop(): void | Promise<void>;
}

export interface FuserOptions {
  /** Fixes older than this are ignored when blending. */
  windowMs?: number;
  /** Fixes that jump further than this from the fused track (beyond accuracy) are rejected. */
  maxJumpMps?: number;
}

/**
 * Inverse-variance blend of the freshest fix from each source. A 0.5 m VPS
 * fix gets ~400× the weight of a 10 m GNSS fix, so VPS dominates whenever it
 * is available and GNSS smoothly takes over when the camera loses tracking.
 */
export class PositionFuser {
  private readonly latest = new Map<PositionSourceKind, PositionFix>();
  private last: PositionFix | undefined;
  private readonly windowMs: number;
  private readonly maxJumpMps: number;

  constructor(opts: FuserOptions = {}) {
    this.windowMs = opts.windowMs ?? 3000;
    this.maxJumpMps = opts.maxJumpMps ?? 90;
  }

  push(fix: PositionFix): PositionFix | undefined {
    if (this.last) {
      const dt = Math.max(0.2, (fix.timestamp - this.last.timestamp) / 1000);
      const jump = haversine(this.last.position, fix.position) - fix.accuracyM - this.last.accuracyM;
      if (jump / dt > this.maxJumpMps) return this.last; // outlier (multipath, VPS mis-localisation)
    }
    this.latest.set(fix.source, fix);
    let sw = 0, sx = 0, sy = 0;
    let best: PositionFix = fix;
    for (const f of this.latest.values()) {
      if (fix.timestamp - f.timestamp > this.windowMs) continue;
      const w = 1 / Math.max(0.05, f.accuracyM) ** 2;
      sw += w; sx += w * f.position[0]; sy += w * f.position[1];
      if (f.accuracyM < best.accuracyM) best = f;
    }
    const fused: PositionFix = {
      position: [sx / sw, sy / sw],
      accuracyM: Math.sqrt(1 / sw),
      timestamp: fix.timestamp,
      source: this.latest.size > 1 ? 'fused' : fix.source,
      ...(best.altitudeM !== undefined ? { altitudeM: best.altitudeM } : {}),
      ...(best.headingDeg !== undefined ? { headingDeg: best.headingDeg } : fix.headingDeg !== undefined ? { headingDeg: fix.headingDeg } : {}),
      ...(fix.speedMps !== undefined ? { speedMps: fix.speedMps } : {}),
    };
    this.last = fused;
    return fused;
  }

  current(): PositionFix | undefined {
    return this.last;
  }
}
