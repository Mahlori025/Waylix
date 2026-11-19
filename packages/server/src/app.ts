import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { ENGINE_VERSION, isValidLngLat, type BBox, type Domain, type LngLat } from '@waylix/engine';
import { RegistrationError, type DeviceRegistry } from './devices.ts';
import type { HazardService } from './service.ts';

export interface AppOptions {
  /** If set, write endpoints require `Authorization: Bearer <key>`. */
  apiKeys?: string[];
  /** Requests per minute per client IP. */
  rateLimitPerMin?: number;
  maxBodyBytes?: number;
  corsOrigin?: string;
  /** Issues and verifies device tokens (`POST /v1/devices`, `X-Waylix-Device` header). */
  devices?: DeviceRegistry;
  /** Reject observation/vote writes without a valid device token. */
  requireDevice?: boolean;
  /** Read the client IP from X-Forwarded-For (only behind a trusted reverse proxy). */
  trustProxy?: boolean;
  /** Writes per minute per device. */
  deviceWritesPerMin?: number;
}

class HttpError extends Error {
  constructor(readonly status: number, message: string, readonly details?: unknown) {
    super(message);
  }
}

const DOMAINS: Domain[] = ['road', 'walkway', 'air'];

export function createApp(service: HazardService, opts: AppOptions = {}): Server {
  const maxBody = opts.maxBodyBytes ?? 512 * 1024;
  const limiter = new RateLimiter(opts.rateLimitPerMin ?? 240);
  const deviceLimiter = new RateLimiter(opts.deviceWritesPerMin ?? 30);
  const keys = new Set(opts.apiKeys?.filter(Boolean) ?? []);

  return createServer(async (req, res) => {
    const started = Date.now();
    res.setHeader('Access-Control-Allow-Origin', opts.corsOrigin ?? '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Waylix-Device');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    try {
      if (req.method === 'OPTIONS') return send(res, 204, null);
      const forwarded = opts.trustProxy ? (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() : undefined;
      const ip = forwarded || req.socket.remoteAddress || 'unknown';
      if (!limiter.take(ip)) throw new HttpError(429, 'rate limit exceeded');
      const url = new URL(req.url ?? '/', 'http://localhost');
      const path = url.pathname.replace(/\/+$/, '') || '/';

      if (req.method === 'POST' && keys.size) {
        const auth = req.headers.authorization ?? '';
        if (!auth.startsWith('Bearer ') || !keys.has(auth.slice(7))) throw new HttpError(401, 'missing or invalid API key');
      }

      // ── routes ───────────────────────────────────────────────────────
      if (req.method === 'GET' && (path === '/' || path === '/health')) {
        return send(res, 200, { ok: true, service: 'waylix-api', engine: ENGINE_VERSION, ...service.stats() });
      }
      if (req.method === 'GET' && path === '/v1/taxonomy') {
        return send(res, 200, { types: service.taxonomy.list() });
      }
      if (req.method === 'POST' && path === '/v1/devices') {
        if (!opts.devices) throw new HttpError(404, 'device registration is not enabled');
        const body = (await readJson(req, 4096)) as { platform?: unknown; attestation?: unknown };
        const platform = typeof body.platform === 'string' && /^(android|ios|web|drone|other)$/.test(body.platform) ? body.platform : 'other';
        const attestation = typeof body.attestation === 'string' && body.attestation.length < 16_384 ? body.attestation : undefined;
        try {
          return send(res, 201, await opts.devices.register(ip, platform, attestation));
        } catch (e) {
          if (e instanceof RegistrationError) throw new HttpError(e.status, e.message);
          throw e;
        }
      }
      if (req.method === 'POST' && (path === '/v1/observations' || path === '/v1/votes')) {
        const device = opts.devices?.verify(req.headers['x-waylix-device'] as string | undefined) ?? null;
        if (opts.requireDevice && !device) throw new HttpError(401, 'missing or invalid device token (register via POST /v1/devices)');
        if (device && !deviceLimiter.take(device.deviceId)) throw new HttpError(429, 'device write limit exceeded');
        const ctx = device ? { deviceId: device.deviceId } : {};
        const body = await readJson(req, maxBody);
        if (path === '/v1/observations') {
          const list = (body as { observations?: unknown }).observations;
          if (!Array.isArray(list) || list.length === 0 || list.length > 200) throw new HttpError(400, 'observations must be an array of 1..200 items');
          return send(res, 200, service.ingestObservations(list, ctx));
        }
        const list = (body as { votes?: unknown }).votes;
        if (!Array.isArray(list) || list.length === 0 || list.length > 200) throw new HttpError(400, 'votes must be an array of 1..200 items');
        return send(res, 200, service.applyVotes(list, ctx));
      }
      if (req.method === 'GET' && (path === '/v1/hazards' || path === '/v1/hazards.geojson')) {
        const q = parseHazardQuery(url.searchParams);
        const result = service.hazards(q);
        if (path.endsWith('.geojson')) {
          return send(res, 200, {
            type: 'FeatureCollection',
            features: result.hazards.map((h) => ({ type: 'Feature', id: h.id, geometry: { type: 'Point', coordinates: h.position }, properties: { ...h, position: undefined } })),
          }, 'application/geo+json');
        }
        return send(res, 200, result);
      }
      const m = /^\/v1\/hazards\/([\w-]{1,128})$/.exec(path);
      if (req.method === 'GET' && m) {
        const r = service.hazard(m[1]!);
        if (!r) throw new HttpError(404, 'hazard not found');
        return send(res, 200, r);
      }
      if (req.method === 'POST' && path === '/v1/route-risk') {
        const body = (await readJson(req, maxBody)) as { coordinates?: unknown; corridorM?: unknown };
        const coords = body.coordinates;
        if (!Array.isArray(coords) || coords.length < 2 || coords.length > 20_000 || !coords.every(isValidLngLat)) throw new HttpError(400, 'coordinates must be 2..20000 [lon, lat] pairs');
        const corridor = typeof body.corridorM === 'number' && body.corridorM > 0 && body.corridorM <= 500 ? body.corridorM : undefined;
        const risk = service.routeRisk(coords as LngLat[], corridor);
        return send(res, 200, { ...risk, hits: risk.hits.map((h) => ({ hazardId: h.hazard.id, type: h.hazard.type, alongM: Math.round(h.alongM), offsetM: Math.round(h.offsetM), risk: h.risk })) });
      }
      throw new HttpError(404, 'not found');
    } catch (e) {
      if (e instanceof HttpError) return send(res, e.status, { error: e.message, ...(e.details ? { details: e.details } : {}) });
      console.error(e);
      return send(res, 500, { error: 'internal error' });
    } finally {
      if (process.env.WAYLIX_LOG_REQUESTS === '1') console.log(`${req.method} ${req.url} ${res.statusCode} ${Date.now() - started}ms`);
    }
  });
}

function parseHazardQuery(sp: URLSearchParams) {
  const q: { bbox?: BBox; since?: number; domain?: Domain; types?: string[]; minConfidence?: number; limit?: number } = {};
  const bbox = sp.get('bbox');
  if (bbox) {
    const p = bbox.split(',').map(Number);
    if (p.length !== 4 || p.some((n) => !Number.isFinite(n)) || p[0]! > p[2]! || p[1]! > p[3]!) throw new HttpError(400, 'bbox must be minLon,minLat,maxLon,maxLat');
    if (p[2]! - p[0]! > 5 || p[3]! - p[1]! > 5) throw new HttpError(400, 'bbox too large (max 5° per side)');
    q.bbox = p as BBox;
  } else {
    throw new HttpError(400, 'bbox is required');
  }
  const since = sp.get('since');
  if (since) {
    const n = Number(since);
    if (!Number.isFinite(n) || n < 0) throw new HttpError(400, 'since must be epoch ms');
    q.since = n;
  }
  const domain = sp.get('domain');
  if (domain) {
    if (!DOMAINS.includes(domain as Domain)) throw new HttpError(400, `domain must be one of ${DOMAINS.join(', ')}`);
    q.domain = domain as Domain;
  }
  const types = sp.get('types');
  if (types) q.types = types.split(',').slice(0, 50);
  const mc = sp.get('minConfidence');
  if (mc) q.minConfidence = Math.max(0, Math.min(1, Number(mc) || 0));
  const limit = sp.get('limit');
  if (limit) q.limit = Math.max(1, Math.min(5000, Number(limit) || 5000));
  return q;
}

async function readJson(req: IncomingMessage, maxBytes: number): Promise<unknown> {
  const ct = req.headers['content-type'] ?? '';
  if (!ct.includes('application/json')) throw new HttpError(415, 'content-type must be application/json');
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > maxBytes) throw new HttpError(413, 'request body too large');
    chunks.push(chunk as Buffer);
  }
  try {
    const v = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
    if (typeof v !== 'object' || v === null) throw new Error();
    return v;
  } catch {
    throw new HttpError(400, 'invalid JSON body');
  }
}

function send(res: ServerResponse, status: number, body: unknown, contentType = 'application/json'): void {
  if (res.headersSent) return;
  if (body === null) {
    res.writeHead(status).end();
    return;
  }
  const s = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': `${contentType}; charset=utf-8`, 'Content-Length': Buffer.byteLength(s) }).end(s);
}

/** Token bucket per key; refills continuously. */
class RateLimiter {
  private readonly buckets = new Map<string, { tokens: number; at: number }>();
  constructor(private readonly perMin: number) {}
  take(key: string): boolean {
    const now = Date.now();
    const b = this.buckets.get(key) ?? { tokens: this.perMin, at: now };
    b.tokens = Math.min(this.perMin, b.tokens + ((now - b.at) / 60_000) * this.perMin);
    b.at = now;
    if (b.tokens < 1) {
      this.buckets.set(key, b);
      return false;
    }
    b.tokens -= 1;
    this.buckets.set(key, b);
    if (this.buckets.size > 50_000) for (const [k, v] of this.buckets) if (now - v.at > 120_000) this.buckets.delete(k);
    return true;
  }
}
