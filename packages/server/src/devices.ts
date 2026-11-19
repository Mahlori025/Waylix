import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { prefixedId } from '@waylix/engine';
import type { Store } from './store.ts';

/**
 * Platform attestation (Google Play Integrity / Apple App Attest). Verifying
 * these needs the operator's Google/Apple credentials, so the server ships
 * with a pluggable verifier; the default accepts nothing as attested.
 */
export interface AttestationVerifier {
  verify(platform: string, attestation: string): Promise<boolean>;
}

export const noAttestation: AttestationVerifier = { verify: async () => false };

export interface DeviceRegistryOptions {
  /** HMAC secret; if absent one is generated once and stored in the database. */
  secret?: string;
  /** Max registrations per client IP per 24 h (raises the cost of minting identities). */
  perIpPerDay?: number;
  attestation?: AttestationVerifier;
  /** Reject registrations that fail attestation. */
  requireAttestation?: boolean;
  clock?: () => number;
}

export interface Device {
  deviceId: string;
  token: string;
  attested: boolean;
}

export class RegistrationError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

/**
 * Server-issued reporter identities. A device registers once and receives a
 * signed token; every write is then attributed to the token's device id, and
 * any reporterId the client claims is ignored. This closes the "mint your own
 * IDs" hole in v0.1; attestation (when configured) makes each identity cost a
 * genuine, unmodified phone.
 */
export class DeviceRegistry {
  private readonly secret: Buffer;
  private readonly perIp: number;
  private readonly attestation: AttestationVerifier;
  private readonly requireAttestation: boolean;
  private readonly clock: () => number;

  constructor(private readonly store: Store, opts: DeviceRegistryOptions = {}) {
    store.db.exec(`
      CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS devices (
        id TEXT PRIMARY KEY,
        platform TEXT NOT NULL,
        attested INTEGER NOT NULL,
        ip_hash TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        revoked INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS devices_ip ON devices(ip_hash, created_at);
    `);
    this.secret = Buffer.from(opts.secret ?? this.storedSecret(), 'utf8');
    this.perIp = opts.perIpPerDay ?? 5;
    this.attestation = opts.attestation ?? noAttestation;
    this.requireAttestation = opts.requireAttestation ?? false;
    this.clock = opts.clock ?? Date.now;
  }

  private storedSecret(): string {
    const row = this.store.db.prepare(`SELECT v FROM meta WHERE k = 'device_secret'`).get() as { v: string } | undefined;
    if (row) return row.v;
    const s = randomBytes(32).toString('hex');
    this.store.db.prepare(`INSERT INTO meta (k, v) VALUES ('device_secret', ?)`).run(s);
    return s;
  }

  private sign(deviceId: string): string {
    return createHmac('sha256', this.secret).update(deviceId).digest('base64url');
  }

  private ipHash(ip: string): string {
    // Hashed so the table never stores raw IP addresses.
    return createHash('sha256').update(this.secret).update(ip).digest('hex').slice(0, 32);
  }

  async register(ip: string, platform: string, attestation?: string): Promise<Device> {
    const now = this.clock();
    const ipHash = this.ipHash(ip);
    const recent = Number(
      (this.store.db.prepare('SELECT COUNT(*) AS n FROM devices WHERE ip_hash = ? AND created_at > ?').get(ipHash, now - 86_400_000) as { n: number }).n,
    );
    if (recent >= this.perIp) throw new RegistrationError(429, 'too many device registrations from this network today');
    const attested = attestation ? await this.attestation.verify(platform, attestation) : false;
    if (this.requireAttestation && !attested) throw new RegistrationError(403, 'device attestation required');
    const deviceId = prefixedId('dev');
    this.store.db
      .prepare('INSERT INTO devices (id, platform, attested, ip_hash, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(deviceId, platform, attested ? 1 : 0, ipHash, now);
    return { deviceId, token: `${deviceId}.${this.sign(deviceId)}`, attested };
  }

  /** Returns the device behind a token, or null if the token is forged or revoked. */
  verify(token: string | undefined): { deviceId: string; attested: boolean } | null {
    if (!token || token.length > 256) return null;
    const dot = token.lastIndexOf('.');
    if (dot <= 0) return null;
    const deviceId = token.slice(0, dot);
    const sig = Buffer.from(token.slice(dot + 1));
    const expected = Buffer.from(this.sign(deviceId));
    if (sig.length !== expected.length || !timingSafeEqual(sig, expected)) return null;
    const row = this.store.db.prepare('SELECT attested, revoked FROM devices WHERE id = ?').get(deviceId) as { attested: number; revoked: number } | undefined;
    if (!row || row.revoked) return null;
    return { deviceId, attested: row.attested === 1 };
  }

  revoke(deviceId: string): void {
    this.store.db.prepare('UPDATE devices SET revoked = 1 WHERE id = ?').run(deviceId);
  }

  /** Unattested devices start with slightly lower trust than attested ones. */
  isAttested(deviceId: string): boolean {
    const row = this.store.db.prepare('SELECT attested FROM devices WHERE id = ?').get(deviceId) as { attested: number } | undefined;
    return row?.attested === 1;
  }
}
