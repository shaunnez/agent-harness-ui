// Two ways a question spends less (Shaun, 26 September: "1,2,4,5,6,7 al good go and do it").
//
// Staged runs. A five-run question starts three. When those three finish, each with a band, and
// agree by the record's own rule, the question stops there. When they do anything else (disagree,
// one priced nothing, units differ), the other two start and the question is scored exactly as
// any five-run question is.
//
// This is a different sample, not a shortcut to the same answer. Re-scoring the recorded five-run
// arms (`scripts/research-eval.mjs --staged`) saves 15-21% of their cost, and on four held-out
// questions it scores differently: twice the fourth or fifth run would have priced in another
// measure and made the question disputed, and twice the five-run rule's closest three included a
// run with an unchecked component where the first three did not. Staged runs see less
// disagreement, so they pass slightly more often.
//
// A first-stage run that failed starts nothing more: the five-run rule scores a failed run as
// incomplete whatever the other two do, and a failed start can be retried as before.
//
// Answer reuse. A question asked again with the same project, objective, scope and run count,
// within `maxAgeMs` of an earlier one that finished and was not rejected on review, is answered by
// that question rather than new runs. It is off unless the service turns it on.

import { createHash } from "node:crypto";

/** Runs a staged question starts with. */
export const FIRST_STAGE_RUNS = 3;

/** Whether a staged question's first three runs settle it: every one finished with a band, the
 *  bands are in one measure, and they agree. `record` is `questionRecord` over those three. */
export function firstStageSettles(record) {
  return (
    record.status === "agreed" &&
    !record.unitsDiffer &&
    record.runs.length === FIRST_STAGE_RUNS &&
    record.runs.every((run) => run.status === "completed" && run.low != null && run.high != null)
  );
}

/** What a staged question should do now: "wait" while a first-stage run is going, "stop" when
 *  its first three settle it or cannot be helped by more runs, "extend" to start the other two. */
export function nextStage(record) {
  if (record.runs.length !== FIRST_STAGE_RUNS) return "stop";
  if (record.runs.some((run) => run.status === "running" || run.status === "queued")) return "wait";
  if (record.runs.some((run) => run.status !== "completed")) return "stop";
  return firstStageSettles(record) ? "stop" : "extend";
}

/** The hash a question's reuse is keyed by: what was asked, of which project, how many times. */
export function answerKey({ projectId, objective, scope, runs, profile }) {
  return createHash("sha256")
    .update(JSON.stringify([projectId, objective, scope ?? null, runs, profile]))
    .digest("hex");
}

/** Whether an earlier question may answer a new ask: finished, not failed, not retryable, not
 *  rejected, and young enough. `record` is its question record. */
export function reusable(record, { now, maxAgeMs }) {
  if (!record || !(maxAgeMs > 0)) return false;
  if (["running", "queued", "incomplete", "failed"].includes(record.status)) return false;
  if (record.retryable || record.review?.decision === "rejected") return false;
  const age = Date.parse(now) - Date.parse(record.askedAt);
  return Number.isFinite(age) && age >= 0 && age <= maxAgeMs;
}
