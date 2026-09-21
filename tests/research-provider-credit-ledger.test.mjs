import assert from "node:assert/strict";
import test from "node:test";
import { ProviderCreditLedger } from "../server/research/provider-credit-ledger.mjs";

test("parallel reservations cannot exceed the dispatch ceiling", () => {
  const ledger = new ProviderCreditLedger({ provider: "firecrawl", ceiling: 10 });
  const first = ledger.reserve("capture", 6);
  assert.throws(
    () => ledger.reserve("capture", 5),
    (error) => error.category === "budget_exhausted",
  );
  ledger.settle(first, { reportedCharge: 3 });
  assert.doesNotThrow(() => ledger.reserve("search", 2));
});

test("unknown charges retain the full reservation and close settles active work conservatively", () => {
  const ledger = new ProviderCreditLedger({ provider: "firecrawl", ceiling: 10 });
  const first = ledger.reserve("search", 2);
  ledger.settle(first);
  ledger.reserve("capture", 5);
  const closed = ledger.close();
  assert.equal(closed.committedUpperBound, 7);
  assert.equal(closed.activeReservations, 0);
  assert.equal(closed.attempts[0].certainty, "upper_bound");
  assert.equal(closed.attempts[1].certainty, "unknown_after_termination");
});

test("a provider report above the reservation is recorded and stops later paid calls", () => {
  const ledger = new ProviderCreditLedger({ provider: "firecrawl", ceiling: 20 });
  const reservation = ledger.reserve("search", 2);
  const attempt = ledger.settle(reservation, { reportedCharge: 3 });
  assert.equal(attempt.contractViolation, true);
  assert.equal(ledger.snapshot().committedUpperBound, 3);
  assert.throws(
    () => ledger.reserve("search", 2),
    (error) => error.category === "budget_exhausted",
  );
});
