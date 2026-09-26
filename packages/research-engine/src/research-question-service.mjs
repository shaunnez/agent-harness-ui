// Research questions: ask one objective of a research project, answered by three runs (or a
// labelled one-run Quick ask), and record a review pinned to the evidence the reviewer saw.
//
// Runs are started through `ResearchService.createRun`, so each keeps its own Settings snapshot
// and budget, and nothing here can reach the SDLC plane. A review is only a decision: nothing is
// published, priced or sent anywhere when a question is approved. Where approved answers go is
// undecided (`27-RESEARCH-PROJECTS-UI-PLAN.md`), and that step, when it exists, reads reviews
// rather than being part of one.

import { questionRecord } from "./research-question-record.mjs";
import { scopedObjective, validateScope } from "./research-scope.mjs";
import { NOT_STARTED_CODES } from "./research-service.mjs";

// Five by default: the three that agree best are scored (Shaun, 25 September: "5 is fine for now").
// Three remains for a cheaper cross-check, and one for a Quick answer.
const RUN_COUNTS = new Set([1, 3, 5]);
const DEFAULT_RUNS = 5;
const MAX_OBJECTIVE_LENGTH = 4_000;
const MAX_NOTE_LENGTH = 2_000;
const MAX_SOURCE_FIELD = 200;
const EVENTS_PER_RUN = 500;
/** What a run's own objective may hold (`ResearchService`), question and pinned scope together. */
const MAX_RUN_OBJECTIVE_LENGTH = 4_000;
const SCOPER_RUNTIMES = new Set(["api-loop"]);

export class ResearchQuestionService {
  #questions;
  #research;
  #runs;
  #projects;
  #scoper;
  #now;
  #retrying = new Map();

  /** `research` starts runs; `runs` is the `ResearchStore` they are read back from; `projects`
   *  lists registered projects, so a question can only be asked of a live research project.
   *  `scoper` (`ResearchScoper`) drafts scopes; without one, questions are asked unscoped. */
  constructor({ questions, research, runs, projects, scoper = null, now = () => new Date().toISOString() }) {
    if (!questions || !research || !runs || !projects)
      throw new Error("ResearchQuestionService requires questions, research, runs and projects.");
    this.#questions = questions;
    this.#research = research;
    this.#runs = runs;
    this.#projects = projects;
    this.#scoper = scoper;
    this.#now = now;
  }

  /** A draft scope for the operator to read and correct. Starts nothing and stores nothing. */
  async draftScope(input) {
    await this.#researchProject(input?.projectId);
    const objective = this.#objectiveOf(input);
    if (!this.#scoper) throw unavailable("Scoping is not configured on this companion.");
    return this.#scoper.scope({ objective });
  }

  async ask(input) {
    if (!input || typeof input !== "object" || Array.isArray(input))
      throw badRequest("Provide a research question object.");
    const project = await this.#researchProject(input.projectId);
    const objective = this.#objectiveOf(input);
    const runs = input.runs === undefined ? DEFAULT_RUNS : Number(input.runs);
    if (!RUN_COUNTS.has(runs))
      throw badRequest("Ask with five runs, three, or one for a Quick answer that cannot be cross-checked.");
    const profile = input.profile === undefined ? "standard" : String(input.profile);
    const source = normalizeSource(input.source);
    const title = String(input.title ?? "").trim() || titleFrom(objective);
    const sourceKey = source.kind === "external" ? `${source.provider}:${source.requestId}` : null;
    // A repeated request finds its question before anything is scoped, so it costs nothing.
    const earlier = sourceKey ? await this.#questions.findBySourceKey(sourceKey) : null;
    if (earlier) return { question: await this.#record(earlier), reused: true };
    const scope = await this.#scopeFor(input, objective, source);
    const runObjective = scopedObjective(objective, scope?.scope ?? null);
    if (runObjective.length > MAX_RUN_OBJECTIVE_LENGTH)
      throw badRequest("The question and its scope are too long together. Shorten one of them.");

    const { question, reused } = await this.#questions.createQuestion({
      projectId: project.id,
      title: title.slice(0, 160),
      objective,
      profile,
      runsPlanned: runs,
      source,
      sourceKey,
      scope,
      now: this.#now(),
    });
    // A repeated request reuses the question it already raised and starts nothing.
    if (reused) return { question: await this.#record(question), reused: true };
    for (let index = 0; index < runs; index += 1) {
      const label = `r${index + 1}`;
      const run = await this.#research.createRun({
        objective: runObjective,
        profile,
        metadata: { questionId: question.id, run: label },
      });
      await this.#questions.attachRun(question.id, run.id, label, index + 1);
    }
    return { question: await this.#record(question), reused: false };
  }

  /**
   * Starts a question's runs again when every run of its latest attempt failed before it started
   * (a CLI not installed, a login missing, a key not set). The failed attempt stays on the record
   * as prior attempts. Anything else is not retried here: a run that started and failed spent
   * money and produced evidence, and asking again is a new question.
   */
  async retry(id) {
    if (this.#retrying.has(id)) return this.#retrying.get(id);
    const work = this.#retryFailedStart(id).finally(() => this.#retrying.delete(id));
    this.#retrying.set(id, work);
    return work;
  }

  async #retryFailedStart(id) {
    const question = await this.#questions.getQuestion(id);
    if (!question) return null;
    await this.#researchProject(question.projectId);
    const { latest } = await this.#attempts(question);
    if (!failedToStart(latest, question.runsPlanned))
      throw conflict("Only runs that failed before starting can be retried.");
    const next = Math.max(...(await this.#questions.runOrder(id)).map((entry) => entry.ordinal)) + 1;
    for (const [index, failed] of latest.entries()) {
      const label = `r${index + 1}`;
      // The same request the failed run was given, on the same engine.
      const run = await this.#research.createRun({
        objective: failed.request.objective,
        profile: failed.request.profile ?? question.profile,
        runtimeId: failed.runtimeId,
        metadata: { questionId: question.id, run: label },
      });
      await this.#questions.attachRun(question.id, run.id, label, next + index);
    }
    return this.#record(question, { activity: true });
  }

  async list(projectId) {
    await this.#researchProject(projectId, { allowArchived: true });
    return Promise.all(
      (await this.#questions.listQuestions(projectId)).map((question) => this.#record(question)),
    );
  }

  /** `activity: false` leaves out each run's event feed, for a caller that needs only the answer. */
  async get(id, { activity = true } = {}) {
    const question = await this.#questions.getQuestion(id);
    return question ? this.#record(question, { activity }) : null;
  }

  async review(id, input) {
    const question = await this.#questions.getQuestion(id);
    if (!question) return null;
    const decision = input?.decision;
    if (decision !== "approved" && decision !== "rejected") throw badRequest("Choose approved or rejected.");
    const note = String(input?.note ?? "").trim();
    if (note.length > MAX_NOTE_LENGTH)
      throw badRequest(`A review note must be ${MAX_NOTE_LENGTH} characters or fewer.`);
    if (decision === "rejected" && !note) throw badRequest("Say why the answer is rejected.");
    const current = await this.#record(question);
    if (current.status === "running" || current.status === "queued")
      throw conflict("A question can be reviewed once its runs have finished.");
    if (current.retryable)
      throw conflict("Retry the runs that failed to start before reviewing this question.");
    if (String(input?.evidenceSha ?? "") !== current.evidenceSha)
      throw conflict("The evidence changed while you were reviewing. Reload it and review again.");
    await this.#questions.addReview(question.id, {
      decision,
      note,
      reviewer: "operator",
      decidedAt: this.#now(),
      evidenceSha: current.evidenceSha,
    });
    return this.#record(question, { activity: true });
  }

  #objectiveOf(input) {
    const objective = String(input?.objective ?? "").trim();
    if (!objective) throw badRequest("Write the question you want researched.");
    if (objective.length > MAX_OBJECTIVE_LENGTH)
      throw badRequest(`A question must be ${MAX_OBJECTIVE_LENGTH} characters or fewer.`);
    return objective;
  }

  /**
   * The scope a question is pinned to: the one the operator sent (a draft they read, perhaps
   * edited), or, for an external request with none, one drafted now, because nobody is there to
   * scope it. A manual question sent without a scope is asked unscoped, as before.
   */
  async #scopeFor(input, objective, source) {
    if (input.scope != null) {
      let scope;
      try {
        scope = validateScope(input.scope);
      } catch (error) {
        throw badRequest(error.message);
      }
      return { scope, scopedBy: scopedByOf(input.scopedBy), reviewed: true };
    }
    if (source.kind !== "external" || !this.#scoper) return null;
    const drafted = await this.#scoper.scope({ objective });
    return { scope: drafted.scope, scopedBy: drafted.scopedBy, reviewed: false };
  }

  async #record(question, { activity = false } = {}) {
    const { latest: runs, prior } = await this.#attempts(question);
    const events = new Map();
    const sources = new Map();
    for (const run of runs) {
      if (activity)
        events.set(run.id, (await this.#runs.listEvents(run.id, { limit: EVENTS_PER_RUN })).events);
      sources.set(run.id, await this.#runs.listSources(run.id));
    }
    return questionRecord({
      question,
      runs,
      events,
      sources,
      prior,
      retryable: failedToStart(runs, question.runsPlanned),
      review: await this.#questions.latestReview(question.id),
    });
  }

  /** The runs of the question's latest attempt, in label order, and every earlier run. */
  async #attempts(question) {
    const order = await this.#questions.runOrder(question.id);
    const size = question.runsPlanned;
    const last = order.at(-1)?.ordinal ?? 0;
    const first = last ? Math.floor((last - 1) / size) * size + 1 : 1;
    const latest = [];
    const prior = [];
    for (const entry of order) {
      const run = await this.#runs.getRun(entry.id);
      if (!run) continue;
      if (entry.ordinal >= first) latest.push(run);
      else prior.push({ ...run, attempt: Math.floor((entry.ordinal - 1) / size) + 1 });
    }
    return { latest, prior };
  }

  async #researchProject(projectId, { allowArchived = false } = {}) {
    const id = String(projectId ?? "").trim();
    if (!id) throw badRequest("Choose a research project.");
    const project = (await this.#projects()).find((item) => item.id === id);
    if (!project) throw notFound("Research project not found.");
    if (project.kind !== "research")
      throw badRequest(
        `${project.name} is a delivery project; research questions belong to a research project.`,
      );
    if (project.archivedAt && !allowArchived)
      throw conflict(`Restore ${project.name} before asking it another question.`);
    return project;
  }
}

/** True when every run of an attempt failed before its runtime started: a failed start, or a
 *  run still queued when the process stopped. */
function failedToStart(runs, runsPlanned) {
  return (
    runs.length === runsPlanned &&
    runs.every((run) => run.status === "failed" && NOT_STARTED_CODES.includes(run.error?.code))
  );
}

/** Manual by default. An external request names its provider and its own id, which is what makes
 *  a repeated delivery of it find the same question. */
function normalizeSource(value) {
  if (value == null || value.kind === "manual") return { kind: "manual" };
  if (typeof value !== "object" || value.kind !== "external")
    throw badRequest("A question's source is manual, or an external request with a provider and id.");
  const provider = String(value.provider ?? "").trim();
  const requestId = String(value.requestId ?? "").trim();
  if (!/^[a-z][a-z0-9-]{0,39}$/.test(provider))
    throw badRequest("Name the external provider in lower case, for example linear or plancheck.");
  if (!requestId || requestId.length > MAX_SOURCE_FIELD)
    throw badRequest("An external request needs its own id.");
  const url = value.url == null ? null : String(value.url).trim();
  if (url && !/^https:\/\//.test(url)) throw badRequest("An external request link must be https.");
  return { kind: "external", provider, requestId, ...(url ? { url } : {}) };
}

/** Which model drafted a scope the operator then sent, as the draft said. Anything else reads as
 *  written by the operator: the label only ever says less than was claimed. */
function scopedByOf(value) {
  if (!value || typeof value !== "object" || !SCOPER_RUNTIMES.has(value.runtime))
    return { runtime: "operator" };
  const model = String(value.model ?? "").trim();
  // Provider-qualified, as the API loop names models: opencode-go/deepseek-v4.1-flash.
  if (!/^[A-Za-z0-9][A-Za-z0-9./-]{0,79}$/.test(model)) return { runtime: "operator" };
  const reasoning = value.reasoning == null ? null : String(value.reasoning).slice(0, 20);
  return { runtime: value.runtime, model, reasoning };
}

/** The first sentence, cut at a word, as a list title. The full objective stays on the record. */
function titleFrom(objective) {
  const sentence = objective.split(/(?<=[.?!])\s/)[0] ?? objective;
  if (sentence.length <= 90) return sentence;
  return `${sentence.slice(0, 89).replace(/\s+\S*$/, "")}…`;
}

function badRequest(message) {
  return withStatus(message, 400);
}

function conflict(message) {
  return withStatus(message, 409);
}

function unavailable(message) {
  return withStatus(message, 503);
}

function notFound(message) {
  return withStatus(message, 404);
}

function withStatus(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}
