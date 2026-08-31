import type { RuntimeArtifact, RuntimeTask, StageId } from "../../domain";
import type { OperatorFact } from "./operatorViewModel";
import {
  candidateGateStages,
  getRuntimeFocusedTest,
  getRuntimeGateFreshness,
  isGateUnattempted,
} from "./workflow";

export function buildOperatorStageFacts(
  task: RuntimeTask,
  stageId: StageId,
  artifact: RuntimeArtifact | undefined,
): OperatorFact[] {
  const packages = task.workPackages ?? [];
  const candidate = task.candidates?.at(-1);
  const focusedTest = getRuntimeFocusedTest(task);
  const completePackages = packages.filter((item) =>
    ["ready_for_integration", "integrated"].includes(item.status),
  );
  const failedPackages = packages.filter((item) => item.status === "failed");
  switch (stageId) {
    case "triage":
      return [
        {
          label: "Workflow",
          value: humanizeStatus(task.workflow),
          detail: `${task.priority} priority task.`,
        },
        {
          label: "Profile",
          value: humanizeStatus(task.workflowProfile?.selected ?? "not selected"),
          detail: task.workflowProfile?.reason ?? "No workflow profile was persisted.",
        },
        {
          label: "Repository authority",
          value: task.repositoryAuthority
            ? task.repositoryAuthority.selectedRevision.slice(0, 8)
            : "Not bound",
          detail: task.repositoryAuthority?.targetRef ?? task.repositoryPath,
          tone: task.repositoryAuthority ? "green" : "amber",
        },
      ];
    case "scouts": {
      const selected = task.scoutDispatch?.selected ?? [];
      const failed = selected.filter((scout) => scout.status === "failed");
      return [
        {
          label: "Dispatched",
          value: `${selected.length} scout${selected.length === 1 ? "" : "s"}`,
          detail: selected.map((scout) => scout.focus).join(", ") || "No scout dispatch was persisted.",
        },
        {
          label: "Completed",
          value: `${selected.filter((scout) => scout.status === "complete").length}`,
          detail: `${task.scoutDispatch?.skipped.length ?? 0} taxonomy entries skipped.`,
        },
        {
          label: "Failures",
          value: `${failed.length}`,
          detail: failed.map((scout) => scout.error ?? scout.name).join("; ") || "No scout failure recorded.",
          tone: failed.length ? "red" : "green",
        },
      ];
    }
    case "grill": {
      const questions = task.grillSession?.questions ?? [];
      const answered = questions.filter((question) => Boolean(question.answer));
      return [
        {
          label: "Questions",
          value: `${answered.length} / ${questions.length} answered`,
          detail: `${questions.length - answered.length} unresolved.`,
        },
        {
          label: "Policy",
          value: humanizeStatus(task.grillPolicy ?? "manual"),
          detail: "The policy was snapshotted on the task.",
        },
        {
          label: "Completion source",
          value: humanizeStatus(task.grillSession?.completionSource ?? "not completed"),
          detail: task.grillSession?.completionReason ?? "The decision frontier remains open.",
        },
      ];
    }
    case "specification":
      return artifactFacts(artifact, "Approved specification");
    case "plan":
      return [
        {
          label: "Packages",
          value: `${packages.length}`,
          detail:
            packages.length === 1
              ? "Single-package path."
              : `${new Set(packages.map((item) => item.batch)).size} dependency batches.`,
        },
        {
          label: "Verification",
          value: `${packages.reduce((sum, item) => sum + (item.verification?.length ?? 0), 0)} checks`,
          detail: "Commands remain in package evidence.",
        },
        {
          label: "Dependencies",
          value: `${packages.reduce((sum, item) => sum + (item.dependencies?.length ?? 0), 0)} edges`,
          detail: packages.length ? "Derived from the approved plan." : "No package plan has been persisted.",
        },
      ];
    case "implement":
      return [
        {
          label: "Qualified",
          value: `${completePackages.length} / ${packages.length}`,
          detail: `${packages.filter((item) => item.status === "running").length} running · ${packages.filter((item) => item.status === "planned").length} planned. Ready slices are not globally integrated.`,
        },
        {
          label: "Failed",
          value: `${failedPackages.length}`,
          detail: failedPackages.map((item) => item.id).join(", ") || "No package failure recorded.",
          tone: failedPackages.length ? "red" : "green",
        },
        {
          label: "Candidate",
          value: candidate ? `${candidate.id} r${candidate.revisionNumber}` : "Not assembled",
          detail: candidate?.headRevision
            ? `${candidate.headRevision.slice(0, 8)} · ${candidate.revisions?.length ?? candidate.revisionNumber} retained revision${(candidate.revisions?.length ?? candidate.revisionNumber) === 1 ? "" : "s"}.`
            : "No exact candidate head exists yet.",
          tone: candidate ? "blue" : "neutral",
        },
      ];
    case "dev-review":
      return gateFacts(task, "dev-review", artifact);
    case "test":
      return [
        {
          label: "Gate",
          value: gateLabel(task, "test"),
          detail: getRuntimeGateFreshness(task, "test")?.reasonCopy ?? "No authoritative test summary.",
        },
        {
          label: "Passed",
          value: `${focusedTest?.rows.filter((row) => row.status === "passed").length ?? 0}`,
          detail: focusedTest ? "Persisted candidate-bound results." : "No focused results available.",
          tone: "green",
        },
        {
          label: "Failed",
          value: `${focusedTest?.rows.filter((row) => row.status === "failed").length ?? 0}`,
          detail:
            focusedTest?.status === "failed"
              ? "Open Evidence for command and assertion detail."
              : "No failed result recorded.",
          tone: focusedTest?.status === "failed" ? "red" : "green",
        },
      ];
    case "final-review":
      return gateFacts(task, "final-review", artifact);
    case "approval":
      return [
        {
          label: "Candidate",
          value: candidate ? `${candidate.id} r${candidate.revisionNumber}` : "Unavailable",
          detail: candidate?.headRevision?.slice(0, 8) ?? "No exact candidate head.",
        },
        {
          label: "Fresh gates",
          value: `${candidateGateStages.filter((gate) => getRuntimeGateFreshness(task, gate)?.fresh).length} / ${candidateGateStages.length}`,
          detail: "Dev Review, Test, and Final Review must match the exact candidate.",
        },
        {
          label: "Pull request",
          value: task.pullRequestIntent?.number
            ? `#${task.pullRequestIntent.number} · ${humanizeStatus(task.pullRequestIntent.status)}`
            : "Not raised",
          detail:
            task.pullRequestIntent?.lastError ??
            task.pullRequestIntent?.url ??
            "Approval publishes only the exact approved SHA.",
          tone:
            task.pullRequestIntent?.status === "failed" || task.pullRequestIntent?.status === "closed"
              ? "red"
              : "blue",
        },
      ];
  }
}

function artifactFacts(artifact: RuntimeArtifact | undefined, label: string): OperatorFact[] {
  return [
    {
      label: "Handoff",
      value: artifact?.name ?? "Not produced",
      detail: artifact ? label : "No authoritative artifact exists.",
      tone: artifact ? "green" : "neutral",
    },
    {
      label: "Model",
      value: artifact?.model ?? "No model call",
      detail: artifact?.reasoning ?? "No reasoning policy recorded.",
    },
    {
      label: "Usage",
      value: artifact ? `${artifact.usage.totalTokens.toLocaleString()} tokens` : "Unavailable",
      detail: "Recorded task evidence only.",
    },
  ];
}

function gateFacts(
  task: RuntimeTask,
  stageId: "dev-review" | "final-review",
  artifact: RuntimeArtifact | undefined,
): OperatorFact[] {
  const findings = artifact?.gateResult?.findings ?? [];
  const blocking = findings.filter(
    (finding) => finding.blocking || finding.severity === "P0" || finding.severity === "P1",
  );
  return [
    {
      label: "Verdict",
      value: artifact?.gateResult?.verdict ?? gateLabel(task, stageId),
      detail: getRuntimeGateFreshness(task, stageId)?.reasonCopy ?? "No authoritative gate summary.",
      tone: artifact?.gateResult?.verdict === "REPAIR" ? "red" : "green",
    },
    { label: "Findings", value: `${findings.length}`, detail: `${blocking.length} blocking.` },
    {
      label: "Candidate",
      value: artifact?.candidateId ? `${artifact.candidateId} r${artifact.candidateRevision}` : "Not bound",
      detail: artifact?.name ?? "No candidate-bound artifact.",
    },
  ];
}

function gateLabel(task: RuntimeTask, stageId: (typeof candidateGateStages)[number]) {
  const freshness = getRuntimeGateFreshness(task, stageId);
  if (freshness?.fresh) return "Fresh";
  if (!freshness || isGateUnattempted(freshness)) return "Not started";
  return "Rerun required";
}

function humanizeStatus(value: string) {
  const text = value.replaceAll("_", " ").replaceAll("-", " ");
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}
