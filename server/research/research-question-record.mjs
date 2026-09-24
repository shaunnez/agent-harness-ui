// The question record the research window reads: the same shape the sample world builds from
// `18a-review-feed.json` (`ResearchQuestion` in `src/frontier/runtime/research.ts`), so fixture
// and live data are one record type.
//
// Everything here is computed from stored runs, every time. Status comes from the recorded
// three-run agreement rule and nothing else: no model is asked whether its runs agree.

import { createHash } from "node:crypto";
import { agreementForRuns } from "./claude-cli/agreement.mjs";

const ACTIVITY_PER_RUN = 80;

/**
 * `question` is a `ResearchQuestionStore` record; `runs` are the question's run records (with
 * `runLabel` and `outcome`) in label order; `events` maps a run id to its stored events, and is
 * empty for a list read; `review` is the standing review or null.
 */
export function questionRecord({ question, runs, events = new Map(), review = null }) {
  const runRecords = runs.map((run) => runRecord(run, events.get(run.id) ?? []));
  const pending = runRecords.filter((run) => run.status === "running" || run.status === "queued");
  const recorded = pending.length
    ? null
    : agreementForRuns(
        runs.map((run) => ({
          run: run.runLabel,
          status: run.status,
          band: run.outcome?.costBand?.band ?? null,
          error: run.error,
        })),
      );
  // The recorded rule compares numbers, because the pinned scopes fixed the unit. An open question
  // does not, and two runs pricing per m² and per house are not 40x apart; they are not comparable.
  const scopeMeasure = question.scope?.scope?.measure ?? null;
  const unitsDiffer =
    recorded && recorded.status !== "incomplete" ? differingUnits(runs, scopeMeasure) : null;
  const agreement = unitsDiffer ? incomparable(recorded) : loneBand(singleRun(recorded, runs), runs);
  const status = pending.length
    ? runRecords.some((run) => run.status === "running")
      ? "running"
      : "queued"
    : agreement.status;
  const firstBand = runs.map((run) => run.outcome?.costBand?.band).find(Boolean) ?? null;
  const settledAt = pending.length ? null : latest(runs.map((run) => run.updatedAt));
  const costs = runRecords.map((run) => run.costUsd).filter((cost) => cost != null);
  const completed = runs.filter((run) => run.status === "completed");

  const evidence = {
    id: question.id,
    projectId: question.projectId,
    title: question.title,
    objective: question.objective,
    family: null,
    unit: unitsDiffer ? null : (agreement?.unit ?? firstBand?.unit ?? null),
    askedAt: question.createdAt,
    engine: engineOf(runs[0] ?? null),
    runsPlanned: question.runsPlanned,
    status,
    range: agreement?.range ?? null,
    consensus: agreement?.consensus ?? null,
    agreement: agreement?.agreement ?? {
      lowRatio: null,
      highRatio: null,
      runsWithBand: runRecords.filter((run) => run.low != null).length,
      runsTotal: runs.length,
    },
    // The recipe asks every run for NZD, GST exclusive, and the band finding states it.
    currency: "NZD",
    gstBasis: "exclusive",
    centre: agreement?.centre ?? firstBand?.centre ?? null,
    asOf: settledAt ? settledAt.slice(0, 10) : null,
    basis: agreement?.basis ?? firstBand?.basis ?? null,
    runs: runRecords.map(({ activity: _activity, ...run }) => run),
    qvSources: qvSourcesOf(runRecords),
    webSources: unique(runRecords.flatMap((run) => run.components.map((item) => item.source))),
    openQuestions: unique(runRecords.flatMap((run) => run.notEstablished)),
    // True only when every run that finished had its citations checked by the host.
    citationsChecked: completed.length > 0 && completed.every((run) => run.outcome?.citations),
    costUsd: costs.length ? round2(costs.reduce((sum, cost) => sum + cost, 0)) : null,
    elapsedMs: settledAt ? Date.parse(settledAt) - Date.parse(question.createdAt) : null,
    source: question.source,
    // The pinned scope every run was given, and who scoped it. Part of the fingerprint: a review
    // approves an answer to this scope.
    scope: question.scope?.scope ?? null,
    scopedBy: question.scope?.scopedBy ?? null,
    scopeReviewed: question.scope ? question.scope.reviewed === true : null,
    unitsDiffer,
  };
  return {
    ...evidence,
    runs: runRecords,
    // Everything a reviewer judged, and nothing about the review itself or the live activity
    // feed, so a review stays current until the evidence behind it changes.
    evidenceSha: fingerprint(evidence),
    review,
    provenance: "live",
    provenanceNote: provenanceNote(runs[0] ?? null, question),
  };
}

function runRecord(run, events) {
  const band = run.outcome?.costBand?.band ?? null;
  const costBand = run.outcome?.costBand ?? null;
  const checks = run.outcome?.citations?.checks ?? null;
  return {
    run: run.runLabel ?? run.id,
    runId: run.id,
    status: runStatus(run.status),
    low: band?.low ?? null,
    high: band?.high ?? null,
    unit: band?.unit ?? null,
    resolvedFrom: costBand?.resolvedFrom ?? null,
    confidence: costBand?.confidence ?? null,
    basis: band?.basis ?? null,
    components: (costBand?.components ?? []).map((component, index) => ({
      role: component.role ?? "Unnamed component",
      basis: component.basis ?? (component.rowId ? "qv" : component.source ? "web" : "unstated"),
      rowId: component.rowId ?? null,
      source: component.source ?? null,
      excerpt: component.excerpt ?? null,
      page: component.page ?? null,
      unit: component.unit ?? null,
      low: component.low ?? null,
      high: component.high ?? null,
      centre: component.centre ?? null,
      caveat: component.caveat ?? null,
      // No check ran is "unchecked", never a pass.
      check: checks?.[index] ?? "unchecked",
    })),
    notEstablished: costBand?.notEstablished ?? [],
    error:
      run.status === "cancelled"
        ? { code: "cancelled", message: "The run was cancelled before it finished." }
        : run.error
          ? { code: String(run.error.code ?? "failed"), message: String(run.error.message ?? "") }
          : null,
    costUsd: typeof run.usage?.estimatedCostUsd === "number" ? run.usage.estimatedCostUsd : null,
    citations: citationSummary(run.outcome?.citations?.summary ?? null),
    activity: activityOf(events),
  };
}

/** Coarse measure a band is priced in, read from the run's own unit text. The unit text is prose
 *  ("m² treated area (footprint plus 1-2m margin)"), so only the measure is compared; wording that
 *  names no known measure is left out of the comparison rather than counted as a difference. */
const UNIT_MEASURES = [
  [/\b(house|dwelling|home)s?\b/i, "per house"],
  // Totals before rates: "lump sum, 1200m²" and "per assumed 500 m² building" name an area but
  // price the whole job.
  [
    /\b(lump[- ]sum|total|whole[- ]\w+|per (assumed )?(\w+ ){0,3}(job|project|building))\b|\bfor (an? |the )?(assumed )?\d[\d,.]*\s?(m²|m2)|\bper assumed \d/i,
    "total",
  ],
  [/(m²|m2\b|sq\.?\s?m\b|square met)/i, "per m²"],
  [/(m³|m3\b|cubic met)/i, "per m³"],
  [/(lin(?:eal|ear)?\.?\s?m\b|\blm\b|per metre|per meter|\/m\b|\bper m\b)/i, "per metre"],
  [/\b(each|ea|item|no\.)\b/i, "each"],
  [/\b(hour|hr|day|week)s?\b/i, "per time"],
];

/** A unit that opens with a rate ("$/m2 finished slab, and total for 300 m2", "NZD per m² …") is
 *  that rate, whatever it goes on to say: a run that also states the job total is still pricing
 *  per m². Read before the total patterns, which would otherwise take "total for 300 m2". */
const RATE_PREFIX =
  /^\s*(?:NZD|NZ\$|\$)?\s*(?:\/|per\s+)\s*(m²|m2|sq\.?\s?m|m³|m3|lin(?:eal|ear)?\.?\s?m|lm|metre|meter|m|each|ea|item|house|dwelling|hour|hr|day|week)(?![A-Za-z0-9])/i;

export function unitMeasure(unit) {
  const text = String(unit ?? "");
  const rate = RATE_PREFIX.exec(text);
  if (rate) {
    const token = /^(m|metre|meter)$/i.test(rate[1]) ? "per m" : rate[1];
    const measure = UNIT_MEASURES.find(([pattern, name]) => name !== "total" && pattern.test(token))?.[1];
    if (measure) return measure;
  }
  return UNIT_MEASURES.find(([pattern]) => pattern.test(text))?.[1] ?? null;
}

/** The banded runs' units, when they name at least two different measures, or any measure other
 *  than the pinned scope's; otherwise null. */
function differingUnits(runs, scopeMeasure = null) {
  const units = runs.map((run) => run.outcome?.costBand?.band).filter((band) => band && band.low != null);
  const measures = new Set(units.map((band) => unitMeasure(band.unit)).filter(Boolean));
  const offScope = scopeMeasure != null && [...measures].some((measure) => measure !== scopeMeasure);
  return measures.size > 1 || offScope ? units.map((band) => String(band.unit ?? "unit not stated")) : null;
}

/** One banded run agrees with itself, so a Quick question is one run, not an agreement. */
function singleRun(recorded, runs) {
  if (recorded?.status !== "agreed" || runs.length !== 1) return recorded;
  return { ...recorded, status: "single_run" };
}

/**
 * One band among several runs agrees with itself too. The recorded rule (`agreement.mjs`) calls
 * that agreed, and must keep doing so to reproduce the 22 September baseline; a question does
 * not. When only one of two or more runs found a band, the runs disagree about whether the scope
 * can be priced at all: disputed, with the one band as the range and no consensus. Two banded
 * runs that agree still read as agreed, as the recorded rule has it.
 */
function loneBand(recorded, runs) {
  if (recorded?.status !== "agreed" || runs.length < 2 || recorded.agreement.runsWithBand >= 2)
    return recorded;
  return {
    ...recorded,
    status: "disputed",
    consensus: null,
    agreement: { ...recorded.agreement, lowRatio: null, highRatio: null },
  };
}

/** Disputed, with no consensus or ratio: bands in different units have neither. */
function incomparable(recorded) {
  return {
    ...recorded,
    status: "disputed",
    range: null,
    consensus: null,
    agreement: { ...recorded.agreement, lowRatio: null, highRatio: null },
    unit: null,
  };
}

function runStatus(status) {
  if (status === "completed") return "completed";
  if (status === "failed" || status === "cancelled") return "failed";
  if (status === "queued") return "queued";
  return "running";
}

function citationSummary(summary) {
  if (!summary) return null;
  return {
    rowsCited: summary.rowsCited ?? 0,
    rowsFound: summary.rowsFound ?? 0,
    webCited: summary.webCited ?? 0,
    webVerified: summary.webVerified ?? 0,
    webNotFetched: summary.webNotFetched ?? 0,
    webExcerptRejected: summary.webExcerptRejected ?? 0,
    allowances: summary.allowances ?? 0,
  };
}

/** Row ids only. The licensed row text stays in the capture and the run's retained snapshot. */
function qvSourcesOf(runs) {
  const citedBy = new Map();
  for (const run of runs)
    for (const rowId of new Set(run.components.map((item) => item.rowId).filter(Boolean)))
      citedBy.set(rowId, (citedBy.get(rowId) ?? 0) + 1);
  return [...citedBy].map(([rowId, count]) => ({
    rowId,
    section: null,
    group: null,
    desc: null,
    unit: null,
    url: null,
    regional: {},
    citedBy: count,
  }));
}

function engineOf(run) {
  const policy = run?.request?.researchPolicy ?? null;
  return {
    runtime: policy?.runtime ?? run?.runtimeId ?? "claude-cli",
    model: policy?.model ?? run?.model?.model ?? "not recorded",
    reasoning: policy?.reasoning ?? null,
  };
}

function provenanceNote(run, question) {
  const plan =
    run?.runtimeId === "codex-cli"
      ? "the ChatGPT plan"
      : run?.runtimeId === "claude-cli"
        ? "the Claude plan"
        : `the ${run?.runtimeId ?? "unknown"} runtime`;
  const origin =
    question.source?.kind === "external"
      ? `Raised by ${question.source.provider} request ${question.source.requestId}`
      : "Asked here";
  return `${origin}, answered on ${plan}. Citations are checked by the host after each run.`;
}

const TOOL_LABELS = {
  search_qv: "Searched QV",
  get_qv_table: "Opened a QV table",
  list_qv_sections: "Listed QV sections",
  WebSearch: "Searched the web",
  web_search: "Searched the web",
  fetch_source: "Fetched a page",
  read_source: "Read a fetched page",
};

function activityOf(events) {
  const activity = [];
  for (const event of events) {
    const at = event.timestamp ?? event.occurredAt ?? "";
    const data = event.data ?? {};
    if (event.type === "run.started") activity.push({ at, kind: "started", label: "Run started" });
    else if (event.type === "tool.called") {
      const tool =
        String(data.tool ?? "")
          .split("__")
          .at(-1) ?? "";
      const input = data.input ?? {};
      const detail = input.query ?? input.row_id ?? input.url ?? input.contains ?? input.source_id;
      activity.push({
        at,
        kind: "tool",
        label: TOOL_LABELS[tool] ?? `Called ${tool || "a tool"}`,
        ...(detail ? { detail: clip(String(detail)) } : {}),
      });
    } else if (event.type === "finding.created" && data.message)
      activity.push({ at, kind: "finding", label: "Wrote", detail: clip(String(data.message)) });
    else if (event.type === "budget.ceiling_hit")
      activity.push({ at, kind: "failed", label: "Reached a budget limit", detail: data.ceiling });
    else if (event.type === "run.failed")
      activity.push({ at, kind: "failed", label: "Run failed", detail: clip(String(data.message ?? "")) });
    else if (event.type === "run.cancelled") activity.push({ at, kind: "failed", label: "Run cancelled" });
    else if (event.type === "run.completed")
      activity.push({
        at,
        kind: "completed",
        label: "Run finished",
        ...(data.band
          ? { detail: `${data.band.low}–${data.band.high} per ${data.band.unit ?? "unit"}` }
          : {}),
      });
  }
  return activity.slice(-ACTIVITY_PER_RUN);
}

/** sha256 over canonical JSON: key order never changes the fingerprint. */
export function fingerprint(value) {
  return createHash("sha256").update(canonical(value)).digest("hex");
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(",")}}`;
  return JSON.stringify(value ?? null);
}

function latest(values) {
  return values.filter(Boolean).sort().at(-1) ?? null;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function clip(text) {
  return text.length > 200 ? `${text.slice(0, 199)}…` : text;
}

function round2(value) {
  return Math.round(value * 100) / 100;
}
