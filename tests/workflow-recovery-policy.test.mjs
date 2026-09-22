import assert from "node:assert/strict";
import test from "node:test";
import { candidateRepairCircuitExhausted, candidateRepairCount } from "../src/workflow-recovery-policy.ts";

test("counts failed and completed no-op repair runs as repair attempts", () => {
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

  assert.equal(candidateRepairCount(task, candidate), 3);
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

test("candidate repair caps are configurable and shared across failing gates", () => {
  const task = {
    workflowProfile: { selected: "standard" },
    repairLimits: { package: 2, candidate: { fast: 0, standard: 4, "high-risk": 6 } },
  };
  const candidate = {
    revisions: [{ reason: "assembly" }, ...Array.from({ length: 3 }, () => ({ reason: "repair" }))],
  };
  assert.equal(candidateRepairCircuitExhausted(task, candidate), false);
  candidate.revisions.push({ reason: "repair" });
  assert.equal(candidateRepairCircuitExhausted(task, candidate), true);
  assert.equal(
    candidateRepairCircuitExhausted({ ...task, workflowProfile: { selected: "fast" } }, { revisions: [] }),
    true,
  );
});
