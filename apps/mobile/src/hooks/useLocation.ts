import { useEffect, useRef, useState } from 'react';
import * as Location from 'expo-location';
import { PositionFuser, type PositionFix } from '@waylix/engine';

export type PermissionState = 'unknown' | 'granted' | 'denied';

/**
 * GNSS position via expo-location, passed through the engine's PositionFuser.
 * When VPS lands, its fixes are pushed into the same fuser — no UI changes.
 */
export function useLocation(highAccuracy: boolean): { fix: PositionFix | undefined; permission: PermissionState } {
  const [fix, setFix] = useState<PositionFix>();
  const [permission, setPermission] = useState<PermissionState>('unknown');
  const fuser = useRef(new PositionFuser());

  useEffect(() => {
    let sub: Location.LocationSubscription | undefined;
    let cancelled = false;
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (cancelled) return;
      if (status !== 'granted') {
        setPermission('denied');
        return;
      }
      setPermission('granted');
      const last = await Location.getLastKnownPositionAsync();
      if (last && !cancelled) setFix(fuser.current.push(toFix(last)));
      sub = await Location.watchPositionAsync(
        {
          accuracy: highAccuracy ? Location.Accuracy.BestForNavigation : Location.Accuracy.Balanced,
          timeInterval: highAccuracy ? 1000 : 4000,
          distanceInterval: highAccuracy ? 2 : 10,
        },
        (loc) => {
          const f = fuser.current.push(toFix(loc));
          if (f) setFix(f);
        },
      );
      if (cancelled) sub.remove();
    })().catch(() => setPermission('denied'));
    return () => {
      cancelled = true;
      sub?.remove();
    };
  }, [highAccuracy]);

  return { fix, permission };
}

function toFix(loc: Location.LocationObject): PositionFix {
  const c = loc.coords;
  return {
    position: [c.longitude, c.latitude],
    accuracyM: c.accuracy ?? 25,
    timestamp: loc.timestamp,
    source: 'gnss',
    ...(c.altitude != null ? { altitudeM: c.altitude } : {}),
    ...(c.heading != null && c.heading >= 0 && (c.speed ?? 0) > 0.7 ? { headingDeg: c.heading } : {}),
    ...(c.speed != null && c.speed >= 0 ? { speedMps: c.speed } : {}),
  };
}
