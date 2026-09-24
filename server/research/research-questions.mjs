import { researchPoliciesOf } from "../../src/research-policies.ts";
import { agreementForRuns } from "./claude-cli/agreement.mjs";

const emptyAgreement = (total) => ({
  lowRatio: null,
  highRatio: null,
  runsWithBand: 0,
  runsTotal: total,
});

function requestError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function visibleStatus(status) {
  if (status === "completed" || status === "failed" || status === "queued") return status;
  return status === "cancelled" ? "failed" : "running";
}

function latestAttempt(records, runsPlanned) {
  const lastOrdinal = records.at(-1)?.questionOrdinal ?? 0;
  const firstOrdinal = lastOrdinal ? Math.floor((lastOrdinal - 1) / runsPlanned) * runsPlanned + 1 : 1;
  return records.filter(
    (run) => run.questionOrdinal >= firstOrdinal && run.questionOrdinal < firstOrdinal + runsPlanned,
  );
}

function failedToStart(records, runsPlanned) {
  return (
    records.length === runsPlanned &&
    records.every((run) => run.status === "failed" && run.error?.code === "runtime_start_failed")
  );
}

function componentCheck(component, finding) {
  if (component.basis === "allowance") return "allowance";
  const evidence = finding?.evidence ?? [];
  if (component.rowId)
    return evidence.some((item) => item.sourceType === "internal_record" && item.quoteVerified)
      ? "qv-found"
      : "qv-missing";
  if (component.source || component.sourceId) {
    if (!component.sourceId || !component.excerpt) return "web-not-fetched";
    return evidence.some((item) => item.sourceType !== "internal_record" && item.quoteVerified)
      ? "web-verified"
      : "web-unverified";
  }
  return "unsourced";
}

function visibleActivity(event) {
  const type = event.type ?? "";
  const kind =
    type === "source.retrieved"
      ? "source"
      : type === "finding.created"
        ? "finding"
        : type === "run.started"
          ? "started"
          : type === "run.failed" || type === "run.cancelled"
            ? "failed"
            : type === "run.completed"
              ? "completed"
              : "tool";
  return {
    at: event.timestamp,
    kind,
    label: type.replaceAll(".", " "),
    ...(typeof event.data?.tool === "string" ? { detail: event.data.tool } : {}),
  };
}

function visibleRun(run, result, events, runsPlanned) {
  const band = result?.costBand?.band ?? null;
  const components = result?.costBand?.components ?? [];
  const findings = result?.findings ?? [];
  return {
    run: `r${((run.questionOrdinal - 1) % runsPlanned) + 1}`,
    status: visibleStatus(run.status),
    low: band?.low ?? null,
    high: band?.high ?? null,
    unit: band?.unit ?? null,
    resolvedFrom: result?.costBand?.resolvedFrom ?? null,
    confidence: result?.costBand?.confidence ?? null,
    basis: band?.basis ?? null,
    components: components.map((component, index) => ({
      role: component.role ?? "Unnamed component",
      basis: component.basis ?? "unstated",
      rowId: component.rowId ?? null,
      source: component.source ?? null,
      excerpt: component.excerpt ?? null,
      page: component.page ?? null,
      unit: component.unit ?? null,
      low: component.low ?? null,
      high: component.high ?? null,
      centre: component.centre ?? null,
      caveat: component.caveat ?? null,
      check: componentCheck(component, findings[index]),
    })),
    notEstablished: result?.costBand?.notEstablished ?? result?.unresolvedQuestions ?? [],
    error:
      run.error ?? (run.status === "cancelled" ? { code: "cancelled", message: "Run cancelled." } : null),
    costUsd: run.usage?.estimatedCostUsd ?? null,
    citations: result?.citations ?? null,
    activity: events.map(visibleActivity),
  };
}

export class ResearchQuestionService {
  #store;
  #projects;
  #runs;
  #settings;
  #retrying = new Map();

  constructor({ store, projects, runs, settings }) {
    this.#store = store;
    this.#projects = projects;
    this.#runs = runs;
    this.#settings = settings;
  }

  async list(projectId) {
    await this.#researchProject(projectId);
    const questions = await this.#store.listQuestions(projectId);
    return Promise.all(questions.map((question) => this.#project(question)));
  }

  async get(id) {
    const question = await this.#store.getQuestion(id);
    return question ? this.#project(question) : null;
  }

  async ask(projectId, input) {
    const project = await this.#researchProject(projectId);
    if (project.archivedAt) throw requestError(`Restore ${project.name} before asking a question.`, 409);
    const objective = String(input?.objective ?? "").trim();
    if (objective.length < 12 || objective.length > 4_000)
      throw requestError("A research question must be between 12 and 4,000 characters.");
    if (input.runs !== 1 && input.runs !== 3) throw requestError("Choose one Quick run or three runs.");
    const agent = researchPoliciesOf(await this.#settings()).agent;
    if (
      input.engine &&
      (input.engine.runtime !== agent.runtime ||
        input.engine.model !== agent.model ||
        input.engine.reasoning !== agent.reasoning)
    )
      throw requestError("Research agent Settings changed. Reload the question form.", 409);
    const engine = { runtime: agent.runtime, model: agent.model, reasoning: agent.reasoning };
    const { question, created } = await this.#store.createQuestion({
      projectId,
      objective,
      engine,
      runsPlanned: input.runs,
    });
    if (created) {
      await Promise.all(
        Array.from({ length: input.runs }, (_unused, index) =>
          this.#runs.createRun(
            { objective, profile: "standard", runtimeId: agent.runtime },
            { questionId: question.id, questionOrdinal: index + 1 },
          ),
        ),
      );
    }
    return this.#project(question);
  }

  async review(id, input) {
    const question = await this.get(id);
    if (!question) return null;
    if (question.status === "queued" || question.status === "running")
      throw requestError("Review this question once all runs have finished.", 409);
    if (question.retryable) throw requestError("Retry the failed start before reviewing this question.", 409);
    if (!input || !["approved", "rejected"].includes(input.decision))
      throw requestError("Choose approve or reject.");
    const note = String(input.note ?? "").trim();
    if (note.length > 2_000) throw requestError("Review note must be 2,000 characters or fewer.");
    await this.#store.reviewQuestion(id, {
      decision: input.decision,
      note,
      reviewer: "Local operator",
      evidenceSha: String(input.evidenceSha ?? ""),
    });
    return this.get(id);
  }

  async retry(id) {
    if (this.#retrying.has(id)) return this.#retrying.get(id);
    const work = this.#retryFailedStart(id).finally(() => this.#retrying.delete(id));
    this.#retrying.set(id, work);
    return work;
  }

  async #retryFailedStart(id) {
    const question = await this.#store.getQuestion(id);
    if (!question) return null;
    const project = await this.#researchProject(question.projectId);
    if (project.archivedAt) throw requestError(`Restore ${project.name} before retrying.`, 409);
    const records = await this.#store.questionRuns(id);
    if (!failedToStart(latestAttempt(records, question.runsPlanned), question.runsPlanned))
      throw requestError("Only runs that failed before starting can be retried here.", 409);
    const agent = researchPoliciesOf(await this.#settings()).agent;
    if (
      agent.runtime !== question.engine.runtime ||
      agent.model !== question.engine.model ||
      agent.reasoning !== question.engine.reasoning
    )
      throw requestError("Restore this question's Research agent choice in Settings before retrying.", 409);
    const firstOrdinal = records.at(-1).questionOrdinal + 1;
    await Promise.all(
      Array.from({ length: question.runsPlanned }, (_unused, index) =>
        this.#runs.createRun(
          { objective: question.objective, profile: "standard", runtimeId: question.engine.runtime },
          { questionId: id, questionOrdinal: firstOrdinal + index },
        ),
      ),
    );
    return this.#project(question);
  }

  async #researchProject(projectId) {
    const project = (await this.#projects.listProjects()).find((item) => item.id === projectId);
    if (project?.kind !== "research") throw requestError("Research project not found.", 404);
    return project;
  }

  async #project(question) {
    const allRecords = await this.#store.questionRuns(question.id);
    const records = latestAttempt(allRecords, question.runsPlanned);
    const entries = await Promise.all(
      records.map(async (run) => {
        const [result, eventPage, sources] = await Promise.all([
          this.#runs.getResult(run.id),
          this.#runs.listEvents(run.id, { limit: 500 }),
          this.#runs.listSources(run.id),
        ]);
        return { run, result, events: eventPage?.events ?? [], sources };
      }),
    );
    const runs = entries.map(({ run, result, events }) =>
      visibleRun(run, result, events, question.runsPlanned),
    );
    const complete =
      records.length === question.runsPlanned &&
      records.every((run) => ["completed", "failed", "cancelled"].includes(run.status));
    const agreement = complete
      ? agreementForRuns(
          entries.map(({ run, result }) => ({
            run: `r${((run.questionOrdinal - 1) % question.runsPlanned) + 1}`,
            status: run.status,
            band: result?.costBand?.band ?? null,
          })),
        )
      : null;
    const status = complete
      ? question.runsPlanned === 1 && agreement.status !== "incomplete"
        ? "unverified"
        : agreement.status
      : records.length > 0 && records.every((run) => run.status === "queued")
        ? "queued"
        : records.length < question.runsPlanned &&
            records.every((run) => ["completed", "failed", "cancelled"].includes(run.status))
          ? "incomplete"
          : "running";
    const rowCitations = new Map();
    const qvSources = new Map();
    const webSources = new Set();
    for (const entry of entries) {
      const citedRows = new Set(
        (entry.result?.costBand?.components ?? []).map((component) => component.rowId).filter(Boolean),
      );
      for (const rowId of citedRows) rowCitations.set(rowId, (rowCitations.get(rowId) ?? 0) + 1);
      for (const source of entry.sources) {
        if (source.sourceType === "internal_record" && source.metadata?.rowId)
          qvSources.set(source.metadata.rowId, {
            rowId: source.metadata.rowId,
            section: null,
            group: null,
            desc: source.title,
            unit: null,
            url: source.url,
            regional: {},
            citedBy: 0,
          });
        else if (source.url) webSources.add(source.url);
      }
    }
    const costs = allRecords
      .map((run) => run.usage?.estimatedCostUsd)
      .filter((value) => typeof value === "number");
    const latest = records.map((run) => Date.parse(run.updatedAt)).filter(Number.isFinite);
    const elapsedMs =
      complete && latest.length ? Math.max(...latest) - Date.parse(records[0].createdAt) : null;
    return {
      id: question.id,
      projectId: question.projectId,
      title:
        question.objective.length > 72 ? `${question.objective.slice(0, 70).trimEnd()}…` : question.objective,
      objective: question.objective,
      source: question.source,
      family: null,
      unit: agreement?.unit ?? runs.find((run) => run.unit)?.unit ?? null,
      askedAt: question.createdAt,
      engine: question.engine,
      runsPlanned: question.runsPlanned,
      status,
      range: agreement?.range ?? null,
      consensus: question.runsPlanned === 1 ? null : (agreement?.consensus ?? null),
      agreement:
        question.runsPlanned === 1
          ? {
              ...emptyAgreement(1),
              runsWithBand: agreement?.agreement.runsWithBand ?? 0,
            }
          : (agreement?.agreement ?? emptyAgreement(question.runsPlanned)),
      currency: "NZD",
      gstBasis: "exclusive",
      centre: agreement?.centre ?? null,
      asOf: null,
      basis: agreement?.basis ?? null,
      runs,
      retryable: failedToStart(records, question.runsPlanned),
      priorAttempts: allRecords.slice(0, allRecords.length - records.length).map((run) => ({
        id: run.id,
        attempt: Math.floor((run.questionOrdinal - 1) / question.runsPlanned) + 1,
        run: `r${((run.questionOrdinal - 1) % question.runsPlanned) + 1}`,
        status: visibleStatus(run.status),
        errorCode: run.error?.code ?? null,
        errorMessage: run.error?.message ?? null,
      })),
      qvSources: [...qvSources.values()].map((source) => ({
        ...source,
        citedBy: rowCitations.get(source.rowId) ?? 0,
      })),
      webSources: [...webSources],
      openQuestions: [...new Set(entries.flatMap(({ result }) => result?.unresolvedQuestions ?? []))],
      citationsChecked: entries.every(({ result }) => Boolean(result?.citations)),
      costUsd: costs.length ? costs.reduce((sum, value) => sum + value, 0) : null,
      elapsedMs,
      evidenceSha: await this.#store.questionEvidenceSha(question.id),
      review: question.review,
      provenance: "live",
      provenanceNote:
        "Live research. Runs and citation checks are retained; a cost band remains unreviewed until you approve it.",
    };
  }
}
