import assert from "node:assert/strict";
import test from "node:test";
import { formatApproximateCost } from "../src/frontier/runtime/presentation.ts";

test("formats a zero approximate cost when the estimate and pricing metadata are present", () => {
  assert.equal(formatApproximateCost(0, "card-1"), "$0.0000");
});

test("formats a positive approximate cost to four decimal places", () => {
  assert.equal(formatApproximateCost(0.123456, "card-1"), "$0.1235");
});

test("does not present an approximate cost without an authoritative estimate", () => {
  assert.equal(formatApproximateCost(null, "card-1"), "—");
  assert.equal(formatApproximateCost(undefined, "card-1"), "—");
});

test("does not present an approximate cost without pricing metadata", () => {
  assert.equal(formatApproximateCost(0.12, null), "—");
  assert.equal(formatApproximateCost(0.12, undefined), "—");
  assert.equal(formatApproximateCost(0.12, ""), "—");
});
