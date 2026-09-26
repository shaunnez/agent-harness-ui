// Holds back the other runs of a question until the first has put their shared prompt in the
// provider's cache.
//
// Every run of a question opens with the same system prompt, tool definitions and objective. The
// provider caches a prompt it has read, and a cached input token costs a small fraction of a fresh
// one (DeepInfra: $0.006 against $0.20 a million), but only once that first read has happened:
// five runs that start together each pay to read the whole prompt. So the first run to ask with a
// given opening goes ahead, and the rest wait until its call starts answering, which is when the
// provider has read the prompt, or until `maxWaitMs`, whichever comes first. A failed call releases
// them too. Only a run's first call waits; later calls extend the run's own prompt.

import { createHash } from "node:crypto";

const DEFAULT_MAX_WAIT_MS = 45_000;
/** How long an opening counts as warm. Providers keep a prompt cached for minutes, not hours. */
const DEFAULT_WARM_MS = 10 * 60_000;

export class PrefixWarmer {
  #openings = new Map();
  #maxWaitMs;
  #warmMs;
  #now;

  constructor({ maxWaitMs = DEFAULT_MAX_WAIT_MS, warmMs = DEFAULT_WARM_MS, now = () => Date.now() } = {}) {
    this.#maxWaitMs = maxWaitMs;
    this.#warmMs = warmMs;
    this.#now = now;
  }

  /**
   * Call before a run's first model call. Resolves to `release()`, which the first run with this
   * opening must call once its call has started answering (or failed); for every later run it
   * does nothing. `signal` stops a wait early.
   */
  async enter(key, { signal = null } = {}) {
    this.#forgetCold();
    const opening = this.#openings.get(key);
    if (!opening) {
      let release;
      const warm = new Promise((resolve) => {
        release = resolve;
      });
      this.#openings.set(key, { warm, at: this.#now() });
      return () => release();
    }
    let timer;
    let onAbort;
    await Promise.race([
      opening.warm,
      new Promise((resolve) => {
        timer = setTimeout(resolve, this.#maxWaitMs);
      }),
      new Promise((resolve) => {
        onAbort = resolve;
        signal?.addEventListener("abort", onAbort, { once: true });
      }),
    ]);
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
    return () => {};
  }

  #forgetCold() {
    const cutoff = this.#now() - this.#warmMs;
    for (const [key, opening] of this.#openings) if (opening.at < cutoff) this.#openings.delete(key);
  }
}

/** The opening a run's first call sends: provider, model, the first messages and the tools. */
export function openingKey({ endpoint, model, messages, tools }) {
  return createHash("sha256")
    .update(JSON.stringify([endpoint, model, messages, tools ?? null]))
    .digest("hex");
}
