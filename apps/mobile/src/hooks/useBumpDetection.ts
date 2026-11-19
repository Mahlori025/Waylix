import { useEffect, useRef } from 'react';
import { Accelerometer } from 'expo-sensors';
import { BumpDetector, uuid, type Observation, type PositionFix } from '@waylix/engine';

/**
 * Passive pothole detection while driving. Each jolt becomes a weak
 * 'accelerometer' observation; the fusion engine only promotes a spot once
 * several vehicles report it, so speed bumps and one-off jolts wash out.
 */
export function useBumpDetection(
  enabled: boolean,
  fix: PositionFix | undefined,
  reporterId: string,
  onObservation: (o: Observation) => void,
): void {
  const fixRef = useRef(fix);
  fixRef.current = fix;
  const cb = useRef(onObservation);
  cb.current = onObservation;

  useEffect(() => {
    if (!enabled) return;
    const detector = new BumpDetector();
    Accelerometer.setUpdateInterval(20); // 50 Hz
    const sub = Accelerometer.addListener((a) => {
      const f = fixRef.current;
      if (!f) return;
      const ev = detector.push(
        { t: Date.now(), x: a.x, y: a.y, z: a.z },
        { position: f.position, accuracyM: f.accuracyM, speedMps: f.speedMps ?? 0 },
      );
      if (!ev) return;
      cb.current({
        id: uuid(),
        type: 'pothole',
        position: ev.position,
        accuracyM: ev.accuracyM,
        observedAt: ev.t,
        reporterId,
        platform: 'vehicle',
        source: 'accelerometer',
        severity: ev.severity,
        detectorConfidence: ev.confidence,
        ...(f.headingDeg !== undefined ? { headingDeg: f.headingDeg } : {}),
      });
    });
    return () => sub.remove();
  }, [enabled, reporterId]);
}
