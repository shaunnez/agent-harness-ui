import test from "node:test";
import {
  assert,
  attachAssemblyLineage,
  attachCandidateProducerEvidence,
  attachExactCandidateGate,
  cleanup,
  createServer,
  createTask,
  fetch,
  threeRevisionCandidate,
  twoRevisionCandidate,
} from "./api-test-support.mjs";

test("rejects exact-current gate grants when the retained candidate history or producer is impossible", async () => {
  const { directory, origin, server, store } = await createServer();
  try {
    for (const item of [
      {
        name: "invalid intermediate revision reason",
        mutate(candidate) {
          candidate.revisions[1].reason = "assembly";
        },
      },
      {
        name: "current review predates candidate revision",
        mutate(_candidate, draft) {
          draft.stageRunReservations["dev-review"].reservedAt = "2026-08-04T00:01:45.000Z";
        },
      },
      {
        name: "missing current producer reservation",
        mutate(_candidate, draft) {
          delete draft.stageRunReservations.implement;
        },
      },
      {
        name: "top-level producer mismatch",
        mutate(candidate) {
          candidate.sourceWorkflowReservationId = "different-current-producer";
        },
      },
      {
        name: "producer attempt differs from Implement counter",
        mutate(_candidate, draft) {
          draft.attemptsByStage.implement = 2;
        },
      },
      {
        name: "gate reservation reuses producer identity",
        mutate(candidate, draft) {
          draft.stageRunReservations["dev-review"].id = candidate.sourceWorkflowReservationId;
        },
      },
    ]) {
      const response = await createTask(origin, {
        title: `Reject exact-current ${item.name}`,
        description:
          "An exact current binding cannot bypass complete candidate history and producer validation.",
        repositoryPath: directory,
        workflow: "implement",
      });
      const { task } = await response.json();
      await store.update(task.id, (draft) => {
        draft.status = "ready-for-review";
        draft.currentStage = "dev-review";
        draft.attemptsByStage.implement = 3;
        draft.attemptsByStage["dev-review"] = draft.stageRunLimits["dev-review"];
        const candidate = {
          id: "C1",
          revisionNumber: 3,
          headRevision: "candidate-c1-r3",
          status: "ready_for_review",
          sourceWorkflowAttempt: 3,
          sourceWorkflowReservationId: "reservation-c1-r2-repair-3",
          revisions: [
            {
              number: 1,
              headRevision: "candidate-c1-r1",
              reason: "assembly",
              sourceWorkflowAttempt: 1,
              sourceWorkflowReservationId: "reservation-c1-assembly-1",
              createdAt: "2026-08-04T00:00:00.000Z",
            },
            {
              number: 2,
              headRevision: "candidate-c1-r2",
              reason: "repair",
              sourceWorkflowAttempt: 2,
              sourceWorkflowReservationId: "reservation-c1-r1-repair-2",
              createdAt: "2026-08-04T00:01:00.000Z",
            },
            {
              number: 3,
              headRevision: "candidate-c1-r3",
              reason: "repair",
              sourceWorkflowAttempt: 3,
              sourceWorkflowReservationId: "reservation-c1-r2-repair-3",
              createdAt: "2026-08-04T00:02:00.000Z",
            },
          ],
        };
        draft.candidates.push(candidate);
        attachCandidateProducerEvidence(draft, candidate);
        draft.stageRunReservations.implement = {
          id: "reservation-c1-r2-repair-3",
          stage: "implement",
          kind: "repair",
          workflowAttempt: 3,
          candidateId: "C1",
          candidateRevision: 2,
          candidateHeadRevision: "candidate-c1-r2",
          authorizedRunScopes: [],
          reservedAt: "2026-08-04T00:01:30.000Z",
        };
        draft.stageRunReservations["dev-review"] = {
          id: "reservation-c1-r3-review-3",
          stage: "dev-review",
          kind: "review",
          workflowAttempt: 3,
          candidateId: "C1",
          candidateRevision: 3,
          candidateHeadRevision: "candidate-c1-r3",
          authorizedRunScopes: [],
          reservedAt: "2026-08-04T00:03:00.000Z",
        };
        item.mutate(candidate, draft);
      });

      const grantResponse = await fetch(`${origin}/api/tasks/${task.id}/grant-retry`, { method: "POST" });
      assert.equal(grantResponse.status, 409, item.name);
      assert.match(
        (await grantResponse.json()).error,
        /duplicate or inconsistent persisted identities|inconsistent workflow reservation/i,
        item.name,
      );
      const unchanged = await store.get(task.id);
      assert.equal(unchanged.stageRunLimits["dev-review"], 3, item.name);
      assert.equal(unchanged.decisions.length, 0, item.name);
    }
  } finally {
    await cleanup(server, directory);
  }
});

test("grants an exact-current repaired candidate only with distinct gate and current producer reservations", async () => {
  const { directory, origin, server, store } = await createServer();
  try {
    const response = await createTask(origin, {
      title: "Exact current repaired candidate",
      description:
        "Authorize a gate retry only when the current repair producer matches the Implement counter.",
      repositoryPath: directory,
      workflow: "implement",
    });
    const { task } = await response.json();
    await store.update(task.id, (draft) => {
      draft.status = "ready-for-review";
      draft.currentStage = "dev-review";
      draft.attemptsByStage.implement = 3;
      draft.attemptsByStage["dev-review"] = draft.stageRunLimits["dev-review"];
      const candidate = threeRevisionCandidate();
      draft.candidates.push(candidate);
      attachCandidateProducerEvidence(draft, candidate);
      draft.stageRunReservations.implement = {
        id: "reservation-c1-r2-repair-3",
        stage: "implement",
        kind: "repair",
        workflowAttempt: 3,
        candidateId: "C1",
        candidateRevision: 2,
        candidateHeadRevision: "candidate-c1-r2",
        authorizedRunScopes: [],
        reservedAt: "2026-08-04T00:01:30.000Z",
      };
      draft.stageRunReservations["dev-review"] = {
        id: "reservation-c1-r3-review-3",
        stage: "dev-review",
        kind: "review",
        workflowAttempt: 3,
        candidateId: "C1",
        candidateRevision: 3,
        candidateHeadRevision: "candidate-c1-r3",
        authorizedRunScopes: [],
        reservedAt: "2026-08-04T00:03:00.000Z",
      };
    });

    const grantResponse = await fetch(`${origin}/api/tasks/${task.id}/grant-retry`, { method: "POST" });
    assert.equal(grantResponse.status, 200, JSON.stringify(await grantResponse.clone().json()));
    assert.deepEqual(await grantResponse.json(), { granted: true });
    const updated = await store.get(task.id);
    assert.equal(updated.stageRunLimits["dev-review"], 4);
    assert.equal(updated.decisions.at(-1).workflowReservationId, "reservation-c1-r3-review-3");
    assert.equal(updated.decisions.at(-1).candidateAuthorizerReservationIds.length, 2);
    assert.equal(updated.decisions.at(-1).candidateAuthorizerRunIds.length, 2);
    assert.equal(updated.decisions.at(-1).candidateAuthorizerArtifactIds.length, 2);
  } finally {
    await cleanup(server, directory);
  }
});

test("accepts the canonical initial producer ordinal after an earlier same-scope implementation failure", async () => {
  const { directory, origin, server, store } = await createServer();
  try {
    const response = await createTask(origin, {
      title: "Retried initial producer ordinal",
      description: "An implementation retry must retain the scope-local producer attempt ordinal.",
      repositoryPath: directory,
      workflow: "implement",
    });
    const { task } = await response.json();
    await store.update(task.id, (draft) => {
      draft.status = "ready-for-review";
      draft.currentStage = "dev-review";
      draft.attemptsByStage.implement = 2;
      draft.attemptsByStage["dev-review"] = draft.stageRunLimits["dev-review"];
      const candidate = {
        id: "C1",
        revisionNumber: 1,
        headRevision: "candidate-c1-r1",
        status: "ready_for_review",
        sourceWorkflowAttempt: 2,
        sourceWorkflowReservationId: "reservation-c1-assembly-2",
        revisions: [
          {
            number: 1,
            headRevision: "candidate-c1-r1",
            reason: "assembly",
            sourceWorkflowAttempt: 2,
            sourceWorkflowReservationId: "reservation-c1-assembly-2",
            sourceWorkflowReservedAt: "2026-08-04T00:00:30.000Z",
            createdAt: "2026-08-04T00:01:00.000Z",
          },
        ],
      };
      draft.candidates.push(candidate);
      attachCandidateProducerEvidence(draft, candidate);
      const producerIndex = draft.runs.findIndex(
        (run) => run.workflowReservationId === candidate.sourceWorkflowReservationId,
      );
      draft.runs[producerIndex].attempt = 2;
      draft.runs.splice(producerIndex, 0, {
        id: "run-earlier-s1-failure",
        stage: "implement",
        kind: "implementation",
        role: "implement",
        status: "failed",
        workPackageId: "S1",
        candidateId: null,
        candidateRevision: null,
        candidateHeadRevision: null,
        attempt: 1,
        workflowAttempt: 1,
        workflowReservationId: "reservation-earlier-s1-failure",
      });
      draft.stageRunReservations.implement = {
        id: candidate.sourceWorkflowReservationId,
        stage: "implement",
        kind: "implementation",
        workflowAttempt: 2,
        candidateId: null,
        candidateRevision: null,
        candidateHeadRevision: null,
        authorizedRunScopes: ["S1"],
        reservedAt: "2026-08-04T00:00:30.000Z",
      };
      draft.stageRunReservations["dev-review"] = {
        id: "reservation-c1-r1-review-3",
        stage: "dev-review",
        kind: "review",
        workflowAttempt: 3,
        candidateId: "C1",
        candidateRevision: 1,
        candidateHeadRevision: "candidate-c1-r1",
        authorizedRunScopes: [],
        reservedAt: "2026-08-04T00:02:00.000Z",
      };
    });

    const grantResponse = await fetch(`${origin}/api/tasks/${task.id}/grant-retry`, { method: "POST" });
    assert.equal(grantResponse.status, 200, JSON.stringify(await grantResponse.clone().json()));
    const updated = await store.get(task.id);
    assert.equal(updated.stageRunLimits["dev-review"], 4);
    assert.equal(updated.decisions.at(-1).candidateProducerRunIds.length, 1);
  } finally {
    await cleanup(server, directory);
  }
});

test("rejects forged producer attempt ordinals and incomplete durable producer envelopes", async () => {
  const { directory, origin, server, store } = await createServer();
  try {
    for (const mutation of [
      "forged initial attempt",
      "missing repair run timestamps",
      "missing repair artifact timestamp",
      "repair artifact after revision",
    ]) {
      const response = await createTask(origin, {
        title: `Reject ${mutation}`,
        description: "Candidate producer evidence must be canonical, durable, and causally ordered.",
        repositoryPath: directory,
        workflow: "implement",
      });
      const { task } = await response.json();
      await store.update(task.id, (draft) => {
        draft.status = "ready-for-review";
        draft.currentStage = "dev-review";
        draft.attemptsByStage.implement = 2;
        draft.attemptsByStage["dev-review"] = draft.stageRunLimits["dev-review"];
        const candidate = twoRevisionCandidate();
        draft.candidates.push(candidate);
        attachCandidateProducerEvidence(draft, candidate);
        draft.stageRunReservations.implement = {
          id: candidate.sourceWorkflowReservationId,
          stage: "implement",
          kind: "repair",
          workflowAttempt: 2,
          candidateId: "C1",
          candidateRevision: 1,
          candidateHeadRevision: "candidate-c1-r1",
          authorizedRunScopes: [],
          reservedAt: "2026-08-04T00:00:30.000Z",
        };
        draft.stageRunReservations["dev-review"] = {
          id: "reservation-c1-r2-review-3",
          stage: "dev-review",
          kind: "review",
          workflowAttempt: 3,
          candidateId: "C1",
          candidateRevision: 2,
          candidateHeadRevision: "candidate-c1-r2",
          authorizedRunScopes: [],
          reservedAt: "2026-08-04T00:02:00.000Z",
        };
        const initialRun = draft.runs.find(
          (run) => run.workflowReservationId === candidate.revisions[0].sourceWorkflowReservationId,
        );
        const repairRun = draft.runs.find(
          (run) => run.workflowReservationId === candidate.sourceWorkflowReservationId,
        );
        const repairArtifact = draft.artifacts.find((artifact) => artifact.id === repairRun.artifactId);
        if (mutation === "forged initial attempt") initialRun.attempt = 999;
        if (mutation === "missing repair run timestamps") {
          delete repairRun.startedAt;
          delete repairRun.completedAt;
        }
        if (mutation === "missing repair artifact timestamp") delete repairArtifact.createdAt;
        if (mutation === "repair artifact after revision")
          repairArtifact.createdAt = "2026-08-04T00:01:01.000Z";
      });

      const grantResponse = await fetch(`${origin}/api/tasks/${task.id}/grant-retry`, { method: "POST" });
      assert.equal(grantResponse.status, 409, mutation);
      assert.match(
        (await grantResponse.json()).error,
        /producer evidence|inconsistent workflow reservation/i,
        mutation,
      );
      const unchanged = await store.get(task.id);
      assert.equal(unchanged.stageRunLimits["dev-review"], 3, mutation);
      assert.equal(unchanged.decisions.length, 0, mutation);
    }
  } finally {
    await cleanup(server, directory);
  }
});

test("rejects an exact-current gate when its initial candidate producer names a nonexistent package", async () => {
  const { directory, origin, server, store } = await createServer();
  try {
    const response = await createTask(origin, {
      title: "Reject fabricated candidate producer scope",
      description:
        "A current candidate gate must prove its initial producer used real planned package scopes.",
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
      draft.stageRunReservations.implement.authorizedRunScopes = ["S9"];
      const producerRun = draft.runs.find(
        (run) => run.workflowReservationId === candidate.sourceWorkflowReservationId,
      );
      producerRun.workPackageId = "S9";
      attachExactCandidateGate(draft, candidate);
    });

    const grantResponse = await fetch(`${origin}/api/tasks/${task.id}/grant-retry`, { method: "POST" });
    assert.equal(grantResponse.status, 409);
    assert.match((await grantResponse.json()).error, /inconsistent workflow reservation/i);
    const unchanged = await store.get(task.id);
    assert.equal(unchanged.stageRunLimits["dev-review"], 3);
    assert.equal(unchanged.decisions.length, 0);
  } finally {
    await cleanup(server, directory);
  }
});

test("rejects failed repair reservations that reuse or fail to advance the current producer identity", async () => {
  const { directory, origin, server, store } = await createServer();
  try {
    for (const item of [
      {
        name: "reused producer reservation",
        reservationId: "reservation-c1-r2-repair-3",
        workflowAttempt: 3,
        repairReservedAt: "2026-08-04T00:03:00.000Z",
      },
      {
        name: "fresh ID with non-increasing attempt",
        reservationId: "reservation-failed-repair-3",
        workflowAttempt: 3,
        repairReservedAt: "2026-08-04T00:03:00.000Z",
      },
      {
        name: "repair predates and reuses retained gate reservation",
        reservationId: "reservation-c1-r3-review-1",
        workflowAttempt: 4,
        repairReservedAt: "2026-08-04T00:02:30.000Z",
        gateReservationId: "reservation-c1-r3-review-1",
        gateReservedAt: "2026-08-04T00:03:00.000Z",
      },
      {
        name: "retained gate attempt differs from its stage counter",
        reservationId: "reservation-failed-repair-4",
        workflowAttempt: 4,
        repairReservedAt: "2026-08-04T00:04:00.000Z",
        gateReservationId: "reservation-c1-r3-review-999",
        gateReservedAt: "2026-08-04T00:03:00.000Z",
        gateWorkflowAttempt: 999,
        gateStageCounter: 1,
      },
      {
        name: "retained gate has no authoritative source run",
        reservationId: "reservation-failed-repair-4",
        workflowAttempt: 4,
        repairReservedAt: "2026-08-04T00:04:00.000Z",
        gateReservationId: "reservation-c1-r3-review-1",
        gateReservedAt: "2026-08-04T00:03:00.000Z",
        removeGateRun: true,
      },
    ]) {
      const response = await createTask(origin, {
        title: `Reject ${item.name}`,
        description: "A failed repair attempt must be newer than and distinct from every candidate producer.",
        repositoryPath: directory,
        workflow: "implement",
      });
      const { task } = await response.json();
      await store.update(task.id, (draft) => {
        draft.status = "repair-required";
        draft.currentStage = "dev-review";
        draft.stageRunLimits.implement = item.workflowAttempt;
        draft.attemptsByStage.implement = item.workflowAttempt;
        const candidate = threeRevisionCandidate("repair_required");
        draft.candidates.push(candidate);
        attachCandidateProducerEvidence(draft, candidate);
        attachExactCandidateGate(draft, candidate, {
          reservationId: item.gateReservationId ?? "reservation-c1-r3-review-1",
          reservedAt: item.gateReservedAt ?? "2026-08-04T00:02:30.000Z",
          workflowAttempt: item.gateWorkflowAttempt,
        });
        if (item.gateStageCounter != null) draft.attemptsByStage["dev-review"] = item.gateStageCounter;
        if (item.removeGateRun) {
          draft.runs = draft.runs.filter((run) => run.workflowReservationId !== item.gateReservationId);
        }
        draft.stageRunReservations.implement = {
          id: item.reservationId,
          stage: "implement",
          kind: "repair",
          workflowAttempt: item.workflowAttempt,
          candidateId: "C1",
          candidateRevision: 3,
          candidateHeadRevision: "candidate-c1-r3",
          authorizedRunScopes: [],
          reservedAt: item.repairReservedAt,
        };
      });

      const grantResponse = await fetch(`${origin}/api/tasks/${task.id}/grant-retry`, { method: "POST" });
      assert.equal(grantResponse.status, 409, item.name);
      assert.match(
        (await grantResponse.json()).error,
        /duplicate or inconsistent persisted identities|inconsistent workflow reservation/i,
        item.name,
      );
      const unchanged = await store.get(task.id);
      assert.equal(unchanged.stageRunLimits.implement, item.workflowAttempt, item.name);
      assert.equal(unchanged.decisions.length, 0, item.name);
    }
  } finally {
    await cleanup(server, directory);
  }
});
