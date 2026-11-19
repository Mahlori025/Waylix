import { defaultFetch, type FetchLike, type KeyValueStore } from './http.ts';
import type { BBox, Hazard, Observation, Vote } from './types.ts';

export interface PushResult {
  /** Ids the server stored (or had already stored — pushes are idempotent). */
  accepted: string[];
  /** Ids the server rejected permanently (validation); drop them. */
  rejected: Array<{ id: string; errors: string[] }>;
  /** Current state of the hazards the pushed items touched (the Waylix API returns these). */
  hazards?: Hazard[];
}

export interface PullResult {
  hazards: Hazard[];
  serverTime: number;
}

export interface SyncTransport {
  pushObservations(obs: Observation[]): Promise<PushResult>;
  pushVotes(votes: Vote[]): Promise<PushResult>;
  pullHazards(bbox: BBox, since?: number): Promise<PullResult>;
}

/** Supplies the server-issued device token for writes (registering lazily if needed). */
export interface DeviceAuth {
  token(): Promise<string | undefined>;
  /** Called when the server rejects the token (revoked, or server secret rotated). */
  invalidate?(): Promise<void>;
}

export interface RegisteredDevice {
  deviceId: string;
  token: string;
  attested: boolean;
}

/** Register this device with a Waylix API and receive its signed identity. */
export async function registerDevice(
  baseUrl: string,
  platform: 'android' | 'ios' | 'web' | 'drone' | 'other',
  fetchImpl?: FetchLike,
  attestation?: string,
): Promise<RegisteredDevice> {
  const f = fetchImpl ?? defaultFetch();
  const res = await f(`${baseUrl.replace(/\/$/, '')}/v1/devices`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ platform, ...(attestation ? { attestation } : {}) }),
  });
  if (!res.ok) throw new Error(`device registration → HTTP ${res.status}`);
  return (await res.json()) as RegisteredDevice;
}

/** REST transport for the Waylix API server. */
export class HttpSyncTransport implements SyncTransport {
  private readonly fetch: FetchLike;
  constructor(private readonly baseUrl: string, fetchImpl?: FetchLike, private readonly apiKey?: string, private readonly device?: DeviceAuth) {
    this.fetch = fetchImpl ?? defaultFetch();
  }

  private headers(): Record<string, string> {
    return { 'Content-Type': 'application/json', ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}) };
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const token = await this.device?.token().catch(() => undefined);
    const headers = { ...this.headers(), ...(token ? { 'X-Waylix-Device': token } : {}) };
    const res = await this.fetch(`${this.baseUrl.replace(/\/$/, '')}${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
    if (res.status === 401 && token) await this.device?.invalidate?.();
    if (!res.ok) throw new Error(`POST ${path} → HTTP ${res.status}`);
    return (await res.json()) as T;
  }

  pushObservations(observations: Observation[]): Promise<PushResult> {
    return this.post('/v1/observations', { observations });
  }

  pushVotes(votes: Vote[]): Promise<PushResult> {
    return this.post('/v1/votes', { votes });
  }

  async pullHazards(bbox: BBox, since?: number): Promise<PullResult> {
    const q = `bbox=${bbox.map((n) => n.toFixed(6)).join(',')}${since ? `&since=${since}` : ''}`;
    const res = await this.fetch(`${this.baseUrl.replace(/\/$/, '')}/v1/hazards?${q}`, { headers: this.headers() });
    if (!res.ok) throw new Error(`GET /v1/hazards → HTTP ${res.status}`);
    return (await res.json()) as PullResult;
  }
}

type OutboxItem = { kind: 'observation'; item: Observation } | { kind: 'vote'; item: Vote };

export interface SyncStatus {
  pending: number;
  lastPushAt?: number;
  lastPullAt?: number;
  lastError?: string;
  online: boolean;
}

/**
 * Offline-first sync. Every report goes to a persistent outbox first, so a
 * user in a dead zone loses nothing; `flush()` drains it when the network is
 * back. Pulls are incremental (`since`) and merged into a local hazard cache
 * that the map and the alert engine read from.
 */
export class SyncClient {
  private static readonly OUTBOX = 'waylix.outbox.v1';
  private static readonly CACHE = 'waylix.hazards.v1';
  private outbox: OutboxItem[] = [];
  private cache = new Map<string, Hazard>();
  private loaded = false;
  private flushing: Promise<void> | null = null;
  private status: SyncStatus = { pending: 0, online: true };
  private listeners = new Set<() => void>();
  private pullCursor = new Map<string, number>();

  constructor(private readonly transport: SyncTransport, private readonly store: KeyValueStore, private readonly batchSize = 50) {}

  async init(): Promise<void> {
    if (this.loaded) return;
    try {
      const [o, c] = await Promise.all([this.store.get(SyncClient.OUTBOX), this.store.get(SyncClient.CACHE)]);
      this.outbox = o ? (JSON.parse(o) as OutboxItem[]) : [];
      const hz = c ? (JSON.parse(c) as Hazard[]) : [];
      this.cache = new Map(hz.map((h) => [h.id, h]));
    } catch {
      this.outbox = [];
      this.cache = new Map();
    }
    this.loaded = true;
    this.status.pending = this.outbox.length;
    this.emit();
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  getStatus(): SyncStatus {
    return { ...this.status };
  }

  pending(): OutboxItem[] {
    return [...this.outbox];
  }

  hazards(): Hazard[] {
    return [...this.cache.values()];
  }

  async queueObservation(o: Observation): Promise<void> {
    await this.init();
    this.outbox.push({ kind: 'observation', item: o });
    await this.persistOutbox();
  }

  async queueVote(v: Vote): Promise<void> {
    await this.init();
    this.outbox.push({ kind: 'vote', item: v });
    await this.persistOutbox();
  }

  /** Drain the outbox. Safe to call often; concurrent calls share one run. */
  flush(): Promise<void> {
    if (!this.flushing) this.flushing = this.doFlush().finally(() => (this.flushing = null));
    return this.flushing;
  }

  private async doFlush(): Promise<void> {
    await this.init();
    try {
      while (this.outbox.length) {
        const batch = this.outbox.slice(0, this.batchSize);
        const obs = batch.filter((b): b is Extract<OutboxItem, { kind: 'observation' }> => b.kind === 'observation').map((b) => b.item);
        const votes = batch.filter((b): b is Extract<OutboxItem, { kind: 'vote' }> => b.kind === 'vote').map((b) => b.item);
        const done = new Set<string>();
        let touched = false;
        if (obs.length) {
          const r = await this.transport.pushObservations(obs);
          r.accepted.forEach((id) => done.add(id));
          r.rejected.forEach((x) => done.add(x.id));
          touched = this.mergeHazards(r.hazards) || touched;
        }
        if (votes.length) {
          const r = await this.transport.pushVotes(votes);
          r.accepted.forEach((id) => done.add(id));
          r.rejected.forEach((x) => done.add(x.id));
          touched = this.mergeHazards(r.hazards) || touched;
        }
        // Show accepted reports immediately instead of waiting for the next pull.
        if (touched) await this.persistCache();
        const before = this.outbox.length;
        this.outbox = this.outbox.filter((b) => !done.has(b.item.id));
        await this.persistOutbox();
        if (this.outbox.length === before) break; // server made no progress; retry later
      }
      this.status = { ...this.status, online: true, lastPushAt: Date.now() };
      delete this.status.lastError;
    } catch (e) {
      this.status = { ...this.status, online: false, lastError: e instanceof Error ? e.message : String(e) };
    }
    this.emit();
  }

  /** Incremental pull for a viewport; cursors are kept per ~city-sized tile. */
  async pull(bbox: BBox): Promise<Hazard[]> {
    await this.init();
    const key = bbox.map((n) => n.toFixed(2)).join(',');
    try {
      const since = this.pullCursor.get(key);
      const r = await this.transport.pullHazards(bbox, since);
      this.mergeHazards(r.hazards);
      this.pullCursor.set(key, r.serverTime);
      await this.persistCache();
      this.status = { ...this.status, online: true, lastPullAt: Date.now() };
      delete this.status.lastError;
    } catch (e) {
      this.status = { ...this.status, online: false, lastError: e instanceof Error ? e.message : String(e) };
    }
    this.emit();
    return this.hazards();
  }

  /** Apply server hazard states to the cache; closed hazards are dropped. */
  private mergeHazards(hazards: readonly Hazard[] | undefined): boolean {
    if (!hazards?.length) return false;
    for (const h of hazards) {
      if (h.status === 'expired' || h.status === 'resolved') this.cache.delete(h.id);
      else this.cache.set(h.id, h);
    }
    return true;
  }

  private async persistCache(): Promise<void> {
    await this.store.set(SyncClient.CACHE, JSON.stringify([...this.cache.values()].slice(-20_000)));
  }

  private async persistOutbox(): Promise<void> {
    this.status.pending = this.outbox.length;
    await this.store.set(SyncClient.OUTBOX, JSON.stringify(this.outbox));
    this.emit();
  }

  private emit(): void {
    for (const l of this.listeners) l();
  }
}
