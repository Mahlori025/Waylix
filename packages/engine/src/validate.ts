import { isValidLngLat } from './geo.ts';
import type { Taxonomy } from './taxonomy.ts';
import type { Observation, ObservationSource, Platform, Vote } from './types.ts';

export const PLATFORMS: readonly Platform[] = ['pedestrian', 'vehicle', 'cyclist', 'drone', 'fixed_sensor'];
export const SOURCES: readonly ObservationSource[] = ['manual', 'accelerometer', 'camera_ai', 'drone_camera', 'lidar', 'import'];

const MAX_FUTURE_SKEW_MS = 5 * 60_000;
const MAX_AGE_MS = 30 * 24 * 3_600_000;

const isNonEmptyString = (v: unknown, max: number): v is string => typeof v === 'string' && v.length > 0 && v.length <= max;

/** Returns a list of problems; empty means valid. Safe to run on untrusted input. */
export function validateObservation(o: unknown, taxonomy: Taxonomy, now = Date.now()): string[] {
  const e: string[] = [];
  if (typeof o !== 'object' || o === null) return ['observation must be an object'];
  const x = o as Record<string, unknown>;
  if (!isNonEmptyString(x.id, 128)) e.push('id must be a non-empty string (≤128 chars)');
  if (!isNonEmptyString(x.type, 64) || !taxonomy.has(x.type)) e.push(`unknown hazard type: ${String(x.type)}`);
  if (!isValidLngLat(x.position)) e.push('position must be [lon, lat] in WGS-84');
  if (typeof x.accuracyM !== 'number' || !(x.accuracyM > 0) || x.accuracyM > 5000) e.push('accuracyM must be in (0, 5000]');
  if (typeof x.observedAt !== 'number' || !Number.isFinite(x.observedAt)) e.push('observedAt must be epoch ms');
  else if (x.observedAt > now + MAX_FUTURE_SKEW_MS) e.push('observedAt is in the future');
  else if (x.observedAt < now - MAX_AGE_MS) e.push('observedAt is older than 30 days');
  if (!isNonEmptyString(x.reporterId, 128)) e.push('reporterId required');
  if (!PLATFORMS.includes(x.platform as Platform)) e.push(`platform must be one of ${PLATFORMS.join(', ')}`);
  if (!SOURCES.includes(x.source as ObservationSource)) e.push(`source must be one of ${SOURCES.join(', ')}`);
  if (x.severity !== undefined && (!Number.isInteger(x.severity) || (x.severity as number) < 1 || (x.severity as number) > 5)) e.push('severity must be an integer 1..5');
  if (x.detectorConfidence !== undefined && (typeof x.detectorConfidence !== 'number' || x.detectorConfidence < 0 || x.detectorConfidence > 1)) e.push('detectorConfidence must be in [0, 1]');
  if (x.altitudeM !== undefined && (typeof x.altitudeM !== 'number' || !Number.isFinite(x.altitudeM) || x.altitudeM < -500 || x.altitudeM > 10_000)) e.push('altitudeM out of range');
  if (x.headingDeg !== undefined && (typeof x.headingDeg !== 'number' || !Number.isFinite(x.headingDeg))) e.push('headingDeg must be a number');
  if (x.note !== undefined && (typeof x.note !== 'string' || x.note.length > 500)) e.push('note must be a string ≤500 chars');
  if (x.mediaUrls !== undefined && (!Array.isArray(x.mediaUrls) || x.mediaUrls.length > 4 || !x.mediaUrls.every((u) => typeof u === 'string' && /^https:\/\//.test(u) && u.length <= 2048))) e.push('mediaUrls must be ≤4 https URLs');
  return e;
}

export function validateVote(v: unknown, now = Date.now()): string[] {
  const e: string[] = [];
  if (typeof v !== 'object' || v === null) return ['vote must be an object'];
  const x = v as Record<string, unknown>;
  if (!isNonEmptyString(x.id, 128)) e.push('id required');
  if (!isNonEmptyString(x.hazardId, 128)) e.push('hazardId required');
  if (!isNonEmptyString(x.reporterId, 128)) e.push('reporterId required');
  if (x.kind !== 'confirm' && x.kind !== 'dismiss') e.push("kind must be 'confirm' or 'dismiss'");
  if (typeof x.at !== 'number' || !Number.isFinite(x.at) || x.at > now + MAX_FUTURE_SKEW_MS) e.push('at must be epoch ms, not in the future');
  if (x.position !== undefined && !isValidLngLat(x.position)) e.push('position must be [lon, lat]');
  return e;
}

export function assertObservation(o: unknown, taxonomy: Taxonomy, now?: number): asserts o is Observation {
  const e = validateObservation(o, taxonomy, now);
  if (e.length) throw new Error(e.join('; '));
}

export function assertVote(v: unknown, now?: number): asserts v is Vote {
  const e = validateVote(v, now);
  if (e.length) throw new Error(e.join('; '));
}
