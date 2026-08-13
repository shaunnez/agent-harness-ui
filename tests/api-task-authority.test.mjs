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
  threeRevisionCandidate,
  twoRevisionCandidate,
} from "./api-test-support.mjs";

test("starts repair after final review requests candidate repair", async () => {
  const { directory, origin, server, store, startedIdRef } = await createServer();
  try {
    const response = await createTask(origin, {
      title: "Final review repair",
      description: "Repair a candidate rejected by the final holdout.",
      repositoryPath: directory,
      workflow: "implement",
    });
    const { task } = await response.json();
    await store.update(task.id, (draft) => {
      draft.status = "repair-required";
      draft.currentStage = "final-review";
      draft.attemptsByStage["final-review"] = 1;
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
    assert.equal(startedIdRef(), task.id);
  } finally {
    await cleanup(server, directory);
  }
});

test("rejects repaired candidate histories without a complete causal authorizer chain", async () => {
  const { directory, origin, server, store } = await createServer();
  try {
    for (const item of [
      {
        name: "producer before repair reservation",
        candidate: () => twoRevisionCandidate(),
        mutate(draft, candidate) {
          const revision = candidate.revisions[1];
          const run = draft.runs.find(
            (entry) => entry.workflowReservationId === revision.sourceWorkflowReservationId,
          );
          const artifact = draft.artifacts.find((entry) => entry.id === run.artifactId);
          run.startedAt = "2026-08-04T00:00:20.000Z";
          run.completedAt = "2026-08-04T00:00:21.000Z";
          artifact.createdAt = "2026-08-04T00:00:22.000Z";
        },
      },
      {
        name: "missing historical authorizer identity",
        candidate: () => twoRevisionCandidate(),
        mutate(_draft, candidate) {
          delete candidate.revisions[1].authorizingGateArtifactId;
        },
      },
      {
        name: "authorizer artifact after repair reservation",
        candidate: () => twoRevisionCandidate(),
        mutate(draft, candidate) {
          const revision = candidate.revisions[1];
          const artifact = draft.artifacts.find((entry) => entry.id === revision.authorizingGateArtifactId);
          artifact.createdAt = revision.sourceWorkflowReservedAt;
        },
      },
      {
        name: "shared historical authorizer identity",
        candidate: () => threeRevisionCandidate(),
        mutate(_draft, candidate) {
          const firstRepair = candidate.revisions[1];
          const secondRepair = candidate.revisions[2];
          secondRepair.authorizingGateReservationId = firstRepair.authorizingGateReservationId;
          secondRepair.authorizingGateRunId = firstRepair.authorizingGateRunId;
          secondRepair.authorizingGateArtifactId = firstRepair.authorizingGateArtifactId;
        },
      },
    ]) {
      const response = await createTask(origin, {
        title: `Reject ${item.name}`,
        description:
          "Every retained Repair revision must preserve its causal gate, reservation, run, and artifact chain.",
        repositoryPath: directory,
        workflow: "implement",
      });
      const { task } = await response.json();
      await store.update(task.id, (draft) => {
        draft.status = "ready-for-review";
        draft.currentStage = "dev-review";
        const candidate = item.candidate();
        draft.attemptsByStage.implement = candidate.sourceWorkflowAttempt;
        draft.attemptsByStage["dev-review"] = draft.stageRunLimits["dev-review"];
        draft.candidates.push(candidate);
        attachCandidateProducerEvidence(draft, candidate);
        const currentRevision = candidate.revisions.at(-1);
        const priorRevision = candidate.revisions.at(-2);
        draft.stageRunReservations.implement = {
          id: currentRevision.sourceWorkflowReservationId,
          stage: "implement",
          kind: "repair",
          workflowAttempt: currentRevision.sourceWorkflowAttempt,
          candidateId: candidate.id,
          candidateRevision: priorRevision.number,
          candidateHeadRevision: priorRevision.headRevision,
          authorizedRunScopes: [],
          reservedAt: currentRevision.sourceWorkflowReservedAt,
        };
        draft.stageRunReservations["dev-review"] = {
          id: `reservation-${task.id}-current-review-3`,
          stage: "dev-review",
          kind: "review",
          workflowAttempt: 3,
          candidateId: candidate.id,
          candidateRevision: candidate.revisionNumber,
          candidateHeadRevision: candidate.headRevision,
          authorizedRunScopes: [],
          reservedAt: new Date(Date.parse(currentRevision.createdAt) + 60_000).toISOString(),
        };
        item.mutate(draft, candidate);
      });

      const grantResponse = await fetch(`${origin}/api/tasks/${task.id}/grant-retry`, { method: "POST" });
      assert.equal(grantResponse.status, 409, item.name);
      assert.match(
        (await grantResponse.json()).error,
        /inconsistent workflow reservation|producer evidence|persisted identities/i,
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

test("rejects noncompleted, non-durable, or multiply claimed repair authorizers", async () => {
  const { directory, origin, server, store } = await createServer();
  try {
    for (const mutation of [
      "failed authorizer run",
      "shared authorizer artifact",
      "blank authorizer artifact",
      "missing authorizer artifact timestamp",
    ]) {
      const response = await createTask(origin, {
        title: `Reject ${mutation}`,
        description: "Repair authority must come from one completed durable gate run and artifact.",
        repositoryPath: directory,
        workflow: "implement",
      });
      const { task } = await response.json();
      await store.update(task.id, (draft) => {
        draft.status = "repair-required";
        draft.currentStage = "dev-review";
        draft.attemptsByStage.implement = draft.stageRunLimits.implement;
        const candidate = attachAssemblyLineage(draft, {
          id: "C1",
          revisionNumber: 1,
          headRevision: "candidate-c1-r1",
          status: "repair_required",
        });
        draft.candidates.push(candidate);
        const authorizer = attachExactCandidateGate(draft, candidate);
        draft.runs.push(
          ...[1, 2, 3].map((attempt) => ({
            id: `run-failed-repair-envelope-${attempt}`,
            stage: "implement",
            status: "failed",
          })),
        );
        bindLatestWorkflowAttempt(draft, "implement", "repair");
        const authorizerRun = draft.runs.find((run) => run.id === authorizer.sourceRunId);
        const authorizerArtifact = draft.artifacts.find(
          (artifact) => artifact.id === authorizer.sourceArtifactId,
        );
        if (mutation === "failed authorizer run") authorizerRun.status = "failed";
        if (mutation === "shared authorizer artifact")
          draft.runs.at(-1).artifactId = authorizer.sourceArtifactId;
        if (mutation === "blank authorizer artifact") {
          authorizerArtifact.name = "";
          authorizerArtifact.content = "";
        }
        if (mutation === "missing authorizer artifact timestamp") delete authorizerArtifact.createdAt;
      });

      const grantResponse = await fetch(`${origin}/api/tasks/${task.id}/grant-retry`, { method: "POST" });
      assert.equal(grantResponse.status, 409, mutation);
      assert.match(
        (await grantResponse.json()).error,
        /authorizing gate|inconsistent workflow reservation|duplicate or inconsistent persisted identities/i,
        mutation,
      );
      const unchanged = await store.get(task.id);
      assert.equal(unchanged.stageRunLimits.implement, 3, mutation);
      assert.equal(unchanged.decisions.length, 0, mutation);
    }
  } finally {
    await cleanup(server, directory);
  }
});

test("rejects incoherent ready-gate status, stage, and candidate tuples", async () => {
  const { directory, origin, server, store } = await createServer();
  try {
    for (const item of [
      { name: "ready review status at Plan", stage: "plan", candidateStatus: "ready_for_review" },
      {
        name: "ready review gate with approval-stage candidate",
        stage: "dev-review",
        candidateStatus: "awaiting_human_approval",
      },
    ]) {
      const response = await createTask(origin, {
        title: `Reject ${item.name}`,
        description: "Ready-gate retry authority must use one coherent persisted state tuple.",
        repositoryPath: directory,
        workflow: "implement",
      });
      const { task } = await response.json();
      await store.update(task.id, (draft) => {
        draft.status = "ready-for-review";
        draft.currentStage = item.stage;
        draft.attemptsByStage[item.stage] = draft.stageRunLimits[item.stage];
        draft.candidates.push({
          id: "C1",
          revisionNumber: 1,
          headRevision: "candidate-c1-r1",
          status: item.candidateStatus,
          revisions: [],
        });
        draft.stageRunReservations[item.stage] = {
          id: `reservation-${item.stage}-3`,
          stage: item.stage,
          kind: item.stage === "plan" ? "planning" : "review",
          workflowAttempt: 3,
          candidateId: item.stage === "plan" ? null : "C1",
          candidateRevision: item.stage === "plan" ? null : 1,
          candidateHeadRevision: item.stage === "plan" ? null : "candidate-c1-r1",
          authorizedRunScopes: [],
          reservedAt: "2026-08-04T00:03:00.000Z",
        };
      });

      const grantResponse = await fetch(`${origin}/api/tasks/${task.id}/grant-retry`, { method: "POST" });
      assert.equal(grantResponse.status, 409, item.name);
      assert.match(
        (await grantResponse.json()).error,
        /exhausted blocked, approval, or repair stage/i,
        item.name,
      );
      assert.equal((await store.get(task.id)).decisions.length, 0, item.name);
    }
  } finally {
    await cleanup(server, directory);
  }
});

test("persists every uniquely dispatched Scout source run", async () => {
  const { directory, origin, server, store } = await createServer();
  try {
    const response = await createTask(origin, {
      title: "Multi-scout provenance",
      description: "A Scouts retry retains each uniquely dispatched Scout run.",
      repositoryPath: directory,
      workflow: "implement",
    });
    const { task } = await response.json();
    const scopes = ["scout-code-path", "scout-test-inventory"];
    await store.update(task.id, (draft) => {
      draft.status = "blocked";
      draft.currentStage = "scouts";
      draft.attemptsByStage.scouts = draft.stageRunLimits.scouts;
      draft.scoutDispatch = {
        selected: scopes.map((name) => ({
          name,
          focus: `Focus ${name}.`,
          reason: "Needed.",
          status: "complete",
        })),
        skipped: [],
        rationale: "Two distinct evidence scopes.",
        createdAt: "2026-08-04T00:00:00.000Z",
        completedAt: "2026-08-04T00:01:00.000Z",
      };
      draft.stageRunReservations.scouts = {
        id: "reservation-scouts-3",
        stage: "scouts",
        kind: "investigation",
        workflowAttempt: 3,
        candidateId: null,
        candidateRevision: null,
        candidateHeadRevision: null,
        authorizedRunScopes: scopes,
        reservedAt: "2026-08-04T00:00:00.000Z",
      };
      draft.runs.push(
        ...[...scopes].reverse().map((role) => ({
          id: `run-${role}`,
          stage: "scouts",
          kind: "scout",
          role,
          status: "completed",
          candidateId: null,
          candidateRevision: null,
          candidateHeadRevision: null,
          workPackageId: null,
          attempt: 1,
          workflowAttempt: 3,
          workflowReservationId: "reservation-scouts-3",
        })),
      );
    });

    const grantResponse = await fetch(`${origin}/api/tasks/${task.id}/grant-retry`, { method: "POST" });
    assert.equal(grantResponse.status, 200);
    const updated = await store.get(task.id);
    assert.equal(updated.stageRunLimits.scouts, 4);
    assert.equal(updated.decisions.at(-1).sourceRunId, "run-scout-test-inventory");
    assert.deepEqual(updated.decisions.at(-1).sourceRunIds, [
      "run-scout-code-path",
      "run-scout-test-inventory",
    ]);
    assert.deepEqual(updated.events.at(-1).sourceRunIds, ["run-scout-code-path", "run-scout-test-inventory"]);
  } finally {
    await cleanup(server, directory);
  }
});

test("rejects partial and orphaned explicit workflow identities instead of treating them as legacy", async () => {
  const { directory, origin, server, store } = await createServer();
  try {
    for (const [name, workflowIdentity] of [
      ["orphan", { workflowAttempt: 3, workflowReservationId: "missing-reservation" }],
      ["partial", { workflowAttempt: 3 }],
    ]) {
      const response = await createTask(origin, {
        title: `${name} workflow identity`,
        description: "Explicit workflow identity must be complete and backed by the current reservation.",
        repositoryPath: directory,
        workflow: "implement",
      });
      const { task } = await response.json();
      await store.update(task.id, (draft) => {
        draft.status = "blocked";
        draft.currentStage = "dev-review";
        draft.attemptsByStage["dev-review"] = draft.stageRunLimits["dev-review"];
        const candidate = attachAssemblyLineage(draft, {
          id: "C1",
          revisionNumber: 1,
          headRevision: "candidate-c1-r1",
          status: "ready_for_review",
        });
        draft.candidates.push(candidate);
        draft.stageRunReservations["dev-review"] = {
          id: "reservation-current-review-3",
          stage: "dev-review",
          kind: "review",
          workflowAttempt: 3,
          candidateId: "C1",
          candidateRevision: 1,
          candidateHeadRevision: "candidate-c1-r1",
          reservedAt: "2026-08-04T00:02:00.000Z",
        };
        draft.runs.push({
          id: `run-${name}-review-3`,
          stage: "dev-review",
          kind: "review",
          role: "dev-review",
          status: "failed",
          candidateId: "C1",
          candidateRevision: 1,
          candidateHeadRevision: "candidate-c1-r1",
          workPackageId: null,
          attempt: 1,
          ...workflowIdentity,
        });
      });

      const grantResponse = await fetch(`${origin}/api/tasks/${task.id}/grant-retry`, { method: "POST" });
      assert.equal(grantResponse.status, 409, name);
      assert.match((await grantResponse.json()).error, /partial or orphaned workflow identity/i, name);
      const updated = await store.get(task.id);
      assert.equal(updated.stageRunLimits["dev-review"], 3, name);
      assert.equal(updated.decisions.length, 0, name);
    }
  } finally {
    await cleanup(server, directory);
  }
});
