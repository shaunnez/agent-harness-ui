/**
 * Writers for `task.topologyTrace` — the record of which reasoning graph a run actually
 * walked. Phase 1 defined the shape and reads it for reporting; these are the only functions
 * that should write it, so a stage cannot half-record its own execution.
 *
 * Every writer takes a store draft and mutates it in place, matching the `activity()` idiom in
 * `orchestrator-stage-support.mjs`. All of them are idempotent in the sense that matters:
 * re-recording the same node appends another execution, which is correct — a stage that ran
 * twice did run twice, and the counters exist to show that.
 */
import { emptyTopologyTrace, normalizeTopologyTrace } from "./evaluation.mjs";

function trace(draft) {
  if (!draft.topologyTrace) draft.topologyTrace = emptyTopologyTrace();
  for (const key of ["nodesExecuted", "nodesSkipped", "edgesTaken", "routingDecisions"]) {
    if (!Array.isArray(draft.topologyTrace[key])) draft.topologyTrace[key] = [];
  }
  return draft.topologyTrace;
}

export function recordNodeExecuted(draft, node) {
  trace(draft).nodesExecuted.push(String(node));
}

export function recordNodeSkipped(draft, node, reason) {
  trace(draft).nodesSkipped.push({ node: String(node), reason: String(reason ?? "") });
}

export function recordEdge(draft, from, to, kind = "advance") {
  trace(draft).edgesTaken.push({ from: String(from), to: String(to), kind });
}

export function recordRoutingDecision(draft, { at, classification, rewindTo, rationale }) {
  trace(draft).routingDecisions.push({
    at: String(at ?? ""),
    classification: String(classification ?? ""),
    rewindTo: String(rewindTo ?? ""),
    rationale: String(rationale ?? ""),
  });
}

/**
 * Guard for the write path. Reporting is deliberately fail-soft (a bad trace degrades to
 * zeroed telemetry), which means a broken writer would otherwise be invisible. Calling this
 * after a batch of writes turns that silence into an immediate error at the point of the bug.
 */
export function assertTopologyTraceValid(task) {
  normalizeTopologyTrace(task.topologyTrace);
  return task.topologyTrace;
}
