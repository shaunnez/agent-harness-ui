import assert from "node:assert/strict";
import test from "node:test";
import { candidateRepairCircuitExhausted, candidateRepairCount } from "../src/workflow-recovery-policy.ts";

test("counts completed no-op repair runs as repair attempts", () => {
  const candidate = {
    id: "C1",
    revisions: [{ reason: "assembly" }, { reason: "repair" }],
  };
  const task = {
    workflowProfile: { selected: "standard" },
    runs: [
      { kind: "repair", status: "completed", candidateId: "C1" },
      { kind: "repair", status: "completed", candidateId: "C1" },
      { kind: "repair", status: "failed", candidateId: "C1" },
      { kind: "repair", status: "completed", candidateId: "C2" },
    ],
  };

  assert.equal(candidateRepairCount(task, candidate), 2);
  assert.equal(candidateRepairCircuitExhausted(task, candidate), true);
});

test("does not carry no-op repair attempts across a target refresh", () => {
  const candidate = {
    id: "C1",
    revisionNumber: 2,
    revisions: [
      { number: 1, reason: "assembly" },
      { number: 2, reason: "target-refresh" },
    ],
  };
  const task = {
    workflowProfile: { selected: "standard" },
    runs: [
      { kind: "repair", status: "completed", candidateId: "C1", candidateRevision: 1 },
      { kind: "repair", status: "completed", candidateId: "C1", candidateRevision: 1 },
      { kind: "repair", status: "completed", candidateId: "C1", candidateRevision: 2 },
    ],
  };

  assert.equal(candidateRepairCount(task, candidate), 1);
  assert.equal(candidateRepairCircuitExhausted(task, candidate), false);
});
