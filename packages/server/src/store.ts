import { DatabaseSync } from 'node:sqlite';
import type { Hazard, Observation, Vote } from '@waylix/engine';

/**
 * Durable event log + materialised hazard table on SQLite (built into Node).
 *
 * Observations and votes are the source of truth (event sourcing); hazards
 * are a projection that can always be rebuilt by replaying the log through
 * the engine. The schema maps 1:1 onto PostGIS for scale-out — see
 * infra/postgis/schema.sql.
 */
export class Store {
  readonly db: DatabaseSync;

  constructor(path = ':memory:') {
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      CREATE TABLE IF NOT EXISTS observations (
        id TEXT PRIMARY KEY,
        hazard_id TEXT NOT NULL,
        reporter_id TEXT NOT NULL,
        type TEXT NOT NULL,
        lon REAL NOT NULL,
        lat REAL NOT NULL,
        observed_at INTEGER NOT NULL,
        received_at INTEGER NOT NULL,
        body TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS obs_received ON observations(received_at);
      CREATE INDEX IF NOT EXISTS obs_hazard ON observations(hazard_id);
      CREATE TABLE IF NOT EXISTS votes (
        id TEXT PRIMARY KEY,
        hazard_id TEXT NOT NULL,
        reporter_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        at INTEGER NOT NULL,
        received_at INTEGER NOT NULL,
        body TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS votes_received ON votes(received_at);
      CREATE TABLE IF NOT EXISTS hazards (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        domain TEXT NOT NULL,
        status TEXT NOT NULL,
        lon REAL NOT NULL,
        lat REAL NOT NULL,
        confidence REAL NOT NULL,
        severity INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        body TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS hz_geo ON hazards(lat, lon);
      CREATE INDEX IF NOT EXISTS hz_updated ON hazards(updated_at);
    `);
  }

  insertObservation(o: Observation, hazardId: string, receivedAt: number): void {
    this.db
      .prepare('INSERT OR IGNORE INTO observations (id, hazard_id, reporter_id, type, lon, lat, observed_at, received_at, body) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(o.id, hazardId, o.reporterId, o.type, o.position[0], o.position[1], o.observedAt, receivedAt, JSON.stringify(o));
  }

  insertVote(v: Vote, receivedAt: number): void {
    this.db
      .prepare('INSERT OR IGNORE INTO votes (id, hazard_id, reporter_id, kind, at, received_at, body) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(v.id, v.hazardId, v.reporterId, v.kind, v.at, receivedAt, JSON.stringify(v));
  }

  upsertHazard(h: Hazard): void {
    this.db
      .prepare(`INSERT INTO hazards (id, type, domain, status, lon, lat, confidence, severity, updated_at, body)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET status = excluded.status, lon = excluded.lon, lat = excluded.lat,
                  confidence = excluded.confidence, severity = excluded.severity, updated_at = excluded.updated_at, body = excluded.body`)
      .run(h.id, h.type, h.domain, h.status, h.position[0], h.position[1], h.confidence, h.severity, h.updatedAt, JSON.stringify(h));
  }

  /** The event log in arrival order, for deterministic replay at boot. */
  *events(): Generator<
    | { kind: 'observation'; hazardId: string; receivedAt: number; item: Observation }
    | { kind: 'vote'; receivedAt: number; item: Vote }
  > {
    const rows = this.db
      .prepare(`SELECT 'observation' AS kind, hazard_id, received_at, body FROM observations
                UNION ALL
                SELECT 'vote' AS kind, hazard_id, received_at, body FROM votes
                ORDER BY received_at, kind`)
      .iterate() as Iterable<{ kind: string; hazard_id: string; received_at: number; body: string }>;
    for (const r of rows) {
      if (r.kind === 'observation') yield { kind: 'observation', hazardId: r.hazard_id, receivedAt: r.received_at, item: JSON.parse(r.body) as Observation };
      else yield { kind: 'vote', receivedAt: r.received_at, item: JSON.parse(r.body) as Vote };
    }
  }

  counts(): { observations: number; votes: number; hazards: number } {
    const one = (sql: string) => Number((this.db.prepare(sql).get() as { n: number }).n);
    return {
      observations: one('SELECT COUNT(*) AS n FROM observations'),
      votes: one('SELECT COUNT(*) AS n FROM votes'),
      hazards: one('SELECT COUNT(*) AS n FROM hazards'),
    };
  }

  close(): void {
    this.db.close();
  }
}
