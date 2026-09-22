// The recipe behind all 90 recorded runs: one agent, one system prompt, one local corpus tool
// server, plus web search. Ported from `14c-run-research.sh`, `14b-mcp.json` and
// `14d-system-prompt.txt` without changing what the model is asked or what it may reach.
//
// A "recipe" is the domain-specific half of a CLI research run — the system prompt, the tool
// server, the allowed-tool list, and how to read the answer back out of the final text. The
// runtime itself knows none of it: keeping the two apart is what lets a second corpus be added
// later without touching process handling, and it is why the cost-band schema below does not
// appear in `runtime.mjs`.
//
// The output schema is a single ```json fence the system prompt asks for. Reading the answer
// out of prose is not ideal, but it is what produced 28 bands across 30 scenarios, and phase 1
// exists to reproduce that number rather than to improve on the mechanism.

import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { parseFinalJsonFence } from "./stream.mjs";

export const QV_SYSTEM_PROMPT_PATH = fileURLToPath(new URL("./qv-system-prompt.txt", import.meta.url));
export const QV_CORPUS_SERVER_PATH = fileURLToPath(new URL("./qv-corpus-server.py", import.meta.url));

/** The four tools, in the order `14c-run-research.sh` lists them. `--allowed-tools` is the
 *  only gate on what the agent may reach: everything absent from this list is unavailable
 *  regardless of what else the operator has configured. */
export const QV_ALLOWED_TOOLS = [
  "mcp__qv__search_qv",
  "mcp__qv__get_qv_table",
  "mcp__qv__list_qv_sections",
  "WebSearch",
];

export const QV_INDEX_ENV_VAR = "RESEARCH_QV_INDEX";

/** Where the licensed local capture lives. Required, never defaulted: a run that silently
 *  searched an empty corpus would fall back to the web for everything and produce a plausible
 *  band from the wrong source of resort — the same class of failure as falling back to a fake
 *  model, and just as invisible in the output. */
export function resolveCorpusIndexPath(env = process.env, override = null) {
  const configured = override ?? env[QV_INDEX_ENV_VAR];
  if (!configured)
    throw new Error(
      `No priced-rate capture is configured. Set ${QV_INDEX_ENV_VAR} to the indexed-items.jsonl of the local capture.`,
    );
  return path.resolve(configured);
}

/** The `--mcp-config` document. One stdio server, dependency-free, reading the capture path
 *  from argv so nothing about it is baked into the file. */
export function qvMcpConfig({ pythonBin = "python3", serverPath = QV_CORPUS_SERVER_PATH, indexPath }) {
  return { mcpServers: { qv: { command: pythonBin, args: [serverPath, indexPath] } } };
}

// --- reading the answer back ----------------------------------------------------------------

const BAND_STATUSES = new Set(["qv", "qv+web", "web", "supplier_quote", "not_established"]);

/** The cost-band object the system prompt asks for, or null when the model produced none.
 *  Null is an ordinary outcome, not an error: two of the thirty pinned scopes are supposed to
 *  produce no band at all, and a runtime that treated that as a failure would score them wrong. */
export function parseCostBand(finalText) {
  const parsed = parseFinalJsonFence(finalText);
  if (!parsed) return null;
  const band = parsed.band && typeof parsed.band === "object" ? parsed.band : null;
  const low = numberOrNull(band?.low);
  const high = numberOrNull(band?.high);
  return {
    id: stringOrNull(parsed.id),
    resolvedFrom: BAND_STATUSES.has(parsed.resolved_from) ? parsed.resolved_from : "not_established",
    confidence: stringOrNull(parsed.confidence),
    components: Array.isArray(parsed.components) ? parsed.components.map(readComponent) : [],
    // Both ends or neither. A half-open band cannot be compared against another run's, and the
    // system prompt asks for nulls rather than a guess when only one end is known.
    band:
      low != null && high != null
        ? {
            unit: stringOrNull(band.unit),
            low,
            high,
            centre: stringOrNull(band.centre),
            basis: stringOrNull(band.basis),
          }
        : null,
    notEstablished: Array.isArray(parsed.not_established) ? parsed.not_established.map(String) : [],
    queriesTried: Array.isArray(parsed.qv_queries_tried) ? parsed.qv_queries_tried.map(String) : [],
  };
}

function readComponent(raw) {
  const amount = raw?.amount && typeof raw.amount === "object" ? raw.amount : {};
  return {
    role: stringOrNull(raw?.role),
    rowId: stringOrNull(raw?.row_id),
    source: stringOrNull(raw?.source),
    unit: stringOrNull(raw?.unit),
    low: numberOrNull(amount.low),
    high: numberOrNull(amount.high),
    centre: stringOrNull(raw?.centre),
    caveat: stringOrNull(raw?.caveat),
  };
}

/**
 * Turn a parsed cost band into neutral findings and evidence.
 *
 * Every finding is `unverified`, and says so in `notes` rather than only by omission. Three
 * runs agreeing means the scope was specified well enough to reproduce, not that the answer is
 * right, and no quantity surveyor has reviewed any of these bands. A finding that carried no
 * such marker would read, downstream, as a checked number.
 */
export function findingsFromCostBand(costBand, { runId, retrievedAt = new Date().toISOString() } = {}) {
  if (!costBand) return [];
  const findings = [];
  const unreviewed = (stated) =>
    `Model-stated confidence: ${stated ?? "unstated"}. Unreviewed: no quantity surveyor has checked this.`;

  for (const [index, component] of costBand.components.entries()) {
    const evidence = [];
    if (component.rowId)
      evidence.push({
        sourceId: component.rowId,
        sourceType: "internal_record",
        title: `Priced-rate row ${component.rowId}`,
        retrievedAt,
        quoteVerified: false,
        authority: "primary",
        ...(component.caveat ? { excerpt: component.caveat } : {}),
      });
    if (component.source)
      evidence.push({
        sourceId: component.source,
        sourceType: "web",
        url: component.source,
        title: component.role ?? component.source,
        retrievedAt,
        quoteVerified: false,
        authority: "secondary",
      });
    findings.push({
      id: `${runId}#component-${index + 1}`,
      claim: componentClaim(component),
      evidence,
      ...(component.caveat ? { assumptions: [component.caveat] } : {}),
      producedBy: "researcher",
      verification: { status: "unverified", notes: unreviewed(costBand.confidence) },
    });
  }

  findings.push({
    id: `${runId}#band`,
    claim: costBand.band
      ? `Cost band ${costBand.band.low}–${costBand.band.high} per ${costBand.band.unit ?? "unit"} (${costBand.band.centre ?? "centre unstated"}), NZD, GST exclusive.`
      : "No cost band could be established for this scope.",
    // The band is a roll-up of the components above; its evidence is those findings, not a
    // fresh citation, so attaching one here would double-count the same row.
    evidence: [],
    ...(costBand.band?.basis ? { assumptions: [costBand.band.basis] } : {}),
    producedBy: "synthesiser",
    verification: { status: "unverified", notes: unreviewed(costBand.confidence) },
  });
  return findings;
}

function componentClaim(component) {
  const amount =
    component.low != null && component.high != null
      ? `${component.low}–${component.high} per ${component.unit ?? "unit"}`
      : "no amount established";
  return `${component.role ?? "Component"}: ${amount}${component.centre ? ` (${component.centre})` : ""}.`;
}

function numberOrNull(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringOrNull(value) {
  const text = typeof value === "string" ? value.trim() : "";
  return text || null;
}
