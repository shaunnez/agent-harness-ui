// How many research runs may call the model at once, learned from the provider rather than fixed.
//
// Fireworks' serverless limits adapt to an account's traffic: a new account starts at about 45k
// generated tokens a minute, and a burst above what it has seen answers 429 even under the
// ceiling. So the research service starts a few runs, adds one each time a run of calls goes
// through untroubled, and halves when the provider throttles (additive increase, multiplicative
// decrease). A 429 also holds every run's next call until its `Retry-After`, so one throttled run
// does not leave the others to hit the same wall.
//
// The harness does not use this: its runtime keeps a fixed cap. Nothing here stores anything;
// a restart starts from `initial` again. With more than one worker, `pacer-sync.mjs` shares what
// each has learned through Postgres, so together they stay under the provider's one limit.

const DEFAULT_SUCCESSES_TO_GROW = 20;
const DEFAULT_COOLDOWN_MS = 5_000;

export class AdaptivePacer {
  #min;
  #max;
  #limit;
  #successesToGrow;
  #successes = 0;
  #cooldownUntil = 0;
  #now;
  #listeners = new Set();
  #defaultCooldownMs;
  #throttles = 0;
  // Since the last `drain()`, for `pacer-sync.mjs`.
  #pending = { successes: 0, throttles: 0 };

  constructor({
    min = 1,
    max = 12,
    initial = null,
    successesToGrow = DEFAULT_SUCCESSES_TO_GROW,
    defaultCooldownMs = DEFAULT_COOLDOWN_MS,
    now = () => Date.now(),
  } = {}) {
    this.#min = Math.max(1, Math.floor(Number(min) || 1));
    this.#max = Math.max(this.#min, Math.floor(Number(max) || this.#min));
    this.#limit = clamp(Math.floor(Number(initial ?? this.#min) || this.#min), this.#min, this.#max);
    this.#successesToGrow = Math.max(1, Math.floor(Number(successesToGrow) || DEFAULT_SUCCESSES_TO_GROW));
    this.#defaultCooldownMs = Math.max(0, Number(defaultCooldownMs) || 0);
    this.#now = now;
  }

  /** Runs allowed to be active now. */
  get limit() {
    return this.#limit;
  }

  /** What the pacer has learned, for the service's status route and logs. */
  snapshot() {
    const now = this.#now();
    return {
      limit: this.#limit,
      min: this.#min,
      max: this.#max,
      throttles: this.#throttles,
      coolingDownMs: Math.max(0, this.#cooldownUntil - now),
    };
  }

  /** Called whenever `limit` changes, so a runtime waiting on a slot can start the next run. */
  onChange(listener) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** Milliseconds to wait before the next model call, zero when none. */
  delayMs() {
    return Math.max(0, this.#cooldownUntil - this.#now());
  }

  /** The pacer's bounds and growth step, for a sync that works on the same terms. */
  get settings() {
    return { min: this.#min, max: this.#max, successesToGrow: this.#successesToGrow };
  }

  /** Successes, throttles and the hold seen since the last drain; the counts start again. */
  drain() {
    const drained = { ...this.#pending, cooldownUntil: this.#cooldownUntil };
    this.#pending = { successes: 0, throttles: 0 };
    return drained;
  }

  /** Takes a limit and hold decided across workers (`pacer-sync.mjs`) in place of this one's. */
  adopt({ limit, cooldownUntil = 0 }) {
    this.#cooldownUntil = Math.max(this.#cooldownUntil, Number(cooldownUntil) || 0);
    if (Number.isFinite(limit)) this.#set(Math.floor(limit));
  }

  /** A model call went through. */
  succeeded() {
    this.#pending.successes += 1;
    this.#successes += 1;
    if (this.#successes < this.#successesToGrow) return;
    this.#successes = 0;
    this.#set(this.#limit + 1);
  }

  /** The provider throttled a call. `retryAfterMs` is its `Retry-After`, when it sent one. */
  throttled(retryAfterMs = null) {
    this.#pending.throttles += 1;
    this.#throttles += 1;
    this.#successes = 0;
    const wait = Number(retryAfterMs) > 0 ? Number(retryAfterMs) : this.#defaultCooldownMs;
    this.#cooldownUntil = Math.max(this.#cooldownUntil, this.#now() + wait);
    this.#set(Math.floor(this.#limit / 2));
  }

  #set(value) {
    const next = clamp(value, this.#min, this.#max);
    if (next === this.#limit) return;
    this.#limit = next;
    for (const listener of this.#listeners) listener(next);
  }
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
