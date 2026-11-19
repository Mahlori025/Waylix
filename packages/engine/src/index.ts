/**
 * @waylix/engine — the Waylix Hazard Fusion Engine (HFE) by AIDotLix.
 *
 * A platform-agnostic geospatial event engine: the same code fuses
 * pedestrian, vehicle and drone observations on the phone (offline) and on
 * the server (source of truth).
 */
export * from './types.ts';
export * from './taxonomy.ts';
export * from './geo.ts';
export * from './geohash.ts';
export * from './spatial-index.ts';
export * from './ids.ts';
export * from './reputation.ts';
export * from './validate.ts';
export * from './fusion.ts';
export * from './route-risk.ts';
export * from './navigation.ts';
export * from './alerts.ts';
export * from './http.ts';
export * from './routing.ts';
export * from './geocoding.ts';
export * from './sync.ts';
export * from './positioning.ts';
export * from './adapters/drone.ts';
export * from './sensors/bump-detector.ts';

export const ENGINE_VERSION = '0.1.0';
