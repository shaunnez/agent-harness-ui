import test from "node:test";
import assert from "node:assert/strict";
import {
  candidateGateCommandInstruction,
  candidateGateCommandLimit,
  CANDIDATE_GATE_COMMAND_LIMITS,
} from "../server/candidate-gate-policy.mjs";

test("Development Review keeps a materially higher command ceiling than Test and Final Review", () => {
  assert.equal(candidateGateCommandLimit("dev-review"), 10);
  assert.equal(candidateGateCommandLimit("test"), 2);
  assert.equal(candidateGateCommandLimit("final-review"), 2);
  assert.equal(candidateGateCommandLimit("implement"), null);
  assert.deepEqual(CANDIDATE_GATE_COMMAND_LIMITS, {
    "dev-review": 10,
    test: 2,
    "final-review": 2,
  });
});

test("the reviewer instruction names the exact per-stage ceiling and is empty outside the candidate gates", () => {
  assert.match(candidateGateCommandInstruction("dev-review"), /Use at most 10 targeted repository commands/);
  assert.match(candidateGateCommandInstruction("test"), /Use at most 2 targeted repository commands/);
  assert.match(candidateGateCommandInstruction("final-review"), /Use at most 2 targeted repository commands/);
  assert.equal(candidateGateCommandInstruction("implement"), "");
});
