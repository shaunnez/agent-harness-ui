import type { RuntimeProject } from "../../../domain.ts";
import type {
  ResearchActivity,
  ResearchCheck,
  ResearchComponent,
  ResearchEngineSnapshot,
  ResearchGateway,
  ResearchQuestion,
  ResearchQvSource,
  ResearchRunCitations,
  ResearchRunRecord,
  ResearchScope,
} from "../../runtime/research.ts";

/**
 * Two research projects built from recorded results: the 30 pinned scopes Claude Opus answered on
 * 22 September (`18a-review-feed.json`, three runs each) and the 7-scope Codex prompt check of
 * 23 September (three runs each, with host-checked citations). Reviews and asks stay in this tab.
 */
export const researchFixtureProjects: RuntimeProject[] = [
  {
    id: "research-qs-costs",
    name: "QS cost research",
    repositoryPath: "research://qs-cost-research",
    createdAt: "2026-09-22T00:00:00Z",
    kind: "research",
  },
  {
    id: "research-codex-check",
    name: "Codex prompt check",
    repositoryPath: "research://codex-prompt-check",
    createdAt: "2026-09-23T00:00:00Z",
    kind: "research",
  },
];
const [qsProject, codexProject] = researchFixtureProjects as [RuntimeProject, RuntimeProject];

/** Titles the feed builder derived badly from file names. */
const titleFixes: Record<string, string> = {
  "acfacade-cladding-install": "ACP facade cladding installation",
  "benchtoand-laminate-panel": "Benchtop and laminate panel",
  "subgrade-prebasecourse-replacement": "Subgrade and pre-basecourse replacement",
};

interface RawComponent {
  role?: string;
  row_id?: string | null;
  source?: string | null;
  unit?: string | null;
  amount?: { low?: number | null; high?: number | null } | null;
  centre?: string | null;
  caveat?: string | null;
}
interface RawRecorded {
  scenario_id: string;
  title: string;
  family: string | null;
  unit: string | null;
  status: "agreed" | "disputed" | "not_established";
  range: { min: number; max: number } | null;
  consensus: { low: number; high: number } | null;
  agreement: {
    low_ratio: number | null;
    high_ratio: number | null;
    runs_with_band: number;
    runs_total: number;
  };
  currency: string;
  gst_basis: string;
  centre: string | null;
  as_of: string | null;
  basis: string | null;
  pinned_scope: string | null;
  runs: Array<{
    run: string;
    low: number | null;
    high: number | null;
    resolved_from: string | null;
    confidence: string | null;
    basis: string | null;
    components: RawComponent[];
    not_established: string[];
  }>;
  qv_sources: Array<{
    row_id: string;
    url?: string;
    section?: string;
    group?: string;
    desc?: string;
    unit?: string;
    regional?: Record<string, string>;
    cited_by: number;
  }>;
  web_sources: string[];
  open_questions: string[];
  record_sha256: string;
}
interface RawFeed {
  generated_at: string;
  model: string;
  scenarios: RawRecorded[];
}
interface RawCodexComponent {
  role: string;
  basis: "qv" | "web" | "allowance" | null;
  rowId: string | null;
  source: string | null;
  sourceId: string | null;
  excerpt: string | null;
  page: number | null;
  unit: string | null;
  low: number | null;
  high: number | null;
  centre: string | null;
  caveat: string | null;
}
interface RawCodexRun {
  run: string;
  status: "completed" | "failed";
  band: { unit: string; low: number | null; high: number | null; centre: string; basis: string } | null;
  resolvedFrom: string | null;
  confidence: string | null;
  components: RawCodexComponent[];
  notEstablished: string[];
  costUsd: number | null;
  citations: (ResearchRunCitations & { rowsMissing: number }) | null;
  error: { code: string; message: string } | null;
}
interface RawCodex {
  generatedAt: string;
  model: string;
  reasoning: string;
  records: Array<{
    scenarioId: string;
    recordedKey: string;
    status: "agreed" | "disputed" | "not_established" | "notEstablished" | "incomplete";
    range: { min: number; max: number } | null;
    consensus: { low: number; high: number } | null;
    agreement: { lowRatio: number | null; highRatio: number | null; runsWithBand: number; runsTotal: number };
    unit: string | null;
    centre: string | null;
    basis: string | null;
    elapsedMs: number | null;
    costUsd: number | null;
    runs: RawCodexRun[];
  }>;
}

function fingerprint(value: unknown) {
  const text = JSON.stringify(value);
  let a = 2166136261;
  let b = 5381;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    a = Math.imul(a ^ code, 16777619);
    b = Math.imul(b, 33) ^ code;
  }
  return (a >>> 0).toString(16).padStart(8, "0") + (b >>> 0).toString(16).padStart(8, "0");
}

function recordedComponent(component: RawComponent, found: Set<string>): ResearchComponent {
  const rowId = component.row_id ?? null;
  const source = component.source ?? null;
  const check: ResearchCheck = rowId
    ? found.has(rowId)
      ? "qv-found"
      : "qv-missing"
    : source
      ? "web-not-fetched"
      : "unsourced";
  return {
    role: component.role ?? "Unnamed component",
    basis: rowId ? "qv" : source ? "web" : "unstated",
    rowId,
    source,
    excerpt: null,
    page: null,
    unit: component.unit ?? null,
    low: component.amount?.low ?? null,
    high: component.amount?.high ?? null,
    centre: component.centre ?? null,
    caveat: component.caveat ?? null,
    check,
  };
}

function recordedQuestion(raw: RawRecorded, feed: RawFeed): ResearchQuestion {
  const found = new Set(raw.qv_sources.map((row) => row.row_id));
  const engine: ResearchEngineSnapshot = { runtime: "claude-cli", model: feed.model, reasoning: null };
  return {
    id: `${qsProject.id}:${raw.scenario_id}`,
    projectId: qsProject.id,
    title: titleFixes[raw.scenario_id] ?? raw.title,
    objective: raw.pinned_scope ?? raw.title,
    family: raw.family,
    unit: raw.unit,
    askedAt: `${feed.generated_at}T09:00:00+12:00`,
    engine,
    runsPlanned: raw.agreement.runs_total,
    status: raw.status,
    range: raw.range,
    consensus: raw.consensus,
    agreement: {
      lowRatio: raw.agreement.low_ratio,
      highRatio: raw.agreement.high_ratio,
      runsWithBand: raw.agreement.runs_with_band,
      runsTotal: raw.agreement.runs_total,
    },
    currency: raw.currency,
    gstBasis: raw.gst_basis,
    centre: raw.centre,
    asOf: raw.as_of,
    basis: raw.basis,
    runs: raw.runs.map((run) => ({
      run: run.run,
      status: "completed",
      low: run.low,
      high: run.high,
      unit: raw.unit,
      resolvedFrom: run.resolved_from,
      confidence: run.confidence,
      basis: run.basis,
      components: run.components.map((component) => recordedComponent(component, found)),
      notEstablished: run.not_established,
      error: null,
      costUsd: null,
      citations: null,
      activity: [],
    })),
    qvSources: raw.qv_sources.map(qvSource),
    webSources: raw.web_sources.flatMap((entry) => entry.split(" ; ")),
    openQuestions: raw.open_questions,
    citationsChecked: false,
    costUsd: null,
    elapsedMs: null,
    evidenceSha: raw.record_sha256,
    review: null,
    provenance: "recorded",
    provenanceNote:
      "Recorded 22 September 2026 on the Claude plan, before the harness checked citations. QV rows were matched against the capture afterwards; web figures were never fetched.",
  };
}

function qvSource(row: RawRecorded["qv_sources"][number]): ResearchQvSource {
  return {
    rowId: row.row_id,
    section: row.section ?? null,
    group: row.group ?? null,
    desc: row.desc ?? null,
    unit: row.unit ?? null,
    url: row.url ?? null,
    regional: row.regional ?? {},
    citedBy: row.cited_by,
  };
}

function codexCheck(component: RawCodexComponent, run: RawCodexRun): ResearchCheck {
  const citations = run.citations;
  if (component.basis === "allowance") return "allowance";
  if (component.basis === "qv" || component.rowId)
    return citations && citations.rowsMissing === 0 ? "qv-found" : "qv-missing";
  if (component.basis === "web" || component.source) {
    if (!component.sourceId || !component.excerpt) return "web-not-fetched";
    return citations && citations.webVerified === citations.webCited ? "web-verified" : "web-unverified";
  }
  return "unsourced";
}

function codexQuestion(
  raw: RawCodex["records"][number],
  codex: RawCodex,
  recorded: Map<string, RawRecorded>,
  qvRows: Map<string, RawRecorded["qv_sources"][number]>,
): ResearchQuestion {
  const scope = recorded.get(raw.recordedKey);
  const runs: ResearchRunRecord[] = raw.runs.map((run) => ({
    run: run.run,
    status: run.status,
    low: run.band?.low ?? null,
    high: run.band?.high ?? null,
    unit: run.band?.unit ?? raw.unit,
    resolvedFrom: run.resolvedFrom,
    confidence: run.confidence,
    basis: run.band?.basis ?? null,
    components: run.components.map((component) => ({
      role: component.role,
      basis: component.basis ?? "unstated",
      rowId: component.rowId,
      source: component.source,
      excerpt: component.excerpt,
      page: component.page,
      unit: component.unit,
      low: component.low,
      high: component.high,
      centre: component.centre,
      caveat: component.caveat,
      check: codexCheck(component, run),
    })),
    notEstablished: run.notEstablished,
    error: run.error,
    costUsd: run.costUsd,
    citations: run.citations,
    activity: [],
  }));
  const cited = new Map<string, number>();
  for (const run of runs)
    for (const rowId of new Set(run.components.map((component) => component.rowId).filter(Boolean)))
      cited.set(rowId as string, (cited.get(rowId as string) ?? 0) + 1);
  const status = raw.status === "notEstablished" ? "not_established" : raw.status;
  const question: Omit<ResearchQuestion, "evidenceSha"> = {
    id: `${codexProject.id}:${raw.scenarioId}`,
    projectId: codexProject.id,
    title: titleFixes[raw.recordedKey] ?? scope?.title ?? raw.scenarioId,
    objective: scope?.pinned_scope ?? raw.scenarioId,
    family: scope?.family ?? null,
    unit: raw.unit ?? scope?.unit ?? null,
    askedAt: codex.generatedAt,
    engine: { runtime: "codex-cli", model: codex.model, reasoning: codex.reasoning },
    runsPlanned: raw.runs.length,
    status,
    range: raw.range,
    consensus: raw.consensus,
    agreement: raw.agreement,
    currency: "NZD",
    gstBasis: "exclusive",
    centre: raw.centre ?? raw.runs.find((run) => run.band?.centre)?.band?.centre ?? null,
    asOf: codex.generatedAt.slice(0, 10),
    basis: raw.basis,
    runs,
    qvSources: [...cited].map(([rowId, citedBy]) => {
      const row = qvRows.get(rowId);
      return row
        ? { ...qvSource(row), citedBy }
        : {
            rowId,
            section: null,
            group: null,
            desc: null,
            unit: null,
            url: null,
            regional: {},
            citedBy,
          };
    }),
    webSources: [
      ...new Set(runs.flatMap((run) => run.components.map((c) => c.source).filter(Boolean))),
    ] as string[],
    openQuestions: [...new Set(runs.flatMap((run) => run.notEstablished))],
    citationsChecked: true,
    costUsd: raw.costUsd,
    elapsedMs: raw.elapsedMs,
    review: null,
    provenance: "recorded",
    provenanceNote:
      "Recorded 23 September 2026 on the ChatGPT plan with host-checked citations: every QV row was looked up in the capture and every web quote was checked against the page the run fetched.",
  };
  return { ...question, evidenceSha: fingerprint(question) };
}

const sampleObjective =
  "How come you couldn't price the asbestos soffit removal on our tender? What does that actually cost?";
function sampleActivity(offsetMinutes: number, events: Array<[ResearchActivity["kind"], string, string?]>) {
  const start = Date.now() - offsetMinutes * 60_000;
  return events.map(([kind, label, detail], index) => ({
    at: new Date(start + index * 41_000).toISOString(),
    kind,
    label,
    ...(detail ? { detail } : {}),
  }));
}
function sampleRunning(): ResearchQuestion {
  const engine: ResearchEngineSnapshot = {
    runtime: "claude-cli",
    model: "claude-opus-5-5",
    reasoning: "high",
  };
  const run = (id: string, activity: ResearchActivity[]): ResearchRunRecord => ({
    run: id,
    status: "running",
    low: null,
    high: null,
    unit: null,
    resolvedFrom: null,
    confidence: null,
    basis: null,
    components: [],
    notEstablished: [],
    error: null,
    costUsd: null,
    citations: null,
    activity,
  });
  const question: Omit<ResearchQuestion, "evidenceSha"> = {
    id: `${qsProject.id}:sample-asbestos-soffit`,
    projectId: qsProject.id,
    title: "Asbestos soffit removal",
    objective: sampleObjective,
    family: null,
    unit: null,
    askedAt: new Date(Date.now() - 6 * 60_000).toISOString(),
    engine,
    runsPlanned: 3,
    status: "running",
    range: null,
    consensus: null,
    agreement: { lowRatio: null, highRatio: null, runsWithBand: 0, runsTotal: 3 },
    currency: "NZD",
    gstBasis: "exclusive",
    centre: "Auckland",
    asOf: null,
    basis: null,
    runs: [
      run(
        "r1",
        sampleActivity(6, [
          ["started", "Run started", "Claude Opus 5.5 · High"],
          ["tool", "Searched QV", "asbestos removal soffit"],
          ["tool", "Listed QV sections", "Demolition, Alterations"],
          ["tool", "Web search", "asbestos soffit removal cost Auckland Class B"],
          ["source", "Fetched a page", "Contractor price guide · 38 KB"],
        ]),
      ),
      run(
        "r2",
        sampleActivity(6, [
          ["started", "Run started", "Claude Opus 5.5 · High"],
          ["tool", "Searched QV", "asbestos cement sheet removal"],
          ["tool", "Web search", "licensed asbestos removal soffit NZ price per m2"],
        ]),
      ),
      run(
        "r3",
        sampleActivity(5, [
          ["started", "Run started", "Claude Opus 5.5 · High"],
          ["tool", "Searched QV", "hazardous material disposal"],
        ]),
      ),
    ],
    qvSources: [],
    webSources: [],
    openQuestions: [],
    citationsChecked: true,
    costUsd: null,
    elapsedMs: null,
    review: null,
    provenance: "sample-activity",
    provenanceNote:
      "Sample activity: this shows what a running question looks like. No model is running; the question is from the recorded ask feed.",
  };
  return { ...question, evidenceSha: fingerprint(question) };
}

async function loadRecorded() {
  const [feedModule, codexModule] = await Promise.all([
    import("../../../../research-agent-deepagents-spike-pack/18a-review-feed.json"),
    import("./codex-prompt-check.json"),
  ]);
  const feed = feedModule.default as unknown as RawFeed;
  const codex = codexModule.default as unknown as RawCodex;
  const recorded = new Map(feed.scenarios.map((scenario) => [scenario.scenario_id, scenario]));
  const qvRows = new Map(
    feed.scenarios.flatMap((scenario) => scenario.qv_sources.map((row) => [row.row_id, row])),
  );
  const questions = [
    ...feed.scenarios.map((scenario) => recordedQuestion(scenario, feed)),
    ...codex.records.map((record) => codexQuestion(record, codex, recorded, qvRows)),
    sampleRunning(),
  ];
  // One sample review pinned to an earlier fingerprint, to show what an out-of-date review looks like.
  const stale = questions.find((question) => question.id === `${qsProject.id}:retaining-wall-construction`);
  if (stale)
    stale.review = {
      decision: "approved",
      note: "Sample review recorded against an earlier version of this evidence.",
      reviewer: "Sample reviewer",
      decidedAt: "2026-09-22T15:10:00+12:00",
      evidenceSha: "0000000000000000",
    };
  return new Map(questions.map((question) => [question.id, question]));
}

/** The scope GPT-6 Luna drafted for the roof example on 24 September (8.7 s, about $0.0015 at API
 *  rates), shown for that example. Any other question gets a sample scope that says what it is. */
const recordedRoofScope: ResearchScope = {
  item: "Extra cost to change warehouse roof from long-run to membrane",
  measure: "per m²",
  unitText: "m² of roof area",
  quantityBasis: "1200 m² warehouse; roof area not specified",
  inclusions: ["Cost difference between membrane and long-run roofing"],
  exclusions: [],
  centre: "Auckland",
  assumptions: ["Treat this as the additional roofing cost per unit area for the change"],
  clarifications: [
    "Confirm actual roof area and whether it matches the 1200 m² warehouse floor area",
    "Confirm membrane and long-run roof specifications and what associated work is included",
  ],
};

function sampleScope(objective: string): ResearchScope {
  if (/membrane/i.test(objective) && /roof/i.test(objective)) return structuredClone(recordedRoofScope);
  const item = objective.trim().split(/(?<=[.?!])\s/)[0] ?? objective;
  return {
    item: item.length > 120 ? `${item.slice(0, 118).trimEnd()}…` : item,
    measure: "total",
    unitText: "",
    quantityBasis: "",
    inclusions: [],
    exclusions: [],
    centre: "",
    assumptions: [],
    clarifications: ["Sample: no model read this question. Edit the scope to see how the form behaves."],
  };
}

export function fixtureResearch(online: () => void): ResearchGateway {
  let loading: Promise<Map<string, ResearchQuestion>> | null = null;
  const store = () => {
    loading ??= loadRecorded();
    return loading;
  };
  let asks = 0;
  return {
    mode: "fixture",
    available: async () => true,
    async questions(projectId) {
      online();
      return structuredClone([...(await store()).values()].filter((item) => item.projectId === projectId));
    },
    async question(id) {
      online();
      const question = (await store()).get(id);
      if (!question) throw new Error("This sample research question does not exist.");
      return structuredClone(question);
    },
    async review(id, input) {
      online();
      const question = (await store()).get(id);
      if (!question) throw new Error("This sample research question does not exist.");
      if (question.status === "running" || question.status === "queued")
        throw new Error("A question can be reviewed once its runs have finished.");
      if (input.evidenceSha !== question.evidenceSha)
        throw new Error("The evidence changed while you were reviewing. Reload it and review again.");
      question.review = {
        decision: input.decision,
        note: input.note.trim(),
        reviewer: "You (sample)",
        decidedAt: new Date().toISOString(),
        evidenceSha: question.evidenceSha,
      };
      return structuredClone(question);
    },
    async scope(_projectId, objective) {
      online();
      return { scope: sampleScope(objective), scopedBy: { runtime: "sample" } };
    },
    async ask(projectId, input) {
      online();
      const objective = input.objective.trim();
      if (objective.length < 12) throw new Error("Describe the scope in a sentence or two.");
      asks++;
      const question: Omit<ResearchQuestion, "evidenceSha"> = {
        id: `${projectId}:ask-${asks}`,
        projectId,
        title: objective.length > 72 ? `${objective.slice(0, 70).trimEnd()}…` : objective,
        objective,
        family: null,
        unit: null,
        askedAt: new Date().toISOString(),
        engine: input.engine,
        runsPlanned: input.runs,
        status: "queued",
        range: null,
        consensus: null,
        agreement: { lowRatio: null, highRatio: null, runsWithBand: 0, runsTotal: input.runs },
        currency: "NZD",
        gstBasis: "exclusive",
        centre: null,
        asOf: null,
        basis: null,
        runs: Array.from({ length: input.runs }, (_, index) => ({
          run: `r${index + 1}`,
          status: "queued" as const,
          low: null,
          high: null,
          unit: null,
          resolvedFrom: null,
          confidence: null,
          basis: null,
          components: [],
          notEstablished: [],
          error: null,
          costUsd: null,
          citations: null,
          activity: [],
        })),
        qvSources: [],
        webSources: [],
        openQuestions: [],
        citationsChecked: true,
        costUsd: null,
        elapsedMs: null,
        review: null,
        scope: input.scope ?? null,
        scopedBy: input.scope ? (input.scopedBy ?? { runtime: "operator" }) : null,
        scopeReviewed: input.scope ? true : null,
        provenance: "prototype-ask",
        provenanceNote: `Prototype: nothing was sent to a model. With the research backend this would start ${
          input.runs === 1 ? "one run" : `${input.runs} runs`
        } on the engine shown, each keeping its own copy of the Settings choice.`,
      };
      const created = { ...question, evidenceSha: fingerprint(question) };
      (await store()).set(created.id, created);
      return structuredClone(created);
    },
  };
}
