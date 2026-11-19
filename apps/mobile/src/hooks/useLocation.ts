import { useCallback, useEffect, useRef, useState } from 'react';
import * as Location from 'expo-location';
import { PositionFuser, type PositionFix } from '@waylix/engine';

/** 'error' = permission granted but positioning failed (GPS off, timeout, platform error). */
export type PermissionState = 'unknown' | 'granted' | 'denied' | 'error';

const withTimeout = <T,>(p: Promise<T>, ms: number): Promise<T | undefined> =>
  Promise.race([p, new Promise<undefined>((r) => setTimeout(() => r(undefined), ms))]);

/**
 * GNSS position via expo-location, passed through the engine's PositionFuser.
 * When VPS lands, its fixes are pushed into the same fuser — no UI changes.
 *
 * - Cold start: if the OS has no last-known fix, asks for one current fix so
 *   the app is usable before the first watch update arrives.
 * - Switching accuracy (e.g. on Start) opens the new watch *before* closing
 *   the old one, so navigation never loses its position stream.
 */
export function useLocation(highAccuracy: boolean): { fix: PositionFix | undefined; permission: PermissionState } {
  const [fix, setFix] = useState<PositionFix>();
  const [permission, setPermission] = useState<PermissionState>('unknown');
  const fuser = useRef(new PositionFuser());
  const sub = useRef<Location.LocationSubscription | undefined>(undefined);

  const push = useCallback((loc: Location.LocationObject) => {
    const f = fuser.current.push(toFix(loc));
    if (f) setFix(f);
  }, []);

  // Permission + initial fix, once.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let status: string;
      try {
        ({ status } = await Location.requestForegroundPermissionsAsync());
      } catch {
        if (!cancelled) setPermission('error');
        return;
      }
      if (cancelled) return;
      if (status !== 'granted') {
        setPermission('denied');
        return;
      }
      setPermission('granted');
      try {
        const last = await Location.getLastKnownPositionAsync();
        if (cancelled) return;
        if (last) push(last);
        else {
          const cur = await withTimeout(Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }), 10_000);
          if (cur && !cancelled) push(cur);
        }
      } catch {
        // No seed fix is fine: the watch below delivers one shortly.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [push]);

  // Position stream; re-opened (make-before-break) when the accuracy changes.
  useEffect(() => {
    if (permission !== 'granted') return;
    let cancelled = false;
    const previous = sub.current;
    Location.watchPositionAsync(
      {
        accuracy: highAccuracy ? Location.Accuracy.BestForNavigation : Location.Accuracy.Balanced,
        timeInterval: highAccuracy ? 1000 : 4000,
        distanceInterval: highAccuracy ? 2 : 10,
      },
      push,
    )
      .then((s) => {
        if (cancelled) {
          s.remove();
          return;
        }
        sub.current = s;
        if (previous && previous !== s) previous.remove();
      })
      .catch(() => {
        if (!cancelled) setPermission('error');
      });
    return () => {
      cancelled = true;
    };
  }, [permission, highAccuracy, push]);

  useEffect(() => () => sub.current?.remove(), []);

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
