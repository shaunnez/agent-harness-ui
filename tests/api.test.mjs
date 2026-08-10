import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createApiServer } from "../server/api.mjs";
import { defaultWorktreeRoot, GitWorktreeManager } from "../server/git-worktree.mjs";
import { JsonTaskStore } from "../server/store.mjs";
import { SqliteTaskStore } from "../server/sqlite-store.mjs";
import { parseFocusedTestEvidence } from "../server/structured-output.mjs";
import {
  attachRunArtifact,
  CANONICAL_RUN_STAGES,
  refreshGateFreshness,
  RUNTIME_FRESHNESS_REASONS,
  RUN_ACTIVITY_EVENT_LIMIT,
} from "../server/run-activity.mjs";
import { formatApprovalStage, formatApprovalTimestamp, getApprovalHistory } from "../src/components/runtimeApprovalHistory.js";
import { promisify } from "node:util";
import { recordWorkflowProfile } from "../server/workflow-profiles.mjs";

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
  let completedMergedTask = null;
  let refreshedCandidateTask = null;
  let retriedTestTask = null;
  const orchestrator = {
    status: async () => ({ available: true, authenticated: true, authMethod: "ChatGPT" }),
    start(id, kind) {
      startedId = id;
      startedKind = kind;
      return true;
    },
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
    async completeMergedTask(id, note) {
      completedMergedTask = { id, note };
    },
    async refreshCandidate(id) {
      refreshedCandidateTask = id;
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
    completedMergedTaskRef: () => completedMergedTask,
    refreshedCandidateTaskRef: () => refreshedCandidateTask,
    retriedTestTaskRef: () => retriedTestTask,
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
  const expectedRun = kind === "repair"
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
  const unboundRuns = stageRuns.filter((run) => run.workflowAttempt == null && run.workflowReservationId == null);
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

function attachLinkedArtifact(draft, run, {
  candidateId = null,
  candidateRevision = null,
  createdAt = "2026-08-04T00:06:00.000Z",
  workPackageId = null,
  gateResult = null,
} = {}) {
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
    if (draft.runs.some((run) => run.workflowReservationId === revision.sourceWorkflowReservationId)) continue;
    const priorRevision = revision.number > 1
      ? candidate.revisions.find((item) => item.number === revision.number - 1)
      : null;
    const run = revision.number === 1
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
    findings: [{
      severity: "P1",
      title: "Historical candidate repair",
      detail: "This exact prior candidate required the persisted repair revision.",
      file: "server/api.mjs",
      line: 1,
      candidateId: candidate.id,
      candidateRevision: priorRevision.number,
      bindingExplicit: true,
    }],
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

function attachAssemblyLineage(draft, candidate, {
  workflowAttempt = 1,
  reservationId = `reservation-${draft.id}-assembly-${workflowAttempt}`,
  reservedAt = "2026-08-04T00:00:00.000Z",
  createdAt = "2026-08-04T00:01:00.000Z",
} = {}) {
  const packageHeadRevision = `package-${draft.id.toLowerCase()}-s1`;
  draft.attemptsByStage.implement ??= workflowAttempt;
  draft.workPackages = [{
    id: "S1",
    status: "integrated",
    batch: 1,
    headRevision: packageHeadRevision,
  }];
  Object.assign(candidate, {
    members: [{ packageId: "S1", headRevision: packageHeadRevision, order: 1 }],
    sourceWorkflowAttempt: workflowAttempt,
    sourceWorkflowReservationId: reservationId,
    revisions: [{
      number: 1,
      headRevision: candidate.headRevision,
      reason: "assembly",
      sourceWorkflowAttempt: workflowAttempt,
      sourceWorkflowReservationId: reservationId,
      sourceWorkflowReservedAt: reservedAt,
      createdAt,
    }],
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

function attachExactCandidateGate(draft, candidate, {
  stage = "dev-review",
  workflowAttempt = Math.max(1, draft.attemptsByStage?.[stage] ?? 0),
  reservationId = `reservation-${draft.id}-${stage}-${workflowAttempt}`,
  reservedAt = "2026-08-04T00:01:30.000Z",
  findings = null,
  blockingReasons = null,
} = {}) {
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
    findings: findings ?? [{
      severity: "P1",
      title: "Exact candidate repair",
      detail: "The exact candidate requires a repair before its gates can pass.",
      file: "server/api.mjs",
      line: 1,
      candidateId: candidate.id,
      candidateRevision: candidate.revisionNumber,
      bindingExplicit: true,
    }],
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

test("creates, lists, and starts a local task", async () => {
  const { directory, origin, server, store, startedIdRef, recordedDecisionRef, approvedSpecificationRef } =
    await createServer();
  try {
    const createResponse = await createTask(origin, {
      title: "Real task",
      description: "Inspect the local repository.",
      repositoryPath: directory,
      workflow: "investigate",
      priority: "high",
    });
    assert.equal(createResponse.status, 201);
    const { task } = await createResponse.json();
    assert.equal(task.id, "AH-001");
    assert.equal(task.workflow, "investigate");
    assert.deepEqual(
      task.stageRunLimits,
      Object.fromEntries(CANONICAL_RUN_STAGES.map((stage) => [stage, 3])),
    );

    const prematureReview = await fetch(`${origin}/api/tasks/${task.id}/review`, { method: "POST" });
    assert.equal(prematureReview.status, 409);

    const listResponse = await fetch(`${origin}/api/tasks`);
    assert.equal(listResponse.status, 200);
    const list = await listResponse.json();
    assert.equal(list.tasks.length, 1);

    const decisionResponse = await fetch(`${origin}/api/tasks/${task.id}/decisions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question: "Compatibility", answer: "Preserve it." }),
    });
    assert.equal(decisionResponse.status, 201);
    assert.deepEqual(recordedDecisionRef(), {
      id: task.id,
      question: "Compatibility",
      answer: "Preserve it.",
    });

    const runResponse = await fetch(`${origin}/api/tasks/${task.id}/run`, { method: "POST" });
    assert.equal(runResponse.status, 202);
    assert.equal(startedIdRef(), task.id);

    await store.update(task.id, (draft) => {
      draft.status = "awaiting-spec-approval";
    });
    const approvalResponse = await fetch(`${origin}/api/tasks/${task.id}/approve-spec`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ note: "Approved for handoff." }),
    });
    assert.equal(approvalResponse.status, 200);
    assert.deepEqual(approvedSpecificationRef(), { id: task.id, note: "Approved for handoff." });
  } finally {
    await cleanup(server, directory);
  }
});

test("persists deterministic workflow-profile selection and permits an operator override before implementation", async () => {
  const { directory, origin, server } = await createServer();
  try {
    const createResponse = await createTask(origin, {
      title: "Fix one copy label",
      description: "A tiny isolated wording change.",
      repositoryPath: directory,
      workflow: "implement",
      priority: "low",
      workflowProfile: "auto",
    });
    assert.equal(createResponse.status, 201);
    const created = (await createResponse.json()).task;
    assert.equal(created.workflowProfile.selected, "fast");
    assert.equal(created.workflowProfile.source, "automatic");

    const response = await fetch(`${origin}/api/tasks/${created.id}/workflow-profile`, {
      method: "PUT",
      body: JSON.stringify({ profile: "standard", reason: "Repository ownership is broader than the initial brief." }),
    });
    assert.equal(response.status, 200);
    const updated = (await response.json()).task;
    assert.equal(updated.workflowProfile.selected, "standard");
    assert.equal(updated.workflowProfile.source, "operator");
    assert.match(updated.workflowProfile.reason, /ownership is broader/);
    assert.equal(updated.workflowProfile.history.length, 2);
  } finally {
    await cleanup(server, directory);
  }
});

test("dispatches the complete-merged action to the orchestrator and reports 404 for an unknown task", async () => {
  const { directory, origin, server, completedMergedTaskRef } = await createServer();
  try {
    const createResponse = await createTask(origin, {
      title: "Promote a merged candidate",
      description: "Move a merged-to-target task onward to completed.",
      repositoryPath: directory,
      workflow: "implement",
    });
    const { task } = await createResponse.json();

    const missing = await fetch(`${origin}/api/tasks/AH-404/complete-merged`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ note: "" }),
    });
    assert.equal(missing.status, 404);
    assert.equal(completedMergedTaskRef(), null);

    const response = await fetch(`${origin}/api/tasks/${task.id}/complete-merged`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ note: "Promoted onward to the shared integration branch." }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { completed: true });
    assert.deepEqual(completedMergedTaskRef(), {
      id: task.id,
      note: "Promoted onward to the shared integration branch.",
    });
  } finally {
    await cleanup(server, directory);
  }
});

test("dispatches candidate refresh and same-candidate Test retry actions", async () => {
  const {
    directory,
    origin,
    server,
    refreshedCandidateTaskRef,
    retriedTestTaskRef,
  } = await createServer();
  try {
    const createResponse = await createTask(origin, {
      title: "Recover a candidate",
      description: "Exercise explicit recovery actions.",
      repositoryPath: directory,
      workflow: "implement",
    });
    const { task } = await createResponse.json();

    const refreshResponse = await fetch(`${origin}/api/tasks/${task.id}/refresh-candidate`, { method: "POST" });
    assert.equal(refreshResponse.status, 200);
    assert.equal((await refreshResponse.json()).refreshed, true);
    assert.equal(refreshedCandidateTaskRef(), task.id);

    const retryResponse = await fetch(`${origin}/api/tasks/${task.id}/retry-test`, { method: "POST" });
    assert.equal(retryResponse.status, 202);
    assert.deepEqual(await retryResponse.json(), { started: true });
    assert.equal(retriedTestTaskRef(), task.id);
  } finally {
    await cleanup(server, directory);
  }
});

test("rejects invalid closure reasons without mutating task state", async () => {
  const { directory, origin, server, store } = await createServer();
  try {
    const response = await createTask(origin, {
      title: "Invalid closure reason",
      description: "Unsupported closure metadata must fail closed.",
      repositoryPath: directory,
      workflow: "implement",
    });
    const { task } = await response.json();
    const unchanged = await store.get(task.id);
    const unchangedState = {
      status: unchanged.status,
      closure: unchanged.closure,
      events: unchanged.events,
    };

    for (const payload of [{}, { reason: 42 }, { reason: "obsolete" }]) {
      const closeResponse = await fetch(`${origin}/api/tasks/${task.id}/close`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      assert.equal(closeResponse.status, 400);
      const body = await closeResponse.json();
      assert.deepEqual(Object.keys(body), ["error"]);
      assert.equal(typeof body.error, "string");

      const current = await store.get(task.id);
      assert.deepEqual(
        { status: current.status, closure: current.closure, events: current.events },
        unchangedState,
      );
    }
  } finally {
    await cleanup(server, directory);
  }
});

test("rejects invalid supersededBy values without mutating task state", async () => {
  const { directory, origin, server, store } = await createServer();
  try {
    const response = await createTask(origin, {
      title: "Invalid supersession metadata",
      description: "Superseded closures require a usable replacement identifier.",
      repositoryPath: directory,
      workflow: "implement",
    });
    const { task } = await response.json();
    const unchanged = await store.get(task.id);
    const unchangedState = {
      status: unchanged.status,
      closure: unchanged.closure,
      events: unchanged.events,
    };

    for (const payload of [
      { reason: "superseded" },
      { reason: "superseded", supersededBy: "   " },
      { reason: "superseded", supersededBy: 123 },
    ]) {
      const closeResponse = await fetch(`${origin}/api/tasks/${task.id}/close`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      assert.equal(closeResponse.status, 400);
      const body = await closeResponse.json();
      assert.deepEqual(Object.keys(body), ["error"]);
      assert.equal(typeof body.error, "string");

      const current = await store.get(task.id);
      assert.deepEqual(
        { status: current.status, closure: current.closure, events: current.events },
        unchangedState,
      );
    }
  } finally {
    await cleanup(server, directory);
  }
});

test("normalizes valid supersession and clears supersededBy for other closure reasons", async () => {
  const { directory, origin, server, store } = await createServer();
  try {
    const supersededResponse = await createTask(origin, {
      title: "Valid supersession metadata",
      description: "A valid replacement identifier is normalized before persistence.",
      repositoryPath: directory,
      workflow: "implement",
    });
    const { task: supersededTask } = await supersededResponse.json();
    const closeSupersededResponse = await fetch(`${origin}/api/tasks/${supersededTask.id}/close`, {
      method: "POST",
      body: JSON.stringify({ reason: "superseded", supersededBy: "  AH-202  " }),
    });
    assert.equal(closeSupersededResponse.status, 200);
    const closedSuperseded = await closeSupersededResponse.json();
    assert.equal(closedSuperseded.task.closure.supersededBy, "AH-202");
    assert.equal((await store.get(supersededTask.id)).closure.supersededBy, "AH-202");

    for (const reason of ["not-needed", "duplicate"]) {
      const nonSupersededResponse = await createTask(origin, {
        title: `Non-superseded ${reason}`,
        description: "Non-superseded reasons do not retain replacement identifiers.",
        repositoryPath: directory,
        workflow: "implement",
      });
      const { task } = await nonSupersededResponse.json();
      const closeResponse = await fetch(`${origin}/api/tasks/${task.id}/close`, {
        method: "POST",
        body: JSON.stringify({ reason, supersededBy: "AH-202" }),
      });
      assert.equal(closeResponse.status, 200);
      const closed = await closeResponse.json();
      assert.equal(closed.task.closure.reason, reason);
      assert.equal(closed.task.closure.supersededBy, null);
      assert.equal((await store.get(task.id)).closure.supersededBy, null);
    }
  } finally {
    await cleanup(server, directory);
  }
});

test("rejects closing a task while merge reconciliation is pending", async () => {
  const { directory, origin, server, store } = await createServer();
  try {
    const response = await createTask(origin, {
      title: "Pending merge reconciliation",
      description: "Preserve approval finalization after the Git fast-forward starts.",
      repositoryPath: directory,
      workflow: "implement",
    });
    const { task } = await response.json();
    await store.update(task.id, (draft) => {
      draft.status = "merging";
      draft.currentStage = "approval";
      draft.mergeIntent = {
        status: "pending",
        candidateId: "C1",
        candidateRevision: 1,
        candidateHeadRevision: "candidate-c1-r1",
        targetBranch: "main",
        targetHeadRevision: "target-r1",
        mergeMethod: "fast-forward",
        requestedAt: "2026-08-04T00:00:00.000Z",
      };
    });

    const closeResponse = await fetch(`${origin}/api/tasks/${task.id}/close`, {
      method: "POST",
      body: JSON.stringify({ reason: "not-needed", note: "Close during merge." }),
    });
    assert.equal(closeResponse.status, 409);
    assert.match((await closeResponse.json()).error, /pending merge reconciliation/i);
    const unchanged = await store.get(task.id);
    assert.equal(unchanged.status, "merging");
    assert.equal(unchanged.mergeIntent.status, "pending");
    assert.equal(unchanged.closure, null);
  } finally {
    await cleanup(server, directory);
  }
});

test("atomically rejects close when merge reconciliation begins after the initial read", async () => {
  let taskId = null;
  const { directory, origin, server, store } = await createServer({
    async beforeTransition(targetStore, id) {
      if (id !== taskId) return;
      await targetStore.update(id, (draft) => {
        draft.status = "merging";
        draft.currentStage = "approval";
        draft.mergeIntent = {
          status: "pending",
          candidateId: "C1",
          candidateRevision: 1,
          candidateHeadRevision: "candidate-c1-r1",
          targetBranch: "main",
          targetHeadRevision: "target-r1",
          mergeMethod: "fast-forward",
          requestedAt: "2026-08-04T00:00:00.000Z",
        };
      });
    },
  });
  try {
    const response = await createTask(origin, {
      title: "Close merge race",
      description: "A pending close must lose to merge reconciliation.",
      repositoryPath: directory,
      workflow: "implement",
    });
    const { task } = await response.json();
    taskId = task.id;

    const closeResponse = await fetch(`${origin}/api/tasks/${task.id}/close`, {
      method: "POST",
      body: JSON.stringify({ reason: "not-needed", note: "Racing close." }),
    });
    assert.equal(closeResponse.status, 409);
    assert.match((await closeResponse.json()).error, /state changed|merge reconciliation/i);
    const preserved = await store.get(task.id);
    assert.equal(preserved.status, "merging");
    assert.equal(preserved.mergeIntent.status, "pending");
    assert.equal(preserved.closure, null);
    assert.doesNotMatch(preserved.events.map((event) => event.title).join("\n"), /Task closed/);
  } finally {
    await cleanup(server, directory);
  }
});

test("returns backward-compatible structured run activity through task APIs", async () => {
  const { directory, origin, server, store } = await createServer();
  try {
    const response = await createTask(origin, {
      title: "Structured run API",
      description: "Expose only telemetry retained from the runtime.",
      repositoryPath: directory,
      workflow: "investigate",
      priority: "medium",
    });
    const { task } = await response.json();
    await store.update(task.id, (draft) => {
      draft.runs.push({
        id: "RUN-API",
        kind: "agent",
        status: "completed",
        stage: "triage",
        role: "triage",
        model: "gpt-5.6-luna",
        reasoning: "xhigh",
        startedAt: "2026-08-03T00:00:00.000Z",
        completedAt: "2026-08-03T00:00:01.000Z",
        durationMs: 1_000,
        artifactId: null,
        usage: { inputTokens: 10, cachedInputTokens: 4, outputTokens: 2, totalTokens: 12, credits: 0.1, cost: 0.001 },
        credits: 0.1,
        apiEstimate: 0.001,
        candidateId: null,
        candidateRevision: null,
        workPackageId: null,
        attempt: 1,
        retryOfRunId: null,
        repairOfRunId: null,
        toolCalls: [{ id: "cmd-api", name: "command_execution", category: "repository-command", phase: "completed", result: "Exit code 0" }],
        test: null,
        gateResult: null,
        error: null,
        source: "codex-jsonl",
      });
      draft.events.push({
        id: "event-api",
        at: "2026-08-03T00:00:01.000Z",
        category: "tool",
        tone: "success",
        stage: "triage",
        title: "Repository command completed",
        detail: "git status --short",
        runId: "RUN-API",
        toolCall: draft.runs[0].toolCalls[0],
      });
    });

    const detail = await (await fetch(`${origin}/api/tasks/${task.id}`)).json();
    const list = await (await fetch(`${origin}/api/tasks`)).json();
    const health = await (await fetch(`${origin}/api/health`)).json();
    assert.equal(health.runtimeSchemaVersion, 8);
    assert.equal(detail.task.runs[0].id, "RUN-API");
    assert.equal(detail.task.runs[0].toolCalls[0].result, "Exit code 0");
    assert.equal(detail.task.events.at(-1).runId, "RUN-API");
    assert.equal("runs" in list.tasks[0], false);
    assert.equal("events" in list.tasks[0], false);
    assert.equal(list.tasks[0].runCount, 1);
    assert.equal(list.tasks[0].eventCount, 2);
  } finally {
    await cleanup(server, directory);
  }
});

test("serves lightweight task projections, paginated retained evidence, and response metrics", async () => {
  const metrics = [];
  const { directory, origin, server, store } = await createServer({
    reportHttpMetric: (metric) => metrics.push(metric),
  });
  try {
    const response = await createTask(origin, {
      title: "Paged evidence",
      description: "Keep heavy evidence outside list and core polling payloads.",
      repositoryPath: directory,
      workflow: "implement",
    });
    const { task } = await response.json();
    await store.update(task.id, (draft) => {
      for (let index = 1; index <= 3; index += 1) {
        draft.artifacts.push({
          id: `artifact-${index}`,
          stage: "triage",
          name: `artifact-${index}.md`,
          kind: "markdown",
          content: `secret retained content ${index}`,
          createdAt: `2026-08-09T00:00:0${index}.000Z`,
          model: "gpt-5.6-luna",
          usage: { inputTokens: index, cachedInputTokens: 0, outputTokens: 1, totalTokens: index + 1 },
        });
        draft.runs.push({ id: `run-${index}`, stage: "triage", startedAt: `2026-08-09T00:00:0${index}.000Z` });
        draft.events.push({
          id: `event-${index}`,
          at: `2026-08-09T00:00:0${index}.000Z`,
          category: "agent",
          tone: "info",
          stage: "triage",
          title: `Agent event ${index}`,
          detail: `detail ${index}`,
        });
      }
    });

    const listResponse = await fetch(`${origin}/api/tasks`);
    const list = await listResponse.json();
    assert.equal(list.tasks[0].artifactCount, 3);
    assert.equal("content" in list.tasks[0].artifacts[0], false);
    assert.equal("runs" in list.tasks[0], false);
    assert.equal("events" in list.tasks[0], false);
    assert.ok(Number(listResponse.headers.get("content-length")) > 0);
    assert.equal(
      listResponse.headers.get("content-length"),
      listResponse.headers.get("x-agent-harness-response-bytes"),
    );
    assert.match(listResponse.headers.get("server-timing"), /^app;dur=/);

    const core = await (await fetch(`${origin}/api/tasks/${task.id}?view=core`)).json();
    assert.equal(core.task.artifactCount, 3);
    assert.equal("events" in core.task, false);
    assert.equal("runs" in core.task, false);

    const firstArtifacts = await (await fetch(`${origin}/api/tasks/${task.id}/artifacts?limit=2`)).json();
    assert.deepEqual(firstArtifacts.items.map((item) => item.id), ["artifact-3", "artifact-2"]);
    assert.ok(firstArtifacts.nextCursor);
    assert.equal("content" in firstArtifacts.items[0], false);
    const secondArtifacts = await (await fetch(
      `${origin}/api/tasks/${task.id}/artifacts?limit=2&cursor=${encodeURIComponent(firstArtifacts.nextCursor)}`,
    )).json();
    assert.deepEqual(secondArtifacts.items.map((item) => item.id), ["artifact-1"]);

    const artifact = await (await fetch(`${origin}/api/tasks/${task.id}/artifacts/artifact-2`)).json();
    assert.equal(artifact.artifact.content, "secret retained content 2");
    const runs = await (await fetch(`${origin}/api/tasks/${task.id}/runs?limit=2`)).json();
    assert.deepEqual(runs.items.map((item) => item.id), ["run-3", "run-2"]);
    const activity = await (await fetch(`${origin}/api/tasks/${task.id}/activity?filter=agent&limit=2`)).json();
    assert.deepEqual(activity.items.map((item) => item.id), ["event-3", "event-2"]);

    assert.ok(metrics.some((metric) => metric.path === "/api/tasks" && metric.responseBytes > 0));
    assert.ok(metrics.every((metric) => !Object.hasOwn(metric, "body")));
  } finally {
    await cleanup(server, directory);
  }
});

test("serves task summaries, core polling, and retained evidence directly from SQLite", async () => {
  const { directory, origin, server, store } = await createServer({ sqlite: true });
  try {
    const response = await createTask(origin, {
      title: "SQLite API",
      description: "Use normalized runtime persistence through the public API.",
      repositoryPath: directory,
      workflow: "implement",
    });
    assert.equal(response.status, 201);
    const { task } = await response.json();
    await store.update(task.id, (draft) => {
      draft.artifacts.push({
        id: "sqlite-artifact",
        stage: "triage",
        name: "sqlite.md",
        kind: "markdown",
        content: "SQLite retained content",
        createdAt: "2026-08-09T00:00:01.000Z",
        model: "gpt-5.6-luna",
        usage: { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1, totalTokens: 2 },
      });
    });

    const list = await (await fetch(`${origin}/api/tasks`)).json();
    assert.equal(list.tasks[0].artifactCount, 1);
    assert.equal("content" in list.tasks[0].artifacts[0], false);
    const core = await (await fetch(`${origin}/api/tasks/${task.id}?view=core`)).json();
    assert.equal(core.task.artifactCount, 1);
    assert.equal("events" in core.task, false);
    const page = await (await fetch(`${origin}/api/tasks/${task.id}/artifacts?limit=1`)).json();
    assert.equal(page.items[0].id, "sqlite-artifact");
    assert.equal("content" in page.items[0], false);
    const artifact = await (await fetch(`${origin}/api/tasks/${task.id}/artifacts/sqlite-artifact`)).json();
    assert.equal(artifact.artifact.content, "SQLite retained content");
  } finally {
    store.close();
    await cleanup(server, directory);
  }
});

test("retains decisions while store writes cap aggregate telemetry", async () => {
  const { directory, server, store } = await createServer();
  try {
    const task = await store.create({
      title: "Retention boundary",
      description: "Keep decisions through high-volume runtime telemetry.",
      repositoryPath: directory,
      workflow: "investigate",
      priority: "medium",
    });
    await store.update(task.id, (draft) => {
      draft.events.push({ id: "decision-before", category: "decision", title: "Decision retained" });
      draft.events.push(...Array.from({ length: RUN_ACTIVITY_EVENT_LIMIT + 100 }, (_, index) => ({
        id: `tool-${index}`,
        category: "tool",
      })));
    });
    await store.transition(task.id, () => true, (draft) => {
      draft.events.push({ id: "transition-tool", category: "tool" });
    });

    const updated = await store.get(task.id);
    assert.equal(updated.events.some((event) => event.id === "decision-before"), true);
    assert.equal(updated.events.some((event) => event.id === "tool-0"), false);
    assert.equal(
      updated.events.filter((event) => ["activity", "agent", "tool", "artifact"].includes(event.category)).length,
      RUN_ACTIVITY_EVENT_LIMIT,
    );
  } finally {
    await cleanup(server, directory);
  }
});

test("retains decisions when a legacy store is migrated", async () => {
  const { directory, server, store } = await createServer();
  try {
    const task = await store.create({
      title: "Legacy retention boundary",
      description: "Migrate retained decisions without losing audit history.",
      repositoryPath: directory,
      workflow: "investigate",
      priority: "medium",
    });
    const storePath = path.join(directory, "tasks.json");
    const state = JSON.parse(await readFile(storePath, "utf8"));
    const persistedTask = state.tasks.find((item) => item.id === task.id);
    persistedTask.events = [
      { id: "legacy-decision", category: "decision", title: "Legacy decision" },
      ...Array.from({ length: RUN_ACTIVITY_EVENT_LIMIT + 25 }, (_, index) => ({
        id: `legacy-tool-${index}`,
        category: "tool",
      })),
    ];
    state.schemaVersion = 3;
    delete persistedTask.stageRunLimits;
    await writeFile(storePath, `${JSON.stringify(state)}\n`, "utf8");

    const migratedStore = new JsonTaskStore(storePath);
    await migratedStore.init();
    const migrated = await migratedStore.get(task.id);
    assert.equal(migrated.events.some((event) => event.id === "legacy-decision"), true);
    assert.equal(migrated.events.some((event) => event.id === "legacy-tool-0"), false);
    assert.equal(
      migrated.events.filter((event) => ["activity", "agent", "tool", "artifact"].includes(event.category)).length,
      RUN_ACTIVITY_EVENT_LIMIT,
    );
    const migratedAgain = await migratedStore.get(task.id);
    assert.deepEqual(migratedAgain.events, migrated.events);
  } finally {
    await cleanup(server, directory);
  }
});

test("enforces one Host, Origin, content-type, CSRF, and missing-Origin policy across mutations", async () => {
  const { directory, origin, server, store } = await createServer();
  try {
    const payload = JSON.stringify({
      title: "Rejected mutation",
      description: "This request must not cross the local browser boundary.",
      repositoryPath: directory,
      workflow: "investigate",
    });
    const foreignOrigin = await nativeFetch(`${origin}/api/tasks`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-agent-harness-csrf": TEST_CSRF_TOKEN, origin: "https://hostile.example" },
      body: payload,
    });
    assert.equal(foreignOrigin.status, 403);
    const simplePost = await nativeFetch(`${origin}/api/tasks`, {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: payload,
    });
    assert.equal(simplePost.status, 415);
    const missingToken = await nativeFetch(`${origin}/api/tasks`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: payload,
    });
    assert.equal(missingToken.status, 403);
    const hostilePreflight = await nativeFetch(`${origin}/api/tasks`, {
      method: "OPTIONS",
      headers: { origin: "https://hostile.example" },
    });
    assert.equal(hostilePreflight.status, 403);
    const hostileHost = await rawHttpRequest(origin, "/api/tasks", {
      method: "POST",
      headers: { host: "hostile.example", "content-type": "application/json", "x-agent-harness-csrf": TEST_CSRF_TOKEN },
      body: payload,
    });
    assert.equal(hostileHost.status, 403);
    const missingOriginWithToken = await nativeFetch(`${origin}/api/tasks`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-agent-harness-csrf": TEST_CSRF_TOKEN },
      body: "{}",
    });
    assert.equal(missingOriginWithToken.status, 400);

    const mutationTargets = [
      ["PUT", "/api/settings"],
      ["POST", "/api/runtime/pricing/verify"],
      ["POST", "/api/tasks/AH-999/close"],
      ["POST", "/api/tasks/AH-999/evaluation"],
      ["POST", "/api/tasks/AH-999/decisions"],
      ["POST", "/api/tasks/AH-999/grill/answers"],
      ["POST", "/api/tasks/AH-999/grill/finish"],
      ["POST", "/api/tasks/AH-999/run"],
      ["POST", "/api/tasks/AH-999/specification"],
      ["POST", "/api/tasks/AH-999/cancel"],
      ["POST", "/api/tasks/AH-999/approve-merge"],
      ["POST", "/api/tasks/AH-999/refresh-candidate"],
      ["POST", "/api/tasks/AH-999/retry-test"],
      ["POST", "/api/tasks/AH-999/complete-merged"],
    ];
    for (const [method, target] of mutationTargets) {
      const hostile = await nativeFetch(`${origin}${target}`, {
        method,
        headers: { origin: "https://hostile.example", "content-type": "application/json", "x-agent-harness-csrf": TEST_CSRF_TOKEN },
        body: "{}",
      });
      assert.equal(hostile.status, 403, `${method} ${target} must reject a hostile Origin`);
      const wrongType = await nativeFetch(`${origin}${target}`, {
        method,
        headers: { "content-type": "text/plain", "x-agent-harness-csrf": TEST_CSRF_TOKEN },
        body: "{}",
      });
      assert.equal(wrongType.status, 415, `${method} ${target} must reject text/plain`);
      const noToken = await nativeFetch(`${origin}${target}`, {
        method,
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      assert.equal(noToken.status, 403, `${method} ${target} must require CSRF`);
    }
    assert.equal((await store.list()).length, 0);
  } finally {
    await cleanup(server, directory);
  }
});

test("a rotated CSRF token rejects the old value, and runtime status hands out the new one", async () => {
  // The server mints a fresh csrfToken per process (see createApiServer's default of
  // crypto.randomUUID()), so a restart is indistinguishable, from the client's side, from
  // a second server instance minted with a different token. This exercises that boundary
  // directly: src/api.ts's request() helper recovers from exactly this by re-fetching
  // /api/runtime/status and replaying the mutation once, which is verified manually since
  // src/api.ts is TypeScript and not importable from this plain-JS test runner.
  const rotated = await createServer({ csrfToken: "fresh-token-after-restart" });
  try {
    const payload = JSON.stringify({
      title: "Rotated token probe",
      description: "Confirms a token minted before a restart is rejected after one.",
      repositoryPath: rotated.directory,
      workflow: "investigate",
    });
    const rejectedByOldToken = await nativeFetch(`${rotated.origin}/api/tasks`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-agent-harness-csrf": "stale-token-from-before-restart" },
      body: payload,
    });
    assert.equal(rejectedByOldToken.status, 403);
    const rejectedBody = await rejectedByOldToken.json();
    assert.match(rejectedBody.error, /csrf token/i);

    const status = await nativeFetch(`${rotated.origin}/api/runtime/status`);
    assert.equal(status.status, 200);
    const statusBody = await status.json();
    assert.equal(statusBody.csrfToken, "fresh-token-after-restart");

    const acceptedByFreshToken = await nativeFetch(`${rotated.origin}/api/tasks`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-agent-harness-csrf": statusBody.csrfToken },
      body: payload,
    });
    assert.equal(acceptedByFreshToken.status, 201);
  } finally {
    await cleanup(rotated.server, rotated.directory);
  }
});

test("snapshots controlled experiment inputs and reports measured outcomes separately", async () => {
  const { directory, origin, server, store } = await createServer();
  try {
    await git(directory, ["init"]);
    await git(directory, ["config", "user.name", "Agent Harness Test"]);
    await git(directory, ["config", "user.email", "agent-harness@example.test"]);
    await writeFile(path.join(directory, "README.md"), "experiment base\n", "utf8");
    await git(directory, ["add", "README.md"]);
    await git(directory, ["commit", "-m", "experiment base"]);
    const baseSha = (await git(directory, ["rev-parse", "HEAD"])).stdout.trim();

    const createResponse = await createTask(origin, {
      title: "Frozen experiment case",
      description: "Compare the same task brief under an explicit policy variant.",
      repositoryPath: directory,
      workflow: "implement",
      priority: "high",
      experiment: {
        groupId: "overnight-2026-08-03",
        variantId: "opaque-a",
        frozenBaseSha: baseSha,
        acceptanceCriteria: ["The result preserves the runtime contract."],
        verificationCommands: ["npm test"],
      },
    });
    assert.equal(createResponse.status, 201);
    const { task } = await createResponse.json();
    assert.equal(task.experiment.frozenBaseSha, baseSha);
    assert.match(task.experiment.taskBriefHash, /^[a-f0-9]{64}$/);
    assert.deepEqual(task.experiment.policyMatrix, task.agentConfig.stagePolicies);

    await store.update(task.id, (draft) => {
      draft.startedAt = "2026-08-03T00:00:00.000Z";
      draft.completedAt = "2026-08-03T00:10:00.000Z";
      draft.status = "awaiting-human-approval";
      draft.attemptsByStage["dev-review"] = 2;
      draft.candidates.push({ revisions: [{ reason: "assembly" }, { reason: "repair" }] });
      draft.usage = { inputTokens: 100, cachedInputTokens: 40, outputTokens: 20, totalTokens: 120, cost: 0.01, credits: 0.5 };
      const artifact = (stage, content, id) => ({
        id,
        stage,
        name: `${id}.md`,
        kind: "markdown",
        content,
        createdAt: "2026-08-03T00:01:00.000Z",
        startedAt: "2026-08-03T00:00:00.000Z",
        completedAt: "2026-08-03T00:01:00.000Z",
        durationMs: 60_000,
        model: "gpt-5.6-sol",
        reasoning: "high",
        agentRole: stage,
        usage: { inputTokens: 10, cachedInputTokens: 4, outputTokens: 2, totalTokens: 12, cost: 0.001, credits: 0.05 },
        contextManifest: { promptCharacters: 1_000, estimatedPromptTokens: 250 },
        gateResult: {
          verdict: content === "PASS" ? "PASS" : "REPAIR",
          candidateId: "C1",
          candidateRevision: 1,
          evaluatedAt: "2026-08-03T00:01:00.000Z",
          blockingReasons: content === "PASS" ? [] : ["Fixture repair"],
        },
      });
      draft.artifacts.push(
        artifact("dev-review", "REPAIR", "review-1"),
        artifact("dev-review", "PASS", "review-2"),
        artifact("test", "PASS", "test-1"),
      );
    });

    const humanResponse = await fetch(`${origin}/api/tasks/${task.id}/evaluation`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ score: 4, outcome: "accepted", rubric: { correctness: 5, maintainability: 3 }, notes: "Human review" }),
    });
    assert.equal(humanResponse.status, 200);
    const blindResponse = await fetch(`${origin}/api/tasks/${task.id}/evaluation`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "blind", score: 5, outcome: "accepted", rubric: { overall: 5 }, notes: "Locked blind review" }),
    });
    assert.equal(blindResponse.status, 200);

    const summaryResponse = await fetch(`${origin}/api/evaluations/summary`);
    assert.equal(summaryResponse.status, 200);
    const summary = await summaryResponse.json();
    assert.equal(summary.experiments.taskCount, 1);
    assert.equal(summary.observations.evaluatedTasks, 0);
    const variant = summary.experiments.variants[0];
    assert.equal(variant.sampleCount, 1);
    assert.equal(variant.firstPassGateSuccesses, 1);
    assert.equal(variant.firstPassGateSuccessRate, 0.5);
    assert.equal(variant.eventualGateSuccessRate, 1);
    assert.equal(variant.repairCount, 1);
    assert.equal(variant.retryCount, 1);
    assert.equal(variant.averageWallTimeMs, 600_000);
    assert.equal(variant.averageHumanScore, 4);
    assert.equal(variant.averageBlindScore, 5);
    assert.equal(variant.estimatedContextTokens, 750);

    await writeFile(path.join(directory, "README.md"), "repository moved\n", "utf8");
    await git(directory, ["add", "README.md"]);
    await git(directory, ["commit", "-m", "move experiment head"]);
    const movedResponse = await createTask(origin, {
      title: "Stale frozen base",
      description: "Reject a controlled task whose checkout no longer matches its declared base.",
      repositoryPath: directory,
      workflow: "implement",
      priority: "high",
      experiment: {
        groupId: "overnight-2026-08-03",
        variantId: "opaque-b",
        frozenBaseSha: baseSha,
        acceptanceCriteria: ["Reject a moved base."],
        verificationCommands: ["npm test"],
      },
    });
    assert.equal(movedResponse.status, 400);
    assert.match((await movedResponse.json()).error, /checked out at the frozen experiment base/i);
  } finally {
    await cleanup(server, directory);
  }
});

test("persists supported task attachments outside the repository", async () => {
  const { directory, origin, server } = await createServer();
  try {
    const content = "<main>Reference artifact</main>";
    const response = await createTask(origin, {
      title: "Attached evidence",
      description: "Use the supplied HTML as task evidence.",
      repositoryPath: directory,
      workflow: "investigate",
      priority: "medium",
      attachments: [{ name: "reference.html", type: "text/html", size: Buffer.byteLength(content), data: Buffer.from(content).toString("base64") }],
    });
    assert.equal(response.status, 201);
    const { task } = await response.json();
    assert.equal(task.attachments.length, 1);
    assert.equal(task.attachments[0].name, "reference.html");
    assert.equal(await readFile(task.attachments[0].path, "utf8"), content);
    assert.equal(task.attachments[0].path.startsWith(directory), true);
  } finally {
    await cleanup(server, directory);
  }
});

test("exposes a shared runtime schema version on local runtime endpoints", async () => {
  const { directory, origin, server } = await createServer();
  try {
    const healthResponse = await fetch(`${origin}/api/health`);
    assert.equal(healthResponse.status, 200);
    const health = await healthResponse.json();
    assert.equal(Number.isInteger(health.runtimeSchemaVersion), true);

    const runtimeResponse = await fetch(`${origin}/api/runtime/status`);
    assert.equal(runtimeResponse.status, 200);
    const runtime = await runtimeResponse.json();
    assert.equal(Number.isInteger(runtime.runtimeSchemaVersion), true);
    assert.equal(runtime.runtimeSchemaVersion, health.runtimeSchemaVersion);
  } finally {
    await cleanup(server, directory);
  }
});

test("returns live changelog commits, changed files, and a selected file diff", async () => {
  const { directory, origin, server } = await createServer();
  try {
    await exec("git", ["init", "-b", "main"], { cwd: directory });
    await exec("git", ["config", "user.name", "Harness Test"], { cwd: directory });
    await exec("git", ["config", "user.email", "harness@example.test"], { cwd: directory });
    const tracked = path.join(directory, "CHANGELOG_TEST.txt");
    await writeFile(tracked, "first\n", "utf8");
    await exec("git", ["add", "CHANGELOG_TEST.txt"], { cwd: directory });
    await exec("git", ["commit", "-m", "first changelog commit"], { cwd: directory });
    await writeFile(tracked, "first\nsecond\n", "utf8");
    await exec("git", ["add", "CHANGELOG_TEST.txt"], { cwd: directory });
    await exec("git", ["commit", "-m", "second changelog commit"], { cwd: directory });

    const commitsResponse = await fetch(`${origin}/api/changelog`);
    assert.equal(commitsResponse.status, 200);
    const commits = (await commitsResponse.json()).commits;
    assert.equal(commits.length, 2);
    assert.equal(commits[0].subject, "second changelog commit");
    const fullSha = commits[0].sha;
    assert.match(fullSha, /^[0-9a-f]{40}$/i);

    const detailResponse = await fetch(`${origin}/api/changelog/${fullSha}`);
    assert.equal(detailResponse.status, 200);
    const commit = (await detailResponse.json()).commit;
    assert.equal(commit.sha, fullSha);
    assert.equal(commit.files[0].path, "CHANGELOG_TEST.txt");

    const diffResponse = await fetch(`${origin}/api/changelog/${fullSha}/file?path=${encodeURIComponent("CHANGELOG_TEST.txt")}`);
    assert.equal(diffResponse.status, 200);
    const diff = await diffResponse.json();
    assert.equal(diff.sha, fullSha);
    assert.match(diff.diff, /\+second/);
  } finally {
    await cleanup(server, directory);
  }
});

test("rejects noncanonical changelog commit IDs before Git lookup", async () => {
  const { directory, origin, server } = await createServer();
  try {
    const invalidIds = [
      "2f9a8bcd",
      "a".repeat(39),
      "a".repeat(41),
      "a".repeat(63),
      "a".repeat(65),
      "g".repeat(40),
    ];
    for (const commitSha of invalidIds) {
      for (const suffix of ["", "/file?path=CHANGELOG_TEST.txt"]) {
        const response = await fetch(`${origin}/api/changelog/${commitSha}${suffix}`);
        assert.equal(response.status, 400, `${commitSha}${suffix}`);
        assert.deepEqual(await response.json(), {
          error: "Commit ID must be exactly 40 or 64 hexadecimal characters.",
        });
      }
    }
  } finally {
    await cleanup(server, directory);
  }
});

test("persists an allowed Sol model policy and snapshots it on new tasks", async () => {
  const { directory, origin, server } = await createServer();
  try {
    const settingsResponse = await fetch(`${origin}/api/settings`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        grillPolicy: "auto-accept-recommendations",
        allowedModels: ["gpt-5.6-sol", "gpt-5.6-luna"],
        defaultModel: "gpt-5.6-sol",
        defaultReasoning: "xhigh",
      }),
    });
    assert.equal(settingsResponse.status, 200);
    const settings = (await settingsResponse.json()).settings;
    assert.equal(settings.defaultModel, "gpt-5.6-sol");
    assert.equal(settings.defaultReasoning, "xhigh");
    assert.equal(settings.grillPolicy, "auto-accept-recommendations");

    const legacySettingsResponse = await fetch(`${origin}/api/settings`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        allowedModels: ["gpt-5.6-sol", "gpt-5.6-luna"],
        defaultModel: "gpt-5.6-sol",
        defaultReasoning: "xhigh",
      }),
    });
    assert.equal((await legacySettingsResponse.json()).settings.grillPolicy, "auto-accept-recommendations");

    const createResponse = await createTask(origin, {
      title: "Sol task",
      description: "Use the selected model policy.",
      repositoryPath: directory,
      workflow: "investigate",
      priority: "medium",
      model: "gpt-5.6-sol",
      reasoning: "xhigh",
    });
    assert.equal(createResponse.status, 201);
    const task = (await createResponse.json()).task;
    assert.equal(task.agentConfig.model, "gpt-5.6-sol");
    assert.equal(task.agentConfig.reasoning, "xhigh");
    assert.equal(task.agentConfig.stagePolicies.plan.model, "gpt-5.6-sol");
    assert.equal(task.agentConfig.stagePolicies.test.reasoning, "xhigh");
    assert.equal(task.models[0].model, "gpt-5.6-sol");
    assert.equal(task.grillPolicy, "auto-accept-recommendations");

    const invalidPolicyResponse = await fetch(`${origin}/api/settings`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        grillPolicy: "always-automatic",
        allowedModels: ["gpt-5.6-sol", "gpt-5.6-luna"],
        defaultModel: "gpt-5.6-sol",
        defaultReasoning: "xhigh",
      }),
    });
    assert.equal(invalidPolicyResponse.status, 400);
    assert.deepEqual(await invalidPolicyResponse.json(), { error: "Choose a supported Grill interaction policy." });
  } finally {
    await cleanup(server, directory);
  }
});

test("rejects a task model outside the configured allowlist", async () => {
  const { directory, origin, server } = await createServer();
  try {
    await fetch(`${origin}/api/settings`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        allowedModels: ["gpt-5.6-luna"],
        defaultModel: "gpt-5.6-luna",
        defaultReasoning: "medium",
      }),
    });
    const response = await createTask(origin, {
      title: "Disallowed model",
      description: "This should not run with Sol.",
      repositoryPath: directory,
      workflow: "investigate",
      model: "gpt-5.6-sol",
      reasoning: "xhigh",
    });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /allowed runtime list/i);
  } finally {
    await cleanup(server, directory);
  }
});

test("records Grill answers and requires an explicit finish mode", async () => {
  const { directory, origin, server, grillAnswerRef, grillFinishRef } = await createServer();
  try {
    const response = await createTask(origin, {
      title: "Grill contract",
      description: "Persist an authoritative decision frontier.",
      repositoryPath: directory,
      workflow: "implement",
    });
    const { task } = await response.json();
    const bareFinishResponse = await fetch(`${origin}/api/tasks/${task.id}/grill/finish`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ acceptRemaining: true }),
    });
    assert.equal(bareFinishResponse.status, 400);
    assert.deepEqual(await bareFinishResponse.json(), {
      error: "Finishing Grill requires an explicit operator UI action.",
    });
    assert.equal(grillFinishRef(), null, "the AH-016-style bare automation call never reaches orchestration");

    const answerResponse = await fetch(`${origin}/api/tasks/${task.id}/grill/answers`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ questionId: "Q1", answer: "Preserve compatibility", interactionSource: "operator-ui" }),
    });
    assert.equal(answerResponse.status, 201);
    assert.deepEqual(grillAnswerRef(), {
      id: task.id,
      questionId: "Q1",
      answer: "Preserve compatibility",
      source: "operator",
    });

    const finishResponse = await fetch(`${origin}/api/tasks/${task.id}/grill/finish`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ acceptRemaining: true, interactionSource: "operator-ui" }),
    });
    assert.equal(finishResponse.status, 202);
    assert.deepEqual(grillFinishRef(), { id: task.id, acceptRemaining: true, source: "operator" });
  } finally {
    await cleanup(server, directory);
  }
});

test("exposes approval history in the task payload", async () => {
  const { directory, origin, server, store } = await createServer();
  try {
    const response = await createTask(origin, {
      title: "Approval history",
      description: "Return persisted approval records.",
      repositoryPath: directory,
      workflow: "implement",
    });
    const { task } = await response.json();
    await store.update(task.id, (draft) => {
      draft.approvals.push(
        { id: "A1", stage: "specification", note: "Specification approved.", createdAt: "2026-08-01T10:15:00.000Z" },
        { id: "A2", stage: "plan", note: "Plan approved.", createdAt: "2026-08-01T10:20:00.000Z" },
      );
    });

    const fetched = await (await fetch(`${origin}/api/tasks/${task.id}`)).json();
    assert.deepEqual(fetched.task.approvals, [
      { id: "A1", stage: "specification", note: "Specification approved.", createdAt: "2026-08-01T10:15:00.000Z" },
      { id: "A2", stage: "plan", note: "Plan approved.", createdAt: "2026-08-01T10:20:00.000Z" },
    ]);
  } finally {
    await cleanup(server, directory);
  }
});

test("returns persisted focused test evidence without dropping the Markdown artifact", async () => {
  const { directory, origin, server, store } = await createServer();
  try {
    const response = await createTask(origin, {
      title: "Focused test payload",
      description: "Return structured test evidence.",
      repositoryPath: directory,
      workflow: "implement",
    });
    const { task } = await response.json();
    await store.update(task.id, (draft) => {
      draft.status = "ready-for-final-review";
      draft.currentStage = "test";
      draft.artifacts.push({
        id: "artifact-1",
        stage: "test",
        name: "test-c1-r2.md",
        kind: "markdown",
        content:
          "PASS\n\n<focused-test-evidence>\n{\"candidateId\":\"C1\",\"candidateRevision\":2,\"command\":\"npm.cmd run test:runtime\",\"status\":\"passed\",\"durationMs\":900,\"rows\":[{\"id\":\"row-1\",\"candidateId\":\"C1\",\"candidateRevision\":2,\"command\":\"npm.cmd run test:runtime\",\"status\":\"passed\",\"durationMs\":900,\"title\":\"runtime.test.mjs\",\"artifactReferences\":[{\"name\":\"Markdown test artifact\",\"kind\":\"markdown\",\"path\":\"artifacts/test.md\"}],\"assertions\":[{\"label\":\"workspace renders the test artifact\",\"actual\":\"present\",\"expected\":\"present\"}],\"failureDetails\":null}]}\n</focused-test-evidence>",
        createdAt: "2026-08-01T12:00:00.000Z",
        model: "GPT-5.4-mini",
        usage: { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1, totalTokens: 2 },
        candidateId: "C1",
        candidateRevision: 2,
        focusedTest: parseFocusedTestEvidence(
          "PASS\n\n<focused-test-evidence>\n{\"candidateId\":\"C1\",\"candidateRevision\":2,\"command\":\"npm.cmd run test:runtime\",\"status\":\"passed\",\"durationMs\":900,\"rows\":[{\"id\":\"row-1\",\"candidateId\":\"C1\",\"candidateRevision\":2,\"command\":\"npm.cmd run test:runtime\",\"status\":\"passed\",\"durationMs\":900,\"title\":\"runtime.test.mjs\",\"artifactReferences\":[{\"name\":\"Markdown test artifact\",\"kind\":\"markdown\",\"path\":\"artifacts/test.md\"}],\"assertions\":[{\"label\":\"workspace renders the test artifact\",\"actual\":\"present\",\"expected\":\"present\"}],\"failureDetails\":null}]}\n</focused-test-evidence>",
        ),
      });
    });

    const fetched = await (await fetch(`${origin}/api/tasks/${task.id}`)).json();
    assert.equal(fetched.task.artifacts[0].kind, "markdown");
    assert.equal(fetched.task.artifacts[0].focusedTest.candidateId, "C1");
    assert.equal(fetched.task.artifacts[0].focusedTest.rows[0].candidateRevision, 2);
    assert.equal(fetched.task.artifacts[0].focusedTest.rows[0].artifactReferences[0].kind, "markdown");
  } finally {
    await cleanup(server, directory);
  }
});

test("serializes the authoritative freshness projection, stale reason, run status, and Markdown audit artifact", async () => {
  const { directory, origin, server, store } = await createServer();
  try {
    const response = await createTask(origin, {
      title: "Freshness projection payload",
      description: "Expose exact candidate-bound gate state.",
      repositoryPath: directory,
      workflow: "implement",
    });
    const { task } = await response.json();
    await store.update(task.id, (draft) => {
      draft.candidates.push({
        id: "C1",
        revisionNumber: 2,
        baseRevision: "a".repeat(40),
        baseBranch: "main",
        headRevision: "b".repeat(40),
        status: "ready_for_review",
        revisions: [],
      });
      draft.artifacts.push({
        id: "ART-DEV",
        stage: "dev-review",
        kind: "markdown",
        name: "dev-review-c1-r2.md",
        content: "# retained review evidence\n\nPASS",
        createdAt: "2026-08-03T00:01:00.000Z",
        candidateId: "C1",
        candidateRevision: 2,
        gateResult: {
          schemaVersion: 1,
          stage: "dev-review",
          verdict: "PASS",
          reportedVerdict: "PASS",
          candidateId: "C1",
          candidateRevision: 2,
          evaluatedAt: "2026-08-03T00:01:00.000Z",
          blockingReasons: [],
          findings: [],
        },
        usage: { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1, totalTokens: 2 },
      });
      draft.runs.push({
        id: "RUN-DEV",
        kind: "review",
        status: "completed",
        stage: "dev-review",
        role: "dev-review",
        model: "gpt-5.6-luna",
        reasoning: "xhigh",
        startedAt: "2026-08-03T00:00:00.000Z",
        completedAt: "2026-08-03T00:01:00.000Z",
        durationMs: 60_000,
        artifactId: "ART-DEV",
        usage: { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1, totalTokens: 2 },
        credits: null,
        apiEstimate: null,
        candidateId: "C1",
        candidateRevision: 2,
        workPackageId: null,
        attempt: 1,
        retryOfRunId: null,
        repairOfRunId: null,
        toolCalls: [],
        test: null,
        gateResult: null,
        evidenceError: null,
        freshness: null,
        error: null,
        source: "codex-jsonl",
      });
      draft.events.push({ id: "EVENT-DEV", runId: "RUN-DEV", category: "agent", tone: "success", stage: "dev-review", title: "Review complete", detail: "PASS" });
      attachRunArtifact(draft, "RUN-DEV", draft.artifacts[0]);
      refreshGateFreshness(draft);
    });

    const fetched = await (await fetch(`${origin}/api/tasks/${task.id}`)).json();
    const freshness = fetched.task.gateFreshness["dev-review"];
    assert.equal(freshness.fresh, true);
    assert.deepEqual(freshness.target, { candidateId: "C1", candidateRevision: 2 });
    assert.equal(freshness.sourceRunId, "RUN-DEV");
    assert.equal(fetched.task.runs[0].status, "completed");
    assert.equal(fetched.task.runs[0].freshness.reasonCode, "fresh");
    assert.equal(fetched.task.events.at(-1).freshness.reasonCopy, RUNTIME_FRESHNESS_REASONS.fresh);
    assert.equal(fetched.task.artifacts[0].content, "# retained review evidence\n\nPASS");
  } finally {
    await cleanup(server, directory);
  }
});

test("formats approval history for the inspector", () => {
  const approvals = getApprovalHistory([
    { id: "A1", stage: "specification", note: "Specification approved.", createdAt: "2026-08-01T10:15:00.000Z" },
  ]);
  assert.equal(approvals.length, 1);
  assert.equal(formatApprovalStage(approvals[0].stage), "Task specification");
  assert.notEqual(formatApprovalTimestamp(approvals[0].createdAt), approvals[0].createdAt);
  assert.deepEqual(getApprovalHistory(undefined), []);
});

test("creates a task with workflow implement", async () => {
  const { directory, origin, server } = await createServer();
  try {
    const response = await createTask(origin, {
      title: "Implement task",
      description: "Build the requested change.",
      repositoryPath: directory,
      workflow: "implement",
    });
    assert.equal(response.status, 201);
    const { task } = await response.json();
    assert.equal(task.workflow, "implement");
  } finally {
    await cleanup(server, directory);
  }
});

test("starts a bounded specification retry with the dedicated run kind", async () => {
  const { directory, origin, server, store, startedIdRef, startedKindRef } = await createServer();
  try {
    const response = await createTask(origin, {
      title: "Retry specification",
      description: "Recover a failed specification synthesis.",
      repositoryPath: directory,
      workflow: "implement",
    });
    const { task } = await response.json();
    await store.update(task.id, (draft) => {
      draft.status = "blocked";
      draft.currentStage = "specification";
      draft.completedStages = ["triage", "scouts", "grill"];
      draft.attemptsByStage.specification = draft.stageRunLimits.specification;
      draft.stageRunReservations.specification = {
        id: "reservation-specification-3",
        stage: "specification",
        kind: "specification",
        workflowAttempt: 3,
        candidateId: null,
        candidateRevision: null,
        candidateHeadRevision: null,
        reservedAt: "2026-08-04T00:00:00.000Z",
      };
    });

    const blocked = await fetch(`${origin}/api/tasks/${task.id}/specification`, { method: "POST" });
    assert.equal(blocked.status, 409);
    const grant = await fetch(`${origin}/api/tasks/${task.id}/grant-retry`, { method: "POST" });
    assert.equal(grant.status, 200, JSON.stringify(await grant.clone().json()));
    const retry = await fetch(`${origin}/api/tasks/${task.id}/specification`, { method: "POST" });
    assert.equal(retry.status, 202);
    assert.deepEqual(await retry.json(), { started: true });
    assert.equal(startedIdRef(), task.id);
    assert.equal(startedKindRef(), "specification");
  } finally {
    await cleanup(server, directory);
  }
});

test("rejects specification retry outside a failed or cancelled specification state", async () => {
  const { directory, origin, server, store } = await createServer();
  try {
    const response = await createTask(origin, {
      title: "Guard specification retry",
      description: "Keep specification retry admission narrow.",
      repositoryPath: directory,
      workflow: "implement",
    });
    const { task } = await response.json();
    for (const item of [
      { status: "queued", currentStage: "specification", attempts: 0, error: /cannot run specification/i },
      { status: "failed", currentStage: "plan", attempts: 0, error: /cannot run specification/i },
      { status: "blocked", currentStage: "specification", attempts: 1, error: /cannot run specification/i },
      { status: "failed", currentStage: "specification", attempts: 3, error: /exhausted its retry allowance/i },
    ]) {
      await store.update(task.id, (draft) => {
        draft.status = item.status;
        draft.currentStage = item.currentStage;
        draft.attemptsByStage.specification = item.attempts;
      });
      const retry = await fetch(`${origin}/api/tasks/${task.id}/specification`, { method: "POST" });
      assert.equal(retry.status, 409, `${item.status}:${item.currentStage}`);
      assert.match((await retry.json()).error, item.error);
    }
  } finally {
    await cleanup(server, directory);
  }
});

test("revises an awaiting plan only after a retained corrective decision", async () => {
  const { directory, origin, server, store, startedIdRef, startedKindRef } = await createServer();
  try {
    const response = await createTask(origin, {
      title: "Revise unsafe plan",
      description: "Keep plan approval explicit while allowing evidence-backed recovery.",
      repositoryPath: directory,
      workflow: "implement",
    });
    const { task } = await response.json();
    await store.update(task.id, (draft) => {
      draft.status = "awaiting-plan-approval";
      draft.currentStage = "plan";
      draft.attemptsByStage.plan = 1;
      draft.workPackages = [{ id: "S1", title: "Wrong scope" }];
      draft.artifacts.push({
        id: "plan-r1",
        stage: "plan",
        name: "implementation-plan.md",
        kind: "markdown",
        content: "Wrong plan",
        createdAt: "2026-08-08T00:00:00.000Z",
      });
    });

    const blindRevision = await fetch(`${origin}/api/tasks/${task.id}/plan`, { method: "POST" });
    assert.equal(blindRevision.status, 409);
    assert.match((await blindRevision.json()).error, /record the required plan correction/i);

    const decision = await fetch(`${origin}/api/tasks/${task.id}/decisions`, {
      method: "POST",
      body: JSON.stringify({
        question: "How must the plan change?",
        answer: "Use one package and existing repository-relative test paths.",
      }),
    });
    assert.equal(decision.status, 201);
    await store.update(task.id, (draft) => {
      draft.decisions.push({
        id: "plan-correction",
        question: "How must the plan change?",
        answer: "Use one package and existing repository-relative test paths.",
        createdAt: "2026-08-08T00:01:00.000Z",
      });
    });

    const revision = await fetch(`${origin}/api/tasks/${task.id}/plan`, { method: "POST" });
    assert.equal(revision.status, 202);
    assert.deepEqual(await revision.json(), { started: true });
    assert.equal(startedIdRef(), task.id);
    assert.equal(startedKindRef(), "planning");
  } finally {
    await cleanup(server, directory);
  }
});

test("returns the current candidate diff only after verifying the recorded worktree and head revision", async () => {
  const { directory, origin, server, store } = await createServer();
  const repository = await mkdtemp(path.join(os.tmpdir(), "agent-harness-api-repo-"));
  try {
    await git(repository, ["init"]);
    await git(repository, ["config", "user.name", "Agent Harness Test"]);
    await git(repository, ["config", "user.email", "agent-harness@example.test"]);
    await writeFile(path.join(repository, "README.md"), "base\n", "utf8");
    await git(repository, ["add", "README.md"]);
    await git(repository, ["commit", "-m", "base"]);

    const task = await store.create({
      title: "Inspect diff",
      description: "Return the current candidate diff.",
      repositoryPath: repository,
      workflow: "implement",
      priority: "medium",
    });
    const manager = new GitWorktreeManager(path.join(repository, ".data", "worktrees"));
    const base = await manager.base(task);
    const candidate = await manager.prepare(task, "C1", { baseRevision: base.baseRevision });
    await writeFile(path.join(candidate.worktreePath, "feature.txt"), "candidate\n", "utf8");
    const committed = await manager.commit(candidate, "candidate diff");
    candidate.headRevision = committed.headRevision;
    await store.update(task.id, (draft) => {
      draft.candidates.push({ ...candidate, files: committed.files, summary: committed.summary });
    });

    const response = await fetch(`${origin}/api/tasks/${task.id}/candidates/C1/diff`);
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.candidateId, "C1");
    assert.equal(payload.revisionNumber, 1);
    assert.equal(payload.headRevision, committed.headRevision);
    assert.equal(payload.worktreePath, candidate.worktreePath);
    assert.match(payload.diff, /feature\.txt/);
    assert.equal(payload.truncated, false);
  } finally {
    await cleanup(server, directory);
    await rm(repository, { recursive: true, force: true });
  }
});

test("returns an exact retained candidate revision diff when its recorded head is requested", async () => {
  const { directory, origin, server, store } = await createServer();
  const repository = await mkdtemp(path.join(os.tmpdir(), "agent-harness-api-revision-diff-"));
  try {
    await git(repository, ["init"]);
    await git(repository, ["config", "user.name", "Agent Harness Test"]);
    await git(repository, ["config", "user.email", "agent-harness@example.test"]);
    await writeFile(path.join(repository, "README.md"), "base\n", "utf8");
    await git(repository, ["add", "README.md"]);
    await git(repository, ["commit", "-m", "base"]);

    const task = await store.create({
      title: "Inspect retained diff",
      description: "Open a prior candidate revision without substituting the current head.",
      repositoryPath: repository,
      workflow: "implement",
      priority: "medium",
    });
    const manager = new GitWorktreeManager(path.join(repository, ".data", "worktrees"));
    const base = await manager.base(task);
    const candidate = await manager.prepare(task, "C1", { baseRevision: base.baseRevision });
    await writeFile(path.join(candidate.worktreePath, "feature.txt"), "first revision\n", "utf8");
    const first = await manager.commit(candidate, "candidate r1");
    await writeFile(path.join(candidate.worktreePath, "feature.txt"), "second revision\n", "utf8");
    const second = await manager.commit(candidate, "candidate r2");
    candidate.headRevision = second.headRevision;
    candidate.revisionNumber = 2;
    candidate.revisions = [
      { number: 1, headRevision: first.headRevision, reason: "assembly", createdAt: "2026-08-01T12:00:00.000Z" },
      { number: 2, headRevision: second.headRevision, reason: "repair", createdAt: "2026-08-01T12:05:00.000Z" },
    ];
    await store.update(task.id, (draft) => {
      draft.candidates.push({ ...candidate, files: second.files, summary: second.summary });
    });

    const params = new URLSearchParams({ headRevision: first.headRevision });
    const response = await fetch(`${origin}/api/tasks/${task.id}/candidates/C1/diff?${params}`);
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.revisionNumber, 1);
    assert.equal(payload.headRevision, first.headRevision);
    assert.match(payload.diff, /first revision/);
    assert.doesNotMatch(payload.diff, /second revision/);

    const missing = await fetch(`${origin}/api/tasks/${task.id}/candidates/C1/diff?headRevision=${"f".repeat(40)}`);
    assert.equal(missing.status, 409);
    assert.match((await missing.json()).error, /no longer recorded/i);
  } finally {
    await cleanup(server, directory);
    await rm(repository, { recursive: true, force: true });
  }
});

test("returns a read-only worktree inventory with slice and candidate rows", async () => {
  const { directory, origin, server, store } = await createServer();
  const sliceRepository = await mkdtemp(path.join(os.tmpdir(), "agent-harness-api-inventory-slice-"));
  const candidateRepository = await mkdtemp(path.join(os.tmpdir(), "agent-harness-api-inventory-candidate-"));
  try {
    for (const repository of [sliceRepository, candidateRepository]) {
      await git(repository, ["init"]);
      await git(repository, ["config", "user.name", "Agent Harness Test"]);
      await git(repository, ["config", "user.email", "agent-harness@example.test"]);
      await writeFile(path.join(repository, "README.md"), "base\n", "utf8");
      await git(repository, ["add", "README.md"]);
      await git(repository, ["commit", "-m", "base"]);
    }

    const sliceTask = await store.create({
      title: "Inventory rows",
      description: "Expose retained harness worktrees.",
      repositoryPath: sliceRepository,
      workflow: "implement",
      priority: "medium",
    });
    const sliceManager = new GitWorktreeManager(path.join(sliceRepository, ".data", "worktrees"));
    const sliceBase = await sliceManager.base(sliceTask);
    const slice = await sliceManager.prepare(sliceTask, "S1", { baseRevision: sliceBase.baseRevision, branchId: "slice-1" });
    await writeFile(path.join(slice.worktreePath, "slice.txt"), "slice\n", "utf8");
    const sliceCommitted = await sliceManager.commit(slice, "slice worktree");

    const candidateTask = await store.create({
      title: "Inventory candidate",
      description: "Expose retained candidate worktrees.",
      repositoryPath: candidateRepository,
      workflow: "implement",
      priority: "medium",
    });
    const candidateManager = new GitWorktreeManager(path.join(candidateRepository, ".data", "worktrees"));
    const candidateBase = await candidateManager.base(candidateTask);
    const candidate = await candidateManager.prepare(candidateTask, "C1", { baseRevision: candidateBase.baseRevision });
    await writeFile(path.join(candidate.worktreePath, "candidate.txt"), "candidate\n", "utf8");
    const candidateCommitted = await candidateManager.commit(candidate, "candidate worktree");

    await store.update(sliceTask.id, (draft) => {
      draft.workPackages.push({
        id: "S1",
        batch: 1,
        title: "Read-only inventory contract",
        description: "Backend inventory projection.",
        status: "retained",
        attempts: 1,
        dependencies: [],
        ownedPaths: ["server/git-worktree.mjs", "server/api.mjs", "tests/api.test.mjs"],
        worktreePath: slice.worktreePath,
        branch: slice.branch,
        baseRevision: slice.baseRevision,
        headRevision: sliceCommitted.headRevision,
      });
    });
    await store.update(candidateTask.id, (draft) => {
      draft.candidates.push({
        ...candidate,
        headRevision: candidateCommitted.headRevision,
        status: "ready_for_review",
      });
    });

    const response = await fetch(`${origin}/api/runtime/worktrees`);
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.rows.length, 2);
    const sliceRow = payload.rows.find((row) => row.kind === "slice");
    const candidateRow = payload.rows.find((row) => row.kind === "candidate");
    assert.equal(sliceRow.id, `slice:${sliceTask.id}:S1`);
    assert.equal(sliceRow.label, "S1 slice");
    assert.equal(sliceRow.taskId, sliceTask.id);
    assert.equal(sliceRow.workPackageId, "S1");
    assert.equal(sliceRow.currentState, "retained");
    assert.equal(sliceRow.cleanupReady, true);
    assert.equal(sliceRow.gitExists, true);
    assert.equal(sliceRow.gitClean, true);
    assert.equal(candidateRow.id, `candidate:${candidateTask.id}:C1`);
    assert.equal(candidateRow.label, "C1 candidate");
    assert.equal(candidateRow.taskId, candidateTask.id);
    assert.equal(candidateRow.workPackageId, "C1");
    assert.equal(candidateRow.currentState, "retained");
    assert.equal(candidateRow.recordedHeadRevision, candidateCommitted.headRevision);
    assert.equal(candidateRow.gitHeadRevision, candidateCommitted.headRevision);
  } finally {
    await cleanup(server, directory);
    await rm(sliceRepository, { recursive: true, force: true });
    await rm(candidateRepository, { recursive: true, force: true });
  }
});

test("removes a cleanup-ready worktree through the API and refuses an active one", async () => {
  const previousRoot = process.env.AGENT_HARNESS_WORKTREE_ROOT;
  const worktreeRootDirectory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-api-worktree-root-"));
  // The route removes through the server's own `GitWorktreeManager`, which is rooted at
  // `defaultWorktreeRoot()` — the test worktree has to live under the same root or the
  // manager's own path-escape guard refuses it.
  process.env.AGENT_HARNESS_WORKTREE_ROOT = worktreeRootDirectory;
  const { directory, origin, server, store } = await createServer();
  const repository = await mkdtemp(path.join(os.tmpdir(), "agent-harness-api-remove-repo-"));
  try {
    await git(repository, ["init"]);
    await git(repository, ["config", "user.name", "Agent Harness Test"]);
    await git(repository, ["config", "user.email", "agent-harness@example.test"]);
    await writeFile(path.join(repository, "README.md"), "base\n", "utf8");
    await git(repository, ["add", "README.md"]);
    await git(repository, ["commit", "-m", "base"]);

    const task = await store.create({
      title: "Remove a slice worktree",
      description: "Exercise DELETE /api/tasks/:id/worktrees/:rowId.",
      repositoryPath: repository,
      workflow: "implement",
      priority: "medium",
    });
    const manager = new GitWorktreeManager(defaultWorktreeRoot());
    const base = await manager.base(task);
    const slice = await manager.prepare(task, "S1", { baseRevision: base.baseRevision, branchId: "slice-1" });
    await writeFile(path.join(slice.worktreePath, "feature.txt"), "done\n", "utf8");
    const committed = await manager.commit(slice, "slice worktree");
    await store.update(task.id, (draft) => {
      draft.workPackages.push({
        id: "S1",
        batch: 1,
        title: "Cleanup candidate",
        description: "Already committed and idle.",
        status: "ready_for_integration",
        attempts: 1,
        dependencies: [],
        ownedPaths: [],
        verification: [],
        branch: slice.branch,
        worktreePath: slice.worktreePath,
        baseRevision: slice.baseRevision,
        headRevision: committed.headRevision,
        files: committed.files,
        error: null,
      });
    });
    const rowUrl = `${origin}/api/tasks/${task.id}/worktrees/${encodeURIComponent(`slice:${task.id}:S1`)}`;

    // A worktree still in use must never be pulled out from under its running agent,
    // even though the tree itself is clean.
    await store.update(task.id, (draft) => {
      draft.workPackages[0].status = "running";
    });
    const refused = await fetch(rowUrl, { method: "DELETE" });
    assert.equal(refused.status, 400);
    assert.match((await refused.json()).error, /not ready for cleanup/);
    assert.equal(await stat(slice.worktreePath).then(() => true).catch(() => false), true);

    await store.update(task.id, (draft) => {
      draft.workPackages[0].status = "ready_for_integration";
    });
    const removed = await fetch(rowUrl, { method: "DELETE" });
    assert.equal(removed.status, 200);
    const payload = await removed.json();
    assert.equal(payload.rows.length, 1);
    assert.equal(payload.rows[0].gitExists, false);
    assert.equal(await stat(slice.worktreePath).then(() => true).catch(() => false), false);

    const missing = await fetch(`${origin}/api/tasks/${task.id}/worktrees/${encodeURIComponent("slice:missing:X")}`, { method: "DELETE" });
    assert.equal(missing.status, 404);
  } finally {
    await cleanup(server, directory);
    await rm(repository, { recursive: true, force: true });
    await rm(worktreeRootDirectory, { recursive: true, force: true });
    if (previousRoot === undefined) delete process.env.AGENT_HARNESS_WORKTREE_ROOT;
    else process.env.AGENT_HARNESS_WORKTREE_ROOT = previousRoot;
  }
});

test("archiving hides a task, reclaims its clean worktrees, and keeps the dirty ones", async () => {
  const previousRoot = process.env.AGENT_HARNESS_WORKTREE_ROOT;
  const worktreeRootDirectory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-api-archive-root-"));
  process.env.AGENT_HARNESS_WORKTREE_ROOT = worktreeRootDirectory;
  const { directory, origin, server, store } = await createServer();
  const repository = await mkdtemp(path.join(os.tmpdir(), "agent-harness-api-archive-repo-"));
  try {
    await git(repository, ["init"]);
    await git(repository, ["config", "user.name", "Agent Harness Test"]);
    await git(repository, ["config", "user.email", "agent-harness@example.test"]);
    await writeFile(path.join(repository, "README.md"), "base\n", "utf8");
    await git(repository, ["add", "README.md"]);
    await git(repository, ["commit", "-m", "base"]);

    const task = await store.create({
      title: "Archive a stranded task",
      description: "Exercise POST /api/tasks/:id/archive.",
      repositoryPath: repository,
      workflow: "implement",
      priority: "medium",
    });
    const manager = new GitWorktreeManager(defaultWorktreeRoot());
    const base = await manager.base(task);
    const clean = await manager.prepare(task, "S1", { baseRevision: base.baseRevision, branchId: "slice-1" });
    await writeFile(path.join(clean.worktreePath, "feature.txt"), "done\n", "utf8");
    const cleanCommitted = await manager.commit(clean, "clean slice");
    const dirty = await manager.prepare(task, "S2", { baseRevision: base.baseRevision, branchId: "slice-2" });
    await writeFile(path.join(dirty.worktreePath, "wip.txt"), "uncommitted\n", "utf8");
    await store.update(task.id, (draft) => {
      draft.status = "repair-required";
      for (const [id, slice, headRevision] of [
        ["S1", clean, cleanCommitted.headRevision],
        ["S2", dirty, null],
      ]) {
        draft.workPackages.push({
          id,
          batch: 1,
          title: `Slice ${id}`,
          description: "Fixture slice.",
          status: "ready_for_integration",
          attempts: 1,
          dependencies: [],
          ownedPaths: [],
          verification: [],
          branch: slice.branch,
          worktreePath: slice.worktreePath,
          baseRevision: slice.baseRevision,
          headRevision,
          files: [],
          error: null,
        });
      }
    });
    const archiveUrl = `${origin}/api/tasks/${task.id}/archive`;

    // An active run owns its worktree; archiving must not pull it out from under the agent.
    await store.update(task.id, (draft) => { draft.status = "running"; });
    const refused = await fetch(archiveUrl, { method: "POST", body: JSON.stringify({}) });
    assert.equal(refused.status, 409);
    assert.match((await refused.json()).error, /Cancel the active run/);
    assert.equal(await stat(clean.worktreePath).then(() => true).catch(() => false), true);

    await store.update(task.id, (draft) => { draft.status = "repair-required"; });
    const archived = await fetch(archiveUrl, { method: "POST", body: JSON.stringify({ note: "Superseded by AH-003." }) });
    assert.equal(archived.status, 200);
    const payload = await archived.json();
    assert.equal(payload.task.status, "archived");
    // Archiving is a visibility decision, so where the task actually stopped has to survive it.
    assert.equal(payload.task.archive.previousStatus, "repair-required");
    assert.equal(payload.task.archive.note, "Superseded by AH-003.");
    assert.deepEqual(payload.removedWorktrees.map((entry) => entry.worktreePath), [clean.worktreePath]);
    assert.equal(payload.retainedWorktrees.length, 1);
    assert.equal(payload.retainedWorktrees[0].worktreePath, dirty.worktreePath);
    assert.equal(payload.retainedWorktrees[0].reason, "uncommitted changes");
    assert.deepEqual(payload.task.archive.removedWorktrees, [clean.worktreePath]);
    assert.deepEqual(payload.task.archive.retainedWorktrees, [dirty.worktreePath]);

    // The clean tree is gone; the one holding work nobody else has is untouched.
    assert.equal(await stat(clean.worktreePath).then(() => true).catch(() => false), false);
    assert.equal(await readFile(path.join(dirty.worktreePath, "wip.txt"), "utf8"), "uncommitted\n");

    const again = await fetch(archiveUrl, { method: "POST", body: JSON.stringify({}) });
    assert.equal(again.status, 409);
    assert.match((await again.json()).error, /already archived/);

    // An archived task is terminal: no stage run may be started from it.
    const started = await fetch(`${origin}/api/tasks/${task.id}/repair`, { method: "POST", body: JSON.stringify({}) });
    assert.equal(started.status, 409);
  } finally {
    await cleanup(server, directory);
    await rm(repository, { recursive: true, force: true });
    await rm(worktreeRootDirectory, { recursive: true, force: true });
    if (previousRoot === undefined) delete process.env.AGENT_HARNESS_WORKTREE_ROOT;
    else process.env.AGENT_HARNESS_WORKTREE_ROOT = previousRoot;
  }
});

test("marks missing or dirty inventory rows as stale without mutating them", async () => {
  const { directory, origin, server, store } = await createServer();
  const repository = await mkdtemp(path.join(os.tmpdir(), "agent-harness-api-stale-inventory-"));
  try {
    await git(repository, ["init"]);
    await git(repository, ["config", "user.name", "Agent Harness Test"]);
    await git(repository, ["config", "user.email", "agent-harness@example.test"]);
    await writeFile(path.join(repository, "README.md"), "base\n", "utf8");
    await git(repository, ["add", "README.md"]);
    await git(repository, ["commit", "-m", "base"]);

    const task = await store.create({
      title: "Stale inventory rows",
      description: "Surface honest Git state.",
      repositoryPath: repository,
      workflow: "implement",
      priority: "medium",
    });
    const manager = new GitWorktreeManager(path.join(repository, ".data", "worktrees"));
    const base = await manager.base(task);
    const candidate = await manager.prepare(task, "C1", { baseRevision: base.baseRevision });
    await writeFile(path.join(candidate.worktreePath, "candidate.txt"), "candidate\n", "utf8");
    const committed = await manager.commit(candidate, "candidate worktree");
    await store.update(task.id, (draft) => {
      draft.candidates.push({
        ...candidate,
        headRevision: committed.headRevision,
        status: "ready_for_review",
      });
    });
    await rm(candidate.worktreePath, { recursive: true, force: true });

    const response = await fetch(`${origin}/api/runtime/worktrees`);
    assert.equal(response.status, 200);
    const payload = await response.json();
    const row = payload.rows.find((item) => item.kind === "candidate");
    assert.equal(row.currentState, "stale");
    assert.equal(row.gitExists, false);
    assert.equal(row.cleanupReady, false);
    assert.equal(row.gitHeadRevision, null);
    assert.equal(row.headRevision, committed.headRevision);
  } finally {
    await cleanup(server, directory);
    await rm(repository, { recursive: true, force: true });
  }
});

test("rejects stale or mismatched candidate diff requests", async () => {
  const { directory, origin, server, store } = await createServer();
  const repository = await mkdtemp(path.join(os.tmpdir(), "agent-harness-api-stale-"));
  try {
    await git(repository, ["init"]);
    await git(repository, ["config", "user.name", "Agent Harness Test"]);
    await git(repository, ["config", "user.email", "agent-harness@example.test"]);
    await writeFile(path.join(repository, "README.md"), "base\n", "utf8");
    await git(repository, ["add", "README.md"]);
    await git(repository, ["commit", "-m", "base"]);

    const task = await store.create({
      title: "Reject stale diff",
      description: "Reject mismatched candidate metadata.",
      repositoryPath: repository,
      workflow: "implement",
      priority: "medium",
    });
    const manager = new GitWorktreeManager(path.join(repository, ".data", "worktrees"));
    const base = await manager.base(task);
    const candidate = await manager.prepare(task, "C1", { baseRevision: base.baseRevision });
    await writeFile(path.join(candidate.worktreePath, "feature.txt"), "candidate\n", "utf8");
    const committed = await manager.commit(candidate, "candidate diff");
    candidate.headRevision = committed.headRevision;
    await store.update(task.id, (draft) => {
      draft.candidates.push({ ...candidate, files: committed.files, summary: committed.summary });
    });

    await store.update(task.id, (draft) => {
      draft.candidates[0].headRevision = "f".repeat(40);
    });
    const staleHead = await fetch(`${origin}/api/tasks/${task.id}/candidates/C1/diff`);
    assert.equal(staleHead.status, 400);
    assert.match((await staleHead.json()).error, /no longer matches its recorded revision/i);

    await store.update(task.id, (draft) => {
      draft.candidates[0].headRevision = committed.headRevision;
      draft.candidates[0].worktreePath = path.join(candidate.worktreePath, "nested");
    });
    await mkdir(path.join(candidate.worktreePath, "nested"), { recursive: true });
    const staleWorktree = await fetch(`${origin}/api/tasks/${task.id}/candidates/C1/diff`);
    assert.equal(staleWorktree.status, 400);
    assert.match((await staleWorktree.json()).error, /no longer resolves to its recorded path/i);
  } finally {
    await cleanup(server, directory);
    await rm(repository, { recursive: true, force: true });
  }
});

test("caps oversized candidate diffs and marks them truncated", async () => {
  const { directory, origin, server, store } = await createServer();
  const repository = await mkdtemp(path.join(os.tmpdir(), "agent-harness-api-trunc-"));
  try {
    await git(repository, ["init"]);
    await git(repository, ["config", "user.name", "Agent Harness Test"]);
    await git(repository, ["config", "user.email", "agent-harness@example.test"]);
    await writeFile(path.join(repository, "README.md"), "base\n", "utf8");
    await git(repository, ["add", "README.md"]);
    await git(repository, ["commit", "-m", "base"]);

    const task = await store.create({
      title: "Truncate diff",
      description: "Return a capped unified diff.",
      repositoryPath: repository,
      workflow: "implement",
      priority: "medium",
    });
    const manager = new GitWorktreeManager(path.join(repository, ".data", "worktrees"));
    const base = await manager.base(task);
    const candidate = await manager.prepare(task, "C1", { baseRevision: base.baseRevision });
    await writeFile(path.join(candidate.worktreePath, "feature.txt"), `${"x".repeat(1000)}\n`.repeat(400), "utf8");
    const committed = await manager.commit(candidate, "candidate diff");
    candidate.headRevision = committed.headRevision;
    await store.update(task.id, (draft) => {
      draft.candidates.push({ ...candidate, files: committed.files, summary: committed.summary });
    });

    const response = await fetch(`${origin}/api/tasks/${task.id}/candidates/C1/diff`);
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.candidateId, "C1");
    assert.equal(payload.truncated, true);
    assert.equal(payload.diff.length <= 300_000, true);
  } finally {
    await cleanup(server, directory);
    await rm(repository, { recursive: true, force: true });
  }
});

test("grants one bounded repair attempt to a blocked candidate", async () => {
  const { directory, origin, server, store } = await createServer();
  try {
    const response = await createTask(origin, {
      title: "Repair candidate",
      description: "Recover a blocked candidate without discarding its history.",
      repositoryPath: directory,
      workflow: "implement",
    });
    const { task } = await response.json();
    let reservation;
    let authorizingGate;
    let producerArtifactIds;
    let producerRunIds;
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
      producerRunIds = draft.runs
        .filter((run) => run.workflowReservationId === candidate.sourceWorkflowReservationId)
        .map((run) => run.id);
      producerArtifactIds = draft.artifacts
        .filter((artifact) => producerRunIds.includes(artifact.runId))
        .map((artifact) => artifact.id);
      authorizingGate = attachExactCandidateGate(draft, candidate);
      draft.runs.push(...[1, 2, 3].map((attempt) => ({
        id: `run-failed-repair-${attempt}`,
        stage: "implement",
        status: "failed",
      })));
      reservation = bindLatestWorkflowAttempt(draft, "implement", "repair");
    });

    const grantResponse = await fetch(`${origin}/api/tasks/${task.id}/grant-retry`, { method: "POST" });
    assert.equal(grantResponse.status, 200, JSON.stringify(await grantResponse.clone().json()));
    assert.deepEqual(await grantResponse.json(), { granted: true });

    const updated = (await (await fetch(`${origin}/api/tasks/${task.id}`)).json()).task;
    assert.equal(updated.status, "failed");
    assert.equal(updated.stageRunLimits.implement, 4);
    assert.equal(updated.stageRunLimits["dev-review"], 3);
    assert.equal(updated.decisions.at(-1).grantedStage, "implement");
    assert.equal(updated.decisions.at(-1).previousLimit, 3);
    assert.equal(updated.decisions.at(-1).newLimit, 4);
    assert.equal(updated.decisions.at(-1).sourceRunId, "run-failed-repair-3");
    assert.deepEqual(updated.decisions.at(-1).sourceRunIds, ["run-failed-repair-3"]);
    assert.equal(updated.decisions.at(-1).candidateId, "C1");
    assert.equal(updated.decisions.at(-1).candidateRevision, 1);
    assert.equal(updated.decisions.at(-1).candidateHeadRevision, "candidate-c1-r1");
    assert.equal(updated.decisions.at(-1).authorizingGateCandidateId, "C1");
    assert.equal(updated.decisions.at(-1).authorizingGateCandidateRevision, 1);
    assert.equal(updated.decisions.at(-1).authorizingGateCandidateHeadRevision, "candidate-c1-r1");
    assert.equal(updated.decisions.at(-1).authorizingGateArtifactId, authorizingGate.sourceArtifactId);
    assert.equal(updated.decisions.at(-1).authorizingGateKind, "review");
    assert.equal(updated.decisions.at(-1).authorizingGateReservedAt, authorizingGate.reservedAt);
    assert.equal(updated.decisions.at(-1).authorizingGateReservationId, authorizingGate.id);
    assert.equal(updated.decisions.at(-1).authorizingGateRunId, authorizingGate.sourceRunId);
    assert.equal(updated.decisions.at(-1).authorizingGateStage, "dev-review");
    assert.equal(updated.decisions.at(-1).authorizingGateWorkflowAttempt, 1);
    assert.deepEqual(updated.decisions.at(-1).candidateProducerArtifactIds, producerArtifactIds);
    assert.deepEqual(updated.decisions.at(-1).candidateProducerRunIds, producerRunIds);
    assert.equal(updated.decisions.at(-1).workflowAttempt, 3);
    assert.equal(updated.decisions.at(-1).workflowCandidateId, "C1");
    assert.equal(updated.decisions.at(-1).workflowCandidateRevision, 1);
    assert.equal(updated.decisions.at(-1).workflowCandidateHeadRevision, "candidate-c1-r1");
    assert.equal(updated.decisions.at(-1).workflowReservationId, reservation.id);
    assert.equal(updated.attemptsByStage.implement, 3);
    assert.equal(updated.candidates.at(-1).status, "repair_required");
    assert.equal(updated.events.at(-1).title, "One repair attempt granted");
    assert.equal(updated.events.at(-1).sourceRunId, "run-failed-repair-3");
    assert.deepEqual(updated.events.at(-1).sourceRunIds, ["run-failed-repair-3"]);
    assert.equal(updated.events.at(-1).candidateId, "C1");
    assert.equal(updated.events.at(-1).candidateRevision, 1);
    assert.equal(updated.events.at(-1).candidateHeadRevision, "candidate-c1-r1");
    assert.equal(updated.events.at(-1).authorizingGateCandidateId, "C1");
    assert.equal(updated.events.at(-1).authorizingGateCandidateRevision, 1);
    assert.equal(updated.events.at(-1).authorizingGateCandidateHeadRevision, "candidate-c1-r1");
    assert.equal(updated.events.at(-1).authorizingGateArtifactId, authorizingGate.sourceArtifactId);
    assert.equal(updated.events.at(-1).authorizingGateKind, "review");
    assert.equal(updated.events.at(-1).authorizingGateReservedAt, authorizingGate.reservedAt);
    assert.equal(updated.events.at(-1).authorizingGateReservationId, authorizingGate.id);
    assert.equal(updated.events.at(-1).authorizingGateRunId, authorizingGate.sourceRunId);
    assert.equal(updated.events.at(-1).authorizingGateStage, "dev-review");
    assert.equal(updated.events.at(-1).authorizingGateWorkflowAttempt, 1);
    assert.deepEqual(updated.events.at(-1).candidateProducerArtifactIds, producerArtifactIds);
    assert.deepEqual(updated.events.at(-1).candidateProducerRunIds, producerRunIds);
    assert.equal(updated.events.at(-1).workflowAttempt, 3);
    assert.equal(updated.events.at(-1).workflowCandidateId, "C1");
    assert.equal(updated.events.at(-1).workflowCandidateRevision, 1);
    assert.equal(updated.events.at(-1).workflowCandidateHeadRevision, "candidate-c1-r1");
    assert.equal(updated.events.at(-1).workflowReservationId, reservation.id);

    const repeatedResponse = await fetch(`${origin}/api/tasks/${task.id}/grant-retry`, { method: "POST" });
    assert.equal(repeatedResponse.status, 409);
    assert.equal((await store.get(task.id)).stageRunLimits.implement, 4);
  } finally {
    await cleanup(server, directory);
  }
});

test("grants a repair attempt when the authorizing gate's only non-blocking finding lacks explicit binding", async () => {
  // Recorded live (AH-002 dev-review): the reviewer's one finding was P3 (informational,
  // non-blocking) and — like every non-blocking finding `parseGateEvidence` allows to
  // fall back to the top-level candidate binding — carried `bindingExplicit: false`.
  // That is enough for the freshness layer's marker check to classify the gate
  // `missing_binding` instead of `repair_required`, even though the run's own
  // `gateResult.verdict` is genuinely "REPAIR" and the candidate is genuinely
  // `repair_required`. Before the fix, this made the exhausted repair permanently
  // ungrantable: `failedRepairAuthorizingGate`/`candidateGateAuthorizerEvidence`
  // required the literal reasonCode "repair_required" and found no authorizing gate.
  const { directory, origin, server, store } = await createServer();
  try {
    const response = await createTask(origin, {
      title: "Repair candidate with an unbound informational finding",
      description: "A non-blocking finding lacking explicit binding must not block a repair grant.",
      repositoryPath: directory,
      workflow: "implement",
    });
    const { task } = await response.json();
    let authorizingGate;
    await store.update(task.id, (draft) => {
      draft.status = "repair-required";
      draft.currentStage = "dev-review";
      const candidate = attachAssemblyLineage(draft, {
        id: "C1",
        revisionNumber: 1,
        headRevision: "candidate-c1-r1",
        status: "repair_required",
      });
      draft.candidates.push(candidate);
      authorizingGate = attachExactCandidateGate(draft, candidate, {
        findings: [{
          severity: "P3",
          title: "Reporter ordering is load-bearing and undocumented",
          detail: "Informational only; no repair required for this finding on its own.",
          file: "e2e/playwright.config.ts",
          line: 38,
          candidateId: candidate.id,
          candidateRevision: candidate.revisionNumber,
          bindingExplicit: false,
        }],
        blockingReasons: ["Finding Reporter ordering is load-bearing and undocumented is missing explicit candidate identity fields."],
      });
      draft.runs.push(...[1, 2, 3].map((attempt) => ({
        id: `run-failed-repair-${attempt}`,
        stage: "implement",
        status: "failed",
      })));
      draft.attemptsByStage.implement = draft.stageRunLimits.implement;
      bindLatestWorkflowAttempt(draft, "implement", "repair");
      refreshGateFreshness(draft);
    });

    const before = (await store.get(task.id));
    assert.equal(before.gateFreshness["dev-review"].reasonCode, "missing_binding");

    const grantResponse = await fetch(`${origin}/api/tasks/${task.id}/grant-retry`, { method: "POST" });
    assert.equal(grantResponse.status, 200, JSON.stringify(await grantResponse.clone().json()));
    assert.deepEqual(await grantResponse.json(), { granted: true });

    const updated = (await (await fetch(`${origin}/api/tasks/${task.id}`)).json()).task;
    assert.equal(updated.stageRunLimits.implement, 4);
    assert.equal(updated.decisions.at(-1).authorizingGateStage, "dev-review");
    assert.equal(updated.decisions.at(-1).authorizingGateArtifactId, authorizingGate.sourceArtifactId);
    assert.equal(updated.decisions.at(-1).authorizingGateRunId, authorizingGate.sourceRunId);
  } finally {
    await cleanup(server, directory);
  }
});

test("grants a second repair attempt after the first failed and moved currentStage off the authorizing gate", async () => {
  // Recorded live (AH-002): a repair attempt's own failure handler sets
  // `task.currentStage = "implement"` (a repair is an implement run) even though the
  // candidate is still repair-required against whichever gate stage actually failed —
  // here, dev-review. `failedRepairAuthorizingGate` compared the authorizing gate's
  // stage directly against `task.currentStage` and found "dev-review" !== "implement",
  // so the *second* repair attempt (after the first failed) could never be granted —
  // every task exhausts its repair allowance the moment one attempt fails, forever.
  const { directory, origin, server, store } = await createServer();
  try {
    const response = await createTask(origin, {
      title: "Second repair attempt after a failed first",
      description: "A failed repair must not move currentStage off the authorizing gate.",
      repositoryPath: directory,
      workflow: "implement",
    });
    const { task } = await response.json();
    let authorizingGate;
    await store.update(task.id, (draft) => {
      draft.status = "repair-required";
      // The failed first repair attempt already moved currentStage here.
      draft.currentStage = "implement";
      const candidate = attachAssemblyLineage(draft, {
        id: "C1",
        revisionNumber: 1,
        headRevision: "candidate-c1-r1",
        status: "repair_required",
      });
      draft.candidates.push(candidate);
      authorizingGate = attachExactCandidateGate(draft, candidate);
      // The failed attempt itself, plus the exhausted allowance it left behind.
      draft.runs.push(...[1, 2, 3].map((attempt) => ({
        id: `run-failed-repair-${attempt}`,
        stage: "implement",
        status: "failed",
      })));
      draft.attemptsByStage.implement = draft.stageRunLimits.implement;
      const reservation = bindLatestWorkflowAttempt(draft, "implement", "repair");
      reservation.authorizingGateStage = "dev-review";
      reservation.authorizingGateReservationId = authorizingGate.id;
      reservation.authorizingGateRunId = authorizingGate.sourceRunId;
      reservation.authorizingGateArtifactId = authorizingGate.sourceArtifactId;
      reservation.authorizingGateReservedAt = authorizingGate.reservedAt;
      reservation.authorizingGateWorkflowAttempt = 1;
      reservation.authorizingGateProvider = "claude";
      reservation.authorizingGateArtifactCreatedAt = draft.artifacts.find((artifact) => artifact.id === authorizingGate.sourceArtifactId)?.createdAt ?? null;
      reservation.authorizingGateSnapshotDigest = "f".repeat(64);
      refreshGateFreshness(draft);
    });

    const before = await store.get(task.id);
    assert.equal(before.currentStage, "implement");
    assert.equal(before.gateFreshness["dev-review"].reasonCode, "repair_required");

    const grantResponse = await fetch(`${origin}/api/tasks/${task.id}/grant-retry`, { method: "POST" });
    assert.equal(grantResponse.status, 200, JSON.stringify(await grantResponse.clone().json()));
    assert.deepEqual(await grantResponse.json(), { granted: true });

    const updated = (await (await fetch(`${origin}/api/tasks/${task.id}`)).json()).task;
    assert.equal(updated.stageRunLimits.implement, 4);
    assert.equal(updated.decisions.at(-1).authorizingGateStage, "dev-review");
  } finally {
    await cleanup(server, directory);
  }
});

test("grants an exhausted dev-review retry after a no-op repair left the implement reservation unrelated to the current revision", async () => {
  // Recorded live (AH-002): a repair whose newest failing gate needed no code change
  // (its own `<no-changes-needed>` marker, see `#runRepair`) correctly leaves the
  // candidate at its *existing* revision — but `stageRunReservations.implement` still
  // gets overwritten with that repair's own reservation, whose `candidateRevision`
  // targets the current (unchanged) revision rather than being the reservation that
  // originally produced it. `validCandidateProducerReservation` required an exact
  // identity match against the revision's *original* producer, so this legitimate,
  // well-formed no-op repair reservation made every later dev-review retry look like
  // "the candidate's lineage is corrupted" and permanently blocked granting one.
  const { directory, origin, server, store } = await createServer();
  try {
    const response = await createTask(origin, {
      title: "No-op repair leaves dev-review retry grantable",
      description: "A repair that changed nothing must not corrupt the producer lineage.",
      repositoryPath: directory,
      workflow: "implement",
    });
    const { task } = await response.json();
    let previousLimit;
    await store.update(task.id, (draft) => {
      draft.status = "ready-for-review";
      draft.currentStage = "dev-review";
      const candidate = attachAssemblyLineage(draft, {
        id: "C1",
        revisionNumber: 1,
        headRevision: "candidate-c1-r1",
        status: "ready_for_review",
      });
      draft.candidates.push(candidate);
      previousLimit = draft.stageRunLimits["dev-review"];
      attachExactCandidateGate(draft, candidate, {
        workflowAttempt: previousLimit,
      });
      draft.attemptsByStage["dev-review"] = previousLimit;
      // The no-op repair reservation: bound to the candidate's *current* (unchanged)
      // revision, reserved well after that revision was created — exactly what
      // `#runRepair` produces for a `<no-changes-needed>` outcome.
      const noOpRepairWorkflowAttempt = draft.attemptsByStage.implement + 1;
      draft.attemptsByStage.implement = noOpRepairWorkflowAttempt;
      draft.stageRunReservations.implement = {
        id: `reservation-${draft.id}-noop-repair`,
        stage: "implement",
        kind: "repair",
        workflowAttempt: noOpRepairWorkflowAttempt,
        candidateId: candidate.id,
        candidateRevision: candidate.revisionNumber,
        candidateHeadRevision: candidate.headRevision,
        authorizedRunScopes: [],
        reservedAt: "2026-08-04T00:05:00.000Z",
      };
      refreshGateFreshness(draft);
    });

    const grantResponse = await fetch(`${origin}/api/tasks/${task.id}/grant-retry`, { method: "POST" });
    assert.equal(grantResponse.status, 200, JSON.stringify(await grantResponse.clone().json()));
    assert.deepEqual(await grantResponse.json(), { granted: true });

    const updated = (await (await fetch(`${origin}/api/tasks/${task.id}`)).json()).task;
    assert.equal(updated.stageRunLimits["dev-review"], previousLimit + 1);
    assert.equal(updated.decisions.at(-1).grantedStage, "dev-review");
  } finally {
    await cleanup(server, directory);
  }
});

test("grants repair after a candidate is assembled on the final implementation allowance", async () => {
  const { directory, origin, server, store } = await createServer();
  try {
    const response = await createTask(origin, {
      title: "Final implementation allowance",
      description: "Retain the candidate-producing reservation when assembly consumes the final allowance.",
      repositoryPath: directory,
      workflow: "implement",
    });
    const { task } = await response.json();
    let reservation;
    await store.update(task.id, (draft) => {
      draft.status = "repair-required";
      draft.currentStage = "dev-review";
      draft.attemptsByStage.implement = draft.stageRunLimits.implement;
      draft.workPackages = ["S1", "S2"].map((id) => ({
        id,
        status: "integrated",
        batch: 1,
        headRevision: `head-${id.toLowerCase()}`,
      }));
      reservation = {
        id: "reservation-assembly-only-3",
        stage: "implement",
        kind: "implementation",
        workflowAttempt: 3,
        candidateId: null,
        candidateRevision: null,
        candidateHeadRevision: null,
        authorizedRunScopes: [],
        reservedAt: "2026-08-04T00:02:00.000Z",
      };
      draft.stageRunReservations.implement = reservation;
      const candidate = {
        id: "C1",
        revisionNumber: 1,
        headRevision: "candidate-c1-r1",
        status: "repair_required",
        members: ["S1", "S2"].map((packageId, index) => ({
          packageId,
          headRevision: `head-${packageId.toLowerCase()}`,
          order: index + 1,
        })),
        sourceWorkflowAttempt: reservation.workflowAttempt,
        sourceWorkflowReservationId: reservation.id,
        revisions: [{
          number: 1,
          headRevision: "candidate-c1-r1",
          reason: "assembly",
          sourceWorkflowAttempt: reservation.workflowAttempt,
          sourceWorkflowReservationId: reservation.id,
          sourceWorkflowReservedAt: reservation.reservedAt,
          createdAt: "2026-08-04T00:03:00.000Z",
        }],
      };
      draft.candidates.push(candidate);
      attachExactCandidateGate(draft, candidate, { reservedAt: "2026-08-04T00:04:00.000Z" });
    });

    const grantResponse = await fetch(`${origin}/api/tasks/${task.id}/grant-retry`, { method: "POST" });
    assert.equal(grantResponse.status, 200);
    assert.deepEqual(await grantResponse.json(), { granted: true });

    const updated = await store.get(task.id);
    assert.equal(updated.stageRunLimits.implement, 4);
    assert.equal(updated.decisions.at(-1).candidateId, "C1");
    assert.equal(updated.decisions.at(-1).candidateRevision, 1);
    assert.equal(updated.decisions.at(-1).candidateHeadRevision, "candidate-c1-r1");
    assert.equal(updated.decisions.at(-1).workflowAttempt, 3);
    assert.equal(updated.decisions.at(-1).workflowCandidateId, null);
    assert.equal(updated.decisions.at(-1).workflowCandidateRevision, null);
    assert.equal(updated.decisions.at(-1).workflowCandidateHeadRevision, null);
    assert.equal(updated.decisions.at(-1).workflowReservationId, reservation.id);
    assert.equal(updated.decisions.at(-1).sourceRunId, null);
    assert.deepEqual(updated.decisions.at(-1).sourceRunIds, []);
    assert.equal(updated.decisions.at(-1).authorizingGateReservationId, `reservation-${task.id}-dev-review-1`);
  } finally {
    await cleanup(server, directory);
  }
});

test("grants repair after a completed structured Test failure on the final implementation allowance", async () => {
  const { directory, origin, server, store } = await createServer();
  try {
    const response = await createTask(origin, {
      title: "Repair completed Test failure",
      description: "A valid failed focused Test must authorize repair without another Implement allowance.",
      repositoryPath: directory,
      workflow: "implement",
    });
    const { task } = await response.json();
    await store.update(task.id, (draft) => {
      draft.status = "repair-required";
      draft.currentStage = "test";
      const candidate = attachAssemblyLineage(draft, {
        id: "C1",
        revisionNumber: 1,
        headRevision: "candidate-c1-r1",
        status: "repair_required",
      }, {
        workflowAttempt: 3,
        reservationId: "reservation-c1-assembly-3",
      });
      draft.candidates.push(candidate);
      const authorizer = attachExactCandidateGate(draft, candidate, {
        stage: "test",
        reservationId: "reservation-c1-test-1",
        reservedAt: "2026-08-04T00:02:00.000Z",
      });
      const testRun = draft.runs.find((run) => run.id === authorizer.sourceRunId);
      const testArtifact = draft.artifacts.find((artifact) => artifact.id === authorizer.sourceArtifactId);
      const row = {
        id: "test-row-failed",
        candidateId: "C1",
        candidateRevision: 1,
        bindingExplicit: true,
        command: "node --test tests/api.test.mjs",
        status: "failed",
        durationMs: 5,
        title: "Focused API contract",
        artifactReferences: [],
        assertions: [{ label: "exit code", expected: "0", actual: "1" }],
        failureDetails: "One focused assertion failed.",
      };
      const focusedTest = {
        candidateId: "C1",
        candidateRevision: 1,
        bindingExplicit: true,
        command: row.command,
        status: "failed",
        startedAt: testRun.startedAt,
        completedAt: testRun.completedAt,
        durationMs: 1_000,
        rowCount: 1,
        failedRowIds: [row.id],
        rows: [row],
      };
      testRun.test = {
        candidateId: "C1",
        candidateRevision: 1,
        command: focusedTest.command,
        status: "failed",
        startedAt: focusedTest.startedAt,
        completedAt: focusedTest.completedAt,
        durationMs: focusedTest.durationMs,
        rowCount: 1,
        failedRowIds: [row.id],
        rows: [row],
      };
      testArtifact.focusedTest = focusedTest;
      refreshGateFreshness(draft);
    });

    const before = await store.get(task.id);
    assert.equal(before.gateFreshness.test.reasonCode, "repair_required");
    const grantResponse = await fetch(`${origin}/api/tasks/${task.id}/grant-retry`, { method: "POST" });
    assert.equal(grantResponse.status, 200, JSON.stringify(await grantResponse.clone().json()));
    const updated = await store.get(task.id);
    assert.equal(updated.stageRunLimits.implement, 4);
    assert.equal(updated.decisions.at(-1).authorizingGateStage, "test");
  } finally {
    await cleanup(server, directory);
  }
});

test("rejects assembly-only scope exceptions without exact ordered package commit membership", async () => {
  const { directory, origin, server, store } = await createServer();
  try {
    for (const item of [
      {
        name: "fabricated member head",
        mutate(candidate) {
          candidate.members[0].headRevision = "fabricated-head";
        },
      },
      {
        name: "missing member head",
        mutate(candidate) {
          candidate.members[1].headRevision = null;
        },
      },
      {
        name: "duplicate member order",
        mutate(candidate) {
          candidate.members[0].order = 2;
        },
      },
      {
        name: "noncanonical member order",
        mutate(candidate) {
          candidate.members.reverse();
        },
      },
      {
        name: "duplicate package commit heads",
        mutate(candidate, draft) {
          draft.workPackages[1].headRevision = draft.workPackages[0].headRevision;
          candidate.members[1].headRevision = candidate.members[0].headRevision;
        },
      },
    ]) {
      const response = await createTask(origin, {
        title: `Reject assembly-only ${item.name}`,
        description: "The empty-scope exception must prove the exact canonical assembly membership.",
        repositoryPath: directory,
        workflow: "implement",
      });
      const { task } = await response.json();
      await store.update(task.id, (draft) => {
        draft.status = "repair-required";
        draft.currentStage = "dev-review";
        draft.attemptsByStage.implement = draft.stageRunLimits.implement;
        draft.workPackages = [
          { id: "S2", status: "integrated", batch: 2, headRevision: "head-s2" },
          { id: "S1", status: "integrated", batch: 1, headRevision: "head-s1" },
        ];
        const reservation = {
          id: "reservation-assembly-only-3",
          stage: "implement",
          kind: "implementation",
          workflowAttempt: 3,
          candidateId: null,
          candidateRevision: null,
          candidateHeadRevision: null,
          authorizedRunScopes: [],
          reservedAt: "2026-08-04T00:02:00.000Z",
        };
        draft.stageRunReservations.implement = reservation;
        const candidate = {
          id: "C1",
          revisionNumber: 1,
          headRevision: "candidate-c1-r1",
          status: "repair_required",
          members: [
            { packageId: "S1", headRevision: "head-s1", order: 1 },
            { packageId: "S2", headRevision: "head-s2", order: 2 },
          ],
          sourceWorkflowAttempt: 3,
          sourceWorkflowReservationId: reservation.id,
          revisions: [{
            number: 1,
            headRevision: "candidate-c1-r1",
            reason: "assembly",
            sourceWorkflowAttempt: 3,
            sourceWorkflowReservationId: reservation.id,
            createdAt: "2026-08-04T00:03:00.000Z",
          }],
        };
        item.mutate(candidate, draft);
        draft.candidates.push(candidate);
      });

      const grantResponse = await fetch(`${origin}/api/tasks/${task.id}/grant-retry`, { method: "POST" });
      assert.equal(grantResponse.status, 409, item.name);
      assert.match((await grantResponse.json()).error, /inconsistent workflow reservation/i, item.name);
      const unchanged = await store.get(task.id);
      assert.equal(unchanged.stageRunLimits.implement, 3, item.name);
      assert.equal(unchanged.decisions.length, 0, item.name);
    }
  } finally {
    await cleanup(server, directory);
  }
});

test("grants one implementation retry after a failed candidate assembly", async () => {
  const { directory, origin, server, store, startedIdRef } = await createServer();
  try {
    const response = await createTask(origin, {
      title: "Retry failed assembly",
      description: "A failed candidate must not bind the next implementation reservation.",
      repositoryPath: directory,
      workflow: "implement",
    });
    const { task } = await response.json();
    let reservation;
    await store.update(task.id, (draft) => {
      draft.status = "blocked";
      draft.currentStage = "implement";
      draft.attemptsByStage.implement = draft.stageRunLimits.implement;
      draft.workPackages = [{ id: "S1", status: "failed" }];
      draft.runs.push(...[1, 2, 3].map((attempt) => ({
        id: `run-failed-assembly-${attempt}`,
        stage: "implement",
        status: "failed",
      })));
      reservation = bindLatestWorkflowAttempt(draft, "implement", "implementation");
      draft.candidates.push({
        id: "C3",
        revisionNumber: 1,
        headRevision: "failed-candidate-c3",
        status: "failed",
        sourceWorkflowAttempt: reservation.workflowAttempt,
        sourceWorkflowReservationId: reservation.id,
        revisions: [],
      });
    });

    const grantResponse = await fetch(`${origin}/api/tasks/${task.id}/grant-retry`, { method: "POST" });
    assert.equal(grantResponse.status, 200);
    assert.deepEqual(await grantResponse.json(), { granted: true });
    const granted = await store.get(task.id);
    assert.equal(granted.stageRunLimits.implement, 4);
    assert.equal(granted.decisions.at(-1).candidateId, null);
    assert.equal(granted.decisions.at(-1).candidateRevision, null);
    assert.equal(granted.decisions.at(-1).candidateHeadRevision, null);
    assert.equal(granted.decisions.at(-1).workflowCandidateId, null);
    assert.equal(granted.decisions.at(-1).workflowReservationId, reservation.id);

    const retryResponse = await fetch(`${origin}/api/tasks/${task.id}/implement`, { method: "POST" });
    assert.equal(retryResponse.status, 202);
    assert.deepEqual(await retryResponse.json(), { started: true });
    assert.equal(startedIdRef(), task.id);
  } finally {
    await cleanup(server, directory);
  }
});

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
      draft.runs.push(...[1, 2, 3].map((attempt) => ({
        id: `run-exhausted-repair-${attempt}`,
        stage: "implement",
        status: "failed",
      })));
      bindLatestWorkflowAttempt(draft, "implement", "repair");
    });

    const blockedRepair = await fetch(`${origin}/api/tasks/${task.id}/repair`, { method: "POST" });
    assert.equal(blockedRepair.status, 409);
    assert.deepEqual(await blockedRepair.json(), { error: "The current stage has exhausted its retry allowance." });

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

test("grants one bounded stage attempt to a reservation-bound candidate at an exhausted ready gate", async () => {
  const { directory, origin, server, store } = await createServer();
  try {
    const response = await createTask(origin, {
      title: "Exhausted ready gate",
      description: "Allow a repaired candidate to re-enter review after its prior review allowance was exhausted.",
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
      draft.runs.push(...[1, 2, 3].map((attempt) => ({
        id: `run-ready-review-${attempt}`,
        stage: "dev-review",
        status: "failed",
      })));
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

test("grants a fresh gate attempt after a target refresh without requiring repair lineage", async () => {
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
      draft.runs.push(...[1, 2, 3].map((attempt) => ({
        id: `run-target-refresh-review-${attempt}`,
        stage: "dev-review",
        status: "failed",
      })));
      bindLatestWorkflowAttempt(draft, "dev-review", "review");
      candidate.revisionNumber = 2;
      candidate.baseRevision = "target-base-r2";
      candidate.headRevision = "candidate-target-refresh-r2";
      candidate.revisions.push({
        number: 2,
        headRevision: candidate.headRevision,
        reason: "target-refresh",
        previousBaseRevision: "target-base-r1",
        previousHeadRevision: oldHead,
        baseRevision: candidate.baseRevision,
        createdAt: "2026-08-04T00:03:00.000Z",
      });
    });

    const grantResponse = await fetch(`${origin}/api/tasks/${task.id}/grant-retry`, { method: "POST" });
    assert.equal(grantResponse.status, 200);
    const updated = await store.get(task.id);
    assert.equal(updated.stageRunLimits["dev-review"], 4);
    assert.equal(updated.candidates[0].revisions[1].reason, "target-refresh");
    assert.equal(updated.candidates[0].sourceWorkflowAttempt, 1);
  } finally {
    await cleanup(server, directory);
  }
});

test("retains exact run provenance for an authorized adjacent prior-candidate grant", async () => {
  const { directory, origin, server, store } = await createServer();
  try {
    const response = await createTask(origin, {
      title: "Repaired candidate lineage",
      description: "Retain the exact exhausted review run while keeping current and workflow candidate bindings separate.",
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
        revisionNumber: 2,
        headRevision: "candidate-c1-r2",
        status: "ready_for_review",
        sourceWorkflowAttempt: 2,
        sourceWorkflowReservationId: "reservation-c1-r1-repair-1",
        revisions: [
          {
            number: 1,
            headRevision: "candidate-c1-r1",
            reason: "assembly",
            sourceWorkflowAttempt: 1,
            sourceWorkflowReservationId: "reservation-c1-r1-implementation-1",
            createdAt: "2026-08-04T00:00:00.000Z",
          },
          {
            number: 2,
            headRevision: "candidate-c1-r2",
            reason: "repair",
            sourceWorkflowAttempt: 2,
            sourceWorkflowReservationId: "reservation-c1-r1-repair-1",
            createdAt: "2026-08-04T00:01:00.000Z",
          },
        ],
      };
      draft.candidates.push(candidate);
      candidate.revisions[1].sourceWorkflowReservedAt = "2026-08-04T00:00:30.000Z";
      const authorizer = attachExactCandidateGate(draft, {
        id: "C1",
        revisionNumber: 1,
        headRevision: "candidate-c1-r1",
      }, {
        workflowAttempt: 3,
        reservationId: "reservation-c1-r1-review-3",
        reservedAt: "2026-08-04T00:00:10.000Z",
      });
      Object.assign(candidate.revisions[1], {
        authorizingGateStage: authorizer.stage,
        authorizingGateWorkflowAttempt: authorizer.workflowAttempt,
        authorizingGateReservationId: authorizer.id,
        authorizingGateReservedAt: authorizer.reservedAt,
        authorizingGateRunId: authorizer.sourceRunId,
        authorizingGateArtifactId: authorizer.sourceArtifactId,
      });
      attachCandidateProducerEvidence(draft, candidate);
      draft.stageRunReservations.implement = {
        id: "reservation-c1-r1-repair-1",
        stage: "implement",
        kind: "repair",
        workflowAttempt: 2,
        candidateId: "C1",
        candidateRevision: 1,
        candidateHeadRevision: "candidate-c1-r1",
        reservedAt: "2026-08-04T00:00:30.000Z",
      };
    });

    const grantResponse = await fetch(`${origin}/api/tasks/${task.id}/grant-retry`, { method: "POST" });
    assert.equal(grantResponse.status, 200, JSON.stringify(await grantResponse.clone().json()));
    const updated = await store.get(task.id);
    assert.equal(updated.decisions.at(-1).sourceRunId, "run-reservation-c1-r1-review-3");
    assert.deepEqual(updated.decisions.at(-1).sourceRunIds, ["run-reservation-c1-r1-review-3"]);
    assert.equal(updated.decisions.at(-1).candidateId, "C1");
    assert.equal(updated.decisions.at(-1).candidateRevision, 2);
    assert.equal(updated.decisions.at(-1).candidateHeadRevision, "candidate-c1-r2");
    assert.equal(updated.decisions.at(-1).workflowCandidateId, "C1");
    assert.equal(updated.decisions.at(-1).workflowCandidateRevision, 1);
    assert.equal(updated.decisions.at(-1).workflowCandidateHeadRevision, "candidate-c1-r1");
    assert.equal(updated.decisions.at(-1).workflowReservationId, "reservation-c1-r1-review-3");
    assert.equal(updated.decisions.at(-1).authorizingGateReservationId, "reservation-c1-r1-review-3");
    assert.equal(updated.decisions.at(-1).authorizingGateRunId, "run-reservation-c1-r1-review-3");
    assert.match(updated.decisions.at(-1).authorizingGateArtifactId, /run-reservation-c1-r1-review-3/);
    assert.equal(updated.events.at(-1).sourceRunId, "run-reservation-c1-r1-review-3");
    assert.deepEqual(updated.events.at(-1).sourceRunIds, ["run-reservation-c1-r1-review-3"]);
    assert.equal(updated.events.at(-1).authorizingGateRunId, "run-reservation-c1-r1-review-3");
    assert.equal(updated.decisions.at(-1).candidateAuthorizerReservationIds.length, 1);
    assert.equal(updated.decisions.at(-1).candidateAuthorizerReservationIds[0], "reservation-c1-r1-review-3");
    assert.equal(updated.decisions.at(-1).candidateAuthorizerRunIds.length, 1);
    assert.equal(updated.decisions.at(-1).candidateAuthorizerArtifactIds.length, 1);
    assert.equal(updated.stageRunLimits["dev-review"], 4);
  } finally {
    await cleanup(server, directory);
  }
});

test("grants an exhausted prior gate after a later gate authorized the adjacent repair", async () => {
  const { directory, origin, server, store } = await createServer();
  try {
    const response = await createTask(origin, {
      title: "Cross-gate repaired candidate retry",
      description: "A Test-authorized repair must still permit an exhausted earlier Development Review to rerun.",
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
      const repairedRevision = candidate.revisions[2];
      repairedRevision.sourceWorkflowReservedAt = "2026-08-04T00:01:40.000Z";
      draft.candidates.push(candidate);

      const testAuthorizer = attachExactCandidateGate(draft, {
        id: candidate.id,
        revisionNumber: 2,
        headRevision: "candidate-c1-r2",
      }, {
        stage: "test",
        workflowAttempt: 1,
        reservationId: "reservation-c1-r2-test-1",
        reservedAt: "2026-08-04T00:01:20.000Z",
      });
      const testRun = draft.runs.find((run) => run.id === testAuthorizer.sourceRunId);
      const testArtifact = draft.artifacts.find((artifact) => artifact.id === testAuthorizer.sourceArtifactId);
      const failedRow = {
        id: "cross-gate-test-failure",
        candidateId: candidate.id,
        candidateRevision: 2,
        bindingExplicit: true,
        command: "npm run test:frontend",
        status: "failed",
        durationMs: 5,
        title: "Frontend unit tests",
        artifactReferences: [],
        assertions: [{ label: "exit code", expected: "0", actual: "1" }],
        failureDetails: "One exact candidate assertion failed.",
      };
      const focusedTest = {
        candidateId: candidate.id,
        candidateRevision: 2,
        bindingExplicit: true,
        command: failedRow.command,
        status: "failed",
        startedAt: testRun.startedAt,
        completedAt: testRun.completedAt,
        durationMs: 1_000,
        rowCount: 1,
        failedRowIds: [failedRow.id],
        rows: [failedRow],
      };
      testRun.test = { ...focusedTest };
      testArtifact.focusedTest = focusedTest;
      Object.assign(repairedRevision, {
        authorizingGateStage: testAuthorizer.stage,
        authorizingGateProvider: "codex",
        authorizingGateWorkflowAttempt: testAuthorizer.workflowAttempt,
        authorizingGateReservationId: testAuthorizer.id,
        authorizingGateReservedAt: testAuthorizer.reservedAt,
        authorizingGateRunId: testAuthorizer.sourceRunId,
        authorizingGateArtifactId: testAuthorizer.sourceArtifactId,
      });
      attachCandidateProducerEvidence(draft, candidate);

      draft.stageRunReservations.implement = {
        id: repairedRevision.sourceWorkflowReservationId,
        stage: "implement",
        kind: "repair",
        workflowAttempt: repairedRevision.sourceWorkflowAttempt,
        candidateId: candidate.id,
        candidateRevision: 2,
        candidateHeadRevision: "candidate-c1-r2",
        authorizedRunScopes: [],
        reservedAt: repairedRevision.sourceWorkflowReservedAt,
      };
      const priorReviewReservation = {
        id: "reservation-c1-r2-review-3",
        stage: "dev-review",
        kind: "review",
        workflowAttempt: 3,
        candidateId: candidate.id,
        candidateRevision: 2,
        candidateHeadRevision: "candidate-c1-r2",
        authorizedRunScopes: [],
        reservedAt: "2026-08-04T00:01:10.000Z",
      };
      draft.stageRunReservations["dev-review"] = priorReviewReservation;
      draft.runs.push({
        id: "run-reservation-c1-r2-review-3",
        stage: "dev-review",
        kind: "review",
        role: "dev-review",
        status: "completed",
        startedAt: "2026-08-04T00:01:11.000Z",
        completedAt: "2026-08-04T00:01:12.000Z",
        candidateId: candidate.id,
        candidateRevision: 2,
        candidateHeadRevision: "candidate-c1-r2",
        workPackageId: null,
        attempt: 1,
        workflowAttempt: 3,
        workflowReservationId: priorReviewReservation.id,
      });
    });

    const grantResponse = await fetch(`${origin}/api/tasks/${task.id}/grant-retry`, { method: "POST" });
    assert.equal(grantResponse.status, 200, JSON.stringify(await grantResponse.clone().json()));
    assert.deepEqual(await grantResponse.json(), { granted: true });
    const updated = await store.get(task.id);
    const decision = updated.decisions.at(-1);
    assert.equal(updated.stageRunLimits["dev-review"], 4);
    assert.equal(decision.candidateRevision, 3);
    assert.equal(decision.workflowReservationId, "reservation-c1-r2-review-3");
    assert.equal(decision.workflowCandidateRevision, 2);
    assert.equal(decision.sourceRunId, "run-reservation-c1-r2-review-3");
    assert.equal(decision.authorizingGateStage, "test");
    assert.equal(decision.authorizingGateReservationId, "reservation-c1-r2-test-1");
    assert.equal(decision.authorizingGateRunId, "run-reservation-c1-r2-test-1");
    assert.equal(decision.candidateAuthorizerReservationIds.includes("reservation-c1-r2-test-1"), true);
  } finally {
    await cleanup(server, directory);
  }
});

test("rejects an adjacent repaired-candidate gate grant without an exact prior gate run", async () => {
  const { directory, origin, server, store } = await createServer();
  try {
    const response = await createTask(origin, {
      title: "Missing adjacent repair authorizer",
      description: "A prior-revision gate cannot receive a retry without its exact exhausted-stage run.",
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
        id: "reservation-c1-r1-review-3",
        stage: "dev-review",
        kind: "review",
        workflowAttempt: 3,
        candidateId: "C1",
        candidateRevision: 1,
        candidateHeadRevision: "candidate-c1-r1",
        authorizedRunScopes: [],
        reservedAt: "2026-08-04T00:00:10.000Z",
      };
    });

    const grantResponse = await fetch(`${origin}/api/tasks/${task.id}/grant-retry`, { method: "POST" });
    assert.equal(grantResponse.status, 409);
    assert.match((await grantResponse.json()).error, /inconsistent workflow reservation|authorizing gate/i);
    const unchanged = await store.get(task.id);
    assert.equal(unchanged.stageRunLimits["dev-review"], 3);
    assert.equal(unchanged.decisions.length, 0);
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
          const run = draft.runs.find((entry) => entry.workflowReservationId === revision.sourceWorkflowReservationId);
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
        description: "Every retained Repair revision must preserve its causal gate, reservation, run, and artifact chain.",
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

test("rejects a prior-candidate gate grant without exact adjacent revision lineage", async () => {
  const { directory, origin, server, store } = await createServer();
  try {
    const response = await createTask(origin, {
      title: "Missing repair lineage",
      description: "A prior gate reservation cannot authorize an unrelated current candidate.",
      repositoryPath: directory,
      workflow: "implement",
    });
    const { task } = await response.json();
    await store.update(task.id, (draft) => {
      draft.status = "ready-for-review";
      draft.currentStage = "dev-review";
      draft.attemptsByStage["dev-review"] = draft.stageRunLimits["dev-review"];
      draft.candidates.push({
        id: "C1",
        revisionNumber: 2,
        headRevision: "candidate-c1-r2",
        status: "ready_for_review",
        revisions: [],
      });
      draft.stageRunReservations["dev-review"] = {
        id: "reservation-unproven-c1-r1-review-3",
        stage: "dev-review",
        kind: "review",
        workflowAttempt: 3,
        candidateId: "C1",
        candidateRevision: 1,
        candidateHeadRevision: "candidate-c1-r1",
        reservedAt: "2026-08-04T00:00:00.000Z",
      };
    });

    const grantResponse = await fetch(`${origin}/api/tasks/${task.id}/grant-retry`, { method: "POST" });
    assert.equal(grantResponse.status, 409);
    assert.match((await grantResponse.json()).error, /inconsistent workflow reservation/i);
    assert.equal((await store.get(task.id)).stageRunLimits["dev-review"], 3);
  } finally {
    await cleanup(server, directory);
  }
});

test("rejects adjacent prior-revision grants without unique repair provenance", async () => {
  const { directory, origin, server, store } = await createServer();
  try {
    for (const item of [
      {
        name: "non-repair current revision",
        mutate(candidate) {
          candidate.revisions[1].reason = "assembly";
        },
      },
      {
        name: "duplicate current revision",
        mutate(candidate) {
          candidate.revisions.push({ ...candidate.revisions[1] });
        },
      },
      {
        name: "missing source reservation",
        mutate(_candidate, draft) {
          delete draft.stageRunReservations.implement;
        },
      },
      {
        name: "mismatched repair source",
        mutate(candidate) {
          candidate.revisions[1].sourceWorkflowReservationId = "different-repair-reservation";
        },
      },
      {
        name: "malformed older revision",
        mutate(candidate) {
          delete candidate.revisions[0].createdAt;
        },
      },
    ]) {
      const response = await createTask(origin, {
        title: `Reject ${item.name}`,
        description: "The prior-revision exception requires exact durable repair provenance.",
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
          revisionNumber: 2,
          headRevision: "candidate-c1-r2",
          status: "ready_for_review",
          sourceWorkflowAttempt: 2,
          sourceWorkflowReservationId: "reservation-c1-r1-repair-1",
          revisions: [
            {
              number: 1,
              headRevision: "candidate-c1-r1",
              reason: "assembly",
              sourceWorkflowAttempt: 1,
              sourceWorkflowReservationId: "reservation-c1-r1-implementation-1",
              createdAt: "2026-08-04T00:00:00.000Z",
            },
            {
              number: 2,
              headRevision: "candidate-c1-r2",
              reason: "repair",
              sourceWorkflowAttempt: 2,
              sourceWorkflowReservationId: "reservation-c1-r1-repair-1",
              createdAt: "2026-08-04T00:01:00.000Z",
            },
          ],
        };
        draft.candidates.push(candidate);
        attachCandidateProducerEvidence(draft, candidate);
        draft.stageRunReservations.implement = {
          id: "reservation-c1-r1-repair-1",
          stage: "implement",
          kind: "repair",
          workflowAttempt: 2,
          candidateId: "C1",
          candidateRevision: 1,
          candidateHeadRevision: "candidate-c1-r1",
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
          reservedAt: "2026-08-04T00:00:00.000Z",
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
      assert.equal((await store.get(task.id)).stageRunLimits["dev-review"], 3, item.name);
    }
  } finally {
    await cleanup(server, directory);
  }
});

test("rejects impossible older repair lineage before authorizing an adjacent gate grant", async () => {
  const { directory, origin, server, store } = await createServer();
  try {
    for (const item of [
      {
        name: "reused repair reservation",
        mutate(candidate) {
          candidate.revisions[1].sourceWorkflowReservationId = candidate.revisions[2].sourceWorkflowReservationId;
        },
      },
      {
        name: "non-monotonic repair attempt",
        mutate(candidate) {
          candidate.revisions[1].sourceWorkflowAttempt = candidate.revisions[2].sourceWorkflowAttempt;
        },
      },
      {
        name: "duplicate historical head",
        mutate(candidate) {
          candidate.revisions[1].headRevision = candidate.revisions[0].headRevision;
        },
      },
      {
        name: "backward repair timestamp",
        mutate(candidate) {
          candidate.revisions[1].createdAt = "2026-08-04T00:03:00.000Z";
        },
      },
      {
        name: "repair reservation before retained review",
        mutate(_candidate, draft) {
          draft.stageRunReservations.implement.reservedAt = "2026-08-04T00:01:00.000Z";
        },
      },
    ]) {
      const response = await createTask(origin, {
        title: `Reject ${item.name}`,
        description: "Every retained repair revision must be uniquely and chronologically producible.",
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
        draft.stageRunReservations.implement = {
          id: "reservation-c1-r2-repair-3",
          stage: "implement",
          kind: "repair",
          workflowAttempt: 3,
          candidateId: "C1",
          candidateRevision: 2,
          candidateHeadRevision: "candidate-c1-r2",
          reservedAt: "2026-08-04T00:01:30.000Z",
        };
        draft.stageRunReservations["dev-review"] = {
          id: "reservation-c1-r2-review-3",
          stage: "dev-review",
          kind: "review",
          workflowAttempt: 3,
          candidateId: "C1",
          candidateRevision: 2,
          candidateHeadRevision: "candidate-c1-r2",
          reservedAt: "2026-08-04T00:01:15.000Z",
        };
        item.mutate(candidate, draft);
      });

      const grantResponse = await fetch(`${origin}/api/tasks/${task.id}/grant-retry`, { method: "POST" });
      assert.equal(grantResponse.status, 409, item.name);
      assert.match((await grantResponse.json()).error, /inconsistent workflow reservation/i, item.name);
      assert.equal((await store.get(task.id)).stageRunLimits["dev-review"], 3, item.name);
    }
  } finally {
    await cleanup(server, directory);
  }
});

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
        description: "An exact current binding cannot bypass complete candidate history and producer validation.",
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
      description: "Authorize a gate retry only when the current repair producer matches the Implement counter.",
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

test("retains failed-command REPAIR evidence as historical repair lineage only", async () => {
  const { directory, origin, server, store } = await createServer();
  try {
    const response = await createTask(origin, {
      title: "Historical repair authorizer with failed command telemetry",
      description: "A stale REPAIR gate must remain causal lineage without becoming fresh gate evidence.",
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

      const historicalAuthorizer = draft.runs.find((run) => (
        run.id === candidate.revisions[1].authorizingGateRunId
      ));
      historicalAuthorizer.toolCalls = [{
        id: "historical-command-failure",
        name: "command_execution",
        category: "repository-command",
        phase: "completed",
        result: "Exit code 127",
      }];

      draft.stageRunReservations.implement = {
        id: candidate.sourceWorkflowReservationId,
        stage: "implement",
        kind: "repair",
        workflowAttempt: 2,
        candidateId: "C1",
        candidateRevision: 1,
        candidateHeadRevision: "candidate-c1-r1",
        authorizedRunScopes: [],
        reservedAt: candidate.revisions[1].sourceWorkflowReservedAt,
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
    });

    const grantResponse = await fetch(`${origin}/api/tasks/${task.id}/grant-retry`, { method: "POST" });
    assert.equal(grantResponse.status, 200, JSON.stringify(await grantResponse.clone().json()));
    assert.deepEqual(await grantResponse.json(), { granted: true });
    const updated = await store.get(task.id);
    assert.equal(updated.stageRunLimits["dev-review"], 4);
    assert.equal(updated.decisions.at(-1).candidateRevision, 2);
    assert.equal(updated.decisions.at(-1).candidateAuthorizerRunIds.length, 1);
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
        revisions: [{
          number: 1,
          headRevision: "candidate-c1-r1",
          reason: "assembly",
          sourceWorkflowAttempt: 2,
          sourceWorkflowReservationId: "reservation-c1-assembly-2",
          sourceWorkflowReservedAt: "2026-08-04T00:00:30.000Z",
          createdAt: "2026-08-04T00:01:00.000Z",
        }],
      };
      draft.candidates.push(candidate);
      attachCandidateProducerEvidence(draft, candidate);
      const producerIndex = draft.runs.findIndex((run) => (
        run.workflowReservationId === candidate.sourceWorkflowReservationId
      ));
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

test("rejects exact-current and adjacent repaired candidates without durable repair producer evidence", async () => {
  const { directory, origin, server, store } = await createServer();
  try {
    for (const item of [
      { name: "exact current missing repair run", adjacent: false, mutation: "run" },
      { name: "exact current missing repair artifact", adjacent: false, mutation: "artifact" },
      { name: "adjacent missing repair run", adjacent: true, mutation: "run" },
      { name: "adjacent missing repair artifact", adjacent: true, mutation: "artifact" },
    ]) {
      const response = await createTask(origin, {
        title: `Reject ${item.name}`,
        description: "A repaired candidate must retain its exact producer run and linked artifact.",
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
          id: item.adjacent ? "reservation-c1-r1-review-3" : "reservation-c1-r2-review-3",
          stage: "dev-review",
          kind: "review",
          workflowAttempt: 3,
          candidateId: "C1",
          candidateRevision: item.adjacent ? 1 : 2,
          candidateHeadRevision: item.adjacent ? "candidate-c1-r1" : "candidate-c1-r2",
          authorizedRunScopes: [],
          reservedAt: item.adjacent ? "2026-08-04T00:00:15.000Z" : "2026-08-04T00:02:00.000Z",
        };
        const producerRun = draft.runs.find((run) => (
          run.workflowReservationId === candidate.sourceWorkflowReservationId
        ));
        if (item.mutation === "run") {
          draft.runs = draft.runs.filter((run) => run !== producerRun);
        } else {
          draft.artifacts = draft.artifacts.filter((artifact) => artifact.id !== producerRun.artifactId);
        }
      });

      const grantResponse = await fetch(`${origin}/api/tasks/${task.id}/grant-retry`, { method: "POST" });
      assert.equal(grantResponse.status, 409, item.name);
      assert.match(
        (await grantResponse.json()).error,
        /producer evidence|inconsistent workflow reservation|duplicate or inconsistent persisted identities/i,
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

test("rejects repair retry authority without one unique durable authorizer artifact and run identity", async () => {
  const { directory, origin, server, store } = await createServer();
  try {
    for (const mutation of ["missing artifact", "duplicate run identity"]) {
      const response = await createTask(origin, {
        title: `Reject ${mutation}`,
        description: "A repair retry requires one unique durable authorizing gate.",
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
        if (mutation === "missing artifact") {
          draft.artifacts = draft.artifacts.filter((artifact) => artifact.id !== authorizer.sourceArtifactId);
        }
        draft.runs.push(...[1, 2, 3].map((attempt) => ({
          id: mutation === "duplicate run identity" && attempt === 3
            ? authorizer.sourceRunId
            : `run-failed-repair-authority-${attempt}`,
          stage: "implement",
          status: "failed",
        })));
        bindLatestWorkflowAttempt(draft, "implement", "repair");
      });

      const grantResponse = await fetch(`${origin}/api/tasks/${task.id}/grant-retry`, { method: "POST" });
      assert.equal(grantResponse.status, 409, mutation);
      assert.match(
        (await grantResponse.json()).error,
        /authorizing gate|duplicate or inconsistent persisted identities|inconsistent workflow reservation/i,
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
        draft.runs.push(...[1, 2, 3].map((attempt) => ({
          id: `run-failed-repair-envelope-${attempt}`,
          stage: "implement",
          status: "failed",
        })));
        bindLatestWorkflowAttempt(draft, "implement", "repair");
        const authorizerRun = draft.runs.find((run) => run.id === authorizer.sourceRunId);
        const authorizerArtifact = draft.artifacts.find((artifact) => artifact.id === authorizer.sourceArtifactId);
        if (mutation === "failed authorizer run") authorizerRun.status = "failed";
        if (mutation === "shared authorizer artifact") draft.runs.at(-1).artifactId = authorizer.sourceArtifactId;
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
        const initialRun = draft.runs.find((run) => (
          run.workflowReservationId === candidate.revisions[0].sourceWorkflowReservationId
        ));
        const repairRun = draft.runs.find((run) => (
          run.workflowReservationId === candidate.sourceWorkflowReservationId
        ));
        const repairArtifact = draft.artifacts.find((artifact) => artifact.id === repairRun.artifactId);
        if (mutation === "forged initial attempt") initialRun.attempt = 999;
        if (mutation === "missing repair run timestamps") {
          delete repairRun.startedAt;
          delete repairRun.completedAt;
        }
        if (mutation === "missing repair artifact timestamp") delete repairArtifact.createdAt;
        if (mutation === "repair artifact after revision") repairArtifact.createdAt = "2026-08-04T00:01:01.000Z";
      });

      const grantResponse = await fetch(`${origin}/api/tasks/${task.id}/grant-retry`, { method: "POST" });
      assert.equal(grantResponse.status, 409, mutation);
      assert.match((await grantResponse.json()).error, /producer evidence|inconsistent workflow reservation/i, mutation);
      const unchanged = await store.get(task.id);
      assert.equal(unchanged.stageRunLimits["dev-review"], 3, mutation);
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
      { name: "ready review gate with approval-stage candidate", stage: "dev-review", candidateStatus: "awaiting_human_approval" },
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
      assert.match((await grantResponse.json()).error, /exhausted blocked, approval, or repair stage/i, item.name);
      assert.equal((await store.get(task.id)).decisions.length, 0, item.name);
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
      description: "A current candidate gate must prove its initial producer used real planned package scopes.",
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
      const producerRun = draft.runs.find((run) => run.workflowReservationId === candidate.sourceWorkflowReservationId);
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
      draft.runs.push(...[1, 2].map((attempt) => ({
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
      })));
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
      draft.runs.push(...["S2", "S1"].map((workPackageId) => ({
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
      })));
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
        runs: [{
          id: "run-implement-S9-1",
          kind: "implementation",
          role: "implement",
          workPackageId: "S9",
          attempt: 1,
        }],
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
        runs: [{
          id: "run-implement-S9-planned",
          kind: "implementation",
          role: "implement",
          workPackageId: "S9",
          attempt: 1,
        }],
        error: /does not match the persisted work-package plan/i,
      },
      {
        name: "unresolved planned package absent from scope snapshot",
        stage: "implement",
        kind: "implementation",
        authorizedRunScopes: ["S1"],
        workPackageIds: ["S1", "S2"],
        scoutDispatch: null,
        runs: [{
          id: "run-implement-S1-incomplete-snapshot",
          kind: "implementation",
          role: "implement",
          workPackageId: "S1",
          attempt: 1,
        }],
        error: /does not match the persisted work-package plan/i,
      },
      {
        name: "duplicate selected scout",
        stage: "scouts",
        kind: "investigation",
        authorizedRunScopes: ["scout-code-path"],
        workPackageIds: [],
        scoutDispatch: {
          selected: [{ name: "scout-code-path", focus: "Trace the API.", reason: "Needed.", status: "complete" }],
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
          selected: [{ name: "scout-fabricated", focus: "Invent evidence.", reason: "Invalid.", status: "complete" }],
          skipped: [],
          rationale: "A fabricated scout must not become authority.",
          createdAt: "2026-08-04T00:00:00.000Z",
          completedAt: "2026-08-04T00:01:00.000Z",
        },
        runs: [{
          id: "run-scout-fabricated-1",
          kind: "scout",
          role: "scout-fabricated",
          workPackageId: null,
          attempt: 1,
        }],
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
        draft.runs.push(...item.runs.map((run) => ({
          ...run,
          stage: item.stage,
          status: "failed",
          candidateId: null,
          candidateRevision: null,
          candidateHeadRevision: null,
          workflowAttempt: 3,
          workflowReservationId: reservationId,
        })));
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
        runs: [{
          id: "run-implement-S1-exact",
          kind: "implementation",
          role: "implement",
          workPackageId: "S1",
          attempt: 1,
          exact: true,
        }],
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
          selected: [{ name: "scout-code-path", focus: "Trace the API.", reason: "Needed.", status: "complete" }],
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
        description: "A multi-run reservation must snapshot its authorized scopes independently of emitted runs.",
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
        draft.runs.push(...item.runs.map(({ exact, ...run }) => ({
          ...run,
          stage: item.stage,
          status: "failed",
          candidateId: null,
          candidateRevision: null,
          candidateHeadRevision: null,
          ...(exact ? { workflowAttempt: 3, workflowReservationId: reservationId } : {}),
        })));
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
        selected: scopes.map((name) => ({ name, focus: `Focus ${name}.`, reason: "Needed.", status: "complete" })),
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
      draft.runs.push(...[...scopes].reverse().map((role) => ({
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
      })));
    });

    const grantResponse = await fetch(`${origin}/api/tasks/${task.id}/grant-retry`, { method: "POST" });
    assert.equal(grantResponse.status, 200);
    const updated = await store.get(task.id);
    assert.equal(updated.stageRunLimits.scouts, 4);
    assert.equal(updated.decisions.at(-1).sourceRunId, "run-scout-test-inventory");
    assert.deepEqual(updated.decisions.at(-1).sourceRunIds, ["run-scout-code-path", "run-scout-test-inventory"]);
    assert.deepEqual(updated.events.at(-1).sourceRunIds, ["run-scout-code-path", "run-scout-test-inventory"]);
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
        draft.runs.push(...[1, 2, 3].map((attempt) => ({
          id: `run-${stage}-${attempt}`,
          stage,
          status: "failed",
        })));
        if (candidateStatus) {
          const candidate = attachAssemblyLineage(draft, {
            id: "C1",
            revisionNumber: 1,
            headRevision: "candidate-c1-r1",
            status: candidateStatus,
          });
          draft.candidates.push(candidate);
        }
        bindLatestWorkflowAttempt(draft, stage, {
          triage: "investigation",
          plan: "planning",
          "dev-review": "review",
          test: "test",
          "final-review": "final-review",
        }[stage]);
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
      draft.runs.push(...[1, 2, 3].map((attempt) => ({
        id: `run-plan-${attempt}`,
        stage: "plan",
        status: "failed",
      })));
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

test("rejects a retry grant when reserved run metadata drifts before the atomic transition", async () => {
  let taskId = null;
  const { directory, origin, server, store } = await createServer({
    async beforeTransition(targetStore, id) {
      if (id !== taskId) return;
      await targetStore.update(id, (draft) => {
        const sourceRun = draft.runs.find((run) => run.id === "run-review-3");
        sourceRun.workPackageId = "unexpected-package";
      });
    },
  });
  try {
    const response = await createTask(origin, {
      title: "Atomic run history",
      description: "Reserve the complete exhausted run tuple before granting an allowance.",
      repositoryPath: directory,
      workflow: "implement",
    });
    const { task } = await response.json();
    taskId = task.id;
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
      draft.runs.push(...[1, 2, 3].map((attempt) => ({
        id: `run-review-${attempt}`,
        stage: "dev-review",
        kind: "review",
        role: "dev-review",
        status: "failed",
        candidateId: "C1",
        candidateRevision: 1,
        candidateHeadRevision: "candidate-c1-r1",
        workPackageId: null,
        attempt,
      })));
      bindLatestWorkflowAttempt(draft, "dev-review", "review");
    });

    const grantResponse = await fetch(`${origin}/api/tasks/${task.id}/grant-retry`, { method: "POST" });
    assert.equal(grantResponse.status, 409);
    assert.match((await grantResponse.json()).error, /state changed/i);
    const updated = await store.get(task.id);
    assert.equal(updated.stageRunLimits["dev-review"], 3);
    assert.equal(updated.decisions.length, 0);
  } finally {
    await cleanup(server, directory);
  }
});

test("rejects a retry grant when candidate producer identities drift before the atomic transition", async () => {
  let taskId = null;
  const { directory, origin, server, store } = await createServer({
    async beforeTransition(targetStore, id) {
      if (id !== taskId) return;
      await targetStore.update(id, (draft) => {
        const candidate = draft.candidates.at(-1);
        const producerRun = draft.runs.find((run) => (
          run.workflowReservationId === candidate.sourceWorkflowReservationId
        ));
        const producerArtifact = draft.artifacts.find((artifact) => artifact.id === producerRun.artifactId);
        producerRun.id = `${producerRun.id}-renamed`;
        producerRun.artifactId = `${producerRun.artifactId}-renamed`;
        producerArtifact.id = producerRun.artifactId;
        producerArtifact.runId = producerRun.id;
      });
    },
  });
  try {
    const response = await createTask(origin, {
      title: "Atomic candidate producer identity",
      description: "Bind a retry grant to immutable candidate producer run and artifact identities.",
      repositoryPath: directory,
      workflow: "implement",
    });
    const { task } = await response.json();
    taskId = task.id;
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
    });

    const grantResponse = await fetch(`${origin}/api/tasks/${task.id}/grant-retry`, { method: "POST" });
    assert.equal(grantResponse.status, 409);
    assert.match((await grantResponse.json()).error, /state changed/i);
    const unchanged = await store.get(task.id);
    assert.equal(unchanged.stageRunLimits["dev-review"], 3);
    assert.match(
      unchanged.runs.find((run) => run.workflowReservationId === unchanged.candidates.at(-1).sourceWorkflowReservationId).id,
      /-renamed$/,
    );
    assert.equal(unchanged.decisions.length, 0);
  } finally {
    await cleanup(server, directory);
  }
});

test("rejects a repair grant when its retained authorizing gate changes before the atomic transition", async () => {
  let taskId = null;
  const { directory, origin, server, store } = await createServer({
    async beforeTransition(targetStore, id) {
      if (id !== taskId) return;
      await targetStore.update(id, (draft) => {
        const originalId = draft.stageRunReservations["dev-review"].id;
        draft.stageRunReservations["dev-review"].id = "review-authorizer-swapped";
        const gateRun = draft.runs.find((run) => run.workflowReservationId === originalId);
        gateRun.workflowReservationId = "review-authorizer-swapped";
      });
    },
  });
  try {
    const response = await createTask(origin, {
      title: "Atomic repair authorizer",
      description: "Bind a repair grant to the exact retained gate that authorized the failed repair workflow.",
      repositoryPath: directory,
      workflow: "implement",
    });
    const { task } = await response.json();
    taskId = task.id;
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
      attachExactCandidateGate(draft, candidate, { reservationId: "review-authorizer-original" });
      draft.runs.push(...[1, 2, 3].map((attempt) => ({
        id: `run-failed-repair-race-${attempt}`,
        stage: "implement",
        status: "failed",
      })));
      bindLatestWorkflowAttempt(draft, "implement", "repair");
    });

    const grantResponse = await fetch(`${origin}/api/tasks/${task.id}/grant-retry`, { method: "POST" });
    assert.equal(grantResponse.status, 409);
    assert.match((await grantResponse.json()).error, /state changed/i);
    const unchanged = await store.get(task.id);
    assert.equal(unchanged.stageRunLimits.implement, 3);
    assert.equal(unchanged.stageRunReservations["dev-review"].id, "review-authorizer-swapped");
    assert.equal(
      unchanged.runs.find((run) => run.id === "run-review-authorizer-original").workflowReservationId,
      "review-authorizer-swapped",
    );
    assert.equal(unchanged.decisions.length, 0);
  } finally {
    await cleanup(server, directory);
  }
});

test("rejects a retry grant when the persisted source run tuple is already impossible for the stage", async () => {
  const { directory, origin, server, store } = await createServer();
  try {
    const response = await createTask(origin, {
      title: "Malformed review lineage",
      description: "Reject package-scoped repair metadata presented as Dev Review provenance.",
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
      draft.runs.push(...[1, 2, 3].map((attempt) => ({
        id: `run-malformed-review-${attempt}`,
        stage: "dev-review",
        status: "failed",
      })));
      bindLatestWorkflowAttempt(draft, "dev-review", "review");
      Object.assign(draft.runs.at(-1), {
        kind: "repair",
        role: "repair",
        workPackageId: "S1",
        attempt: 99,
      });
    });

    const grantResponse = await fetch(`${origin}/api/tasks/${task.id}/grant-retry`, { method: "POST" });
    assert.equal(grantResponse.status, 409);
    assert.match((await grantResponse.json()).error, /does not match its workflow reservation/i);
    const updated = await store.get(task.id);
    assert.equal(updated.stageRunLimits["dev-review"], 3);
    assert.equal(updated.decisions.length, 0);
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

test("rejects all-null reservations for candidate-bound review and repair grants", async () => {
  const { directory, origin, server, store } = await createServer();
  try {
    for (const item of [
      { stage: "dev-review", kind: "review", status: "ready_for_review" },
      { stage: "implement", kind: "repair", status: "repair_required" },
    ]) {
      const response = await createTask(origin, {
        title: `Null ${item.stage} reservation`,
        description: "Candidate-bound workflow attempts require exact candidate identity.",
        repositoryPath: directory,
        workflow: "implement",
      });
      const { task } = await response.json();
      await store.update(task.id, (draft) => {
        draft.status = "blocked";
        draft.currentStage = item.stage;
        draft.attemptsByStage[item.stage] = draft.stageRunLimits[item.stage];
        draft.candidates.push({
          id: "C1",
          revisionNumber: 1,
          headRevision: "candidate-c1-r1",
          status: item.status,
        });
        draft.stageRunReservations[item.stage] = {
          id: `reservation-null-${item.stage}-3`,
          stage: item.stage,
          kind: item.kind,
          workflowAttempt: 3,
          candidateId: null,
          candidateRevision: null,
          candidateHeadRevision: null,
          reservedAt: "2026-08-04T00:00:00.000Z",
        };
      });

      const grantResponse = await fetch(`${origin}/api/tasks/${task.id}/grant-retry`, { method: "POST" });
      assert.equal(grantResponse.status, 409, item.stage);
      assert.match((await grantResponse.json()).error, /inconsistent workflow reservation/i, item.stage);
      const updated = await store.get(task.id);
      assert.equal(updated.stageRunLimits[item.stage], 3, item.stage);
      assert.equal(updated.decisions.length, 0, item.stage);
    }
  } finally {
    await cleanup(server, directory);
  }
});

test("records null provenance when an exhausted preflight attempt has no persisted run", async () => {
  const { directory, origin, server, store } = await createServer();
  try {
    const response = await createTask(origin, {
      title: "Preflight-only exhaustion",
      description: "Grant a bounded retry without inventing run provenance.",
      repositoryPath: directory,
      workflow: "implement",
    });
    const { task } = await response.json();
    await store.update(task.id, (draft) => {
      draft.status = "blocked";
      draft.currentStage = "plan";
      draft.attemptsByStage.plan = draft.stageRunLimits.plan;
      draft.stageRunReservations.plan = {
        id: "reservation-plan-preflight-3",
        stage: "plan",
        kind: "planning",
        workflowAttempt: 3,
        candidateId: null,
        candidateRevision: null,
        candidateHeadRevision: null,
        reservedAt: "2026-08-04T00:00:00.000Z",
      };
    });

    const grantResponse = await fetch(`${origin}/api/tasks/${task.id}/grant-retry`, { method: "POST" });
    assert.equal(grantResponse.status, 200);
    const updated = await store.get(task.id);
    assert.equal(updated.stageRunLimits.plan, 4);
    assert.deepEqual(
      {
        grantedStage: updated.decisions.at(-1).grantedStage,
        previousLimit: updated.decisions.at(-1).previousLimit,
        newLimit: updated.decisions.at(-1).newLimit,
        sourceRunId: updated.decisions.at(-1).sourceRunId,
      },
      { grantedStage: "plan", previousLimit: 3, newLimit: 4, sourceRunId: null },
    );
    assert.deepEqual(
      {
        grantedStage: updated.events.at(-1).grantedStage,
        previousLimit: updated.events.at(-1).previousLimit,
        newLimit: updated.events.at(-1).newLimit,
        sourceRunId: updated.events.at(-1).sourceRunId,
      },
      { grantedStage: "plan", previousLimit: 3, newLimit: 4, sourceRunId: null },
    );
  } finally {
    await cleanup(server, directory);
  }
});

test("rejects an exhausted grant without an exact workflow reservation", async () => {
  const { directory, origin, server, store } = await createServer();
  try {
    const response = await createTask(origin, {
      title: "Missing workflow reservation",
      description: "Migrated or incomplete state must fail closed instead of fabricating exhaustion evidence.",
      repositoryPath: directory,
      workflow: "implement",
    });
    const { task } = await response.json();
    await store.update(task.id, (draft) => {
      draft.status = "blocked";
      draft.currentStage = "plan";
      draft.attemptsByStage.plan = draft.stageRunLimits.plan;
      draft.stageRunReservations = {};
    });

    const grantResponse = await fetch(`${origin}/api/tasks/${task.id}/grant-retry`, { method: "POST" });
    assert.equal(grantResponse.status, 409);
    assert.match((await grantResponse.json()).error, /inconsistent workflow reservation/i);
    const updated = await store.get(task.id);
    assert.equal(updated.stageRunLimits.plan, 3);
    assert.equal(updated.decisions.length, 0);
  } finally {
    await cleanup(server, directory);
  }
});

test("rejects a retry grant while the latest exhausted-stage run is still active", async () => {
  const { directory, origin, server, store } = await createServer();
  try {
    const response = await createTask(origin, {
      title: "Active retry source",
      description: "Do not grant over an unresolved terminal source.",
      repositoryPath: directory,
      workflow: "implement",
    });
    const { task } = await response.json();
    await store.update(task.id, (draft) => {
      draft.status = "blocked";
      draft.currentStage = "test";
      draft.attemptsByStage.test = draft.stageRunLimits.test;
      draft.candidates.push({ id: "C1", revisionNumber: 2, status: "ready_for_test" });
      draft.runs.push(
        { id: "run-test-1", stage: "test", status: "failed" },
        { id: "run-test-2", stage: "test", status: "failed" },
        { id: "run-test-3", stage: "test", status: "running" },
      );
    });

    const grantResponse = await fetch(`${origin}/api/tasks/${task.id}/grant-retry`, { method: "POST" });
    assert.equal(grantResponse.status, 409);
    assert.match((await grantResponse.json()).error, /active or inconsistent run history/i);
    const updated = await store.get(task.id);
    assert.equal(updated.stageRunLimits.test, 3);
    assert.equal(updated.decisions.length, 0);
  } finally {
    await cleanup(server, directory);
  }
});

test("rejects a retry grant when an earlier exhausted-stage run remains active", async () => {
  const { directory, origin, server, store } = await createServer();
  try {
    const response = await createTask(origin, {
      title: "Earlier active retry source",
      description: "Do not grant while any run in the exhausted stage remains active.",
      repositoryPath: directory,
      workflow: "implement",
    });
    const { task } = await response.json();
    await store.update(task.id, (draft) => {
      draft.status = "blocked";
      draft.currentStage = "test";
      draft.attemptsByStage.test = draft.stageRunLimits.test;
      draft.candidates.push({ id: "C1", revisionNumber: 1, headRevision: "candidate-c1-r1", status: "ready_for_test" });
      draft.runs.push(
        { id: "run-test-1", stage: "test", status: "failed" },
        { id: "run-test-2", stage: "test", status: "running" },
        { id: "run-test-3", stage: "test", status: "failed" },
      );
    });

    const grantResponse = await fetch(`${origin}/api/tasks/${task.id}/grant-retry`, { method: "POST" });
    assert.equal(grantResponse.status, 409);
    assert.match((await grantResponse.json()).error, /active or inconsistent run history/i);
    const updated = await store.get(task.id);
    assert.equal(updated.stageRunLimits.test, 3);
    assert.equal(updated.decisions.length, 0);
  } finally {
    await cleanup(server, directory);
  }
});

test("rejects a retry grant when recorded attempts already exceed the allowance", async () => {
  const { directory, origin, server, store } = await createServer();
  try {
    const response = await createTask(origin, {
      title: "Exceeded repair allowance",
      description: "Reject inconsistent retry state instead of increasing the allowance by more than one.",
      repositoryPath: directory,
      workflow: "implement",
    });
    const { task } = await response.json();
    await store.update(task.id, (draft) => {
      draft.status = "failed";
      draft.currentStage = "implement";
      draft.attemptsByStage.implement = draft.stageRunLimits.implement + 1;
      draft.candidates.push({ id: "C1", status: "repair_required" });
    });

    const grantResponse = await fetch(`${origin}/api/tasks/${task.id}/grant-retry`, { method: "POST" });
    assert.equal(grantResponse.status, 409);
    assert.deepEqual(await grantResponse.json(), {
      error: "The recorded attempts exceed this stage's allowance; resolve the inconsistent task state before granting a retry.",
    });
    const updated = (await (await fetch(`${origin}/api/tasks/${task.id}`)).json()).task;
    assert.equal(updated.stageRunLimits.implement, 3);
    assert.equal(updated.attemptsByStage.implement, 4);
    assert.equal(updated.status, "failed");
    assert.equal(updated.decisions.length, 0);
  } finally {
    await cleanup(server, directory);
  }
});

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
      assert.equal(first.task.decisions[0].sourceDecisionId, "source-decision");
      assert.equal(startedIdRef(), first.task.id);
      assert.equal(startedKindRef(), "planning");

      const retainedSource = await store.get(source.id);
      assert.equal(retainedSource.status, "completed");
      assert.equal(retainedSource.workflow, "investigate");
      assert.equal(retainedSource.continuedByTaskId, first.task.id);

      const repeated = await fetch(`${origin}/api/tasks/${source.id}/continue-implementation`, { method: "POST" });
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
    const request = httpRequest({ hostname: url.hostname, port: url.port, path: pathname, method, headers }, (response) => {
      response.resume();
      response.on("end", () => resolve({ status: response.statusCode }));
    });
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
