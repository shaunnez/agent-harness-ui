import test from "node:test";
import {
  assert,
  attachAssemblyLineage,
  attachCandidateProducerEvidence,
  attachExactCandidateGate,
  bindLatestWorkflowAttempt,
  cleanup,
  createServer,
  createTask,
  fetch,
  refreshGateFreshness,
} from "./api-test-support.mjs";

test("starts repair when the failed gate is exhausted but implement has capacity", async () => {
  const { directory, origin, server, store } = await createServer();
  try {
    const response = await createTask(origin, {
      title: "Exhausted review repair",
      description: "Recover a repair-required candidate after the review allowance is exhausted.",
      repositoryPath: directory,
      workflow: "implement",
    });
    const { task } = await response.json();
    await store.update(task.id, (draft) => {
      draft.status = "repair-required";
      draft.currentStage = "dev-review";
      draft.attemptsByStage["dev-review"] = draft.stageRunLimits["dev-review"];
      draft.candidates.push({
        id: "C1",
        revisionNumber: 1,
        headRevision: "candidate-c1-r1",
        status: "repair_required",
      });
    });

    const repairResponse = await fetch(`${origin}/api/tasks/${task.id}/repair`, { method: "POST" });
    assert.equal(repairResponse.status, 202);
    assert.deepEqual(await repairResponse.json(), { started: true });

    const updated = (await (await fetch(`${origin}/api/tasks/${task.id}`)).json()).task;
    assert.equal(updated.stageRunLimits.implement, 3);
    assert.equal(updated.stageRunLimits["dev-review"], 3);
    assert.equal(updated.attemptsByStage["dev-review"], 3);
    assert.equal(updated.attemptsByStage.implement ?? 0, 0);
    assert.equal(updated.decisions.length, 0);
  } finally {
    await cleanup(server, directory);
  }
});

test("grants only implement and admits one repair when its budget is exhausted", async () => {
  const { directory, origin, server, store } = await createServer();
  try {
    const response = await createTask(origin, {
      title: "Exhausted implementation repair",
      description: "Grant the canonical mutation stage without changing the failed gate allowance.",
      repositoryPath: directory,
      workflow: "implement",
    });
    const { task } = await response.json();
    await store.update(task.id, (draft) => {
      draft.status = "repair-required";
      draft.currentStage = "dev-review";
      draft.attemptsByStage.implement = draft.stageRunLimits.implement;
      draft.attemptsByStage["dev-review"] = 1;
      const candidate = attachAssemblyLineage(draft, {
        id: "C1",
        revisionNumber: 1,
        headRevision: "candidate-c1-r1",
        status: "repair_required",
      });
      draft.candidates.push(candidate);
      attachExactCandidateGate(draft, candidate);
      draft.runs.push(
        ...[1, 2, 3].map((attempt) => ({
          id: `run-exhausted-repair-${attempt}`,
          stage: "implement",
          status: "failed",
        })),
      );
      bindLatestWorkflowAttempt(draft, "implement", "repair");
    });

    const blockedRepair = await fetch(`${origin}/api/tasks/${task.id}/repair`, { method: "POST" });
    assert.equal(blockedRepair.status, 409);
    assert.deepEqual(await blockedRepair.json(), {
      error: "The current stage has exhausted its retry allowance.",
    });

    const grantResponse = await fetch(`${origin}/api/tasks/${task.id}/grant-retry`, { method: "POST" });
    assert.equal(grantResponse.status, 200);
    assert.deepEqual(await grantResponse.json(), { granted: true });

    const granted = (await (await fetch(`${origin}/api/tasks/${task.id}`)).json()).task;
    assert.equal(granted.stageRunLimits.implement, 4);
    assert.equal(granted.stageRunLimits["dev-review"], 3);
    assert.equal(granted.decisions.at(-1).grantedStage, "implement");
    assert.equal(granted.events.at(-1).grantedStage, "implement");

    const repairResponse = await fetch(`${origin}/api/tasks/${task.id}/repair`, { method: "POST" });
    assert.equal(repairResponse.status, 202);
    assert.deepEqual(await repairResponse.json(), { started: true });
  } finally {
    await cleanup(server, directory);
  }
});

test("retains a committed slice when granting an exhausted implementation qualification retry", async () => {
  const { directory, origin, server, store } = await createServer();
  try {
    const response = await createTask(origin, {
      title: "Retain failed qualification",
      description: "Resume the committed slice instead of rebuilding it from the target.",
      repositoryPath: directory,
      workflow: "implement",
    });
    const { task } = await response.json();
    await store.update(task.id, (draft) => {
      draft.status = "blocked";
      draft.currentStage = "implement";
      draft.attemptsByStage.implement = draft.stageRunLimits.implement;
      draft.workPackages = [
        {
          id: "S1",
          title: "Qualified slice",
          description: "Repair only the focused qualification failure.",
          dependencies: [],
          batch: 1,
          ownedPaths: ["server/api.mjs"],
          verificationCommandIds: ["unit"],
          verificationRuns: [
            {
              headRevision: "slice-head-r1",
              status: "failed",
            },
          ],
          status: "failed",
          attempts: 1,
          branch: "agent-harness/retained-s1-a1",
          worktreePath: "/tmp/retained-s1-a1",
          baseRevision: "target-base-r1",
          headRevision: "slice-head-r1",
          files: ["server/api.mjs"],
          error: "S1 did not qualify: unit failed — formatter exited 1.",
          retainedContinuation: null,
          retainedForRequalification: false,
          retainedReplacementReason: null,
        },
      ];
      draft.runs.push(
        ...[1, 2, 3].map((attempt) => ({
          id: `run-failed-qualification-${attempt}`,
          stage: "implement",
          status: "failed",
        })),
      );
      bindLatestWorkflowAttempt(draft, "implement", "implementation");
    });

    const grantResponse = await fetch(`${origin}/api/tasks/${task.id}/grant-retry`, { method: "POST" });
    assert.equal(grantResponse.status, 200, JSON.stringify(await grantResponse.clone().json()));
    const updated = await store.get(task.id);
    assert.equal(updated.stageRunLimits.implement, 4);
    assert.deepEqual(updated.workPackages[0].retainedContinuation, {
      requestedAt: updated.workPackages[0].retainedContinuation.requestedAt,
      files: ["server/api.mjs"],
      outsideOwnership: [],
      qualificationFailure: "S1 did not qualify: unit failed — formatter exited 1.",
    });
    assert.match(updated.workPackages[0].retainedContinuation.requestedAt, /^\d{4}-\d{2}-\d{2}T/);
  } finally {
    await cleanup(server, directory);
  }
});

test("grants one bounded stage attempt to a reservation-bound candidate at an exhausted ready gate", async () => {
  const { directory, origin, server, store } = await createServer();
  try {
    const response = await createTask(origin, {
      title: "Exhausted ready gate",
      description:
        "Allow a repaired candidate to re-enter review after its prior review allowance was exhausted.",
      repositoryPath: directory,
      workflow: "implement",
    });
    const { task } = await response.json();
    await store.update(task.id, (draft) => {
      draft.status = "ready-for-review";
      draft.currentStage = "dev-review";
      draft.attemptsByStage["dev-review"] = draft.stageRunLimits["dev-review"];
      const candidate = attachAssemblyLineage(draft, {
        id: "C1",
        revisionNumber: 1,
        headRevision: "candidate-c1-r1",
        status: "ready_for_review",
      });
      draft.candidates.push(candidate);
      draft.runs.push(
        ...[1, 2, 3].map((attempt) => ({
          id: `run-ready-review-${attempt}`,
          stage: "dev-review",
          status: "failed",
        })),
      );
      bindLatestWorkflowAttempt(draft, "dev-review", "review");
    });

    const grantResponse = await fetch(`${origin}/api/tasks/${task.id}/grant-retry`, { method: "POST" });
    assert.equal(grantResponse.status, 200);
    assert.deepEqual(await grantResponse.json(), { granted: true });

    const updated = (await (await fetch(`${origin}/api/tasks/${task.id}`)).json()).task;
    assert.equal(updated.status, "failed");
    assert.equal(updated.stageRunLimits["dev-review"], 4);
    assert.equal(updated.stageRunLimits.implement, 3);
    assert.equal(updated.candidates.at(-1).status, "ready_for_review");
    assert.equal(updated.events.at(-1).title, "One stage attempt granted");
  } finally {
    await cleanup(server, directory);
  }
});

test("grants a fresh gate attempt after consecutive target refreshes without requiring repair lineage", async () => {
  const { directory, origin, server, store } = await createServer();
  try {
    const response = await createTask(origin, {
      title: "Target-refreshed exhausted gate",
      description: "A harness target refresh must not masquerade as candidate Repair.",
      repositoryPath: directory,
      workflow: "implement",
    });
    const { task } = await response.json();
    await store.update(task.id, (draft) => {
      draft.status = "ready-for-review";
      draft.currentStage = "dev-review";
      draft.attemptsByStage["dev-review"] = draft.stageRunLimits["dev-review"];
      const oldHead = "candidate-target-refresh-r1";
      const candidate = attachAssemblyLineage(draft, {
        id: "C1",
        revisionNumber: 1,
        baseRevision: "target-base-r1",
        headRevision: oldHead,
        status: "ready_for_review",
      });
      draft.candidates.push(candidate);
      draft.runs.push(
        ...[1, 2, 3].map((attempt) => ({
          id: `run-target-refresh-review-${attempt}`,
          stage: "dev-review",
          status: "failed",
        })),
      );
      bindLatestWorkflowAttempt(draft, "dev-review", "review");
      candidate.revisionNumber = 3;
      candidate.baseRevision = "target-base-r3";
      candidate.headRevision = "candidate-target-refresh-r3";
      candidate.revisions.push(
        {
          number: 2,
          headRevision: "candidate-target-refresh-r2",
          reason: "target-refresh",
          previousBaseRevision: "target-base-r1",
          previousHeadRevision: oldHead,
          baseRevision: "target-base-r2",
          createdAt: "2026-08-04T00:03:00.000Z",
        },
        {
          number: 3,
          headRevision: candidate.headRevision,
          reason: "target-refresh",
          previousBaseRevision: "target-base-r2",
          previousHeadRevision: "candidate-target-refresh-r2",
          baseRevision: candidate.baseRevision,
          createdAt: "2026-08-04T00:04:00.000Z",
        },
      );
    });

    const grantResponse = await fetch(`${origin}/api/tasks/${task.id}/grant-retry`, { method: "POST" });
    assert.equal(grantResponse.status, 200);
    const updated = await store.get(task.id);
    assert.equal(updated.stageRunLimits["dev-review"], 4);
    assert.deepEqual(
      updated.candidates[0].revisions.slice(1).map((revision) => revision.reason),
      ["target-refresh", "target-refresh"],
    );
    assert.equal(updated.candidates[0].sourceWorkflowAttempt, 1);
  } finally {
    await cleanup(server, directory);
  }
});

test("grants a fresh gate attempt to a rebuilt candidate after the prior candidate failed", async () => {
  const { directory, origin, server, store } = await createServer();
  try {
    const response = await createTask(origin, {
      title: "Rebuilt candidate exhausted gate",
      description: "A newly assembled candidate must not inherit an unusable prior-candidate reservation.",
      repositoryPath: directory,
      workflow: "implement",
    });
    const { task } = await response.json();
    await store.update(task.id, (draft) => {
      draft.status = "ready-for-review";
      draft.currentStage = "dev-review";
      draft.attemptsByStage["dev-review"] = draft.stageRunLimits["dev-review"];
      const priorCandidate = attachAssemblyLineage(draft, {
        id: "C1",
        revisionNumber: 1,
        baseRevision: "target-base-r1",
        headRevision: "candidate-c1-r1",
        status: "failed",
      });
      draft.candidates.push(priorCandidate);
      draft.runs.push(
        ...[1, 2, 3].map((attempt) => ({
          id: `run-superseded-review-${attempt}`,
          stage: "dev-review",
          status: "failed",
        })),
      );
      bindLatestWorkflowAttempt(draft, "dev-review", "review");

      const rebuiltCandidate = attachAssemblyLineage(
        draft,
        {
          id: "C2",
          revisionNumber: 1,
          baseRevision: "target-base-r2",
          headRevision: "candidate-c2-r1",
          status: "ready_for_review",
        },
        {
          workflowAttempt: 2,
          reservationId: `reservation-${draft.id}-assembly-2`,
          reservedAt: "2026-08-04T00:02:00.000Z",
          createdAt: "2026-08-04T00:03:00.000Z",
        },
      );
      draft.candidates.push(rebuiltCandidate);
      draft.attemptsByStage.implement = 2;
      const rebuiltProducerRun = draft.runs.find(
        (run) => run.workflowReservationId === rebuiltCandidate.sourceWorkflowReservationId,
      );
      rebuiltProducerRun.attempt = 2;
    });

    const grantResponse = await fetch(`${origin}/api/tasks/${task.id}/grant-retry`, { method: "POST" });
    const grantBody = await grantResponse.json();
    assert.equal(grantResponse.status, 200, grantBody.error);
    const updated = await store.get(task.id);
    assert.equal(updated.stageRunLimits["dev-review"], 4);
    assert.equal(updated.candidates[0].status, "failed");
    assert.equal(updated.candidates[1].id, "C2");
    assert.equal(updated.candidates[1].sourceWorkflowAttempt, 2);
  } finally {
    await cleanup(server, directory);
  }
});

test("grants a fresh gate attempt to a repaired descendant of a rebuilt candidate", async () => {
  const { directory, origin, server, store } = await createServer();
  try {
    const response = await createTask(origin, {
      title: "Repaired rebuilt candidate exhausted gate",
      description: "A valid repair descendant must retain the rebuilt candidate's retry authority.",
      repositoryPath: directory,
      workflow: "implement",
    });
    const { task } = await response.json();
    await store.update(task.id, (draft) => {
      draft.status = "ready-for-test";
      draft.currentStage = "test";
      draft.attemptsByStage.test = draft.stageRunLimits.test;
      const priorCandidate = attachAssemblyLineage(draft, {
        id: "C1",
        revisionNumber: 1,
        baseRevision: "target-base-r1",
        headRevision: "candidate-c1-r1",
        status: "failed",
      });
      draft.candidates.push(priorCandidate);
      draft.runs.push(
        ...[1, 2, 3].map((attempt) => ({
          id: `run-superseded-test-${attempt}`,
          stage: "test",
          status: "failed",
        })),
      );
      const exhaustedReservation = bindLatestWorkflowAttempt(draft, "test", "test");

      const rebuiltCandidate = attachAssemblyLineage(
        draft,
        {
          id: "C2",
          revisionNumber: 1,
          baseRevision: "target-base-r2",
          headRevision: "candidate-c2-r1",
          status: "ready_for_test",
        },
        {
          workflowAttempt: 2,
          reservationId: `reservation-${draft.id}-assembly-2`,
          reservedAt: "2026-08-04T00:03:00.000Z",
          createdAt: "2026-08-04T00:04:00.000Z",
        },
      );
      draft.candidates.push(rebuiltCandidate);
      const rebuiltProducerRun = draft.runs.find(
        (run) => run.workflowReservationId === rebuiltCandidate.sourceWorkflowReservationId,
      );
      rebuiltProducerRun.attempt = 2;
      const repairRevision = {
        number: 2,
        headRevision: "candidate-c2-r2",
        reason: "repair",
        sourceWorkflowAttempt: 3,
        sourceWorkflowReservationId: `reservation-${draft.id}-repair-3`,
        sourceWorkflowReservedAt: "2026-08-04T00:06:00.000Z",
        createdAt: "2026-08-04T00:07:00.000Z",
      };
      rebuiltCandidate.revisionNumber = repairRevision.number;
      rebuiltCandidate.headRevision = repairRevision.headRevision;
      rebuiltCandidate.sourceWorkflowAttempt = repairRevision.sourceWorkflowAttempt;
      rebuiltCandidate.sourceWorkflowReservationId = repairRevision.sourceWorkflowReservationId;
      rebuiltCandidate.revisions.push(repairRevision);
      attachCandidateProducerEvidence(draft, rebuiltCandidate);
      draft.attemptsByStage.implement = 3;
      draft.stageRunReservations.implement = {
        id: repairRevision.sourceWorkflowReservationId,
        stage: "implement",
        kind: "repair",
        workflowAttempt: repairRevision.sourceWorkflowAttempt,
        candidateId: rebuiltCandidate.id,
        candidateRevision: 1,
        candidateHeadRevision: rebuiltCandidate.revisions[0].headRevision,
        authorizedRunScopes: [],
        reservedAt: repairRevision.sourceWorkflowReservedAt,
        authorizingGateStage: repairRevision.authorizingGateStage,
        authorizingGateWorkflowAttempt: repairRevision.authorizingGateWorkflowAttempt,
        authorizingGateReservationId: repairRevision.authorizingGateReservationId,
        authorizingGateReservedAt: repairRevision.authorizingGateReservedAt,
        authorizingGateRunId: repairRevision.authorizingGateRunId,
        authorizingGateArtifactId: repairRevision.authorizingGateArtifactId,
      };
      draft.attemptsByStage.test = draft.stageRunLimits.test;
      draft.stageRunReservations.test = exhaustedReservation;
    });

    const grantResponse = await fetch(`${origin}/api/tasks/${task.id}/grant-retry`, { method: "POST" });
    const grantBody = await grantResponse.json();
    assert.equal(grantResponse.status, 200, grantBody.error);
    const updated = await store.get(task.id);
    assert.equal(updated.stageRunLimits.test, 4);
    assert.equal(updated.candidates[0].status, "failed");
    assert.equal(updated.candidates[1].id, "C2");
    assert.equal(updated.candidates[1].revisionNumber, 2);
    assert.equal(updated.candidates[1].sourceWorkflowAttempt, 3);
  } finally {
    await cleanup(server, directory);
  }
});

test("grants an exhausted repair after a mechanical target refresh", async () => {
  const { directory, origin, server, store } = await createServer();
  try {
    const response = await createTask(origin, {
      title: "Repair after target refresh",
      description: "Mechanical lineage must retain the prior implementation producer.",
      repositoryPath: directory,
      workflow: "implement",
    });
    const { task } = await response.json();
    await store.update(task.id, (draft) => {
      draft.status = "repair-required";
      draft.currentStage = "dev-review";
      const candidate = attachAssemblyLineage(draft, {
        id: "C1",
        revisionNumber: 1,
        baseRevision: "target-base-r1",
        headRevision: "candidate-c1-r1",
        status: "repair_required",
      });
      draft.candidates.push(candidate);
      const priorGate = attachExactCandidateGate(draft, candidate, {
        stage: "dev-review",
        workflowAttempt: 1,
        reservedAt: "2026-08-04T00:01:30.000Z",
      });
      const repairRevision = {
        number: 2,
        headRevision: "candidate-c1-r2",
        reason: "repair",
        sourceWorkflowAttempt: 2,
        sourceWorkflowReservationId: `reservation-${draft.id}-repair-2`,
        sourceWorkflowReservedAt: "2026-08-04T00:02:00.000Z",
        authorizingGateStage: priorGate.stage,
        authorizingGateWorkflowAttempt: priorGate.workflowAttempt,
        authorizingGateReservationId: priorGate.id,
        authorizingGateReservedAt: priorGate.reservedAt,
        authorizingGateRunId: priorGate.sourceRunId,
        authorizingGateArtifactId: priorGate.sourceArtifactId,
        createdAt: "2026-08-04T00:03:00.000Z",
      };
      candidate.revisionNumber = 2;
      candidate.headRevision = repairRevision.headRevision;
      candidate.sourceWorkflowAttempt = repairRevision.sourceWorkflowAttempt;
      candidate.sourceWorkflowReservationId = repairRevision.sourceWorkflowReservationId;
      candidate.revisions.push(repairRevision);
      attachCandidateProducerEvidence(draft, candidate);
      draft.attemptsByStage.implement = 2;
      draft.stageRunLimits.implement = 2;
      draft.stageRunReservations.implement = {
        id: repairRevision.sourceWorkflowReservationId,
        stage: "implement",
        kind: "repair",
        workflowAttempt: 2,
        candidateId: candidate.id,
        candidateRevision: 1,
        candidateHeadRevision: candidate.revisions[0].headRevision,
        authorizedRunScopes: [],
        reservedAt: repairRevision.sourceWorkflowReservedAt,
        authorizingGateStage: repairRevision.authorizingGateStage,
        authorizingGateWorkflowAttempt: repairRevision.authorizingGateWorkflowAttempt,
        authorizingGateReservationId: repairRevision.authorizingGateReservationId,
        authorizingGateReservedAt: repairRevision.authorizingGateReservedAt,
        authorizingGateRunId: repairRevision.authorizingGateRunId,
        authorizingGateArtifactId: repairRevision.authorizingGateArtifactId,
      };
      candidate.revisionNumber = 3;
      candidate.baseRevision = "target-base-r3";
      candidate.headRevision = "candidate-target-refresh-r3";
      candidate.revisions.push({
        number: 3,
        headRevision: candidate.headRevision,
        reason: "target-refresh",
        previousBaseRevision: "target-base-r2",
        previousHeadRevision: repairRevision.headRevision,
        baseRevision: candidate.baseRevision,
        createdAt: "2026-08-04T00:04:00.000Z",
      });
      const refreshedGate = attachExactCandidateGate(draft, candidate, {
        stage: "dev-review",
        workflowAttempt: 2,
        reservationId: `reservation-${draft.id}-dev-review-refresh-2`,
        reservedAt: "2026-08-04T00:05:00.000Z",
      });
      draft.runs.find((run) => run.id === refreshedGate.sourceRunId).attempt = 1;
      refreshGateFreshness(draft);
    });

    const grantResponse = await fetch(`${origin}/api/tasks/${task.id}/grant-retry`, { method: "POST" });
    assert.equal(grantResponse.status, 200, JSON.stringify(await grantResponse.clone().json()));
    const updated = await store.get(task.id);
    assert.equal(updated.stageRunLimits.implement, 3);
    assert.equal(updated.decisions.at(-1).candidateRevision, 3);
  } finally {
    await cleanup(server, directory);
  }
});
