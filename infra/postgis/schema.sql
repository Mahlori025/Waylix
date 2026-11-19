-- Waylix scale-out schema (PostgreSQL 16 + PostGIS 3).
-- Mirrors the SQLite event log used by the reference server. The fusion
-- engine stays in the application tier; Postgres stores the immutable event
-- log and the hazard projection, partitioned by geohash prefix so regions
-- (cities, provinces, countries) can be sharded across engine workers.

CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE observations (
  id           text PRIMARY KEY,               -- client UUID (idempotency key)
  hazard_id    text NOT NULL,
  reporter_id  text NOT NULL,
  type         text NOT NULL,
  platform     text NOT NULL CHECK (platform IN ('pedestrian','vehicle','cyclist','drone','fixed_sensor')),
  source       text NOT NULL,
  geom         geography(PointZ, 4326) NOT NULL,  -- Z = altitude AGL for drones
  accuracy_m   real NOT NULL,
  geohash5     char(5) NOT NULL,               -- shard / partition key (~5 km cells)
  observed_at  timestamptz NOT NULL,
  received_at  timestamptz NOT NULL DEFAULT now(),
  body         jsonb NOT NULL
) PARTITION BY HASH (geohash5);

CREATE TABLE observations_p0 PARTITION OF observations FOR VALUES WITH (MODULUS 4, REMAINDER 0);
CREATE TABLE observations_p1 PARTITION OF observations FOR VALUES WITH (MODULUS 4, REMAINDER 1);
CREATE TABLE observations_p2 PARTITION OF observations FOR VALUES WITH (MODULUS 4, REMAINDER 2);
CREATE TABLE observations_p3 PARTITION OF observations FOR VALUES WITH (MODULUS 4, REMAINDER 3);
CREATE INDEX ON observations USING gist (geom);
CREATE INDEX ON observations (received_at);

CREATE TABLE votes (
  id           text PRIMARY KEY,
  hazard_id    text NOT NULL,
  reporter_id  text NOT NULL,
  kind         text NOT NULL CHECK (kind IN ('confirm','dismiss')),
  at           timestamptz NOT NULL,
  received_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON votes (hazard_id);

CREATE TABLE hazards (
  id           text PRIMARY KEY,
  type         text NOT NULL,
  domain       text NOT NULL CHECK (domain IN ('road','walkway','air')),
  status       text NOT NULL,
  geom         geography(Point, 4326) NOT NULL,
  radius_m     real NOT NULL,
  alt_min_m    real,
  alt_max_m    real,
  confidence   real NOT NULL,
  severity     smallint NOT NULL,
  geohash5     char(5) NOT NULL,
  updated_at   timestamptz NOT NULL,
  body         jsonb NOT NULL
);
CREATE INDEX ON hazards USING gist (geom);
CREATE INDEX ON hazards (updated_at);
CREATE INDEX ON hazards (geohash5, status);

CREATE TABLE reporter_reputation (
  reporter_id  text PRIMARY KEY,
  alpha        real NOT NULL DEFAULT 2,
  beta         real NOT NULL DEFAULT 2
);

-- Example: open hazards within 2 km of a point, most dangerous first.
-- SELECT id, type, severity, confidence FROM hazards
--  WHERE status IN ('active','verified')
--    AND ST_DWithin(geom, ST_MakePoint(28.0473, -26.2041)::geography, 2000)
--  ORDER BY severity * severity * confidence DESC;
