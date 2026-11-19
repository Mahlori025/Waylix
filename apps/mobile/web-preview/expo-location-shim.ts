/**
 * Web-preview shim for the subset of expo-location Waylix uses. In headless
 * Chrome the Expo web emitter never delivered watch updates to the app, so the
 * preview reads navigator.geolocation directly. Native builds are unaffected.
 */
export enum Accuracy { Lowest = 1, Low = 2, Balanced = 3, High = 4, Highest = 5, BestForNavigation = 6 }

export interface LocationObject {
  coords: { latitude: number; longitude: number; altitude: number | null; accuracy: number | null; heading: number | null; speed: number | null };
  timestamp: number;
}
export interface LocationSubscription { remove(): void }

const toObj = (p: GeolocationPosition): LocationObject => ({
  coords: { latitude: p.coords.latitude, longitude: p.coords.longitude, altitude: p.coords.altitude, accuracy: p.coords.accuracy, heading: p.coords.heading, speed: p.coords.speed },
  timestamp: p.timestamp,
});

export async function requestForegroundPermissionsAsync(): Promise<{ status: 'granted' | 'denied' }> {
  const r = await navigator.permissions.query({ name: 'geolocation' });
  return { status: r.state === 'denied' ? 'denied' : 'granted' };
}

export async function getLastKnownPositionAsync(): Promise<LocationObject | null> {
  return null; // mirrors a cold-start phone
}

export async function getCurrentPositionAsync(): Promise<LocationObject> {
  return new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition((p) => resolve(toObj(p)), reject, { enableHighAccuracy: true }));
}

export async function watchPositionAsync(_opts: unknown, cb: (l: LocationObject) => void): Promise<LocationSubscription> {
  const id = navigator.geolocation.watchPosition((p) => cb(toObj(p)), () => undefined, { enableHighAccuracy: true, maximumAge: 0 });
  return { remove: () => navigator.geolocation.clearWatch(id) };
}
