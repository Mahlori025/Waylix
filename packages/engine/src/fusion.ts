import { haversine } from './geo.ts';
import { prefixedId } from './ids.ts';
import { ReputationLedger } from './reputation.ts';
import { SpatialIndex } from './spatial-index.ts';
import { Taxonomy, type HazardTypeDef } from './taxonomy.ts';
import type {
  BBox,
  Domain,
  Hazard,
  HazardStatus,
  LngLat,
  Observation,
  ObservationSource,
  Platform,
  Severity,
  Vote,
} from './types.ts';

/**
 * Base evidence weight (in log-odds units) contributed by one observation of
 * each source. Manual reports are strong; a single accelerometer bump is weak
 * (speed bumps and railway crossings look similar) but many of them from
 * different vehicles add up.
 */
export const SOURCE_WEIGHTS: Readonly<Record<ObservationSource, number>> = {
  manual: 1.2,
  accelerometer: 0.45,
  camera_ai: 0.9,
  drone_camera: 1.0,
  lidar: 1.3,
  import: 1.6,
};

export const DISMISS_WEIGHT = 1.0;
export const CONFIRM_WEIGHT = 1.0;

export interface Thresholds {
  /** Confidence at or above which a hazard is shown as active. */
  active: number;
  /** Confidence at or above which (with enough reporters) it is verified. */
  verified: number;
  /** Confidence below which a refuted hazard is resolved. */
  expire: number;
  /**
   * Decayed positive evidence (log-odds units) below which a hazard has
   * faded and expires — once at least one half-life has passed since the
   * last positive report. One fresh manual report ≈ 1.2.
   */
  minEvidence: number;
}

export const DEFAULT_THRESHOLDS: Readonly<Thresholds> = { active: 0.5, verified: 0.85, expire: 0.2, minEvidence: 0.4 };

export interface EvidenceItem {
  refId: string;
  reporterId: string;
  kind: 'observation' | 'confirm' | 'dismiss';
  at: number;
  /** Base weight before trust and time decay, always ≥ 0. */
  weight: number;
  position?: LngLat;
  accuracyM?: number;
  altitudeM?: number;
  severity?: Severity;
  platform?: Platform;
}

interface HazardRecord {
  hazard: Hazard;
  evidence: EvidenceItem[];
  /** Highest status reached; drives reputation outcomes. */
  peak: HazardStatus;
  rewarded: boolean;
  penalised: boolean;
}

export interface FusionOptions {
  taxonomy?: Taxonomy;
  reputation?: ReputationLedger;
  priorLogOdds?: number;
  thresholds?: Partial<Thresholds>;
  maxEvidencePerHazard?: number;
  airAltitudeToleranceM?: number;
  idFactory?: () => string;
  onTransition?: (hazard: Hazard, previous: HazardStatus | null) => void;
}

export interface IngestResult {
  hazard: Hazard;
  created: boolean;
  /** True if this observation id was already ingested (idempotent replay). */
  duplicate: boolean;
}

export interface HazardQuery {
  bbox?: BBox;
  near?: { center: LngLat; radiusM: number };
  domain?: Domain;
  types?: readonly string[];
  statuses?: readonly HazardStatus[];
  minConfidence?: number;
  updatedSince?: number;
  limit?: number;
}

export interface EngineSnapshot {
  version: 1;
  records: Array<{ hazard: Hazard; evidence: EvidenceItem[]; peak: HazardStatus; rewarded: boolean; penalised: boolean }>;
  observationIndex: Array<[string, string]>;
  voteIds: string[];
  reputation: Array<[string, { alpha: number; beta: number }]>;
}

const STATUS_RANK: Record<HazardStatus, number> = { expired: 0, resolved: 0, candidate: 1, active: 2, verified: 3 };
const OPEN: ReadonlySet<HazardStatus> = new Set(['candidate', 'active', 'verified']);
const sigmoid = (x: number): number => 1 / (1 + Math.exp(-x));
const clamp = (x: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, x));

/**
 * The Waylix Hazard Fusion Engine.
 *
 * Observations of the same type that fall within the type's merge radius are
 * fused into one hazard. Each reporter contributes only their *latest*
 * statement (report / confirm / dismiss), scaled by source weight, reporter
 * trust and exponential time decay with a per-type half-life. The sum of
 * contributions plus a sceptical prior is a log-odds score whose sigmoid is
 * the hazard's confidence.
 *
 * Properties this gives us for free:
 *  - Spam resistance: one reporter tapping "report" 50 times counts once.
 *  - Self-healing map: unconfirmed hazards fade at the rate their type fades.
 *  - Source fusion: weak automated signals (accelerometer, drone vision) and
 *    strong human ones live on one scale.
 *  - Same code runs on phone (offline optimistic view) and server (truth).
 */
export class HazardFusionEngine {
  readonly taxonomy: Taxonomy;
  readonly reputation: ReputationLedger;
  private readonly prior: number;
  private readonly thresholds: Thresholds;
  private readonly maxEvidence: number;
  private readonly altTol: number;
  private readonly newId: () => string;
  private readonly onTransition: FusionOptions['onTransition'];

  private readonly records = new Map<string, HazardRecord>();
  private readonly index = new SpatialIndex<Hazard>(6);
  private readonly observationToHazard = new Map<string, string>();
  private readonly voteIds = new Set<string>();

  constructor(opts: FusionOptions = {}) {
    this.taxonomy = opts.taxonomy ?? new Taxonomy();
    this.reputation = opts.reputation ?? new ReputationLedger();
    this.prior = opts.priorLogOdds ?? -1.5;
    this.thresholds = { ...DEFAULT_THRESHOLDS, ...opts.thresholds };
    this.maxEvidence = opts.maxEvidencePerHazard ?? 250;
    this.altTol = opts.airAltitudeToleranceM ?? 30;
    this.newId = opts.idFactory ?? (() => prefixedId('hz'));
    this.onTransition = opts.onTransition;
  }

  get size(): number {
    return this.records.size;
  }

  get(id: string): Hazard | undefined {
    return this.records.get(id)?.hazard;
  }

  /** Fuse one observation. Idempotent on `observation.id`. Assumes validated input. */
  ingest(obs: Observation, now: number = Date.now()): IngestResult {
    const known = this.observationToHazard.get(obs.id);
    if (known) {
      const rec = this.records.get(known);
      if (rec) return { hazard: rec.hazard, created: false, duplicate: true };
    }
    const def = this.taxonomy.require(obs.type);
    const domain = domainFor(def, obs.platform);
    const evidence: EvidenceItem = {
      refId: obs.id,
      reporterId: obs.reporterId,
      kind: 'observation',
      at: obs.observedAt,
      weight: this.observationWeight(obs, def),
      position: obs.position,
      accuracyM: obs.accuracyM,
      ...(obs.altitudeM !== undefined ? { altitudeM: obs.altitudeM } : {}),
      severity: obs.severity ?? def.defaultSeverity,
      platform: obs.platform,
    };

    let rec = this.findMatch(obs, def, domain);
    let created = false;
    if (!rec) {
      created = true;
      const hazard: Hazard = {
        id: this.newId(),
        type: def.id,
        domain,
        position: obs.position,
        radiusM: def.kind === 'zone' ? def.mergeRadiusM : Math.min(def.mergeRadiusM, Math.max(3, obs.accuracyM)),
        severity: evidence.severity!,
        confidence: sigmoid(this.prior),
        status: 'candidate',
        firstSeenAt: obs.observedAt,
        lastSeenAt: obs.observedAt,
        updatedAt: now,
        reporterCount: 0,
        observationCount: 0,
        confirmCount: 0,
        dismissCount: 0,
        platforms: [],
        ...(obs.note ? { note: obs.note } : {}),
      };
      rec = { hazard, evidence: [], peak: 'candidate', rewarded: false, penalised: false };
      this.records.set(hazard.id, rec);
    }
    this.pushEvidence(rec, evidence);
    this.observationToHazard.set(obs.id, rec.hazard.id);
    if (obs.note && !rec.hazard.note) rec.hazard.note = obs.note;
    this.evaluate(rec, now, created ? null : rec.hazard.status);
    return { hazard: rec.hazard, created, duplicate: false };
  }

  /** Apply a confirm/dismiss vote. Returns undefined for unknown hazards. Idempotent on `vote.id`. */
  vote(v: Vote, now: number = Date.now()): Hazard | undefined {
    const rec = this.records.get(v.hazardId);
    if (!rec) return undefined;
    if (this.voteIds.has(v.id)) return rec.hazard;
    this.voteIds.add(v.id);
    this.pushEvidence(rec, {
      refId: v.id,
      reporterId: v.reporterId,
      kind: v.kind,
      at: v.at,
      weight: v.kind === 'confirm' ? CONFIRM_WEIGHT : DISMISS_WEIGHT,
      ...(v.position ? { position: v.position } : {}),
    });
    this.evaluate(rec, now, rec.hazard.status);
    return rec.hazard;
  }

  /** Re-evaluate every open hazard at `now` (time decay). Returns hazards whose status changed. */
  sweep(now: number = Date.now()): Hazard[] {
    const changed: Hazard[] = [];
    for (const rec of this.records.values()) {
      if (!OPEN.has(rec.hazard.status)) continue;
      const before = rec.hazard.status;
      this.evaluate(rec, now, before);
      if (rec.hazard.status !== before) changed.push(rec.hazard);
    }
    return changed;
  }

  /** Remove closed hazards older than `olderThanMs`. Returns number purged. */
  purge(now: number, olderThanMs: number): number {
    let n = 0;
    for (const [id, rec] of this.records) {
      if (!OPEN.has(rec.hazard.status) && now - rec.hazard.updatedAt > olderThanMs) {
        for (const e of rec.evidence) if (e.kind === 'observation') this.observationToHazard.delete(e.refId);
        this.records.delete(id);
        this.index.remove(id);
        n++;
      }
    }
    return n;
  }

  query(q: HazardQuery = {}, now?: number): Hazard[] {
    let pool: Hazard[];
    if (q.near) pool = this.index.queryRadius(q.near.center, q.near.radiusM).map((r) => r.item);
    else if (q.bbox) pool = this.index.queryBBox(q.bbox);
    else pool = this.index.all();
    const statuses = q.statuses ? new Set(q.statuses) : OPEN;
    const types = q.types ? new Set(q.types) : null;
    const out: Hazard[] = [];
    for (const h of pool) {
      if (now !== undefined) {
        const rec = this.records.get(h.id)!;
        if (OPEN.has(h.status)) this.evaluate(rec, now, h.status);
      }
      if (!statuses.has(h.status)) continue;
      if (q.domain && h.domain !== q.domain) continue;
      if (types && !types.has(h.type)) continue;
      if (q.minConfidence !== undefined && h.confidence < q.minConfidence) continue;
      if (q.updatedSince !== undefined && h.updatedAt <= q.updatedSince) continue;
      out.push(h);
      if (q.limit && out.length >= q.limit) break;
    }
    return out;
  }

  evidenceOf(hazardId: string): readonly EvidenceItem[] {
    return this.records.get(hazardId)?.evidence ?? [];
  }

  toSnapshot(): EngineSnapshot {
    return {
      version: 1,
      records: [...this.records.values()].map((r) => ({
        hazard: { ...r.hazard },
        evidence: r.evidence.map((e) => ({ ...e })),
        peak: r.peak,
        rewarded: r.rewarded,
        penalised: r.penalised,
      })),
      observationIndex: [...this.observationToHazard.entries()],
      voteIds: [...this.voteIds],
      reputation: this.reputation.entries(),
    };
  }

  static fromSnapshot(s: EngineSnapshot, opts: Omit<FusionOptions, 'reputation'> = {}): HazardFusionEngine {
    if (s.version !== 1) throw new Error(`unsupported snapshot version ${String(s.version)}`);
    const engine = new HazardFusionEngine({ ...opts, reputation: new ReputationLedger(s.reputation) });
    for (const r of s.records) {
      const rec: HazardRecord = { hazard: { ...r.hazard }, evidence: r.evidence.map((e) => ({ ...e })), peak: r.peak, rewarded: r.rewarded, penalised: r.penalised };
      engine.records.set(rec.hazard.id, rec);
      if (OPEN.has(rec.hazard.status)) engine.index.upsert(rec.hazard);
    }
    for (const [o, h] of s.observationIndex) engine.observationToHazard.set(o, h);
    for (const v of s.voteIds) engine.voteIds.add(v);
    return engine;
  }

  // ── internals ──────────────────────────────────────────────────────────

  private observationWeight(obs: Observation, def: HazardTypeDef): number {
    let w = SOURCE_WEIGHTS[obs.source];
    if (obs.detectorConfidence !== undefined && obs.source !== 'manual') w *= clamp(obs.detectorConfidence, 0, 1);
    // A fix much coarser than the hazard's own scale is weaker evidence of *this* hazard.
    w *= clamp(def.mergeRadiusM / Math.max(obs.accuracyM, def.mergeRadiusM), 0.3, 1);
    return w;
  }

  private findMatch(obs: Observation, def: HazardTypeDef, domain: Domain): HazardRecord | undefined {
    const searchM = def.mergeRadiusM + Math.min(obs.accuracyM, def.mergeRadiusM);
    let best: HazardRecord | undefined;
    let bestD = Infinity;
    for (const { item, distanceM } of this.index.queryRadius(obs.position, searchM)) {
      if (item.type !== def.id || item.domain !== domain || !OPEN.has(item.status)) continue;
      if (domain === 'air' && obs.altitudeM !== undefined && item.altitudeRangeM) {
        const [lo, hi] = item.altitudeRangeM;
        if (obs.altitudeM < lo - this.altTol || obs.altitudeM > hi + this.altTol) continue;
      }
      if (distanceM < bestD) {
        bestD = distanceM;
        best = this.records.get(item.id);
      }
    }
    return best;
  }

  private pushEvidence(rec: HazardRecord, e: EvidenceItem): void {
    rec.evidence.push(e);
    if (rec.evidence.length > this.maxEvidence) {
      rec.evidence.sort((a, b) => a.at - b.at);
      rec.evidence.splice(0, rec.evidence.length - this.maxEvidence);
    }
  }

  private evaluate(rec: HazardRecord, now: number, previous: HazardStatus | null): void {
    const h = rec.hazard;
    const before = signature(h);
    const def = this.taxonomy.require(h.type);
    const halfLifeMs = def.halfLifeHours * 3_600_000;
    const decay = (at: number): number => 2 ** (-Math.max(0, now - at) / halfLifeMs);

    // Latest statement per reporter.
    const latest = new Map<string, EvidenceItem>();
    for (const e of rec.evidence) {
      const cur = latest.get(e.reporterId);
      if (!cur || e.at >= cur.at) latest.set(e.reporterId, e);
    }

    let pos = 0;
    let neg = 0;
    let positiveReporters = 0;
    let dismissers = 0;
    let lastPositiveAt = -Infinity;
    for (const e of latest.values()) {
      const c = e.weight * this.reputation.trust(e.reporterId) * decay(e.at);
      if (e.kind === 'dismiss') {
        neg += c;
        dismissers++;
      } else {
        pos += c;
        positiveReporters++;
        if (e.at > lastPositiveAt) lastPositiveAt = e.at;
      }
    }
    const confidence = sigmoid(this.prior + pos - neg);

    // Geometry & attributes from observations (all of them, decayed).
    let sw = 0, sx = 0, sy = 0, ssev = 0, sevW = 0;
    let first = Infinity, last = -Infinity, obsCount = 0, confirms = 0, dismisses = 0;
    let altLo = Infinity, altHi = -Infinity;
    const platforms = new Set<Platform>();
    for (const e of rec.evidence) {
      if (e.kind === 'confirm') { confirms++; if (e.at > last) last = e.at; continue; }
      if (e.kind === 'dismiss') { dismisses++; continue; }
      obsCount++;
      if (e.at < first) first = e.at;
      if (e.at > last) last = e.at;
      if (e.platform) platforms.add(e.platform);
      if (e.altitudeM !== undefined) { altLo = Math.min(altLo, e.altitudeM); altHi = Math.max(altHi, e.altitudeM); }
      const base = e.weight * decay(e.at) + 1e-9;
      if (e.position) {
        const acc = Math.max(3, e.accuracyM ?? 10);
        const w = base / (acc * acc);
        sw += w; sx += w * e.position[0]; sy += w * e.position[1];
      }
      if (e.severity) { ssev += base * e.severity; sevW += base; }
    }
    if (sw > 0) h.position = [sx / sw, sy / sw];
    if (sevW > 0) h.severity = clamp(Math.round(ssev / sevW), 1, 5) as Severity;
    if (def.kind === 'zone') {
      h.radiusM = def.mergeRadiusM;
    } else {
      let spread = 0, n = 0;
      for (const e of rec.evidence) if (e.kind === 'observation' && e.position) { spread += haversine(e.position, h.position) ** 2; n++; }
      h.radiusM = clamp(n ? Math.sqrt(spread / n) + 3 : 5, 3, def.mergeRadiusM);
    }
    if (altLo <= altHi) h.altitudeRangeM = [altLo, altHi];
    if (Number.isFinite(first)) h.firstSeenAt = first;
    if (Number.isFinite(last)) h.lastSeenAt = last;
    h.observationCount = obsCount;
    h.confirmCount = confirms;
    h.dismissCount = dismisses;
    h.reporterCount = latest.size;
    h.platforms = [...platforms];
    h.confidence = Math.round(confidence * 1e4) / 1e4;

    // Status.
    let status: HazardStatus;
    if (confidence < this.thresholds.expire && dismissers > 0 && neg >= pos) {
      status = 'resolved';
    } else if (pos < this.thresholds.minEvidence && now - lastPositiveAt >= halfLifeMs) {
      status = 'expired';
    } else if (confidence >= this.thresholds.verified && positiveReporters >= def.minReportersForVerified) {
      status = 'verified';
    } else if (confidence >= this.thresholds.active) {
      status = 'active';
    } else {
      status = 'candidate';
    }
    h.status = status;
    // Only material changes bump updatedAt, so incremental sync (`since`) stays cheap.
    if (previous === null || signature(h) !== before) h.updatedAt = now;
    if (STATUS_RANK[status] > STATUS_RANK[rec.peak]) rec.peak = status;

    // Reputation outcomes.
    if (status === 'verified' && !rec.rewarded) {
      rec.rewarded = true;
      for (const e of latest.values()) if (e.kind !== 'dismiss') this.reputation.record(e.reporterId, true);
    }
    if (status === 'resolved' && !rec.penalised && STATUS_RANK[rec.peak] < STATUS_RANK.active) {
      // Never gained traction and was actively refuted: likely a false report.
      rec.penalised = true;
      for (const e of latest.values()) if (e.kind === 'observation') this.reputation.record(e.reporterId, false, 0.5);
    }

    if (OPEN.has(status)) this.index.upsert(h);
    else this.index.remove(h.id);
    if (previous !== status && this.onTransition) this.onTransition(h, previous);
  }
}

function signature(h: Hazard): string {
  return `${h.status}|${h.confidence.toFixed(2)}|${h.position[0].toFixed(6)},${h.position[1].toFixed(6)}|${h.severity}|${h.observationCount}|${h.confirmCount}|${h.dismissCount}`;
}

export function domainFor(def: HazardTypeDef, platform: Platform): Domain {
  if (def.domains.length === 1) return def.domains[0]!;
  if (platform === 'pedestrian' && def.domains.includes('walkway')) return 'walkway';
  if (platform === 'drone' && def.domains.includes('air')) return 'air';
  return def.domains[0]!;
}
