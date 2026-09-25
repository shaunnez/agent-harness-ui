import { projectTaskAttention } from "./task-attention.mjs";

const text = (value, limit = 1000) => (typeof value === "string" ? value.slice(0, limit) : null);

/** Minimal operational records: no transcripts, prompts, paths or provider streams. */
export function projectWatchRun(run) {
  if (!run) return null;
  const result = {};
  for (const field of [
    "id",
    "stage",
    "status",
    "role",
    "model",
    "reasoning",
    "startedAt",
    "completedAt",
    "durationMs",
    "candidateId",
    "candidateRevision",
    "workPackageId",
    "artifactId",
  ])
    if (run[field] != null) result[field] = run[field];
  if (run.usage) {
    result.usage = {};
    for (const field of [
      "inputTokens",
      "outputTokens",
      "cachedInputTokens",
      "totalTokens",
      "cost",
      "credits",
    ])
      if (Number.isFinite(run.usage[field]) && run.usage[field] >= 0) result.usage[field] = run.usage[field];
    if (run.usage.pricingVersion) result.usage.pricingVersion = text(run.usage.pricingVersion, 100);
  } else result.usage = null;
  return result;
}

export function isWatchRunActive(task, run) {
  return Boolean(
    run?.status === "running" &&
      task?.activeRunIds?.includes(run.id) &&
      projectTaskAttention(task).kind === "running",
  );
}

export function projectWorkspaceState(task) {
  if (!task) return null;
  const attention = projectTaskAttention(task);
  return {
    kind: "task-state",
    status: task.status,
    stage: task.currentStage,
    label: attention.label,
    reason: text(attention.reason),
    nextActor: attention.nextActor,
    attentionKind: attention.kind,
  };
}

export function projectWorkspaceCandidate(task) {
  const candidate = task?.candidates?.at(-1);
  if (!candidate) return null;
  return {
    kind: "candidate-gates",
    candidateId: candidate.id,
    candidateRevision: candidate.revisionNumber,
    candidateHeadRevision: candidate.headRevision ?? null,
    stage: task.currentStage,
    label: `Candidate ${candidate.id} · revision ${candidate.revisionNumber} · ${candidate.status}`,
    reason: null,
    // Stored gate verdicts are part of the comparison, never inferred from a green package.
    gates: task.gateFreshness
      ? Object.fromEntries(
          Object.entries(task.gateFreshness).map(([stage, gate]) => [
            stage,
            gate
              ? {
                  state: gate.state,
                  fresh: gate.fresh,
                  reason: text(gate.reasonCopy),
                  candidateId: gate.candidateId,
                  candidateRevision: gate.candidateRevision,
                  artifactId: gate.sourceArtifactId,
                  runId: gate.sourceRunId,
                }
              : null,
          ]),
        )
      : null,
    candidateStatus: candidate.status,
  };
}

export function materialCoreChanges(previous, next) {
  const changes = [];
  for (const project of [projectWorkspaceState, projectWorkspaceCandidate]) {
    const before = project(previous),
      after = project(next);
    if (after && JSON.stringify(before) !== JSON.stringify(after)) {
      if (after.kind === "candidate-gates") {
        const changed = Object.entries(after.gates ?? {}).filter(
          ([stage, gate]) => JSON.stringify(before?.gates?.[stage]) !== JSON.stringify(gate),
        );
        after.reason =
          changed
            .map(
              ([stage, gate]) =>
                `${stage}: ${gate?.state ?? "unavailable"}${gate?.reason ? ` — ${gate.reason}` : ""}`,
            )
            .join("; ") || null;
      }
      if (after.kind === "task-state") {
        after.fromStage = previous?.currentStage ?? null;
        after.fromStatus = previous?.status ?? null;
        after.transition = !previous
          ? "task-created"
          : next.status === "completed" && previous.status !== "completed"
            ? "task-completed"
            : next.activeRunKind === "repair" &&
                (next.activeRunReservationId !== previous.activeRunReservationId ||
                  previous.currentStage !== next.currentStage)
              ? "repair-started"
              : previous.currentStage !== next.currentStage
                ? "stage-advanced"
                : before?.attentionKind !== after.attentionKind &&
                    ["answer", "approval", "failed", "repair", "blocked"].includes(after.attentionKind)
                  ? "attention"
                  : null;
        if (after.transition === "repair-started") {
          const candidate = next.candidates?.at(-1);
          after.reservationId = next.activeRunReservationId;
          after.candidateId = candidate?.id;
          after.candidateRevision = candidate?.revisionNumber;
        }
      }
      changes.push(after);
    }
  }
  return changes;
}

export function workspaceIdentity(task, projects) {
  const project = projects.find((item) => item.repositoryPath === task.repositoryPath);
  return {
    taskId: task.id,
    taskTitle: text(task.title, 250) ?? task.id,
    projectId: project?.id ?? null,
    projectName: text(project?.name, 150),
    stage: task.currentStage,
  };
}
