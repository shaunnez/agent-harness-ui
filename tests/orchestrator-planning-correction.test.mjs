import test from "node:test";
import { withActionEligibility } from "../server/retry-admission-policy.mjs";
import { PlanAuthorityOrchestrator } from "../server/orchestrator-plan-authority.mjs";
import {
  assert,
  JsonTaskStore,
  makeFocusedTestSummary,
  makeTestRow,
  mkdtemp,
  os,
  path,
  rm,
  TaskOrchestrator,
  waitForStatus,
} from "./orchestrator-test-support.mjs";

test("a blocked planning prerequisite cannot create or advance an implementation candidate", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-plan-prerequisite-"));
  try {
    const store = new JsonTaskStore(path.join(directory, "tasks.json"));
    await store.init();
    const task = await store.create({
      title: "Analyse protected records",
      description: "Read the exact records before making a judgement.",
      repositoryPath: directory,
      workflow: "implement",
      priority: "high",
    });
    await store.update(task.id, (draft) => {
      draft.status = "awaiting-spec-approval";
      draft.currentStage = "specification";
    });
    let attempt = 0;
    const blockedOutput = `<work-packages>${JSON.stringify({
      disposition: "blocked-prerequisite",
      evidence: [{ path: "scripts/export-records.py", detail: "The repository uses this exporter." }],
      blocker: {
        code: "external-data-unavailable",
        detail: "The required database records are unavailable inside the sandbox.",
        requiredAction: "Attach a trusted read-only export, then recheck planning.",
      },
      packages: [],
    })}</work-packages>`;
    const readyOutput = `<work-packages>${JSON.stringify({
      disposition: "changes-required",
      evidence: [],
      packages: [
        {
          id: "S1",
          title: "Produce the assessment",
          description: "Use the supplied records to produce the requested assessment.",
          dependencies: [],
          ownedPaths: ["docs/assessment.md"],
          verificationCommandIds: ["test"],
        },
      ],
    })}</work-packages>`;
    const orchestrator = new TaskOrchestrator(store, {
      readVerificationManifest: async () => ({
        source: ".agent-harness/verification.json",
        commands: [{ id: "test", command: ["npm", "test"] }],
      }),
      getStatus: async () => ({ available: true, authenticated: true, authMethod: "ChatGPT" }),
      runCodex: async () => ({
        finalText: attempt++ === 0 ? blockedOutput : readyOutput,
        model: "gpt-5.6-sol",
        reasoning: "high",
        usage: { inputTokens: 10, cachedInputTokens: 0, outputTokens: 5, totalTokens: 15 },
      }),
    });

    assert.deepEqual(await orchestrator.approveSpecification(task.id), {
      started: true,
      completed: false,
    });
    let current = await waitForStatus(store, task.id, "blocked");
    assert.equal(current.currentStage, "plan");
    assert.equal(current.blocker.code, "plan-prerequisite");
    assert.equal(current.blocker.prerequisiteCode, "external-data-unavailable");
    assert.match(current.blocker.requiredAction, /trusted read-only export/);
    assert.equal(current.planResult.disposition, "blocked-prerequisite");
    assert.equal(current.workPackages.length, 0);
    assert.equal(current.candidates.length, 0);
    assert.match(current.events.at(-1).title, /blocked by a prerequisite/);

    assert.deepEqual(await orchestrator.resumePlanningAfterPrerequisite(task.id), { started: true });
    current = await waitForStatus(store, task.id, "awaiting-plan-approval");
    assert.equal(current.blocker, null);
    assert.equal(current.error, null);
    assert.equal(current.planResult.disposition, "changes-required");
    assert.equal(current.workPackages.length, 1);
    assert.equal(current.candidates.length, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
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
      draft.workPackages = [
        {
          id: "S1",
          title: "Rejected scope",
          description: "Wrong plan.",
          dependencies: [],
          batch: 1,
          ownedPaths: ["wrong/path.ts"],
          verification: [],
          status: "planned",
          attempts: 0,
        },
      ];
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
      readVerificationManifest: async () => ({
        source: ".agent-harness/verification.json",
        commands: [{ id: "test", command: ["npm", "test"] }],
      }),
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
    assert.deepEqual(
      revised.workPackages.map((item) => item.ownedPaths),
      [["src/correct.ts"]],
    );
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
      draft.workPackages = [
        {
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
        },
      ];
    });
    const revisedOutput = `<work-packages>{"packages":[{"id":"S1","title":"Browser contract","description":"Retain the exact committed browser change.","dependencies":[],"ownedPaths":["e2e/example.spec.ts"],"verificationCommandIds":["playwright-e2e"]}]}</work-packages>`;
    const orchestrator = new TaskOrchestrator(store, {
      worktreeManager: {
        retainedPatchDisposition: async () => "pending",
      },
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

test("revalidates the plan after a fixed repository baseline and requalifies the retained package without reimplementing it", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-baseline-revalidate-"));
  try {
    const store = new JsonTaskStore(path.join(directory, "tasks.json"));
    await store.init();
    const task = await store.create({
      title: "Recheck a fixed repository baseline",
      description: "The repository baseline command that failed at plan time has since been fixed.",
      repositoryPath: directory,
      workflow: "implement",
      priority: "high",
    });
    const staleRevision = "a".repeat(40);
    const packageHead = "b".repeat(40);
    const fixedRevision = "c".repeat(40);
    const candidateRevision = "d".repeat(40);
    await store.update(task.id, (draft) => {
      draft.status = "blocked";
      draft.currentStage = "implement";
      draft.error =
        "Repository baseline verification failed for test at aaaaaaaaaaaa. The same command fails before S1's changes, so retrying the retained slice cannot repair it.";
      draft.blocker = {
        code: "repository-baseline-verification",
        detail: draft.error,
        detectedAt: new Date().toISOString(),
        workPackageId: "S1",
        baselineVerification: { revision: staleRevision, commandIds: ["test"] },
      };
      draft.repositoryAuthority = {
        id: "authority-stale",
        selectedRevision: staleRevision,
        checkoutBranch: "main",
        targetRef: "refs/heads/main",
      };
      draft.planResult = {
        artifactId: "implementation-plan.md",
        disposition: "changes-required",
        changesRemainNecessary: true,
        repositoryAuthorityId: "authority-stale",
        repositoryRevision: staleRevision,
        repositoryTargetRef: "refs/heads/main",
      };
      draft.workPackages = [
        {
          id: "S1",
          title: "Retained slice",
          description: "Requalify this exact committed change once the baseline is fixed.",
          dependencies: [],
          batch: 1,
          ownedPaths: ["src/change.ts"],
          verification: [],
          verificationCommandIds: ["test"],
          verificationRuns: [{ status: "failed" }],
          status: "failed",
          attempts: 1,
          branch: "agent-harness/old-slice",
          worktreePath: directory,
          baseRevision: staleRevision,
          headRevision: packageHead,
          files: ["src/change.ts"],
          error: draft.error,
        },
      ];
    });
    const revisedOutput = `<work-packages>{"packages":[{"id":"S1","title":"Retained slice","description":"Requalify this exact committed change once the baseline is fixed.","dependencies":[],"ownedPaths":["src/change.ts"],"verificationCommandIds":["test"]}]}</work-packages>`;
    const qualification = {
      ...makeFocusedTestSummary({ candidateId: "S1", candidateRevision: 2 }),
      headRevision: packageHead,
      executionKind: "focused-package",
    };
    let modelCalls = 0;
    const orchestrator = new TaskOrchestrator(store, {
      repositoryAuthorityService: {
        capture: async () => ({
          id: "authority-fixed",
          selectedRevision: fixedRevision,
          checkoutBranch: "main",
          targetRef: "refs/heads/main",
          capturedAt: new Date().toISOString(),
          upstreamRef: null,
          remoteVerification: { status: "not-configured", error: null },
        }),
      },
      readVerificationManifest: async () => ({
        source: ".agent-harness/verification.json",
        commands: [{ id: "test", command: ["npm", "test"] }],
      }),
      runCodex: async () => {
        modelCalls += 1;
        return {
          finalText: revisedOutput,
          model: "gpt-5.6-sol",
          reasoning: "high",
          usage: { inputTokens: 10, cachedInputTokens: 0, outputTokens: 5, totalTokens: 15 },
        };
      },
      runPackageVerification: async () => qualification,
      worktreeManager: {
        retainedPatchDisposition: async () => "pending",
        base: async () => ({ repositoryRoot: directory, baseRevision: fixedRevision, baseBranch: "main" }),
        inspectRetainedSlice: async () => ({
          branch: "agent-harness/old-slice",
          files: ["src/change.ts"],
          headRevision: packageHead,
          worktreePath: directory,
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
          files: ["src/change.ts"],
          summary: "1 file changed",
          diff: "",
        }),
      },
    });

    assert.deepEqual(await orchestrator.revalidatePlan(task.id), { started: true });
    const revalidated = await waitForStatus(store, task.id, "awaiting-plan-approval");
    assert.equal(modelCalls, 1);
    assert.equal(revalidated.planResult.repositoryRevision, fixedRevision);
    assert.equal(revalidated.workPackages[0].retainedForRequalification, true);
    assert.equal(revalidated.workPackages[0].headRevision, packageHead);
    assert.equal(revalidated.blocker, null);

    await orchestrator.approvePlan(task.id);
    assert.equal((await store.get(task.id)).status, "ready-for-implementation");
    await orchestrator.start(task.id, "implementation");
    const ready = await waitForStatus(store, task.id, "ready-for-review");
    assert.equal(
      modelCalls,
      1,
      "the retained package must requalify without another model implementation run",
    );
    assert.equal(ready.blocker, null);
    assert.equal(ready.workPackages[0].status, "integrated");
    assert.equal(ready.repositoryAuthority.selectedRevision, fixedRevision);
    const retainedRun = ready.runs.find((run) => run.source === "harness-requalification");
    assert.equal(retainedRun.status, "completed");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("requalifies a retained package against the current plan base, not its stale original base", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-requalify-current-base-"));
  try {
    const store = new JsonTaskStore(path.join(directory, "tasks.json"));
    await store.init();
    const task = await store.create({
      title: "Requalify against the current base",
      description: "A fix landed on main after this package's original base was recorded.",
      repositoryPath: directory,
      workflow: "implement",
      priority: "high",
    });
    const staleRevision = "a".repeat(40);
    const packageHead = "b".repeat(40);
    const fixedRevision = "c".repeat(40);
    const candidateRevision = "d".repeat(40);
    await store.update(task.id, (draft) => {
      draft.status = "blocked";
      draft.currentStage = "implement";
      draft.error =
        "Repository baseline verification failed for test at aaaaaaaaaaaa. The same command fails before S1's changes, so retrying the retained slice cannot repair it.";
      draft.blocker = {
        code: "repository-baseline-verification",
        detail: draft.error,
        detectedAt: new Date().toISOString(),
        workPackageId: "S1",
        baselineVerification: { revision: staleRevision, commandIds: ["test"] },
      };
      draft.repositoryAuthority = {
        id: "authority-stale",
        selectedRevision: staleRevision,
        checkoutBranch: "main",
        targetRef: "refs/heads/main",
      };
      draft.planResult = {
        artifactId: "implementation-plan.md",
        disposition: "changes-required",
        changesRemainNecessary: true,
        repositoryAuthorityId: "authority-stale",
        repositoryRevision: staleRevision,
        repositoryTargetRef: "refs/heads/main",
      };
      draft.workPackages = [
        {
          id: "S1",
          title: "Retained slice",
          description: "Requalify this exact committed change once the baseline is fixed.",
          dependencies: [],
          batch: 1,
          ownedPaths: ["src/change.ts"],
          verification: [],
          verificationCommandIds: ["test"],
          verificationRuns: [{ status: "failed" }],
          status: "failed",
          attempts: 1,
          branch: "agent-harness/old-slice",
          worktreePath: directory,
          // The package's own base predates the fix on main. Requalification must not
          // check the repository baseline here — it must use the current plan's base.
          baseRevision: staleRevision,
          headRevision: packageHead,
          files: ["src/change.ts"],
          error: draft.error,
        },
      ];
    });
    const revisedOutput = `<work-packages>{"packages":[{"id":"S1","title":"Retained slice","description":"Requalify this exact committed change once the baseline is fixed.","dependencies":[],"ownedPaths":["src/change.ts"],"verificationCommandIds":["test"]}]}</work-packages>`;
    const baselineCalls = [];
    let modelCalls = 0;
    const orchestrator = new TaskOrchestrator(store, {
      repositoryAuthorityService: {
        capture: async () => ({
          id: "authority-fixed",
          selectedRevision: fixedRevision,
          checkoutBranch: "main",
          targetRef: "refs/heads/main",
          capturedAt: new Date().toISOString(),
          upstreamRef: null,
          remoteVerification: { status: "not-configured", error: null },
        }),
      },
      readVerificationManifest: async () => ({
        source: ".agent-harness/verification.json",
        commands: [{ id: "test", command: ["npm", "test"] }],
      }),
      runCodex: async () => {
        modelCalls += 1;
        return {
          finalText: revisedOutput,
          model: "gpt-5.6-sol",
          reasoning: "high",
          usage: { inputTokens: 10, cachedInputTokens: 0, outputTokens: 5, totalTokens: 15 },
        };
      },
      runPackageVerification: async (input) => {
        if (input.headRevision === packageHead) {
          return makeFocusedTestSummary({
            candidateId: "S1",
            candidateRevision: 2,
            status: "failed",
            rows: [makeTestRow({ id: "test", candidateId: "S1", candidateRevision: 2, status: "failed" })],
          });
        }
        // This is the second, baseline-comparison call `_qualifyPackage` makes after the
        // head run fails. Record which revision it actually checked.
        baselineCalls.push(input.headRevision);
        return makeFocusedTestSummary({
          candidateId: "S1",
          candidateRevision: 2,
          status: "passed",
          rows: [makeTestRow({ id: "test", candidateId: "S1", candidateRevision: 2, status: "passed" })],
        });
      },
      worktreeManager: {
        retainedPatchDisposition: async () => "pending",
        base: async () => ({ repositoryRoot: directory, baseRevision: fixedRevision, baseBranch: "main" }),
        inspectRetainedSlice: async () => ({
          branch: "agent-harness/old-slice",
          files: ["src/change.ts"],
          headRevision: packageHead,
          worktreePath: directory,
          clean: true,
        }),
        prepareEvidence: async (_task, { selectedRevision }) => ({
          worktreePath: directory,
          repositoryRoot: directory,
          selectedRevision,
        }),
        removeEvidence: async () => {},
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
          files: ["src/change.ts"],
          summary: "1 file changed",
          diff: "",
        }),
      },
    });

    assert.deepEqual(await orchestrator.revalidatePlan(task.id), { started: true });
    await waitForStatus(store, task.id, "awaiting-plan-approval");
    assert.equal(modelCalls, 1);

    await orchestrator.approvePlan(task.id);
    await orchestrator.start(task.id, "implementation");
    const blocked = await waitForStatus(store, task.id, "blocked");

    // The whole point: the baseline comparison must run at the current plan's base
    // (fixedRevision), never the package's own stale original base.
    assert.deepEqual(baselineCalls, [fixedRevision]);
    assert.notEqual(blocked.blocker?.code, "repository-baseline-verification");
    assert.match(blocked.workPackages[0].error, /did not qualify/i);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("keeps a task blocked when its pinned baseline command still fails", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-baseline-revalidate-stuck-"));
  try {
    const store = new JsonTaskStore(path.join(directory, "tasks.json"));
    await store.init();
    const task = await store.create({
      title: "Recheck a still-broken repository baseline",
      description: "The repository baseline command has not changed since it was recorded.",
      repositoryPath: directory,
      workflow: "implement",
      priority: "high",
    });
    const stuckRevision = "a".repeat(40);
    await store.update(task.id, (draft) => {
      draft.status = "blocked";
      draft.currentStage = "implement";
      draft.error = "Repository baseline verification failed for test.";
      draft.blocker = {
        code: "repository-baseline-verification",
        detail: draft.error,
        detectedAt: new Date().toISOString(),
        workPackageId: "S1",
        baselineVerification: { revision: stuckRevision, commandIds: ["test"] },
      };
      draft.repositoryAuthority = { id: "authority-stuck", selectedRevision: stuckRevision };
      draft.planResult = {
        artifactId: "implementation-plan.md",
        disposition: "changes-required",
        repositoryRevision: stuckRevision,
        repositoryTargetRef: "refs/heads/main",
      };
      draft.workPackages = [
        {
          id: "S1",
          title: "Retained slice",
          description: "Still blocked on the same commit.",
          dependencies: [],
          batch: 1,
          ownedPaths: ["src/change.ts"],
          verificationCommandIds: ["test"],
          status: "failed",
          attempts: 1,
          branch: "agent-harness/old-slice",
          worktreePath: directory,
          baseRevision: stuckRevision,
          headRevision: "b".repeat(40),
          files: ["src/change.ts"],
          error: draft.error,
          verificationRuns: [{ status: "failed" }],
        },
      ];
    });
    const orchestrator = new TaskOrchestrator(store, {
      worktreeManager: {
        prepareEvidence: async () => ({ worktreePath: directory }),
        removeEvidence: async () => {},
      },
      runVerification: async () => ({
        status: "failed",
        headRevision: stuckRevision,
        rows: [{ id: "test", status: "failed" }],
      }),
      repositoryAuthorityService: {
        capture: async () => ({
          id: "authority-still-stuck",
          selectedRevision: stuckRevision,
          checkoutBranch: "main",
          targetRef: "refs/heads/main",
          capturedAt: new Date().toISOString(),
          upstreamRef: null,
          remoteVerification: { status: "not-configured", error: null },
        }),
      },
    });

    await assert.rejects(orchestrator.revalidatePlan(task.id), /baseline still fails/i);
    const unchanged = await store.get(task.id);
    assert.equal(unchanged.status, "blocked");
    assert.equal(unchanged.blocker.code, "repository-baseline-verification");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("a passing same-revision baseline recheck retries Test on the retained candidate", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-baseline-retry-test-"));
  try {
    const store = new JsonTaskStore(path.join(directory, "tasks.json"));
    await store.init();
    const task = await store.create({
      title: "Retest the retained candidate",
      description: "The container now has the tool needed by the baseline command.",
      repositoryPath: directory,
      workflow: "implement",
      priority: "high",
    });
    const baseRevision = "a".repeat(40);
    const headRevision = "b".repeat(40);
    await store.update(task.id, (draft) => {
      draft.status = "blocked";
      draft.currentStage = "test";
      draft.attemptsByStage.test = 1;
      draft.planResult = { repositoryRevision: baseRevision, repositoryTargetRef: "refs/heads/main" };
      draft.candidates = [
        { id: "C1", revisionNumber: 1, baseRevision, headRevision, status: "ready_for_test" },
      ];
      draft.blocker = {
        code: "repository-baseline-verification",
        candidateId: "C1",
        baselineVerification: { revision: baseRevision, commandIds: ["backend-test"] },
      };
    });
    const started = [];
    const planAuthority = new PlanAuthorityOrchestrator({
      store,
      repositoryAuthority: {
        capture: async () => ({
          selectedRevision: baseRevision,
          targetRef: "refs/heads/main",
          upstreamRef: null,
        }),
      },
      recheckBaseline: async () => ({
        status: "passed",
        headRevision: baseRevision,
        rows: [{ id: "backend-test", status: "passed" }],
      }),
      start: async (id, stage) => {
        started.push({ id, stage, task: await store.get(id) });
        return true;
      },
    });

    assert.deepEqual(await planAuthority.revalidatePlan(task.id), { started: true });
    assert.equal(started.length, 1);
    assert.equal(started[0].stage, "test");
    assert.equal(started[0].task.status, "ready-for-test");
    assert.equal(started[0].task.blocker, null);
    assert.equal(started[0].task.attemptsByStage.test, 1);
    assert.deepEqual(started[0].task.candidates[0].headRevision, headRevision);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("an archived baseline failure cannot be rechecked", async () => {
  const task = {
    status: "archived",
    currentStage: "test",
    blocker: { code: "repository-baseline-verification" },
  };
  assert.equal(withActionEligibility(task).actionEligibility.actions["revalidate-plan"].allowed, false);
  const planAuthority = new PlanAuthorityOrchestrator({
    store: { get: async () => task },
    repositoryAuthority: {
      capture: async () => {
        throw new Error("capture must not run");
      },
    },
    recheckBaseline: async () => {
      throw new Error("recheck must not run");
    },
  });
  await assert.rejects(planAuthority.revalidatePlan("AH-001"), /archived task/i);
});

test("routes an ownership-blocked package through planning and preserves its dirty slice", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-correct-ownership-plan-"));
  try {
    const store = new JsonTaskStore(path.join(directory, "tasks.json"));
    await store.init();
    const task = await store.create({
      title: "Correct package ownership",
      description: "Keep the implementation and its required contract test together.",
      repositoryPath: directory,
      workflow: "implement",
      priority: "high",
    });
    const ownershipError =
      "Candidate changed tests/runtime.test.mjs, which is outside the work package ownership (server/runtime.mjs).";
    await store.update(task.id, (draft) => {
      draft.status = "blocked";
      draft.currentStage = "implement";
      draft.error = `S1: ${ownershipError}`;
      draft.attemptsByStage.plan = 1;
      draft.attemptsByStage.implement = 3;
      draft.stageRunLimits.implement = 3;
      draft.workPackages = [
        {
          id: "S1",
          title: "Runtime contract",
          description: "Update the runtime and add tests covering the behavior.",
          dependencies: [],
          batch: 1,
          ownedPaths: ["server/runtime.mjs"],
          verificationCommandIds: ["test"],
          verificationRuns: [],
          status: "failed",
          attempts: 1,
          branch: "agent-harness/ownership-s1-a1",
          worktreePath: "/tmp/ownership-s1-a1",
          baseRevision: "a".repeat(40),
          headRevision: null,
          files: [],
          error: ownershipError,
          retainedContinuation: {
            requestedAt: new Date().toISOString(),
            files: ["server/runtime.mjs", "tests/runtime.test.mjs"],
            outsideOwnership: ["tests/runtime.test.mjs"],
          },
        },
      ];
    });
    const revisedOutput = `<work-packages>{"packages":[{"id":"S1","title":"Runtime contract","description":"Update the runtime and add tests covering the behavior.","dependencies":[],"ownedPaths":["server/runtime.mjs","tests/runtime.test.mjs"],"verificationCommandIds":["test"]}]}</work-packages>`;
    const orchestrator = new TaskOrchestrator(store, {
      readVerificationManifest: async () => ({
        source: ".agent-harness/verification.json",
        commands: [{ id: "test", command: ["npm", "test"] }],
      }),
      getStatus: async () => ({ available: true, authenticated: true, authMethod: "ChatGPT" }),
      runCodex: async () => ({
        finalText: revisedOutput,
        model: "gpt-5.6-sol",
        reasoning: "high",
        usage: { inputTokens: 10, cachedInputTokens: 0, outputTokens: 5, totalTokens: 15 },
      }),
    });

    assert.deepEqual(await orchestrator.correctInvalidPlan(task.id), { started: true });
    const revised = await waitForStatus(store, task.id, "awaiting-plan-approval");
    assert.deepEqual(revised.workPackages[0].ownedPaths, ["server/runtime.mjs", "tests/runtime.test.mjs"]);
    assert.equal(revised.workPackages[0].worktreePath, "/tmp/ownership-s1-a1");
    assert.equal(revised.workPackages[0].branch, "agent-harness/ownership-s1-a1");
    assert.deepEqual(revised.workPackages[0].retainedContinuation.outsideOwnership, []);
    assert.equal(revised.workPackages[0].attempts, 1);
    assert.equal(revised.stageRunLimits.implement, 4);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("returns an exhausted candidate repair lineage to planning without erasing the candidate", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-replan-repair-circuit-"));
  try {
    const store = new JsonTaskStore(path.join(directory, "tasks.json"));
    await store.init();
    const task = await store.create({
      title: "Correct repeated candidate defects",
      description: "Replace the implementation strategy after bounded repairs fail.",
      repositoryPath: directory,
      workflow: "implement",
      priority: "medium",
    });
    await store.update(task.id, (draft) => {
      draft.status = "repair-required";
      draft.currentStage = "dev-review";
      draft.workflowProfile = { selected: "standard" };
      draft.attemptsByStage.plan = 1;
      draft.attemptsByStage.implement = 3;
      draft.stageRunLimits.implement = 3;
      draft.candidates = [
        {
          id: "C1",
          revisionNumber: 3,
          status: "repair_required",
          baseRevision: "a".repeat(40),
          headRevision: "d".repeat(40),
          revisions: [
            { number: 1, reason: "assembly", headRevision: "b".repeat(40) },
            { number: 2, reason: "repair", headRevision: "c".repeat(40) },
            { number: 3, reason: "repair", headRevision: "d".repeat(40) },
          ],
        },
      ];
      draft.workPackages = [
        {
          id: "S1",
          title: "Old strategy",
          description: "The bounded repair strategy did not converge.",
          dependencies: [],
          batch: 1,
          ownedPaths: ["src/old.ts"],
          verificationCommandIds: ["test"],
          verificationRuns: [],
          status: "integrated",
          attempts: 3,
        },
      ];
    });
    const revisedOutput = `<work-packages>{"packages":[{"id":"S1","title":"Replacement strategy","description":"Replace the faulty boundary as one coherent slice.","dependencies":[],"ownedPaths":["src/replacement.ts"],"verificationCommandIds":["test"]}]}</work-packages>`;
    const orchestrator = new TaskOrchestrator(store, {
      readVerificationManifest: async () => ({
        source: ".agent-harness/verification.json",
        commands: [{ id: "test", command: ["npm", "test"] }],
      }),
      getStatus: async () => ({ available: true, authenticated: true, authMethod: "ChatGPT" }),
      runCodex: async () => ({
        finalText: revisedOutput,
        model: "gpt-5.6-sol",
        reasoning: "high",
        usage: { inputTokens: 10, cachedInputTokens: 0, outputTokens: 5, totalTokens: 15 },
      }),
    });

    assert.deepEqual(await orchestrator.correctInvalidPlan(task.id), { started: true });
    const revised = await waitForStatus(store, task.id, "awaiting-plan-approval");
    assert.equal(revised.currentStage, "plan");
    assert.equal(revised.candidates.length, 1);
    assert.equal(revised.candidates[0].revisionNumber, 3);
    assert.equal(revised.candidates[0].status, "repair_required");
    assert.equal(revised.workPackages[0].title, "Replacement strategy");
    assert.deepEqual(revised.workPackages[0].ownedPaths, ["src/replacement.ts"]);
    assert.equal(revised.stageRunLimits.implement, 4);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("does not misclassify a failed package qualification as an invalid plan", async () => {
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
      draft.workPackages = [
        {
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
        },
      ];
    });
    const orchestrator = new TaskOrchestrator(store, {
      readVerificationManifest: async () => ({
        source: ".agent-harness/verification.json",
        commands: [{ id: "test", command: ["npm", "test"] }],
      }),
    });

    await assert.rejects(
      () => orchestrator.correctInvalidPlan(task.id),
      /approved plan is executable and does not require plan correction/i,
    );
    await orchestrator._bindSyntheticPlan(task.id);
    const retained = await store.get(task.id);
    assert.equal(retained.currentStage, "implement");
    assert.equal(retained.workPackages[0].headRevision, "b".repeat(40));
    const eligibility = withActionEligibility(retained).actionEligibility.actions;
    assert.equal(eligibility.plan.allowed, false);
    assert.equal(eligibility["continue-package"].allowed, false);
    assert.match(eligibility["continue-package"].reason, /exhausted its retry allowance/i);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("continues a clean qualification failure by requalifying without rerunning model implementation", async () => {
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
      draft.status = "failed";
      draft.currentStage = "implement";
      draft.error = "S1 did not qualify: playwright-e2e failed.";
      draft.workPackages = [
        {
          id: "S1",
          title: "Browser contract",
          description: "Requalify the exact retained browser change.",
          dependencies: [],
          batch: 1,
          ownedPaths: ["e2e/example.spec.ts"],
          verification: [],
          verificationCommandIds: ["playwright-e2e"],
          verificationRuns: [],
          status: "failed",
          attempts: 6,
          branch: "agent-harness/requalify-s1-a6",
          worktreePath: "/tmp/requalify-s1-a6",
          baseRevision,
          headRevision: packageRevision,
          files: ["e2e/example.spec.ts"],
          error: draft.error,
          retainedForRequalification: false,
        },
      ];
    });
    let modelCalls = 0;
    const qualification = {
      ...makeFocusedTestSummary({ candidateId: "S1", candidateRevision: 7 }),
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

    assert.deepEqual(await orchestrator.continueRetainedPackage(task.id), { started: true });
    const ready = await waitForStatus(store, task.id, "ready-for-review");
    assert.equal(modelCalls, 0);
    assert.equal(ready.workPackages[0].status, "integrated");
    assert.equal(ready.workPackages[0].attempts, 7);
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
      draft.workPackages = [
        {
          id: "S1",
          title: "Prior scope",
          description: "Retained plan.",
          dependencies: [],
          batch: 1,
          ownedPaths: ["src/prior.ts"],
          verification: [],
          status: "planned",
          attempts: 0,
        },
      ];
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
    assert.deepEqual(
      failed.workPackages.map((item) => item.ownedPaths),
      [["src/prior.ts"]],
    );
    const planArtifacts = failed.artifacts.filter((artifact) => artifact.stage === "plan");
    assert.deepEqual(
      planArtifacts.map((artifact) => artifact.name),
      ["implementation-plan.md", "implementation-plan-r2-invalid.md"],
    );
    assert.equal(planArtifacts.at(-1).content, invalidOutput);
    assert.equal(failed.runs.at(-1).artifactId, planArtifacts.at(-1).id);
    assert.match(failed.error, /work-packages JSON block was invalid/i);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
