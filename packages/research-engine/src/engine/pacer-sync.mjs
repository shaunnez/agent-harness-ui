// One pacing decision across every worker of the research service.
//
// Each worker's `AdaptivePacer` learns from its own calls, but the provider has one limit for the
// account. Two workers that each learned "six at once" send twelve. So every couple of seconds
// each worker reports what it saw (calls that went through, throttles, the hold a 429 asked for)
// and takes back its share: the account-wide limit, learned by the same rule (grow by one after
// `successesToGrow` clean calls across all workers, halve on a throttle, at most once per hold),
// divided among the workers seen recently. A 429 anywhere holds every worker until its
// `Retry-After`. One worker alone gets the whole limit, as before.
//
// The store (`pg/pacer-store.mjs`) does the arithmetic in one transaction, so reports that arrive
// together are applied one after another.

import { randomUUID } from "node:crypto";

const DEFAULT_INTERVAL_MS = 2_000;

export class PacerSync {
  #pacer;
  #store;
  #workerId;
  #intervalMs;
  #now;
  #timer = null;
  #running = null;
  #last = null;

  constructor({
    pacer,
    store,
    workerId = randomUUID(),
    intervalMs = DEFAULT_INTERVAL_MS,
    now = () => Date.now(),
  }) {
    if (!pacer || !store) throw new Error("PacerSync needs a pacer and a store.");
    this.#pacer = pacer;
    this.#store = store;
    this.#workerId = workerId;
    this.#intervalMs = intervalMs;
    this.#now = now;
  }

  /** What the last exchange returned: the account-wide limit, this worker's share, workers seen. */
  snapshot() {
    return this.#last ? { ...this.#last } : null;
  }

  /** Reports this worker's calls and takes its share. A store that is away leaves the pacer on its
   *  own learning, which is what it did before any sharing. */
  async sync() {
    const report = this.#pacer.drain();
    try {
      const shared = await this.#store.exchange({
        workerId: this.#workerId,
        now: this.#now(),
        successes: report.successes,
        throttles: report.throttles,
        cooldownUntil: report.cooldownUntil,
        initial: this.#pacer.limit,
        ...this.#pacer.settings,
      });
      const share = Math.max(
        this.#pacer.settings.min,
        Math.floor(shared.limit / Math.max(1, shared.workers)),
      );
      this.#pacer.adopt({ limit: share, cooldownUntil: shared.cooldownUntil });
      this.#last = {
        limit: shared.limit,
        share,
        workers: shared.workers,
        cooldownUntil: shared.cooldownUntil,
      };
    } catch {
      // The calls go unreported; the next exchange counts from there.
    }
    return this.snapshot();
  }

  start() {
    const loop = async () => {
      this.#running = this.sync();
      await this.#running;
      this.#running = null;
      if (this.#timer !== null) this.#timer = setTimeout(loop, this.#intervalMs);
    };
    this.#timer = setTimeout(loop, 0);
  }

  async stop() {
    const timer = this.#timer;
    this.#timer = null;
    clearTimeout(timer);
    await this.#running;
    await this.#store.leave?.(this.#workerId).catch(() => undefined);
  }
}
