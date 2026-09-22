// One provider ledger for the whole pilot session (plan §7, Q3).
//
// `ResearchWebTools.close()` closes every ledger it was handed, which is correct for a single
// run and wrong for a session of four: case two would meet an exhausted ledger. A lease gives
// each case a ledger-shaped object that reserves and settles against the shared ledger and,
// when the case closes it, settles only that case's own outstanding reservations. Nothing a
// child or a case can do reopens, resets or widens the session ceiling.

import { ProviderCreditLedger } from "../../server/research/provider-credit-ledger.mjs";

export class PilotSessionLedger {
  #ledger;
  #provider;
  #leases = 0;

  constructor({ provider, ceiling }) {
    this.#ledger = new ProviderCreditLedger({ provider, ceiling });
    this.#provider = provider;
  }

  get provider() {
    return this.#provider;
  }

  /** A per-case view. Never hands out the shared ledger itself. */
  lease(label) {
    const shared = this.#ledger;
    const owned = new Set();
    const id = `${this.#provider}-lease-${++this.#leases}${label ? `-${label}` : ""}`;
    let closed = false;
    return {
      leaseId: id,
      reserve(operation, upperBound, options) {
        if (closed) throw new Error(`Provider lease ${id} is closed.`);
        const reservationId = shared.reserve(operation, upperBound, options);
        owned.add(reservationId);
        return reservationId;
      },
      settle(reservationId, options) {
        owned.delete(reservationId);
        return shared.settle(reservationId, options);
      },
      close(options) {
        if (!closed) {
          closed = true;
          for (const reservationId of [...owned]) {
            owned.delete(reservationId);
            shared.settle(reservationId, { certainty: "unknown_after_termination", ...(options ?? {}) });
          }
        }
        return shared.snapshot();
      },
      snapshot() {
        return shared.snapshot();
      },
    };
  }

  snapshot() {
    return this.#ledger.snapshot();
  }

  close(options) {
    return this.#ledger.close(options);
  }
}

/** Attempts of one operation recorded so far, so the session can enforce its own totals. */
export function attemptsFor(snapshot, operation) {
  return (snapshot?.attempts ?? []).filter((attempt) => attempt.operation === operation).length;
}

export function ledgerDelta(before, after) {
  return {
    provider: after.provider,
    ceiling: after.ceiling,
    committedUpperBound: after.committedUpperBound,
    caseCommitted: after.committedUpperBound - (before?.committedUpperBound ?? 0),
    attempts: after.attempts.slice(before?.attempts?.length ?? 0),
    contractViolation: after.contractViolation,
  };
}
