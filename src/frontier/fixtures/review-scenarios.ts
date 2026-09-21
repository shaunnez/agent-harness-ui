import { type RuntimeTask, stageIds } from "../../domain.ts";
import { fixtureArtifact, fixtureRun, fixtureTask, fixtureTime } from "./scenarios.ts";
import { sampleCandidate, sampleHead, samplePackages, samplePendingGates } from "./workflow.ts";

/** Explicit review-only fixtures; no real repository, provider, or GitHub mutation. */
export function reviewScenarios(): RuntimeTask[] {
  const make = (id: string, approval: boolean) => {
    const stages = stageIds.slice(0, approval ? 9 : 8);
    const task = fixtureTask(
      id,
      `Sample ${approval ? "approval" : "final review"} of revision checks`,
      "/demo/agent-harness-ui",
      {
        workflow: "implement",
        currentStage: approval ? "approval" : "final-review",
        status: approval ? "awaiting-human-approval" : "ready-for-final-review",
        completedStages: [...stages],
        workPackages: samplePackages(1).map((item) => ({
          ...item,
          status: "integrated",
          headRevision: sampleHead(10),
        })),
        activeRunIds: [],
        activeRunKind: null,
        runs: [],
        artifacts: [],
        startedAt: new Date(Date.parse(fixtureTime) - 1800000).toISOString(),
      },
    );
    const candidate = sampleCandidate(task);
    candidate.status = approval ? "awaiting_human_approval" : "ready_for_final_review";
    task.candidates = [candidate];
    task.gateFreshness = samplePendingGates(candidate);
    for (const stage of stages) {
      const artifact = fixtureArtifact(
        `${id}-${stage}`,
        stage,
        `# ${stage}\n\nRetained sample evidence for ${id}.\n\n## Outcome\nRevision checks preserve source labels and report missing revisions.\n\nThis is a demonstration; no command was executed.`,
      );
      const run = fixtureRun(id, stage, "completed");
      run.artifactId = artifact.id;
      artifact.model = run.model;
      artifact.reasoning = run.reasoning;
      if (["dev-review", "test", "final-review"].includes(stage)) {
        artifact.candidateId = candidate.id;
        artifact.candidateRevision = 1;
        artifact.gateResult = {
          verdict: "PASS",
          candidateId: candidate.id,
          candidateRevision: 1,
          evaluatedAt: fixtureTime,
          blockingReasons: [],
          findings: [],
        };
        run.candidateId = candidate.id;
        run.candidateRevision = 1;
        run.gateResult = artifact.gateResult;
        const gateStage = stage as "dev-review" | "test" | "final-review";
        task.gateFreshness[gateStage] = {
          ...task.gateFreshness[gateStage],
          stage: gateStage,
          candidateId: candidate.id,
          candidateRevision: 1,
          target: { candidateId: candidate.id, candidateRevision: 1 },
          state: "fresh",
          fresh: true,
          sourceRunId: run.id,
          sourceArtifactId: artifact.id,
          reasonCode: "fresh",
          reasonCopy: "Sample verdict bound to this candidate",
          reason: { code: "fresh", copy: "Sample verdict bound to this candidate" },
          staleReason: null,
          staleReasonCode: null,
          staleReasonCopy: null,
        };
      }
      task.runs?.push(run);
      task.artifacts.push(artifact);
    }
    const runs = task.runs ?? [];
    task.usage = {
      inputTokens: runs.reduce((sum, run) => sum + (run.usage?.inputTokens ?? 0), 0),
      outputTokens: runs.reduce((sum, run) => sum + (run.usage?.outputTokens ?? 0), 0),
      cachedInputTokens: runs.reduce((sum, run) => sum + (run.usage?.cachedInputTokens ?? 0), 0),
      totalTokens: runs.reduce((sum, run) => sum + (run.usage?.totalTokens ?? 0), 0),
      cost: null,
      pricingVersion: null,
    };
    return task;
  };
  return [make("QA-204", false), make("QA-205", true)];
}
