import assert from "node:assert/strict";
import test from "node:test";
import {
  CANDIDATE_GATE_COMMAND_LIMITS,
  candidateGateCommandInstruction,
  candidateGateCommandLimit,
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
  assert.match(
    candidateGateCommandInstruction("dev-review"),
    /hard limit of 10 repository-command invocations/,
  );
  assert.match(candidateGateCommandInstruction("dev-review"), /Never start command 11/);
  for (const stage of ["test", "final-review"]) {
    assert.match(candidateGateCommandInstruction(stage), /hard limit of 2 repository-command invocations/);
    assert.match(candidateGateCommandInstruction(stage), /Never start command 3/);
  }
  assert.equal(candidateGateCommandInstruction("implement"), "");
});
