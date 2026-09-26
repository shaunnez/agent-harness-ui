import { providerFailure } from "./research-provider-errors.mjs";

export class ProviderCreditLedger {
  #provider;
  #ceiling;
  #committed = 0;
  #active = new Map();
  #attempts = [];
  #closed = false;
  #contractViolation = false;
  #sequence = 0;

  constructor({ provider, ceiling }) {
    if (!provider || !Number.isInteger(ceiling) || ceiling < 1)
      throw new Error("A provider ledger needs a positive integer ceiling.");
    this.#provider = provider;
    this.#ceiling = ceiling;
  }

  reserve(operation, upperBound, { now = new Date().toISOString() } = {}) {
    if (this.#closed || this.#contractViolation)
      throw providerFailure({ provider: this.#provider, operation, category: "budget_exhausted" });
    if (!Number.isInteger(upperBound) || upperBound < 1)
      throw new Error("A reservation must be a positive integer.");
    const active = [...this.#active.values()].reduce((sum, entry) => sum + entry.upperBound, 0);
    if (this.#committed + active + upperBound > this.#ceiling)
      throw providerFailure({ provider: this.#provider, operation, category: "budget_exhausted" });
    const id = `${this.#provider}-${++this.#sequence}`;
    this.#active.set(id, { id, operation, upperBound, startedAt: now });
    return id;
  }

  settle(
    id,
    {
      reportedCharge = null,
      provablyUnsent = false,
      estimate = null,
      certainty = null,
      now = new Date().toISOString(),
    } = {},
  ) {
    const reservation = this.#active.get(id);
    if (!reservation) throw new Error(`Unknown active ${this.#provider} reservation ${id}.`);
    this.#active.delete(id);
    const charge = provablyUnsent
      ? 0
      : Number.isFinite(reportedCharge) && reportedCharge >= 0
        ? Number(reportedCharge)
        : reservation.upperBound;
    this.#committed += charge;
    if (charge > reservation.upperBound) this.#contractViolation = true;
    const attempt = Object.freeze({
      ...reservation,
      finishedAt: now,
      reserved: reservation.upperBound,
      charge,
      estimate: Number.isFinite(estimate) && estimate >= 0 ? Number(estimate) : null,
      certainty: provablyUnsent
        ? "not_sent"
        : (certainty ?? (reportedCharge == null ? "upper_bound" : "reported")),
      contractViolation: charge > reservation.upperBound,
    });
    this.#attempts.push(attempt);
    return attempt;
  }

  close({ now = new Date().toISOString() } = {}) {
    for (const id of [...this.#active.keys()])
      this.settle(id, { certainty: "unknown_after_termination", now });
    this.#closed = true;
    return this.snapshot();
  }

  snapshot() {
    return Object.freeze({
      provider: this.#provider,
      ceiling: this.#ceiling,
      committedUpperBound: this.#committed,
      activeReservations: [...this.#active.values()].reduce((sum, entry) => sum + entry.upperBound, 0),
      contractViolation: this.#contractViolation,
      attempts: [...this.#attempts],
    });
  }
}
