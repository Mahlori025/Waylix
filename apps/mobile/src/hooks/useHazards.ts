import { useCallback, useEffect, useMemo, useState } from 'react';
import { HazardFusionEngine, haversine, type BBox, type Hazard, type Observation, type SyncClient, type SyncStatus } from '@waylix/engine';
import { taxonomy } from '../services/waylix';

export interface DisplayHazard extends Hazard {
  /** True for hazards built locally from reports not yet accepted by the server. */
  pending?: boolean;
}

/**
 * Server hazards (cached for offline use) plus an optimistic local view of
 * the user's own unsynced reports, fused with the very same engine the server
 * runs — so what you see offline is what the server will compute.
 */
export function useHazards(sync: SyncClient): {
  hazards: DisplayHazard[];
  status: SyncStatus;
  refresh: (bbox: BBox) => Promise<void>;
} {
  const [tick, setTick] = useState(0);
  useEffect(() => sync.subscribe(() => setTick((t) => t + 1)), [sync]);

  const hazards = useMemo<DisplayHazard[]>(() => {
    const server = sync.hazards();
    const pendingObs = sync
      .pending()
      .filter((p): p is { kind: 'observation'; item: Observation } => p.kind === 'observation')
      .map((p) => p.item);
    if (!pendingObs.length) return server;
    const local = new HazardFusionEngine({ taxonomy });
    const now = Date.now();
    for (const o of pendingObs) local.ingest(o, now);
    const extra: DisplayHazard[] = [];
    for (const h of local.query({})) {
      const def = taxonomy.get(h.type);
      const dup = server.some((s) => s.type === h.type && haversine(s.position, h.position) <= (def?.mergeRadiusM ?? 20));
      if (!dup) extra.push({ ...h, pending: true });
    }
    return [...server, ...extra];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sync, tick]);

  const refresh = useCallback(
    async (bbox: BBox) => {
      await sync.flush();
      await sync.pull(bbox);
    },
    [sync],
  );

  return { hazards, status: sync.getStatus(), refresh };
}
