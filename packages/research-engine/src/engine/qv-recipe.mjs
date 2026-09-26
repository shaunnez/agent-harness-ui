// The QV recipe's shared parts: which host tools a run gets, where the local capture lives (read
// only to re-check recorded runs), and how the answer is read back out of the final text.
//
// The output schema is a single ```json fence the system prompt asks for.

import path from "node:path";
import process from "node:process";
import { parseFinalJsonFence } from "./final-answer.mjs";

/** The host tools every run gets: enough to retain a web page and quote it. */
export const QV_HOST_TOOLS = ["fetch_source", "read_source"];

export const QV_INDEX_ENV_VAR = "RESEARCH_QV_INDEX";

/** Where the licensed local capture lives. Required, never defaulted: a run that silently
 *  searched an empty corpus would fall back to the web for everything and produce a plausible
 *  band from the wrong source of resort. */
export function resolveCorpusIndexPath(env = process.env, override = null) {
  const configured = override ?? env[QV_INDEX_ENV_VAR];
  if (!configured)
    throw new Error(
      `No priced-rate capture is configured. Set ${QV_INDEX_ENV_VAR} to the indexed-items.jsonl of the local capture.`,
    );
  return path.resolve(configured);
}

// --- reading the answer back ----------------------------------------------------------------

const COMPONENT_BASES = new Set(["qv", "web", "allowance"]);
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
    // What makes a web figure checkable: the id `fetch_source` retained its page under, and the
    // sentence on that page that states it. Absent from every recorded run, which predates them.
    sourceId: stringOrNull(raw?.source_id),
    // `qv`, `web` or `allowance`. Only the Codex prompt asks for it; absent means the component
    // is read by what it cites, as before.
    basis: COMPONENT_BASES.has(raw?.basis) ? raw.basis : null,
    excerpt: stringOrNull(raw?.excerpt),
    page: Number.isInteger(raw?.page) && raw.page > 0 ? raw.page : null,
    unit: stringOrNull(raw?.unit),
    low: numberOrNull(amount.low),
    high: numberOrNull(amount.high),
    centre: stringOrNull(raw?.centre),
    caveat: stringOrNull(raw?.caveat),
    // The working, when the amount is not the cited figure itself: the rate as the page states
    // it and the quantity it was multiplied by. Only the API loop's prompt asks for them.
    ...readWorking(raw),
  };
}

function readWorking(raw) {
  const rate = raw?.rate && typeof raw.rate === "object" ? raw.rate : null;
  const quantity = raw?.quantity && typeof raw.quantity === "object" ? raw.quantity : null;
  const rateLow = numberOrNull(rate?.low);
  const rateHigh = numberOrNull(rate?.high) ?? rateLow;
  const quantityLow = numberOrNull(quantity?.low ?? quantity?.value);
  const quantityHigh = numberOrNull(quantity?.high ?? quantity?.value) ?? quantityLow;
  if (rateLow == null || quantityLow == null) return {};
  return {
    rate: { low: rateLow, high: rateHigh, unit: stringOrNull(rate?.unit) },
    quantity: {
      low: quantityLow,
      high: quantityHigh,
      unit: stringOrNull(quantity?.unit),
      basis: stringOrNull(quantity?.basis),
    },
  };
}

/**
 * Turn a parsed cost band into neutral findings and evidence.
 *
 * Every finding is `unverified`, and says so in `notes` rather than only by omission. Three
 * runs agreeing means the scope was specified well enough to reproduce, not that the answer is
 * right, and no quantity surveyor has reviewed any of these bands. A finding that carried no
 * such marker would read, downstream, as a checked number.
 *
 * `citations` is `checkCostBandCitations`' output. With it, each component's evidence is what
 * the host actually checked, and every citation that did not check out is named in the notes.
 * Without it — a caller with no capture to check against — the citations are carried as the
 * model stated them, all `quoteVerified: false`.
 */
export function findingsFromCostBand(
  costBand,
  { runId, retrievedAt = new Date().toISOString(), citations = null } = {},
) {
  if (!costBand) return [];
  const findings = [];
  const unreviewed = (stated, problems = []) =>
    [
      `Model-stated confidence: ${stated ?? "unstated"}. Unreviewed: no quantity surveyor has checked this.`,
      ...problems,
    ].join(" ");

  for (const [index, component] of costBand.components.entries()) {
    const checked = citations?.components?.[index] ?? null;
    const evidence = checked ? checked.evidence : statedEvidence(component, retrievedAt);
    findings.push({
      id: `${runId}#component-${index + 1}`,
      claim: componentClaim(component),
      evidence,
      ...(component.caveat ? { assumptions: [component.caveat] } : {}),
      producedBy: "researcher",
      verification: { status: "unverified", notes: unreviewed(costBand.confidence, checked?.problems) },
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

/** The citations as the model stated them, none checked. */
function statedEvidence(component, retrievedAt) {
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
  return evidence;
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
