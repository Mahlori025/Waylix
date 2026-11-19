/**
 * Core data model of the Waylix Hazard Fusion Engine.
 *
 * The model is deliberately platform-agnostic: a pothole reported by a
 * driver's thumb, a bump picked up by a phone accelerometer, and a crack
 * detected from a drone camera are all just `Observation`s. The engine
 * fuses them into `Hazard`s with a calibrated confidence.
 */

/** [longitude, latitude] in WGS-84 degrees (GeoJSON order). */
export type LngLat = [lon: number, lat: number];

/** [minLon, minLat, maxLon, maxLat]. */
export type BBox = [minLon: number, minLat: number, maxLon: number, maxLat: number];

/** Who or what produced the observation. New platforms plug in here. */
export type Platform = 'pedestrian' | 'vehicle' | 'cyclist' | 'drone' | 'fixed_sensor';

/** The movement space a hazard affects. */
export type Domain = 'road' | 'walkway' | 'air';

/** How the observation was produced. Drives the evidence weight. */
export type ObservationSource =
  | 'manual' // a person tapped "report"
  | 'accelerometer' // automatic bump/pothole detection
  | 'camera_ai' // on-device vision model (dashcam / phone)
  | 'drone_camera' // aerial vision model projected to ground
  | 'lidar'
  | 'import'; // authority / municipal open-data feed

export type HazardStatus = 'candidate' | 'active' | 'verified' | 'expired' | 'resolved';

export type Severity = 1 | 2 | 3 | 4 | 5;

export interface Observation {
  /** Client-generated unique id; doubles as the idempotency key for sync. */
  id: string;
  type: string;
  position: LngLat;
  /** Horizontal 1-sigma accuracy of `position`, metres. */
  accuracyM: number;
  /** Altitude above ground level, metres (air domain only). */
  altitudeM?: number;
  /** Epoch milliseconds. */
  observedAt: number;
  reporterId: string;
  platform: Platform;
  source: ObservationSource;
  severity?: Severity;
  /** Detector confidence 0..1 for automated sources. */
  detectorConfidence?: number;
  headingDeg?: number;
  note?: string;
  mediaUrls?: string[];
}

export type VoteKind = 'confirm' | 'dismiss';

export interface Vote {
  id: string;
  hazardId: string;
  reporterId: string;
  kind: VoteKind;
  at: number;
  position?: LngLat;
}

export interface Hazard {
  id: string;
  type: string;
  domain: Domain;
  position: LngLat;
  /** Effective radius: small for point hazards, large for zones. */
  radiusM: number;
  severity: Severity;
  /** Posterior probability the hazard currently exists, 0..1. */
  confidence: number;
  status: HazardStatus;
  firstSeenAt: number;
  lastSeenAt: number;
  updatedAt: number;
  reporterCount: number;
  observationCount: number;
  confirmCount: number;
  dismissCount: number;
  platforms: Platform[];
  /** [min, max] AGL altitude band for air-domain hazards. */
  altitudeRangeM?: [number, number];
  note?: string;
}
