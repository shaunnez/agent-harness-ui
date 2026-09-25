import { redactSecrets, retainFailedCommandOutput } from "./command-output-retention.mjs";
import { activity } from "./orchestrator-stage-support.mjs";
import { runEventMetadata } from "./run-activity.mjs";

const bounded = (value, limit) => (typeof value === "string" ? redactSecrets(value).slice(0, limit) : null);

/** Only already-normalized operational fields cross the persistence boundary. */
export function normalizeActivity(event) {
  if (event?.type !== "activity" || typeof event.title !== "string") return null;
  const call = event.toolCall;
  return {
    type: "activity",
    title: bounded(event.title, 250),
    detail: bounded(event.detail, 2000),
    tone: ["info", "success", "warning", "danger"].includes(event.tone) ? event.tone : "info",
    commandFailed: event.commandFailed === true,
    runtimeScope: bounded(event.runtimeScope, 100),
    occurredAt: typeof event.at === "string" && Number.isFinite(Date.parse(event.at)) ? event.at : null,
    toolCall: call
      ? {
          id: bounded(call.id, 200),
          name: bounded(call.name, 100),
          category: bounded(call.category, 100),
          server: bounded(call.server, 100),
          phase: call.phase === "completed" ? "completed" : "started",
          result: bounded(call.result, 1000),
          failureOutput: event.commandFailed ? retainFailedCommandOutput(call.failureOutput) : null,
        }
      : null,
  };
}

export function appendIncrementalActivity(draft, runId, events) {
  const run = draft.runs.find((item) => item.id === runId);
  if (run?.status !== "running" || !draft.activeRunIds.includes(runId)) {
    throw new Error("Activity belongs to a run that is no longer active.");
  }
  for (const event of events) {
    if (event.ordinal <= (run.activitySequence ?? 0)) continue;
    draft.events.push(
      activity(run.stage, event.title, event.detail, event.tone, event.toolCall ? "tool" : "agent", {
        ...runEventMetadata(run),
        id: event.activityId,
        at: event.observedAt,
        occurredAt: event.occurredAt,
        candidateId: run.candidateId,
        candidateRevision: run.candidateRevision,
        workPackageId: run.workPackageId,
        toolCall: event.toolCall,
      }),
    );
    run.activitySequence = event.ordinal;
  }
}

/** Per-run batching; the store owns serialization across all concurrently running packages. */
export function createActivityRecorder({
  store,
  taskId,
  runId,
  onOverflow,
  report = console.error,
  intervalMs = 250,
  batchSize = 25,
  pendingLimit = 500,
}) {
  let pending = [],
    ordinal = 0,
    timer = null,
    flight = null,
    closed = false;
  let storageFailed = false,
    overflowed = false,
    firstCommandFailure = null;
  const retained = [],
    seen = new Set();
  const schedule = () => {
    if (!closed && !timer && pending.length) {
      timer = setTimeout(() => {
        timer = null;
        void flush().catch(() => {});
      }, intervalMs);
      timer.unref?.();
    }
  };
  function enqueue(event) {
    const item = {
      ...event,
      ordinal: ++ordinal,
      activityId: `${runId}:activity:${ordinal}`,
      observedAt: new Date().toISOString(),
    };
    pending.push(item);
    retained.push(item);
    if (item.commandFailed && item.runtimeScope !== "context-preflight" && !firstCommandFailure)
      firstCommandFailure = item;
    if (retained.length > 2000) retained.shift();
  }
  async function flush() {
    if (flight) return flight;
    if (!pending.length) return;
    const batch = pending.slice(0, batchSize);
    flight = store
      .update(taskId, (draft) => appendIncrementalActivity(draft, runId, batch))
      .then((task) => {
        if (!task) throw new Error("Activity task no longer exists.");
        pending.splice(0, batch.length);
        if (storageFailed) {
          storageFailed = false;
          enqueue({
            type: "activity",
            title: "Activity recording recovered",
            tone: "warning",
            detail: "Pending activity was retained and retried after a storage failure.",
            toolCall: null,
          });
        }
      })
      .catch((error) => {
        if (!storageFailed)
          report(
            JSON.stringify({
              event: "activity_persistence_failed",
              taskId,
              runId,
              pending: pending.length,
              message: "Pending activity retained for retry",
            }),
          );
        storageFailed = true;
        throw error;
      })
      .finally(() => {
        flight = null;
        schedule();
      });
    return flight;
  }
  return {
    add(input) {
      if (closed || overflowed) return false;
      const event = normalizeActivity(input);
      if (!event) return false;
      const key = event.toolCall?.id ? `${event.toolCall.id}:${event.toolCall.phase}` : null;
      if (key && seen.has(key)) return false;
      if (pending.length >= pendingLimit) {
        overflowed = true;
        enqueue({
          type: "activity",
          title: "Activity coverage interrupted",
          tone: "danger",
          detail:
            "The pending activity limit was reached. The run was stopped; activity coverage is incomplete.",
          toolCall: null,
        });
        report(JSON.stringify({ event: "activity_buffer_full", taskId, runId }));
        onOverflow?.();
        return false;
      }
      if (key) {
        seen.add(key);
        if (seen.size > 2000) seen.delete(seen.values().next().value);
      }
      enqueue(event);
      if (pending.length >= batchSize) void flush().catch(() => {});
      else schedule();
      return true;
    },
    flush,
    async close() {
      closed = true;
      clearTimeout(timer);
      timer = null;
      let attempts = 0;
      while (pending.length) {
        try {
          await flush();
          attempts = 0;
        } catch (error) {
          if (++attempts >= 3)
            throw new Error("Activity could not be persisted; pending coverage is incomplete.", {
              cause: error,
            });
        }
      }
    },
    events() {
      return firstCommandFailure && !retained.includes(firstCommandFailure)
        ? [firstCommandFailure, ...retained]
        : [...retained];
    },
    get overflowed() {
      return overflowed;
    },
  };
}
