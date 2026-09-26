// The tool cache's store on Postgres (`../engine/tool-cache.mjs`), so every worker of the research
// service shares one set of searches, pages and QV reads, and a restart keeps them.

import { DEFAULT_TOOL_CACHE_TTL_MS } from "../engine/tool-cache.mjs";

/** How often a write also clears entries older than the cache would ever serve. */
const PRUNE_EVERY_WRITES = 200;

export class PgToolCacheStore {
  #db;
  #keepMs;
  #writes = 0;
  #now;

  /** `keepMs` is how long an entry is worth keeping: the cache's own time to live. */
  constructor(db, { keepMs = DEFAULT_TOOL_CACHE_TTL_MS, now = () => Date.now() } = {}) {
    if (!db) throw new Error("PgToolCacheStore requires a database handle.");
    this.#db = db;
    this.#keepMs = keepMs;
    this.#now = now;
  }

  async read(kind, key) {
    const { rows } = await this.#db.query(
      "SELECT value_json, stored_at FROM research_tool_cache WHERE kind = $1 AND key_sha256 = $2",
      [kind, key],
    );
    return rows[0] ? { json: rows[0].value_json, storedAt: rows[0].stored_at } : null;
  }

  async write(kind, key, json, storedAt) {
    await this.#db.query(
      `INSERT INTO research_tool_cache(kind, key_sha256, stored_at, value_json) VALUES ($1, $2, $3, $4)
       ON CONFLICT (kind, key_sha256) DO UPDATE SET stored_at = excluded.stored_at, value_json = excluded.value_json`,
      [kind, key, storedAt, json],
    );
    this.#writes += 1;
    if (this.#writes % PRUNE_EVERY_WRITES === 0) await this.prune();
  }

  /** Deletes entries past their time to live; returns how many. */
  async prune() {
    const cutoff = new Date(this.#now() - this.#keepMs).toISOString();
    const result = await this.#db.query("DELETE FROM research_tool_cache WHERE stored_at < $1", [cutoff]);
    return Number(result.rowCount ?? 0);
  }
}
