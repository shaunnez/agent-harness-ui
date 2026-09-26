// Tool answers shared across runs: web searches, captured pages and PlanCheck rate-library reads.
//
// A question's five runs mostly search for the same things and read the same pages, and every
// question of a batch reads the same QV sections. Without this each run pays Parallel and waits on
// the fetch again. With it the first run to ask pays, and the rest are answered from here for a
// day (Shaun, 26 September: "1,2,4,5,6,7 al good go and do it").
//
// What is shared is only what a provider returned. Everything a run does with it still happens in
// that run: its URL policy check, its capture ceiling, the snapshot it retains and cites, the QV
// rows it was shown. So citation checks are unchanged, and a cached answer says so in its metadata.
//
// Failures are never cached: a page that timed out is fetched again by the next run that asks.
// Values are stored as JSON, in memory and in Postgres alike, so a reader can never change what the
// next run is given.

import { createHash } from "node:crypto";

export const DEFAULT_TOOL_CACHE_TTL_MS = 24 * 60 * 60_000;
const DEFAULT_MEMORY_ENTRIES = 2_000;

/** A cache store: `read(kind, key)` → `{json, storedAt}` or null, `write(kind, key, json, storedAt)`. */
export class MemoryToolCacheStore {
  #entries = new Map();
  #max;

  constructor({ maxEntries = DEFAULT_MEMORY_ENTRIES } = {}) {
    this.#max = Math.max(1, Number(maxEntries) || DEFAULT_MEMORY_ENTRIES);
  }

  async read(kind, key) {
    const id = `${kind}\n${key}`;
    const entry = this.#entries.get(id);
    if (!entry) return null;
    // Least recently used goes first: a read moves the entry to the back.
    this.#entries.delete(id);
    this.#entries.set(id, entry);
    return entry;
  }

  async write(kind, key, json, storedAt) {
    const id = `${kind}\n${key}`;
    this.#entries.delete(id);
    this.#entries.set(id, { json, storedAt });
    while (this.#entries.size > this.#max) this.#entries.delete(this.#entries.keys().next().value);
  }
}

export class ToolCache {
  #store;
  #ttlMs;
  #now;
  #pending = new Map();
  #counts = { hits: 0, misses: 0, shared: 0 };

  constructor({
    store = new MemoryToolCacheStore(),
    ttlMs = DEFAULT_TOOL_CACHE_TTL_MS,
    now = () => Date.now(),
  } = {}) {
    this.#store = store;
    this.#ttlMs = Math.max(0, Number(ttlMs) || 0);
    this.#now = now;
  }

  /**
   * `compute()`'s answer for `(kind, key)`, from the cache when a fresh one is there. Two runs that
   * ask at once share one `compute()`. Returns `{value, hit, storedAt}`; `storedAt` is when the
   * answer was fetched, which is what a cached answer reports.
   */
  async remember(kind, key, compute) {
    const hashed = digest(key);
    const id = `${kind}\n${hashed}`;
    let work = this.#pending.get(id);
    const shared = Boolean(work);
    if (shared) this.#counts.shared += 1;
    else {
      work = this.#resolve(kind, hashed, compute).finally(() => this.#pending.delete(id));
      this.#pending.set(id, work);
    }
    let answer;
    try {
      answer = await work;
    } catch (error) {
      // The run that was fetching failed, perhaps because it was cancelled or ran out of time.
      // That is its failure, not this run's: fetch again, as this run's own call.
      if (!shared) throw error;
      answer = await this.#resolve(kind, hashed, compute);
    }
    // Each caller parses its own copy, so no run can change what another is given.
    return { value: JSON.parse(answer.json), hit: answer.hit || shared, storedAt: answer.storedAt };
  }

  /** Hits, misses and answers shared with a run already fetching them, since this process started. */
  stats() {
    return { ...this.#counts };
  }

  async #resolve(kind, key, compute) {
    if (this.#ttlMs > 0) {
      const cached = await this.#store.read(kind, key).catch(() => null);
      const age = cached ? this.#now() - Date.parse(cached.storedAt) : Number.POSITIVE_INFINITY;
      if (cached && age >= 0 && age < this.#ttlMs) {
        this.#counts.hits += 1;
        return { json: cached.json, hit: true, storedAt: cached.storedAt };
      }
    }
    this.#counts.misses += 1;
    const json = JSON.stringify((await compute()) ?? null);
    const storedAt = new Date(this.#now()).toISOString();
    // A store that cannot write (the database is away) costs the next run a fetch, nothing more.
    if (this.#ttlMs > 0) await this.#store.write(kind, key, json, storedAt).catch(() => undefined);
    return { json, hit: false, storedAt };
  }
}

/** The key as stored: a hash, so a long URL or query never becomes a long primary key. */
function digest(key) {
  return createHash("sha256").update(String(key)).digest("hex");
}

/** How a search query is keyed: case and runs of spaces do not change what a search engine finds. */
export function searchCacheKey(query, market) {
  return `${String(market ?? "").toUpperCase()}\n${String(query).trim().replace(/\s+/g, " ").toLowerCase()}`;
}
