// The shared pacing state on Postgres (`../engine/pacer-sync.mjs`): one row for the account-wide
// limit and hold, one per worker for who is still running.

/** A worker not heard from in this long no longer counts toward the division. */
const WORKER_STALE_MS = 15_000;

export class PgPacerStore {
  #db;
  #key;

  /** `key` names the limit being shared: one per provider account. */
  constructor(db, { key = "default" } = {}) {
    if (!db) throw new Error("PgPacerStore requires a database handle.");
    this.#db = db;
    this.#key = key;
  }

  async exchange({ workerId, now, successes, throttles, cooldownUntil, initial, min, max, successesToGrow }) {
    return this.#db.transaction(async (tx) => {
      await tx.query(
        `INSERT INTO research_pacer(key, lim, successes, cooldown_until, halved_until)
         VALUES ($1, $2, 0, 0, 0) ON CONFLICT (key) DO NOTHING`,
        [this.#key, clamp(initial, min, max)],
      );
      const { rows } = await tx.query("SELECT * FROM research_pacer WHERE key = $1 FOR UPDATE", [this.#key]);
      const state = rows[0];
      let limit = Number(state.lim);
      let count = Number(state.successes);
      let hold = Number(state.cooldown_until);
      let halvedUntil = Number(state.halved_until);
      if (throttles > 0) {
        count = 0;
        hold = Math.max(hold, Number(cooldownUntil) || 0);
        // Throttles reported by several workers for one burst halve the limit once, not per worker.
        if (now >= halvedUntil) {
          limit = Math.floor(limit / 2);
          halvedUntil = Math.max(hold, now + 1_000);
        }
      } else {
        count += successes;
        while (count >= successesToGrow) {
          count -= successesToGrow;
          limit += 1;
        }
      }
      limit = clamp(limit, min, max);
      await tx.query(
        `UPDATE research_pacer SET lim = $2, successes = $3, cooldown_until = $4, halved_until = $5 WHERE key = $1`,
        [this.#key, limit, count, hold, halvedUntil],
      );
      await tx.query(
        `INSERT INTO research_pacer_workers(key, worker_id, seen_at) VALUES ($1, $2, $3)
         ON CONFLICT (key, worker_id) DO UPDATE SET seen_at = excluded.seen_at`,
        [this.#key, workerId, now],
      );
      await tx.query("DELETE FROM research_pacer_workers WHERE key = $1 AND seen_at < $2", [
        this.#key,
        now - WORKER_STALE_MS,
      ]);
      const { rows: live } = await tx.query(
        "SELECT COUNT(*) AS workers FROM research_pacer_workers WHERE key = $1",
        [this.#key],
      );
      return { limit, cooldownUntil: hold, workers: Math.max(1, Number(live[0].workers)) };
    });
  }

  /** A worker that stops cleanly gives its share back at once. */
  async leave(workerId) {
    await this.#db.query("DELETE FROM research_pacer_workers WHERE key = $1 AND worker_id = $2", [
      this.#key,
      workerId,
    ]);
  }
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Math.floor(Number(value) || min)));
}
