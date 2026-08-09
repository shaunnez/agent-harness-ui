import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { TaskOrchestrator } from "../server/orchestrator.mjs";
import { defaultProfileStagePolicies } from "../server/model-catalog.mjs";
import { JsonTaskStore } from "../server/store.mjs";
import { parseGateEvidence } from "../server/structured-output.mjs";
import { fastEscalation, selectWorkflowProfile } from "../server/workflow-profiles.mjs";

const usage = { inputTokens: 100, cachedInputTokens: 60, outputTokens: 20, totalTokens: 120 };

function gateOutput(revision, verdict = "PASS", findings = []) {
  return `<gate-evidence>${JSON.stringify({
    candidateId: "C1",
    candidateRevision: revision,
    verdict,
    summary: "Complete candidate diff inspected.",
    findings: findings.map((finding) => ({ kind: "candidate-defect", ...finding })),
  })}</gate-evidence>`;
}

function fastContract() {
  return `# Bounded change

<scout-dispatch>{"scouts":[],"rationale":"The acceptance criteria and owned path are explicit."}</scout-dispatch>
<fast-change-contract>{"title":"Update one label","description":"Change the isolated label without changing its contract.","acceptanceCriteria":["The label reads Delivery state."],"ownedPaths":["src/components/StatusLabel.tsx"],"verificationCommandIds":["typecheck"],"unresolvedDecisions":[],"riskSignals":[]}</fast-change-contract>`;
}

function verification(candidate, executionKind) {
  const focused = executionKind === "focused-package";
  return {
    candidateId: candidate.id,
    candidateRevision: candidate.revisionNumber,
    bindingExplicit: true,
    headRevision: candidate.headRevision,
    command: `.agent-harness/verification.json: ${focused ? "typecheck" : "lint, typecheck, test, build"}`,
    executionKind,
    status: "passed",
    startedAt: "2026-08-09T00:00:00.000Z",
    completedAt: "2026-08-09T00:00:00.025Z",
    durationMs: 25,
    executedCommandIds: focused ? ["typecheck"] : ["lint", "typecheck", "test", "build"],
    declaredCommandIds: focused ? ["typecheck"] : ["lint", "typecheck", "test", "build"],
    rows: [{
      id: focused ? "typecheck" : "test",
      candidateId: candidate.id,
      candidateRevision: candidate.revisionNumber,
      bindingExplicit: true,
      command: focused ? "npm run typecheck" : "npm test",
      title: focused ? "TypeScript" : "Repository suite",
      status: "passed",
      durationMs: 25,
      exitCode: 0,
      output: "exit 0",
      artifactReferences: [],
      assertions: [{ label: "exit code", actual: "0", expected: "0" }],
      failureDetails: null,
    }],
  };
}

function worktreeManager(directory) {
  return {
    async base() {
      return { repositoryRoot: directory, baseRevision: "a".repeat(40), baseBranch: "main" };
    },
    async prepare(_task, id) {
      return {
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
      };
    },
    async commit(target) {
      return {
        headRevision: (target.id === "C1" ? "c" : "s").repeat(40),
        files: ["src/components/StatusLabel.tsx"],
        summary: "1 file changed",
        diff: "+Delivery state",
        ownSummary: "1 file changed",
        ownDiff: "+Delivery state",
      };
    },
    async assemble() {
      return {
        headRevision: "b".repeat(40),
        files: ["src/components/StatusLabel.tsx"],
        summary: "1 file changed",
        diff: "+Delivery state",
      };
    },
    async removeWorktree() {},
    async verifyCandidate() { return true; },
    async recoverCandidate() { return false; },
  };
}

async function waitFor(store, id, expected) {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    const task = await store.get(id);
    if (task.status === expected) return task;
    if (attempt > 5 && ["failed", "blocked", "cancelled"].includes(task.status) && task.status !== expected) {
      assert.fail(`Task stopped at ${task.status}: ${task.error ?? "no error"}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail(`Task did not reach ${expected}.`);
}

test("selects deterministic profiles and escalates fast at explicit boundaries", () => {
  assert.equal(selectWorkflowProfile({ title: "Fix a copy typo", description: "One small label." }).selected, "fast");
  assert.equal(selectWorkflowProfile({ title: "Add normal behavior", description: "Implement the requested outcome." }).selected, "standard");
  assert.equal(selectWorkflowProfile({ title: "Database migration", description: "Backfill the schema." }).selected, "high-risk");
  assert.equal(selectWorkflowProfile({ requestedProfile: "fast", title: "Auth copy", description: "Change authorization behavior." }).selected, "high-risk");
  assert.equal(fastEscalation({ profile: "fast", kind: "changed-paths", files: ["src/a.ts", "server/b.mjs"] }).target, "standard");
  assert.equal(fastEscalation({ profile: "fast", kind: "changed-paths", files: ["src/a.ts", "tests/a.test.mjs"] }), null);
  assert.equal(fastEscalation({ profile: "fast", kind: "changed-paths", files: ["server/security/policy.mjs"] }).target, "high-risk");
  assert.equal(fastEscalation({ profile: "fast", kind: "verification-failure" }).target, "standard");
  const policies = defaultProfileStagePolicies();
  assert.deepEqual(policies.fast.triage, { model: "gpt-5.6-luna", reasoning: "medium" });
  assert.deepEqual(policies.fast.implement, { model: "gpt-5.6-luna", reasoning: "high" });
  assert.deepEqual(policies.standard.implement, { model: "gpt-5.6-luna", reasoning: "xhigh" });
  assert.deepEqual(policies["high-risk"].plan, { model: "gpt-5.6-sol", reasoning: "high" });
});

test("keeps all blocking review findings and makes P2 advice non-blocking by default", () => {
  const result = parseGateEvidence(gateOutput(1, "REPAIR", [
    { severity: "P1", title: "Broken outcome", detail: "The label does not update.", reproductionEvidence: "Open the task and inspect the label.", candidateId: "C1", candidateRevision: 1 },
    { severity: "P1", title: "Missing keyboard path", detail: "The control is unreachable.", reproductionEvidence: "Tab from the header.", candidateId: "C1", candidateRevision: 1 },
    { severity: "P2", title: "Rename helper", detail: "A clearer name would help.", candidateId: "C1", candidateRevision: 1 },
  ]), { id: "C1", revisionNumber: 1 }, "dev-review");
  assert.equal(result.blockingReasons.length, 2);
  assert.deepEqual(result.findings.map((finding) => finding.blocking), [true, true, false]);
  const adviceOnly = parseGateEvidence(gateOutput(1, "REPAIR", [
    { severity: "P2", title: "Rename helper", detail: "A clearer name would help.", candidateId: "C1", candidateRevision: 1 },
  ]), { id: "C1", revisionNumber: 1 }, "dev-review");
  assert.equal(adviceOnly.verdict, "PASS", "maintainability advice cannot authorize candidate repair");
  assert.equal(adviceOnly.reportedVerdict, "REPAIR", "the inconsistent reviewer report remains auditable");
  const verificationGap = parseGateEvidence(gateOutput(1, "PASS", [{
    kind: "verification-gap",
    severity: "P1",
    title: "Exact-candidate test has not run yet",
    detail: "The later Harness Test gate owns this evidence.",
    blocking: true,
    acceptanceCriterion: "Repository verification passes.",
    reproductionEvidence: "No Test artifact exists yet.",
    candidateId: "C1",
    candidateRevision: 1,
  }]), { id: "C1", revisionNumber: 1 }, "dev-review");
  assert.equal(verificationGap.verdict, "PASS");
  assert.equal(verificationGap.findings[0].blocking, false, "verification gaps cannot authorize candidate Repair");
  assert.throws(
    () => parseGateEvidence(`<gate-evidence>${JSON.stringify({
      candidateId: "C1", candidateRevision: 1, verdict: "REPAIR", findings: [{
        kind: "candidate-defect",
        severity: "P1", title: "No reproduction", detail: "A claim without exact reproduction.",
        candidateId: "C1", candidateRevision: 1,
      }],
    })}</gate-evidence>`, { id: "C1", revisionNumber: 1 }, "dev-review"),
    /must include deterministic reproductionEvidence/,
  );
});

test("fast path uses zero scouts, one package, focused checks, one full manifest, and deterministic final review", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-fast-path-"));
  try {
    const store = new JsonTaskStore(path.join(directory, "tasks.json"));
    await store.init();
    const task = await store.create({
      title: "Update one small label",
      description: "A narrow isolated copy change.",
      repositoryPath: directory,
      workflow: "implement",
      priority: "low",
      workflowProfile: selectWorkflowProfile({ requestedProfile: "fast", title: "Update one small label" }),
    });
    const calls = [];
    let focusedExecutions = 0;
    let fullExecutions = 0;
    const orchestrator = new TaskOrchestrator(store, {
      getStatus: async () => ({ available: true, authenticated: true, authMethod: "ChatGPT" }),
      worktreeManager: worktreeManager(directory),
      runPackageVerification: async ({ workPackageId, attempt, headRevision }) => {
        focusedExecutions += 1;
        return verification({ id: `${workPackageId}-A${attempt}`, revisionNumber: attempt, headRevision }, "focused-package");
      },
      runVerification: async ({ candidate }) => {
        fullExecutions += 1;
        return verification(candidate, "full-manifest");
      },
      runCodex: async (options) => {
        calls.push(options);
        const finalText = options.sandbox === "workspace-write"
          ? "## Outcome\n\nChanged the one owned label."
          : /Development review/i.test(options.prompt)
            ? gateOutput(1)
            : fastContract();
        return { finalText, usage };
      },
    });

    assert.equal(await orchestrator.start(task.id), true);
    let current = await waitFor(store, task.id, "awaiting-plan-approval");
    assert.equal(current.scoutDispatch.selected.length, 0);
    assert.equal(current.artifacts.some((artifact) => artifact.stage === "scouts"), false);
    assert.deepEqual(current.completedStages, ["triage"]);
    assert.deepEqual(Object.keys(current.stageDispositions).sort(), ["grill", "plan", "scouts", "specification"]);
    assert.equal(current.workPackages.length, 1);
    assert.deepEqual(current.workPackages[0].verificationCommandIds, ["typecheck"]);

    await orchestrator.approvePlan(task.id);
    assert.equal(await orchestrator.start(task.id, "implementation"), true);
    await waitFor(store, task.id, "ready-for-review");
    assert.equal(await orchestrator.start(task.id, "review"), true);
    await waitFor(store, task.id, "ready-for-test");
    assert.equal(await orchestrator.start(task.id, "test"), true);
    current = await waitFor(store, task.id, "awaiting-human-approval");

    assert.equal(focusedExecutions, 1);
    assert.equal(fullExecutions, 1);
    assert.equal(calls.length, 3, "triage, implementation, and independent Dev Review are the only model calls");
    assert.deepEqual(calls.map((call) => call.reasoning), ["medium", "high", "high"]);
    assert.equal(current.candidates[0].verificationRuns.length, 1);
    assert.equal(current.workPackages[0].verificationRuns.length, 1);
    assert.equal(current.artifacts.find((artifact) => artifact.stage === "test").model, null);
    assert.equal(current.artifacts.find((artifact) => artifact.stage === "final-review").model, null);
    assert.equal(current.stageDispositions["final-review"].status, "deterministic");
    assert.equal(current.gateFreshness["dev-review"].fresh, true);
    assert.equal(current.gateFreshness.test.fresh, true);
    assert.equal(current.gateFreshness["final-review"].fresh, true, JSON.stringify(current.gateFreshness["final-review"]));
  } finally {
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 25 });
  }
});

test("late fast scope expansion returns to the standard evidence frontier", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-fast-replan-"));
  try {
    const store = new JsonTaskStore(path.join(directory, "tasks.json"));
    await store.init();
    const task = await store.create({
      title: "Update one small label",
      description: "Change one isolated label.",
      repositoryPath: directory,
      workflow: "implement",
      priority: "low",
      workflowProfile: selectWorkflowProfile({ requestedProfile: "fast", title: "Update one small label" }),
    });
    const manager = worktreeManager(directory);
    manager.commit = async (target) => ({
      headRevision: (target.id === "C1" ? "c" : "s").repeat(40),
      files: ["src/components/StatusLabel.tsx", "server/status-label.mjs"],
      summary: "2 files changed",
      diff: "+Delivery state",
      ownSummary: "2 files changed",
      ownDiff: "+Delivery state",
    });
    const orchestrator = new TaskOrchestrator(store, {
      getStatus: async () => ({ available: true, authenticated: true, authMethod: "ChatGPT" }),
      worktreeManager: manager,
      runCodex: async (options) => ({
        finalText: options.sandbox === "workspace-write" ? "## Outcome\n\nChanged two production boundaries." : fastContract(),
        usage,
      }),
    });

    await orchestrator.start(task.id);
    await waitFor(store, task.id, "awaiting-plan-approval");
    await orchestrator.approvePlan(task.id);
    await orchestrator.start(task.id, "implementation");
    const escalated = await waitFor(store, task.id, "failed");

    assert.equal(escalated.workflowProfile.selected, "standard");
    assert.equal(escalated.currentStage, "scouts");
    assert.deepEqual(escalated.stageDispositions, {});
    assert.equal(escalated.workPackages[0].status, "failed");
    assert.equal(escalated.candidates.length, 0, "no integration candidate is fabricated from the over-broad slice");
    assert.match(escalated.error, /Resume investigation/);
    assert.match(escalated.events.at(-1).title, /Full workflow evidence required/);
  } finally {
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test("reuses one full-manifest execution when a same-revision Test model call retries", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-manifest-cache-"));
  try {
    const store = new JsonTaskStore(path.join(directory, "tasks.json"));
    await store.init();
    const task = await store.create({ title: "Standard test retry", description: "Normal behavior.", repositoryPath: directory, workflow: "implement", priority: "medium" });
    await store.update(task.id, (draft) => {
      draft.status = "ready-for-test";
      draft.currentStage = "test";
      draft.candidates = [{
        id: "C1", revisionNumber: 1, baseRevision: "a".repeat(40), baseBranch: "main",
        headRevision: "b".repeat(40), branch: "agent-harness/c1", repositoryRoot: directory,
        worktreePath: directory, status: "ready_for_test", createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(), revisions: [{ number: 1, headRevision: "b".repeat(40), reason: "assembly", createdAt: new Date().toISOString() }],
        verificationRuns: [],
      }];
    });
    let manifestExecutions = 0;
    let modelAttempts = 0;
    const orchestrator = new TaskOrchestrator(store, {
      getStatus: async () => ({ available: true, authenticated: true, authMethod: "ChatGPT" }),
      worktreeManager: worktreeManager(directory),
      runVerification: async ({ candidate }) => {
        manifestExecutions += 1;
        return verification(candidate, "full-manifest");
      },
      runCodex: async () => {
        modelAttempts += 1;
        if (modelAttempts === 1) throw new Error("Interpreter transport failed.");
        return { finalText: "The recorded manifest passed.", usage };
      },
    });

    assert.equal(await orchestrator.start(task.id, "test"), true);
    await waitFor(store, task.id, "failed");
    assert.equal(await orchestrator.start(task.id, "test"), true);
    const finished = await waitFor(store, task.id, "ready-for-final-review");
    assert.equal(manifestExecutions, 1);
    assert.equal(finished.candidates[0].verificationRuns.length, 1);
    assert.ok(finished.events.some((event) => event.title === "Full verification manifest reused"));
  } finally {
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 25 });
  }
});

test("fast review allows one automatic consolidated repair, invalidates old evidence, then stops on a second defect", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-fast-repair-limit-"));
  try {
    const store = new JsonTaskStore(path.join(directory, "tasks.json"));
    await store.init();
    const task = await store.create({
      title: "Small label repair", description: "A narrow copy change.", repositoryPath: directory,
      workflow: "implement", priority: "low",
      workflowProfile: selectWorkflowProfile({ requestedProfile: "fast", title: "Small label repair" }),
    });
    await store.update(task.id, (draft) => {
      draft.status = "ready-for-review";
      draft.currentStage = "dev-review";
      draft.candidates = [{
        id: "C1", revisionNumber: 1, baseRevision: "a".repeat(40), baseBranch: "main",
        headRevision: "b".repeat(40), branch: "agent-harness/c1", repositoryRoot: directory,
        worktreePath: directory, status: "ready_for_review", createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(), revisions: [{ number: 1, headRevision: "b".repeat(40), reason: "assembly", createdAt: new Date().toISOString() }],
        verificationRuns: [],
      }];
    });
    let reviews = 0;
    let repairPrompt = "";
    const callPolicies = [];
    const blockingFindings = (revision) => [
      { severity: "P1", title: "Wrong label", detail: "The acceptance text is absent.", acceptanceCriterion: "The label reads Delivery state.", reproductionEvidence: "Open StatusLabel and observe the old text.", candidateId: "C1", candidateRevision: revision },
      { severity: "P1", title: "Missing assertion", detail: "No regression assertion covers the label.", acceptanceCriterion: "The label reads Delivery state.", reproductionEvidence: "Run the focused component test and inspect its assertions.", candidateId: "C1", candidateRevision: revision },
    ];
    const orchestrator = new TaskOrchestrator(store, {
      getStatus: async () => ({ available: true, authenticated: true, authMethod: "ChatGPT" }),
      worktreeManager: worktreeManager(directory),
      runCodex: async (options) => {
        callPolicies.push(`${options.model}:${options.reasoning}`);
        if (/candidate Repair agent/.test(options.prompt)) {
          repairPrompt = options.prompt;
          return { finalText: "## Outcome\n\nRepaired both consolidated findings.", usage };
        }
        reviews += 1;
        return { finalText: gateOutput(reviews, "REPAIR", blockingFindings(reviews)), usage };
      },
    });

    assert.equal(await orchestrator.start(task.id, "review"), true);
    const finished = await waitFor(store, task.id, "blocked");
    assert.equal(finished.automaticRepairCycles, 1);
    assert.equal(finished.candidates[0].revisionNumber, 2);
    assert.equal(finished.candidates[0].revisions.filter((revision) => revision.reason === "repair").length, 1);
    assert.equal(finished.artifacts.filter((artifact) => artifact.stage === "dev-review").length, 2);
    assert.equal(finished.runs.filter((run) => run.stage === "dev-review").length, 2);
    assert.equal(finished.runs.find((run) => run.candidateRevision === 1).freshness.fresh, false);
    assert.match(repairPrompt, /Wrong label/);
    assert.match(repairPrompt, /Missing assertion/);
    assert.match(repairPrompt, /Open StatusLabel and observe the old text/);
    assert.deepEqual(callPolicies, ["gpt-5.6-sol:high", "gpt-5.6-luna:high", "gpt-5.6-sol:high"]);
    assert.match(finished.error, /one automatic candidate-repair cycle/i);
  } finally {
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 25 });
  }
});
