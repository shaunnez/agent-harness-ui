import test from "node:test";
import assert from "node:assert/strict";
import {
  candidateGateCommandInstruction,
  candidateGateCommandLimit,
  CANDIDATE_GATE_COMMAND_LIMITS,
} from "../server/candidate-gate-policy.mjs";

test("Development Review keeps a materially higher command ceiling than Test and Final Review", () => {
  assert.equal(candidateGateCommandLimit("dev-review"), 14);
  assert.equal(candidateGateCommandLimit("test"), 6);
  assert.equal(candidateGateCommandLimit("final-review"), 6);
  assert.equal(candidateGateCommandLimit("implement"), null);
  assert.deepEqual(CANDIDATE_GATE_COMMAND_LIMITS, {
    "dev-review": 14,
    test: 6,
    "final-review": 6,
  });
});

test("the reviewer instruction names the exact per-stage ceiling and is empty outside the candidate gates", () => {
  assert.match(
    candidateGateCommandInstruction("dev-review"),
    /hard limit of 14 repository-command invocations/,
  );
  assert.match(candidateGateCommandInstruction("dev-review"), /Never start command 15/);
  for (const stage of ["test", "final-review"]) {
    assert.match(candidateGateCommandInstruction(stage), /hard limit of 6 repository-command invocations/);
    assert.match(candidateGateCommandInstruction(stage), /Never start command 7/);
  }
  assert.equal(candidateGateCommandInstruction("implement"), "");
});

// The instruction tells the reviewer to plan within `limit - 2` and reserve 2 for follow-up.
// At the old `test: 2` ceiling that arithmetic asked for 3 commands against a hard stop of 2,
// so the gate could not both follow its instruction and stay inside its budget.
test("every gate ceiling leaves a real planning allowance after the two reserved commands", () => {
  for (const [stage, limit] of Object.entries(CANDIDATE_GATE_COMMAND_LIMITS)) {
    assert.ok(limit > 2, `${stage} must leave commands for planning beyond the 2 reserved follow-ups`);
    const planningAllowance = limit - 2;
    assert.match(
      candidateGateCommandInstruction(stage),
      new RegExp(`plan the complete inspection within ${planningAllowance} commands`),
    );
  }
});
