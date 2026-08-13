import test from "node:test";
import {
  assert,
  attachAssemblyLineage,
  bindLatestWorkflowAttempt,
  CANONICAL_RUN_STAGES,
  cleanup,
  createServer,
  createTask,
  fetch,
} from "./api-test-support.mjs";

test("rejects duplicate source runs for a singleton workflow reservation", async () => {
  const { directory, origin, server, store } = await createServer();
  try {
    const response = await createTask(origin, {
      title: "Duplicate singleton provenance",
      description: "A Plan retry must identify one exact source run at most.",
      repositoryPath: directory,
      workflow: "implement",
    });
    const { task } = await response.json();
    await store.update(task.id, (draft) => {
      draft.status = "blocked";
      draft.currentStage = "plan";
      draft.attemptsByStage.plan = draft.stageRunLimits.plan;
      draft.stageRunReservations.plan = {
        id: "reservation-plan-3",
        stage: "plan",
        kind: "planning",
        workflowAttempt: 3,
        candidateId: null,
        candidateRevision: null,
        candidateHeadRevision: null,
        reservedAt: "2026-08-04T00:00:00.000Z",
      };
      draft.runs.push(
        ...[1, 2].map((attempt) => ({
          id: `run-plan-duplicate-${attempt}`,
          stage: "plan",
          kind: "agent",
          role: "plan",
          status: "failed",
          candidateId: null,
          candidateRevision: null,
          candidateHeadRevision: null,
          workPackageId: null,
          attempt,
          workflowAttempt: 3,
          workflowReservationId: "reservation-plan-3",
        })),
      );
    });

    const grantResponse = await fetch(`${origin}/api/tasks/${task.id}/grant-retry`, { method: "POST" });
    assert.equal(grantResponse.status, 409);
    assert.match((await grantResponse.json()).error, /multiple source runs for a singleton stage/i);
    const unchanged = await store.get(task.id);
    assert.equal(unchanged.stageRunLimits.plan, 3);
    assert.equal(unchanged.decisions.length, 0);
  } finally {
    await cleanup(server, directory);
  }
});

test("persists every source run for a multi-package implementation reservation", async () => {
  const { directory, origin, server, store } = await createServer();
  try {
    const response = await createTask(origin, {
      title: "Multi-package implementation provenance",
      description: "An implementation retry retains every authorized slice run.",
      repositoryPath: directory,
      workflow: "implement",
    });
    const { task } = await response.json();
    await store.update(task.id, (draft) => {
      draft.status = "blocked";
      draft.currentStage = "implement";
      draft.attemptsByStage.implement = draft.stageRunLimits.implement;
      draft.workPackages = ["S1", "S2"].map((id) => ({ id, status: "failed" }));
      draft.stageRunReservations.implement = {
        id: "reservation-implement-3",
        stage: "implement",
        kind: "implementation",
        workflowAttempt: 3,
        candidateId: null,
        candidateRevision: null,
        candidateHeadRevision: null,
        authorizedRunScopes: ["S1", "S2"],
        reservedAt: "2026-08-04T00:00:00.000Z",
      };
      draft.runs.push(
        ...["S2", "S1"].map((workPackageId) => ({
          id: `run-implement-${workPackageId}`,
          stage: "implement",
          kind: "implementation",
          role: "implement",
          status: "failed",
          candidateId: null,
          candidateRevision: null,
          candidateHeadRevision: null,
          workPackageId,
          attempt: 1,
          workflowAttempt: 3,
          workflowReservationId: "reservation-implement-3",
        })),
      );
    });

    const grantResponse = await fetch(`${origin}/api/tasks/${task.id}/grant-retry`, { method: "POST" });
    assert.equal(grantResponse.status, 200);
    const updated = await store.get(task.id);
    assert.equal(updated.stageRunLimits.implement, 4);
    assert.equal(updated.decisions.at(-1).sourceRunId, "run-implement-S2");
    assert.deepEqual(updated.decisions.at(-1).sourceRunIds, ["run-implement-S1", "run-implement-S2"]);
    assert.equal(updated.events.at(-1).sourceRunId, "run-implement-S2");
    assert.deepEqual(updated.events.at(-1).sourceRunIds, ["run-implement-S1", "run-implement-S2"]);
  } finally {
    await cleanup(server, directory);
  }
});

test("rejects duplicate or unauthorized scopes inside a multi-run reservation", async () => {
  const { directory, origin, server, store } = await createServer();
  try {
    for (const item of [
      {
        name: "unauthorized implementation package",
        stage: "implement",
        kind: "implementation",
        authorizedRunScopes: ["S1"],
        workPackageIds: ["S1"],
        scoutDispatch: null,
        runs: [
          {
            id: "run-implement-S9-1",
            kind: "implementation",
            role: "implement",
            workPackageId: "S9",
            attempt: 1,
          },
        ],
        error: /duplicate or unauthorized run scopes/i,
      },
      {
        name: "duplicate implementation package",
        stage: "implement",
        kind: "implementation",
        authorizedRunScopes: ["S1", "S2"],
        workPackageIds: ["S1", "S2"],
        scoutDispatch: null,
        runs: [1, 2].map((attempt) => ({
          id: `run-implement-S1-${attempt}`,
          kind: "implementation",
          role: "implement",
          workPackageId: "S1",
          attempt,
        })),
        error: /duplicate or unauthorized run scopes/i,
      },
      {
        name: "implementation scope absent from plan",
        stage: "implement",
        kind: "implementation",
        authorizedRunScopes: ["S9"],
        workPackageIds: ["S1"],
        scoutDispatch: null,
        runs: [
          {
            id: "run-implement-S9-planned",
            kind: "implementation",
            role: "implement",
            workPackageId: "S9",
            attempt: 1,
          },
        ],
        error: /does not match the persisted work-package plan/i,
      },
      {
        name: "unresolved planned package absent from scope snapshot",
        stage: "implement",
        kind: "implementation",
        authorizedRunScopes: ["S1"],
        workPackageIds: ["S1", "S2"],
        scoutDispatch: null,
        runs: [
          {
            id: "run-implement-S1-incomplete-snapshot",
            kind: "implementation",
            role: "implement",
            workPackageId: "S1",
            attempt: 1,
          },
        ],
        error: /does not match the persisted work-package plan/i,
      },
      {
        name: "duplicate selected scout",
        stage: "scouts",
        kind: "investigation",
        authorizedRunScopes: ["scout-code-path"],
        workPackageIds: [],
        scoutDispatch: {
          selected: [
            { name: "scout-code-path", focus: "Trace the API.", reason: "Needed.", status: "complete" },
          ],
          skipped: [],
          rationale: "One scout selected.",
          createdAt: "2026-08-04T00:00:00.000Z",
          completedAt: "2026-08-04T00:01:00.000Z",
        },
        runs: [1, 2].map((attempt) => ({
          id: `run-scout-code-path-${attempt}`,
          kind: "scout",
          role: "scout-code-path",
          workPackageId: null,
          attempt,
        })),
        error: /duplicate or unauthorized run scopes/i,
      },
      {
        name: "fabricated selected scout",
        stage: "scouts",
        kind: "investigation",
        authorizedRunScopes: ["scout-fabricated"],
        workPackageIds: [],
        scoutDispatch: {
          selected: [
            { name: "scout-fabricated", focus: "Invent evidence.", reason: "Invalid.", status: "complete" },
          ],
          skipped: [],
          rationale: "A fabricated scout must not become authority.",
          createdAt: "2026-08-04T00:00:00.000Z",
          completedAt: "2026-08-04T00:01:00.000Z",
        },
        runs: [
          {
            id: "run-scout-fabricated-1",
            kind: "scout",
            role: "scout-fabricated",
            workPackageId: null,
            attempt: 1,
          },
        ],
        error: /does not match its persisted dispatch/i,
      },
    ]) {
      const response = await createTask(origin, {
        title: `Reject ${item.name}`,
        description: "Each authorized multi-run scope may produce at most one run per reservation.",
        repositoryPath: directory,
        workflow: "implement",
      });
      const { task } = await response.json();
      await store.update(task.id, (draft) => {
        draft.status = "blocked";
        draft.currentStage = item.stage;
        draft.attemptsByStage[item.stage] = draft.stageRunLimits[item.stage];
        draft.scoutDispatch = item.scoutDispatch;
        draft.workPackages = item.workPackageIds.map((id) => ({ id, status: "failed" }));
        const reservationId = `reservation-${item.stage}-3`;
        draft.stageRunReservations[item.stage] = {
          id: reservationId,
          stage: item.stage,
          kind: item.kind,
          workflowAttempt: 3,
          candidateId: null,
          candidateRevision: null,
          candidateHeadRevision: null,
          authorizedRunScopes: item.authorizedRunScopes,
          reservedAt: "2026-08-04T00:00:00.000Z",
        };
        draft.runs.push(
          ...item.runs.map((run) => ({
            ...run,
            stage: item.stage,
            status: "failed",
            candidateId: null,
            candidateRevision: null,
            candidateHeadRevision: null,
            workflowAttempt: 3,
            workflowReservationId: reservationId,
          })),
        );
      });

      const grantResponse = await fetch(`${origin}/api/tasks/${task.id}/grant-retry`, { method: "POST" });
      assert.equal(grantResponse.status, 409, item.name);
      assert.match((await grantResponse.json()).error, item.error, item.name);
      assert.equal((await store.get(task.id)).stageRunLimits[item.stage], 3, item.name);
    }
  } finally {
    await cleanup(server, directory);
  }
});

test("rejects empty multi-run scope snapshots with exact, legacy, or absent run provenance", async () => {
  const { directory, origin, server, store } = await createServer();
  try {
    for (const item of [
      {
        name: "one exact Implementation run",
        stage: "implement",
        kind: "implementation",
        scoutDispatch: null,
        runs: [
          {
            id: "run-implement-S1-exact",
            kind: "implementation",
            role: "implement",
            workPackageId: "S1",
            attempt: 1,
            exact: true,
          },
        ],
        error: /missing an authorized work-package scope/i,
      },
      {
        name: "two legacy Implementation runs",
        stage: "implement",
        kind: "implementation",
        scoutDispatch: null,
        runs: ["S1", "S2"].map((workPackageId) => ({
          id: `run-implement-${workPackageId}-legacy`,
          kind: "implementation",
          role: "implement",
          workPackageId,
          attempt: 1,
          exact: false,
        })),
        error: /missing an authorized work-package scope/i,
      },
      {
        name: "selected Scout with no run",
        stage: "scouts",
        kind: "investigation",
        scoutDispatch: {
          selected: [
            { name: "scout-code-path", focus: "Trace the API.", reason: "Needed.", status: "complete" },
          ],
          skipped: [],
          rationale: "One scout selected.",
          createdAt: "2026-08-04T00:00:00.000Z",
          completedAt: "2026-08-04T00:01:00.000Z",
        },
        runs: [],
        error: /does not match its persisted dispatch/i,
      },
    ]) {
      const response = await createTask(origin, {
        title: `Reject ${item.name}`,
        description:
          "A multi-run reservation must snapshot its authorized scopes independently of emitted runs.",
        repositoryPath: directory,
        workflow: "implement",
      });
      const { task } = await response.json();
      await store.update(task.id, (draft) => {
        draft.status = "blocked";
        draft.currentStage = item.stage;
        draft.attemptsByStage[item.stage] = draft.stageRunLimits[item.stage];
        draft.scoutDispatch = item.scoutDispatch;
        const reservationId = `reservation-${item.stage}-empty-scopes-3`;
        draft.stageRunReservations[item.stage] = {
          id: reservationId,
          stage: item.stage,
          kind: item.kind,
          workflowAttempt: 3,
          candidateId: null,
          candidateRevision: null,
          candidateHeadRevision: null,
          authorizedRunScopes: [],
          reservedAt: "2026-08-04T00:00:00.000Z",
        };
        draft.runs.push(
          ...item.runs.map(({ exact, ...run }) => ({
            ...run,
            stage: item.stage,
            status: "failed",
            candidateId: null,
            candidateRevision: null,
            candidateHeadRevision: null,
            ...(exact ? { workflowAttempt: 3, workflowReservationId: reservationId } : {}),
          })),
        );
      });

      const grantResponse = await fetch(`${origin}/api/tasks/${task.id}/grant-retry`, { method: "POST" });
      assert.equal(grantResponse.status, 409, item.name);
      assert.match((await grantResponse.json()).error, item.error, item.name);
      assert.equal((await store.get(task.id)).stageRunLimits[item.stage], 3, item.name);
    }
  } finally {
    await cleanup(server, directory);
  }
});

test("rejects retry reservations without a valid persisted reservation timestamp", async () => {
  const { directory, origin, server, store } = await createServer();
  try {
    for (const [name, reservedAt] of [
      ["missing", undefined],
      ["invalid", "not-a-timestamp"],
      ["noncanonical", "2026-08-04"],
    ]) {
      const response = await createTask(origin, {
        title: `${name} reservation timestamp`,
        description: "Retry authority requires a durable reservation timestamp.",
        repositoryPath: directory,
        workflow: "implement",
      });
      const { task } = await response.json();
      await store.update(task.id, (draft) => {
        draft.status = "blocked";
        draft.currentStage = "plan";
        draft.attemptsByStage.plan = draft.stageRunLimits.plan;
        draft.stageRunReservations.plan = {
          id: `reservation-plan-${name}-3`,
          stage: "plan",
          kind: "planning",
          workflowAttempt: 3,
          candidateId: null,
          candidateRevision: null,
          candidateHeadRevision: null,
          ...(reservedAt === undefined ? {} : { reservedAt }),
        };
      });

      const grantResponse = await fetch(`${origin}/api/tasks/${task.id}/grant-retry`, { method: "POST" });
      assert.equal(grantResponse.status, 409, name);
      assert.match((await grantResponse.json()).error, /inconsistent workflow reservation/i, name);
      assert.equal((await store.get(task.id)).stageRunLimits.plan, 3, name);
    }
  } finally {
    await cleanup(server, directory);
  }
});

test("grants exactly one retry to each exhausted blocked canonical stage", async () => {
  const { directory, origin, server, store } = await createServer();
  try {
    const cases = [
      { stage: "triage", candidateStatus: null, status: "blocked" },
      { stage: "plan", candidateStatus: null, status: "blocked" },
      { stage: "plan", candidateStatus: null, status: "awaiting-plan-approval" },
      { stage: "dev-review", candidateStatus: "ready_for_review", status: "blocked" },
      { stage: "test", candidateStatus: "ready_for_test", status: "blocked" },
      { stage: "final-review", candidateStatus: "ready_for_final_review", status: "blocked" },
    ];
    for (const { stage, candidateStatus, status } of cases) {
      const response = await createTask(origin, {
        title: `${status} ${stage}`,
        description: `Grant only the exhausted ${stage} stage.`,
        repositoryPath: directory,
        workflow: "implement",
      });
      const { task } = await response.json();
      const sourceRunId = `run-${stage}-3`;
      await store.update(task.id, (draft) => {
        draft.status = status;
        draft.currentStage = stage;
        draft.attemptsByStage[stage] = draft.stageRunLimits[stage];
        draft.runs.push(
          ...[1, 2, 3].map((attempt) => ({
            id: `run-${stage}-${attempt}`,
            stage,
            status: "failed",
          })),
        );
        if (candidateStatus) {
          const candidate = attachAssemblyLineage(draft, {
            id: "C1",
            revisionNumber: 1,
            headRevision: "candidate-c1-r1",
            status: candidateStatus,
          });
          draft.candidates.push(candidate);
        }
        bindLatestWorkflowAttempt(
          draft,
          stage,
          {
            triage: "investigation",
            plan: "planning",
            "dev-review": "review",
            test: "test",
            "final-review": "final-review",
          }[stage],
        );
        if (status === "awaiting-plan-approval") draft.runs.at(-1).status = "completed";
      });
      const before = await store.get(task.id);

      const grantResponse = await fetch(`${origin}/api/tasks/${task.id}/grant-retry`, { method: "POST" });
      assert.equal(grantResponse.status, 200, stage);
      assert.deepEqual(await grantResponse.json(), { granted: true });

      const updated = await store.get(task.id);
      assert.equal(updated.status, "failed", stage);
      assert.deepEqual(updated.attemptsByStage, before.attemptsByStage, `${stage} attempts remain unchanged`);
      for (const canonicalStage of CANONICAL_RUN_STAGES) {
        assert.equal(
          updated.stageRunLimits[canonicalStage],
          before.stageRunLimits[canonicalStage] + (canonicalStage === stage ? 1 : 0),
          `${stage} grant must not change ${canonicalStage}`,
        );
      }
      assert.deepEqual(
        {
          grantedStage: updated.decisions.at(-1).grantedStage,
          previousLimit: updated.decisions.at(-1).previousLimit,
          newLimit: updated.decisions.at(-1).newLimit,
          sourceRunId: updated.decisions.at(-1).sourceRunId,
        },
        { grantedStage: stage, previousLimit: 3, newLimit: 4, sourceRunId },
      );
      assert.deepEqual(
        {
          grantedStage: updated.events.at(-1).grantedStage,
          previousLimit: updated.events.at(-1).previousLimit,
          newLimit: updated.events.at(-1).newLimit,
          sourceRunId: updated.events.at(-1).sourceRunId,
          retryOfRunId: updated.events.at(-1).retryOfRunId,
        },
        { grantedStage: stage, previousLimit: 3, newLimit: 4, sourceRunId, retryOfRunId: sourceRunId },
      );

      const repeatedResponse = await fetch(`${origin}/api/tasks/${task.id}/grant-retry`, { method: "POST" });
      assert.equal(repeatedResponse.status, 409, `${stage} cannot receive a second grant before retrying`);
      const repeated = await store.get(task.id);
      assert.deepEqual(repeated.stageRunLimits, updated.stageRunLimits);
      assert.equal(repeated.decisions.length, updated.decisions.length);
    }
  } finally {
    await cleanup(server, directory);
  }
});

test("rejects a retry grant when the reviewed exhaustion tuple changes before reservation", async () => {
  let taskId = null;
  const { directory, origin, server, store } = await createServer({
    async beforeTransition(targetStore, id) {
      if (id !== taskId) return;
      await targetStore.update(id, (draft) => {
        draft.attemptsByStage.plan += 1;
        draft.stageRunLimits.plan += 1;
        draft.runs.push({ id: "run-plan-4", stage: "plan", status: "failed" });
      });
    },
  });
  try {
    const response = await createTask(origin, {
      title: "Racing retry grant",
      description: "Reject a grant when the exact exhaustion snapshot changes before reservation.",
      repositoryPath: directory,
      workflow: "implement",
    });
    const { task } = await response.json();
    taskId = task.id;
    await store.update(task.id, (draft) => {
      draft.status = "blocked";
      draft.currentStage = "plan";
      draft.attemptsByStage.plan = draft.stageRunLimits.plan;
      draft.runs.push(
        ...[1, 2, 3].map((attempt) => ({
          id: `run-plan-${attempt}`,
          stage: "plan",
          status: "failed",
        })),
      );
      bindLatestWorkflowAttempt(draft, "plan", "planning");
    });

    const grantResponse = await fetch(`${origin}/api/tasks/${task.id}/grant-retry`, { method: "POST" });
    assert.equal(grantResponse.status, 409);
    assert.match((await grantResponse.json()).error, /state changed/i);
    const updated = await store.get(task.id);
    assert.equal(updated.attemptsByStage.plan, 4);
    assert.equal(updated.stageRunLimits.plan, 4);
    assert.equal(updated.decisions.length, 0);
  } finally {
    await cleanup(server, directory);
  }
});
