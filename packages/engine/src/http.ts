/** Minimal fetch shape so the engine has no DOM/Node type dependency. */
export interface FetchResponseLike {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}

export type FetchLike = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: unknown },
) => Promise<FetchResponseLike>;

export function defaultFetch(): FetchLike {
  const f = (globalThis as { fetch?: FetchLike }).fetch;
  if (!f) throw new Error('No global fetch available; pass one explicitly');
  return f.bind(globalThis) as FetchLike;
}

/** Simple async key-value store (AsyncStorage, MMKV, SQLite, a Map...). */
export interface KeyValueStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove?(key: string): Promise<void>;
}

export class MemoryStore implements KeyValueStore {
  private readonly m = new Map<string, string>();
  async get(k: string): Promise<string | null> {
    return this.m.get(k) ?? null;
  }
  async set(k: string, v: string): Promise<void> {
    this.m.set(k, v);
  }
  async remove(k: string): Promise<void> {
    this.m.delete(k);
  }
}
