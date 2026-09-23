// Research questions: ask one objective of a research project, answered by three runs (or a
// labelled one-run Quick ask), and record a review pinned to the evidence the reviewer saw.
//
// Runs are started through `ResearchService.createRun`, so each keeps its own Settings snapshot
// and budget, and nothing here can reach the SDLC plane. A review is only a decision: nothing is
// published, priced or sent anywhere when a question is approved. Where approved answers go is
// undecided (`27-RESEARCH-PROJECTS-UI-PLAN.md`), and that step, when it exists, reads reviews
// rather than being part of one.

import { questionRecord } from "./research-question-record.mjs";

const RUN_COUNTS = new Set([1, 3]);
const MAX_OBJECTIVE_LENGTH = 4_000;
const MAX_NOTE_LENGTH = 2_000;
const MAX_SOURCE_FIELD = 200;
const EVENTS_PER_RUN = 500;

export class ResearchQuestionService {
  #questions;
  #research;
  #runs;
  #projects;
  #now;

  /** `research` starts runs; `runs` is the `ResearchStore` they are read back from; `projects`
   *  lists registered projects, so a question can only be asked of a live research project. */
  constructor({ questions, research, runs, projects, now = () => new Date().toISOString() }) {
    if (!questions || !research || !runs || !projects)
      throw new Error("ResearchQuestionService requires questions, research, runs and projects.");
    this.#questions = questions;
    this.#research = research;
    this.#runs = runs;
    this.#projects = projects;
    this.#now = now;
  }

  async ask(input) {
    if (!input || typeof input !== "object" || Array.isArray(input))
      throw badRequest("Provide a research question object.");
    const project = await this.#researchProject(input.projectId);
    const objective = String(input.objective ?? "").trim();
    if (!objective) throw badRequest("Write the question you want researched.");
    if (objective.length > MAX_OBJECTIVE_LENGTH)
      throw badRequest(`A question must be ${MAX_OBJECTIVE_LENGTH} characters or fewer.`);
    const runs = input.runs === undefined ? 3 : Number(input.runs);
    if (!RUN_COUNTS.has(runs))
      throw badRequest("Ask with three runs, or one for a Quick answer that cannot be cross-checked.");
    const profile = input.profile === undefined ? "standard" : String(input.profile);
    const source = normalizeSource(input.source);
    const title = String(input.title ?? "").trim() || titleFrom(objective);

    const { question, reused } = this.#questions.createQuestion({
      projectId: project.id,
      title: title.slice(0, 160),
      objective,
      profile,
      runsPlanned: runs,
      source,
      sourceKey: source.kind === "external" ? `${source.provider}:${source.requestId}` : null,
      now: this.#now(),
    });
    // A repeated request reuses the question it already raised and starts nothing.
    if (reused) return { question: await this.#record(question), reused: true };
    for (let index = 0; index < runs; index += 1) {
      const label = `r${index + 1}`;
      const run = await this.#research.createRun({
        objective,
        profile,
        metadata: { questionId: question.id, run: label },
      });
      this.#questions.attachRun(question.id, run.id, label);
    }
    return { question: await this.#record(question), reused: false };
  }

  async list(projectId) {
    await this.#researchProject(projectId, { allowArchived: true });
    return Promise.all(this.#questions.listQuestions(projectId).map((question) => this.#record(question)));
  }

  async get(id) {
    const question = this.#questions.getQuestion(id);
    return question ? this.#record(question, { activity: true }) : null;
  }

  async review(id, input) {
    const question = this.#questions.getQuestion(id);
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
    if (String(input?.evidenceSha ?? "") !== current.evidenceSha)
      throw conflict("The evidence changed while you were reviewing. Reload it and review again.");
    this.#questions.addReview(question.id, {
      decision,
      note,
      reviewer: "operator",
      decidedAt: this.#now(),
      evidenceSha: current.evidenceSha,
    });
    return this.#record(question, { activity: true });
  }

  async #record(question, { activity = false } = {}) {
    const runs = [];
    const events = new Map();
    for (const runId of this.#questions.runIds(question.id)) {
      const run = await this.#runs.getRun(runId);
      if (!run) continue;
      runs.push(run);
      if (activity) events.set(runId, (await this.#runs.listEvents(runId, { limit: EVENTS_PER_RUN })).events);
    }
    return questionRecord({ question, runs, events, review: this.#questions.latestReview(question.id) });
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

function notFound(message) {
  return withStatus(message, 404);
}

function withStatus(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}
