import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { ProcessTimeoutError } from "../server/codex-runtime.mjs";
import { defaultStagePolicies } from "../server/model-catalog.mjs";
import { evaluationVerdict, structuredEvidenceError, TaskOrchestrator } from "../server/orchestrator.mjs";
import { buildTestInterpretationRequest } from "../server/prompts.mjs";
import {
  attachRunArtifact,
  beginAgentRun,
  CANONICAL_RUN_STAGES,
  DEFAULT_EXECUTION_PROVIDER,
  DEFAULT_STAGE_RUN_LIMIT,
  migrateRunActivityState,
  RUN_ACTIVITY_EVENT_LIMIT,
  RUNTIME_FRESHNESS_REASONS,
  readExplicitCandidateBinding,
  refreshGateFreshness,
  retainRunActivityEvents,
  stageRunLimitFor,
  TASK_STORE_SCHEMA_VERSION,
} from "../server/run-activity.mjs";
import { selectScoutDispatch } from "../server/scouts.mjs";
import { JsonTaskStore } from "../server/store.mjs";
import {
  parseFocusedTestEvidence,
  parseGateEvidence,
  parseGrillQuestions,
  parseWorkPackages,
  tryParseFocusedTestEvidence,
  validateFocusedTestEvidence,
} from "../server/structured-output.mjs";

const GRILL_OUTPUT = `## Settled facts\n\nGrounded.\n\n<grill-questions>\n{"questions":[{"question":"Compatibility?","whyItMatters":"Changes the public contract.","options":[{"label":"Preserve it","description":"Keep existing clients working.","recommended":true},{"label":"Break it","description":"Allow a clean break.","recommended":false}],"allowCustom":true}]}\n</grill-questions>`;

const SYNTHESIS_OUTPUT = `## Recommended diagnosis\n\nH1.\n\n<investigation-result>\n{"hypotheses":[{"id":"H1","claim":"The runtime path and the UI path disagree about task priority.","confidence":0.8,"supportingEvidence":["server/runtime.mjs:12"],"contradictingEvidence":[],"unknowns":["Whether any caller depends on the old default."]}],"recommendedDiagnosis":"H1","remainingUncertainty":0.2,"additionalEvidenceNeeded":[]}\n</investigation-result>`;

const PLAN_OUTPUT = `## Plan summary\n\nTwo independent slices.\n\n<work-packages>\n{"packages":[{"id":"S1","title":"Runtime","description":"Implement runtime behavior.","dependencies":[],"ownedPaths":["server/runtime.mjs"],"verificationCommandIds":["test"]},{"id":"S2","title":"UI","description":"Implement the task UI.","dependencies":[],"ownedPaths":["src/App.tsx"],"verificationCommandIds":["typecheck"]}]}\n</work-packages>`;

function harnessEvidence(candidate, overrides = {}) {
  return {
    candidateId: candidate.id,
    candidateRevision: candidate.revisionNumber,
    bindingExplicit: true,
    headRevision: candidate.headRevision,
    command: ".agent-harness/verification.json: test",
    status: "passed",
    startedAt: "2026-08-01T12:00:00.000Z",
    completedAt: "2026-08-01T12:00:01.240Z",
    durationMs: 1240,
    executedCommandIds: ["test"],
    declaredCommandIds: ["test"],
    rows: [
      {
        id: "test",
        candidateId: candidate.id,
        candidateRevision: candidate.revisionNumber,
        bindingExplicit: true,
        title: "Node test suite",
        command: "npm test",
        status: "passed",
        durationMs: 1240,
        artifactReferences: [],
        assertions: [{ label: "exit code", actual: "0", expected: "0" }],
        failureDetails: null,
      },
    ],
    ...overrides,
  };
}

const passingVerification = async ({ candidate }) => harnessEvidence(candidate);

const TEST_OUTPUT = `PASS\n\n## Verdict\n\nPASS\n\n<focused-test-evidence>\n{"candidateId":"C1","candidateRevision":2,"command":"npm.cmd run test:orchestrator","status":"passed","startedAt":"2026-08-01T12:00:00.000Z","completedAt":"2026-08-01T12:00:01.240Z","durationMs":1240,"rows":[{"id":"row-1","candidateId":"C1","candidateRevision":2,"command":"npm.cmd run test:orchestrator","status":"passed","durationMs":1240,"title":"orchestrator.test.mjs","artifactReferences":[{"name":"Markdown test artifact","kind":"markdown","path":"artifacts/test.md"}],"assertions":[{"label":"all packages qualified","actual":"pass","expected":"pass"}],"failureDetails":null},{"id":"row-2","candidateId":"C1","candidateRevision":2,"command":"npm.cmd run test:orchestrator","status":"passed","durationMs":350,"title":"api.test.mjs","artifactReferences":[{"name":"JUnit report","kind":"junit","path":"artifacts/junit.xml"}],"assertions":[{"label":"API contract","actual":"pass","expected":"pass"}],"failureDetails":null}]}\n</focused-test-evidence>`;

function gateOutput(revision, verdict = "PASS", findings = []) {
  const reproducibleFindings = findings.map((finding) => {
    const classified = { kind: "candidate-defect", ...finding };
    return ["P0", "P1"].includes(classified.severity) && !classified.reproductionEvidence
      ? {
          ...classified,
          reproductionEvidence: "Follow the deterministic candidate path described in this finding.",
        }
      : classified;
  });
  return `${verdict}\n\n## Verdict\n\n${verdict}\n\n<gate-evidence>\n${JSON.stringify({ candidateId: "C1", candidateRevision: revision, verdict, summary: "Candidate-bound result", findings: reproducibleFindings })}\n</gate-evidence>`;
}

const SCOUT_OUTPUT = `<scout-report>
{"status":"ok","findings":[{"file":"src/mock.ts","line":1,"fact":"Mock repository fact for the selected scout.","confidence":"high"}],"uncertainties":[]}
</scout-report>`;

function claudeRunWithoutProvider() {
  const run = makeRuntimeRun({ id: "RUN-2", attempt: 2, gateResult: makeGateResult() });
  delete run.provider;
  return run;
}

function makeRuntimeTask({
  candidateId = "C1",
  candidateRevision = 2,
  runs = [],
  artifacts = [],
  events = [],
  revisions = [],
} = {}) {
  return {
    candidates: [{ id: candidateId, revisionNumber: candidateRevision, revisions }],
    runs,
    artifacts,
    events,
  };
}

function makeRuntimeRun({
  id = "RUN-1",
  stage = "dev-review",
  kind = "review",
  candidateId = "C1",
  candidateRevision = 2,
  status = "completed",
  attempt = 1,
  artifactId = null,
  gateResult = makeGateResult({ stage, candidateId, candidateRevision }),
  test = null,
  evidenceError = null,
  error = null,
} = {}) {
  return {
    id,
    kind,
    provider: "codex",
    status,
    stage,
    role: stage,
    model: "gpt-5.6-luna",
    reasoning: "xhigh",
    startedAt: "2026-08-01T12:00:00.000Z",
    completedAt: "2026-08-01T12:01:00.000Z",
    durationMs: 60_000,
    artifactId,
    usage: null,
    credits: null,
    apiEstimate: null,
    candidateId,
    candidateRevision,
    workPackageId: null,
    attempt,
    retryOfRunId: null,
    repairOfRunId: null,
    toolCalls: [],
    test,
    gateResult,
    evidenceError,
    freshness: null,
    error,
    source: "codex-jsonl",
  };
}

function makeGateResult({
  stage = "dev-review",
  candidateId = "C1",
  candidateRevision = 2,
  verdict = "PASS",
  reportedVerdict = verdict,
  blockingReasons = [],
  findings = [],
} = {}) {
  return {
    schemaVersion: 1,
    stage,
    verdict,
    reportedVerdict,
    candidateId,
    candidateRevision,
    evaluatedAt: "2026-08-01T12:01:00.000Z",
    blockingReasons,
    findings,
  };
}

function makePersistedFinding(overrides = {}) {
  return {
    severity: "P2",
    title: "Persisted finding",
    detail: "Persisted finding detail.",
    file: "server/run-activity.mjs",
    line: 371,
    candidateId: "C1",
    candidateRevision: 2,
    bindingExplicit: true,
    ...overrides,
  };
}

function makeTestRow({ id = "row-1", candidateId = "C1", candidateRevision = 2, status = "passed" } = {}) {
  return {
    id,
    candidateId,
    candidateRevision,
    bindingExplicit: true,
    command: "npm test",
    status,
    durationMs: 100,
    title: `${id}.test.mjs`,
    artifactReferences: [],
    assertions: [],
    failureDetails: null,
  };
}

function makeFocusedTestSummary({
  candidateId = "C1",
  candidateRevision = 2,
  command = "npm test",
  status = "passed",
  durationMs = 100,
  rows = [makeTestRow({ candidateId, candidateRevision, status })],
  failedRowIds = rows.filter((row) => row.status === "failed").map((row) => row.id),
} = {}) {
  return {
    candidateId,
    candidateRevision,
    bindingExplicit: true,
    command,
    status,
    durationMs,
    rowCount: rows.length,
    failedRowIds,
    rows,
  };
}

function makeArtifact({
  id = "ART-1",
  stage = "dev-review",
  candidateId = "C1",
  candidateRevision = 2,
  gateResult = makeGateResult({ stage, candidateId, candidateRevision }),
  focusedTest = null,
} = {}) {
  return {
    id,
    stage,
    kind: "markdown",
    name: `${id}.md`,
    content: "# retained evidence",
    createdAt: "2026-08-01T12:01:00.000Z",
    candidateId,
    candidateRevision,
    gateResult,
    focusedTest,
  };
}

async function createApprovalReadyTask(store, directory, title) {
  const task = await store.create({
    title,
    description: "Publish the exact qualified candidate through a GitHub pull request.",
    repositoryPath: directory,
    workflow: "implement",
    priority: "medium",
  });
  await store.update(task.id, (draft) => {
    draft.status = "awaiting-human-approval";
    draft.currentStage = "approval";
    draft.completedStages = [
      "triage",
      "scouts",
      "grill",
      "specification",
      "plan",
      "implement",
      "dev-review",
      "test",
      "final-review",
    ];
    draft.candidates = [
      {
        id: "C1",
        revisionNumber: 2,
        baseRevision: "a".repeat(40),
        baseBranch: "main",
        baseRef: "refs/heads/main",
        headRevision: "b".repeat(40),
        branch: "agent-harness/ah-pr-c1",
        repositoryRoot: directory,
        worktreePath: directory,
        status: "awaiting_human_approval",
        createdAt: "2026-08-01T12:00:00.000Z",
        updatedAt: "2026-08-01T12:00:00.000Z",
        revisions: [],
      },
    ];
    draft.runs = [
      makeRuntimeRun({ id: "RUN-DEV-PR" }),
      makeRuntimeRun({
        id: "RUN-TEST-PR",
        stage: "test",
        kind: "test",
        gateResult: makeGateResult({ stage: "test" }),
        test: makeFocusedTestSummary(),
      }),
      makeRuntimeRun({
        id: "RUN-FINAL-PR",
        stage: "final-review",
        gateResult: makeGateResult({ stage: "final-review" }),
      }),
    ];
    refreshGateFreshness(draft);
  });
  return store.get(task.id);
}

function pullRequestObservation({ state }) {
  return {
    repository: "acme/widgets",
    number: 84,
    url: "https://github.com/acme/widgets/pull/84",
    state,
    isDraft: false,
    targetBranch: "main",
    targetRevision: "a".repeat(40),
    headBranch: `agent-harness/ah-042-c1-r2-${"b".repeat(8)}`,
    headRevision: "b".repeat(40),
    mergedAt: state === "merged" ? "2026-08-01T12:10:00.000Z" : null,
    closedAt: state === "closed" ? "2026-08-01T12:10:00.000Z" : null,
    mergeCommitRevision: state === "merged" ? "c".repeat(40) : null,
  };
}

async function waitForStatus(store, id, expected) {
  // 400 * 5ms = 2s: comfortable for the fake-backed tests here, which settle almost
  // immediately, and for the handful that exercise a real `GitWorktreeManager` against
  // a real git repository, whose worktree/commit/assemble calls are not instant.
  for (let attempt = 0; attempt < 400; attempt += 1) {
    const task = await store.get(id);
    if (task.status === expected) return task;
    if (attempt > 5 && ["failed", "blocked", "cancelled", "repair-required"].includes(task.status)) {
      assert.fail(`Task stopped at ${task.status}: ${task.error ?? "no error"}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail(`Task did not reach ${expected}.`);
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const execFileAsync = promisify(execFile);

async function git(cwd, args) {
  return execFileAsync("git", args, { cwd, windowsHide: true });
}

export {
  assert,
  attachRunArtifact,
  beginAgentRun,
  buildTestInterpretationRequest,
  CANONICAL_RUN_STAGES,
  claudeRunWithoutProvider,
  createApprovalReadyTask,
  DEFAULT_EXECUTION_PROVIDER,
  DEFAULT_STAGE_RUN_LIMIT,
  defaultStagePolicies,
  escapeRegex,
  evaluationVerdict,
  execFile,
  execFileAsync,
  GRILL_OUTPUT,
  gateOutput,
  git,
  harnessEvidence,
  JsonTaskStore,
  makeArtifact,
  makeFocusedTestSummary,
  makeGateResult,
  makePersistedFinding,
  makeRuntimeRun,
  makeRuntimeTask,
  makeTestRow,
  migrateRunActivityState,
  mkdtemp,
  os,
  PLAN_OUTPUT,
  ProcessTimeoutError,
  parseFocusedTestEvidence,
  parseGateEvidence,
  parseGrillQuestions,
  parseWorkPackages,
  passingVerification,
  path,
  promisify,
  pullRequestObservation,
  RUN_ACTIVITY_EVENT_LIMIT,
  RUNTIME_FRESHNESS_REASONS,
  readExplicitCandidateBinding,
  refreshGateFreshness,
  retainRunActivityEvents,
  rm,
  SCOUT_OUTPUT,
  SYNTHESIS_OUTPUT,
  selectScoutDispatch,
  stageRunLimitFor,
  structuredEvidenceError,
  TASK_STORE_SCHEMA_VERSION,
  TaskOrchestrator,
  TEST_OUTPUT,
  tryParseFocusedTestEvidence,
  validateFocusedTestEvidence,
  waitForStatus,
  writeFile,
};
