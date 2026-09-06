import type { RuntimeCandidate, RuntimeTask, RuntimeWorkPackage, StageId } from "../../domain.ts";
import type { FrontierGateway } from "../runtime/contracts.ts";
import { fixtureArtifact, fixtureRun, fixtureTask, fixtureTime } from "./scenarios.ts";

export const sampleHead = (revision: number) => revision.toString(16).padStart(8, "a").repeat(5);
export function samplePendingGates(candidate: RuntimeCandidate): NonNullable<RuntimeTask["gateFreshness"]> {
  const pending = (
    stage: "dev-review" | "test" | "final-review",
  ): NonNullable<RuntimeTask["gateFreshness"]>[typeof stage] => ({
    stage,
    candidateId: candidate.id,
    candidateRevision: candidate.revisionNumber,
    target: { candidateId: candidate.id, candidateRevision: candidate.revisionNumber },
    state: "stale",
    fresh: false,
    sourceRunId: null,
    sourceArtifactId: null,
    reasonCode: "missing_authoritative_summary",
    reasonCopy: "This gate has not run for the sample candidate.",
    reason: {
      code: "missing_authoritative_summary",
      copy: "This gate has not run for the sample candidate.",
    },
    staleReasonCode: "missing_authoritative_summary",
    staleReasonCopy: "No retained verdict",
    staleReason: null,
    focusedTest: null,
    focusedTestRows: [],
  });
  return {
    "dev-review": pending("dev-review"),
    test: pending("test"),
    "final-review": pending("final-review"),
  };
}
export function samplePackages(count = 4): RuntimeWorkPackage[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `S${index + 1}`,
    title:
      index === 0
        ? "Shared revision contract"
        : index === count - 1
          ? "Integration & verification"
          : `Revision boundary ${index}`,
    description: "Sample scoped delivery package; no repository is changed.",
    dependencies:
      index === 0
        ? []
        : index === count - 1
          ? Array.from({ length: Math.max(1, count - 2) }, (_, i) => `S${count === 2 ? 1 : i + 2}`)
          : ["S1"],
    batch: index === 0 ? 1 : index === count - 1 ? 3 : 2,
    ownedPaths: [`src/revisions/boundary-${index + 1}.ts`],
    verification: ["npm test"],
    verificationCommandIds: ["unit"],
    status: "planned",
    attempts: 0,
    branch: null,
    worktreePath: null,
    baseRevision: null,
    headRevision: null,
    files: [],
    error: null,
  }));
}
export function sampleCandidate(task: RuntimeTask): RuntimeCandidate {
  return {
    id: `C-${task.id}`,
    revisionNumber: 1,
    baseRevision: sampleHead(0),
    baseBranch: "main",
    headRevision: sampleHead(1),
    branch: `sample/${task.id}`,
    repositoryRoot: task.repositoryPath,
    worktreePath: `${task.repositoryPath}/sample-candidate`,
    status: "ready_for_review",
    createdAt: fixtureTime,
    updatedAt: fixtureTime,
    revisions: [
      {
        number: 1,
        headRevision: sampleHead(1),
        reason: "Sample qualified slices assembled in dependency order",
        createdAt: fixtureTime,
      },
    ],
    members: task.workPackages.map((item, index) => ({
      packageId: item.id,
      headRevision: sampleHead(index + 10),
      order: index,
    })),
  };
}
export function sampleEligibility(task: RuntimeTask) {
  const actions: NonNullable<RuntimeTask["actionEligibility"]>["actions"] = {};
  const mapped: Partial<Record<RuntimeTask["status"], string[]>> = {
    queued: [],
    "awaiting-spec-approval": ["approve-spec"],
    "awaiting-plan-approval": ["approve-plan", "plan"],
    "ready-for-implementation": ["implement"],
    "ready-for-review": ["review"],
    "ready-for-test": ["test"],
    "ready-for-final-review": ["final-review"],
    "awaiting-human-approval": ["open-pr"],
    "awaiting-pr-merge": ["reconcile-pr"],
    blocked: task.pullRequestIntent ? ["reconcile-pr"] : [],
    failed: task.currentStage === "test" && task.candidates.length ? ["retry-test"] : [],
    "repair-required": task.candidates.length ? ["repair"] : [],
    completed: task.workflow === "investigate" ? ["continue-implementation"] : [],
  };
  for (const action of mapped[task.status] ?? [])
    actions[action as keyof typeof actions] = {
      allowed: true,
      mode: "execute",
      reason: "Sample-only action; no model or repository mutation.",
    };
  return { generatedAt: new Date().toISOString(), actions };
}
export function fixtureWorkflow(
  tasks: Map<string, RuntimeTask>,
  get: (id: string) => RuntimeTask,
  changed: (task: RuntimeTask) => void,
): Pick<
  FrontierGateway,
  "action" | "decision" | "continueImplementation" | "selectDesign" | "retryDesign" | "diff" | "artifacts"
> {
  function recordStage(task: RuntimeTask, stage: StageId, content: string) {
    const at = new Date().toISOString();
    const artifact = fixtureArtifact(`${task.id}-${stage}-${task.artifacts.length + 1}`, stage, content);
    artifact.createdAt = at;
    const run = {
      ...fixtureRun(task.id, stage, "completed"),
      id: `${task.id}-${stage}-run-${task.runs?.length ?? 0}`,
      artifactId: artifact.id,
      startedAt: new Date(Date.now() - 360_000).toISOString(),
      completedAt: at,
    };
    artifact.model = run.model;
    task.attemptsByStage[stage] = (task.attemptsByStage[stage] ?? 0) + 1;
    run.attempt = task.attemptsByStage[stage];
    artifact.reasoning = run.reasoning;
    artifact.usage = structuredClone(run.usage ?? artifact.usage);
    const candidate = task.candidates.at(-1);
    if (candidate && ["dev-review", "test", "final-review"].includes(stage)) {
      Object.assign(artifact, {
        candidateId: candidate.id,
        candidateRevision: candidate.revisionNumber,
        gateResult: {
          verdict: "PASS",
          candidateId: candidate.id,
          candidateRevision: candidate.revisionNumber,
          evaluatedAt: fixtureTime,
          blockingReasons: [],
          findings: [],
        },
      });
      Object.assign(run, {
        candidateId: candidate.id,
        candidateRevision: candidate.revisionNumber,
        gateResult: artifact.gateResult,
      });
      const gate = stage as "dev-review" | "test" | "final-review";
      task.gateFreshness = {
        ...(task.gateFreshness ?? samplePendingGates(candidate)),
        [gate]: {
          stage: gate,
          candidateId: candidate.id,
          candidateRevision: candidate.revisionNumber,
          target: { candidateId: candidate.id, candidateRevision: candidate.revisionNumber },
          state: "fresh",
          fresh: true,
          sourceRunId: run.id,
          sourceArtifactId: artifact.id,
          reasonCode: "fresh",
          reasonCopy: "Sample exact candidate verdict",
          reason: { code: "fresh", copy: "Sample exact candidate verdict" },
          staleReasonCode: null,
          staleReasonCopy: null,
          staleReason: null,
          focusedTest: null,
          focusedTestRows: [],
        },
      };
      if (stage === "test") {
        const rows = ["Normalises revision case", "Preserves source labels", "Handles empty history"].map(
          (title, index) => ({
            id: `check-${index}`,
            title,
            candidateId: candidate.id,
            candidateRevision: candidate.revisionNumber,
            command: "npm test",
            status: "passed" as const,
            durationMs: 100 + index * 20,
            artifactReferences: [],
            assertions: [
              { label: title, actual: "Matched expected value", expected: "Matched expected value" },
            ],
            failureDetails: null,
            exitCode: 0,
            output: `PASS ${title}\nSample command output; no command executed.`,
          }),
        );
        run.test = {
          candidateId: candidate.id,
          candidateRevision: candidate.revisionNumber,
          status: "passed",
          command: "npm test",
          durationMs: 500,
          rowCount: rows.length,
          failedRowIds: [],
          rows,
        };
        candidate.verificationRuns = [
          {
            candidateId: candidate.id,
            candidateRevision: candidate.revisionNumber,
            headRevision: candidate.headRevision ?? undefined,
            command: "npm test",
            status: "passed",
            durationMs: 500,
            rows,
            executionKind: "full-manifest",
            executedCommandIds: ["unit"],
            declaredCommandIds: ["unit"],
          },
        ];
      }
    }
    task.artifacts.push(artifact);
    task.runs ??= [];
    task.runs.push(run);
    task.completedStages = [...new Set([...task.completedStages, stage])];
    task.usage.inputTokens += run.usage?.inputTokens ?? 0;
    task.usage.outputTokens += run.usage?.outputTokens ?? 0;
    task.usage.cachedInputTokens += run.usage?.cachedInputTokens ?? 0;
    task.usage.totalTokens += run.usage?.totalTokens ?? 0;
  }
  return {
    async artifacts(id) {
      const items = structuredClone(get(id).artifacts);
      return { items, total: items.length, nextCursor: null };
    },
    async diff(id, candidateId, headRevision) {
      const candidate = get(id).candidates.find((item) => item.id === candidateId);
      const revision = candidate?.revisions.find((item) => item.headRevision === headRevision);
      if (!candidate || !revision) throw new Error("Sample exact candidate revision not found.");
      return {
        candidateId,
        revisionNumber: revision.number,
        headRevision,
        worktreePath: candidate.worktreePath,
        truncated: false,
        diff: 'diff --git a/src/revisions/compare.ts b/src/revisions/compare.ts\nindex 1111111..2222222 100644\n--- a/src/revisions/compare.ts\n+++ b/src/revisions/compare.ts\n@@ -1,3 +1,4 @@\n export function sameRevision(left: string, right: string) {\n-  return left === right;\n+  const normalise = (label: string) => label.trim().toUpperCase();\n+  return normalise(left) === normalise(right);\n }\ndiff --git a/tests/revisions.test.ts b/tests/revisions.test.ts\nnew file mode 100644\n--- /dev/null\n+++ b/tests/revisions.test.ts\n@@ -0,0 +1,3 @@\n+test("normalises labels", () => {\n+  assert.equal(sameRevision(" A ", "a"), true);\n+});\n',
      };
    },
    async decision(id, question, answer) {
      const task = get(id);
      task.decisions.push({ id: crypto.randomUUID(), question, answer, createdAt: new Date().toISOString() });
      changed(task);
    },
    async action(id, action, note = "", scope) {
      const task = get(id),
        candidate = task.candidates.at(-1);
      if (!sampleEligibility(task).actions[action]?.allowed)
        throw new Error(`Sample action ${action} is unavailable in ${task.status}.`);
      if (
        ["review", "test", "retry-test", "final-review", "open-pr"].includes(action) &&
        (!scope ||
          scope.candidateId !== candidate?.id ||
          scope.candidateRevision !== candidate?.revisionNumber ||
          scope.candidateHeadRevision !== candidate?.headRevision)
      )
        throw new Error("Sample candidate changed. Review its exact current revision.");
      switch (action) {
        case "approve-spec":
          task.approvals.push({
            id: crypto.randomUUID(),
            stage: "specification",
            note,
            createdAt: new Date().toISOString(),
          });
          task.completedStages = [...new Set([...task.completedStages, "specification" as const])];
          if (task.workflow === "investigate") {
            task.status = "completed";
            task.completedAt = new Date().toISOString();
          } else {
            task.workPackages = samplePackages();
            recordStage(
              task,
              "plan",
              "# Implementation plan\n\n## Dependency batches\n\nS1 → S2 + S3 in parallel → S4.\n\nEach package owns its declared paths and runs the unit verification command. This is deterministic sample evidence.",
            );
            task.status = "awaiting-plan-approval";
            task.currentStage = "plan";
          }
          break;
        case "plan":
          recordStage(
            task,
            "plan",
            "# Revised sample plan\n\nRecorded operator feedback is retained. S1 → S2 + S3 → S4.",
          );
          break;
        case "approve-plan":
          task.approvals.push({
            id: crypto.randomUUID(),
            stage: "plan",
            note,
            createdAt: new Date().toISOString(),
          });
          task.status = "ready-for-implementation";
          task.currentStage = "implement";
          break;
        case "implement":
          for (const item of task.workPackages) {
            item.status = "integrated";
            item.headRevision = sampleHead(item.batch + 10);
            item.attempts++;
            item.files = [...item.ownedPaths];
          }
          task.candidates.push(sampleCandidate(task));
          recordStage(
            task,
            "implement",
            "# Candidate assembly\n\nAll sample slices were qualified then integrated in dependency order. Independent review and full verification remain separate gates.",
          );
          task.status = "ready-for-review";
          task.currentStage = "dev-review";
          break;
        case "repair":
          if (!candidate) throw new Error("No sample candidate");
          candidate.revisionNumber++;
          candidate.headRevision = sampleHead(candidate.revisionNumber);
          candidate.status = "ready_for_review";
          candidate.revisions.push({
            number: candidate.revisionNumber,
            headRevision: candidate.headRevision,
            reason: "Sample repair of empty-history handling",
            createdAt: new Date().toISOString(),
          });
          for (const gate of Object.values(task.gateFreshness ?? {})) {
            gate.fresh = false;
            gate.state = "stale";
            gate.target = { candidateId: candidate.id, candidateRevision: candidate.revisionNumber };
            if (gate.sourceRunId || gate.sourceArtifactId) {
              gate.reasonCode = "revision_change";
              gate.reasonCopy = "Candidate revision changed; rerun required.";
              gate.reason = { code: gate.reasonCode, copy: gate.reasonCopy };
            } else {
              gate.candidateRevision = candidate.revisionNumber;
            }
          }
          task.error = null;
          task.blocker = null;
          task.status = "ready-for-review";
          task.currentStage = "dev-review";
          recordStage(
            task,
            "implement",
            "# Sample repair\n\nThe candidate now guards empty revision history. Downstream evidence is retained but stale.",
          );
          break;
        case "review":
          recordStage(
            task,
            "dev-review",
            "# Development review\n\n## Verdict: PASS\n\nThe sample candidate retains original labels and normalises comparisons. No blocking findings recorded.",
          );
          task.currentStage = "test";
          task.status = "ready-for-test";
          if (candidate) candidate.status = "ready_for_test";
          break;
        case "test":
        case "retry-test":
          task.error = null;
          task.blocker = null;
          recordStage(
            task,
            "test",
            "# Full verification\n\nThree sample command assertions passed on the exact candidate. All declared commands are represented.",
          );
          task.currentStage = "final-review";
          task.status = "ready-for-final-review";
          if (candidate) candidate.status = "ready_for_final_review";
          break;
        case "final-review":
          recordStage(
            task,
            "final-review",
            "# Final review\n\n## Verdict: PASS\n\nSample specification, implementation, review and test evidence agree. Awaiting operator approval.",
          );
          task.currentStage = "approval";
          task.status = "awaiting-human-approval";
          if (candidate) candidate.status = "awaiting_human_approval";
          break;
        case "open-pr":
          if (!candidate) throw new Error("No sample candidate");
          candidate.status = "pull_request_open";
          task.currentStage = "approval";
          task.status = "awaiting-pr-merge";
          task.pullRequestIntent = {
            candidateId: candidate.id,
            candidateRevision: candidate.revisionNumber,
            baseRevision: candidate.baseRevision,
            headRevision: candidate.headRevision ?? "",
            targetBranch: "main",
            headBranch: `sample/${task.id}`,
            repository: "sample/mission-frontier",
            number: 214,
            url: null,
            note,
            status: "open",
            startedAt: fixtureTime,
            openedAt: fixtureTime,
            mergedAt: null,
            closedAt: null,
            mergeCommitRevision: null,
            lastCheckedAt: new Date().toISOString(),
            lastError: null,
            consecutivePollFailures: 0,
          };
          break;
        case "reconcile-pr":
          if (task.pullRequestIntent) task.pullRequestIntent.lastCheckedAt = new Date().toISOString();
          break;
        default:
          throw new Error("This command has no sample demonstration.");
      }
      changed(task);
    },
    async continueImplementation(id) {
      const task = get(id);
      if (task.status !== "completed" || task.workflow !== "investigate")
        throw new Error("Only a completed investigation can continue.");
      if (task.continuedByTaskId)
        return { task: structuredClone(get(task.continuedByTaskId)), created: false };
      const next = fixtureTask(`DEMO-${tasks.size + 1}`, task.title, task.repositoryPath, {
        workflow: "implement",
        continuedFromTaskId: id,
        description: task.description,
        artifacts: structuredClone(task.artifacts),
        agentConfig: structuredClone(task.agentConfig),
        status: "awaiting-plan-approval",
        currentStage: "plan",
        workPackages: samplePackages(),
        completedStages: ["triage", "scouts", "grill", "specification"],
      });
      recordStage(next, "plan", "# Continued implementation plan\n\nS1 → S2 + S3 → S4.");
      task.continuedByTaskId = next.id;
      tasks.set(next.id, next);
      changed(task);
      return { task: structuredClone(next), created: true };
    },
    async selectDesign(id, variantId) {
      const task = get(id),
        request = task.designRequest;
      const variant = request?.variants.find((item) => item.id === variantId);
      if (
        !request ||
        !variant ||
        variant.status !== "ready" ||
        !["awaiting-selection", "failed"].includes(request.status)
      )
        throw new Error("Design is no longer available for selection.");
      request.status = "selected";
      request.selectedVariantId = variantId;
      request.selectedAt = new Date().toISOString();
      request.selectedBy = "operator";
      recordStage(
        task,
        "specification",
        `# Specification\n\nSelected sample design: ${variant.title} r${variant.revision}.\n\n## Acceptance criteria\n\n- Preserve task identity.\n- Retain decisions and policies.`,
      );
      task.status = "awaiting-spec-approval";
      changed(task);
    },
    async retryDesign(id) {
      const task = get(id),
        request = task.designRequest;
      if (request?.status !== "failed") throw new Error("No failed sample provider to retry.");
      const latest = new Map(request.variants.map((variant) => [variant.generator, variant]));
      for (const prior of latest.values())
        if (prior.status === "failed")
          request.variants.push({
            ...structuredClone(prior),
            id: crypto.randomUUID(),
            revision: prior.revision + 1,
            status: "ready",
            previewUrl: "/assets/fixture-evidence-desk.html",
            error: null,
            title: `${prior.title} · retry`,
            summary: "Retained successful retry with its original provider policy.",
            completedAt: new Date().toISOString(),
          });
      request.status = "awaiting-selection";
      request.error = null;
      task.status = "awaiting-design-selection";
      changed(task);
    },
  };
}
