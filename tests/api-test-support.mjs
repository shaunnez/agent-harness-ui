import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { createApiServer } from "../server/api.mjs";
import { defaultWorktreeRoot, GitWorktreeManager } from "../server/git-worktree.mjs";
import {
  attachRunArtifact,
  CANONICAL_RUN_STAGES,
  RUN_ACTIVITY_EVENT_LIMIT,
  RUNTIME_FRESHNESS_REASONS,
  refreshGateFreshness,
} from "../server/run-activity.mjs";
import { SqliteTaskStore } from "../server/sqlite-store.mjs";
import { JsonTaskStore } from "../server/store.mjs";
import { parseFocusedTestEvidence } from "../server/structured-output.mjs";
import { recordWorkflowProfile } from "../server/workflow-profiles.mjs";
import {
  formatApprovalStage,
  formatApprovalTimestamp,
  getApprovalHistory,
} from "../src/components/runtimeApprovalHistory.js";

const exec = promisify(execFile);

const TEST_CSRF_TOKEN = "test-csrf-token";

const nativeFetch = globalThis.fetch;

function fetch(input, init = {}) {
  const headers = new Headers(init.headers);
  if (init.method && init.method !== "GET") {
    if (!headers.has("content-type")) headers.set("content-type", "application/json");
    if (!headers.has("x-agent-harness-csrf")) headers.set("x-agent-harness-csrf", TEST_CSRF_TOKEN);
  }
  return nativeFetch(input, { ...init, headers });
}

async function createServer(options = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-api-"));
  const store = options.sqlite
    ? new SqliteTaskStore(path.join(directory, "tasks.sqlite3"), {
        legacyJsonPath: path.join(directory, "tasks.json"),
      })
    : new JsonTaskStore(path.join(directory, "tasks.json"));
  await store.init();
  let startedId = null;
  let startedKind = null;
  let recordedDecision = null;
  let grillAnswer = null;
  let grillFinish = null;
  let approvedSpecification = null;
  let approvedPullRequest = null;
  let reconciledPullRequestTask = null;
  let completedMergedTask = null;
  let reconciledMergeTask = null;
  let refreshedCandidateTask = null;
  let rebuiltCandidateTask = null;
  let restartedImplementationTask = null;
  let retriedTestTask = null;
  const orchestrator = {
    status: async () => ({ available: true, authenticated: true, authMethod: "ChatGPT" }),
    start(id, kind) {
      startedId = id;
      startedKind = kind;
      return options.startResult ?? true;
    },
    isRunning: () => options.orchestratorRunning === true,
    cancel: () => false,
    async recordDecision(id, input) {
      recordedDecision = { id, ...input };
    },
    async answerGrillQuestion(id, input) {
      grillAnswer = { id, ...input };
    },
    async finishGrill(id, input) {
      grillFinish = { id, ...input };
      return { started: true };
    },
    async approveSpecification(id, note) {
      approvedSpecification = { id, note };
      return { started: false, completed: true };
    },
    async approvePlan() {},
    async overrideWorkflowProfile(id, profile, reason) {
      return store.update(id, (draft) => {
        recordWorkflowProfile(draft, profile, reason, "operator");
      });
    },
    async approveMerge() {},
    async approvePullRequest(id, note) {
      approvedPullRequest = { id, note };
    },
    async reconcilePullRequest(id) {
      reconciledPullRequestTask = id;
      return store.get(id);
    },
    async reconcileMerge(id) {
      reconciledMergeTask = id;
      return store.get(id);
    },
    async completeMergedTask(id, note) {
      completedMergedTask = { id, note };
    },
    async refreshCandidate(id) {
      refreshedCandidateTask = id;
      return store.get(id);
    },
    async rebuildCandidateFromTarget(id) {
      rebuiltCandidateTask = id;
      return store.get(id);
    },
    async restartImplementationFromTarget(id) {
      restartedImplementationTask = id;
      return store.get(id);
    },
    async retryTestOnSameCandidate(id) {
      retriedTestTask = id;
      return { started: true };
    },
  };
  let transitionIntercepted = false;
  const apiStore = options.beforeTransition
    ? new Proxy(store, {
        get(target, property) {
          if (property === "transition") {
            return async (...args) => {
              if (!transitionIntercepted) {
                transitionIntercepted = true;
                await options.beforeTransition(store, ...args);
              }
              return target.transition(...args);
            };
          }
          const value = Reflect.get(target, property, target);
          return typeof value === "function" ? value.bind(target) : value;
        },
      })
    : store;
  const server = createApiServer({
    store: apiStore,
    orchestrator,
    suggestedRepository: directory,
    csrfToken: options.csrfToken ?? TEST_CSRF_TOKEN,
    reportHttpMetric: options.reportHttpMetric,
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return {
    directory,
    origin: `http://127.0.0.1:${address.port}`,
    server,
    store,
    startedIdRef: () => startedId,
    startedKindRef: () => startedKind,
    recordedDecisionRef: () => recordedDecision,
    grillAnswerRef: () => grillAnswer,
    grillFinishRef: () => grillFinish,
    approvedSpecificationRef: () => approvedSpecification,
    approvedPullRequestRef: () => approvedPullRequest,
    reconciledPullRequestTaskRef: () => reconciledPullRequestTask,
    completedMergedTaskRef: () => completedMergedTask,
    refreshedCandidateTaskRef: () => refreshedCandidateTask,
    rebuiltCandidateTaskRef: () => rebuiltCandidateTask,
    restartedImplementationTaskRef: () => restartedImplementationTask,
    retriedTestTaskRef: () => retriedTestTask,
    reconciledMergeTaskRef: () => reconciledMergeTask,
  };
}

async function cleanup(server, directory) {
  await new Promise((resolve) => server.close(resolve));
  await rm(directory, { recursive: true, force: true });
}

async function createTask(origin, payload) {
  return fetch(`${origin}/api/tasks`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

async function git(cwd, args) {
  return exec("git", args, { cwd, windowsHide: true });
}

function bindLatestWorkflowAttempt(draft, stage, kind) {
  const candidate = draft.candidates.at(-1) ?? null;
  const workflowAttempt = draft.attemptsByStage[stage];
  const expectedRun =
    kind === "repair"
      ? { kind: "repair", role: "repair", workPackageId: null }
      : kind === "implementation"
        ? { kind: "implementation", role: "implement", workPackageId: "S1" }
        : {
            triage: { kind: "agent", role: "triage", workPackageId: null },
            scouts: { kind: "agent", role: "scouts", workPackageId: null },
            grill: { kind: "agent", role: "grill", workPackageId: null },
            specification: { kind: "agent", role: "specification", workPackageId: null },
            plan: { kind: "agent", role: "plan", workPackageId: null },
            "dev-review": { kind: "review", role: "dev-review", workPackageId: null },
            test: { kind: "test", role: "test", workPackageId: null },
            "final-review": { kind: "final-review", role: "final-review", workPackageId: null },
          }[stage];
  const reservation = {
    id: `reservation-${draft.id}-${stage}-${workflowAttempt}`,
    stage,
    kind,
    workflowAttempt,
    candidateId: candidate?.id ?? null,
    candidateRevision: candidate?.revisionNumber ?? null,
    candidateHeadRevision: candidate?.headRevision ?? null,
    authorizedRunScopes: kind === "implementation" ? ["S1"] : [],
    reservedAt: "2026-08-04T00:02:00.000Z",
  };
  draft.stageRunReservations[stage] = reservation;
  const stageRuns = draft.runs.filter((run) => run.stage === stage);
  const unboundRuns = stageRuns.filter(
    (run) => run.workflowAttempt == null && run.workflowReservationId == null,
  );
  for (const [index, run] of unboundRuns.entries()) {
    Object.assign(run, {
      ...expectedRun,
      candidateId: reservation.candidateId,
      candidateRevision: reservation.candidateRevision,
      candidateHeadRevision: reservation.candidateHeadRevision,
      attempt: index + 1,
    });
  }
  const latestRun = unboundRuns.at(-1);
  if (latestRun) {
    Object.assign(latestRun, {
      workflowAttempt,
      workflowReservationId: reservation.id,
    });
  }
  return reservation;
}

function attachLinkedArtifact(
  draft,
  run,
  {
    candidateId = null,
    candidateRevision = null,
    createdAt = "2026-08-04T00:06:00.000Z",
    workPackageId = null,
    gateResult = null,
  } = {},
) {
  const artifactId = `artifact-${run.id}`;
  run.artifactId = artifactId;
  draft.artifacts.push({
    id: artifactId,
    runId: run.id,
    stage: run.stage,
    kind: "markdown",
    name: `${run.id}.md`,
    content: `# ${run.id}\n\nPersisted test evidence.`,
    createdAt,
    candidateId,
    candidateRevision,
    workPackageId,
    gateResult,
  });
  return artifactId;
}

function attachCandidateProducerEvidence(draft, candidate) {
  const packageHeadRevision = candidate.members?.[0]?.headRevision ?? `package-${draft.id.toLowerCase()}-s1`;
  if (!draft.workPackages.length) {
    draft.workPackages = [{ id: "S1", status: "integrated", batch: 1, headRevision: packageHeadRevision }];
  }
  candidate.members ??= [{ packageId: "S1", headRevision: draft.workPackages[0].headRevision, order: 1 }];
  for (const revision of candidate.revisions) {
    const revisionAt = Date.parse(revision.createdAt);
    revision.sourceWorkflowReservedAt ??= new Date(
      revisionAt - (revision.number === 1 ? 10_000 : 30_000),
    ).toISOString();
    if (revision.number > 1) {
      attachHistoricalRepairAuthorizer(
        draft,
        candidate,
        revision,
        candidate.revisions.find((item) => item.number === revision.number - 1),
      );
    }
    if (draft.runs.some((run) => run.workflowReservationId === revision.sourceWorkflowReservationId))
      continue;
    const priorRevision =
      revision.number > 1 ? candidate.revisions.find((item) => item.number === revision.number - 1) : null;
    const run =
      revision.number === 1
        ? {
            id: `run-${revision.sourceWorkflowReservationId}-S1`,
            stage: "implement",
            kind: "implementation",
            role: "implement",
            status: "completed",
            workPackageId: "S1",
            candidateId: null,
            candidateRevision: null,
            candidateHeadRevision: null,
            attempt: 1,
            workflowAttempt: revision.sourceWorkflowAttempt,
            workflowReservationId: revision.sourceWorkflowReservationId,
          }
        : {
            id: `run-${revision.sourceWorkflowReservationId}`,
            stage: "implement",
            kind: "repair",
            role: "repair",
            status: "completed",
            workPackageId: null,
            candidateId: candidate.id,
            candidateRevision: priorRevision.number,
            candidateHeadRevision: priorRevision.headRevision,
            attempt: 1,
            workflowAttempt: revision.sourceWorkflowAttempt,
            workflowReservationId: revision.sourceWorkflowReservationId,
          };
    const sourceReservedAt = Date.parse(revision.sourceWorkflowReservedAt);
    run.startedAt = new Date(sourceReservedAt + 1_000).toISOString();
    run.completedAt = new Date(sourceReservedAt + 2_000).toISOString();
    attachLinkedArtifact(draft, run, {
      candidateId: revision.number === 1 ? null : candidate.id,
      candidateRevision: revision.number === 1 ? null : revision.number,
      createdAt: new Date(sourceReservedAt + 3_000).toISOString(),
      workPackageId: revision.number === 1 ? run.workPackageId : null,
    });
    draft.runs.push(run);
  }
}

function attachHistoricalRepairAuthorizer(draft, candidate, revision, priorRevision) {
  const authorizerFields = [
    "authorizingGateStage",
    "authorizingGateWorkflowAttempt",
    "authorizingGateReservationId",
    "authorizingGateReservedAt",
    "authorizingGateRunId",
    "authorizingGateArtifactId",
  ];
  if (authorizerFields.some((field) => revision[field] != null)) return;
  const sourceReservedAt = Date.parse(revision.sourceWorkflowReservedAt);
  const stage = "dev-review";
  const workflowAttempt = revision.number - 1;
  const reservationId = `reservation-${candidate.id.toLowerCase()}-r${priorRevision.number}-authorizer-${workflowAttempt}`;
  const runId = `run-${reservationId}`;
  const reservedAt = new Date(sourceReservedAt - 20_000).toISOString();
  const startedAt = new Date(sourceReservedAt - 19_000).toISOString();
  const completedAt = new Date(sourceReservedAt - 18_000).toISOString();
  const evaluatedAt = new Date(sourceReservedAt - 17_000).toISOString();
  const artifactCreatedAt = new Date(sourceReservedAt - 16_000).toISOString();
  const gateResult = {
    schemaVersion: 1,
    stage,
    verdict: "REPAIR",
    reportedVerdict: "REPAIR",
    candidateId: candidate.id,
    candidateRevision: priorRevision.number,
    evaluatedAt,
    blockingReasons: ["P1: exact historical repair is required."],
    findings: [
      {
        severity: "P1",
        title: "Historical candidate repair",
        detail: "This exact prior candidate required the persisted repair revision.",
        file: "server/api.mjs",
        line: 1,
        candidateId: candidate.id,
        candidateRevision: priorRevision.number,
        bindingExplicit: true,
      },
    ],
  };
  const run = {
    id: runId,
    stage,
    kind: "review",
    role: "dev-review",
    status: "completed",
    startedAt,
    completedAt,
    candidateId: candidate.id,
    candidateRevision: priorRevision.number,
    candidateHeadRevision: priorRevision.headRevision,
    workPackageId: null,
    attempt: 1,
    workflowAttempt,
    workflowReservationId: reservationId,
    gateResult,
  };
  const artifactId = attachLinkedArtifact(draft, run, {
    candidateId: candidate.id,
    candidateRevision: priorRevision.number,
    createdAt: artifactCreatedAt,
    gateResult,
  });
  draft.runs.push(run);
  Object.assign(revision, {
    authorizingGateStage: stage,
    authorizingGateWorkflowAttempt: workflowAttempt,
    authorizingGateReservationId: reservationId,
    authorizingGateReservedAt: reservedAt,
    authorizingGateRunId: runId,
    authorizingGateArtifactId: artifactId,
  });
}

function attachAssemblyLineage(
  draft,
  candidate,
  {
    workflowAttempt = 1,
    reservationId = `reservation-${draft.id}-assembly-${workflowAttempt}`,
    reservedAt = "2026-08-04T00:00:00.000Z",
    createdAt = "2026-08-04T00:01:00.000Z",
  } = {},
) {
  const packageHeadRevision = `package-${draft.id.toLowerCase()}-s1`;
  draft.attemptsByStage.implement ??= workflowAttempt;
  draft.workPackages = [
    {
      id: "S1",
      status: "integrated",
      batch: 1,
      headRevision: packageHeadRevision,
    },
  ];
  Object.assign(candidate, {
    members: [{ packageId: "S1", headRevision: packageHeadRevision, order: 1 }],
    sourceWorkflowAttempt: workflowAttempt,
    sourceWorkflowReservationId: reservationId,
    revisions: [
      {
        number: 1,
        headRevision: candidate.headRevision,
        reason: "assembly",
        sourceWorkflowAttempt: workflowAttempt,
        sourceWorkflowReservationId: reservationId,
        sourceWorkflowReservedAt: reservedAt,
        createdAt,
      },
    ],
  });
  draft.stageRunReservations.implement = {
    id: reservationId,
    stage: "implement",
    kind: "implementation",
    workflowAttempt,
    candidateId: null,
    candidateRevision: null,
    candidateHeadRevision: null,
    authorizedRunScopes: ["S1"],
    reservedAt,
  };
  attachCandidateProducerEvidence(draft, candidate);
  return candidate;
}

function attachExactCandidateGate(
  draft,
  candidate,
  {
    stage = "dev-review",
    workflowAttempt = Math.max(1, draft.attemptsByStage?.[stage] ?? 0),
    reservationId = `reservation-${draft.id}-${stage}-${workflowAttempt}`,
    reservedAt = "2026-08-04T00:01:30.000Z",
    findings = null,
    blockingReasons = null,
  } = {},
) {
  draft.attemptsByStage[stage] = workflowAttempt;
  draft.stageRunReservations[stage] = {
    id: reservationId,
    stage,
    kind: stage === "dev-review" ? "review" : stage,
    workflowAttempt,
    candidateId: candidate.id,
    candidateRevision: candidate.revisionNumber,
    candidateHeadRevision: candidate.headRevision,
    authorizedRunScopes: [],
    reservedAt,
  };
  const runId = `run-${reservationId}`;
  const reservedAtMs = Date.parse(reservedAt);
  const startedAt = new Date(reservedAtMs + 1_000).toISOString();
  const completedAt = new Date(reservedAtMs + 2_000).toISOString();
  const evaluatedAt = new Date(reservedAtMs + 3_000).toISOString();
  const artifactCreatedAt = new Date(reservedAtMs + 4_000).toISOString();
  const gateResult = {
    schemaVersion: 1,
    stage,
    verdict: "REPAIR",
    reportedVerdict: "REPAIR",
    candidateId: candidate.id,
    candidateRevision: candidate.revisionNumber,
    evaluatedAt,
    blockingReasons: blockingReasons ?? ["P1: exact candidate repair is required."],
    findings: findings ?? [
      {
        severity: "P1",
        title: "Exact candidate repair",
        detail: "The exact candidate requires a repair before its gates can pass.",
        file: "server/api.mjs",
        line: 1,
        candidateId: candidate.id,
        candidateRevision: candidate.revisionNumber,
        bindingExplicit: true,
      },
    ],
  };
  const run = {
    id: runId,
    stage,
    kind: stage === "dev-review" ? "review" : stage,
    role: stage,
    status: "completed",
    startedAt,
    completedAt,
    candidateId: candidate.id,
    candidateRevision: candidate.revisionNumber,
    candidateHeadRevision: candidate.headRevision,
    workPackageId: null,
    attempt: draft.runs.filter((run) => run.stage === stage).length + 1,
    workflowAttempt,
    workflowReservationId: reservationId,
    gateResult,
  };
  attachLinkedArtifact(draft, run, {
    candidateId: candidate.id,
    candidateRevision: candidate.revisionNumber,
    createdAt: artifactCreatedAt,
    gateResult,
  });
  draft.runs.push(run);
  return { ...draft.stageRunReservations[stage], sourceArtifactId: run.artifactId, sourceRunId: runId };
}

function threeRevisionCandidate(status = "ready_for_review") {
  return {
    id: "C1",
    revisionNumber: 3,
    headRevision: "candidate-c1-r3",
    status,
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
}

function twoRevisionCandidate(status = "ready_for_review") {
  return {
    id: "C1",
    revisionNumber: 2,
    headRevision: "candidate-c1-r2",
    status,
    sourceWorkflowAttempt: 2,
    sourceWorkflowReservationId: "reservation-c1-r1-repair-2",
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
    ],
  };
}

for (const [name, payload] of [
  ["rejects invalid workflow values", { workflow: "review" }],
  ["rejects missing workflow values", {}],
  ["rejects empty workflow values", { workflow: "" }],
]) {
  test(name, async () => {
    const { directory, origin, server } = await createServer();
    try {
      const response = await createTask(origin, {
        title: "Invalid workflow task",
        description: "This should fail.",
        repositoryPath: directory,
        ...payload,
      });
      assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), { error: "invalid workflow" });
    } finally {
      await cleanup(server, directory);
    }
  });
}

for (const sqlite of [false, true]) {
  test(`continues an approved investigation as one linked implementation task${sqlite ? " in SQLite" : ""}`, async () => {
    const { directory, origin, server, store, startedIdRef, startedKindRef } = await createServer({ sqlite });
    try {
      const response = await createTask(origin, {
        title: "Investigate the delivery boundary",
        description: "Produce an approved, repository-grounded implementation contract.",
        repositoryPath: directory,
        workflow: "investigate",
        priority: "high",
      });
      const { task: source } = await response.json();
      await store.update(source.id, (draft) => {
        draft.status = "completed";
        draft.currentStage = "specification";
        draft.completedStages = ["triage", "scouts", "grill", "specification"];
        draft.completedAt = "2026-08-10T01:00:00.000Z";
        draft.artifacts.push({
          id: "source-specification",
          runId: "source-run",
          stage: "specification",
          name: "task-specification.md",
          kind: "markdown",
          content: "# Approved investigation handoff",
          createdAt: "2026-08-10T00:59:00.000Z",
          model: "gpt-5.6-luna",
          usage: { inputTokens: 10, cachedInputTokens: 5, outputTokens: 2, totalTokens: 12, cost: 0.001 },
        });
        draft.runs.push({
          id: "source-run",
          stage: "specification",
          kind: "agent",
          role: "specification",
          status: "completed",
          startedAt: "2026-08-10T00:57:00.000Z",
          completedAt: "2026-08-10T00:59:00.000Z",
          artifactId: "source-specification",
          usage: { inputTokens: 10, cachedInputTokens: 5, outputTokens: 2, totalTokens: 12 },
        });
        draft.decisions.push({
          id: "source-decision",
          question: "Preserve the current contract?",
          answer: "Yes.",
          createdAt: "2026-08-10T00:58:00.000Z",
        });
        draft.approvals.push({
          id: "source-approval",
          stage: "specification",
          note: "Approved for a separate implementation task.",
          createdAt: "2026-08-10T01:00:00.000Z",
        });
      });

      const continuedResponses = await Promise.all([
        fetch(`${origin}/api/tasks/${source.id}/continue-implementation`, { method: "POST" }),
        fetch(`${origin}/api/tasks/${source.id}/continue-implementation`, { method: "POST" }),
      ]);
      assert.deepEqual(continuedResponses.map((item) => item.status).sort(), [200, 201]);
      const continuedBodies = await Promise.all(continuedResponses.map((item) => item.json()));
      const first = continuedBodies.find((item) => item.created);
      assert.ok(first);
      assert.equal(continuedBodies.find((item) => !item.created).task.id, first.task.id);
      assert.equal(first.created, true);
      assert.equal(first.task.workflow, "implement");
      assert.equal(first.task.continuedFromTaskId, source.id);
      assert.equal(first.task.currentStage, "plan");
      assert.deepEqual(first.task.completedStages, ["triage", "scouts", "grill", "specification"]);
      assert.equal(first.task.artifacts[0].content, "# Approved investigation handoff");
      assert.equal(first.task.artifacts[0].sourceTaskId, source.id);
      assert.equal(first.task.artifacts[0].sourceArtifactId, "source-specification");
      assert.equal(first.task.artifacts[0].model, null);
      assert.equal(
        first.task.runs.length,
        0,
        "the implementation task does not claim imported source run telemetry",
      );
      assert.equal(first.task.decisions[0].sourceDecisionId, "source-decision");
      assert.equal(startedIdRef(), first.task.id);
      assert.equal(startedKindRef(), "planning");

      const retainedSource = await store.get(source.id);
      assert.equal(retainedSource.status, "completed");
      assert.equal(retainedSource.workflow, "investigate");
      assert.equal(retainedSource.continuedByTaskId, first.task.id);
      assert.equal(retainedSource.runs[0].id, "source-run");
      assert.match(
        retainedSource.events.at(-1).detail,
        /complete read-only investigation record, including its original run telemetry/i,
      );

      const repeated = await fetch(`${origin}/api/tasks/${source.id}/continue-implementation`, {
        method: "POST",
      });
      assert.equal(repeated.status, 200);
      const second = await repeated.json();
      assert.equal(second.created, false);
      assert.equal(second.task.id, first.task.id);
      assert.equal((await store.list()).length, 2);
    } finally {
      await cleanup(server, directory);
    }
  });
}

function rawHttpRequest(origin, pathname, { method, headers, body }) {
  const url = new URL(origin);
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      { hostname: url.hostname, port: url.port, path: pathname, method, headers },
      (response) => {
        response.resume();
        response.on("end", () => resolve({ status: response.statusCode }));
      },
    );
    request.on("error", reject);
    request.end(body);
  });
}

for (const [name, payload] of [
  ["rejects missing grill question IDs", { answer: "Preserve compatibility" }],
  ["rejects blank grill question IDs", { questionId: "   ", answer: "Preserve compatibility" }],
  ["rejects missing grill answers", { questionId: "Q1" }],
  ["rejects blank grill answers", { questionId: "Q1", answer: "   " }],
]) {
  test(name, async () => {
    const { directory, origin, server, grillAnswerRef } = await createServer();
    try {
      const response = await createTask(origin, {
        title: "Grill boundary validation",
        description: "Keep malformed grill answers out of orchestration.",
        repositoryPath: directory,
        workflow: "implement",
      });
      const { task } = await response.json();
      const answerResponse = await fetch(`${origin}/api/tasks/${task.id}/grill/answers`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      assert.equal(answerResponse.status, 400);
      assert.deepEqual(await answerResponse.json(), { error: "Question ID and answer are required." });
      assert.equal(grillAnswerRef(), null);
    } finally {
      await cleanup(server, directory);
    }
  });
}

export {
  assert,
  attachAssemblyLineage,
  attachCandidateProducerEvidence,
  attachExactCandidateGate,
  attachHistoricalRepairAuthorizer,
  attachLinkedArtifact,
  attachRunArtifact,
  bindLatestWorkflowAttempt,
  CANONICAL_RUN_STAGES,
  cleanup,
  createApiServer,
  createServer,
  createTask,
  defaultWorktreeRoot,
  exec,
  execFile,
  fetch,
  formatApprovalStage,
  formatApprovalTimestamp,
  GitWorktreeManager,
  getApprovalHistory,
  git,
  httpRequest,
  JsonTaskStore,
  mkdir,
  mkdtemp,
  nativeFetch,
  os,
  parseFocusedTestEvidence,
  path,
  promisify,
  RUN_ACTIVITY_EVENT_LIMIT,
  RUNTIME_FRESHNESS_REASONS,
  rawHttpRequest,
  readFile,
  recordWorkflowProfile,
  refreshGateFreshness,
  rm,
  SqliteTaskStore,
  stat,
  TEST_CSRF_TOKEN,
  threeRevisionCandidate,
  twoRevisionCandidate,
  writeFile,
};
