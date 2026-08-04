import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createApiServer } from "../server/api.mjs";
import { GitWorktreeManager } from "../server/git-worktree.mjs";
import { JsonTaskStore } from "../server/store.mjs";
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
  const store = new JsonTaskStore(path.join(directory, "tasks.json"));
  await store.init();
  let startedId = null;
  let startedKind = null;
  let recordedDecision = null;
  let grillAnswer = null;
  let grillFinish = null;
  let approvedSpecification = null;
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
    async approveMerge() {},
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
  const server = createApiServer({ store: apiStore, orchestrator, suggestedRepository: directory, csrfToken: TEST_CSRF_TOKEN });
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
    createdAt: "2026-08-04T00:06:00.000Z",
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
    attachLinkedArtifact(draft, run, {
      candidateId: revision.number === 1 ? null : candidate.id,
      candidateRevision: revision.number === 1 ? null : revision.number,
      workPackageId: revision.number === 1 ? run.workPackageId : null,
    });
    draft.runs.push(run);
  }
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
  const gateResult = {
    schemaVersion: 1,
    stage,
    verdict: "REPAIR",
    reportedVerdict: "REPAIR",
    candidateId: candidate.id,
    candidateRevision: candidate.revisionNumber,
    evaluatedAt: "2026-08-04T00:05:00.000Z",
    blockingReasons: ["P1: exact candidate repair is required."],
    findings: [{
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
    assert.equal(health.runtimeSchemaVersion, 5);
    assert.equal(detail.task.runs[0].id, "RUN-API");
    assert.equal(detail.task.runs[0].toolCalls[0].result, "Exit code 0");
    assert.equal(detail.task.events.at(-1).runId, "RUN-API");
    assert.equal(list.tasks[0].runs[0].apiEstimate, 0.001);
  } finally {
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

    const detailResponse = await fetch(`${origin}/api/changelog/${commits[0].sha}`);
    assert.equal(detailResponse.status, 200);
    const commit = (await detailResponse.json()).commit;
    assert.equal(commit.files[0].path, "CHANGELOG_TEST.txt");

    const diffResponse = await fetch(`${origin}/api/changelog/${commits[0].sha}/file?path=${encodeURIComponent("CHANGELOG_TEST.txt")}`);
    assert.equal(diffResponse.status, 200);
    const diff = await diffResponse.json();
    assert.match(diff.diff, /\+second/);
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
        allowedModels: ["gpt-5.6-sol", "gpt-5.6-luna"],
        defaultModel: "gpt-5.6-sol",
        defaultReasoning: "xhigh",
      }),
    });
    assert.equal(settingsResponse.status, 200);
    const settings = (await settingsResponse.json()).settings;
    assert.equal(settings.defaultModel, "gpt-5.6-sol");
    assert.equal(settings.defaultReasoning, "xhigh");

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
    const answerResponse = await fetch(`${origin}/api/tasks/${task.id}/grill/answers`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ questionId: "Q1", answer: "Preserve compatibility" }),
    });
    assert.equal(answerResponse.status, 201);
    assert.deepEqual(grillAnswerRef(), {
      id: task.id,
      questionId: "Q1",
      answer: "Preserve compatibility",
    });

    const finishResponse = await fetch(`${origin}/api/tasks/${task.id}/grill/finish`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ acceptRemaining: true }),
    });
    assert.equal(finishResponse.status, 202);
    assert.deepEqual(grillFinishRef(), { id: task.id, acceptRemaining: true });
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
      draft.runs.push({
        id: "run-c1-r1-review-3",
        stage: "dev-review",
        kind: "review",
        role: "dev-review",
        status: "completed",
        candidateId: "C1",
        candidateRevision: 1,
        candidateHeadRevision: "candidate-c1-r1",
        workPackageId: null,
        attempt: 1,
        workflowAttempt: 3,
        workflowReservationId: "reservation-c1-r1-review-3",
      });
    });

    const grantResponse = await fetch(`${origin}/api/tasks/${task.id}/grant-retry`, { method: "POST" });
    assert.equal(grantResponse.status, 200, JSON.stringify(await grantResponse.clone().json()));
    const updated = await store.get(task.id);
    assert.equal(updated.decisions.at(-1).sourceRunId, "run-c1-r1-review-3");
    assert.deepEqual(updated.decisions.at(-1).sourceRunIds, ["run-c1-r1-review-3"]);
    assert.equal(updated.decisions.at(-1).candidateId, "C1");
    assert.equal(updated.decisions.at(-1).candidateRevision, 2);
    assert.equal(updated.decisions.at(-1).candidateHeadRevision, "candidate-c1-r2");
    assert.equal(updated.decisions.at(-1).workflowCandidateId, "C1");
    assert.equal(updated.decisions.at(-1).workflowCandidateRevision, 1);
    assert.equal(updated.decisions.at(-1).workflowCandidateHeadRevision, "candidate-c1-r1");
    assert.equal(updated.decisions.at(-1).workflowReservationId, "reservation-c1-r1-review-3");
    assert.equal(updated.events.at(-1).sourceRunId, "run-c1-r1-review-3");
    assert.deepEqual(updated.events.at(-1).sourceRunIds, ["run-c1-r1-review-3"]);
    assert.equal(updated.stageRunLimits["dev-review"], 4);
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
        /producer evidence|inconsistent workflow reservation/i,
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
      assert.match((await grantResponse.json()).error, /exhausted blocked stage or repair attempt/i, item.name);
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
      { stage: "triage", candidateStatus: null },
      { stage: "plan", candidateStatus: null },
      { stage: "dev-review", candidateStatus: "ready_for_review" },
      { stage: "test", candidateStatus: "ready_for_test" },
      { stage: "final-review", candidateStatus: "ready_for_final_review" },
    ];
    for (const { stage, candidateStatus } of cases) {
      const response = await createTask(origin, {
        title: `Blocked ${stage}`,
        description: `Grant only the exhausted ${stage} stage.`,
        repositoryPath: directory,
        workflow: "implement",
      });
      const { task } = await response.json();
      const sourceRunId = `run-${stage}-3`;
      await store.update(task.id, (draft) => {
        draft.status = "blocked";
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
