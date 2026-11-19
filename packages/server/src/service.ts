import {
  HazardFusionEngine,
  Taxonomy,
  analyzeRoute,
  prefixedId,
  validateObservation,
  validateVote,
  type BBox,
  type Domain,
  type Hazard,
  type HazardStatus,
  type LngLat,
  type Observation,
  type PushResult,
  type Vote,
} from '@waylix/engine';
import type { Store } from './store.ts';

const ALL_STATUSES: HazardStatus[] = ['candidate', 'active', 'verified', 'expired', 'resolved'];

/** Server-side façade: validation → engine → durable log → projection. */
export class HazardService {
  readonly taxonomy = new Taxonomy();
  readonly engine: HazardFusionEngine;
  private pendingId: string | undefined;

  constructor(private readonly store: Store, private readonly clock: () => number = Date.now) {
    this.engine = new HazardFusionEngine({
      taxonomy: this.taxonomy,
      // During replay we force the hazard id recorded in the log, so ids are stable across restarts.
      idFactory: () => this.pendingId ?? prefixedId('hz'),
    });
    this.replay();
  }

  private replay(): void {
    for (const ev of this.store.events()) {
      if (ev.kind === 'observation') {
        this.pendingId = ev.hazardId;
        this.engine.ingest(ev.item, ev.receivedAt);
        this.pendingId = undefined;
      } else {
        this.engine.vote(ev.item, ev.receivedAt);
      }
    }
    this.sweep();
  }

  ingestObservations(input: unknown[]): PushResult & { hazards: Hazard[] } {
    const now = this.clock();
    const accepted: string[] = [];
    const rejected: PushResult['rejected'] = [];
    const touched = new Map<string, Hazard>();
    for (const raw of input) {
      const errors = validateObservation(raw, this.taxonomy, now);
      const id = typeof (raw as { id?: unknown })?.id === 'string' ? (raw as { id: string }).id : '(missing id)';
      if (errors.length) {
        rejected.push({ id, errors });
        continue;
      }
      const o = sanitizeObservation(raw as Observation);
      const r = this.engine.ingest(o, now);
      if (!r.duplicate) this.store.insertObservation(o, r.hazard.id, now);
      accepted.push(o.id);
      touched.set(r.hazard.id, r.hazard);
    }
    for (const h of touched.values()) this.store.upsertHazard(h);
    return { accepted, rejected, hazards: [...touched.values()] };
  }

  applyVotes(input: unknown[]): PushResult & { hazards: Hazard[] } {
    const now = this.clock();
    const accepted: string[] = [];
    const rejected: PushResult['rejected'] = [];
    const touched = new Map<string, Hazard>();
    for (const raw of input) {
      const errors = validateVote(raw, now);
      const id = typeof (raw as { id?: unknown })?.id === 'string' ? (raw as { id: string }).id : '(missing id)';
      if (errors.length) {
        rejected.push({ id, errors });
        continue;
      }
      const v = raw as Vote;
      const h = this.engine.vote(v, now);
      if (!h) {
        rejected.push({ id: v.id, errors: ['unknown hazard'] });
        continue;
      }
      this.store.insertVote(v, now);
      accepted.push(v.id);
      touched.set(h.id, h);
    }
    for (const h of touched.values()) this.store.upsertHazard(h);
    return { accepted, rejected, hazards: [...touched.values()] };
  }

  /**
   * Hazards in a bbox. With `since`, returns everything that changed after
   * that time *including* closed hazards, so clients can drop them.
   */
  hazards(q: { bbox?: BBox; since?: number; domain?: Domain; types?: string[]; minConfidence?: number; limit?: number }): { hazards: Hazard[]; serverTime: number } {
    const serverTime = this.clock();
    const hazards = this.engine.query(
      {
        ...(q.bbox ? { bbox: q.bbox } : {}),
        ...(q.domain ? { domain: q.domain } : {}),
        ...(q.types ? { types: q.types } : {}),
        ...(q.minConfidence !== undefined ? { minConfidence: q.minConfidence } : {}),
        ...(q.since !== undefined ? { updatedSince: q.since, statuses: ALL_STATUSES } : {}),
        limit: Math.min(q.limit ?? 5000, 5000),
      },
      serverTime,
    );
    if (q.since !== undefined && q.bbox) {
      // Closed hazards leave the spatial index; include recently closed ones in the box too.
      const closed = this.closedSince(q.since, q.bbox);
      const seen = new Set(hazards.map((h) => h.id));
      for (const h of closed) if (!seen.has(h.id)) hazards.push(h);
    }
    return { hazards, serverTime };
  }

  private closedSince(since: number, bbox: BBox): Hazard[] {
    const rows = this.store.db
      .prepare(`SELECT body FROM hazards WHERE status IN ('expired','resolved') AND updated_at > ? AND lon BETWEEN ? AND ? AND lat BETWEEN ? AND ? LIMIT 2000`)
      .all(since, bbox[0], bbox[2], bbox[1], bbox[3]) as Array<{ body: string }>;
    return rows.map((r) => JSON.parse(r.body) as Hazard);
  }

  hazard(id: string): { hazard: Hazard; evidence: { observations: number; confirms: number; dismisses: number; reporters: number } } | undefined {
    const h = this.engine.get(id);
    if (!h) return undefined;
    const ev = this.engine.evidenceOf(id);
    return {
      hazard: h,
      evidence: {
        observations: ev.filter((e) => e.kind === 'observation').length,
        confirms: ev.filter((e) => e.kind === 'confirm').length,
        dismisses: ev.filter((e) => e.kind === 'dismiss').length,
        reporters: new Set(ev.map((e) => e.reporterId)).size,
      },
    };
  }

  routeRisk(coordinates: LngLat[], corridorM?: number) {
    const hazards = this.engine.query({}, this.clock());
    return analyzeRoute(coordinates, hazards, corridorM !== undefined ? { corridorM } : {});
  }

  /** Apply time decay; persist hazards whose state changed. */
  sweep(): number {
    const changed = this.engine.sweep(this.clock());
    for (const h of changed) this.store.upsertHazard(h);
    return changed.length;
  }

  stats() {
    const open = this.engine.query({}, this.clock());
    const byStatus: Record<string, number> = {};
    for (const h of open) byStatus[h.status] = (byStatus[h.status] ?? 0) + 1;
    return { ...this.store.counts(), open: open.length, byStatus };
  }
}

/** Strip unknown fields so the durable log only holds the documented schema. */
function sanitizeObservation(o: Observation): Observation {
  const out: Observation = {
    id: o.id,
    type: o.type,
    position: [o.position[0], o.position[1]],
    accuracyM: o.accuracyM,
    observedAt: o.observedAt,
    reporterId: o.reporterId,
    platform: o.platform,
    source: o.source,
  };
  if (o.altitudeM !== undefined) out.altitudeM = o.altitudeM;
  if (o.severity !== undefined) out.severity = o.severity;
  if (o.detectorConfidence !== undefined) out.detectorConfidence = o.detectorConfidence;
  if (o.headingDeg !== undefined) out.headingDeg = o.headingDeg;
  if (o.note !== undefined) out.note = o.note.trim().slice(0, 500);
  if (o.mediaUrls !== undefined) out.mediaUrls = o.mediaUrls.slice(0, 4);
  return out;
}
