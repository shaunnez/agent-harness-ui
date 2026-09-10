import os from "node:os";
import process from "node:process";

/**
 * A process-local ceiling on how many verification manifests execute at once.
 *
 * Harness verification spawns a repository's real commands, and a repository's test
 * command is usually itself parallel — `node --test` alone forks one process per file up
 * to `availableParallelism()`. So N concurrent manifests is not N processes, it is N
 * fan-outs, and the machine is oversubscribed by a factor the harness never chose.
 *
 * That is not only slow. Load-sensitive suites start failing, and the harness reads a
 * failure it caused as a defect in the candidate — which sends the task back for repair,
 * which spends another manifest execution, which adds more load. Four tasks were stuck in
 * that loop before this existed.
 *
 * Measured on a 10-core machine against this repository's own manifest:
 *
 * | concurrent runs | each run | throughput   |
 * |-----------------|----------|--------------|
 * | 1               | 22s      | 0.045 runs/s |
 * | 4               | 62s      | 0.065 runs/s |
 * | 8               | 148s     | 0.054 runs/s |
 *
 * Throughput peaks near half the core count and falls off after it, so the default is a
 * throughput choice as much as a stability one. Serializing would be worse than the
 * status quo; the ceiling is deliberately a ceiling, not a queue of one.
 *
 * The runtime lock already guarantees a single harness process owns the store, so a
 * process-local semaphore is the whole population. Waiters are released in arrival order.
 */

function configuredLimit() {
  const raw = process.env.AGENT_HARNESS_VERIFICATION_CONCURRENCY;
  if (raw != null && raw !== "") {
    const parsed = Number(raw);
    if (!Number.isInteger(parsed) || parsed < 1) {
      throw new Error(
        `AGENT_HARNESS_VERIFICATION_CONCURRENCY must be a positive integer, received ${JSON.stringify(raw)}.`,
      );
    }
    return parsed;
  }
  const cores = os.availableParallelism?.() ?? os.cpus().length ?? 1;
  return Math.max(1, Math.ceil(cores / 2));
}

export class VerificationSlots {
  #limit;
  #active = 0;
  #waiters = [];

  constructor(limit) {
    this.#limit = limit;
  }

  get limit() {
    return this.#limit;
  }

  get active() {
    return this.#active;
  }

  get waiting() {
    return this.#waiters.length;
  }

  /**
   * Take a slot, waiting in arrival order when the ceiling is reached.
   *
   * `onWait` is called once, only when the caller actually has to queue, with the reason
   * it is queued. A stage that waits several minutes with nothing recorded is
   * indistinguishable from a hung one, and that ambiguity is the thing the harness is
   * meant not to produce.
   */
  async acquire({ signal = null, onWait = null } = {}) {
    if (signal?.aborted) throw signal.reason ?? new Error("Verification was cancelled.");
    if (this.#tryTake()) return this.#release();
    await onWait?.({ limit: this.#limit, active: this.#active, position: this.#waiters.length + 1 });
    // `onWait` is awaited because it normally persists an event, so a slot may have opened
    // while it ran. Only queue behind waiters that were already there.
    if (this.#waiters.length === 0 && this.#tryTake()) return this.#release();

    const waiter = { resolve: null, reject: null, onAbort: null };
    const queued = new Promise((resolve, reject) => {
      waiter.resolve = resolve;
      waiter.reject = reject;
    });
    if (signal) {
      waiter.onAbort = () => {
        const index = this.#waiters.indexOf(waiter);
        if (index >= 0) this.#waiters.splice(index, 1);
        waiter.reject(signal.reason ?? new Error("Verification was cancelled."));
      };
      signal.addEventListener("abort", waiter.onAbort, { once: true });
    }
    this.#waiters.push(waiter);
    try {
      // `#next` takes the slot on this waiter's behalf before resolving, so no other
      // caller can win it in the gap between the resolve and this resumption.
      await queued;
    } finally {
      if (waiter.onAbort) signal.removeEventListener("abort", waiter.onAbort);
    }
    return this.#release();
  }

  #tryTake() {
    if (this.#active >= this.#limit) return false;
    this.#active += 1;
    return true;
  }

  #release() {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.#active -= 1;
      this.#next();
    };
  }

  #next() {
    if (this.#waiters.length === 0) return;
    if (!this.#tryTake()) return;
    this.#waiters.shift().resolve();
  }
}

let shared = null;

/** The process-wide slots. Lazily built so the env var is read after startup config. */
export function verificationSlots() {
  shared ??= new VerificationSlots(configuredLimit());
  return shared;
}

/** Test seam: drop the shared instance so a new limit takes effect. */
export function resetVerificationSlots() {
  shared = null;
}

export async function acquireVerificationSlot(options) {
  return verificationSlots().acquire(options);
}
