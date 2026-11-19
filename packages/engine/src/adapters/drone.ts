import { destination, toDeg, toRad } from '../geo.ts';
import { uuid } from '../ids.ts';
import type { LngLat, Observation } from '../types.ts';

/** Drone pose at the moment a frame was captured. */
export interface DronePose {
  position: LngLat;
  /** Height above ground level, metres. */
  altitudeAglM: number;
  /** Airframe/camera yaw, degrees clockwise from north. */
  headingDeg: number;
  /** Gimbal pitch below the horizon in degrees (90 = looking straight down). */
  gimbalPitchDeg: number;
  /** GNSS accuracy of the drone itself, metres. */
  accuracyM?: number;
}

export interface CameraModel {
  widthPx: number;
  heightPx: number;
  horizontalFovDeg: number;
  verticalFovDeg: number;
}

export interface GroundProjection {
  position: LngLat;
  /** Horizontal distance from the drone's ground point to the target. */
  groundRangeM: number;
  /** Estimated 1-sigma position error, metres. */
  accuracyM: number;
}

/**
 * Project an image detection (pixel u, v) onto flat ground using a pinhole
 * camera model. Good to a few metres at typical survey altitudes (30–120 m);
 * a DEM can replace the flat-ground assumption later without changing callers.
 * Returns null if the ray points at or above the horizon.
 */
export function projectPixelToGround(pose: DronePose, cam: CameraModel, u: number, v: number): GroundProjection | null {
  const fx = cam.widthPx / 2 / Math.tan(toRad(cam.horizontalFovDeg) / 2);
  const fy = cam.heightPx / 2 / Math.tan(toRad(cam.verticalFovDeg) / 2);
  const x = (u - cam.widthPx / 2) / fx; // right
  const y = (v - cam.heightPx / 2) / fy; // down
  const pitch = toRad(pose.gimbalPitchDeg);
  // Camera ray in a local frame: forward (f), right (r), down (d).
  // Rotate the camera ray [x, y, 1] about the right axis by the gimbal pitch.
  const f = Math.cos(pitch) * 1 - Math.sin(pitch) * y;
  const d = Math.sin(pitch) * 1 + Math.cos(pitch) * y;
  const r = x;
  if (d <= 1e-6) return null;
  const t = pose.altitudeAglM / d;
  const forwardM = f * t;
  const rightM = r * t;
  const groundRangeM = Math.hypot(forwardM, rightM);
  const brg = pose.headingDeg + toDeg(Math.atan2(rightM, forwardM));
  const position = destination(pose.position, brg, groundRangeM);
  // Error budget: drone GNSS + ~1° attitude error stretched over the slant range.
  const slant = Math.hypot(groundRangeM, pose.altitudeAglM);
  const angular = slant * toRad(1) * (1 + groundRangeM / Math.max(1, pose.altitudeAglM));
  const accuracyM = Math.hypot(pose.accuracyM ?? 2, angular);
  return { position, groundRangeM, accuracyM };
}

export interface DroneDetection {
  /** Hazard type id from the taxonomy, e.g. 'pothole' or 'aerial_obstacle'. */
  type: string;
  /** Detection box centre in pixels. */
  u: number;
  v: number;
  confidence: number;
  timestamp: number;
  severity?: 1 | 2 | 3 | 4 | 5;
}

/**
 * Turns a drone vision pipeline's detections into standard observations.
 * Ground hazards (potholes, flooding...) are projected to the surface;
 * air-domain hazards (obstacles) are placed at the drone's position/altitude.
 * Everything downstream — fusion, routing risk, alerts — is reused as is.
 */
export class DroneObservationAdapter {
  constructor(
    private readonly droneId: string,
    private readonly camera: CameraModel,
    private readonly airTypes: ReadonlySet<string> = new Set(['aerial_obstacle', 'bird_activity', 'restricted_airspace']),
    private readonly minConfidence = 0.4,
  ) {}

  toObservations(pose: DronePose, detections: readonly DroneDetection[]): Observation[] {
    const out: Observation[] = [];
    for (const det of detections) {
      if (det.confidence < this.minConfidence) continue;
      const base = {
        id: uuid(),
        type: det.type,
        observedAt: det.timestamp,
        reporterId: this.droneId,
        platform: 'drone' as const,
        source: 'drone_camera' as const,
        detectorConfidence: det.confidence,
        headingDeg: pose.headingDeg,
        ...(det.severity ? { severity: det.severity } : {}),
      };
      if (this.airTypes.has(det.type)) {
        out.push({ ...base, position: pose.position, accuracyM: Math.max(5, pose.accuracyM ?? 3), altitudeM: pose.altitudeAglM });
        continue;
      }
      const g = projectPixelToGround(pose, this.camera, det.u, det.v);
      if (!g) continue;
      out.push({ ...base, position: g.position, accuracyM: Math.max(1, g.accuracyM) });
    }
    return out;
  }
}
