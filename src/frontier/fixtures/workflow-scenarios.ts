import type { RuntimeDesignRequest, RuntimeTask } from "../../domain.ts";
import { fixtureArtifact, fixtureRun, fixtureTime, noUsage } from "./scenarios.ts";
import { sampleCandidate, sampleHead, samplePackages, samplePendingGates } from "./workflow.ts";

/** Richer scenarios are an explicit QA/sample route, never mixed with real records. */
export function enrichWorkflowScenarios(tasks: RuntimeTask[]) {
  const task = (id: string) => {
    const found = tasks.find((entry) => entry.id === id);
    if (!found) throw new Error(`Sample ${id} missing`);
    return found;
  };
  const grill = task("PC-153");
  grill.workflow = "implement";
  const plan = task("MS-092");
  plan.workflow = "implement";
  plan.currentStage = "plan";
  plan.status = "awaiting-plan-approval";
  plan.workPackages = samplePackages(12);
  plan.completedStages = ["triage", "scouts", "grill", "specification"];
  plan.artifacts = [
    fixtureArtifact(
      "MS-092-plan",
      "plan",
      "# Implementation plan\n\n## Contract\n\nTwelve sample packages share one root contract and a final integration gate. Packages S2–S11 may run in parallel after S1.\n\n## Verification\n\nEvery slice owns one boundary file and qualifies through the unit command. Full candidate verification runs after assembly.",
    ),
  ];
  const repair = task("PC-148");
  repair.workPackages = samplePackages(4).map((item) => ({ ...item, status: "integrated" }));
  const candidate = sampleCandidate(repair);
  candidate.status = "repair_required";
  repair.candidates = [candidate];
  const finding = repair.artifacts[0];
  if (finding) {
    finding.model = "gpt-5.6-sol";
    finding.reasoning = "high";
    finding.candidateId = candidate.id;
    finding.candidateRevision = 1;
    finding.gateResult = {
      verdict: "REPAIR",
      candidateId: candidate.id,
      candidateRevision: 1,
      evaluatedAt: fixtureTime,
      blockingReasons: ["Empty history causes a runtime error"],
      findings: [
        {
          kind: "candidate-defect",
          severity: "P1",
          title: "Empty revision history",
          detail:
            "A new project has no first revision. Guard the empty collection before reading its first value, then add a regression check.",
          file: "src/revisions/history.ts",
          line: 42,
          candidateId: candidate.id,
          candidateRevision: 1,
          blocking: true,
          reproductionEvidence: "Open history for a project with zero revision records.",
          acceptanceCriterion: "Projects without previous revisions remain usable.",
        },
      ],
    };
  }
  const reviewRun = repair.runs?.[0];
  if (reviewRun) {
    reviewRun.candidateId = candidate.id;
    reviewRun.candidateRevision = 1;
    reviewRun.artifactId = finding?.id ?? null;
  }
  repair.gateFreshness = {
    ...samplePendingGates(candidate),
    "dev-review": {
      stage: "dev-review",
      candidateId: candidate.id,
      candidateRevision: 1,
      target: { candidateId: candidate.id, candidateRevision: 1 },
      state: "stale",
      fresh: false,
      sourceRunId: reviewRun?.id ?? null,
      sourceArtifactId: finding?.id ?? null,
      reasonCode: "repair_required",
      reasonCopy: "P1 empty-history defect requires candidate repair",
      reason: { code: "repair_required", copy: "P1 empty-history defect requires candidate repair" },
      staleReasonCode: "repair_required",
      staleReasonCopy: "P1 empty-history defect requires candidate repair",
      staleReason: { code: "repair_required", copy: "P1 empty-history defect requires candidate repair" },
      focusedTest: null,
      focusedTestRows: [],
    },
  };
  const design = task("AH-053");
  design.workflow = "implement";
  design.currentStage = "specification";
  design.status = "awaiting-design-selection";
  design.completedStages = ["triage", "scouts", "grill"];
  const policies: RuntimeDesignRequest["policies"] = {
    "codex-design": {
      provider: "codex",
      model: "gpt-5.6-sol",
      reasoning: "high",
      provenance: "settings-default",
    },
    "claude-design": {
      provider: "claude",
      model: "claude-opus-5",
      reasoning: "high",
      provenance: "settings-default",
    },
  };
  design.designRequest = {
    requested: true,
    status: "failed",
    requestedAt: fixtureTime,
    startedAt: fixtureTime,
    completedAt: fixtureTime,
    selectedVariantId: null,
    selectedAt: null,
    selectedBy: null,
    policies,
    error: "Sample Claude provider failure; Codex result is retained.",
    variants: (["codex-design", "claude-design"] as const).map((generator, index) => ({
      id: `AH-053-${generator}-r1`,
      revision: 1,
      generator,
      provider: policies[generator].provider,
      policy: policies[generator],
      status: index === 0 ? "ready" : "failed",
      title: index === 0 ? "Revision evidence desk" : "Revision comparison studio",
      summary:
        index === 0
          ? "Compact task evidence with source links and a clear next action."
          : "Provider did not complete.",
      previewUrl: index === 0 ? "/assets/fixture-evidence-desk.html" : null,
      externalUrl: null,
      bundleHash: null,
      model: policies[generator].model,
      reasoning: "high",
      createdAt: fixtureTime,
      completedAt: fixtureTime,
      error: index === 0 ? null : "Sample provider timeout. Retained policy will be reused.",
      usage: { ...noUsage },
      contextManifest: null,
    })),
  };
  const scouts = task("AH-052");
  scouts.scoutDispatch = {
    selected: [
      {
        name: "code-path",
        focus: "Trace token accounting from events to the task summary",
        reason: "Required to identify the aggregation boundary",
        status: "complete",
      },
      {
        name: "test-inventory",
        focus: "Locate cache-rate assertion coverage",
        reason: "Tests establish the reported-token contract",
        status: "queued",
      },
    ],
    skipped: ["dependency", "pattern", "schema", "user-journey"],
    rationale: "Two targeted scouts cover this medium-risk boundary.",
    createdAt: fixtureTime,
    completedAt: null,
  };
  const delivery = task("MS-091");
  delivery.workflow = "implement";
  delivery.workPackages = samplePackages(1).map((item) => ({ ...item, status: "integrated" }));
  delivery.candidates = [sampleCandidate(delivery)];
  if (delivery.candidates[0]) delivery.candidates[0].status = "pull_request_open";
  delivery.pullRequestIntent = {
    candidateId: delivery.candidates[0]?.id ?? "",
    candidateRevision: 1,
    baseRevision: sampleHead(0),
    headRevision: sampleHead(1),
    targetBranch: "main",
    headBranch: "sample/MS-091",
    repository: "sample/mission-frontier",
    number: 214,
    url: null,
    note: "Sample approval",
    status: "open",
    startedAt: fixtureTime,
    openedAt: fixtureTime,
    mergedAt: null,
    closedAt: null,
    mergeCommitRevision: null,
    lastCheckedAt: fixtureTime,
    lastError: null,
    consecutivePollFailures: 0,
  };
  delivery.completedStages = [
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
  const test = task("AH-051");
  test.workflow = "implement";
  test.workPackages = samplePackages(1);
  test.candidates = [sampleCandidate(test)];
  const c = test.candidates[0];
  if (c) {
    const run = fixtureRun(test.id, "test", "failed");
    run.error = test.error;
    run.candidateId = c.id;
    run.candidateRevision = 1;
    run.test = {
      candidateId: c.id,
      candidateRevision: 1,
      status: "failed",
      command: "npm test",
      durationMs: 800,
      rowCount: 2,
      failedRowIds: ["boundary"],
      rows: [
        {
          id: "labels",
          title: "Preserves labels",
          candidateId: c.id,
          candidateRevision: 1,
          command: "npm test",
          status: "passed",
          durationMs: 300,
          artifactReferences: [],
          assertions: [],
          failureDetails: null,
          output: "PASS original labels retained",
        },
        {
          id: "boundary",
          title: "Starts candidate verification",
          candidateId: c.id,
          candidateRevision: 1,
          command: "npm test",
          status: "failed",
          durationMs: 500,
          artifactReferences: [],
          assertions: [],
          failureDetails: "Verification command could not start",
          output: "Sample ENOENT: verification binary unavailable",
          exitCode: 127,
        },
      ],
    };
    test.runs = [run];
  }
  for (const record of tasks) {
    const starts = (record.runs ?? []).flatMap((run) => (run.startedAt ? [run.startedAt] : [])).sort();
    if (starts[0]) {
      record.startedAt = starts[0];
      record.createdAt = new Date(Date.parse(starts[0]) - 60_000).toISOString();
    }
  }
}
