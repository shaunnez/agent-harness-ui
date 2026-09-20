import {
  isWatchRunActive,
  materialCoreChanges,
  projectWatchRun,
  workspaceIdentity,
} from "../../../server/workspace-history-projection.mjs";
import type { WorkspaceChange, WorkspaceHistoryRequest } from "../../domain/workspace-history.ts";
import type { RuntimeProject, RuntimeTask } from "../../domain.ts";

export function fixtureHistory(
  tasks: Map<string, RuntimeTask>,
  projects: RuntimeProject[],
  online: () => void,
) {
  let sourceId = `fixture-${crypto.randomUUID()}`;
  let previous = new Map([...tasks].map(([id, task]) => [id, structuredClone(task)]));
  let records: WorkspaceChange[] = [];
  let upper = 0,
    floor = 0;
  const coverageStartAt = new Date().toISOString();
  function observe(task: RuntimeTask) {
    const prior = previous.get(task.id) ?? null;
    const identity = workspaceIdentity(task, projects);
    const facts: Array<Omit<WorkspaceChange, "sequence" | "observedAt">> = materialCoreChanges(
      prior,
      task,
    ).map((fact) => ({ ...identity, ...fact }));
    for (const artifact of task.artifacts)
      if (!prior?.artifacts.some((item) => item.id === artifact.id))
        facts.push({
          ...identity,
          kind: "artifact-arrived",
          artifactId: artifact.id,
          stage: artifact.stage,
          label: artifact.name,
          reason: null,
        });
    for (const run of task.runs ?? []) {
      if (
        !["completed", "failed", "cancelled", "interrupted", "timed-out", "timed_out", "timeout"].includes(
          run.status,
        )
      )
        continue;
      const projected = projectWatchRun(run);
      if (
        projected &&
        JSON.stringify(projected) !==
          JSON.stringify(projectWatchRun(prior?.runs?.find((item) => item.id === run.id)))
      )
        facts.push({
          ...identity,
          kind: "run-completed",
          run: projected,
          stage: run.stage,
          label: `Run ${run.id} · ${run.status}`,
          reason: null,
        });
    }
    for (const fact of facts)
      records.push({ ...fact, sequence: ++upper, observedAt: new Date().toISOString() });
    if (records.length > 5000) {
      records = records.slice(-5000);
      floor = (records[0]?.sequence ?? upper + 1) - 1;
    }
    previous.set(task.id, structuredClone(task));
  }
  return {
    observe,
    reset() {
      sourceId = `fixture-${crypto.randomUUID()}`;
      upper = 0;
      floor = 0;
      records = [];
      previous = new Map([...tasks].map(([id, task]) => [id, structuredClone(task)]));
    },
    prune() {
      floor = upper;
      records = [];
    },
    async workspaceHead() {
      online();
      return {
        available: true,
        sourceId,
        upper,
        floor,
        coverageStartAt,
        capturedAt: new Date().toISOString(),
        reason: null,
      };
    },
    async workspaceHistory(input: WorkspaceHistoryRequest) {
      online();
      if (input.sourceId !== sourceId || input.after > input.through || input.through > upper)
        throw new Error("The sample source changed. Capture a new baseline.");
      const position = input.cursor ? Number(input.cursor) : input.after;
      const found = records.filter((item) => item.sequence > position && item.sequence <= input.through);
      const items = found.slice(0, input.limit ?? 100);
      return structuredClone({
        sourceId,
        after: input.after,
        through: input.through,
        items,
        nextCursor: found.length > items.length ? String(items.at(-1)?.sequence ?? position) : null,
        coverage: {
          complete: input.after >= floor,
          floor,
          reason:
            input.after < floor
              ? "Some sample history is no longer retained. This briefing is incomplete."
              : null,
        },
      });
    },
    async watchedRun(taskId: string, runId: string, expectedSource: string) {
      online();
      if (expectedSource !== sourceId) throw new Error("Sample source changed.");
      const task = tasks.get(taskId),
        run = task?.runs?.find((item) => item.id === runId);
      return {
        taskId,
        run: projectWatchRun(run),
        active: isWatchRunActive(task, run),
      };
    },
  };
}
