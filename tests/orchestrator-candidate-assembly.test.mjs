import test from "node:test";
import {
  assert,
  escapeRegex,
  GRILL_OUTPUT,
  gateOutput,
  harnessEvidence,
  JsonTaskStore,
  mkdtemp,
  os,
  PLAN_OUTPUT,
  path,
  refreshGateFreshness,
  rm,
  SCOUT_OUTPUT,
  SYNTHESIS_OUTPUT,
  TaskOrchestrator,
  TEST_OUTPUT,
  waitForStatus,
} from "./orchestrator-test-support.mjs";

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
          rows: [
            base.rows[0],
            {
              ...base.rows[0],
              id: "test-api",
              title: "api.test.mjs",
              command: "npm run test:api",
              durationMs: 350,
            },
          ],
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
        if (/<investigation-result>/.test(prompt)) finalText = SYNTHESIS_OUTPUT;
        if (/<grill-questions>/.test(prompt)) finalText = GRILL_OUTPUT;
        if (/<work-packages>/.test(prompt)) finalText = PLAN_OUTPUT;
        if (/Development review/.test(prompt)) {
          reviewCount += 1;
          finalText =
            reviewCount === 1
              ? gateOutput(1, "REPAIR", [
                  {
                    severity: "P1",
                    title: "Repair required",
                    detail: "Fix the candidate.",
                    candidateId: "C1",
                    candidateRevision: 1,
                  },
                ])
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
    await orchestrator.answerGrillQuestion(task.id, {
      questionId: "Q1",
      answer: "Keep it backwards compatible.",
      source: "operator",
    });
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
    assert.match(
      driftedRepair.stageRunReservations.implement.authorizingGateSnapshotDigest,
      /^[0-9a-f]{64}$/,
    );
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
    assert.deepEqual(
      approvalTask.workPackages.map((item) => item.status),
      ["integrated", "integrated"],
    );
    assert.deepEqual(
      approvalTask.candidates[0].members.map((member) => member.packageId),
      ["S1", "S2"],
    );
    assert.equal(approvalTask.artifacts.length, 17);
    assert.equal(
      approvalTask.artifacts.filter(
        (artifact) => artifact.stage === "implement" && artifact.candidateRevision === 2,
      ).length,
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
    assert.equal(
      testCall.networkAccess,
      false,
      "the test agent no longer runs commands, so it needs no loopback access",
    );
    assert.equal(runtimeCalls.find((call) => /Development review/.test(call.prompt)).networkAccess, false);
    // Read-only stages get the shorter budget; the long one existed for running suites.
    assert.equal(testCall.timeoutMs, 360_000);
    assert.match(
      testCall.tempDirectory,
      new RegExp(`^${escapeRegex(path.join(os.tmpdir(), "agent-harness", task.id))}`),
    );
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
      approvalTask.artifacts.find((artifact) => artifact.stage === "test")?.focusedTest?.rows?.[1]
        .candidateRevision,
      2,
    );
    const reviewRuns = approvalTask.runs.filter((run) => run.stage === "dev-review");
    const repairRevision = approvalTask.candidates[0].revisions[1];
    const repairRun = approvalTask.runs.find(
      (run) =>
        run.kind === "repair" && run.workflowReservationId === repairRevision.sourceWorkflowReservationId,
    );
    const repairArtifact = approvalTask.artifacts.find((artifact) => artifact.runId === repairRun.id);
    const repairAuthorizerArtifact = approvalTask.artifacts.find(
      (artifact) => artifact.runId === reviewRuns[0].id,
    );
    const testRun = approvalTask.runs.find((run) => run.stage === "test");
    assert.equal(reviewRuns.length, 2);
    assert.equal(
      repairRevision.sourceWorkflowReservedAt,
      approvalTask.stageRunReservations.implement.reservedAt,
    );
    assert.equal(repairRevision.authorizingGateStage, "dev-review");
    assert.equal(repairRevision.authorizingGateReservationId, reviewRuns[0].workflowReservationId);
    assert.equal(repairRevision.authorizingGateRunId, reviewRuns[0].id);
    assert.equal(repairRevision.authorizingGateArtifactId, repairAuthorizerArtifact.id);
    assert.match(approvalTask.stageRunReservations.implement.authorizingGateSnapshotDigest, /^[0-9a-f]{64}$/);
    assert.ok(
      Date.parse(repairAuthorizerArtifact.createdAt) < Date.parse(repairRevision.sourceWorkflowReservedAt),
    );
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
    assert.equal(
      approvalTask.runs.every((run) => run.status === "completed"),
      true,
    );
    assert.deepEqual(approvalTask.activeRunIds, []);
    for (const stage of ["dev-review", "test", "final-review"]) {
      const passEvent = approvalTask.events.find(
        (event) => event.stage === stage && event.title.endsWith(" passed"),
      );
      assert.equal(
        passEvent.runId,
        approvalTask.gateFreshness[stage].sourceRunId,
        `${stage} pass event links its authoritative run`,
      );
      assert.equal(passEvent.freshness.fresh, true, `${stage} pass event carries authoritative freshness`);
    }
    await orchestrator.approveMerge(task.id);
    const merged1 = await store.get(task.id);
    assert.equal(merged1.status, "merged-to-target");
    assert.equal(
      merged1.completedAt,
      null,
      "merging onto the target branch does not itself complete the task",
    );
    assert.equal(merged1.candidates[0].status, "merged");
    assert.equal(merged1.artifacts.length, 18);
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
      assert.equal(
        await orchestrator.start(task.id, kind),
        false,
        `${kind} must not start once the task is merged-to-target`,
      );
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
