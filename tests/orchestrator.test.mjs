import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { ProcessTimeoutError } from "../server/codex-runtime.mjs";
import { defaultWorktreeRoot } from "../server/git-worktree.mjs";
import { evaluationVerdict, structuredEvidenceError, TaskOrchestrator } from "../server/orchestrator.mjs";
import { defaultStagePolicies } from "../server/model-catalog.mjs";
import { buildExecutionPrompt, buildTestInterpretationRequest } from "../server/prompts.mjs";
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
import {
  attachRunArtifact,
  beginAgentRun,
  CANONICAL_RUN_STAGES,
  DEFAULT_EXECUTION_PROVIDER,
  DEFAULT_STAGE_RUN_LIMIT,
  migrateRunActivityState,
  readExplicitCandidateBinding,
  refreshGateFreshness,
  retainRunActivityEvents,
  RUNTIME_FRESHNESS_REASONS,
  RUN_ACTIVITY_EVENT_LIMIT,
  stageRunLimitFor,
  TASK_STORE_SCHEMA_VERSION,
} from "../server/run-activity.mjs";

const GRILL_OUTPUT = `## Settled facts\n\nGrounded.\n\n<grill-questions>\n{"questions":[{"question":"Compatibility?","whyItMatters":"Changes the public contract.","options":[{"label":"Preserve it","description":"Keep existing clients working.","recommended":true},{"label":"Break it","description":"Allow a clean break.","recommended":false}],"allowCustom":true}]}\n</grill-questions>`;
const PLAN_OUTPUT = `## Plan summary\n\nTwo independent slices.\n\n<work-packages>\n{"packages":[{"id":"S1","title":"Runtime","description":"Implement runtime behavior.","dependencies":[],"ownedPaths":["server/runtime.mjs"],"verificationCommandIds":["test"]},{"id":"S2","title":"UI","description":"Implement the task UI.","dependencies":[],"ownedPaths":["src/App.tsx"],"verificationCommandIds":["typecheck"]}]}\n</work-packages>`;
/**
 * Harness verification, injected through the same seam `runCodex` and `worktreeManager`
 * already use.
 *
 * The test stage no longer asks a model what ran: the harness executes the repository's
 * declared commands and builds the evidence itself (#47). These tests are about gate
 * ingestion, freshness and retry accounting, not about spawning processes, so they supply the
 * observation rather than stand up a repository to obtain one. Real execution — argv spawning,
 * declared-report parsing, exact-SHA binding, refusal when a repository declares nothing — is
 * covered directly in `tests/verification.test.mjs`.
 */
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
    rows: [{
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
    }],
    ...overrides,
  };
}

const passingVerification = async ({ candidate }) => harnessEvidence(candidate);

const TEST_OUTPUT = `PASS\n\n## Verdict\n\nPASS\n\n<focused-test-evidence>\n{"candidateId":"C1","candidateRevision":2,"command":"npm.cmd run test:orchestrator","status":"passed","startedAt":"2026-08-01T12:00:00.000Z","completedAt":"2026-08-01T12:00:01.240Z","durationMs":1240,"rows":[{"id":"row-1","candidateId":"C1","candidateRevision":2,"command":"npm.cmd run test:orchestrator","status":"passed","durationMs":1240,"title":"orchestrator.test.mjs","artifactReferences":[{"name":"Markdown test artifact","kind":"markdown","path":"artifacts/test.md"}],"assertions":[{"label":"all packages qualified","actual":"pass","expected":"pass"}],"failureDetails":null},{"id":"row-2","candidateId":"C1","candidateRevision":2,"command":"npm.cmd run test:orchestrator","status":"passed","durationMs":350,"title":"api.test.mjs","artifactReferences":[{"name":"JUnit report","kind":"junit","path":"artifacts/junit.xml"}],"assertions":[{"label":"API contract","actual":"pass","expected":"pass"}],"failureDetails":null}]}\n</focused-test-evidence>`;

function gateOutput(revision, verdict = "PASS", findings = []) {
  const reproducibleFindings = findings.map((finding) => {
    const classified = { kind: "candidate-defect", ...finding };
    return ["P0", "P1"].includes(classified.severity) && !classified.reproductionEvidence
      ? { ...classified, reproductionEvidence: "Follow the deterministic candidate path described in this finding." }
      : classified;
  });
  return `${verdict}\n\n## Verdict\n\n${verdict}\n\n<gate-evidence>\n${JSON.stringify({ candidateId: "C1", candidateRevision: revision, verdict, summary: "Candidate-bound result", findings: reproducibleFindings })}\n</gate-evidence>`;
}

const SCOUT_OUTPUT = `<scout-report>
{"status":"ok","findings":[{"file":"src/mock.ts","line":1,"fact":"Mock repository fact for the selected scout.","confidence":"high"}],"uncertainties":[]}
</scout-report>`;

test("refreshes the pricing registry without rewriting legacy task estimates", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-pricing-verifier-"));
  try {
    const store = new JsonTaskStore(path.join(directory, "tasks.json"));
    await store.init();
    const task = await store.create({
      title: "Reprice recorded usage",
      description: "Keep historical API-rate estimates aligned with the verified rate card.",
      repositoryPath: directory,
      workflow: "investigate",
      priority: "medium",
      model: "gpt-5.6-luna",
      reasoning: "low",
    });
    await store.update(task.id, (draft) => {
      const usage = { inputTokens: 200_000, cachedInputTokens: 0, outputTokens: 1_000_000, totalTokens: 1_200_000 };
      draft.usage = usage;
      draft.artifacts.push({
        id: "priced-artifact",
        stage: "triage",
        name: "triage.md",
        kind: "markdown",
        content: "Recorded usage",
        createdAt: new Date().toISOString(),
        model: "gpt-5.6-luna",
        reasoning: "low",
        usage,
      });
    });
    let call;
    const orchestrator = new TaskOrchestrator(store, {
      runCodex: async (options) => {
        call = options;
        return {
          finalText: `<pricing-rates>${JSON.stringify({
            "gpt-5.6-sol": { short: { input: 5, cachedInput: 0.5, cacheWrite: 6.25, output: 30 } },
            "gpt-5.6-terra": { short: { input: 2, cachedInput: 0.2, cacheWrite: 2.5, output: 12 } },
            "gpt-5.6-luna": { short: { input: 0.25, cachedInput: 0.03, cacheWrite: 0.3, output: 1.3 } },
          })}</pricing-rates>`,
          usage: { inputTokens: 1_000, cachedInputTokens: 800, outputTokens: 100, totalTokens: 1_100 },
        };
      },
    });

    const result = await orchestrator.verifyPricing();
    assert.equal(call.sandbox, "read-only");
    assert.equal(call.reasoning, "low");
    assert.match(call.prompt, /official OpenAI documentation only/);
    assert.equal(result.settings.pricing.rates["gpt-5.6-sol"].short.output, 30);
    assert.match(result.settings.pricing.verifiedBy, /read-only verification agent/);
    assert.equal(result.usage.cachedInputTokens, 800);
    const historical = await store.get(task.id);
    assert.equal(historical.artifacts[0].usage.cost, undefined);
    assert.equal(historical.usage.cost, undefined);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("parses grounded Grill questions and dependency batches", () => {
  assert.equal(parseGrillQuestions(GRILL_OUTPUT)[0].options[0].recommended, true);
  const packages = parseWorkPackages(`<work-packages>{"packages":[{"id":"S1","title":"API","description":"Add API.","dependencies":[],"ownedPaths":["server/api.mjs"],"verificationCommandIds":["test"]},{"id":"S2","title":"UI","description":"Add UI.","dependencies":[],"ownedPaths":["src/App.tsx"],"verificationCommandIds":["typecheck"]},{"id":"S3","title":"Contract","description":"Join both.","dependencies":["S1","S2"],"ownedPaths":["tests/contract.test.mjs"],"verificationCommandIds":["test"]}]}</work-packages>`);
  assert.deepEqual(packages.map((item) => item.batch), [1, 1, 2]);
  assert.deepEqual(packages.find((item) => item.id === "S3")?.dependencies, ["S1", "S2"]);
  const fencedPackages = parseWorkPackages(
    '<work-packages>\n```json\n{"packages":[{"id":"S1","title":"API","description":"Add API.","dependencies":[],"ownedPaths":["server/api.mjs"],"verificationCommandIds":["test"]}]}\n```\n</work-packages>',
  );
  assert.deepEqual(fencedPackages.map((item) => item.ownedPaths), [["server/api.mjs"]]);
  assert.throws(
    () => parseWorkPackages('<work-packages>Before\n```json\n{"packages":[]}\n```\n</work-packages>'),
    /JSON block was invalid/i,
  );
  const absolute = parseWorkPackages(
    `<work-packages>{"packages":[{"id":"S1","title":"API","description":"Add API.","dependencies":[],"ownedPaths":["C:/repo/server/api.mjs"],"verificationCommandIds":["test"]}]}</work-packages>`,
    "C:/repo",
  );
  assert.deepEqual(absolute[0].ownedPaths, ["server/api.mjs"]);
  assert.throws(
    () =>
      parseWorkPackages(
        `<work-packages>{"packages":[{"id":"S1","title":"Escape","description":"Escape repo.","dependencies":[],"ownedPaths":["C:/outside/file.mjs"],"verificationCommandIds":["test"]}]}</work-packages>`,
        "C:/repo",
      ),
    /outside the selected repository/,
  );
  assert.throws(
    () => parseWorkPackages(
        `<work-packages>{"packages":[{"id":"S1","title":"Directory","description":"Own src.","dependencies":[],"ownedPaths":["src"],"verificationCommandIds":["test"]},{"id":"S2","title":"File","description":"Own nested file.","dependencies":[],"ownedPaths":["SRC\\\\App.tsx"],"verificationCommandIds":["test"]}]}</work-packages>`,
    ),
    /both own/i,
  );
  assert.throws(
    () => parseWorkPackages(
      `<work-packages>{"packages":[{"id":"S1","title":"Missing scope","description":"Unsafe scope.","dependencies":[],"ownedPaths":[],"verificationCommandIds":["test"]}]}</work-packages>`,
    ),
    /explicit repository-relative owned path/i,
  );
  assert.throws(
    () => parseWorkPackages(
      `<work-packages>{"packages":[{"id":"S1","title":"Missing verification","description":"Cannot qualify this package.","dependencies":[],"ownedPaths":["src/App.tsx"],"verificationCommandIds":[]}]}</work-packages>`,
    ),
    /repository manifest command ID/i,
  );
});

test("a revised plan retains the rejected plan artifact and replaces package scope", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-revise-plan-"));
  try {
    const store = new JsonTaskStore(path.join(directory, "tasks.json"));
    await store.init();
    const task = await store.create({
      title: "Revise plan",
      description: "Recover an unacceptable plan without erasing it.",
      repositoryPath: directory,
      workflow: "implement",
      priority: "medium",
    });
    await store.update(task.id, (draft) => {
      draft.status = "awaiting-plan-approval";
      draft.currentStage = "plan";
      draft.attemptsByStage.plan = 1;
      draft.completedStages = ["triage", "scouts", "grill", "specification", "plan"];
      draft.workPackages = [{
        id: "S1",
        title: "Rejected scope",
        description: "Wrong plan.",
        dependencies: [],
        batch: 1,
        ownedPaths: ["wrong/path.ts"],
        verification: [],
        status: "planned",
        attempts: 0,
      }];
      draft.artifacts.push({
        id: "plan-r1",
        stage: "plan",
        name: "implementation-plan.md",
        kind: "markdown",
        content: "Rejected plan",
        createdAt: "2026-08-08T00:00:00.000Z",
      });
      draft.decisions.push({
        id: "decision-r2",
        question: "How must the plan change?",
        answer: "Use one package under src/correct.ts.",
        createdAt: "2026-08-08T00:01:00.000Z",
      });
    });
    const revisedOutput = `<work-packages>{"packages":[{"id":"S1","title":"Correct scope","description":"One coherent package.","dependencies":[],"ownedPaths":["src/correct.ts"],"verificationCommandIds":["test"]}]}</work-packages>`;
    const orchestrator = new TaskOrchestrator(store, {
      readVerificationManifest: async () => ({ source: ".agent-harness/verification.json", commands: [{ id: "test", command: ["npm", "test"] }] }),
      getStatus: async () => ({ available: true, authenticated: true, authMethod: "ChatGPT" }),
      runCodex: async () => ({
        finalText: revisedOutput,
        model: "gpt-5.6-sol",
        reasoning: "high",
        usage: { inputTokens: 10, cachedInputTokens: 0, outputTokens: 5, totalTokens: 15 },
      }),
    });

    assert.equal(await orchestrator.start(task.id, "planning"), true);
    const revised = await waitForStatus(store, task.id, "awaiting-plan-approval");
    assert.equal(revised.attemptsByStage.plan, 2);
    assert.deepEqual(revised.workPackages.map((item) => item.ownedPaths), [["src/correct.ts"]]);
    assert.deepEqual(
      revised.artifacts.filter((artifact) => artifact.stage === "plan").map((artifact) => artifact.name),
      ["implementation-plan.md", "implementation-plan-r2.md"],
    );
    assert.equal(revised.artifacts.find((artifact) => artifact.id === "plan-r1").content, "Rejected plan");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("corrects a blocked legacy plan and preserves an exact clean slice for requalification", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-correct-blocked-plan-"));
  try {
    const store = new JsonTaskStore(path.join(directory, "tasks.json"));
    await store.init();
    const task = await store.create({
      title: "Correct blocked plan",
      description: "A persisted zero-command plan must return to read-only planning.",
      repositoryPath: directory,
      workflow: "implement",
      priority: "medium",
    });
    await store.update(task.id, (draft) => {
      draft.status = "blocked";
      draft.currentStage = "implement";
      draft.error = "S1: Focused package verification requires at least one repository manifest command id.";
      draft.attemptsByStage.plan = 1;
      draft.attemptsByStage.implement = 6;
      draft.stageRunLimits.implement = 6;
      draft.workPackages = [{
        id: "S1",
        title: "Browser contract",
        description: "Retain the exact committed browser change.",
        dependencies: [],
        batch: 1,
        ownedPaths: ["e2e/example.spec.ts"],
        verification: [],
        verificationCommandIds: [],
        verificationRuns: [],
        status: "failed",
        attempts: 6,
        branch: "agent-harness/blocked-plan-s1-a6",
        worktreePath: "/tmp/blocked-plan-s1-a6",
        baseRevision: "a".repeat(40),
        headRevision: "b".repeat(40),
        files: ["e2e/example.spec.ts"],
        error: draft.error,
      }];
    });
    const revisedOutput = `<work-packages>{"packages":[{"id":"S1","title":"Browser contract","description":"Retain the exact committed browser change.","dependencies":[],"ownedPaths":["e2e/example.spec.ts"],"verificationCommandIds":["playwright-e2e"]}]}</work-packages>`;
    const orchestrator = new TaskOrchestrator(store, {
      readVerificationManifest: async () => ({
        source: ".agent-harness/verification.json",
        commands: [{ id: "playwright-e2e", command: ["make", "e2e-native"] }],
      }),
      runCodex: async () => ({
        finalText: revisedOutput,
        model: "gpt-5.6-sol",
        reasoning: "high",
        usage: { inputTokens: 10, cachedInputTokens: 0, outputTokens: 5, totalTokens: 15 },
      }),
    });

    assert.deepEqual(await orchestrator.correctInvalidPlan(task.id), { started: true });
    const revised = await waitForStatus(store, task.id, "awaiting-plan-approval");
    assert.equal(revised.stageRunLimits.implement, 7);
    assert.equal(revised.workPackages[0].retainedForRequalification, true);
    assert.equal(revised.workPackages[0].headRevision, "b".repeat(40));
    assert.deepEqual(revised.workPackages[0].verificationCommandIds, ["playwright-e2e"]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("returns a failed package qualification to Plan and retains its commit for scoped continuation", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-correct-qualification-plan-"));
  try {
    const store = new JsonTaskStore(path.join(directory, "tasks.json"));
    await store.init();
    const task = await store.create({
      title: "Correct qualification scope",
      description: "Add the contract test exposed by focused package verification.",
      repositoryPath: directory,
      workflow: "implement",
      priority: "medium",
    });
    await store.update(task.id, (draft) => {
      draft.status = "blocked";
      draft.currentStage = "implement";
      draft.error = "S1 did not qualify: backend-test failed.";
      draft.attemptsByStage.plan = 1;
      draft.attemptsByStage.implement = 3;
      draft.workPackages = [{
        id: "S1",
        title: "Change route contract",
        description: "Implement the route change.",
        dependencies: [],
        batch: 1,
        ownedPaths: ["src/route.ts"],
        verification: [],
        verificationCommandIds: ["test"],
        verificationRuns: [],
        status: "failed",
        attempts: 3,
        branch: "agent-harness/qualification-s1-a3",
        worktreePath: "/tmp/qualification-s1-a3",
        baseRevision: "a".repeat(40),
        headRevision: "b".repeat(40),
        files: ["src/route.ts"],
        error: draft.error,
      }];
    });
    const revisedOutput = `<work-packages>{"packages":[{"id":"S1","title":"Change route contract","description":"Repair the route and its contract snapshot.","dependencies":[],"ownedPaths":["src","tests/contract.test.ts"],"verificationCommandIds":["test"]}]}</work-packages>`;
    const orchestrator = new TaskOrchestrator(store, {
      readVerificationManifest: async () => ({
        source: ".agent-harness/verification.json",
        commands: [{ id: "test", command: ["npm", "test"] }],
      }),
      worktreeManager: {
        base: async () => ({ repositoryRoot: directory, baseRevision: "c".repeat(40), baseBranch: "main" }),
        retainedPatchDisposition: async () => "pending",
      },
      runCodex: async () => ({
        finalText: revisedOutput,
        model: "gpt-5.6-sol",
        reasoning: "high",
        usage: { inputTokens: 10, cachedInputTokens: 0, outputTokens: 5, totalTokens: 15 },
      }),
    });

    assert.deepEqual(await orchestrator.correctInvalidPlan(task.id), { started: true });
    const revised = await waitForStatus(store, task.id, "awaiting-plan-approval");
    assert.equal(revised.stageRunLimits.implement, 4);
    assert.equal(revised.workPackages[0].retainedForRequalification, false);
    assert.match(revised.workPackages[0].retainedContinuation.qualificationFailure, /did not qualify/);
    assert.deepEqual(revised.workPackages[0].ownedPaths, ["src", "tests/contract.test.ts"]);
    assert.equal(revised.workPackages[0].headRevision, "b".repeat(40));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("requalifies an exact clean retained slice without rerunning model implementation", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-requalify-retained-slice-"));
  try {
    const store = new JsonTaskStore(path.join(directory, "tasks.json"));
    await store.init();
    const task = await store.create({
      title: "Requalify retained slice",
      description: "Use the corrected manifest against the exact clean package commit.",
      repositoryPath: directory,
      workflow: "implement",
      priority: "medium",
    });
    const baseRevision = "a".repeat(40);
    const packageRevision = "b".repeat(40);
    const candidateRevision = "c".repeat(40);
    await store.update(task.id, (draft) => {
      draft.status = "ready-for-implementation";
      draft.currentStage = "implement";
      draft.workPackages = [{
        id: "S1",
        title: "Browser contract",
        description: "Requalify the exact retained browser change.",
        dependencies: [],
        batch: 1,
        ownedPaths: ["e2e/example.spec.ts"],
        verification: [],
        verificationCommandIds: ["playwright-e2e"],
        verificationRuns: [],
        status: "planned",
        attempts: 6,
        branch: "agent-harness/requalify-s1-a6",
        worktreePath: "/tmp/requalify-s1-a6",
        baseRevision,
        headRevision: packageRevision,
        files: ["e2e/example.spec.ts"],
        error: null,
        retainedForRequalification: true,
      }];
    });
    let modelCalls = 0;
    const qualification = {
      ...makeFocusedTestSummary({ candidateId: "S1", candidateRevision: 6 }),
      headRevision: packageRevision,
      executionKind: "focused-package",
    };
    const orchestrator = new TaskOrchestrator(store, {
      readVerificationManifest: async () => ({
        source: ".agent-harness/verification.json",
        commands: [{ id: "playwright-e2e", command: ["make", "e2e-native"] }],
      }),
      runCodex: async () => {
        modelCalls += 1;
        throw new Error("Model implementation must not rerun for exact retained requalification.");
      },
      runPackageVerification: async () => qualification,
      worktreeManager: {
        base: async () => ({ repositoryRoot: directory, baseRevision, baseBranch: "main" }),
        inspectRetainedSlice: async () => ({
          branch: "agent-harness/requalify-s1-a6",
          files: ["e2e/example.spec.ts"],
          headRevision: packageRevision,
          worktreePath: "/tmp/requalify-s1-a6",
          clean: true,
        }),
        removeWorktree: async () => [],
        prepare: async (_task, candidateId, options) => ({
          id: candidateId,
          revisionNumber: 1,
          baseRevision: options.baseRevision,
          baseBranch: "main",
          baseRef: "refs/heads/main",
          headRevision: null,
          branch: `agent-harness/${candidateId.toLowerCase()}`,
          repositoryRoot: directory,
          worktreePath: directory,
          status: "assembling",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          revisions: [],
        }),
        assemble: async () => ({
          headRevision: candidateRevision,
          files: ["e2e/example.spec.ts"],
          summary: "1 file changed",
          diff: "",
        }),
      },
    });

    assert.equal(await orchestrator.start(task.id, "implementation"), true);
    const ready = await waitForStatus(store, task.id, "ready-for-review");
    assert.equal(modelCalls, 0);
    assert.equal(ready.workPackages[0].status, "integrated");
    const retainedRun = ready.runs.find((run) => run.source === "harness-requalification");
    assert.equal(retainedRun.status, "completed");
    assert.equal(ready.artifacts.find((artifact) => artifact.runId === retainedRun.id).model, null);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("a plan parse failure retains the exact failed attempt without replacing prior scope", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-invalid-plan-"));
  try {
    const store = new JsonTaskStore(path.join(directory, "tasks.json"));
    await store.init();
    const task = await store.create({
      title: "Retain failed plan",
      description: "Keep the model output when structured plan parsing fails.",
      repositoryPath: directory,
      workflow: "implement",
      priority: "medium",
    });
    await store.update(task.id, (draft) => {
      draft.status = "failed";
      draft.currentStage = "plan";
      draft.attemptsByStage.plan = 1;
      draft.workPackages = [{
        id: "S1",
        title: "Prior scope",
        description: "Retained plan.",
        dependencies: [],
        batch: 1,
        ownedPaths: ["src/prior.ts"],
        verification: [],
        status: "planned",
        attempts: 0,
      }];
      draft.artifacts.push({
        id: "plan-r1",
        stage: "plan",
        name: "implementation-plan.md",
        kind: "markdown",
        content: "Prior plan",
        createdAt: "2026-08-08T00:00:00.000Z",
      });
    });
    const invalidOutput = "<work-packages>not-json</work-packages>";
    const orchestrator = new TaskOrchestrator(store, {
      getStatus: async () => ({ available: true, authenticated: true, authMethod: "ChatGPT" }),
      runCodex: async () => ({
        finalText: invalidOutput,
        model: "gpt-5.6-sol",
        reasoning: "high",
        usage: { inputTokens: 10, cachedInputTokens: 0, outputTokens: 5, totalTokens: 15 },
      }),
    });

    assert.equal(await orchestrator.start(task.id, "planning"), true);
    const failed = await waitForStatus(store, task.id, "failed");
    assert.equal(failed.attemptsByStage.plan, 2);
    assert.deepEqual(failed.workPackages.map((item) => item.ownedPaths), [["src/prior.ts"]]);
    const planArtifacts = failed.artifacts.filter((artifact) => artifact.stage === "plan");
    assert.deepEqual(planArtifacts.map((artifact) => artifact.name), [
      "implementation-plan.md",
      "implementation-plan-r2-invalid.md",
    ]);
    assert.equal(planArtifacts.at(-1).content, invalidOutput);
    assert.equal(failed.runs.at(-1).artifactId, planArtifacts.at(-1).id);
    assert.match(failed.error, /work-packages JSON block was invalid/i);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("parses focused test evidence with candidate-bound rows", () => {
  const evidence = parseFocusedTestEvidence(TEST_OUTPUT);
  assert.equal(evidence.candidateId, "C1");
  assert.equal(evidence.rows.length, 2);
  assert.equal(evidence.rows[0].status, "passed");
  assert.equal(evidence.rows[1].status, "passed");
  assert.equal(evidence.rows[1].failureDetails, null);
  assert.equal(evidence.rows[1].artifactReferences[0].kind, "junit");
  assert.equal(evidence.rows[0].candidateId, "C1");
  assert.equal(evidence.rows[0].candidateRevision, 2);
  assert.equal(evidence.startedAt, "2026-08-01T12:00:00.000Z");
  assert.equal(evidence.completedAt, "2026-08-01T12:00:01.240Z");
  assert.equal(validateFocusedTestEvidence(evidence, { id: "C1", revisionNumber: 2 }), evidence);
  assert.throws(
    () => validateFocusedTestEvidence(evidence, { id: "C1", revisionNumber: 3 }),
    (error) => error.code === "revision_change",
  );
  assert.throws(
    () => parseFocusedTestEvidence(`<focused-test-evidence>{"candidateId":"C1","candidateRevision":2,"command":"npm test","status":"passed","rows":[{"id":"failed","status":"failed"}]}</focused-test-evidence>`),
    /contradicts its failed rows/i,
  );
  assert.throws(
    () => parseFocusedTestEvidence(`<focused-test-evidence>{"candidateId":"C1","candidateRevision":2,"command":"npm test","status":"unknown","rows":[{"id":"row","status":"passed"}]}</focused-test-evidence>`),
    /status must be passed or failed/i,
  );
});

test("classifies candidate evidence only from typed parser errors", () => {
  for (const message of [
    "missing_binding: must include a candidateId",
    "The candidate binding is malformed.",
    "The evidence belongs to a different candidate.",
    "A test command failed.",
  ]) {
    assert.deepEqual(
      structuredEvidenceError(new Error(message)),
      {
        code: "contradictory_evidence",
        copy: RUNTIME_FRESHNESS_REASONS.contradictory_evidence,
      },
      message,
    );
  }

  let typedError;
  try {
    parseFocusedTestEvidence(
      `<focused-test-evidence>{"candidateId":"C1","candidateRevision":"2"}</focused-test-evidence>`,
    );
  } catch (error) {
    typedError = error;
  }
  assert.ok(typedError);
  typedError.message = "Arbitrary human-readable copy mentioning a failed test.";
  assert.deepEqual(structuredEvidenceError(typedError), {
    code: "malformed_binding",
    copy: RUNTIME_FRESHNESS_REASONS.malformed_binding,
  });
});

test("optional focused Test parsing distinguishes absent from invalid evidence by typed code", () => {
  assert.equal(tryParseFocusedTestEvidence("No focused Test envelope was returned."), null);
  assert.throws(
    () => tryParseFocusedTestEvidence(
      `<focused-test-evidence>{"candidateId":"C1","candidateRevision":"2"}</focused-test-evidence>`,
    ),
    (error) => error.code === "malformed_binding",
  );
  assert.throws(
    () => tryParseFocusedTestEvidence(`<focused-test-evidence>{not-json}</focused-test-evidence>`),
    (error) => error.code === "contradictory_evidence",
  );
});

test("rejects malformed focused Test row fields before normalization", () => {
  const malformedRows = [
    { id: { value: "row-1" } },
    { command: { value: "npm test" } },
    { title: ["test title"] },
    { artifactReferences: [{ name: { value: "report" }, kind: "markdown", path: "report.md" }] },
    { artifactReferences: [{ name: "report", kind: "markdown", path: { value: "report.md" } }] },
    { assertions: [{ label: { value: "result" }, actual: "pass", expected: "pass" }] },
    { assertions: [{ label: "result", actual: { value: "pass" }, expected: "pass" }] },
    { failureDetails: { message: "failed" } },
  ];

  for (const [index, fields] of malformedRows.entries()) {
    const output = `<focused-test-evidence>${JSON.stringify({
      candidateId: "C1",
      candidateRevision: 2,
      command: "npm test",
      status: "passed",
      rows: [{
        id: `row-${index + 1}`,
        candidateId: "C1",
        candidateRevision: 2,
        command: "npm test",
        status: "passed",
        title: "focused test",
        artifactReferences: [],
        assertions: [],
        failureDetails: null,
        ...fields,
      }],
    })}</focused-test-evidence>`;
    assert.throws(
      () => parseFocusedTestEvidence(output),
      (error) => error.code === "contradictory_evidence",
      `malformed row case ${index + 1}`,
    );
  }
});

test("rejects malformed focused Test timestamps before normalization", () => {
  for (const [field, value] of [
    ["startedAt", { timestamp: "2026-08-01T12:00:00.000Z" }],
    ["completedAt", ["2026-08-01T12:01:00.000Z"]],
    ["startedAt", "not-a-timestamp"],
    ["completedAt", ""],
    ["startedAt", "2026-08-01T12:00:00Z"],
    ["completedAt", "2026-08-01T14:01:00.000+02:00"],
  ]) {
    const output = `<focused-test-evidence>${JSON.stringify({
      candidateId: "C1",
      candidateRevision: 2,
      command: "npm test",
      status: "passed",
      [field]: value,
      rows: [{
        id: "row-1",
        candidateId: "C1",
        candidateRevision: 2,
        command: "npm test",
        status: "passed",
        title: "focused test",
        artifactReferences: [],
        assertions: [],
        failureDetails: null,
      }],
    })}</focused-test-evidence>`;
    assert.throws(
      () => parseFocusedTestEvidence(output),
      (error) => error.code === "contradictory_evidence" && error.message.includes(field),
      field,
    );
  }
});

test("derives candidate-bound review gates from structured evidence", () => {
  const candidate = { id: "C1", revisionNumber: 2 };
  const pass = parseGateEvidence(gateOutput(2), candidate, "dev-review");
  assert.equal(pass.verdict, "PASS");
  const fencedOutput = gateOutput(2)
    .replace("<gate-evidence>\n", "<gate-evidence>\n```json\n")
    .replace("\n</gate-evidence>", "\n```\n</gate-evidence>");
  const fencedPass = parseGateEvidence(fencedOutput, candidate, "dev-review");
  assert.equal(fencedPass.verdict, "PASS");
  assert.equal(fencedPass.candidateRevision, 2);
  const contradictory = parseGateEvidence(
    gateOutput(2, "PASS", [{ severity: "P1", title: "Blocking defect", detail: "The candidate can advance incorrectly." }]),
    candidate,
    "dev-review",
  );
  assert.equal(contradictory.reportedVerdict, "PASS");
  assert.equal(contradictory.verdict, "REPAIR");
  assert.match(contradictory.blockingReasons[0], /P1/);
  assert.throws(
    () => parseGateEvidence("PASS", candidate, "dev-review"),
    (error) => error.code === "missing_authoritative_summary" &&
      error.copy === RUNTIME_FRESHNESS_REASONS.missing_authoritative_summary,
  );
  assert.throws(
    () => parseGateEvidence(gateOutput(1), candidate, "dev-review"),
    (error) => error.code === "revision_change",
  );
  assert.throws(
    () => parseGateEvidence(
      gateOutput(2, "REPAIR", [{ severity: "P2", title: "Mixed", detail: "Wrong candidate", candidateId: "C2", candidateRevision: 2 }]),
      candidate,
      "final-review",
    ),
    (error) => error.code === "mixed_evidence",
  );
});

test("rejects unsupported gate finding field types before normalization", () => {
  const candidate = { id: "C1", revisionNumber: 2 };
  const malformedFindings = [
    { severity: 2, title: "Numeric severity", detail: "Must not be coerced." },
    { severity: "P2", title: 42, detail: "Must not be coerced." },
    { severity: "P2", title: "Object detail", detail: { text: "Must not be coerced." } },
    { severity: "P2", title: "Numeric file", detail: "Must not be coerced.", file: 42 },
    { severity: "P2", title: "String line", detail: "Must not be coerced.", line: "142" },
  ];

  for (const finding of malformedFindings) {
    assert.throws(
      () => parseGateEvidence(gateOutput(2, "PASS", [{
        ...finding,
        candidateId: "C1",
        candidateRevision: 2,
      }]), candidate, "dev-review"),
      (error) => error.code === "contradictory_evidence",
    );
  }
});

test("normalizes a gate finding's line range to its start instead of rejecting the evidence", () => {
  // Recorded live behaviour (AH-001 dev-review): the reviewer's finding cited a
  // two-line change as `"line": "38-39"`. That is not the "String line" case above
  // (a lone numeric string like "142", deliberately rejected to avoid coercion) — it
  // is a legitimate range with no single-integer representation, and rejecting the
  // whole PASS verdict over it turned a clean review into a pointless rerun.
  const candidate = { id: "C1", revisionNumber: 2 };
  const parsed = parseGateEvidence(gateOutput(2, "PASS", [{
    severity: "P3",
    title: "Reporter ordering is load-bearing",
    detail: "Informational only.",
    line: "38-39",
    candidateId: "C1",
    candidateRevision: 2,
  }]), candidate, "dev-review");
  assert.equal(parsed.verdict, "PASS");
  assert.equal(parsed.findings[0].line, 38);

  // A lone numeric string is still not a range and stays rejected.
  assert.throws(
    () => parseGateEvidence(gateOutput(2, "PASS", [{
      severity: "P3",
      title: "Lone numeric string",
      detail: "Must not be coerced.",
      line: "38",
      candidateId: "C1",
      candidateRevision: 2,
    }]), candidate, "dev-review"),
    (error) => error.code === "contradictory_evidence",
  );
});

test("rejects generic candidate identity fields at every structured evidence boundary", () => {
  assert.deepEqual(readExplicitCandidateBinding({ id: "C1", revisionNumber: 2 }), {
    valid: false,
    candidateId: null,
    candidateRevision: null,
    code: "missing_binding",
    copy: RUNTIME_FRESHNESS_REASONS.missing_binding,
  });
  assert.throws(
    () => parseFocusedTestEvidence(
      `<focused-test-evidence>{"id":"C1","revisionNumber":2,"command":"npm test","status":"passed","rows":[{"id":"row-1","status":"passed"}]}</focused-test-evidence>`,
    ),
    (error) => error.code === "missing_binding",
  );
  assert.throws(
    () => parseGateEvidence(
      `<gate-evidence>{"id":"C1","revisionNumber":2,"verdict":"PASS","findings":[]}</gate-evidence>`,
      { id: "C1", revisionNumber: 2 },
      "dev-review",
    ),
    (error) => error.code === "missing_binding",
  );
  assert.equal(readExplicitCandidateBinding({ candidateId: "C1", candidateRevision: 0 }).code, "malformed_binding");
  assert.equal(readExplicitCandidateBinding({ candidateId: "C1", candidateRevision: "2" }).code, "malformed_binding");
  assert.equal(readExplicitCandidateBinding({ candidateId: "", candidateRevision: 2 }).code, "malformed_binding");
});

test("resolves candidate-bound gate failures closed with exact stale reasons", () => {
  const cases = [
    {
      name: "missing authoritative summary",
      run: makeRuntimeRun({ artifactId: null, gateResult: null }),
      artifacts: [],
      code: "missing_authoritative_summary",
    },
    {
      name: "malformed run binding",
      run: makeRuntimeRun({ candidateRevision: "2" }),
      artifacts: [],
      code: "malformed_binding",
    },
    {
      name: "candidate mismatch",
      run: makeRuntimeRun({ candidateId: "C2", gateResult: makeGateResult({ candidateId: "C2" }) }),
      artifacts: [],
      code: "candidate_mismatch",
    },
    {
      name: "stale revision",
      run: makeRuntimeRun({ candidateRevision: 1, gateResult: makeGateResult({ candidateRevision: 1 }) }),
      artifacts: [],
      code: "revision_change",
    },
    {
      name: "failed execution",
      run: makeRuntimeRun({ status: "failed", gateResult: makeGateResult() }),
      artifacts: [],
      code: "failed_execution",
    },
    {
      name: "timed out execution",
      run: makeRuntimeRun({ status: "timed-out", gateResult: makeGateResult() }),
      artifacts: [],
      code: "timeout",
    },
    {
      name: "misleading timeout prose",
      run: makeRuntimeRun({
        status: "failed",
        error: "Codex run exceeded 900 seconds.",
        gateResult: makeGateResult(),
      }),
      artifacts: [],
      code: "failed_execution",
    },
    {
      name: "repair result",
      run: makeRuntimeRun({ gateResult: makeGateResult({ verdict: "REPAIR", reportedVerdict: "REPAIR", blockingReasons: ["P1: defect"] }) }),
      artifacts: [],
      code: "repair_required",
    },
    {
      name: "contradictory result",
      run: makeRuntimeRun({ gateResult: makeGateResult({ verdict: "REPAIR", reportedVerdict: "PASS", blockingReasons: ["P1: defect"] }) }),
      artifacts: [],
      code: "contradictory_evidence",
    },
  ];

  for (const item of cases) {
    const task = makeRuntimeTask({ runs: [item.run], artifacts: item.artifacts });
    refreshGateFreshness(task);
    const freshness = task.gateFreshness["dev-review"];
    assert.equal(freshness.fresh, false, item.name);
    assert.equal(freshness.reasonCode, item.code, item.name);
    assert.equal(freshness.reasonCopy, RUNTIME_FRESHNESS_REASONS[item.code], item.name);
    assert.deepEqual(freshness.staleReason, { code: item.code, copy: RUNTIME_FRESHNESS_REASONS[item.code] }, item.name);
  }
});

test("binds gate evidence to the reserving execution provider", () => {
  const reservationFor = (provider) => ({
    "dev-review": {
      id: "RES-DEV",
      stage: "dev-review",
      kind: "review",
      ...(provider === undefined ? {} : { provider }),
      workflowAttempt: 1,
      candidateId: "C1",
      candidateRevision: 2,
      candidateHeadRevision: "abc123",
      authorizedRunScopes: [],
      reservedAt: "2026-08-01T11:59:00.000Z",
    },
  });

  const cases = [
    { name: "matching provider", runProvider: "codex", reservationProvider: "codex", fresh: true },
    { name: "absent run provider coalesces to the default", runProvider: undefined, reservationProvider: "codex", fresh: true },
    {
      name: "absent reservation provider coalesces to the default",
      runProvider: undefined,
      reservationProvider: undefined,
      fresh: true,
    },
    { name: "matching non-default provider", runProvider: "claude", reservationProvider: "claude", fresh: true },
    { name: "cross-provider gate evidence", runProvider: "claude", reservationProvider: "codex", fresh: false },
    { name: "cross-provider reservation", runProvider: "codex", reservationProvider: "claude", fresh: false },
  ];

  for (const item of cases) {
    const run = makeRuntimeRun({ gateResult: makeGateResult() });
    if (item.runProvider === undefined) delete run.provider;
    else run.provider = item.runProvider;
    const task = makeRuntimeTask({ runs: [run] });
    task.stageRunReservations = reservationFor(item.reservationProvider);
    refreshGateFreshness(task);
    const freshness = task.gateFreshness["dev-review"];
    assert.equal(freshness.fresh, item.fresh, item.name);
    if (item.fresh) continue;
    assert.equal(freshness.reasonCode, "provider_mismatch", item.name);
    assert.equal(freshness.reasonCopy, RUNTIME_FRESHNESS_REASONS.provider_mismatch, item.name);
    assert.deepEqual(freshness.staleReason, {
      code: "provider_mismatch",
      copy: RUNTIME_FRESHNESS_REASONS.provider_mismatch,
    }, item.name);
    assert.equal(run.freshness.reasonCode, "provider_mismatch", `${item.name}: run audit state`);
  }
});

test("backfills the default execution provider while migrating through schema 8", () => {
  const run = makeRuntimeRun({ gateResult: makeGateResult() });
  delete run.provider;
  const task = makeRuntimeTask({ runs: [run] });
  task.stageRunReservations = {
    "dev-review": {
      id: "RES-DEV",
      stage: "dev-review",
      kind: "review",
      workflowAttempt: 1,
      candidateId: "C1",
      candidateRevision: 2,
      candidateHeadRevision: "abc123",
      authorizedRunScopes: [],
      reservedAt: "2026-08-01T11:59:00.000Z",
    },
  };
  const state = { schemaVersion: 5, tasks: [task] };

  assert.equal(migrateRunActivityState(state), true);
  assert.equal(state.schemaVersion, TASK_STORE_SCHEMA_VERSION);
  assert.equal(TASK_STORE_SCHEMA_VERSION, 8);
  assert.equal(task.runs[0].provider, DEFAULT_EXECUTION_PROVIDER);
  assert.equal(task.stageRunReservations["dev-review"].provider, DEFAULT_EXECUTION_PROVIDER);
  assert.equal(task.gateFreshness["dev-review"].fresh, true);

  // Idempotent, and a run persisted by an older runtime after migration is repaired.
  assert.equal(migrateRunActivityState(state), false);
  task.runs.push(claudeRunWithoutProvider());
  assert.equal(migrateRunActivityState(state), true);
  assert.equal(task.runs[1].provider, DEFAULT_EXECUTION_PROVIDER);
});

function claudeRunWithoutProvider() {
  const run = makeRuntimeRun({ id: "RUN-2", attempt: 2, gateResult: makeGateResult() });
  delete run.provider;
  return run;
}

test("stamps the reserving provider onto every run it begins", () => {
  const task = makeRuntimeTask();
  task.stageRunReservations = {};
  const codexRun = beginAgentRun(task, { kind: "review", stage: "dev-review", provider: "codex" });
  const claudeRun = beginAgentRun(task, { kind: "review", stage: "dev-review", provider: "claude" });
  const defaultedRun = beginAgentRun(task, { kind: "review", stage: "dev-review" });
  assert.equal(codexRun.provider, "codex");
  assert.equal(claudeRun.provider, "claude");
  assert.equal(defaultedRun.provider, DEFAULT_EXECUTION_PROVIDER);
});

test("rejects mixed candidate summaries with the exact stale reason", () => {
  const mixedGate = makeRuntimeRun({
    gateResult: makeGateResult({
      findings: [
        { severity: "P2", title: "C1 finding", detail: "Bound to C1.", candidateId: "C1", candidateRevision: 2 },
        { severity: "P2", title: "C2 finding", detail: "Bound to C2.", candidateId: "C2", candidateRevision: 2 },
      ],
    }),
  });
  const mixedGateTask = makeRuntimeTask({ runs: [mixedGate] });
  refreshGateFreshness(mixedGateTask);
  assert.equal(mixedGateTask.gateFreshness["dev-review"].reasonCode, "mixed_evidence");

  const mixedWithParentOnly = makeRuntimeRun({
    gateResult: makeGateResult({
      findings: [
        { severity: "P2", title: "C2 finding", detail: "Bound to C2.", candidateId: "C2", candidateRevision: 2 },
      ],
    }),
  });
  const parentMixedTask = makeRuntimeTask({ runs: [mixedWithParentOnly] });
  refreshGateFreshness(parentMixedTask);
  assert.equal(parentMixedTask.gateFreshness["dev-review"].reasonCode, "mixed_evidence");
});

test("classifies cross-layer persisted candidate conflicts as mixed evidence before target comparison", () => {
  const cases = [
    {
      name: "stale run with current summary",
      run: makeRuntimeRun({
        candidateRevision: 1,
        gateResult: makeGateResult({ candidateRevision: 2 }),
      }),
      artifacts: [],
    },
    {
      name: "current run with stale summary",
      run: makeRuntimeRun({
        candidateRevision: 2,
        gateResult: makeGateResult({ candidateRevision: 1 }),
      }),
      artifacts: [],
    },
    {
      name: "current run and summary with stale artifact",
      run: makeRuntimeRun({ artifactId: "ART-STALE" }),
      artifacts: [makeArtifact({
        id: "ART-STALE",
        candidateRevision: 1,
        gateResult: makeGateResult({ candidateRevision: 2 }),
      })],
    },
  ];

  for (const item of cases) {
    const task = makeRuntimeTask({ runs: [item.run], artifacts: item.artifacts });
    refreshGateFreshness(task);

    assert.equal(task.gateFreshness["dev-review"].fresh, false, item.name);
    assert.equal(task.gateFreshness["dev-review"].reasonCode, "mixed_evidence", item.name);
    assert.equal(
      task.gateFreshness["dev-review"].reasonCopy,
      RUNTIME_FRESHNESS_REASONS.mixed_evidence,
      item.name,
    );
    assert.deepEqual(task.gateFreshness["dev-review"].staleReason, {
      code: "mixed_evidence",
      copy: RUNTIME_FRESHNESS_REASONS.mixed_evidence,
    }, item.name);
    assert.equal(item.run.freshness.reasonCode, "mixed_evidence", `${item.name}: run audit state`);
  }
});

test("rejects incomplete or contradictory Dev and Final Review summaries", () => {
  for (const stage of ["dev-review", "final-review"]) {
    const valid = makeGateResult({ stage });
    const cases = [
      { name: "missing stage", gateResult: { ...valid, stage: undefined } },
      { name: "missing findings", gateResult: { ...valid, findings: undefined } },
      { name: "missing reported verdict", gateResult: { ...valid, reportedVerdict: undefined } },
      { name: "reported repair but evaluated pass", gateResult: { ...valid, reportedVerdict: "REPAIR" } },
      { name: "reported pass but evaluated repair", gateResult: { ...valid, verdict: "REPAIR" } },
    ];

    for (const item of cases) {
      const run = makeRuntimeRun({ id: `RUN-${stage}-${item.name}`, stage, gateResult: item.gateResult });
      const task = makeRuntimeTask({ runs: [run] });
      refreshGateFreshness(task);
      const freshness = task.gateFreshness[stage];
      assert.equal(freshness.fresh, false, `${stage}: ${item.name}`);
      assert.equal(freshness.reasonCode, "contradictory_evidence", `${stage}: ${item.name}`);
    }
  }
});

test("rejects malformed persisted finding shapes for every candidate-bound gate", () => {
  const cases = [
    { name: "unsupported severity", finding: makePersistedFinding({ severity: "p0" }), code: "contradictory_evidence" },
    { name: "empty title", finding: makePersistedFinding({ title: "   " }), code: "contradictory_evidence" },
    { name: "non-string detail", finding: makePersistedFinding({ detail: 42 }), code: "contradictory_evidence" },
    { name: "unsupported file type", finding: makePersistedFinding({ file: { path: "server/run-activity.mjs" } }), code: "contradictory_evidence" },
    { name: "unsupported line type", finding: makePersistedFinding({ line: "371" }), code: "contradictory_evidence" },
    { name: "unsupported binding marker type", finding: makePersistedFinding({ bindingExplicit: "true" }), code: "contradictory_evidence" },
    {
      name: "missing explicit finding binding",
      finding: makePersistedFinding({ candidateId: undefined, candidateRevision: undefined }),
      code: "missing_binding",
    },
  ];
  const focusedTest = {
    candidateId: "C1",
    candidateRevision: 2,
    bindingExplicit: true,
    command: "npm test",
    status: "passed",
    rows: [makeTestRow()],
  };

  for (const stage of ["dev-review", "test", "final-review"]) {
    for (const item of cases) {
      const gateResult = makeGateResult({ stage, findings: [item.finding] });
      const run = makeRuntimeRun({
        id: `RUN-${stage}-${item.name}`,
        stage,
        kind: stage === "test" ? "test" : "review",
        artifactId: stage === "test" ? `ART-${stage}-${item.name}` : null,
        gateResult,
      });
      const artifact = stage === "test"
        ? makeArtifact({ id: run.artifactId, stage, gateResult, focusedTest })
        : null;
      const task = makeRuntimeTask({ runs: [run], artifacts: artifact ? [artifact] : [] });
      if (artifact) attachRunArtifact(task, run.id, artifact);
      else refreshGateFreshness(task);

      assert.equal(task.gateFreshness[stage].fresh, false, `${stage}: ${item.name}`);
      assert.equal(task.gateFreshness[stage].reasonCode, item.code, `${stage}: ${item.name}`);
      assert.deepEqual(run.gateResult.findings, [item.finding], `${stage}: ${item.name}: retained for audit`);
    }
  }
});

test("rejects mismatched and contradictory persisted Test gate summaries", () => {
  const focusedTest = {
    candidateId: "C1",
    candidateRevision: 2,
    bindingExplicit: true,
    command: "npm test",
    status: "passed",
    rows: [makeTestRow()],
  };
  const cases = [
    {
      name: "candidate mismatch",
      gateResult: makeGateResult({ stage: "test", candidateId: "C2" }),
      code: "mixed_evidence",
    },
    {
      name: "revision change",
      gateResult: makeGateResult({ stage: "test", candidateRevision: 1 }),
      code: "mixed_evidence",
    },
    {
      name: "wrong stage",
      gateResult: makeGateResult({ stage: "dev-review" }),
      code: "contradictory_evidence",
    },
    {
      name: "missing binding",
      gateResult: { ...makeGateResult({ stage: "test" }), candidateId: undefined, candidateRevision: undefined },
      code: "missing_binding",
    },
    {
      name: "mixed findings",
      gateResult: makeGateResult({
        stage: "test",
        findings: [
          {
            severity: "P2",
            title: "Other candidate",
            detail: "This finding is not bound to the Test candidate.",
            candidateId: "C2",
            candidateRevision: 2,
            bindingExplicit: true,
          },
        ],
      }),
      code: "mixed_evidence",
    },
    {
      name: "reported repair but evaluated pass",
      gateResult: makeGateResult({ stage: "test", verdict: "PASS", reportedVerdict: "REPAIR" }),
      code: "contradictory_evidence",
    },
    {
      name: "reported pass but evaluated repair",
      gateResult: makeGateResult({ stage: "test", verdict: "REPAIR", reportedVerdict: "PASS" }),
      code: "contradictory_evidence",
    },
  ];

  for (const item of cases) {
    const run = makeRuntimeRun({ id: `RUN-${item.code}`, stage: "test", kind: "test", gateResult: item.gateResult });
    const artifact = makeArtifact({
      id: `ART-${item.code}`,
      stage: "test",
      gateResult: item.gateResult,
      focusedTest,
    });
    const task = makeRuntimeTask({ runs: [run], artifacts: [artifact] });
    attachRunArtifact(task, run.id, artifact);
    assert.equal(task.gateFreshness.test.fresh, false, item.name);
    assert.equal(task.gateFreshness.test.reasonCode, item.code, item.name);
    assert.deepEqual(run.gateResult, item.gateResult, `${item.name}: retained for audit`);
  }
});

test("rejects every non-null malformed or unknown persisted evidence error", () => {
  const cases = [
    { name: "unknown code", evidenceError: { code: "unknown_schema_error", copy: "Unknown schema error." } },
    { name: "primitive value", evidenceError: "malformed evidence error" },
    { name: "empty string", evidenceError: "" },
    { name: "zero", evidenceError: 0 },
    { name: "false", evidenceError: false },
    {
      name: "success code used as an error",
      evidenceError: { code: "fresh", copy: RUNTIME_FRESHNESS_REASONS.fresh },
    },
    {
      name: "known code with malformed copy",
      evidenceError: { code: "timeout", copy: "Different timeout copy." },
    },
  ];

  for (const item of cases) {
    const run = makeRuntimeRun({ id: `RUN-EVIDENCE-ERROR-${item.name}`, evidenceError: item.evidenceError });
    const task = makeRuntimeTask({ runs: [run] });
    refreshGateFreshness(task);

    assert.equal(task.gateFreshness["dev-review"].fresh, false, item.name);
    assert.equal(task.gateFreshness["dev-review"].reasonCode, "malformed_binding", item.name);
    assert.equal(task.gateFreshness["dev-review"].reasonCopy, RUNTIME_FRESHNESS_REASONS.malformed_binding, item.name);
    assert.deepEqual(run.evidenceError, item.evidenceError, `${item.name}: retained for audit`);
  }

  const knownError = { code: "timeout", copy: RUNTIME_FRESHNESS_REASONS.timeout };
  const knownRun = makeRuntimeRun({ id: "RUN-EVIDENCE-ERROR-KNOWN", evidenceError: knownError });
  const knownTask = makeRuntimeTask({ runs: [knownRun] });
  refreshGateFreshness(knownTask);
  assert.equal(knownTask.gateFreshness["dev-review"].reasonCode, "timeout");
  assert.deepEqual(knownRun.evidenceError, knownError, "valid persisted error remains intact for audit");
});

test("preserves falsey persisted evidence errors through attachment and legacy migration", () => {
  for (const [name, evidenceError] of [["empty string", ""], ["zero", 0], ["false", false]]) {
    const attachedRun = makeRuntimeRun({ id: `RUN-ATTACH-${name}` });
    const attachedArtifact = { ...makeArtifact({ id: `ART-ATTACH-${name}` }), evidenceError };
    const attachedTask = makeRuntimeTask({ runs: [attachedRun], artifacts: [attachedArtifact] });
    attachRunArtifact(attachedTask, attachedRun.id, attachedArtifact);
    assert.equal(attachedRun.evidenceError, evidenceError, `${name}: attachment retains the original value`);
    assert.equal(attachedTask.gateFreshness["dev-review"].reasonCode, "malformed_binding", `${name}: attachment fails closed`);

    const migratedArtifact = { ...makeArtifact({ id: `ART-MIGRATE-${name}` }), evidenceError };
    const migratedTask = makeRuntimeTask({ artifacts: [migratedArtifact] });
    migrateRunActivityState({ schemaVersion: 1, tasks: [migratedTask] });
    assert.equal(migratedTask.runs[0].evidenceError, evidenceError, `${name}: migration retains the original value`);
    assert.equal(migratedTask.gateFreshness["dev-review"].reasonCode, "malformed_binding", `${name}: migration fails closed`);
  }
});

test("migrates legacy and partial stage limits without changing attempt counters", () => {
  const task = makeRuntimeTask({ events: [] });
  task.stageRunLimit = 5;
  task.stageRunLimits = { implement: 7, test: 0, "dev-review": null };
  task.attemptsByStage = { implement: 4, test: 2, "dev-review": 1 };
  const state = { schemaVersion: 3, tasks: [task] };

  assert.equal(migrateRunActivityState(state), true);
  assert.deepEqual(task.stageRunLimits, Object.fromEntries(
    CANONICAL_RUN_STAGES.map((stage) => [stage, stage === "implement" ? 7 : stage === "test" ? 0 : 5]),
  ));
  assert.deepEqual(task.attemptsByStage, { implement: 4, test: 2, "dev-review": 1 });
  assert.equal(task.stageRunLimit, 5, "the legacy scalar remains available for compatibility");
  assert.equal(stageRunLimitFor(task, "implement"), 7);
  assert.equal(stageRunLimitFor(task, "test"), 0);
  assert.equal(stageRunLimitFor(task, "dev-review"), 5);
  assert.equal(stageRunLimitFor(task, "unknown"), DEFAULT_STAGE_RUN_LIMIT);

  const migrated = structuredClone(state);
  assert.equal(migrateRunActivityState(state), false, "a complete migration is idempotent");
  assert.deepEqual(state, migrated);

  const defaultedTask = makeRuntimeTask({ events: [] });
  const defaultedState = { schemaVersion: 3, tasks: [defaultedTask] };
  assert.equal(migrateRunActivityState(defaultedState), true);
  assert.deepEqual(
    defaultedTask.stageRunLimits,
    Object.fromEntries(CANONICAL_RUN_STAGES.map((stage) => [stage, DEFAULT_STAGE_RUN_LIMIT])),
  );
});

test("retains decisions while capping aggregate high-volume events during migration", () => {
  const telemetry = Array.from({ length: RUN_ACTIVITY_EVENT_LIMIT }, (_, index) => ({
    id: `telemetry-${index}`,
    category: ["activity", "agent", "tool", "artifact"][index % 4],
  }));
  const task = makeRuntimeTask({
    events: [
      { id: "evicted-telemetry", category: "tool" },
      { id: "decision-before", category: "decision" },
      { id: "other-before", category: "audit" },
      ...telemetry,
      { id: "decision-after", category: "decision" },
    ],
  });
  const state = { schemaVersion: 3, tasks: [task] };

  assert.equal(retainRunActivityEvents(task.events).length, RUN_ACTIVITY_EVENT_LIMIT + 3);
  assert.equal(migrateRunActivityState(state), true);
  const ids = task.events.map((event) => event.id);
  assert.equal(ids.includes("evicted-telemetry"), false);
  assert.equal(ids.includes("decision-before"), true);
  assert.equal(ids.includes("decision-after"), true);
  assert.equal(ids.includes("other-before"), true);
  assert.equal(task.events.filter((event) => ["activity", "agent", "tool", "artifact"].includes(event.category)).length, RUN_ACTIVITY_EVENT_LIMIT);
  assert.equal(task.events[0].id, "decision-before");
  assert.equal(task.events[1].id, "other-before");
  assert.equal(task.events[2].id, "telemetry-0");
  assert.equal(task.events.at(-1).id, "decision-after");

  const migrated = structuredClone(state);
  assert.equal(migrateRunActivityState(state), false, "retention and migration remain idempotent");
  assert.deepEqual(state, migrated);
});

test("retains missing binding as the exact reason when gate ingestion also changes the verdict", () => {
  const candidate = { id: "C1", revisionNumber: 2 };
  const parsed = parseGateEvidence(gateOutput(2, "PASS", [{
    severity: "P2",
    title: "Unbound retained finding",
    detail: "The finding omitted its explicit candidate identity.",
  }]), candidate, "dev-review");
  assert.equal(parsed.reportedVerdict, "PASS");
  assert.equal(parsed.verdict, "REPAIR");
  assert.equal(parsed.findings[0].bindingExplicit, false);

  const run = makeRuntimeRun({ gateResult: parsed });
  const task = makeRuntimeTask({ runs: [run] });
  refreshGateFreshness(task);
  assert.equal(task.gateFreshness["dev-review"].reasonCode, "missing_binding");
  assert.equal(task.gateFreshness["dev-review"].reasonCopy, RUNTIME_FRESHNESS_REASONS.missing_binding);
  assert.deepEqual(run.gateResult, parsed, "the unbound finding remains retained for audit");
});

test("requires persisted Test failedRowIds to match the exact failed-row set", () => {
  const passedSummary = makeFocusedTestSummary();
  const failedRow = makeTestRow({ id: "row-failed", status: "failed" });
  const cases = [
    { name: "missing failedRowIds", summary: { ...passedSummary, failedRowIds: undefined } },
    { name: "non-array failedRowIds", summary: { ...passedSummary, failedRowIds: "row-1" } },
    { name: "unknown failed row", summary: { ...passedSummary, failedRowIds: ["row-missing"] } },
    { name: "passed row reported failed", summary: { ...passedSummary, failedRowIds: ["row-1"] } },
    { name: "failed summary with all passed rows", summary: { ...passedSummary, status: "failed" } },
    {
      name: "failed row omitted",
      summary: makeFocusedTestSummary({ status: "failed", rows: [failedRow], failedRowIds: [] }),
    },
    {
      name: "duplicate failed row id",
      summary: makeFocusedTestSummary({
        status: "failed",
        rows: [failedRow],
        failedRowIds: ["row-failed", "row-failed"],
      }),
    },
  ];

  for (const item of cases) {
    const run = makeRuntimeRun({
      id: `RUN-FAILED-ROWS-${item.name}`,
      stage: "test",
      kind: "test",
      gateResult: makeGateResult({ stage: "test" }),
      test: item.summary,
    });
    const task = makeRuntimeTask({ runs: [run] });
    refreshGateFreshness(task);

    assert.equal(task.gateFreshness.test.fresh, false, item.name);
    assert.equal(task.gateFreshness.test.reasonCode, "contradictory_evidence", item.name);
    assert.deepEqual(run.test.failedRowIds, item.summary.failedRowIds, `${item.name}: retained for audit`);
  }

  const validFailedSummary = makeFocusedTestSummary({
    status: "failed",
    rows: [failedRow],
    failedRowIds: ["row-failed"],
  });
  const validFailedRun = makeRuntimeRun({
    id: "RUN-FAILED-ROWS-VALID",
    stage: "test",
    kind: "test",
    gateResult: makeGateResult({
      stage: "test",
      verdict: "REPAIR",
      reportedVerdict: "REPAIR",
      blockingReasons: ["A verification command failed."],
    }),
    test: validFailedSummary,
  });
  const validFailedTask = makeRuntimeTask({ runs: [validFailedRun] });
  refreshGateFreshness(validFailedTask);
  assert.equal(validFailedTask.gateFreshness.test.reasonCode, "repair_required");
  assert.deepEqual(validFailedTask.gateFreshness.test.focusedTestRows.map((row) => row.id), ["row-failed"]);

  const contradictoryFailedRun = makeRuntimeRun({
    id: "RUN-FAILED-ROWS-PASS-GATE",
    stage: "test",
    kind: "test",
    gateResult: makeGateResult({ stage: "test" }),
    test: validFailedSummary,
  });
  const contradictoryFailedTask = makeRuntimeTask({ runs: [contradictoryFailedRun] });
  refreshGateFreshness(contradictoryFailedTask);
  assert.equal(contradictoryFailedTask.gateFreshness.test.reasonCode, "contradictory_evidence");
});

test("rejects malformed persisted focused Test timestamps while retaining them for audit", () => {
  for (const [field, value] of [
    ["startedAt", { timestamp: "2026-08-01T12:00:00.000Z" }],
    ["completedAt", ["2026-08-01T12:01:00.000Z"]],
    ["startedAt", "not-a-timestamp"],
    ["completedAt", ""],
    ["startedAt", "2026-08-01T12:00:00Z"],
    ["completedAt", "2026-08-01T14:01:00.000+02:00"],
  ]) {
    const summary = { ...makeFocusedTestSummary(), [field]: value };
    const run = makeRuntimeRun({
      id: `RUN-MALFORMED-TEST-${field}`,
      stage: "test",
      kind: "test",
      gateResult: makeGateResult({ stage: "test" }),
      test: summary,
    });
    const task = makeRuntimeTask({ runs: [run] });

    refreshGateFreshness(task);

    assert.equal(task.gateFreshness.test.fresh, false, field);
    assert.equal(task.gateFreshness.test.reasonCode, "contradictory_evidence", field);
    assert.deepEqual(
      task.gateFreshness.test.focusedTestRows.map((row) => row.id),
      ["row-1"],
      `${field}: valid exact-candidate rows remain inspectable`,
    );
    assert.equal(task.gateFreshness.test.focusedTest[field], null, `${field}: malformed metadata is sanitized`);
    assert.deepEqual(run.test[field], value, `${field}: malformed evidence remains retained`);
  }
});

test("rejects malformed persisted Test binding markers and preserves explicit false as missing", () => {
  const cases = [
    {
      name: "summary marker is not boolean",
      summary: { ...makeFocusedTestSummary(), bindingExplicit: "true" },
      code: "contradictory_evidence",
    },
    {
      name: "row marker is not boolean",
      summary: makeFocusedTestSummary({
        rows: [{ ...makeTestRow(), bindingExplicit: "not-a-boolean" }],
      }),
      code: "contradictory_evidence",
    },
    {
      name: "summary explicitly lacks a binding",
      summary: { ...makeFocusedTestSummary(), bindingExplicit: false },
      code: "missing_binding",
    },
    {
      name: "row explicitly lacks a binding",
      summary: makeFocusedTestSummary({
        rows: [{ ...makeTestRow(), bindingExplicit: false }],
      }),
      code: "missing_binding",
    },
  ];

  for (const item of cases) {
    const run = makeRuntimeRun({
      id: `RUN-TEST-BINDING-MARKER-${item.name}`,
      stage: "test",
      kind: "test",
      gateResult: makeGateResult({ stage: "test" }),
      test: item.summary,
    });
    const task = makeRuntimeTask({ runs: [run] });
    refreshGateFreshness(task);

    assert.equal(task.gateFreshness.test.fresh, false, item.name);
    assert.equal(task.gateFreshness.test.reasonCode, item.code, item.name);
    assert.deepEqual(run.test, item.summary, `${item.name}: retained for audit`);
  }
});

test("persists malformed attached Test binding markers as contradictory evidence", () => {
  for (const [name, focusedTest] of [
    ["summary marker", { ...makeFocusedTestSummary(), bindingExplicit: "true" }],
    [
      "row marker",
      makeFocusedTestSummary({ rows: [{ ...makeTestRow(), bindingExplicit: "not-a-boolean" }] }),
    ],
  ]) {
    const run = makeRuntimeRun({
      id: `RUN-ATTACHED-TEST-BINDING-${name}`,
      stage: "test",
      kind: "test",
      artifactId: `ART-ATTACHED-TEST-BINDING-${name}`,
      gateResult: null,
      test: null,
    });
    const artifact = makeArtifact({
      id: run.artifactId,
      stage: "test",
      gateResult: makeGateResult({ stage: "test" }),
      focusedTest,
    });
    const task = makeRuntimeTask({ runs: [run], artifacts: [artifact] });

    attachRunArtifact(task, run.id, artifact);

    assert.equal(task.gateFreshness.test.fresh, false, name);
    assert.equal(task.gateFreshness.test.reasonCode, "contradictory_evidence", name);
    assert.deepEqual(run.evidenceError, {
      code: "contradictory_evidence",
      copy: RUNTIME_FRESHNESS_REASONS.contradictory_evidence,
    }, `${name}: exact reason is persisted`);
    assert.deepEqual(artifact.focusedTest, focusedTest, `${name}: source evidence is retained for audit`);
  }
});

test("merge approval fails closed for malformed persisted errors and failed-row metadata", async () => {
  const cases = [
    {
      name: "unknown Dev Review evidence error",
      expectedStage: "Development Review",
      mutate(runs) {
        runs[0].evidenceError = { code: "unknown_schema_error", copy: "Unknown schema error." };
      },
    },
    {
      name: "missing Test failedRowIds",
      expectedStage: "Test",
      mutate(runs) {
        delete runs[1].test.failedRowIds;
      },
    },
    {
      name: "mismatched Test failedRowIds",
      expectedStage: "Test",
      mutate(runs) {
        runs[1].test.failedRowIds = ["row-missing"];
      },
    },
    {
      name: "malformed Test summary binding marker",
      expectedStage: "Test",
      mutate(runs) {
        runs[1].test.bindingExplicit = "true";
      },
    },
    {
      name: "malformed Test row binding marker",
      expectedStage: "Test",
      mutate(runs) {
        runs[1].test.rows[0].bindingExplicit = "not-a-boolean";
      },
    },
    {
      name: "malformed Test start timestamp",
      expectedStage: "Test",
      mutate(runs) {
        runs[1].test.startedAt = { timestamp: "2026-08-01T12:00:00.000Z" };
      },
    },
    {
      name: "malformed Test completion timestamp",
      expectedStage: "Test",
      mutate(runs) {
        runs[1].test.completedAt = ["2026-08-01T12:01:00.000Z"];
      },
    },
    {
      name: "invalid Test start timestamp string",
      expectedStage: "Test",
      mutate(runs) {
        runs[1].test.startedAt = "not-a-timestamp";
      },
    },
    {
      name: "empty Test completion timestamp string",
      expectedStage: "Test",
      mutate(runs) {
        runs[1].test.completedAt = "";
      },
    },
    {
      name: "non-canonical Test start timestamp string",
      expectedStage: "Test",
      mutate(runs) {
        runs[1].test.startedAt = "2026-08-01T12:00:00Z";
      },
    },
    {
      name: "missing Dev Review schema version",
      expectedStage: "Development Review",
      mutate(runs) {
        delete runs[0].gateResult.schemaVersion;
      },
    },
    {
      name: "unsupported Test schema version",
      expectedStage: "Test",
      mutate(runs) {
        runs[1].gateResult.schemaVersion = 999;
      },
    },
    {
      name: "malformed Final Review evaluation timestamp",
      expectedStage: "Final Review",
      mutate(runs) {
        runs[2].gateResult.evaluatedAt = { timestamp: "2026-08-01T12:01:00.000Z" };
      },
    },
    {
      name: "Test repair with misleading failure prose",
      expectedStage: "Test",
      expectedReason: "repair_required",
      mutate(runs) {
        runs[1].gateResult = makeGateResult({
          stage: "test",
          verdict: "REPAIR",
          reportedVerdict: "REPAIR",
          blockingReasons: ["A test command failed, according to this human-readable copy."],
        });
      },
    },
  ];

  for (const item of cases) {
    const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-malformed-gate-approval-"));
    try {
      const store = new JsonTaskStore(path.join(directory, "tasks.json"));
      await store.init();
      const task = await store.create({
        title: `Reject ${item.name}`,
        description: "Malformed persisted candidate evidence must block merge approval.",
        repositoryPath: directory,
        workflow: "implement",
        priority: "medium",
      });
      await store.update(task.id, (draft) => {
        draft.status = "awaiting-human-approval";
        draft.currentStage = "approval";
        draft.candidates = [{
          id: "C1",
          revisionNumber: 2,
          baseRevision: "a".repeat(40),
          baseBranch: "main",
          headRevision: "b".repeat(40),
          status: "awaiting_human_approval",
        }];
        const runs = [
          makeRuntimeRun({ id: "RUN-DEV-MALFORMED-APPROVAL" }),
          makeRuntimeRun({
            id: "RUN-TEST-MALFORMED-APPROVAL",
            stage: "test",
            kind: "test",
            gateResult: makeGateResult({ stage: "test" }),
            test: makeFocusedTestSummary(),
          }),
          makeRuntimeRun({
            id: "RUN-FINAL-MALFORMED-APPROVAL",
            stage: "final-review",
            gateResult: makeGateResult({ stage: "final-review" }),
          }),
        ];
        item.mutate(runs);
        draft.runs = runs;
        refreshGateFreshness(draft);
        if (item.expectedStage === "Test" || item.name.includes("schema") || item.name.includes("timestamp")) {
          const stage = {
            "Development Review": "dev-review",
            Test: "test",
            "Final Review": "final-review",
          }[item.expectedStage];
          assert.equal(
            draft.gateFreshness[stage].reasonCode,
            item.expectedReason ?? "contradictory_evidence",
            item.name,
          );
        }
      });

      let merged = false;
      const orchestrator = new TaskOrchestrator(store, {
        worktreeManager: { async merge() { merged = true; } },
      });
      await assert.rejects(
        () => orchestrator.approveMerge(task.id),
        new RegExp(`cannot be approved.*${item.expectedStage} is not fresh`, "i"),
      );
      const rejected = await store.get(task.id);
      assert.equal(rejected.mergeIntent, null, item.name);
      assert.equal(merged, false, item.name);
    } finally {
      await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  }
});

test("merge approval fails closed for cross-layer mixed candidate evidence", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-mixed-gate-approval-"));
  try {
    const store = new JsonTaskStore(path.join(directory, "tasks.json"));
    await store.init();
    const task = await store.create({
      title: "Reject cross-layer mixed evidence",
      description: "Conflicting persisted candidate identities must block merge approval.",
      repositoryPath: directory,
      workflow: "implement",
      priority: "medium",
    });
    await store.update(task.id, (draft) => {
      draft.status = "awaiting-human-approval";
      draft.currentStage = "approval";
      draft.candidates = [{
        id: "C1",
        revisionNumber: 2,
        baseRevision: "a".repeat(40),
        baseBranch: "main",
        headRevision: "b".repeat(40),
        status: "awaiting_human_approval",
      }];
      draft.runs = [
        makeRuntimeRun({
          id: "RUN-DEV-MIXED-APPROVAL",
          gateResult: makeGateResult({ candidateRevision: 1 }),
        }),
        makeRuntimeRun({
          id: "RUN-TEST-MIXED-APPROVAL",
          stage: "test",
          kind: "test",
          gateResult: makeGateResult({ stage: "test" }),
          test: makeFocusedTestSummary(),
        }),
        makeRuntimeRun({
          id: "RUN-FINAL-MIXED-APPROVAL",
          stage: "final-review",
          gateResult: makeGateResult({ stage: "final-review" }),
        }),
      ];
      refreshGateFreshness(draft);
      assert.equal(draft.gateFreshness["dev-review"].reasonCode, "mixed_evidence");
      assert.equal(
        draft.gateFreshness["dev-review"].reasonCopy,
        RUNTIME_FRESHNESS_REASONS.mixed_evidence,
      );
    });

    let merged = false;
    const orchestrator = new TaskOrchestrator(store, {
      worktreeManager: { async merge() { merged = true; } },
    });
    await assert.rejects(
      () => orchestrator.approveMerge(task.id),
      /cannot be approved.*Development Review is not fresh/i,
    );
    const rejected = await store.get(task.id);
    assert.equal(rejected.gateFreshness["dev-review"].reasonCode, "mixed_evidence");
    assert.equal(rejected.mergeIntent, null);
    assert.equal(merged, false);
  } finally {
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test("structured ingestion preserves mixed, revision-change, and candidate-mismatch reason codes", () => {
  const candidate = { id: "C1", revisionNumber: 2 };
  const oldRevision = gateOutput(1);
  const otherCandidate = gateOutput(2).replace('"candidateId":"C1"', '"candidateId":"C2"');
  const mixedGate = gateOutput(2, "PASS", [
    {
      severity: "P2",
      title: "Old revision",
      detail: "Retained historical finding.",
      candidateId: "C1",
      candidateRevision: 1,
    },
  ]);
  const mixedTest = `<focused-test-evidence>${JSON.stringify({
    candidateId: "C1",
    candidateRevision: 2,
    command: "npm test",
    status: "passed",
    rows: [makeTestRow(), makeTestRow({ id: "row-old", candidateRevision: 1 })],
  })}</focused-test-evidence>`;

  assert.throws(() => parseGateEvidence(oldRevision, candidate, "dev-review"), (error) => error.code === "revision_change");
  assert.throws(() => parseGateEvidence(otherCandidate, candidate, "dev-review"), (error) => error.code === "candidate_mismatch");
  assert.throws(() => parseGateEvidence(mixedGate, candidate, "dev-review"), (error) => error.code === "mixed_evidence");
  assert.throws(() => parseFocusedTestEvidence(mixedTest), (error) => error.code === "mixed_evidence");

  const parsedOldTest = parseFocusedTestEvidence(
    `<focused-test-evidence>${JSON.stringify({
      candidateId: "C1",
      candidateRevision: 1,
      command: "npm test",
      status: "passed",
      rows: [makeTestRow({ candidateRevision: 1 })],
    })}</focused-test-evidence>`,
  );
  assert.throws(
    () => validateFocusedTestEvidence(parsedOldTest, candidate),
    (error) => error.code === "revision_change",
  );
});

test("malformed focused Test ingestion persists the exact reason and blocks approval", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-malformed-test-evidence-"));
  try {
    const store = new JsonTaskStore(path.join(directory, "tasks.json"));
    await store.init();
    const task = await store.create({
      title: "Reject malformed focused Test evidence",
      description: "Malformed row and timestamp fields must fail closed from ingestion through approval.",
      repositoryPath: directory,
      workflow: "implement",
      priority: "medium",
    });
    await store.update(task.id, (draft) => {
      draft.status = "ready-for-test";
      draft.currentStage = "test";
      draft.candidates = [{
        id: "C1",
        revisionNumber: 2,
        baseRevision: "a".repeat(40),
        baseBranch: "main",
        headRevision: "b".repeat(40),
        branch: "agent-harness/ah-005-c1",
        repositoryRoot: directory,
        worktreePath: directory,
        status: "ready_for_test",
        createdAt: "2026-08-01T12:00:00.000Z",
        updatedAt: "2026-08-01T12:00:00.000Z",
        revisions: [],
      }];
    });

    let merged = false;
    const malformedRowOutput = `<focused-test-evidence>${JSON.stringify({
      candidateId: "C1",
      candidateRevision: 2,
      command: "npm test",
      status: "passed",
      rows: [{
        id: { value: "row-1" },
        candidateId: "C1",
        candidateRevision: 2,
        command: "npm test",
        status: "passed",
        title: "focused test",
        artifactReferences: [],
        assertions: [],
        failureDetails: null,
      }],
    })}</focused-test-evidence>`;
    const malformedTimestampOutput = `<focused-test-evidence>${JSON.stringify({
      candidateId: "C1",
      candidateRevision: 2,
      command: "npm test",
      status: "passed",
      startedAt: { timestamp: "2026-08-01T12:00:00.000Z" },
      completedAt: "2026-08-01T12:01:00.000Z",
      rows: [{
        id: "row-1",
        candidateId: "C1",
        candidateRevision: 2,
        command: "npm test",
        status: "passed",
        title: "focused test",
        artifactReferences: [],
        assertions: [],
        failureDetails: null,
      }],
    })}</focused-test-evidence>`;
    // Now asserts the harness fails closed on evidence *it* produced rather than on a model's.
    // The model is no longer the source, but `validateFocusedTestEvidence` still stands between
    // the harness and a gate, so a verification bug cannot become a silent pass.
    //
    // The reason codes moved with the source, and that is not an assertion being loosened.
    // `contradictory_evidence` was reachable here only by *parsing model text*, which this path
    // no longer does; what remains checkable about harness-built evidence is its candidate
    // binding, so these are the two failures that are still possible: a row bound to a
    // different revision, and evidence that never claimed a binding at all.
    const malformedEvidence = [
      (candidate) => harnessEvidence(candidate, {
        rows: [{ ...harnessEvidence(candidate).rows[0], candidateRevision: candidate.revisionNumber + 1 }],
      }),
      (candidate) => harnessEvidence(candidate, { bindingExplicit: false }),
    ];
    const orchestrator = new TaskOrchestrator(store, {
      readVerificationManifest: async () => ({
        source: ".agent-harness/verification.json",
        commands: [{ id: "test", command: ["npm", "test"] }],
      }),
      getStatus: async () => ({ available: true, authenticated: true, authMethod: "ChatGPT" }),
      worktreeManager: {
        async verifyCandidate() {},
        async recoverCandidate() {},
        async merge() { merged = true; },
      },
      runVerification: async ({ candidate }) => malformedEvidence.shift()(candidate),
      runCodex: async () => ({
        finalText: "## Verdict\n\nPASS\n\n## Checks\n\nThe harness reported one passing command.",
        usage: { inputTokens: 10, cachedInputTokens: 4, outputTokens: 5, totalTokens: 15 },
      }),
    });

    assert.equal(await orchestrator.start(task.id, "test"), true);
    const afterMalformedRow = await waitForStatus(store, task.id, "ready-for-test");
    assert.equal(afterMalformedRow.runs.find((run) => run.stage === "test").evidenceError.code, "mixed_evidence");

    assert.equal(await orchestrator.start(task.id, "test"), true);
    const finished = await waitForStatus(store, task.id, "ready-for-test");
    const testRuns = finished.runs.filter((run) => run.stage === "test");
    assert.equal(testRuns.length, 2);
    assert.equal(testRuns.at(-1).evidenceError.code, "missing_binding");
    assert.equal(testRuns.at(-1).evidenceError.copy, RUNTIME_FRESHNESS_REASONS.missing_binding);
    assert.equal(finished.gateFreshness.test.sourceRunId, testRuns.at(-1).id);
    assert.equal(finished.gateFreshness.test.reasonCode, "missing_binding");

    await store.update(task.id, (draft) => {
      draft.status = "awaiting-human-approval";
      draft.currentStage = "approval";
      draft.candidates.at(-1).status = "awaiting_human_approval";
      draft.runs.push(
        makeRuntimeRun({ id: "RUN-DEV-FRESH-AFTER-MALFORMED-TEST" }),
        makeRuntimeRun({
          id: "RUN-FINAL-FRESH-AFTER-MALFORMED-TEST",
          stage: "final-review",
          gateResult: makeGateResult({ stage: "final-review" }),
        }),
      );
      refreshGateFreshness(draft);
    });

    await assert.rejects(
      () => orchestrator.approveMerge(task.id),
      // Same assertion, matching the reason copy for the failure harness-built evidence can
      // actually have — a missing candidate binding rather than contradictory parsed fields.
      /cannot be approved.*Test is not fresh.*explicit candidateId/i,
    );
    assert.equal(merged, false);
  } finally {
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test("persists exact structured-evidence reason codes through a failed review run", async () => {
  const cases = [
    { name: "old revision", output: gateOutput(1), code: "revision_change" },
    {
      name: "mixed findings",
      output: gateOutput(2, "PASS", [
        {
          severity: "P2",
          title: "Old revision",
          detail: "Retained historical finding.",
          candidateId: "C1",
          candidateRevision: 1,
        },
      ]),
      code: "mixed_evidence",
    },
    {
      name: "unsupported finding field type",
      output: gateOutput(2, "PASS", [{
        severity: "P2",
        title: 42,
        detail: "A numeric title must not be normalized into persisted evidence.",
        candidateId: "C1",
        candidateRevision: 2,
      }]),
      code: "contradictory_evidence",
      verifyApprovalBlocked: true,
    },
    {
      name: "unsupported finding severity",
      output: gateOutput(2, "PASS", [{
        severity: "critical",
        title: "Unsupported severity",
        detail: "The severity is outside the persisted gate schema.",
        candidateId: "C1",
        candidateRevision: 2,
      }]),
      code: "contradictory_evidence",
      verifyApprovalBlocked: true,
    },
    {
      name: "empty finding title",
      output: gateOutput(2, "PASS", [{
        severity: "P2",
        title: "   ",
        detail: "The title is required by the persisted gate schema.",
        candidateId: "C1",
        candidateRevision: 2,
      }]),
      code: "contradictory_evidence",
      verifyApprovalBlocked: true,
    },
    {
      name: "invalid verdict",
      output: gateOutput(2).replace('"verdict":"PASS"', '"verdict":"UNKNOWN"'),
      code: "contradictory_evidence",
      verifyApprovalBlocked: true,
    },
  ];

  for (const item of cases) {
    const directory = await mkdtemp(path.join(os.tmpdir(), `agent-harness-evidence-${item.code}-`));
    try {
      const store = new JsonTaskStore(path.join(directory, "tasks.json"));
      await store.init();
      const task = await store.create({
        title: `Reject ${item.name}`,
        description: "Persist the exact structured evidence failure.",
        repositoryPath: directory,
        workflow: "implement",
        priority: "medium",
      });
      await store.update(task.id, (draft) => {
        draft.status = "ready-for-review";
        draft.currentStage = "dev-review";
        draft.candidates = [{
          id: "C1",
          revisionNumber: 2,
          baseRevision: "a".repeat(40),
          baseBranch: "main",
          headRevision: "b".repeat(40),
          branch: "agent-harness/ah-005-c1",
          repositoryRoot: directory,
          worktreePath: directory,
          status: "under_review",
          createdAt: "2026-08-01T12:00:00.000Z",
          updatedAt: "2026-08-01T12:00:00.000Z",
          revisions: [],
        }];
      });
      const orchestrator = new TaskOrchestrator(store, {
        getStatus: async () => ({ available: true, authenticated: true, authMethod: "ChatGPT" }),
        worktreeManager: { verifyCandidate: async () => {} },
        runCodex: async () => ({
          finalText: item.output,
          usage: { inputTokens: 10, cachedInputTokens: 4, outputTokens: 5, totalTokens: 15 },
        }),
      });

      assert.equal(await orchestrator.start(task.id, "review"), true);
      const finished = await waitForStatus(store, task.id, "review-retry-required");
      const run = finished.runs.find((entry) => entry.stage === "dev-review");
      assert.equal(run.evidenceError.code, item.code, item.name);
      assert.equal(run.evidenceError.copy, RUNTIME_FRESHNESS_REASONS[item.code], item.name);
      assert.equal(run.freshness.reasonCode, item.code, item.name);
      assert.equal(finished.gateFreshness["dev-review"].reasonCode, item.code, item.name);
      assert.match(finished.events.at(-1).title, /rerun required/i, item.name);
      assert.match(finished.events.at(-1).detail, new RegExp(RUNTIME_FRESHNESS_REASONS[item.code]), item.name);
      assert.equal(finished.candidates.at(-1).revisionNumber, 2, item.name);
      assert.equal(finished.candidates.at(-1).status, "review_retry_required", item.name);
      assert.equal(finished.reviewRetries.length, 1, item.name);
      if (item.verifyApprovalBlocked) {
        await store.update(task.id, (draft) => {
          draft.status = "awaiting-human-approval";
          draft.currentStage = "approval";
          draft.candidates.at(-1).status = "awaiting_human_approval";
        });
        await assert.rejects(
          () => orchestrator.approveMerge(task.id),
          /cannot be approved.*Development Review is not fresh.*contradictory/i,
        );
      }
    } finally {
      await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  }
});

test("candidate command failure overrides a Development Review PASS and remains rerunnable", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-review-command-failure-"));
  try {
    const store = new JsonTaskStore(path.join(directory, "tasks.json"));
    await store.init();
    const task = await store.create({
      title: "Reject unsupported review pass",
      description: "Candidate command telemetry must override narrative PASS.",
      repositoryPath: directory,
      workflow: "implement",
      priority: "medium",
    });
    await store.update(task.id, (draft) => {
      draft.status = "ready-for-review";
      draft.currentStage = "dev-review";
      draft.candidates = [{
        id: "C1",
        revisionNumber: 1,
        baseRevision: "a".repeat(40),
        baseBranch: "main",
        headRevision: "b".repeat(40),
        branch: "agent-harness/review-command-failure",
        repositoryRoot: directory,
        worktreePath: directory,
        status: "ready_for_review",
        createdAt: "2026-08-01T12:00:00.000Z",
        updatedAt: "2026-08-01T12:00:00.000Z",
        revisions: [],
      }];
    });
    const orchestrator = new TaskOrchestrator(store, {
      getStatus: async () => ({ available: true, authenticated: true, authMethod: "ChatGPT" }),
      worktreeManager: { verifyCandidate: async () => {} },
      runCodex: async ({ onEvent }) => {
        onEvent?.({
          type: "activity",
          tone: "warning",
          title: "Repository command returned a warning",
          detail: "backend/.venv/bin/python -m pytest tests/unit",
          commandFailed: true,
          runtimeScope: "candidate",
          toolCall: {
            id: "cmd-failed",
            name: "command_execution",
            category: "repository-command",
            phase: "completed",
            result: "Exit code 1",
          },
        });
        return {
          finalText: gateOutput(1),
          usage: { inputTokens: 10, cachedInputTokens: 4, outputTokens: 5, totalTokens: 15 },
        };
      },
    });

    assert.equal(await orchestrator.start(task.id, "review"), true);
    const finished = await waitForStatus(store, task.id, "review-retry-required");
    const run = finished.runs.find((entry) => entry.stage === "dev-review");
    const artifact = finished.artifacts.find((entry) => entry.id === run.artifactId);
    assert.equal(run.gateResult.reportedVerdict, "PASS");
    assert.equal(run.gateResult.verdict, "REPAIR");
    assert.equal(run.evidenceError.code, "review_tooling_failure");
    assert.equal(run.freshness.reasonCode, "review_tooling_failure");
    assert.equal(run.toolCalls[0].commandFailed, true);
    assert.equal(run.toolCalls[0].runtimeScope, "candidate");
    assert.equal(run.toolCalls[0].result, "Exit code 1");
    assert.equal(artifact.gateResult.verdict, "REPAIR");
    assert.equal(finished.candidates[0].status, "review_retry_required");
    assert.equal(finished.reviewRetries.length, 1);
    assert.match(finished.events.at(-1).title, /rerun required/i);

    assert.equal(await orchestrator.start(task.id, "review"), true);
    let repeated = null;
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const current = await store.get(task.id);
      if (
        current.status === "review-retry-required" &&
        current.attemptsByStage["dev-review"] === 2 &&
        current.activeRunIds.length === 0
      ) {
        repeated = current;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.ok(repeated);
    assert.equal(repeated.status, "review-retry-required");
    assert.equal(repeated.reviewRetries.length, 2);
    assert.equal(repeated.stageRunLimits["dev-review"], 2, "the same failure stops after one bounded retry");
    assert.match(repeated.error, /human must inspect/i);
    assert.equal(await orchestrator.start(task.id, "review"), false, "another review requires an explicit human retry grant");
  } finally {
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test("stops Development Review when it exceeds the hard repository-command budget", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-review-command-budget-"));
  try {
    const store = new JsonTaskStore(path.join(directory, "tasks.json"));
    await store.init();
    const task = await store.create({
      title: "Bound review cost",
      description: "A reviewer must not inventory the repository.",
      repositoryPath: directory,
      workflow: "implement",
      priority: "low",
    });
    await store.update(task.id, (draft) => {
      draft.status = "ready-for-review";
      draft.currentStage = "dev-review";
      draft.candidates = [{
        id: "C1",
        revisionNumber: 1,
        baseRevision: "a".repeat(40),
        baseBranch: "main",
        headRevision: "b".repeat(40),
        branch: "agent-harness/review-command-budget",
        repositoryRoot: directory,
        worktreePath: directory,
        status: "ready_for_review",
        createdAt: "2026-08-01T12:00:00.000Z",
        updatedAt: "2026-08-01T12:00:00.000Z",
        revisions: [],
      }];
    });
    const orchestrator = new TaskOrchestrator(store, {
      worktreeManager: { verifyCandidate: async () => {} },
      runCodex: async ({ onEvent }) => {
        for (let index = 1; index <= 9; index += 1) {
          onEvent?.({
            type: "activity",
            tone: "info",
            title: "Inspecting repository",
            detail: `git show file-${index}`,
            toolCall: {
              id: `cmd-${index}`,
              name: "command_execution",
              category: "repository-command",
              phase: "started",
              result: null,
            },
          });
        }
        return {
          finalText: gateOutput(1),
          usage: { inputTokens: 10, cachedInputTokens: 4, outputTokens: 5, totalTokens: 15 },
        };
      },
    });

    assert.equal(await orchestrator.start(task.id, "review"), true);
    const failed = await waitForStatus(store, task.id, "failed");
    assert.match(failed.error, /hard 4-command review budget/i);
    assert.equal(failed.runs.at(-1).status, "failed");
    assert.ok(failed.events.some((event) => event.title === "Review command budget exceeded"));
  } finally {
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test("reviewer command failure never authorizes candidate Repair even when the reviewer reports REPAIR", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-review-command-repair-"));
  try {
    const store = new JsonTaskStore(path.join(directory, "tasks.json"));
    await store.init();
    const task = await store.create({
      title: "Repair a candidate despite failed review telemetry",
      description: "A command failure blocks promotion without erasing an exact REPAIR finding.",
      repositoryPath: directory,
      workflow: "implement",
      priority: "medium",
    });
    await store.update(task.id, (draft) => {
      draft.status = "ready-for-review";
      draft.currentStage = "dev-review";
      draft.candidates = [{
        id: "C1",
        revisionNumber: 1,
        baseRevision: "a".repeat(40),
        baseBranch: "main",
        headRevision: "b".repeat(40),
        branch: "agent-harness/review-command-repair",
        repositoryRoot: directory,
        worktreePath: directory,
        status: "ready_for_review",
        createdAt: "2026-08-01T12:00:00.000Z",
        updatedAt: "2026-08-01T12:00:00.000Z",
        revisions: [],
      }];
    });

    const orchestrator = new TaskOrchestrator(store, {
      getStatus: async () => ({ available: true, authenticated: true, authMethod: "ChatGPT" }),
      worktreeManager: { verifyCandidate: async () => {} },
      runCodex: async ({ onEvent }) => {
        onEvent?.({
          type: "activity",
          tone: "warning",
          title: "Repository command returned a warning",
          detail: "npm test",
          commandFailed: true,
          runtimeScope: "candidate",
          toolCall: {
            id: "cmd-failed",
            name: "command_execution",
            category: "repository-command",
            phase: "completed",
            result: "Exit code 1",
          },
        });
        return {
          finalText: gateOutput(1, "REPAIR", [{
            severity: "P1",
            title: "Candidate defect",
            detail: "Repair the exact candidate before promotion.",
            candidateId: "C1",
            candidateRevision: 1,
          }]),
          usage: { inputTokens: 10, cachedInputTokens: 4, outputTokens: 5, totalTokens: 15 },
        };
      },
    });

    assert.equal(await orchestrator.start(task.id, "review"), true);
    const retryReady = await waitForStatus(store, task.id, "review-retry-required");
    assert.equal(retryReady.gateFreshness["dev-review"].reasonCode, "review_tooling_failure");
    assert.equal(retryReady.runs.at(-1).gateResult.verdict, "REPAIR");
    assert.equal(retryReady.runs.at(-1).gateResult.findings[0].blocking, true);
    assert.equal(retryReady.runs.at(-1).toolCalls[0].commandFailed, true);
    assert.equal(retryReady.candidates[0].status, "review_retry_required");
    assert.equal(await orchestrator.start(task.id, "repair"), false);
  } finally {
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test("an exact failed Focused Test permits one explicit same-candidate rerun without authorizing repair", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-failed-test-command-"));
  try {
    const store = new JsonTaskStore(path.join(directory, "tasks.json"));
    await store.init();
    const task = await store.create({
      title: "Repair an exact failed Focused Test",
      description: "Harness-observed failed Test evidence may receive one bounded human-authorized same-revision rerun.",
      repositoryPath: directory,
      workflow: "implement",
      priority: "medium",
    });
    await store.update(task.id, (draft) => {
      draft.status = "ready-for-test";
      draft.currentStage = "test";
      draft.candidates = [{
        id: "C1",
        revisionNumber: 2,
        baseRevision: "a".repeat(40),
        baseBranch: "main",
        headRevision: "b".repeat(40),
        branch: "agent-harness/failed-focused-test",
        repositoryRoot: directory,
        worktreePath: directory,
        status: "ready_for_test",
        createdAt: "2026-08-01T12:00:00.000Z",
        updatedAt: "2026-08-01T12:00:00.000Z",
        revisions: [],
      }];
    });
    let verificationCount = 0;
    const orchestrator = new TaskOrchestrator(store, {
      getStatus: async () => ({ available: true, authenticated: true, authMethod: "ChatGPT" }),
      worktreeManager: {
        verifyCandidate: async () => {},
        recoverCandidate: async () => false,
      },
      runVerification: async ({ candidate }) => {
        verificationCount += 1;
        const failedRow = {
          ...harnessEvidence(candidate).rows[0],
          status: "failed",
          assertions: [{ label: "exit code", actual: "1", expected: "0" }],
          failureDetails: "npm test exited 1.",
        };
        return harnessEvidence(candidate, { status: "failed", rows: [failedRow] });
      },
      runCodex: async ({ onEvent }) => {
        onEvent?.({
          type: "activity",
          tone: "warning",
          title: "Repository command returned a warning",
          detail: "rg optional-pattern",
          commandFailed: true,
          runtimeScope: "candidate",
          toolCall: {
            id: "cmd-interpreter-failed",
            name: "command_execution",
            category: "repository-command",
            phase: "completed",
            result: "Exit code 1",
          },
        });
        return {
          finalText: "## Interpretation\n\nThe harness-observed Test failed.",
          usage: { inputTokens: 10, cachedInputTokens: 4, outputTokens: 5, totalTokens: 15 },
        };
      },
    });

    assert.equal(await orchestrator.start(task.id, "test"), true);
    const repairReady = await waitForStatus(store, task.id, "repair-required");
    const testRun = repairReady.runs.find((run) => run.stage === "test");
    assert.equal(testRun.test.status, "failed");
    assert.equal(testRun.evidenceError.code, "review_tooling_failure", "failed interpreter telemetry remains retained");
    assert.equal(testRun.toolCalls[0].commandFailed, true);
    assert.equal(repairReady.gateFreshness.test.reasonCode, "repair_required");
    assert.equal(repairReady.gateFreshness.test.focusedTest.status, "failed");
    assert.equal(repairReady.candidates.at(-1).status, "repair_required");

    await store.update(task.id, (draft) => {
      draft.status = "blocked";
      draft.currentStage = "test";
      draft.attemptsByStage.test = draft.stageRunLimits.test;
      draft.candidates.at(-1).status = "ready_for_test";
    });

    assert.deepEqual(await orchestrator.retryTestOnSameCandidate(task.id), { started: true });
    const failedAgain = await waitForStatus(store, task.id, "repair-required");
    assert.equal(verificationCount, 2);
    assert.equal(failedAgain.sameCandidateTestRetries.length, 1);
    assert.equal(failedAgain.sameCandidateTestRetries[0].candidateRevision, 2);
    assert.equal(failedAgain.candidates[0].verificationRuns[0].retryDisposition, "human-rerun-requested");
    assert.equal(failedAgain.candidates[0].revisionNumber, 2);
    await assert.rejects(() => orchestrator.retryTestOnSameCandidate(task.id), /already used its one same-candidate Test retry/i);
  } finally {
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test("missing authoritative output retains the candidate and permits only the same gate rerun", async () => {
  const cases = [
    {
      stage: "dev-review",
      kind: "review",
      taskStatus: "review-retry-required",
      candidateStatus: "review_retry_required",
      label: "Development review",
    },
    // The test stage is deliberately absent. This case is "a model returned no authoritative
    // structured evidence", and for `test` that is no longer a possible failure: the harness
    // builds that evidence from commands it executed itself (#47), so there is no model answer
    // to be missing. The failure modes that remain for harness-built test evidence are covered
    // by "malformed focused Test ingestion" above and by tests/verification.test.mjs — which
    // also covers the new one, a repository that declares no verification commands at all.
    {
      stage: "final-review",
      kind: "final-review",
      taskStatus: "ready-for-final-review",
      candidateStatus: "ready_for_final_review",
      label: "Final review",
    },
  ];

  for (const item of cases) {
    const directory = await mkdtemp(path.join(os.tmpdir(), `agent-harness-${item.stage}-rerun-`));
    try {
      const store = new JsonTaskStore(path.join(directory, "tasks.json"));
      await store.init();
      const task = await store.create({
        title: `Rerun malformed ${item.stage}`,
        description: "Malformed gate evidence must not create a candidate repair.",
        repositoryPath: directory,
        workflow: "implement",
        priority: "medium",
      });
      await store.update(task.id, (draft) => {
        draft.status = item.taskStatus;
        draft.currentStage = item.stage;
        draft.candidates = [{
          id: "C1",
          revisionNumber: 2,
          baseRevision: "a".repeat(40),
          baseBranch: "main",
          headRevision: "b".repeat(40),
          branch: "agent-harness/ah-005-c1",
          repositoryRoot: directory,
          worktreePath: directory,
          status: item.candidateStatus,
          createdAt: "2026-08-01T12:00:00.000Z",
          updatedAt: "2026-08-01T12:00:00.000Z",
          revisions: [],
        }];
      });
      const orchestrator = new TaskOrchestrator(store, {
        getStatus: async () => ({ available: true, authenticated: true, authMethod: "ChatGPT" }),
        worktreeManager: { verifyCandidate: async () => {} },
        runCodex: async () => ({
          finalText: "## Verdict\n\nPASS without the required structured evidence block.",
          usage: { inputTokens: 10, cachedInputTokens: 4, outputTokens: 5, totalTokens: 15 },
        }),
      });

      assert.equal(await orchestrator.start(task.id, item.kind), true);
      let finished = await waitForStatus(store, task.id, item.taskStatus);
      assert.equal(finished.candidates.at(-1).revisionNumber, 2, item.stage);
      assert.equal(finished.candidates.at(-1).status, item.candidateStatus, item.stage);
      assert.equal(finished.attemptsByStage[item.stage], 1, item.stage);
      assert.equal(finished.runs.at(-1).evidenceError.code, "missing_authoritative_summary", item.stage);
      assert.equal(finished.runs.at(-1).freshness.reasonCode, "missing_authoritative_summary", item.stage);
      assert.equal(finished.events.at(-1).title, `${item.label} rerun required`, item.stage);
      assert.equal(
        finished.events.at(-1).detail,
        `C1 revision 2 could not accept the persisted gate evidence. ${RUNTIME_FRESHNESS_REASONS.missing_authoritative_summary}`,
        item.stage,
      );

      for (const otherKind of ["review", "test", "final-review", "repair"].filter((kind) => kind !== item.kind)) {
        assert.equal(await orchestrator.start(task.id, otherKind), false, `${item.stage}: ${otherKind}`);
      }
      assert.equal(await orchestrator.start(task.id, item.kind), true, `${item.stage}: same gate rerun`);
      finished = await waitForStatus(store, task.id, item.taskStatus);
      assert.equal(finished.candidates.at(-1).revisionNumber, 2, `${item.stage}: rerun revision`);
      assert.equal(finished.attemptsByStage[item.stage], 2, `${item.stage}: retained attempts`);
      assert.equal(finished.runs.filter((run) => run.stage === item.stage).length, 2, `${item.stage}: retained runs`);
    } finally {
      await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  }
});

test("filters focused Test rows to the exact candidate and retains invalid rows for audit", () => {
  const testRun = makeRuntimeRun({ id: "RUN-TEST", stage: "test", kind: "test", artifactId: "ART-TEST" });
  const testArtifact = makeArtifact({
    id: "ART-TEST",
    stage: "test",
    focusedTest: {
      candidateId: "C1",
      candidateRevision: 2,
      bindingExplicit: true,
      command: "npm test",
      status: "passed",
      rows: [
        makeTestRow({ id: "row-current", candidateId: "C1", candidateRevision: 2 }),
        makeTestRow({ id: "row-old", candidateId: "C1", candidateRevision: 1 }),
      ],
    },
  });
  const testTask = makeRuntimeTask({ runs: [testRun], artifacts: [testArtifact] });
  attachRunArtifact(testTask, testRun.id, testArtifact);
  assert.equal(testTask.gateFreshness.test.fresh, false);
  assert.equal(testTask.gateFreshness.test.reasonCode, "mixed_evidence");
  assert.deepEqual(testTask.gateFreshness.test.focusedTestRows, []);
  assert.equal(testTask.runs[0].test.rows.length, 2, "historical rows remain retained for audit");

  const exactTestRun = makeRuntimeRun({ id: "RUN-TEST-EXACT", stage: "test", kind: "test", artifactId: "ART-TEST-EXACT" });
  const exactTestArtifact = makeArtifact({
    id: "ART-TEST-EXACT",
    stage: "test",
    focusedTest: {
      candidateId: "C1",
      candidateRevision: 2,
      bindingExplicit: true,
      command: "npm test",
      status: "passed",
      rows: [
        makeTestRow({ id: "row-exact-1" }),
        makeTestRow({ id: "row-exact-2" }),
      ],
    },
  });
  const exactTestTask = makeRuntimeTask({ runs: [exactTestRun], artifacts: [exactTestArtifact] });
  attachRunArtifact(exactTestTask, exactTestRun.id, exactTestArtifact);
  assert.equal(exactTestTask.gateFreshness.test.fresh, true);
  assert.deepEqual(exactTestTask.gateFreshness.test.focusedTestRows.map((row) => row.id), ["row-exact-1", "row-exact-2"]);

  const parentMixedRun = makeRuntimeRun({ id: "RUN-TEST-PARENT-MIXED", stage: "test", kind: "test", artifactId: "ART-TEST-PARENT-MIXED" });
  const parentMixedArtifact = makeArtifact({
    id: "ART-TEST-PARENT-MIXED",
    stage: "test",
    focusedTest: {
      candidateId: "C1",
      candidateRevision: 2,
      bindingExplicit: true,
      command: "npm test",
      status: "passed",
      rows: [makeTestRow({ id: "row-other-candidate", candidateId: "C2" })],
    },
  });
  const parentMixedTask = makeRuntimeTask({ runs: [parentMixedRun], artifacts: [parentMixedArtifact] });
  attachRunArtifact(parentMixedTask, parentMixedRun.id, parentMixedArtifact);
  assert.equal(parentMixedTask.gateFreshness.test.reasonCode, "mixed_evidence");
  assert.deepEqual(parentMixedTask.gateFreshness.test.focusedTestRows, []);

  const failedTestRun = makeRuntimeRun({
    id: "RUN-TEST-FAILED",
    stage: "test",
    kind: "test",
    artifactId: "ART-TEST-FAILED",
  });
  const failedFocusedTest = {
    candidateId: "C1",
    candidateRevision: 2,
    bindingExplicit: true,
    command: "npm test",
    status: "failed",
    rows: [makeTestRow({ id: "row-failed", status: "failed" })],
  };
  const failedTestArtifact = makeArtifact({
    id: "ART-TEST-FAILED",
    stage: "test",
    gateResult: makeGateResult({
      stage: "test",
      verdict: "REPAIR",
      reportedVerdict: "REPAIR",
      blockingReasons: ["A verification command failed."],
    }),
    focusedTest: failedFocusedTest,
  });
  const failedTestTask = makeRuntimeTask({ runs: [failedTestRun], artifacts: [failedTestArtifact] });
  attachRunArtifact(failedTestTask, failedTestRun.id, failedTestArtifact);
  assert.equal(failedTestTask.gateFreshness.test.fresh, false);
  assert.equal(failedTestTask.gateFreshness.test.reasonCode, "repair_required");
  assert.equal(failedTestTask.gateFreshness.test.focusedTest.status, "failed");
  assert.deepEqual(failedTestTask.gateFreshness.test.focusedTestRows.map((row) => row.id), ["row-failed"]);

  const failedWithInterpreterCommandRun = makeRuntimeRun({
    id: "RUN-TEST-FAILED-INTERPRETER-COMMAND",
    stage: "test",
    kind: "test",
    artifactId: "ART-TEST-FAILED-INTERPRETER-COMMAND",
    gateResult: failedTestArtifact.gateResult,
    evidenceError: { code: "command_failure", copy: RUNTIME_FRESHNESS_REASONS.command_failure },
  });
  failedWithInterpreterCommandRun.toolCalls = [{
    id: "cmd-interpreter-failed",
    name: "command_execution",
    category: "repository-command",
    phase: "completed",
    result: "Exit code 1",
    commandFailed: true,
    runtimeScope: "candidate",
  }];
  const failedWithInterpreterCommandArtifact = makeArtifact({
    id: "ART-TEST-FAILED-INTERPRETER-COMMAND",
    stage: "test",
    gateResult: failedTestArtifact.gateResult,
    focusedTest: failedFocusedTest,
  });
  failedWithInterpreterCommandArtifact.evidenceError = {
    code: "command_failure",
    copy: RUNTIME_FRESHNESS_REASONS.command_failure,
  };
  const failedWithInterpreterCommandTask = makeRuntimeTask({
    runs: [failedWithInterpreterCommandRun],
    artifacts: [failedWithInterpreterCommandArtifact],
  });
  attachRunArtifact(
    failedWithInterpreterCommandTask,
    failedWithInterpreterCommandRun.id,
    failedWithInterpreterCommandArtifact,
  );
  assert.equal(failedWithInterpreterCommandTask.gateFreshness.test.reasonCode, "repair_required");
  assert.equal(failedWithInterpreterCommandTask.gateFreshness.test.focusedTest.status, "failed");

  for (const blockingReason of [
    "A test command failed.",
    "Editorial guidance only; no execution failure is represented by this field.",
  ]) {
    const repairRun = makeRuntimeRun({
      id: `RUN-TEST-REPAIR-${blockingReason.slice(0, 8)}`,
      stage: "test",
      kind: "test",
      gateResult: makeGateResult({
        stage: "test",
        verdict: "REPAIR",
        reportedVerdict: "REPAIR",
        blockingReasons: [blockingReason],
      }),
      test: makeFocusedTestSummary(),
    });
    const repairTask = makeRuntimeTask({ runs: [repairRun] });
    refreshGateFreshness(repairTask);
    assert.equal(repairTask.gateFreshness.test.reasonCode, "repair_required", blockingReason);
  }
});

test("latest terminal exact-candidate attempt wins and older passes become superseded", () => {
  const first = makeRuntimeRun({
    id: "RUN-1",
    attempt: 1,
    artifactId: "ART-1",
    gateResult: makeGateResult(),
  });
  const second = makeRuntimeRun({
    id: "RUN-2",
    attempt: 2,
    artifactId: "ART-2",
    gateResult: makeGateResult({ verdict: "REPAIR", reportedVerdict: "REPAIR", blockingReasons: ["P1: repair"] }),
  });
  const task = makeRuntimeTask({
    runs: [first, second],
    artifacts: [makeArtifact({ id: "ART-1" }), makeArtifact({ id: "ART-2", gateResult: second.gateResult })],
  });
  refreshGateFreshness(task);
  assert.equal(task.gateFreshness["dev-review"].sourceRunId, "RUN-2");
  assert.equal(task.gateFreshness["dev-review"].reasonCode, "repair_required");
  assert.equal(task.runs[0].freshness.reasonCode, "superseded_attempt");
  assert.equal(task.runs[1].freshness.reasonCode, "repair_required");
  assert.equal(task.artifacts[0].freshness.reasonCode, "superseded_attempt");
  assert.equal(task.artifacts[1].freshness.reasonCode, "repair_required");

  for (const { earlierAttempt, laterAttempt } of [
    { earlierAttempt: 2, laterAttempt: 1 },
    { earlierAttempt: 2, laterAttempt: 2 },
  ]) {
    const earlierPass = makeRuntimeRun({
      id: `RUN-EARLIER-${earlierAttempt}-${laterAttempt}`,
      attempt: earlierAttempt,
      gateResult: makeGateResult(),
    });
    const laterRepair = makeRuntimeRun({
      id: `RUN-LATER-${earlierAttempt}-${laterAttempt}`,
      attempt: laterAttempt,
      gateResult: makeGateResult({ verdict: "REPAIR", reportedVerdict: "REPAIR", blockingReasons: ["P1: repair"] }),
    });
    // Attempts are assigned monotonically as runs are appended, so a repeated or
    // decreasing attempt means persisted order and attempt order disagree. Neither
    // signal may silently win: the gate fails closed and no run is authoritative.
    const conflictingAttemptTask = makeRuntimeTask({ runs: [earlierPass, laterRepair] });
    refreshGateFreshness(conflictingAttemptTask);
    assert.equal(conflictingAttemptTask.gateFreshness["dev-review"].sourceRunId, null);
    assert.equal(conflictingAttemptTask.gateFreshness["dev-review"].fresh, false);
    assert.equal(conflictingAttemptTask.gateFreshness["dev-review"].reasonCode, "ambiguous_attempt");
    assert.equal(laterRepair.id.length > 0, true);
  }

  const unrelated = makeRuntimeRun({
    id: "RUN-C2",
    candidateId: "C2",
    candidateRevision: 8,
    attempt: 99,
    artifactId: "ART-C2",
    gateResult: makeGateResult({ candidateId: "C2", candidateRevision: 8 }),
  });
  const exact = makeRuntimeRun({ id: "RUN-EXACT", attempt: 1, artifactId: "ART-EXACT", gateResult: makeGateResult() });
  const exactTask = makeRuntimeTask({
    runs: [exact, unrelated],
    artifacts: [makeArtifact({ id: "ART-EXACT" }), makeArtifact({ id: "ART-C2", candidateId: "C2", candidateRevision: 8, gateResult: unrelated.gateResult })],
  });
  refreshGateFreshness(exactTask);
  assert.equal(exactTask.gateFreshness["dev-review"].sourceRunId, "RUN-EXACT");
  assert.equal(exactTask.gateFreshness["dev-review"].fresh, true);

  const malformed = makeRuntimeRun({
    id: "RUN-MALFORMED",
    attempt: 2,
    candidateRevision: "2",
    artifactId: null,
  });
  const malformedTask = makeRuntimeTask({
    runs: [exact, malformed],
    artifacts: [makeArtifact({ id: "ART-EXACT" })],
  });
  refreshGateFreshness(malformedTask);
  assert.equal(malformedTask.gateFreshness["dev-review"].sourceRunId, "RUN-MALFORMED");
  assert.equal(malformedTask.gateFreshness["dev-review"].fresh, false);
  assert.equal(malformedTask.gateFreshness["dev-review"].reasonCode, "malformed_binding");
  assert.equal(malformedTask.runs[0].freshness.reasonCode, "superseded_attempt");

  const revisionTask = makeRuntimeTask({
    runs: [makeRuntimeRun({ id: "RUN-R1", candidateRevision: 1, gateResult: makeGateResult({ candidateRevision: 1 }) })],
  });
  const nextRevisionRun = beginAgentRun(revisionTask, {
    id: "RUN-R2",
    kind: "review",
    stage: "dev-review",
    role: "dev-review",
    candidateId: "C1",
    candidateRevision: 2,
  });
  assert.equal(nextRevisionRun.attempt, 1, "attempt numbering is scoped to the exact candidate revision");
});

test("unresolvable attempt evidence fails closed and blocks approval", async () => {
  // Malformed, missing, repeated, or decreasing attempt evidence cannot identify an
  // authoritative terminal run. Every case fails closed rather than falling back to
  // persisted array position, which could otherwise resurrect an older PASS.
  for (const { earlierAttempt, laterAttempt, laterStatus, expectedReason } of [
    { earlierAttempt: 1, laterAttempt: null, laterStatus: "completed", expectedReason: "malformed_attempt" },
    { earlierAttempt: 1, laterAttempt: "2", laterStatus: "completed", expectedReason: "malformed_attempt" },
    { earlierAttempt: 2, laterAttempt: 1, laterStatus: "failed", expectedReason: "ambiguous_attempt" },
    { earlierAttempt: 2, laterAttempt: 2, laterStatus: "failed", expectedReason: "ambiguous_attempt" },
  ]) {
    const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-legacy-attempt-"));
    try {
      const store = new JsonTaskStore(path.join(directory, "tasks.json"));
      await store.init();
      const task = await store.create({
        title: "Reject superseded pass",
        description: "Persisted terminal order controls when attempt metadata is unavailable.",
        repositoryPath: directory,
        workflow: "implement",
        priority: "medium",
      });
      await store.update(task.id, (draft) => {
        draft.status = "awaiting-human-approval";
        draft.currentStage = "approval";
        draft.candidates = [{
          id: "C1",
          revisionNumber: 2,
          baseRevision: "a".repeat(40),
          baseBranch: "main",
          headRevision: "b".repeat(40),
          status: "awaiting_human_approval",
        }];
        draft.runs = [
          makeRuntimeRun({ id: "RUN-EARLIER-PASS", attempt: earlierAttempt, gateResult: makeGateResult() }),
          makeRuntimeRun({ id: "RUN-LATER-TERMINAL", attempt: laterAttempt, status: laterStatus, gateResult: null }),
        ];
        refreshGateFreshness(draft);
      });

      const persisted = await store.get(task.id);
      assert.equal(persisted.gateFreshness["dev-review"].sourceRunId, null);
      assert.equal(persisted.gateFreshness["dev-review"].fresh, false);
      assert.equal(persisted.gateFreshness["dev-review"].reasonCode, expectedReason);

      let merged = false;
      const orchestrator = new TaskOrchestrator(store, {
        worktreeManager: { async merge() { merged = true; } },
      });
      await assert.rejects(
        () => orchestrator.approveMerge(task.id),
        /cannot be approved.*Development Review is not fresh/i,
      );
      assert.equal(merged, false);
    } finally {
      await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  }
});

test("merge approval fails closed when persisted Test verdicts contradict", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-stale-approval-"));
  try {
    const store = new JsonTaskStore(path.join(directory, "tasks.json"));
    await store.init();
    const task = await store.create({
      title: "Reject stale approval",
      description: "Status fields cannot override authoritative gate freshness.",
      repositoryPath: directory,
      workflow: "implement",
      priority: "medium",
    });
    await store.update(task.id, (draft) => {
      draft.status = "awaiting-human-approval";
      draft.currentStage = "approval";
      draft.candidates = [{
        id: "C1",
        revisionNumber: 2,
        baseRevision: "a".repeat(40),
        baseBranch: "main",
        headRevision: "b".repeat(40),
        status: "awaiting_human_approval",
      }];
      const devReview = makeRuntimeRun({ id: "RUN-DEV", stage: "dev-review", artifactId: "ART-DEV" });
      const testRun = makeRuntimeRun({
        id: "RUN-TEST",
        stage: "test",
        kind: "test",
        artifactId: "ART-TEST",
        gateResult: makeGateResult({ stage: "test", verdict: "PASS", reportedVerdict: "REPAIR" }),
      });
      const finalReview = makeRuntimeRun({
        id: "RUN-FINAL",
        stage: "final-review",
        artifactId: "ART-FINAL",
        gateResult: makeGateResult({ stage: "final-review" }),
      });
      const focusedTest = {
        candidateId: "C1",
        candidateRevision: 2,
        bindingExplicit: true,
        command: "npm test",
        status: "passed",
        rows: [makeTestRow()],
      };
      draft.runs = [devReview, testRun, finalReview];
      draft.artifacts = [
        makeArtifact({ id: "ART-DEV" }),
        makeArtifact({ id: "ART-TEST", stage: "test", gateResult: testRun.gateResult, focusedTest }),
        makeArtifact({ id: "ART-FINAL", stage: "final-review", gateResult: finalReview.gateResult }),
      ];
      attachRunArtifact(draft, "RUN-TEST", draft.artifacts[1]);
      refreshGateFreshness(draft);
    });

    const beforeApproval = await store.get(task.id);
    assert.equal(beforeApproval.gateFreshness["dev-review"].fresh, true);
    assert.equal(beforeApproval.gateFreshness.test.fresh, false);
    assert.equal(beforeApproval.gateFreshness.test.reasonCode, "contradictory_evidence");
    assert.equal(beforeApproval.gateFreshness["final-review"].fresh, true);
    assert.equal(beforeApproval.runs.find((run) => run.id === "RUN-TEST").gateResult.reportedVerdict, "REPAIR");

    let merged = false;
    const orchestrator = new TaskOrchestrator(store, {
      worktreeManager: {
        async merge() {
          merged = true;
        },
      },
    });

    await assert.rejects(() => orchestrator.approveMerge(task.id), /cannot be approved.*not fresh/i);
    const rejected = await store.get(task.id);
    assert.equal(rejected.status, "awaiting-human-approval");
    assert.equal(rejected.mergeIntent, null);
    assert.equal(merged, false);
  } finally {
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test("merge approval fails closed when persisted gate findings are malformed", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-malformed-finding-approval-"));
  try {
    const store = new JsonTaskStore(path.join(directory, "tasks.json"));
    await store.init();
    const task = await store.create({
      title: "Reject malformed gate findings",
      description: "Persisted finding shapes must not authorize a merge.",
      repositoryPath: directory,
      workflow: "implement",
      priority: "medium",
    });
    await store.update(task.id, (draft) => {
      draft.status = "awaiting-human-approval";
      draft.currentStage = "approval";
      draft.candidates = [{
        id: "C1",
        revisionNumber: 2,
        baseRevision: "a".repeat(40),
        baseBranch: "main",
        headRevision: "b".repeat(40),
        status: "awaiting_human_approval",
      }];
      const malformedFinding = makePersistedFinding({ severity: "p0" });
      const devReview = makeRuntimeRun({
        id: "RUN-DEV-MALFORMED",
        stage: "dev-review",
        gateResult: makeGateResult({ stage: "dev-review", findings: [malformedFinding] }),
      });
      const testRun = makeRuntimeRun({
        id: "RUN-TEST-MALFORMED",
        stage: "test",
        kind: "test",
        artifactId: "ART-TEST-MALFORMED",
        gateResult: makeGateResult({ stage: "test", findings: [malformedFinding] }),
      });
      const finalReview = makeRuntimeRun({
        id: "RUN-FINAL-MALFORMED",
        stage: "final-review",
        gateResult: makeGateResult({ stage: "final-review", findings: [malformedFinding] }),
      });
      const focusedTest = {
        candidateId: "C1",
        candidateRevision: 2,
        bindingExplicit: true,
        command: "npm test",
        status: "passed",
        rows: [makeTestRow()],
      };
      const testArtifact = makeArtifact({
        id: "ART-TEST-MALFORMED",
        stage: "test",
        gateResult: testRun.gateResult,
        focusedTest,
      });
      draft.runs = [devReview, testRun, finalReview];
      draft.artifacts = [testArtifact];
      attachRunArtifact(draft, testRun.id, testArtifact);
      refreshGateFreshness(draft);
    });

    const beforeApproval = await store.get(task.id);
    for (const stage of ["dev-review", "test", "final-review"]) {
      assert.equal(beforeApproval.gateFreshness[stage].fresh, false, stage);
      assert.equal(beforeApproval.gateFreshness[stage].reasonCode, "contradictory_evidence", stage);
    }

    let merged = false;
    const orchestrator = new TaskOrchestrator(store, {
      worktreeManager: { async merge() { merged = true; } },
    });
    await assert.rejects(() => orchestrator.approveMerge(task.id), /cannot be approved.*not fresh/i);
    const rejected = await store.get(task.id);
    assert.equal(rejected.mergeIntent, null);
    assert.equal(merged, false);
  } finally {
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test("repair revision invalidates all candidate-bound gates while retaining evidence and lineage", () => {
  const stages = ["dev-review", "test", "final-review"];
  const runs = stages.map((stage) => makeRuntimeRun({
    id: `RUN-${stage}`,
    stage,
    kind: stage === "test" ? "test" : "review",
    candidateRevision: 1,
    artifactId: `ART-${stage}`,
    gateResult: stage === "test" ? null : makeGateResult({ stage, candidateRevision: 1 }),
  }));
  const testRun = runs.find((run) => run.stage === "test");
  const testArtifact = makeArtifact({
    id: "ART-test",
    stage: "test",
    candidateRevision: 1,
    gateResult: makeGateResult({ stage: "test", candidateRevision: 1 }),
    focusedTest: {
      candidateId: "C1",
      candidateRevision: 1,
      bindingExplicit: true,
      command: "npm test",
      status: "passed",
      rows: [makeTestRow({ candidateRevision: 1 })],
    },
  });
  const artifacts = runs.map((run) => run.stage === "test" ? testArtifact : makeArtifact({
    id: run.artifactId,
    stage: run.stage,
    candidateRevision: 1,
    gateResult: makeGateResult({ stage: run.stage, candidateRevision: 1 }),
  }));
  const events = runs.map((run) => ({
    id: `EVENT-${run.id}`,
    runId: run.id,
    stage: run.stage,
  }));
  events.push({
    id: "EVENT-LEGACY-DEV-REVIEW-PASS",
    at: "2026-08-01T12:02:00.000Z",
    category: "decision",
    tone: "success",
    stage: "dev-review",
    title: "Development review passed",
    detail: "C1 revision 1 advanced to the next gate.",
  });
  const task = makeRuntimeTask({
    candidateRevision: 1,
    runs,
    artifacts,
    events,
    revisions: [{ number: 1, reason: "assembly", headRevision: "a".repeat(40) }],
  });
  attachRunArtifact(task, testRun.id, testArtifact);
  refreshGateFreshness(task);
  assert.deepEqual(stages.map((stage) => task.gateFreshness[stage].fresh), [true, true, true]);

  task.candidates[0].revisionNumber = 2;
  task.candidates[0].revisions.push({ number: 2, reason: "repair", headRevision: "b".repeat(40) });
  refreshGateFreshness(task);

  for (const stage of stages) {
    assert.equal(task.gateFreshness[stage].reasonCode, "revision_change", stage);
  }
  assert.equal(task.runs.every((run) => run.freshness.reasonCode === "revision_change"), true);
  assert.equal(task.artifacts.every((artifact) => artifact.freshness.reasonCode === "revision_change"), true);
  assert.equal(task.events.filter((event) => event.runId).every((event) => event.freshness.reasonCode === "revision_change"), true);
  const legacyPassEvent = task.events.find((event) => event.id === "EVENT-LEGACY-DEV-REVIEW-PASS");
  assert.equal(legacyPassEvent.runId, undefined);
  assert.equal(legacyPassEvent.freshness.sourceRunId, null);
  assert.deepEqual(legacyPassEvent.freshness.target, { candidateId: "C1", candidateRevision: 2 });
  assert.equal(legacyPassEvent.freshness.reasonCode, "missing_binding");
  assert.equal(legacyPassEvent.freshness.reasonCopy, RUNTIME_FRESHNESS_REASONS.missing_binding);
  assert.equal(legacyPassEvent.title, "Development review passed", "historical event copy remains intact for audit");
  assert.equal(legacyPassEvent.tone, "success", "historical execution tone remains intact in persisted evidence");
  assert.equal(task.artifacts.length, 3);
  assert.equal(task.artifacts[0].content, "# retained evidence");
  assert.deepEqual(task.candidates[0].revisions.map((revision) => revision.reason), ["assembly", "repair"]);
  assert.equal(testRun.test.rows.length, 1);
});

test("migration keeps unlinked historical gate outcomes stale when the current gate is fresh", () => {
  const task = makeRuntimeTask({
    runs: [makeRuntimeRun()],
    events: [],
  });
  refreshGateFreshness(task);
  task.events.push({
    id: "EVENT-LEGACY-UNLINKED-PASS",
    at: "2026-08-01T12:02:00.000Z",
    category: "decision",
    tone: "success",
    stage: "dev-review",
    title: "Development review passed",
    detail: "Historical gate outcome.",
    runId: "RUN-WRONG-OR-MISSING",
  });
  const state = { schemaVersion: 3, tasks: [task] };

  assert.equal(migrateRunActivityState(state), true);
  assert.equal(task.gateFreshness["dev-review"].fresh, true, "the current gate remains fresh");
  assert.equal(task.events[0].runId, "RUN-WRONG-OR-MISSING", "the historical audit linkage is not rewritten");
  assert.equal(task.events[0].freshness.sourceRunId, null);
  assert.equal(task.events[0].freshness.fresh, false);
  assert.equal(task.events[0].freshness.reasonCode, "missing_binding");
  assert.equal(task.events[0].freshness.reasonCopy, RUNTIME_FRESHNESS_REASONS.missing_binding);
  assert.equal(migrateRunActivityState(state), false, "the fail-closed event repair is idempotent once persisted");
});

test("legacy gate outcomes inherit freshness only through persisted artifact linkage", () => {
  const run = makeRuntimeRun({ artifactId: "ART-REVIEW" });
  const artifact = makeArtifact({ id: "ART-REVIEW" });
  artifact.runId = run.id;
  const event = {
    id: "EVENT-LEGACY-ARTIFACT-PASS",
    at: "2026-08-01T12:02:00.000Z",
    category: "decision",
    tone: "success",
    stage: "dev-review",
    title: "Development review passed",
    detail: "Historical gate outcome with a retained artifact link.",
    artifactId: artifact.id,
  };
  const task = makeRuntimeTask({ runs: [run], artifacts: [artifact], events: [event] });

  refreshGateFreshness(task);

  assert.equal(task.gateFreshness["dev-review"].fresh, true);
  assert.equal(event.runId, undefined, "artifact resolution does not rewrite historical linkage");
  assert.equal(event.freshness.fresh, true);
  assert.equal(event.freshness.sourceRunId, run.id);
  assert.equal(event.freshness.sourceArtifactId, artifact.id);
});

test("legacy artifact migration is idempotent and assigns a deterministic stale reason", () => {
  const state = {
    schemaVersion: 1,
    tasks: [makeRuntimeTask({
      runs: [],
      artifacts: [makeArtifact({ id: "LEGACY-ART", candidateId: null, candidateRevision: null, gateResult: null })],
    })],
  };
  assert.equal(migrateRunActivityState(state), true);
  const task = state.tasks[0];
  assert.equal(task.runs.length, 1);
  assert.equal(task.runs[0].id, "legacy:LEGACY-ART");
  assert.equal(task.runs[0].freshness.reasonCode, "missing_binding");
  assert.equal(task.runs[0].freshness.reasonCopy, RUNTIME_FRESHNESS_REASONS.missing_binding);
  assert.equal(migrateRunActivityState(state), false);
  assert.equal(state.tasks[0].runs.length, 1);
});

test("builds the focused test prompt from harness observations, not from a request for evidence", () => {
  // Replaced rather than adjusted. This test used to assert the prompt asked a model for a
  // <focused-test-evidence> block and told it how to run npm on Windows PowerShell. Both are
  // gone by design: the harness runs the repository's declared commands itself and builds that
  // block from what it observed (#47), so a prompt asking for it would reintroduce exactly the
  // unverifiable claim the change removes.
  const candidate = { id: "C1", revisionNumber: 2, baseRevision: "a".repeat(40), headRevision: "b".repeat(40) };
  const request = buildTestInterpretationRequest(
    {
      id: "AH-014",
      title: "Structure focused-test evidence",
      description: "Normalize focused test evidence.",
      decisions: [],
      artifacts: [],
    },
    candidate,
    {
      command: ".agent-harness/verification.json: lint, test",
      status: "failed",
      durationMs: 4200,
      headRevision: "b".repeat(40),
      declaredCommandIds: ["lint", "test", "build"],
      executedCommandIds: ["lint", "test"],
      rows: [
        { id: "lint", title: "Biome lint", command: "npm run lint", status: "passed", assertions: [{ label: "exit code", actual: "0", expected: "0" }] },
        { id: "test", title: "Node test suite", command: "npm test", status: "failed", failureDetails: "npm test exited 1.", assertions: [{ label: "exit code", actual: "1", expected: "0" }] },
      ],
    },
  );

  // The observations are stated as facts, with the exact commands and exit codes.
  assert.match(request.prompt, /observed these results directly\. They are facts, not claims/);
  assert.match(request.prompt, /Overall: FAILED in 4200ms/);
  assert.match(request.prompt, /command: npm run lint/);
  assert.match(request.prompt, /exit code: 1 \(expected 0\)/);
  assert.match(request.prompt, /detail: npm test exited 1\./);
  // Bound to the revision verification actually ran against.
  assert.match(request.prompt, new RegExp(`Verification ran against: ${"b".repeat(40)}`));
  // A command that never ran is named as such rather than silently absent.
  assert.match(request.prompt, /Not executed, because an earlier command failed: build\./);
  // Interpretation only, and explicitly not a second execution.
  assert.match(request.prompt, /Do not run these commands again/);
  assert.match(request.prompt, /Work read-only\. Do not modify files\./);

  // The removed contract must not come back through the prompt by another route.
  assert.doesNotMatch(request.prompt, /<focused-test-evidence>/);
  assert.doesNotMatch(request.prompt, /npm\.cmd/);
  assert.equal(request.contextManifest.repositoryAccess, "read-only");
  assert.match(request.contextManifest.policy, /Verification was executed by the harness/);
});

test("persists structured focused test evidence beside the Markdown artifact", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-focused-test-"));
  try {
    const store = new JsonTaskStore(path.join(directory, "tasks.json"));
    await store.init();
    const task = await store.create({
      title: "Focused test evidence",
      description: "Persist structured rows.",
      repositoryPath: directory,
      workflow: "implement",
      priority: "medium",
    });
    await store.update(task.id, (draft) => {
      draft.status = "ready-for-test";
      draft.currentStage = "test";
      draft.candidates = [
        {
          id: "C1",
          revisionNumber: 2,
          baseRevision: "a".repeat(40),
          baseBranch: "main",
          headRevision: "b".repeat(40),
          branch: "agent-harness/c1",
          repositoryRoot: directory,
          worktreePath: directory,
          status: "ready_for_test",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          revisions: [],
        },
      ];
      draft.artifacts.push({
        id: "artifact-1",
        stage: "test",
        name: "test-c1-r2.md",
        kind: "markdown",
        content: TEST_OUTPUT,
        createdAt: new Date().toISOString(),
        model: "GPT-5.4-mini",
        usage: { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1, totalTokens: 2 },
        candidateId: "C1",
        candidateRevision: 2,
        focusedTest: parseFocusedTestEvidence(TEST_OUTPUT),
      });
    });
    const reloaded = new JsonTaskStore(path.join(directory, "tasks.json"));
    await reloaded.init();
    const saved = await reloaded.get(task.id);
    assert.equal(saved.artifacts[0].kind, "markdown");
    assert.equal(saved.artifacts[0].focusedTest.rows.length, 2);
    assert.equal(saved.artifacts[0].focusedTest.rows[1].candidateRevision, 2);
    assert.equal(saved.artifacts[0].focusedTest.rows[0].candidateId, "C1");
    assert.equal(saved.artifacts[0].focusedTest.command, "npm.cmd run test:orchestrator");
  } finally {
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test("fails a slice closed when harness-executed package verification fails", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-package-verification-"));
  try {
    const store = new JsonTaskStore(path.join(directory, "tasks.json"));
    await store.init();
    const task = await store.create({
      title: "Fail slice qualification",
      description: "A package must not integrate after a failed repository command.",
      repositoryPath: directory,
      workflow: "implement",
      priority: "medium",
    });
    await store.update(task.id, (draft) => {
      draft.status = "ready-for-implementation";
      draft.currentStage = "implement";
      draft.workPackages = parseWorkPackages(
        `<work-packages>{"packages":[{"id":"S1","title":"Runtime","description":"Implement runtime behavior.","dependencies":[],"ownedPaths":["server/runtime.mjs"],"verificationCommandIds":["test"]}]}</work-packages>`,
      );
    });
    let commitCalls = 0;
    let assembleCalls = 0;
    const orchestrator = new TaskOrchestrator(store, {
      worktreeManager: {
        base: async () => ({ repositoryRoot: directory, baseRevision: "a".repeat(40), baseBranch: "main" }),
        prepare: async (_task, id) => ({
          id,
          revisionNumber: 1,
          baseRevision: "a".repeat(40),
          baseBranch: "main",
          headRevision: null,
          branch: `agent-harness/${id.toLowerCase()}`,
          repositoryRoot: directory,
          worktreePath: path.join(directory, id),
          status: "implementing",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          revisions: [],
        }),
        commit: async () => {
          commitCalls += 1;
          return {
            headRevision: "b".repeat(40),
            files: ["server/runtime.mjs"],
            summary: "1 file changed",
            diff: "+change",
            ownSummary: "1 file changed",
            ownDiff: "+change",
          };
        },
        assemble: async () => {
          assembleCalls += 1;
          throw new Error("assembly must not run");
        },
      },
      runCodex: async () => ({
        finalText: "## Outcome\n\nImplemented.\n\n## Changes\n\nChanged runtime.\n\n## Verification\n\nPASS\n\n## Ownership exceptions\n\nNone.\n\n## Remaining risks\n\nNone.",
        usage: { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1, totalTokens: 2 },
      }),
      runPackageVerification: async ({ workPackageId, attempt }) => ({
        headRevision: "b".repeat(40),
        candidateId: workPackageId,
        candidateRevision: attempt,
        bindingExplicit: true,
        command: ".agent-harness/verification.json: test",
        status: "failed",
        startedAt: "2026-08-08T00:00:00.000Z",
        completedAt: "2026-08-08T00:00:01.000Z",
        durationMs: 1_000,
        rows: [{
          id: "test",
          candidateId: workPackageId,
          candidateRevision: attempt,
          bindingExplicit: true,
          title: "Tests",
          command: "npm test",
          status: "failed",
          durationMs: 1_000,
          artifactReferences: [],
          assertions: [{ label: "exit code", actual: "1", expected: "0" }],
          failureDetails: "npm test exited 1.",
        }],
        executedCommandIds: ["test"],
        declaredCommandIds: ["test"],
      }),
    });

    assert.equal(await orchestrator.start(task.id, "implementation"), true);
    const finished = await waitForStatus(store, task.id, "failed");
    assert.equal(commitCalls, 1, "focused checks bind to the exact committed package revision");
    assert.equal(assembleCalls, 0);
    assert.equal(finished.workPackages[0].status, "failed");
    assert.match(finished.workPackages[0].error, /S1 did not qualify: test failed/);
    assert.deepEqual(finished.candidates, []);
    const artifact = finished.artifacts.find((item) => item.workPackageId === "S1");
    assert.equal(artifact.focusedTest.status, "failed");
    assert.match(artifact.content, /Harness slice qualification/);
    assert.match(artifact.content, /npm test exited 1/);
  } finally {
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test("bounds parallel package agents and serializes heavy package qualification", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-parallel-"));
  try {
    const store = new JsonTaskStore(path.join(directory, "tasks.json"));
    await store.init();
    const task = await store.create({
      title: "Parallel implementation",
      description: "Run independent slices concurrently.",
      repositoryPath: directory,
      workflow: "implement",
      priority: "medium",
    });
    await store.update(task.id, (draft) => {
      draft.status = "ready-for-implementation";
      draft.currentStage = "implement";
      draft.workPackages = parseWorkPackages(
        `<work-packages>{"packages":[
          {"id":"S1","title":"One","description":"First slice.","dependencies":[],"ownedPaths":["one.ts"],"verificationCommandIds":["test"]},
          {"id":"S2","title":"Two","description":"Second slice.","dependencies":[],"ownedPaths":["two.ts"],"verificationCommandIds":["test"]},
          {"id":"S3","title":"Three","description":"Third slice.","dependencies":[],"ownedPaths":["three.ts"],"verificationCommandIds":["test"]},
          {"id":"S4","title":"Four","description":"Fourth slice.","dependencies":[],"ownedPaths":["four.ts"],"verificationCommandIds":["test"]}
        ]}</work-packages>`,
      );
    });
    let activeAgents = 0;
    let maximumActiveAgents = 0;
    let activeQualifications = 0;
    let maximumActiveQualifications = 0;
    const releases = [];
    const orchestrator = new TaskOrchestrator(store, {
      worktreeManager: {
        base: async () => ({ repositoryRoot: directory, baseRevision: "a".repeat(40), baseBranch: "main" }),
        prepare: async (_task, id) => ({
          id,
          revisionNumber: 1,
          baseRevision: "a".repeat(40),
          baseBranch: "main",
          headRevision: null,
          branch: `agent-harness/${id.toLowerCase()}`,
          repositoryRoot: directory,
          worktreePath: path.join(directory, id),
          status: "implementing",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          revisions: [],
        }),
        commit: async (slice) => ({
          headRevision: ({ S1: "b", S2: "c", S3: "d", S4: "e" }[slice.id.slice(0, 2)]).repeat(40),
          files: [`${slice.id}.txt`],
          summary: "1 file changed",
          diff: "+change",
          ownSummary: "1 file changed",
          ownDiff: "+change",
        }),
        assemble: async () => ({
          headRevision: "f".repeat(40),
          files: ["S1.txt", "S2.txt", "S3.txt", "S4.txt"],
          summary: "4 files changed",
          diff: "+changes",
        }),
      },
      runCodex: async () => {
        activeAgents += 1;
        maximumActiveAgents = Math.max(maximumActiveAgents, activeAgents);
        await new Promise((resolve) => {
          const fallback = setTimeout(resolve, 100);
          releases.push(() => {
            clearTimeout(fallback);
            resolve();
          });
          if (activeAgents === 2) releases.splice(0).forEach((release) => release());
        });
        activeAgents -= 1;
        return {
          finalText: "## Outcome\n\nReady",
          usage: { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1, totalTokens: 2 },
        };
      },
      packageConcurrency: 2,
      runPackageVerification: async ({ workPackageId, attempt }) => {
        activeQualifications += 1;
        maximumActiveQualifications = Math.max(maximumActiveQualifications, activeQualifications);
        await new Promise((resolve) => setTimeout(resolve, 10));
        activeQualifications -= 1;
        return makeFocusedTestSummary({ candidateId: workPackageId, candidateRevision: attempt });
      },
    });

    assert.equal(await orchestrator.start(task.id, "implementation"), true);
    const finished = await waitForStatus(store, task.id, "ready-for-review");
    assert.equal(maximumActiveAgents, 2);
    assert.equal(maximumActiveQualifications, 1);
    assert.deepEqual(finished.candidates[0].members.map((member) => member.packageId), ["S1", "S2", "S3", "S4"]);
  } finally {
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test("accepts a work package's declared no-op instead of failing on an empty diff", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-noop-package-"));
  try {
    const store = new JsonTaskStore(path.join(directory, "tasks.json"));
    await store.init();
    const task = await store.create({
      title: "Single no-op package",
      description: "Verification already passes; nothing should need to change.",
      repositoryPath: directory,
      workflow: "implement",
      priority: "medium",
    });
    await store.update(task.id, (draft) => {
      draft.status = "ready-for-implementation";
      draft.currentStage = "implement";
      draft.workPackages = parseWorkPackages(
        `<work-packages>{"packages":[{"id":"S1","title":"Keep ignored","description":"Verify only.","dependencies":[],"ownedPaths":["e2e/.gitignore"],"verificationCommandIds":["test"]}]}</work-packages>`,
      );
    });
    let sawAllowNoChanges = false;
    const orchestrator = new TaskOrchestrator(store, {
      worktreeManager: {
        base: async () => ({ repositoryRoot: directory, baseRevision: "a".repeat(40), baseBranch: "main" }),
        prepare: async (_task, id) => ({
          id,
          revisionNumber: 1,
          baseRevision: "a".repeat(40),
          baseBranch: "main",
          headRevision: null,
          branch: `agent-harness/${id.toLowerCase()}`,
          repositoryRoot: directory,
          worktreePath: path.join(directory, id),
          status: "implementing",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          revisions: [],
        }),
        // Mirrors `GitWorktreeManager.commit`'s real `allowNoChanges` contract: only
        // returns the no-op shape when the orchestrator explicitly asked for it, which
        // it must only do after reading the agent's `<no-changes-needed>` marker.
        commit: async (_slice, _message, options) => {
          sawAllowNoChanges = options?.allowNoChanges === true;
          if (!options?.allowNoChanges) throw new Error("The implementation agent completed without changing any files.");
          return { headRevision: null, parentRevision: null, files: [], summary: "", diff: "", ownSummary: "", ownDiff: "", noChangesNeeded: true };
        },
        assemble: async () => ({ headRevision: "a".repeat(40), files: [], summary: "", diff: "" }),
      },
      runCodex: async () => ({
        finalText: '## Outcome\n\nAlready ignored; nothing to change.\n\n<no-changes-needed>{"reason":"git check-ignore -v already exits 0 for playwright-report/results.json"}</no-changes-needed>',
        usage: { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1, totalTokens: 2 },
      }),
    });

    assert.equal(await orchestrator.start(task.id, "implementation"), true);
    const finished = await waitForStatus(store, task.id, "ready-for-review");
    assert.equal(sawAllowNoChanges, true);
    // "integrated": assembly already folded it in by the time the task reaches
    // ready-for-review, same terminal status a real committed package ends at.
    assert.equal(finished.workPackages[0].status, "integrated");
    assert.equal(finished.workPackages[0].headRevision, null);
    assert.deepEqual(finished.workPackages[0].files, []);
    assert.ok(finished.events.some((event) => /No changes needed/.test(event.detail ?? "")));
  } finally {
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test("cleans up a superseded work-package worktree before retrying and after a successful commit", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-worktree-cleanup-"));
  try {
    const store = new JsonTaskStore(path.join(directory, "tasks.json"));
    await store.init();
    const task = await store.create({
      title: "Fails once, then succeeds",
      description: "Exercises worktree cleanup across a retry and a successful commit.",
      repositoryPath: directory,
      workflow: "implement",
      priority: "medium",
    });
    await store.update(task.id, (draft) => {
      draft.status = "ready-for-implementation";
      draft.currentStage = "implement";
      draft.workPackages = parseWorkPackages(
        `<work-packages>{"packages":[{"id":"S1","title":"Runtime","description":"Implement runtime behavior.","dependencies":[],"ownedPaths":["server/runtime.mjs"],"verificationCommandIds":["test"]}]}</work-packages>`,
      );
    });
    let commitCalls = 0;
    const removedPaths = [];
    const orchestrator = new TaskOrchestrator(store, {
      worktreeManager: {
        base: async () => ({ repositoryRoot: directory, baseRevision: "a".repeat(40), baseBranch: "main" }),
        prepare: async (_task, id) => ({
          id,
          revisionNumber: 1,
          baseRevision: "a".repeat(40),
          baseBranch: "main",
          headRevision: null,
          branch: `agent-harness/${id.toLowerCase()}`,
          repositoryRoot: directory,
          worktreePath: path.join(directory, id),
          status: "implementing",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          revisions: [],
        }),
        commit: async () => {
          commitCalls += 1;
          if (commitCalls === 1) throw new Error("boom");
          return {
            headRevision: "b".repeat(40),
            files: ["server/runtime.mjs"],
            summary: "1 file changed",
            diff: "+change",
            ownSummary: "1 file changed",
            ownDiff: "+change",
          };
        },
        removeWorktree: async ({ worktreePath }) => {
          removedPaths.push(worktreePath);
        },
        assemble: async () => ({ headRevision: "c".repeat(40), files: ["server/runtime.mjs"], summary: "1 file changed", diff: "+change" }),
      },
      runCodex: async () => ({
        finalText: "## Outcome\n\nDone",
        usage: { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1, totalTokens: 2 },
      }),
    });

    assert.equal(await orchestrator.start(task.id, "implementation"), true);
    await waitForStatus(store, task.id, "failed");
    // The failed attempt's worktree survives its own failure, for inspection — it is
    // only reaped once superseded by the next retry.
    assert.deepEqual(removedPaths, []);

    assert.equal(await orchestrator.start(task.id, "implementation"), true);
    const finished = await waitForStatus(store, task.id, "ready-for-review");
    assert.deepEqual(removedPaths, [path.join(directory, "S1-A1"), path.join(directory, "S1-A2")]);
    assert.equal(finished.workPackages[0].status, "integrated");
  } finally {
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test("does not flag a work package's own successful edit as a change to the source repository", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-source-snapshot-"));
  const repository = path.join(directory, "repository");
  const worktreeRootDirectory = path.join(directory, "worktrees");
  const previousRoot = process.env.AGENT_HARNESS_WORKTREE_ROOT;
  process.env.AGENT_HARNESS_WORKTREE_ROOT = worktreeRootDirectory;
  try {
    await git(directory, ["init", "repository"]);
    await git(repository, ["config", "user.name", "Agent Harness Test"]);
    await git(repository, ["config", "user.email", "agent-harness@example.test"]);
    await writeFile(path.join(repository, "README.md"), "base\n", "utf8");
    await git(repository, ["add", "README.md"]);
    await git(repository, ["commit", "-m", "base"]);

    const store = new JsonTaskStore(path.join(directory, "tasks.json"));
    await store.init();
    const task = await store.create({
      title: "Edit a file inside its own isolated slice",
      description: "The slice worktree is supposed to end up dirty; that is the run succeeding.",
      repositoryPath: repository,
      workflow: "implement",
      priority: "medium",
    });
    await store.update(task.id, (draft) => {
      draft.status = "ready-for-implementation";
      draft.currentStage = "implement";
      draft.workPackages = parseWorkPackages(
        `<work-packages>{"packages":[{"id":"S1","title":"Add a file","description":"Add feature.txt.","dependencies":[],"ownedPaths":["feature.txt"],"verificationCommandIds":["test"]}]}</work-packages>`,
      );
    });
    // No `worktreeManager` override: this exercises the real `GitWorktreeManager`, whose
    // `snapshotRepository`/`assertRepositoryUnchanged` are what the bug lived in. A fake
    // worktree manager (used by the other work-package tests here) never implements
    // those two methods, which is exactly why this interaction had no coverage before.
    const orchestrator = new TaskOrchestrator(store, {
      runCodex: async ({ cwd }) => {
        await writeFile(path.join(cwd, "feature.txt"), "added by the agent\n", "utf8");
        return {
          finalText: "## Outcome\n\nAdded feature.txt.\n\n## Changes\n\nfeature.txt\n\n## Verification\n\nNone.\n\n## Ownership exceptions\n\nNone.\n\n## Remaining risks\n\nNone.",
          usage: { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1, totalTokens: 2 },
        };
      },
    });

    assert.equal(await orchestrator.start(task.id, "implementation"), true);
    const finished = await waitForStatus(store, task.id, "ready-for-review");
    assert.equal(finished.workPackages[0].status, "integrated");
    assert.deepEqual(finished.workPackages[0].files, ["feature.txt"]);
  } finally {
    if (previousRoot === undefined) delete process.env.AGENT_HARNESS_WORKTREE_ROOT;
    else process.env.AGENT_HARNESS_WORKTREE_ROOT = previousRoot;
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test("excludes only runtime-scoped context preflight from candidate test telemetry", () => {
  assert.equal(
    evaluationVerdict("test", {
      finalText: "PASS\n\n## Verdict\n\nPASS",
      runtimeEvents: [
        { commandFailed: true, runtimeScope: "context-preflight", detail: "rg MEMORY.md" },
        { commandFailed: false, detail: "/bin/zsh -lc 'git rev-parse HEAD'" },
        { commandFailed: false, detail: "/bin/zsh -lc 'npm test'" },
      ],
    }, { status: "passed" }),
    "PASS",
  );
  assert.equal(
    evaluationVerdict("test", {
      finalText: "PASS\n\n## Verdict\n\nPASS",
      runtimeEvents: [
        { commandFailed: true, detail: "/bin/zsh -lc 'npm test'" },
        { commandFailed: false, detail: "/bin/zsh -lc 'git rev-parse HEAD'" },
      ],
    }, { status: "passed" }),
    "REPAIR",
  );
  assert.equal(
    evaluationVerdict("test", {
      finalText: "PASS\n\n## Verdict\n\nPASS",
      runtimeEvents: [{ commandFailed: true, detail: "rg /Users/shaun/.codex/memories/MEMORY.md" }],
    }, { status: "passed" }),
    "REPAIR",
  );
  assert.equal(evaluationVerdict("dev-review", { finalText: "PASS", runtimeEvents: [] }, null, { verdict: "PASS" }), "PASS");
  assert.equal(
    evaluationVerdict("dev-review", {
      finalText: "PASS",
      runtimeEvents: [{ commandFailed: true, runtimeScope: "candidate", detail: "python -m pytest" }],
    }, null, { verdict: "PASS" }),
    "REPAIR",
  );
  assert.equal(
    evaluationVerdict("final-review", {
      finalText: "PASS",
      runtimeEvents: [{ commandFailed: true, runtimeScope: "candidate", detail: "git diff --check" }],
    }, null, { verdict: "PASS" }),
    "REPAIR",
  );
  assert.equal(evaluationVerdict("dev-review", { finalText: "PASS", runtimeEvents: [] }), "REPAIR");
});

test("migration regresses an advanced gate when retained candidate command telemetry failed", () => {
  const run = makeRuntimeRun();
  run.toolCalls = [{
    id: "cmd-failed",
    name: "command_execution",
    category: "repository-command",
    phase: "completed",
    result: "Exit code 1",
  }];
  const task = makeRuntimeTask({ runs: [run] });
  task.status = "ready-for-test";
  task.currentStage = "test";
  task.activeRunKind = null;
  task.activeRunReservationId = null;
  task.activeRunIds = [];
  task.candidates[0].status = "ready_for_test";
  const state = { schemaVersion: TASK_STORE_SCHEMA_VERSION, tasks: [task] };

  assert.equal(migrateRunActivityState(state), true);
  assert.equal(task.gateFreshness["dev-review"].reasonCode, "command_failure");
  assert.equal(task.status, "ready-for-review");
  assert.equal(task.currentStage, "dev-review");
  assert.equal(task.candidates[0].status, "ready_for_review");
  assert.equal(task.events.at(-1).title, "Persisted gate evidence invalidated");
  assert.equal(task.runs[0].gateResult.verdict, "PASS", "historical narrative evidence remains retained");
  assert.equal(task.runs[0].toolCalls[0].result, "Exit code 1", "failed telemetry remains retained");
  assert.equal(migrateRunActivityState(state), false, "reconciliation is idempotent once persisted");
});

test("migration recovers a failed Focused Test stranded at ready-for-test", () => {
  const devRun = makeRuntimeRun({ id: "RUN-DEV-FAILED-TEST-RECOVERY", artifactId: "ART-DEV-FAILED-TEST-RECOVERY" });
  const devArtifact = makeArtifact({ id: "ART-DEV-FAILED-TEST-RECOVERY", gateResult: devRun.gateResult });
  const failedFocusedTest = makeFocusedTestSummary({
    status: "failed",
    rows: [makeTestRow({ id: "frontend-test", status: "failed" })],
  });
  const testGateResult = makeGateResult({
    stage: "test",
    verdict: "REPAIR",
    reportedVerdict: null,
    blockingReasons: ["A candidate-scope command failed.", "Structured test evidence contains a failed result."],
  });
  const testRun = makeRuntimeRun({
    id: "RUN-FAILED-TEST-RECOVERY",
    stage: "test",
    kind: "test",
    artifactId: "ART-FAILED-TEST-RECOVERY",
    gateResult: testGateResult,
    evidenceError: { code: "command_failure", copy: RUNTIME_FRESHNESS_REASONS.command_failure },
  });
  testRun.toolCalls = [{
    id: "cmd-interpreter-failed",
    name: "command_execution",
    category: "repository-command",
    phase: "completed",
    result: "Exit code 1",
    commandFailed: true,
    runtimeScope: "candidate",
  }];
  const testArtifact = makeArtifact({
    id: "ART-FAILED-TEST-RECOVERY",
    stage: "test",
    gateResult: testGateResult,
    focusedTest: failedFocusedTest,
  });
  testArtifact.evidenceError = { code: "command_failure", copy: RUNTIME_FRESHNESS_REASONS.command_failure };
  const task = makeRuntimeTask({
    runs: [devRun, testRun],
    artifacts: [devArtifact, testArtifact],
  });
  attachRunArtifact(task, devRun.id, devArtifact);
  attachRunArtifact(task, testRun.id, testArtifact);
  task.status = "ready-for-test";
  task.currentStage = "test";
  task.activeRunKind = null;
  task.activeRunReservationId = null;
  task.activeRunIds = [];
  task.candidates[0].status = "ready_for_test";
  const state = { schemaVersion: TASK_STORE_SCHEMA_VERSION, tasks: [task] };

  assert.equal(migrateRunActivityState(state), true);
  assert.equal(task.gateFreshness["dev-review"].fresh, true);
  assert.equal(task.gateFreshness.test.reasonCode, "repair_required");
  assert.equal(task.gateFreshness.test.focusedTest.status, "failed");
  assert.equal(task.status, "repair-required");
  assert.equal(task.currentStage, "test");
  assert.equal(task.candidates[0].status, "repair_required");
  assert.equal(task.events.at(-1).title, "Persisted gate evidence invalidated");
  assert.equal(migrateRunActivityState(state), false, "recovery is idempotent once repair-required");
});

test("runs the investigation frontier and retains each stage handoff", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-orchestrator-"));
  try {
    const store = new JsonTaskStore(path.join(directory, "tasks.json"));
    await store.init();
    const task = await store.create({
      title: "Map a repository",
      description: "Produce a grounded investigation handoff.",
      repositoryPath: directory,
      workflow: "investigate",
      priority: "medium",
    });
    const orchestrator = new TaskOrchestrator(store, {
      getStatus: async () => ({ available: true, authenticated: true, authMethod: "ChatGPT" }),
      runCodex: async ({ prompt, onEvent }) => {
        onEvent({ type: "activity", tone: "success", title: "Repository inspected", detail: "mock" });
        return {
          finalText: /<scout-report>/.test(prompt)
            ? SCOUT_OUTPUT
            : /<grill-questions>/.test(prompt)
              ? GRILL_OUTPUT
              : `## Artifact\n\n${prompt.match(/Your stage assignment:\n([^\n]+)/)?.[1] ?? "Ready"}`,
          usage: { inputTokens: 10, cachedInputTokens: 4, outputTokens: 5, totalTokens: 15 },
        };
      },
    });

    assert.equal(await orchestrator.start(task.id), true);
    let finished = null;
    for (let attempt = 0; attempt < 50; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
      finished = await store.get(task.id);
      if (finished.status !== "running" && finished.status !== "queued") break;
    }

    assert.equal(finished.status, "awaiting-grill", finished.error);
    assert.equal(finished.grillPolicy, "manual");
    assert.deepEqual(finished.completedStages, ["triage", "scouts"]);
    assert.equal(finished.artifacts.length, 5);
    assert.equal(finished.grillSession.questions.length, 1);
    await assert.rejects(
      orchestrator.finishGrill(task.id, { acceptRemaining: true }),
      /explicit operator action/,
    );
    await orchestrator.answerGrillQuestion(task.id, { questionId: "Q1", answer: "Preserve it", source: "operator" });
    await orchestrator.finishGrill(task.id, { source: "operator" });
    finished = await waitForStatus(store, task.id, "awaiting-spec-approval");
    assert.equal(finished.grillSession.questions[0].answerSource, "operator-answer");
    assert.equal(finished.grillSession.completionSource, "operator");
    assert.deepEqual(finished.completedStages, ["triage", "scouts", "grill", "specification"]);
    assert.equal(finished.artifacts.length, 6);
    assert.equal(finished.usage.totalTokens, 75);
    for (const stage of ["triage", "scouts", "grill", "specification"]) {
      assert.equal(finished.attemptsByStage[stage], 1, `${stage} consumes exactly one workflow attempt`);
      const reservation = finished.stageRunReservations[stage];
      assert.equal(reservation.stage, stage);
      assert.equal(reservation.workflowAttempt, 1);
      for (const run of finished.runs.filter((entry) => entry.stage === stage)) {
        assert.equal(run.workflowAttempt, 1, `${stage} run retains its workflow attempt`);
        assert.equal(run.workflowReservationId, reservation.id, `${stage} run retains its own reservation`);
      }
    }
    const dispatchedScoutNames = finished.scoutDispatch.selected.map((scout) => scout.name).sort();
    assert.deepEqual(finished.stageRunReservations.scouts.authorizedRunScopes.toSorted(), dispatchedScoutNames);
    const scoutRuns = finished.runs.filter((run) => run.stage === "scouts");
    assert.deepEqual(scoutRuns.map((run) => run.role).sort(), dispatchedScoutNames);
    assert.equal(scoutRuns.every((run) => run.kind === "scout" && run.attempt === 1), true);
  } finally {
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test("automatically accepts Grill recommendations only for a task that snapshotted the opt-in policy", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-auto-grill-"));
  try {
    const store = new JsonTaskStore(path.join(directory, "tasks.json"));
    await store.init();
    await store.updateSettings((draft) => {
      draft.grillPolicy = "auto-accept-recommendations";
    });
    const task = await store.create({
      title: "Opt-in automatic Grill",
      description: "Accept recommendations only because this task snapshots the setting.",
      repositoryPath: directory,
      workflow: "investigate",
      priority: "medium",
    });
    await store.updateSettings((draft) => {
      draft.grillPolicy = "manual";
    });
    assert.equal((await store.get(task.id)).grillPolicy, "auto-accept-recommendations");

    const orchestrator = new TaskOrchestrator(store, {
      getStatus: async () => ({ available: true, authenticated: true, authMethod: "ChatGPT" }),
      runCodex: async ({ prompt, onEvent }) => {
        onEvent?.({ type: "activity", tone: "success", title: "Repository inspected", detail: "mock" });
        return {
          finalText: /<scout-report>/.test(prompt)
            ? SCOUT_OUTPUT
            : /<grill-questions>/.test(prompt)
              ? GRILL_OUTPUT
              : "## Specification\n\nRecommendations were accepted under the task policy.",
          usage: { inputTokens: 10, cachedInputTokens: 4, outputTokens: 5, totalTokens: 15 },
        };
      },
    });

    assert.equal(await orchestrator.start(task.id), true);
    const finished = await waitForStatus(store, task.id, "awaiting-spec-approval");
    assert.equal(finished.grillSession.status, "completed");
    assert.equal(finished.grillSession.policySnapshot, "auto-accept-recommendations");
    assert.equal(finished.grillSession.completionSource, "automation-policy");
    assert.equal(finished.grillSession.acceptedRecommendationCount, 1);
    assert.equal(finished.grillSession.questions[0].answerSource, "automation-policy");
    assert.equal(finished.grillSession.questions[0].answer, "Preserve it");
    assert.match(finished.grillSession.completionReason, /Automatically accepted 1 recommended assumption/);
    assert.equal(finished.events.some((event) => event.title === "Grill recommendations accepted automatically"), true);
  } finally {
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test("lets an operator manually accept every remaining Grill recommendation", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-manual-grill-"));
  try {
    const store = new JsonTaskStore(path.join(directory, "tasks.json"));
    await store.init();
    const task = await store.create({
      title: "Manual Grill acceptance",
      description: "Retain the bulk operator action without making it automatic.",
      repositoryPath: directory,
      workflow: "investigate",
      priority: "medium",
    });
    await store.update(task.id, (draft) => {
      draft.status = "awaiting-grill";
      draft.currentStage = "grill";
      draft.completedStages = ["triage", "scouts"];
      draft.grillSession = {
        status: "open",
        questions: parseGrillQuestions(GRILL_OUTPUT),
        createdAt: "2026-08-01T12:00:00.000Z",
        completedAt: null,
        completionReason: null,
        completionSource: null,
        policySnapshot: "manual",
        acceptedRecommendationCount: 0,
      };
    });
    const orchestrator = new TaskOrchestrator(store, {
      getStatus: async () => ({ available: true, authenticated: true, authMethod: "ChatGPT" }),
      runCodex: async () => ({
        finalText: "## Specification\n\nThe operator accepted the remaining recommendation.",
        usage: { inputTokens: 10, cachedInputTokens: 4, outputTokens: 5, totalTokens: 15 },
      }),
    });

    await orchestrator.finishGrill(task.id, { acceptRemaining: true, source: "operator" });
    const finished = await waitForStatus(store, task.id, "awaiting-spec-approval");
    assert.equal(finished.grillSession.questions[0].answerSource, "operator-accepted-recommendation");
    assert.equal(finished.grillSession.completionSource, "operator");
    assert.equal(finished.grillSession.acceptedRecommendationCount, 1);
    assert.match(finished.grillSession.completionReason, /Finished by the operator/);
  } finally {
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test("honours an explicit empty triage scout dispatch without fallback", () => {
  const selection = selectScoutDispatch(
    { title: "Small known change", description: "The exact file is already identified.", priority: "high" },
    `<scout-dispatch>{"scouts":[],"rationale":"The triage evidence already identifies the complete code path."}</scout-dispatch>`,
  );
  assert.deepEqual(selection.selected, []);
  assert.equal(selection.rationale, "The triage evidence already identifies the complete code path.");
});

test("auto-advances a zero-question Grill session into specification", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-zero-grill-"));
  try {
    const store = new JsonTaskStore(path.join(directory, "tasks.json"));
    await store.init();
    const task = await store.create({
      title: "Known bounded change",
      description: "No unresolved product decision remains.",
      repositoryPath: directory,
      workflow: "implement",
      priority: "low",
    });
    let scoutCalls = 0;
    const orchestrator = new TaskOrchestrator(store, {
      getStatus: async () => ({ available: true, authenticated: true, authMethod: "ChatGPT" }),
      runCodex: async ({ prompt }) => {
        if (/<scout-report>/.test(prompt)) {
          scoutCalls += 1;
          throw new Error("An explicit empty dispatch must not launch a fallback scout.");
        }
        const finalText = /Your stage assignment:\nClassify the task/.test(prompt)
          ? `<scout-dispatch>{"scouts":[],"rationale":"No additional scout evidence is needed."}</scout-dispatch>`
          : /Your stage assignment:\nSeparate repository facts/.test(prompt)
            ? `<grill-questions>{"questions":[]}</grill-questions>`
            : "## Specification\n\nThe bounded change is ready for approval.";
        return {
          finalText,
          usage: { inputTokens: 10, cachedInputTokens: 5, outputTokens: 5, totalTokens: 15 },
        };
      },
    });

    assert.equal(await orchestrator.start(task.id), true);
    const finished = await waitForStatus(store, task.id, "awaiting-spec-approval");
    assert.equal(scoutCalls, 0);
    assert.deepEqual(finished.scoutDispatch.selected, []);
    assert.equal(finished.scoutDispatch.skipped.length, 6);
    assert.equal(finished.scoutDispatch.rationale, "No additional scout evidence is needed.");
    assert.equal(finished.grillSession.status, "completed");
    assert.equal(finished.grillSession.questions.length, 0);
    assert.deepEqual(finished.completedStages, ["triage", "scouts", "grill", "specification"]);
    assert.equal(finished.events.some((event) => event.title === "Grill Me completed automatically"), true);
    for (const stage of ["triage", "scouts", "grill", "specification"]) {
      assert.equal(finished.attemptsByStage[stage], 1, `${stage} consumes exactly one workflow attempt`);
      const reservation = finished.stageRunReservations[stage];
      assert.equal(reservation.stage, stage);
      assert.equal(reservation.kind, "investigation");
      assert.equal(reservation.workflowAttempt, 1);
      for (const run of finished.runs.filter((entry) => entry.stage === stage)) {
        assert.equal(run.workflowAttempt, 1);
        assert.equal(run.workflowReservationId, reservation.id);
      }
    }
  } finally {
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test("specification retry succeeds through the read-only specification path", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-specification-retry-"));
  try {
    const store = new JsonTaskStore(path.join(directory, "tasks.json"));
    await store.init();
    const task = await store.create({
      title: "Retry failed specification",
      description: "Recover the specification handoff after a failed synthesis.",
      repositoryPath: directory,
      workflow: "implement",
      priority: "medium",
    });
    await store.update(task.id, (draft) => {
      draft.status = "failed";
      draft.currentStage = "specification";
      draft.completedStages = ["triage", "scouts", "grill"];
      draft.attemptsByStage.specification = 1;
      draft.error = "The prior specification synthesis failed.";
    });
    let request;
    const orchestrator = new TaskOrchestrator(store, {
      getStatus: async () => ({ available: true, authenticated: true, authMethod: "ChatGPT" }),
      runCodex: async (options) => {
        request = options;
        return {
          finalText: "## Specification\n\nThe retry produced a grounded handoff.",
          usage: { inputTokens: 10, cachedInputTokens: 4, outputTokens: 5, totalTokens: 15 },
        };
      },
    });

    assert.equal(await orchestrator.start(task.id, "specification"), true);
    const finished = await waitForStatus(store, task.id, "awaiting-spec-approval");
    assert.equal(request.sandbox, "read-only");
    assert.equal(request.networkAccess, false);
    assert.equal(finished.currentStage, "specification");
    assert.equal(finished.attemptsByStage.specification, 2);
    assert.equal(finished.stageRunReservations.specification.kind, "specification");
    assert.equal(finished.runs.at(-1).role, "specification");
    assert.equal(finished.artifacts.at(-1).stage, "specification");
    assert.deepEqual(finished.completedStages, ["triage", "scouts", "grill", "specification"]);
  } finally {
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test("specification retry cancellation does not advance beyond specification", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-specification-cancel-"));
  try {
    const store = new JsonTaskStore(path.join(directory, "tasks.json"));
    await store.init();
    const task = await store.create({
      title: "Cancel specification retry",
      description: "Cancellation must preserve the failed specification boundary.",
      repositoryPath: directory,
      workflow: "implement",
      priority: "medium",
    });
    await store.update(task.id, (draft) => {
      draft.status = "cancelled";
      draft.currentStage = "specification";
      draft.completedStages = ["triage", "scouts", "grill"];
      draft.attemptsByStage.specification = 1;
    });
    let request;
    const orchestrator = new TaskOrchestrator(store, {
      runCodex: ({ signal, ...options }) => {
        request = { signal, ...options };
        return new Promise((_, reject) => {
          signal.addEventListener("abort", () => reject(new Error("Codex run cancelled.")), { once: true });
        });
      },
    });

    assert.equal(await orchestrator.start(task.id, "specification"), true);
    for (let attempt = 0; !request && attempt < 100; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(typeof request?.signal?.aborted, "boolean");
    assert.equal(await orchestrator.cancel(task.id), true);
    const cancelled = await waitForStatus(store, task.id, "cancelled");
    assert.equal(cancelled.currentStage, "specification");
    assert.deepEqual(cancelled.completedStages, ["triage", "scouts", "grill"]);
    assert.equal(cancelled.attemptsByStage.specification, 2);
    assert.equal(cancelled.activeRunKind, null);
    assert.equal(cancelled.runs.at(-1).status, "cancelled");
  } finally {
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test("specification retry rejects blocked, exhausted, and wrong-stage states", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-specification-boundary-"));
  try {
    const store = new JsonTaskStore(path.join(directory, "tasks.json"));
    await store.init();
    const task = await store.create({
      title: "Guard specification retry",
      description: "Keep specification retry eligibility explicit.",
      repositoryPath: directory,
      workflow: "implement",
      priority: "medium",
    });
    const orchestrator = new TaskOrchestrator(store, { runCodex: async () => { throw new Error("must not run"); } });
    for (const item of [
      { status: "blocked", currentStage: "specification", attempts: 1 },
      { status: "failed", currentStage: "specification", attempts: 3 },
      { status: "failed", currentStage: "plan", attempts: 0 },
    ]) {
      await store.update(task.id, (draft) => {
        draft.status = item.status;
        draft.currentStage = item.currentStage;
        draft.attemptsByStage.specification = item.attempts;
      });
      assert.equal(await orchestrator.start(task.id, "specification"), false, `${item.status}:${item.currentStage}`);
    }
  } finally {
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test("counts each failed investigation stage against its own retry allowance", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-investigation-budget-"));
  try {
    const store = new JsonTaskStore(path.join(directory, "tasks.json"));
    await store.init();
    const task = await store.create({
      title: "Count scout failures",
      description: "A failing scout stage must not reuse the successful triage reservation.",
      repositoryPath: directory,
      workflow: "investigate",
      priority: "low",
    });
    await store.update(task.id, (draft) => {
      draft.stageRunLimits.scouts = 2;
    });
    const orchestrator = new TaskOrchestrator(store, {
      getStatus: async () => ({ available: true, authenticated: true, authMethod: "ChatGPT" }),
      runCodex: async ({ prompt }) => {
        if (/<scout-report>/.test(prompt)) throw new Error("Scout failed deterministically.");
        return {
          finalText: `<scout-dispatch>{"scouts":[{"name":"scout-code-path","focus":"Trace the selected failure path.","reason":"The task requires one code-path fact."}],"rationale":"One code-path scout is required."}</scout-dispatch>`,
          usage: { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1, totalTokens: 2 },
        };
      },
    });

    assert.equal(await orchestrator.start(task.id), true);
    let failed = await waitForStatus(store, task.id, "failed");
    assert.equal(failed.currentStage, "scouts");
    assert.equal(failed.attemptsByStage.triage, 1);
    assert.equal(failed.attemptsByStage.scouts, 1);
    assert.notEqual(failed.stageRunReservations.triage.id, failed.stageRunReservations.scouts.id);

    assert.equal(await orchestrator.start(task.id), true);
    failed = await waitForStatus(store, task.id, "blocked");
    assert.equal(failed.currentStage, "scouts");
    assert.equal(failed.attemptsByStage.triage, 1);
    assert.equal(failed.attemptsByStage.scouts, 2);
    assert.equal(await orchestrator.start(task.id), false);
  } finally {
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test("keeps implementation reservations candidate-unbound across assembly retries", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-assembly-retry-"));
  try {
    const store = new JsonTaskStore(path.join(directory, "tasks.json"));
    await store.init();
    const task = await store.create({
      title: "Retry candidate assembly",
      description: "A failed candidate must not bind the next implementation attempt.",
      repositoryPath: directory,
      workflow: "implement",
      priority: "low",
    });
    await store.update(task.id, (draft) => {
      draft.status = "ready-for-implementation";
      draft.currentStage = "implement";
      draft.stageRunLimits.implement = 2;
      draft.workPackages = [{
        id: "S1",
        title: "Single package",
        description: "Already qualified for candidate assembly.",
        dependencies: [],
        batch: 1,
        ownedPaths: ["server/example.mjs"],
        verification: ["npm test"],
        verificationCommandIds: ["test"],
        status: "ready_for_integration",
        attempts: 1,
        branch: "agent-harness/test-s1",
        worktreePath: directory,
        baseRevision: "a".repeat(40),
        headRevision: "b".repeat(40),
        files: ["server/example.mjs"],
        error: null,
      }];
    });
    const orchestrator = new TaskOrchestrator(store, {
      getStatus: async () => ({ available: true, authenticated: true, authMethod: "ChatGPT" }),
      readVerificationManifest: async () => ({
        source: ".agent-harness/verification.json",
        commands: [{ id: "test", title: "test", command: ["npm", "test"], report: null }],
      }),
      worktreeManager: {
        base: async () => ({ repositoryRoot: directory, baseRevision: "a".repeat(40), baseBranch: "main" }),
        prepare: async (_task, candidateId) => ({
          id: candidateId,
          revisionNumber: 1,
          baseRevision: "a".repeat(40),
          baseBranch: "main",
          headRevision: null,
          branch: `agent-harness/${candidateId.toLowerCase()}`,
          repositoryRoot: directory,
          worktreePath: directory,
          status: "assembling",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          revisions: [],
        }),
        assemble: async () => {
          throw new Error("candidate assembly conflict");
        },
      },
    });

    assert.equal(await orchestrator.start(task.id, "implementation"), true);
    let failed = await waitForStatus(store, task.id, "failed");
    const firstReservation = failed.stageRunReservations.implement;
    assert.equal(firstReservation.workflowAttempt, 1);
    assert.equal(firstReservation.candidateId, null);
    assert.equal(failed.candidates[0].sourceWorkflowReservationId, firstReservation.id);
    assert.equal(failed.candidates[0].status, "failed");

    assert.equal(await orchestrator.start(task.id, "implementation"), true);
    failed = await waitForStatus(store, task.id, "blocked");
    const secondReservation = failed.stageRunReservations.implement;
    assert.equal(secondReservation.workflowAttempt, 2);
    assert.equal(secondReservation.candidateId, null);
    assert.equal(secondReservation.candidateRevision, null);
    assert.equal(secondReservation.candidateHeadRevision, null);
    assert.notEqual(secondReservation.id, firstReservation.id);
    assert.equal(failed.candidates[1].sourceWorkflowReservationId, secondReservation.id);
    assert.equal(failed.candidates[1].status, "failed");
    assert.equal(await orchestrator.start(task.id, "implementation"), false);
  } finally {
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test("advances an approved implementation task through a revision-bound candidate", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-candidate-"));
  try {
    const store = new JsonTaskStore(path.join(directory, "tasks.json"));
    await store.init();
    const task = await store.create({
      title: "Ship a small change",
      description: "Implement and verify the approved change.",
      repositoryPath: directory,
      workflow: "implement",
      priority: "medium",
    });
    let merged = false;
    let commitCount = 0;
    let candidateNeedsRecovery = false;
    let recoveryCount = 0;
    let repairCount = 0;
    let reviewCount = 0;
    let verifyCount = 0;
    let originalAuthorizerContent = null;
    const runtimeCalls = [];
    const worktreeManager = {
      async base() {
        return { repositoryRoot: directory, baseRevision: "a".repeat(40), baseBranch: "main" };
      },
      async prepare(_task, candidateId) {
        return {
          id: candidateId,
          revisionNumber: 1,
          baseRevision: "a".repeat(40),
          baseBranch: "main",
          headRevision: null,
          branch: "agent-harness/test-c1",
          repositoryRoot: directory,
          worktreePath: path.join(directory, candidateId),
          status: "implementing",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          revisions: [],
        };
      },
      async commit(candidate) {
        commitCount += 1;
        if (candidate.id === "C1" && repairCount === 1) {
          await store.update(task.id, (draft) => {
            const authorizerId = draft.stageRunReservations.implement.authorizingGateArtifactId;
            const authorizer = draft.artifacts.find((artifact) => artifact.id === authorizerId);
            originalAuthorizerContent = authorizer.content;
            authorizer.content = "";
          });
          candidateNeedsRecovery = true;
        }
        return {
          headRevision: (candidate.id === "S1-A1" ? "s" : candidate.id === "S2-A1" ? "t" : "c").repeat(40),
          files: ["src/change.ts"],
          summary: "1 file changed",
          diff: "+change",
          ownSummary: "1 file changed",
          ownDiff: "+change",
        };
      },
      async assemble() {
        return {
          headRevision: "b".repeat(40),
          files: ["src/change.ts"],
          summary: "1 file changed",
          diff: "+change",
        };
      },
      async merge() {
        merged = true;
      },
      async verifyCandidate() {
        verifyCount += 1;
        return true;
      },
      async recoverCandidate() {
        if (!candidateNeedsRecovery) return false;
        candidateNeedsRecovery = false;
        recoveryCount += 1;
        return true;
      },
    };
    const orchestrator = new TaskOrchestrator(store, {
      readVerificationManifest: async () => ({
        source: ".agent-harness/verification.json",
        commands: [
          { id: "test", command: ["npm", "test"] },
          { id: "typecheck", command: ["npm", "run", "typecheck"] },
        ],
      }),
      // The harness executes verification now, so this flow supplies the observation through the
      // same seam as runCodex (#47). Bound to a *fixed* C1 revision 2 rather than to whatever
      // the candidate currently is, exactly as the model-authored TEST_OUTPUT it replaces was:
      // the point of this flow is that evidence for an older revision must not clear a newer
      // candidate, and binding to the live candidate would erase the scenario.
      runVerification: async () => {
        // Two rows, because this flow asserts what the persisted artifact carries and the
        // model-authored TEST_OUTPUT it replaces described two commands.
        const base = harnessEvidence({ id: "C1", revisionNumber: 2, headRevision: "b".repeat(40) });
        return {
          ...base,
          rows: [base.rows[0], { ...base.rows[0], id: "test-api", title: "api.test.mjs", command: "npm run test:api", durationMs: 350 }],
          executedCommandIds: ["test", "test-api"],
          declaredCommandIds: ["test", "test-api"],
        };
      },
      getStatus: async () => ({ available: true, authenticated: true, authMethod: "ChatGPT" }),
      worktreeManager,
      runCodex: async (options) => {
        const { prompt } = options;
        runtimeCalls.push(options);
        options.onEvent?.({
          type: "activity",
          tone: "success",
          title: "Repository command completed",
          detail: "npm.cmd test",
          commandFailed: false,
          toolCall: {
            id: `cmd-${runtimeCalls.length}`,
            name: "command_execution",
            category: "repository-command",
            phase: "completed",
            result: "Exit code 0",
          },
        });
        if (/You are the candidate Repair agent/.test(prompt)) {
          repairCount += 1;
        }
        let finalText = "## Outcome\n\nReady";
        if (/<scout-report>/.test(prompt)) finalText = SCOUT_OUTPUT;
        if (/<grill-questions>/.test(prompt)) finalText = GRILL_OUTPUT;
        if (/<work-packages>/.test(prompt)) finalText = PLAN_OUTPUT;
        if (/Development review/.test(prompt)) {
          reviewCount += 1;
          finalText = reviewCount === 1
            ? gateOutput(1, "REPAIR", [{
                severity: "P1",
                title: "Repair required",
                detail: "Fix the candidate.",
                candidateId: "C1",
                candidateRevision: 1,
              }])
            : gateOutput(2);
        } else if (/Focused test/.test(prompt)) {
          finalText = TEST_OUTPUT;
        } else if (/Final review/.test(prompt)) {
          finalText = gateOutput(2);
        }
        return {
          finalText,
          usage: { inputTokens: 10, cachedInputTokens: 4, outputTokens: 5, totalTokens: 15 },
        };
      },
    });

    await orchestrator.start(task.id);
    await waitForStatus(store, task.id, "awaiting-grill");
    await orchestrator.answerGrillQuestion(task.id, { questionId: "Q1", answer: "Keep it backwards compatible.", source: "operator" });
    await orchestrator.finishGrill(task.id, { source: "operator" });
    await waitForStatus(store, task.id, "awaiting-spec-approval");
    await orchestrator.approveSpecification(task.id);
    await waitForStatus(store, task.id, "awaiting-plan-approval");
    await orchestrator.approvePlan(task.id);
    assert.equal((await store.get(task.id)).status, "ready-for-implementation");

    await orchestrator.start(task.id, "implementation");
    await waitForStatus(store, task.id, "ready-for-review");
    await orchestrator.start(task.id, "review");
    const repairReady = await waitForStatus(store, task.id, "repair-required");
    assert.equal(repairReady.gateFreshness["dev-review"].reasonCode, "repair_required");
    assert.ok(repairReady.gateFreshness["dev-review"].sourceRunId);
    assert.ok(repairReady.gateFreshness["dev-review"].sourceArtifactId);
    await orchestrator.start(task.id, "repair");
    const driftedRepair = await waitForStatus(store, task.id, "failed");
    assert.equal(driftedRepair.currentStage, "implement");
    assert.equal(driftedRepair.candidates[0].revisionNumber, 1);
    assert.equal(commitCount, 3, "the probe mutates authority only after the first Repair commit");
    assert.equal(recoveryCount, 1, "a rejected post-commit Repair must recover the recorded candidate head");
    assert.match(driftedRepair.error, /authorizing gate/i);
    assert.match(driftedRepair.stageRunReservations.implement.authorizingGateSnapshotDigest, /^[0-9a-f]{64}$/);
    await store.update(task.id, (draft) => {
      const authorizerId = draft.stageRunReservations.implement.authorizingGateArtifactId;
      draft.artifacts.find((artifact) => artifact.id === authorizerId).content = originalAuthorizerContent;
      refreshGateFreshness(draft);
    });
    assert.equal(await orchestrator.start(task.id, "repair"), true);
    await waitForStatus(store, task.id, "ready-for-review");
    await orchestrator.start(task.id, "review");
    await waitForStatus(store, task.id, "ready-for-test");
    await orchestrator.start(task.id, "test");
    await waitForStatus(store, task.id, "ready-for-final-review");
    await orchestrator.start(task.id, "final-review");
    const approvalTask = await waitForStatus(store, task.id, "awaiting-human-approval");

    assert.equal(approvalTask.candidates[0].headRevision, "c".repeat(40));
    assert.equal(approvalTask.candidates[0].revisionNumber, 2);
    assert.deepEqual(
      approvalTask.candidates[0].revisions.map((revision) => revision.headRevision),
      ["b".repeat(40), "c".repeat(40)],
    );
    assert.equal(approvalTask.decisions.length, 1);
    assert.deepEqual(approvalTask.workPackages.map((item) => item.status), ["integrated", "integrated"]);
    assert.deepEqual(approvalTask.candidates[0].members.map((member) => member.packageId), ["S1", "S2"]);
    assert.equal(approvalTask.artifacts.length, 16);
    assert.equal(
      approvalTask.artifacts.filter((artifact) => artifact.stage === "implement" && artifact.candidateRevision === 2).length,
      2,
      "the rejected post-commit Repair remains retained audit evidence beside the successful retry",
    );
    const testCall = runtimeCalls.find((call) => /Focused test/.test(call.prompt));
    // Inverted deliberately, and this assertion is the change in #47 rather than a casualty of
    // it. The test agent used to need workspace-write and loopback access because it ran the
    // verification commands itself; the harness runs them now, so the agent only reads the
    // worktree to interpret results. No stage grants network access any more, which is exactly
    // what made this stage impossible on Claude (#40) and dependent on Codex credits.
    assert.equal(testCall.sandbox, "read-only");
    assert.equal(testCall.networkAccess, false, "the test agent no longer runs commands, so it needs no loopback access");
    assert.equal(runtimeCalls.find((call) => /Development review/.test(call.prompt)).networkAccess, false);
    // Read-only stages get the shorter budget; the long one existed for running suites.
    assert.equal(testCall.timeoutMs, 360_000);
    assert.match(testCall.tempDirectory, new RegExp(`^${escapeRegex(path.join(os.tmpdir(), "agent-harness", task.id))}`));
    assert.equal(testCall.tempDirectory.startsWith(path.join(directory, "C1")), false);
    assert.equal(
      verifyCount,
      10,
      "test and both Repair attempts verify at their boundaries (7), plus a post-run check for each read-only review stage: two dev-reviews and one final-review",
    );
    assert.equal(
      approvalTask.artifacts.find((artifact) => artifact.stage === "test")?.focusedTest?.rows?.length,
      2,
    );
    assert.equal(
      approvalTask.artifacts.find((artifact) => artifact.stage === "test")?.focusedTest?.rows?.[1].status,
      "passed",
    );
    assert.equal(
      approvalTask.artifacts.find((artifact) => artifact.stage === "test")?.focusedTest?.rows?.[1].candidateRevision,
      2,
    );
    const reviewRuns = approvalTask.runs.filter((run) => run.stage === "dev-review");
    const repairRevision = approvalTask.candidates[0].revisions[1];
    const repairRun = approvalTask.runs.find((run) => (
      run.kind === "repair" && run.workflowReservationId === repairRevision.sourceWorkflowReservationId
    ));
    const repairArtifact = approvalTask.artifacts.find((artifact) => artifact.runId === repairRun.id);
    const repairAuthorizerArtifact = approvalTask.artifacts.find((artifact) => artifact.runId === reviewRuns[0].id);
    const testRun = approvalTask.runs.find((run) => run.stage === "test");
    assert.equal(reviewRuns.length, 2);
    assert.equal(repairRevision.sourceWorkflowReservedAt, approvalTask.stageRunReservations.implement.reservedAt);
    assert.equal(repairRevision.authorizingGateStage, "dev-review");
    assert.equal(repairRevision.authorizingGateReservationId, reviewRuns[0].workflowReservationId);
    assert.equal(repairRevision.authorizingGateRunId, reviewRuns[0].id);
    assert.equal(repairRevision.authorizingGateArtifactId, repairAuthorizerArtifact.id);
    assert.match(approvalTask.stageRunReservations.implement.authorizingGateSnapshotDigest, /^[0-9a-f]{64}$/);
    assert.ok(Date.parse(repairAuthorizerArtifact.createdAt) < Date.parse(repairRevision.sourceWorkflowReservedAt));
    assert.ok(Date.parse(repairRevision.sourceWorkflowReservedAt) <= Date.parse(repairRun.startedAt));
    assert.ok(Date.parse(repairRun.completedAt) <= Date.parse(repairArtifact.createdAt));
    assert.ok(Date.parse(repairArtifact.createdAt) <= Date.parse(repairRevision.createdAt));
    assert.deepEqual(reviewRuns[1].gateResult.blockingReasons, []);
    assert.equal(reviewRuns[1].retryOfRunId, reviewRuns[0].id);
    assert.equal(repairRun.repairOfRunId, reviewRuns[0].id);
    assert.equal(testRun.test.rowCount, 2);
    assert.equal(testRun.toolCalls[0].name, "command_execution");
    assert.equal(testRun.artifactId, approvalTask.artifacts.find((artifact) => artifact.stage === "test").id);
    assert.equal(approvalTask.artifacts.find((artifact) => artifact.stage === "test").runId, testRun.id);
    assert.equal(approvalTask.runs.every((run) => run.status === "completed"), true);
    assert.deepEqual(approvalTask.activeRunIds, []);
    for (const stage of ["dev-review", "test", "final-review"]) {
      const passEvent = approvalTask.events.find((event) => event.stage === stage && event.title.endsWith(" passed"));
      assert.equal(passEvent.runId, approvalTask.gateFreshness[stage].sourceRunId, `${stage} pass event links its authoritative run`);
      assert.equal(passEvent.freshness.fresh, true, `${stage} pass event carries authoritative freshness`);
    }
    await orchestrator.approveMerge(task.id);
    const merged1 = await store.get(task.id);
    assert.equal(merged1.status, "merged-to-target");
    assert.equal(merged1.completedAt, null, "merging onto the target branch does not itself complete the task");
    assert.equal(merged1.candidates[0].status, "merged");
    assert.equal(merged1.artifacts.length, 17);
    assert.equal(merged1.artifacts.at(-1).stage, "approval");
    assert.equal(merged1.artifacts.at(-1).candidateId, "C1");
    assert.equal(merged1.artifacts.at(-1).candidateRevision, 2);
    assert.match(merged1.artifacts.at(-1).content, /Merge method: fast-forward only/);
    assert.match(merged1.artifacts.at(-1).content, new RegExp(`Merged revision: ${"c".repeat(40)}`));
    assert.equal(merged1.mergeIntent.status, "completed");
    assert.equal(merged1.approvals.filter((approval) => approval.stage === "approval").length, 1);
    await assert.rejects(() => orchestrator.approveMerge(task.id), /not awaiting merge approval/i);
    assert.equal(merged, true);

    for (const kind of ["review", "test", "final-review", "implementation"]) {
      assert.equal(await orchestrator.start(task.id, kind), false, `${kind} must not start once the task is merged-to-target`);
    }
    await assert.rejects(() => orchestrator.completeMergedTask("AH-missing"), /Task not found/i);

    await orchestrator.completeMergedTask(task.id, "Promoted to the shared integration branch.");
    const complete = await store.get(task.id);
    assert.equal(complete.status, "completed");
    assert.ok(complete.completedAt);
    assert.equal(complete.candidates[0].status, "merged");
    const promotion = complete.approvals.find((approval) => approval.stage === "promotion");
    assert.ok(promotion, "promoting to completed records a persisted decision");
    assert.equal(promotion.note, "Promoted to the shared integration branch.");
    await assert.rejects(() => orchestrator.completeMergedTask(task.id), /not merged to its target branch/i);
  } finally {
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test("retains explicit P3 advice without opening a candidate repair", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-noop-repair-"));
  try {
    const store = new JsonTaskStore(path.join(directory, "tasks.json"));
    await store.init();
    const task = await store.create({
      title: "Ship a small change",
      description: "Implement and verify the approved change.",
      repositoryPath: directory,
      workflow: "implement",
      priority: "medium",
    });
    let reviewCount = 0;
    let sawAllowNoChanges = false;
    const worktreeManager = {
      async base() {
        return { repositoryRoot: directory, baseRevision: "a".repeat(40), baseBranch: "main" };
      },
      async prepare(_task, candidateId) {
        return {
          id: candidateId,
          revisionNumber: 1,
          baseRevision: "a".repeat(40),
          baseBranch: "main",
          headRevision: null,
          branch: "agent-harness/test-c1",
          repositoryRoot: directory,
          worktreePath: path.join(directory, candidateId),
          status: "implementing",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          revisions: [],
        };
      },
      async commit(candidate, _message, options) {
        if (candidate.id !== "C1") {
          // A work-package slice commit: unrelated to this test's scenario.
          return { headRevision: "s".repeat(40), files: ["src/change.ts"], summary: "1 file changed", diff: "+change", ownSummary: "1 file changed", ownDiff: "+change" };
        }
        // The repair's own commit call. Mirrors `GitWorktreeManager.commit`'s real
        // `allowNoChanges` contract: only returns the no-op shape when the orchestrator
        // explicitly asked for it, which it must only do after reading the agent's
        // `<no-changes-needed>` marker.
        sawAllowNoChanges = options?.allowNoChanges === true;
        if (!options?.allowNoChanges) throw new Error("The implementation agent completed without changing any files.");
        return { headRevision: null, parentRevision: null, files: [], summary: "", diff: "", ownSummary: "", ownDiff: "", noChangesNeeded: true };
      },
      async assemble() {
        return { headRevision: "b".repeat(40), files: ["src/change.ts"], summary: "1 file changed", diff: "+change" };
      },
      async verifyCandidate() {
        return true;
      },
      async recoverCandidate() {
        return false;
      },
    };
    const orchestrator = new TaskOrchestrator(store, {
      readVerificationManifest: async () => ({
        source: ".agent-harness/verification.json",
        commands: [
          { id: "test", command: ["npm", "test"] },
          { id: "typecheck", command: ["npm", "run", "typecheck"] },
        ],
      }),
      worktreeManager,
      runCodex: async ({ prompt }) => {
        // Later, more specific stage markers must win over earlier ones a prompt's
        // retained-artifact context can still carry (e.g. the plan prompt embeds the
        // scout report) — matching the independent, overwrite-not-return checks the
        // full end-to-end test above uses for exactly this reason.
        let finalText = "## Outcome\n\nReady";
        if (/<scout-report>/.test(prompt)) finalText = SCOUT_OUTPUT;
        if (/<grill-questions>/.test(prompt)) finalText = GRILL_OUTPUT;
        if (/<work-packages>/.test(prompt)) finalText = PLAN_OUTPUT;
        if (/You are the candidate Repair agent/.test(prompt)) {
          finalText = '## Outcome\n\nThe one finding is informational only.\n\n<no-changes-needed>{"reason":"The P3 finding explicitly requires no code change"}</no-changes-needed>';
        } else if (/Development review/.test(prompt)) {
          reviewCount += 1;
          // Both reviews evaluate revision 1: a no-op repair does not bump the
          // candidate's revision, so the second review is of the exact same revision
          // as the first, not a new one.
          finalText = reviewCount === 1
            ? gateOutput(1, "PASS", [{
                severity: "P3",
                title: "Informational only",
                detail: "No repair required for this finding on its own.",
                candidateId: "C1",
                candidateRevision: 1,
              }])
            : gateOutput(1);
        }
        return { finalText, usage: { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1, totalTokens: 2 } };
      },
    });

    await orchestrator.start(task.id);
    await waitForStatus(store, task.id, "awaiting-grill");
    await orchestrator.answerGrillQuestion(task.id, { questionId: "Q1", answer: "Keep it backwards compatible.", source: "operator" });
    await orchestrator.finishGrill(task.id, { source: "operator" });
    await waitForStatus(store, task.id, "awaiting-spec-approval");
    await orchestrator.approveSpecification(task.id);
    await waitForStatus(store, task.id, "awaiting-plan-approval");
    await orchestrator.approvePlan(task.id);
    await orchestrator.start(task.id, "implementation");
    await waitForStatus(store, task.id, "ready-for-review");
    await orchestrator.start(task.id, "review");

    const passed = await waitForStatus(store, task.id, "ready-for-test");
    assert.equal(passed.candidates[0].revisionNumber, 1);
    assert.equal(passed.candidates[0].status, "ready_for_test");
    assert.equal(passed.artifacts.find((artifact) => artifact.stage === "dev-review").gateResult.findings[0].blocking, false);
    assert.equal(sawAllowNoChanges, false, "non-blocking advice never starts Repair");
  } finally {
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test("reserves a run exactly once across concurrent start requests", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-start-race-"));
  try {
    const store = new JsonTaskStore(path.join(directory, "tasks.json"));
    await store.init();
    const task = await store.create({
      title: "Reserve once",
      description: "Concurrent starts must produce one durable run reservation.",
      repositoryPath: directory,
      workflow: "investigate",
      priority: "medium",
      model: "gpt-5.6-luna",
      reasoning: "xhigh",
    });
    let release;
    const orchestrator = new TaskOrchestrator(store, {
      runCodex: () => new Promise((resolve) => {
        release = () => resolve({ finalText: "Done", usage: { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, totalTokens: 0 } });
      }),
    });

    const results = await Promise.all([orchestrator.start(task.id), orchestrator.start(task.id)]);
    assert.deepEqual(results.sort(), [false, true]);
    const reserved = await store.get(task.id);
    assert.equal(reserved.status, "running");
    assert.equal(reserved.activeRunKind, "investigation");
    assert.equal(reserved.attemptsByStage.triage, 1);
    assert.equal(reserved.stageRunReservations.triage.id, reserved.activeRunReservationId);
    assert.deepEqual(
      {
        stage: reserved.stageRunReservations.triage.stage,
        kind: reserved.stageRunReservations.triage.kind,
        workflowAttempt: reserved.stageRunReservations.triage.workflowAttempt,
        candidateId: reserved.stageRunReservations.triage.candidateId,
        candidateRevision: reserved.stageRunReservations.triage.candidateRevision,
        candidateHeadRevision: reserved.stageRunReservations.triage.candidateHeadRevision,
      },
      {
        stage: "triage",
        kind: "investigation",
        workflowAttempt: 1,
        candidateId: null,
        candidateRevision: null,
        candidateHeadRevision: null,
      },
    );
    for (let attempt = 0; !release && attempt < 100; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.equal(typeof release, "function");
    const running = await store.get(task.id);
    assert.equal(running.runs[0].workflowReservationId, reserved.activeRunReservationId);
    assert.equal(running.runs[0].workflowAttempt, 1);
    assert.equal(await orchestrator.cancel(task.id), true);
    release();
    await waitForStatus(store, task.id, "cancelled");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("persists typed process timeouts as a terminal timed-out run", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-typed-timeout-"));
  try {
    const store = new JsonTaskStore(path.join(directory, "tasks.json"));
    await store.init();
    const task = await store.create({
      title: "Persist typed timeout",
      description: "Record a structured terminal outcome when Codex exceeds its deadline.",
      repositoryPath: directory,
      workflow: "investigate",
      priority: "medium",
    });
    const orchestrator = new TaskOrchestrator(store, {
      runCodex: async () => {
        throw new ProcessTimeoutError(180_000, "Codex");
      },
    });

    assert.equal(await orchestrator.start(task.id), true);
    const failed = await waitForStatus(store, task.id, "failed");
    assert.equal(failed.runs.length, 1);
    assert.equal(failed.runs[0].status, "timed-out");
    assert.equal(failed.runs[0].error, "Codex run exceeded 180 seconds.");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("cleans a failed Test run before allowing its retry", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-test-cleanup-"));
  try {
    const store = new JsonTaskStore(path.join(directory, "tasks.json"));
    await store.init();
    const task = await store.create({
      title: "Clean Test retries",
      description: "A failed Test run must not strand the candidate.",
      repositoryPath: directory,
      workflow: "implement",
      priority: "medium",
    });
    await store.update(task.id, (draft) => {
      draft.status = "ready-for-test";
      draft.currentStage = "test";
      draft.candidates = [{
        id: "C1",
        revisionNumber: 2,
        baseRevision: "a".repeat(40),
        baseBranch: "main",
        headRevision: "b".repeat(40),
        branch: "agent-harness/test-cleanup",
        repositoryRoot: directory,
        worktreePath: directory,
        status: "ready_for_test",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        revisions: [],
      }];
    });
    let dirty = false;
    let attempts = 0;
    let recoveries = 0;
    const orchestrator = new TaskOrchestrator(store, {
      // The harness executes verification now; this flow is about candidate lineage and retry
      // accounting, so it supplies the observation through the same seam as runCodex (#47).
      runVerification: passingVerification,
      worktreeManager: {
        async verifyCandidate() {
          if (dirty) throw new Error("candidate is dirty");
          return true;
        },
        async recoverCandidate() {
          recoveries += 1;
          const changed = dirty;
          dirty = false;
          return changed;
        },
      },
      runCodex: async () => {
        attempts += 1;
        if (attempts === 1) {
          dirty = true;
          throw new Error("Focused test runner failed after writing temporary output.");
        }
        return {
          finalText: TEST_OUTPUT,
          usage: { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1, totalTokens: 2 },
        };
      },
    });

    assert.equal(await orchestrator.start(task.id, "test"), true);
    await waitForStatus(store, task.id, "failed");
    assert.equal(dirty, false);
    assert.equal(await orchestrator.start(task.id, "test"), true);
    await waitForStatus(store, task.id, "ready-for-final-review");
    assert.equal(attempts, 2);
    assert.equal(recoveries, 2);
  } finally {
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test("reconciles a recorded merge intent without duplicating approval", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-merge-recovery-"));
  try {
    const store = new JsonTaskStore(path.join(directory, "tasks.json"));
    await store.init();
    const task = await store.create({
      title: "Recover merge",
      description: "Finalize a merge that completed before task persistence.",
      repositoryPath: directory,
      workflow: "implement",
      priority: "medium",
      model: "gpt-5.6-luna",
      reasoning: "xhigh",
    });
    await store.update(task.id, (draft) => {
      draft.status = "merging";
      draft.currentStage = "approval";
      draft.candidates = [{
        id: "C1",
        revisionNumber: 1,
        baseRevision: "a".repeat(40),
        baseBranch: "feature",
        baseRef: "refs/heads/feature",
        headRevision: "b".repeat(40),
        branch: "agent-harness/ah-001-c1",
        repositoryRoot: directory,
        worktreePath: directory,
        status: "awaiting_human_approval",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        revisions: [],
      }];
      draft.mergeIntent = {
        candidateId: "C1",
        candidateRevision: 1,
        baseRevision: "a".repeat(40),
        headRevision: "b".repeat(40),
        targetRef: "refs/heads/feature",
        note: "Approved before restart.",
        status: "pending",
        startedAt: new Date().toISOString(),
        completedAt: null,
        error: null,
      };
      const devReview = makeRuntimeRun({
        id: "RUN-DEV-RECOVERY",
        stage: "dev-review",
        candidateRevision: 1,
        artifactId: "ART-DEV-RECOVERY",
        gateResult: makeGateResult({ candidateRevision: 1 }),
      });
      const testRun = makeRuntimeRun({
        id: "RUN-TEST-RECOVERY",
        stage: "test",
        kind: "test",
        candidateRevision: 1,
        artifactId: "ART-TEST-RECOVERY",
        gateResult: makeGateResult({ stage: "test", candidateRevision: 1 }),
      });
      const finalReview = makeRuntimeRun({
        id: "RUN-FINAL-RECOVERY",
        stage: "final-review",
        candidateRevision: 1,
        artifactId: "ART-FINAL-RECOVERY",
        gateResult: makeGateResult({ stage: "final-review", candidateRevision: 1 }),
      });
      const focusedTest = {
        candidateId: "C1",
        candidateRevision: 1,
        bindingExplicit: true,
        command: "npm test",
        status: "passed",
        rows: [makeTestRow({ candidateRevision: 1 })],
      };
      draft.runs = [devReview, testRun, finalReview];
      draft.artifacts = [
        makeArtifact({ id: "ART-DEV-RECOVERY", candidateRevision: 1, gateResult: devReview.gateResult }),
        makeArtifact({
          id: "ART-TEST-RECOVERY",
          stage: "test",
          candidateRevision: 1,
          gateResult: testRun.gateResult,
          focusedTest,
        }),
        makeArtifact({
          id: "ART-FINAL-RECOVERY",
          stage: "final-review",
          candidateRevision: 1,
          gateResult: finalReview.gateResult,
        }),
      ];
      attachRunArtifact(draft, testRun.id, draft.artifacts[1]);
      refreshGateFreshness(draft);
    });
    let mergeCalls = 0;
    const orchestrator = new TaskOrchestrator(store, {
      worktreeManager: {
        mergeState: async () => "merged",
        merge: async () => { mergeCalls += 1; },
      },
    });

    await orchestrator.recoverMergeIntents();
    await orchestrator.recoverMergeIntents();
    const recovered = await store.get(task.id);
    assert.equal(recovered.status, "merged-to-target");
    assert.equal(recovered.mergeIntent.status, "completed");
    assert.equal(recovered.approvals.filter((approval) => approval.stage === "approval").length, 1);
    assert.equal(mergeCalls, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("refreshes a target-diverged candidate as a new revision and invalidates downstream gates", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-refresh-candidate-"));
  try {
    const store = new JsonTaskStore(path.join(directory, "tasks.json"));
    await store.init();
    const task = await store.create({
      title: "Refresh candidate",
      description: "Replay an approved candidate onto the latest target.",
      repositoryPath: directory,
      workflow: "implement",
      priority: "medium",
    });
    const oldBase = "a".repeat(40);
    const oldHead = "b".repeat(40);
    const targetHead = "c".repeat(40);
    const refreshedHead = "d".repeat(40);
    await store.update(task.id, (draft) => {
      draft.status = "blocked";
      draft.currentStage = "approval";
      draft.error = "The recorded target ref diverged while recovering a pending merge.";
      draft.blocker = { code: "target-diverged", detail: draft.error, detectedAt: new Date().toISOString() };
      draft.completedStages = ["triage", "scouts", "grill", "specification", "plan", "implement", "dev-review", "test", "final-review"];
      draft.candidates = [{
        id: "C1",
        revisionNumber: 1,
        baseRevision: oldBase,
        baseBranch: "main",
        baseRef: "refs/heads/main",
        headRevision: oldHead,
        branch: "agent-harness/ah-001-c1",
        repositoryRoot: directory,
        worktreePath: directory,
        status: "awaiting_human_approval",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        revisions: [{ number: 1, headRevision: oldHead, reason: "assembly", createdAt: new Date().toISOString() }],
      }];
      draft.mergeIntent = { status: "failed", error: draft.error };
    });
    const orchestrator = new TaskOrchestrator(store, {
      worktreeManager: {
        refreshCandidate: async () => ({
          previousBaseRevision: oldBase,
          previousHeadRevision: oldHead,
          targetRevision: targetHead,
          headRevision: refreshedHead,
          files: ["src/change.ts"],
          summary: "1 file changed",
        }),
      },
    });

    await orchestrator.refreshCandidate(task.id);
    const refreshed = await store.get(task.id);
    const candidate = refreshed.candidates[0];
    assert.equal(refreshed.status, "ready-for-review");
    assert.equal(refreshed.currentStage, "dev-review");
    assert.equal(refreshed.error, null);
    assert.equal(refreshed.blocker, null);
    assert.equal(refreshed.mergeIntent, null);
    assert.equal(candidate.revisionNumber, 2);
    assert.equal(candidate.baseRevision, targetHead);
    assert.equal(candidate.headRevision, refreshedHead);
    assert.equal(candidate.revisions.at(-1).reason, "target-refresh");
    assert.deepEqual(refreshed.completedStages, ["triage", "scouts", "grill", "specification", "plan", "implement"]);
    assert.match(refreshed.events.at(-1).detail, /must pass every candidate-bound gate again/i);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("blocks a candidate gate on target drift before reserving an attempt", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-gate-target-drift-"));
  try {
    const store = new JsonTaskStore(path.join(directory, "tasks.json"));
    await store.init();
    const task = await store.create({
      title: "Pause stale candidate gate",
      description: "Do not spend a review attempt after the target advances.",
      repositoryPath: directory,
      workflow: "implement",
      priority: "medium",
    });
    await store.update(task.id, (draft) => {
      draft.status = "ready-for-review";
      draft.currentStage = "dev-review";
      draft.attemptsByStage["dev-review"] = 2;
      draft.candidates = [{
        id: "C1",
        revisionNumber: 1,
        baseRevision: "a".repeat(40),
        baseBranch: "main",
        baseRef: "refs/heads/main",
        headRevision: "b".repeat(40),
        branch: "agent-harness/stale-candidate",
        repositoryRoot: directory,
        worktreePath: directory,
        status: "ready_for_review",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        revisions: [],
      }];
    });
    const orchestrator = new TaskOrchestrator(store, {
      worktreeManager: { mergeState: async () => "diverged" },
    });

    await assert.rejects(
      () => orchestrator.start(task.id, "review"),
      /Refresh the candidate before spending another candidate-bound gate attempt/,
    );
    const blocked = await store.get(task.id);
    assert.equal(blocked.status, "blocked");
    assert.equal(blocked.blocker.code, "target-diverged");
    assert.equal(blocked.attemptsByStage["dev-review"], 2);
    assert.equal(blocked.activeRunKind, null);
    assert.match(blocked.events.at(-1).detail, /No gate attempt was spent/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("records refresh conflicts and rebuilds approved packages from the latest target", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-rebuild-candidate-"));
  try {
    const store = new JsonTaskStore(path.join(directory, "tasks.json"));
    await store.init();
    const task = await store.create({
      title: "Rebuild conflicted candidate",
      description: "Retain the old candidate and rerun the approved plan.",
      repositoryPath: directory,
      workflow: "implement",
      priority: "high",
    });
    await store.update(task.id, (draft) => {
      draft.status = "blocked";
      draft.currentStage = "test";
      draft.error = "The target branch advanced.";
      draft.blocker = { code: "target-diverged", detail: draft.error, detectedAt: new Date().toISOString() };
      draft.completedStages = ["triage", "scouts", "grill", "specification", "plan", "implement", "dev-review"];
      draft.attemptsByStage.implement = 3;
      draft.stageRunLimits.implement = 3;
      draft.workPackages = [{
        id: "S1",
        title: "Approved slice",
        description: "Reapply the approved outcome.",
        dependencies: [],
        batch: 1,
        ownedPaths: ["src/change.ts"],
        verificationCommandIds: ["test"],
        verification: ["test"],
        status: "integrated",
        attempts: 1,
        branch: "agent-harness/old-slice",
        worktreePath: directory,
        baseRevision: "a".repeat(40),
        headRevision: "b".repeat(40),
        files: ["src/change.ts"],
        verificationRuns: [{ status: "passed" }],
      }];
      draft.candidates = [{
        id: "C1",
        revisionNumber: 1,
        baseRevision: "a".repeat(40),
        baseBranch: "main",
        baseRef: "refs/heads/main",
        headRevision: "b".repeat(40),
        branch: "agent-harness/old-candidate",
        repositoryRoot: directory,
        worktreePath: directory,
        status: "ready_for_test",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        revisions: [],
      }];
    });
    const orchestrator = new TaskOrchestrator(store, {
      worktreeManager: {
        refreshCandidate: async () => { throw new Error("Candidate refresh conflicted while replaying it onto main: overlap"); },
        mergeState: async () => "diverged",
      },
    });

    await assert.rejects(() => orchestrator.refreshCandidate(task.id), /refresh conflicted/i);
    const conflicted = await store.get(task.id);
    assert.equal(conflicted.blocker.code, "target-refresh-conflict");

    await orchestrator.rebuildCandidateFromTarget(task.id);
    const rebuilt = await store.get(task.id);
    assert.equal(rebuilt.status, "ready-for-implementation");
    assert.equal(rebuilt.currentStage, "implement");
    assert.equal(rebuilt.candidates[0].status, "superseded");
    assert.equal(rebuilt.workPackages[0].status, "planned");
    assert.deepEqual(rebuilt.workPackages[0].verificationRuns, []);
    assert.equal(rebuilt.stageRunLimits.implement, 4);
    assert.deepEqual(rebuilt.completedStages, ["triage", "scouts", "grill", "specification", "plan"]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("restarts stopped pre-candidate packages from an advanced target", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-restart-implementation-"));
  try {
    const store = new JsonTaskStore(path.join(directory, "tasks.json"));
    await store.init();
    const task = await store.create({
      title: "Restart stale packages",
      description: "Do not continue historical slices after the target advances.",
      repositoryPath: directory,
      workflow: "implement",
      priority: "high",
    });
    await store.update(task.id, (draft) => {
      draft.status = "blocked";
      draft.currentStage = "implement";
      draft.error = "S1 crossed its ownership boundary.";
      draft.attemptsByStage.implement = 3;
      draft.stageRunLimits.implement = 3;
      draft.workPackages = [{
        id: "S1",
        title: "Approved slice",
        description: "Implement from the current target.",
        dependencies: [],
        batch: 1,
        ownedPaths: ["src/change.ts"],
        verificationCommandIds: ["test"],
        status: "failed",
        attempts: 1,
        baseRevision: "a".repeat(40),
        branch: "agent-harness/old-slice",
        worktreePath: directory,
        headRevision: null,
        files: [],
        error: draft.error,
        verificationRuns: [{ status: "failed" }],
      }];
    });
    const orchestrator = new TaskOrchestrator(store, {
      worktreeManager: {
        base: async () => ({ baseRevision: "b".repeat(40), baseBranch: "main", repositoryRoot: directory }),
      },
    });

    await orchestrator.restartImplementationFromTarget(task.id);
    const restarted = await store.get(task.id);
    assert.equal(restarted.status, "ready-for-implementation");
    assert.equal(restarted.currentStage, "implement");
    assert.equal(restarted.workPackages[0].status, "planned");
    assert.deepEqual(restarted.workPackages[0].verificationRuns, []);
    assert.equal(restarted.stageRunLimits.implement, 4);
    assert.match(restarted.events.at(-1).detail, /bbbbbbbb/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("continues a timed-out retained package without discarding progress or incrementing its package attempt", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-retained-continuation-"));
  try {
    const store = new JsonTaskStore(path.join(directory, "tasks.json"));
    await store.init();
    const task = await store.create({
      title: "Continue retained package",
      description: "Resume the exact timed-out slice with a bounded longer timeout.",
      repositoryPath: directory,
      workflow: "implement",
      priority: "high",
    });
    const baseRevision = "a".repeat(40);
    const packageRevision = "b".repeat(40);
    const candidateRevision = "c".repeat(40);
    await store.update(task.id, (draft) => {
      draft.status = "blocked";
      draft.currentStage = "implement";
      draft.error = "S1: Codex run exceeded 900 seconds.";
      draft.attemptsByStage.implement = 4;
      draft.stageRunLimits.implement = 4;
      draft.workPackages = [{
        id: "S1",
        title: "Retained implementation",
        description: "Finish the retained package.",
        dependencies: [],
        batch: 1,
        ownedPaths: ["src/feature.ts"],
        verification: [],
        verificationCommandIds: ["test"],
        verificationRuns: [],
        status: "failed",
        attempts: 4,
        branch: "agent-harness/retained-s1-a4",
        worktreePath: "/tmp/retained-s1-a4",
        baseRevision,
        headRevision: null,
        files: [],
        error: "Codex run exceeded 900 seconds.",
      }];
    });
    let request = null;
    const orchestrator = new TaskOrchestrator(store, {
      readVerificationManifest: async () => ({
        source: ".agent-harness/verification.json",
        commands: [{ id: "test", command: ["npm", "test"] }],
      }),
      runCodex: async (input) => {
        request = input;
        return {
          finalText: "## Outcome\nDone\n## Changes\nScoped\n## Verification\nFocused\n## Ownership exceptions\nNone\n## Remaining risks\nNone",
          model: "gpt-5.6-sol",
          reasoning: "xhigh",
          usage: { inputTokens: 10, cachedInputTokens: 0, outputTokens: 5, totalTokens: 15 },
        };
      },
      runPackageVerification: async () => makeFocusedTestSummary({ candidateId: "S1", candidateRevision: 4 }),
      worktreeManager: {
        base: async () => ({ repositoryRoot: directory, baseRevision, baseBranch: "main" }),
        inspectRetainedSlice: async () => ({
          branch: "agent-harness/retained-s1-a4",
          files: ["src/feature.ts", "src/outside.ts"],
          headRevision: baseRevision,
          worktreePath: "/tmp/retained-s1-a4",
          clean: false,
        }),
        commit: async () => ({
          headRevision: packageRevision,
          files: ["src/feature.ts"],
          summary: "1 file changed",
          ownSummary: "1 file changed",
          noChangesNeeded: false,
        }),
        removeWorktree: async () => [],
        prepare: async (_task, candidateId, options) => ({
          id: candidateId,
          revisionNumber: 1,
          baseRevision: options.baseRevision,
          baseBranch: "main",
          baseRef: "refs/heads/main",
          headRevision: null,
          branch: `agent-harness/${candidateId.toLowerCase()}`,
          repositoryRoot: directory,
          worktreePath: directory,
          status: "assembling",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          revisions: [],
        }),
        assemble: async () => ({
          headRevision: candidateRevision,
          files: ["src/feature.ts"],
          summary: "1 file changed",
          diff: "",
        }),
      },
    });

    assert.deepEqual(await orchestrator.continueRetainedPackage(task.id), { started: true });
    const ready = await waitForStatus(store, task.id, "ready-for-review");
    assert.equal(ready.workPackages[0].attempts, 4);
    assert.equal(ready.stageRunLimits.implement, 5);
    assert.equal(request.timeoutMs, 1_800_000);
    assert.match(request.prompt, /restore every retained path outside declared ownership: src\/outside\.ts/i);
    assert.equal(ready.candidates[0].baseRevision, baseRevision);
    assert.equal(ready.candidates[0].headRevision, candidateRevision);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

function makeRuntimeTask({ candidateId = "C1", candidateRevision = 2, runs = [], artifacts = [], events = [], revisions = [] } = {}) {
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

test("refuses a review verdict when the reviewer mutated the candidate", async () => {
  for (const stageId of ["dev-review", "final-review"]) {
    const directory = await mkdtemp(path.join(os.tmpdir(), `agent-harness-reviewer-mutation-${stageId}-`));
    try {
      const store = new JsonTaskStore(path.join(directory, "tasks.json"));
      await store.init();
      const task = await store.create({
        title: `Reject a mutating ${stageId}`,
        description: "A reviewer that dirties its worktree produced evidence about files that were never reviewed.",
        repositoryPath: directory,
        workflow: "implement",
        priority: "medium",
      });
      await store.update(task.id, (draft) => {
        draft.status = stageId === "final-review" ? "ready-for-final-review" : "ready-for-review";
        draft.currentStage = stageId;
        draft.completedStages = stageId === "final-review" ? ["dev-review", "test"] : [];
        draft.candidates = [{
          id: "C1",
          revisionNumber: 2,
          baseRevision: "a".repeat(40),
          baseBranch: "main",
          headRevision: "b".repeat(40),
          branch: "agent-harness/ah-001-c1",
          repositoryRoot: directory,
          worktreePath: directory,
          status: "under_review",
          createdAt: "2026-08-01T12:00:00.000Z",
          updatedAt: "2026-08-01T12:00:00.000Z",
          revisions: [],
        }];
      });

      // Clean before the agent, dirty after: HEAD never moved, so every exact-SHA
      // check still reports agreement. Only a post-run check catches this.
      let verifyCalls = 0;
      let recoverCalls = 0;
      const orchestrator = new TaskOrchestrator(store, {
        getStatus: async () => ({ available: true, authenticated: true, authMethod: "ChatGPT" }),
        worktreeManager: {
          verifyCandidate: async () => {
            verifyCalls += 1;
            if (verifyCalls > 1) throw new Error("The candidate worktree has uncommitted changes.");
          },
          recoverCandidate: async () => {
            recoverCalls += 1;
            return true;
          },
        },
        // A verdict the harness must not accept.
        runCodex: async () => ({
          finalText: gateOutput(2, "PASS"),
          usage: { inputTokens: 10, cachedInputTokens: 4, outputTokens: 5, totalTokens: 15 },
        }),
      });

      assert.equal(await orchestrator.start(task.id, stageId === "dev-review" ? "review" : "final-review"), true);
      const finished = await waitForStatus(
        store,
        task.id,
        stageId === "final-review" ? "ready-for-final-review" : "review-retry-required",
      );
      const run = finished.runs.find((entry) => entry.stage === stageId);

      assert.equal(verifyCalls, 2, `${stageId}: verified before and after the agent`);
      assert.equal(recoverCalls, 0, `${stageId}: a reviewer is never recovered, or the evidence of mutation is erased`);
      // Invalid evidence, not a failed review: the gate is not fresh, so it can
      // authorize neither a promotion nor a repair.
      assert.ok(run.evidenceError, `${stageId}: the run carries an evidence error`);
      assert.equal(run.freshness.fresh, false, stageId);
      assert.equal(finished.gateFreshness[stageId].fresh, false, stageId);
      assert.equal(run.gateResult.verdict, "REPAIR", stageId);
      assert.ok(
        run.gateResult.blockingReasons.some((reason) => /mutated the candidate it was reviewing/.test(reason)),
        `${stageId}: the mutation is recorded explicitly, not just as generic bad evidence`,
      );
      assert.ok(
        finished.events.some((event) => event.title === "Reviewer mutated the candidate"),
        stageId,
      );
      assert.equal(finished.completedStages.includes(stageId), false, `${stageId}: never completes on mutated evidence`);
    } finally {
      await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  }
});

test("sends byte-identical stage content whichever provider runs it", async () => {
  const prompts = new Map();
  for (const provider of ["codex", "claude"]) {
    const directory = await mkdtemp(path.join(os.tmpdir(), `agent-harness-prompt-parity-${provider}-`));
    try {
      const store = new JsonTaskStore(path.join(directory, "tasks.json"));
      await store.init();
      const task = await store.create({
        title: "Compare stage content across providers",
        description: "The stage prompt must not vary with the runtime that executes it.",
        repositoryPath: directory,
        workflow: "investigate",
        priority: "medium",
        model: provider === "claude" ? "claude-sonnet-5" : "gpt-5.6-luna",
        stagePolicies: defaultStagePolicies(provider),
      });
      const captured = [];
      const orchestrator = new TaskOrchestrator(store, {
        getStatus: async () => ({ available: true, authenticated: true, authMethod: "ChatGPT" }),
        worktreeManager: { verifyCandidate: async () => {} },
        runCodex: async (options) => {
          captured.push(options.prompt);
          return {
            finalText: /Grill/i.test(options.prompt)
              ? `## Grill\n\nNothing to settle.\n\n<grill-questions>{"questions":[]}</grill-questions>`
              : `## Triage\n\nGrounded.\n\n<scout-dispatch>{"scouts":[],"rationale":"Triage already identifies the complete code path."}</scout-dispatch>`,
            usage: { inputTokens: 10, cachedInputTokens: 4, outputTokens: 5, totalTokens: 15 },
          };
        },
      });
      assert.equal(await orchestrator.start(task.id), true);
      await waitForStatus(store, task.id, "awaiting-spec-approval");
      const stored = await store.get(task.id);
      assert.equal(stored.agentConfig.provider, provider);
      // Every run and reservation is bound to the task's provider.
      for (const run of stored.runs) assert.equal(run.provider, provider);
      for (const reservation of Object.values(stored.stageRunReservations)) {
        assert.equal(reservation.provider, provider);
      }
      prompts.set(provider, captured);
    } finally {
      await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  }

  // Stage instructions live in prompts.mjs alone. Splitting any of it into a
  // provider-specific channel would make the two providers' evidence incomparable.
  assert.ok(prompts.get("codex").length > 0);
  assert.deepEqual(prompts.get("claude"), prompts.get("codex"));
});

test("binds each stage's runs to that stage's own provider across a mixed task", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-mixed-providers-"));
  try {
    const store = new JsonTaskStore(path.join(directory, "tasks.json"));
    await store.init();
    // Claude gathering, Codex at the gate — the combination the operator asked for.
    const task = await store.create({
      title: "Mixed provider workflow",
      description: "Each stage reserves and runs on the provider its own model belongs to.",
      repositoryPath: directory,
      workflow: "implement",
      priority: "medium",
      stagePolicies: {
        ...defaultStagePolicies("claude"),
        "dev-review": { model: "gpt-5.6-sol", reasoning: "high" },
      },
    });
    await store.update(task.id, (draft) => {
      draft.status = "ready-for-review";
      draft.currentStage = "dev-review";
      draft.candidates = [{
        id: "C1",
        revisionNumber: 2,
        baseRevision: "a".repeat(40),
        baseBranch: "main",
        headRevision: "b".repeat(40),
        branch: "agent-harness/ah-001-c1",
        repositoryRoot: directory,
        worktreePath: directory,
        status: "under_review",
        createdAt: "2026-08-01T12:00:00.000Z",
        updatedAt: "2026-08-01T12:00:00.000Z",
        revisions: [],
      }];
    });

    const orchestrator = new TaskOrchestrator(store, {
      getStatus: async () => ({ available: true, authenticated: true, authMethod: "ChatGPT" }),
      worktreeManager: { verifyCandidate: async () => {} },
      runCodex: async () => ({
        finalText: gateOutput(2, "PASS"),
        usage: { inputTokens: 10, cachedInputTokens: 4, outputTokens: 5, totalTokens: 15 },
      }),
    });

    assert.equal(await orchestrator.start(task.id, "review"), true);
    const finished = await waitForStatus(store, task.id, "ready-for-test");
    const reservation = finished.stageRunReservations["dev-review"];
    const run = finished.runs.find((entry) => entry.stage === "dev-review");

    // The gate reserved and ran on Codex even though the task's other stages are Claude,
    // and the run's provider matches its reservation — a run can never execute on a
    // provider its reservation did not reserve.
    assert.equal(reservation.provider, "codex");
    assert.equal(run.provider, "codex");
    assert.equal(run.model, "gpt-5.6-sol");
    assert.equal(finished.agentConfig.stagePolicies.triage.model, "claude-sonnet-5");

    // Provider identity binds like candidate identity, so the gate is fresh only while
    // the run and its reservation agree.
    assert.equal(finished.gateFreshness["dev-review"].fresh, true);
    const tampered = await store.get(task.id);
    tampered.runs.find((entry) => entry.stage === "dev-review").provider = "claude";
    const recomputed = refreshGateFreshness(tampered);
    assert.equal(recomputed["dev-review"].fresh, false);
    assert.equal(recomputed["dev-review"].reasonCode, "provider_mismatch");
  } finally {
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test("recovers a stale process-local run lock only after durable reservation state is clear", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-stale-active-lock-"));
  let releaseTerminalUpdate = null;
  try {
    const store = new JsonTaskStore(path.join(directory, "tasks.json"));
    await store.init();
    const task = await store.create({
      title: "Recover terminal run lock",
      description: "A completed review must not strand the exact candidate before Test.",
      repositoryPath: directory,
      workflow: "implement",
      priority: "medium",
      stagePolicies: defaultStagePolicies("codex"),
    });
    await store.update(task.id, (draft) => {
      draft.status = "ready-for-review";
      draft.currentStage = "dev-review";
      draft.candidates = [{
        id: "C1",
        revisionNumber: 2,
        baseRevision: "a".repeat(40),
        baseBranch: "main",
        baseRef: "refs/heads/main",
        headRevision: "b".repeat(40),
        branch: "agent-harness/ah-stale-c1",
        repositoryRoot: directory,
        worktreePath: directory,
        status: "ready_for_review",
        createdAt: "2026-08-01T12:00:00.000Z",
        updatedAt: "2026-08-01T12:00:00.000Z",
        revisions: [],
        verificationRuns: [],
      }];
    });

    const durableUpdate = store.update.bind(store);
    let delayedTerminalUpdate = false;
    store.update = async (...args) => {
      const updated = await durableUpdate(...args);
      if (!delayedTerminalUpdate && updated?.status === "ready-for-test" && !updated.activeRunKind) {
        delayedTerminalUpdate = true;
        await new Promise((resolve) => {
          releaseTerminalUpdate = resolve;
        });
      }
      return updated;
    };

    const orchestrator = new TaskOrchestrator(store, {
      getStatus: async () => ({ available: true, authenticated: true, authMethod: "ChatGPT" }),
      worktreeManager: {
        verifyCandidate: async () => {},
        mergeState: async () => "pending",
        recoverCandidate: async () => {},
      },
      runVerification: passingVerification,
      runCodex: async (options) => ({
        finalText: options.prompt.includes("Development Review") ? gateOutput(2, "PASS") : "PASS",
        usage: { inputTokens: 10, cachedInputTokens: 4, outputTokens: 5, totalTokens: 15 },
      }),
    });

    assert.equal(await orchestrator.start(task.id, "review"), true);
    await waitForStatus(store, task.id, "ready-for-test");
    assert.equal(orchestrator.isRunning(task.id), true);

    assert.equal(await orchestrator.start(task.id, "test"), true);
    releaseTerminalUpdate();
    releaseTerminalUpdate = null;
    await waitForStatus(store, task.id, "ready-for-final-review");
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(orchestrator.isRunning(task.id), false);
  } finally {
    releaseTerminalUpdate?.();
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});
