/**
 * Research projects: one question, answered by five runs of which the three closest are scored (or
 * three runs, or a labelled one-run Quick ask), with
 * every cited figure marked by how it was checked. The sample world serves recorded questions;
 * the live gateway serves the companion's `/api/research/questions`, in the same shape.
 */

export type ResearchQuestionStatus =
  | "agreed"
  | "single_run"
  | "disputed"
  | "not_established"
  | "incomplete"
  | "running"
  | "queued";

/** How one cited figure was checked. Never inferred from the model's own claim. */
export type ResearchCheck =
  | "qv-found"
  | "qv-missing"
  | "web-verified"
  | "web-derived"
  | "web-unsupported"
  | "web-unverified"
  | "web-not-fetched"
  | "allowance"
  | "unsourced"
  /** The host could not check this run's citations (no capture, or the check failed). */
  | "unchecked";

export interface ResearchComponent {
  role: string;
  basis: "qv" | "web" | "allowance" | "unstated";
  rowId: string | null;
  source: string | null;
  excerpt: string | null;
  page: number | null;
  unit: string | null;
  low: number | null;
  high: number | null;
  centre: string | null;
  caveat: string | null;
  /** The working, when the amount is a rate the page states times a quantity; the host checks both. */
  rate?: { low: number; high: number; unit: string | null };
  quantity?: { low: number; high: number; unit: string | null; basis: string | null };
  check: ResearchCheck;
}

export interface ResearchRunCitations {
  rowsCited: number;
  rowsFound: number;
  webCited: number;
  webVerified: number;
  webNotFetched: number;
  webExcerptRejected: number;
  /** Verified quotes whose amount is worked from their figures, and those whose figures do not give it. */
  webDerived?: number;
  webUnsupported?: number;
  allowances: number;
}

export interface ResearchActivity {
  at: string;
  kind: "started" | "tool" | "source" | "finding" | "failed" | "completed";
  label: string;
  detail?: string;
}

export interface ResearchRunRecord {
  run: string;
  /** The stored run behind this label, on live questions. */
  runId?: string;
  /** Left out of scoring: of five runs, only the three that agree best are compared. */
  dropped?: boolean;
  status: "completed" | "failed" | "running" | "queued";
  low: number | null;
  high: number | null;
  unit: string | null;
  resolvedFrom: string | null;
  confidence: string | null;
  basis: string | null;
  components: ResearchComponent[];
  notEstablished: string[];
  error: { code: string; message: string } | null;
  costUsd: number | null;
  citations: ResearchRunCitations | null;
  activity: ResearchActivity[];
}

export interface ResearchEngineSnapshot {
  runtime: "claude-cli" | "codex-cli" | "opencode-cli" | "api-loop";
  model: string;
  reasoning: string | null;
}

export interface ResearchQvSource {
  rowId: string;
  section: string | null;
  group: string | null;
  desc: string | null;
  unit: string | null;
  url: string | null;
  regional: Record<string, string>;
  citedBy: number;
}

export interface ResearchReview {
  decision: "approved" | "rejected";
  note: string;
  reviewer: string;
  decidedAt: string;
  /** The evidence fingerprint the reviewer saw. A different current fingerprint makes it out of date. */
  evidenceSha: string;
}

export type ResearchGrade = "confident" | "unsure" | "no_price" | "review";

export interface ResearchGrading {
  grade: ResearchGrade;
  label: string;
  /** The median of the runs' lows and of their highs; only on confident and unsure. */
  bestBand: { low: number; high: number } | null;
  range: { low: number; high: number } | null;
  reasons: string[];
}

export interface ResearchQuestion {
  id: string;
  projectId: string;
  title: string;
  /** The full scope the runs were given. */
  objective: string;
  family: string | null;
  unit: string | null;
  askedAt: string;
  engine: ResearchEngineSnapshot;
  runsPlanned: number;
  status: ResearchQuestionStatus;
  range: { min: number; max: number } | null;
  consensus: { low: number; high: number } | null;
  agreement: {
    lowRatio: number | null;
    highRatio: number | null;
    runsWithBand: number;
    runsTotal: number;
  };
  currency: string;
  gstBasis: string;
  centre: string | null;
  asOf: string | null;
  basis: string | null;
  runs: ResearchRunRecord[];
  /** A retry keeps the earlier failed starts inspectable. */
  priorAttempts?: Array<{
    id: string;
    attempt: number;
    run: string;
    status: ResearchRunRecord["status"];
    errorCode: string | null;
    errorMessage: string | null;
  }>;
  retryable?: boolean;
  qvSources: ResearchQvSource[];
  webSources: string[];
  openQuestions: string[];
  /** False for runs recorded before the harness checked citations. */
  citationsChecked: boolean;
  costUsd: number | null;
  elapsedMs: number | null;
  evidenceSha: string;
  review: ResearchReview | null;
  /** Where a record came from, so the window can say so. */
  provenance: "recorded" | "sample-activity" | "prototype-ask" | "live";
  provenanceNote: string;
  /** Who asked: by hand, or an external request (a Linear issue, a PlanCheck tender line). */
  source?: ResearchQuestionSource;
  /** Each banded run's unit, when the runs priced in different measures (or in a measure other
   *  than the pinned scope's) and so cannot be compared. */
  unitsDiffer?: string[] | null;
  /** What may go back to a tender, decided in code from the runs (`research-question-grade.mjs`).
   *  Absent on recorded and sample questions; null while runs are still going. */
  grading?: ResearchGrading | null;
  /** The pinned scope every run was given, or null for a question asked without one. */
  scope?: ResearchScope | null;
  scopedBy?: ResearchScopedBy | null;
  /** False when nobody read the scope before the runs started (an external request). */
  scopeReviewed?: boolean | null;
}

/** The measures a band can be priced in, as the backend's unit check names them. */
export const researchScopeMeasures = [
  "per m²",
  "per m³",
  "per metre",
  "each",
  "per house",
  "total",
  "per time",
] as const;

export type ResearchScopeMeasure = (typeof researchScopeMeasures)[number];

export interface ResearchScope {
  item: string;
  measure: ResearchScopeMeasure;
  unitText: string;
  quantityBasis: string;
  inclusions: string[];
  exclusions: string[];
  centre: string;
  assumptions: string[];
  clarifications: string[];
}

/** Which model drafted a scope; `operator` when the operator wrote it, `sample` in fixture mode. */
export type ResearchScopedBy =
  // Codex and Claude drafted scopes before 26 September 2026; stored scopes keep their label.
  | { runtime: "api-loop" | "codex-cli" | "claude-cli"; model: string; reasoning: string | null }
  | { runtime: "operator" }
  | { runtime: "sample" };

export interface ResearchScopeDraft {
  scope: ResearchScope;
  scopedBy: ResearchScopedBy;
}

export function scopedByLabel(scopedBy: ResearchScopedBy | null | undefined) {
  if (!scopedBy) return "Not scoped";
  if (scopedBy.runtime === "operator") return "Written by the operator";
  if (scopedBy.runtime === "sample") return "Sample scope · no model was called";
  const model =
    scopedBy.model === "gpt-6-luna"
      ? "GPT-6 Luna"
      : scopedBy.model === "claude-haiku-4-5"
        ? "Haiku 4.5"
        : scopedBy.model.endsWith("deepseek-v4.1-flash") || scopedBy.model.endsWith("DeepSeek-V4.1-Flash")
          ? "DeepSeek 4.1 Flash"
          : scopedBy.model;
  return `Drafted by ${model}`;
}

export type ResearchQuestionSource =
  | { kind: "manual" }
  | { kind: "external"; provider: string; requestId: string; url?: string };

export interface ResearchGateway {
  /** `fixture` answers from recorded data in this tab; `live` starts real runs on the operator's plan. */
  readonly mode: "fixture" | "live";
  /** Whether this runtime serves research questions at all (the JSON-store companion does not). */
  available(): Promise<boolean>;
  questions(projectId: string): Promise<ResearchQuestion[]>;
  question(id: string): Promise<ResearchQuestion>;
  review(
    id: string,
    input: { decision: ResearchReview["decision"]; note: string; evidenceSha: string },
  ): Promise<ResearchQuestion>;
  /** A draft scope for the operator to correct. Starts nothing. */
  scope(projectId: string, objective: string): Promise<ResearchScopeDraft>;
  ask(
    projectId: string,
    input: {
      objective: string;
      runs: 1 | 3 | 5;
      engine: ResearchEngineSnapshot;
      scope?: ResearchScope | null;
      scopedBy?: ResearchScopedBy | null;
    },
  ): Promise<ResearchQuestion>;
  retry?(id: string): Promise<ResearchQuestion>;
}

export const researchStatusCopy: Record<ResearchQuestionStatus, { label: string; tone: string }> = {
  agreed: { label: "Agreed", tone: "completed" },
  single_run: { label: "One run, not cross-checked", tone: "idle" },
  disputed: { label: "Disputed", tone: "answer" },
  not_established: { label: "Not established", tone: "idle" },
  incomplete: { label: "Did not finish", tone: "blocked" },
  running: { label: "Running", tone: "running" },
  queued: { label: "Not started", tone: "idle" },
};

export const researchCheckCopy: Record<ResearchCheck, { label: string; tone: string; detail: string }> = {
  "qv-found": {
    label: "QV row found",
    tone: "completed",
    detail: "The cited row exists in the QV CostBuilder capture.",
  },
  "qv-missing": {
    label: "QV row not found",
    tone: "blocked",
    detail: "No row with this id exists in the capture.",
  },
  "web-verified": {
    label: "Quote verified",
    tone: "completed",
    detail: "The quote is on the fetched page and its figures give this amount.",
  },
  "web-derived": {
    label: "Worked from quote",
    tone: "answer",
    detail: "The quote is on the page, but the amount is worked from its figures rather than stated in it.",
  },
  "web-unsupported": {
    label: "Quote doesn't give it",
    tone: "blocked",
    detail: "The quote is on the page, but its figures do not give this amount and no working is shown.",
  },
  "web-unverified": {
    label: "Quote not on page",
    tone: "blocked",
    detail: "The page was fetched but the quoted words were not on it.",
  },
  "web-not-fetched": {
    label: "Cited, not fetched",
    tone: "answer",
    detail: "The figure came from search or memory; no page was fetched to check it.",
  },
  allowance: {
    label: "Allowance",
    tone: "idle",
    detail: "An amount the model assumed for a minor item, not a cited price.",
  },
  unsourced: {
    label: "No source",
    tone: "answer",
    detail: "The component names no QV row, page or allowance basis.",
  },
  unchecked: {
    label: "Not checked",
    tone: "answer",
    detail: "The host could not check this run's citations, so nothing here is confirmed.",
  },
};

export function researchEngineLabel(engine: ResearchEngineSnapshot) {
  const model =
    {
      "claude-opus-5-5": "Claude Opus 5.5",
      "claude-opus-5": "Claude Opus 5",
      "claude-sonnet-5": "Claude Sonnet 5",
      "gpt-6-sol": "GPT-6 Sol",
      "gpt-6-luna": "GPT-6 Luna",
      "opencode-go/deepseek-v4.1-flash": "DeepSeek 4.1 Flash",
      "baseten/deepseek-ai/DeepSeek-V4.1-Flash": "DeepSeek 4.1 Flash",
    }[engine.model] ?? engine.model;
  const reasoning = engine.reasoning
    ? engine.reasoning === "xhigh"
      ? "XHigh"
      : engine.reasoning[0]?.toUpperCase() + engine.reasoning.slice(1)
    : "reasoning not recorded";
  return `${model} · ${reasoning}`;
}

export function researchEnginePlan(engine: ResearchEngineSnapshot) {
  if (engine.runtime === "opencode-cli") return "OpenCode CLI · OpenCode Go plan";
  if (engine.runtime === "api-loop")
    return engine.model.startsWith("baseten/") ? "API loop · Baseten API" : "API loop · OpenCode Go API";
  return engine.runtime === "codex-cli" ? "Codex CLI · ChatGPT plan" : "Claude CLI · Claude plan";
}

export function researchEngineName(engine: ResearchEngineSnapshot) {
  return researchEnginePlan(engine).split(" · ")[0];
}

export function formatNzd(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "—";
  const amount = Math.abs(value).toLocaleString("en-NZ", {
    maximumFractionDigits: Math.abs(value) < 100 ? 2 : 0,
  });
  return `${value < 0 ? "−" : ""}$${amount}`;
}

export function formatBand(low: number | null | undefined, high: number | null | undefined) {
  if (low == null || high == null) return "No band";
  return `${formatNzd(low)}–${formatNzd(high)}`;
}

/** The figure a reviewer reads first: the median band when the runs agree, the envelope otherwise. */
export function headlineBand(question: ResearchQuestion) {
  if (question.status === "agreed" && question.consensus)
    return { label: "Consensus", text: formatBand(question.consensus.low, question.consensus.high) };
  if (question.range) return { label: "Range", text: formatBand(question.range.min, question.range.max) };
  return { label: "", text: question.status === "running" || question.status === "queued" ? "—" : "No band" };
}

export type ResearchReviewState = "awaiting" | "approved" | "rejected" | "out-of-date" | "not-ready";
export function reviewState(question: ResearchQuestion): ResearchReviewState {
  if (question.status === "running" || question.status === "queued" || question.retryable) return "not-ready";
  if (!question.review) return "awaiting";
  if (question.review.evidenceSha !== question.evidenceSha) return "out-of-date";
  return question.review.decision;
}
export const reviewStateCopy: Record<ResearchReviewState, { label: string; tone: string }> = {
  awaiting: { label: "Awaiting review", tone: "approval" },
  approved: { label: "Approved", tone: "completed" },
  rejected: { label: "Rejected", tone: "blocked" },
  "out-of-date": { label: "Review out of date", tone: "answer" },
  "not-ready": { label: "Not ready", tone: "idle" },
};

export function runsDisagree(question: ResearchQuestion) {
  return question.status === "disputed" || question.status === "incomplete";
}

export function failedRuns(question: ResearchQuestion) {
  return question.runs.filter((run) => run.status === "failed");
}

/** Plan limits and failures are "did not run", never "found nothing". */
export function runFailureCopy(run: ResearchRunRecord) {
  if (!run.error) return "Did not finish";
  if (/plan_limit/.test(run.error.code)) return "Did not run: plan limit reached";
  if (run.error.code === "repeated_tool_error") return "Stopped: repeated a failing tool call";
  return `Did not finish: ${run.error.code.replaceAll("_", " ")}`;
}

export function componentCounts(question: ResearchQuestion) {
  const counts: Record<ResearchCheck, number> = {
    "qv-found": 0,
    "qv-missing": 0,
    "web-verified": 0,
    "web-derived": 0,
    "web-unsupported": 0,
    "web-unverified": 0,
    "web-not-fetched": 0,
    allowance: 0,
    unsourced: 0,
    unchecked: 0,
  };
  for (const run of question.runs) for (const component of run.components) counts[component.check]++;
  return counts;
}
