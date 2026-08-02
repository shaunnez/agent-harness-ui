import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { evaluationVerdict, TaskOrchestrator } from "../server/orchestrator.mjs";
import { buildExecutionPrompt } from "../server/prompts.mjs";
import { JsonTaskStore } from "../server/store.mjs";
import { parseFocusedTestEvidence, parseGrillQuestions, parseWorkPackages, validateFocusedTestEvidence } from "../server/structured-output.mjs";

const GRILL_OUTPUT = `## Settled facts\n\nGrounded.\n\n<grill-questions>\n{"questions":[{"question":"Compatibility?","whyItMatters":"Changes the public contract.","options":[{"label":"Preserve it","description":"Keep existing clients working.","recommended":true},{"label":"Break it","description":"Allow a clean break.","recommended":false}],"allowCustom":true}]}\n</grill-questions>`;
const PLAN_OUTPUT = `## Plan summary\n\nTwo independent slices.\n\n<work-packages>\n{"packages":[{"id":"S1","title":"Runtime","description":"Implement runtime behavior.","dependencies":[],"ownedPaths":["server/runtime.mjs"],"verification":["npm test"]},{"id":"S2","title":"UI","description":"Implement the task UI.","dependencies":[],"ownedPaths":["src/App.tsx"],"verification":["npm run typecheck"]}]}\n</work-packages>`;
const TEST_OUTPUT = `PASS\n\n## Verdict\n\nPASS\n\n<focused-test-evidence>\n{"candidateId":"C1","candidateRevision":2,"command":"npm.cmd run test:orchestrator","status":"passed","startedAt":"2026-08-01T12:00:00.000Z","completedAt":"2026-08-01T12:00:01.240Z","durationMs":1240,"rows":[{"id":"row-1","candidateId":"C1","candidateRevision":2,"command":"npm.cmd run test:orchestrator","status":"passed","durationMs":1240,"title":"orchestrator.test.mjs","artifactReferences":[{"name":"Markdown test artifact","kind":"markdown","path":"artifacts/test.md"}],"assertions":[{"label":"all packages qualified","actual":"pass","expected":"pass"}],"failureDetails":null},{"id":"row-2","candidateId":"C1","candidateRevision":2,"command":"npm.cmd run test:orchestrator","status":"passed","durationMs":350,"title":"api.test.mjs","artifactReferences":[{"name":"JUnit report","kind":"junit","path":"artifacts/junit.xml"}],"assertions":[{"label":"API contract","actual":"pass","expected":"pass"}],"failureDetails":null}]}\n</focused-test-evidence>`;

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
  const packages = parseWorkPackages(`<work-packages>{"packages":[{"id":"S1","title":"API","description":"Add API.","dependencies":[],"ownedPaths":["server/api.mjs"],"verification":[]},{"id":"S2","title":"UI","description":"Add UI.","dependencies":[],"ownedPaths":["src/App.tsx"],"verification":[]},{"id":"S3","title":"Contract","description":"Join both.","dependencies":["S1","S2"],"ownedPaths":["tests/contract.test.mjs"],"verification":[]}]}</work-packages>`);
  assert.deepEqual(packages.map((item) => item.batch), [1, 1, 2]);
  assert.deepEqual(packages.find((item) => item.id === "S3")?.dependencies, ["S1", "S2"]);
  const absolute = parseWorkPackages(
    `<work-packages>{"packages":[{"id":"S1","title":"API","description":"Add API.","dependencies":[],"ownedPaths":["C:/repo/server/api.mjs"],"verification":[]}]}</work-packages>`,
    "C:/repo",
  );
  assert.deepEqual(absolute[0].ownedPaths, ["server/api.mjs"]);
  assert.throws(
    () =>
      parseWorkPackages(
        `<work-packages>{"packages":[{"id":"S1","title":"Escape","description":"Escape repo.","dependencies":[],"ownedPaths":["C:/outside/file.mjs"],"verification":[]}]}</work-packages>`,
        "C:/repo",
      ),
    /outside the selected repository/,
  );
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
    /does not match the active candidate revision/i,
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

test("builds the focused test execution prompt with the structured evidence contract and Windows command rule", () => {
  const prompt = buildExecutionPrompt(
    {
      id: "AH-014",
      title: "Structure focused-test evidence",
      description: "Normalize focused test evidence.",
      decisions: [],
      artifacts: [],
    },
    "test",
    {
      id: "C1",
      revisionNumber: 2,
      baseRevision: "a".repeat(40),
      headRevision: "b".repeat(40),
    },
  );
  assert.match(prompt, /<focused-test-evidence>/);
  assert.match(prompt, /On Windows PowerShell, run every verification command separately with npm\.cmd/);
  assert.match(prompt, /never chain them with Bash-style &&, invoke npm\.ps1, or use npm test -- <file>/);
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

test("runs independent work packages concurrently before candidate assembly", async () => {
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
      draft.workPackages = parseWorkPackages(PLAN_OUTPUT);
    });
    let activeAgents = 0;
    let maximumActiveAgents = 0;
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
          headRevision: (slice.id.startsWith("S1") ? "b" : "c").repeat(40),
          files: [`${slice.id}.txt`],
          summary: "1 file changed",
          diff: "+change",
          ownSummary: "1 file changed",
          ownDiff: "+change",
        }),
        assemble: async () => ({
          headRevision: "d".repeat(40),
          files: ["S1.txt", "S2.txt"],
          summary: "2 files changed",
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
          if (releases.length === 2) releases.forEach((release) => release());
        });
        activeAgents -= 1;
        return {
          finalText: "## Outcome\n\nReady",
          usage: { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1, totalTokens: 2 },
        };
      },
    });

    assert.equal(await orchestrator.start(task.id, "implementation"), true);
    const finished = await waitForStatus(store, task.id, "ready-for-review");
    assert.equal(maximumActiveAgents, 2);
    assert.deepEqual(finished.candidates[0].members.map((member) => member.packageId), ["S1", "S2"]);
  } finally {
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test("fails a test verdict closed when any verification command fails", () => {
  assert.equal(
    evaluationVerdict("test", {
      finalText: "PASS\n\n## Verdict\n\nPASS",
      runtimeEvents: [{ commandFailed: true }],
    }),
    "REPAIR",
  );
  assert.equal(evaluationVerdict("dev-review", { finalText: "PASS", runtimeEvents: [{ commandFailed: true }] }), "PASS");
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
    assert.deepEqual(finished.completedStages, ["triage", "scouts"]);
    assert.equal(finished.artifacts.length, 5);
    assert.equal(finished.grillSession.questions.length, 1);
    await orchestrator.answerGrillQuestion(task.id, { questionId: "Q1", answer: "Preserve it" });
    await orchestrator.finishGrill(task.id);
    finished = await waitForStatus(store, task.id, "awaiting-spec-approval");
    assert.deepEqual(finished.completedStages, ["triage", "scouts", "grill", "specification"]);
    assert.equal(finished.artifacts.length, 6);
    assert.equal(finished.usage.totalTokens, 75);
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
    let reviewCount = 0;
    let verifyCount = 0;
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
    };
    const orchestrator = new TaskOrchestrator(store, {
      getStatus: async () => ({ available: true, authenticated: true, authMethod: "ChatGPT" }),
      worktreeManager,
      runCodex: async (options) => {
        const { prompt } = options;
        runtimeCalls.push(options);
        let finalText = "## Outcome\n\nReady";
        if (/<scout-report>/.test(prompt)) finalText = SCOUT_OUTPUT;
        if (/<grill-questions>/.test(prompt)) finalText = GRILL_OUTPUT;
        if (/<work-packages>/.test(prompt)) finalText = PLAN_OUTPUT;
        if (/Development review/.test(prompt)) {
          reviewCount += 1;
          finalText = reviewCount === 1 ? "REPAIR\n\n## Verdict\n\nREPAIR" : "PASS\n\n## Verdict\n\nPASS";
        } else if (/Focused test|Final review/.test(prompt)) {
          finalText = TEST_OUTPUT;
        }
        return {
          finalText,
          usage: { inputTokens: 10, cachedInputTokens: 4, outputTokens: 5, totalTokens: 15 },
        };
      },
    });

    await orchestrator.start(task.id);
    await waitForStatus(store, task.id, "awaiting-grill");
    await orchestrator.answerGrillQuestion(task.id, { questionId: "Q1", answer: "Keep it backwards compatible." });
    await orchestrator.finishGrill(task.id);
    await waitForStatus(store, task.id, "awaiting-spec-approval");
    await orchestrator.approveSpecification(task.id);
    await waitForStatus(store, task.id, "awaiting-plan-approval");
    await orchestrator.approvePlan(task.id);
    assert.equal((await store.get(task.id)).status, "ready-for-implementation");

    await orchestrator.start(task.id, "implementation");
    await waitForStatus(store, task.id, "ready-for-review");
    await orchestrator.start(task.id, "review");
    await waitForStatus(store, task.id, "repair-required");
    await orchestrator.start(task.id, "repair");
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
    assert.equal(approvalTask.artifacts.length, 15);
    const testCall = runtimeCalls.find((call) => /Focused test/.test(call.prompt));
    assert.equal(testCall.sandbox, "workspace-write");
    assert.equal(testCall.tempDirectory, path.join(directory, "C1", ".data", "runtime-temp"));
    assert.equal(verifyCount, 6, "test must verify the candidate both before and after execution");
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
    await orchestrator.approveMerge(task.id);
    const complete = await store.get(task.id);
    assert.equal(complete.status, "completed");
    assert.equal(complete.candidates[0].status, "merged");
    assert.equal(complete.artifacts.length, 16);
    assert.equal(complete.artifacts.at(-1).stage, "approval");
    assert.equal(complete.artifacts.at(-1).candidateId, "C1");
    assert.equal(complete.artifacts.at(-1).candidateRevision, 2);
    assert.match(complete.artifacts.at(-1).content, /Merge method: fast-forward only/);
    assert.match(complete.artifacts.at(-1).content, new RegExp(`Merged revision: ${"c".repeat(40)}`));
    assert.equal(complete.mergeIntent.status, "completed");
    assert.equal(complete.approvals.filter((approval) => approval.stage === "approval").length, 1);
    await assert.rejects(() => orchestrator.approveMerge(task.id), /not awaiting merge approval/i);
    assert.equal(merged, true);
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
    for (let attempt = 0; !release && attempt < 100; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.equal(typeof release, "function");
    assert.equal(orchestrator.cancel(task.id), true);
    release();
    await waitForStatus(store, task.id, "cancelled");
  } finally {
    await rm(directory, { recursive: true, force: true });
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
    assert.equal(recovered.status, "completed");
    assert.equal(recovered.mergeIntent.status, "completed");
    assert.equal(recovered.approvals.filter((approval) => approval.stage === "approval").length, 1);
    assert.equal(mergeCalls, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

async function waitForStatus(store, id, expected) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const task = await store.get(id);
    if (task.status === expected) return task;
    if (attempt > 5 && ["failed", "blocked", "cancelled", "repair-required"].includes(task.status)) {
      assert.fail(`Task stopped at ${task.status}: ${task.error ?? "no error"}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail(`Task did not reach ${expected}.`);
}
