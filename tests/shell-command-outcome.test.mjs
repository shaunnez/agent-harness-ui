import assert from "node:assert/strict";
import test from "node:test";
import { commandExitCode, isExpectedReadOnlySearchMiss } from "../server/shell-command-outcome.mjs";

test("treats a read-only rg or grep exit 1 as an expected no-match result", () => {
  assert.equal(isExpectedReadOnlySearchMiss("git show HEAD:file | nl -ba | rg readiness", 1), true);
  assert.equal(isExpectedReadOnlySearchMiss(["grep", "missing", "file.txt"], 1), true);
  assert.equal(isExpectedReadOnlySearchMiss("rg readiness", 2), false);
});

test("never launders a failed verification command through search-miss handling", () => {
  assert.equal(isExpectedReadOnlySearchMiss("npm test | rg failed", 1), false);
  assert.equal(isExpectedReadOnlySearchMiss("make backend-quality && rg readiness", 1), false);
  assert.equal(isExpectedReadOnlySearchMiss("python -m pytest | grep failed", 1), false);
});

test("extracts provider-reported command exit codes", () => {
  assert.equal(commandExitCode("Exit code 1\nNo matches"), 1);
  assert.equal(commandExitCode("Process exited with code 2"), 2);
  assert.equal(commandExitCode("Permission denied"), null);
});
