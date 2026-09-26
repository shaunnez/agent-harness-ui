// The scoping step: a question becomes a pinned scope before any run starts.
//
// The 30 recorded scopes agreed 18 of 28 because each was pinned: one item, one measure, one set
// of inclusions. The three open customer questions disagreed on units in 3 of 9 runs, because each
// run decided for itself what was being priced. Here one cheap, tools-less call decides that once,
// the operator can correct it, and every run is given the same pinned text.
//
// One call, no tools, JSON only, to DeepSeek through the same chat API and key the API loop uses
// (Shaun, 26 September 2026: research runs on the API loop alone, no Claude or Codex CLI).

// The reply is parsed strictly. A scope that is not the schema is an error, never a guess: a
// wrong scope pinned onto three runs is worse than none, because it makes them agree.

import process from "node:process";
import { chatOnceWithRetries } from "./api-loop/chat-loop.mjs";
import { DEFAULT_API_LOOP_MODEL } from "./api-loop/runtime.mjs";

/** The measures a band can be priced in, named as `unitMeasure` names them, so a run's band and
 *  the scope compare directly. */
export const SCOPE_MEASURES = Object.freeze([
  "per m²",
  "per m³",
  "per metre",
  "each",
  "per house",
  "total",
  "per time",
]);

/** The research agent's own model unless `RESEARCH_SCOPE_MODEL` names another API-loop model. */
export const DEFAULT_SCOPE_MODEL = DEFAULT_API_LOOP_MODEL;

const SCOPE_TIMEOUT_MS = 120_000;
const MAX_TEXT = 400;
const MAX_LIST = 12;
const TEXT_FIELDS = ["item", "measure", "unitText", "quantityBasis", "centre"];
const LIST_FIELDS = ["inclusions", "exclusions", "assumptions", "clarifications"];
const FIELDS = new Set([...TEXT_FIELDS, ...LIST_FIELDS]);

export const SCOPE_SYSTEM_PROMPT = `You turn a New Zealand construction cost question into a pinned scope for cost researchers.
You do not price anything and you have no tools. Reply with one JSON object and nothing else.

Fields, all required:
- "item": the one thing to be priced, in a short phrase.
- "measure": exactly one of ${SCOPE_MEASURES.map((measure) => `"${measure}"`).join(", ")}. Pick the measure the asker needs. A rate question is priced per unit; a "how much for the job" question is "total".
- "unitText": the unit in words, for example "m² of roof plan area".
- "quantityBasis": the quantity stated or implied, or "" if the measure is a rate and none is given.
- "inclusions": array of what the price includes.
- "exclusions": array of what it leaves out (GST is always excluded; do not list it).
- "centre": the NZ city or region the price is for, or "" if none is given.
- "assumptions": array of what you assumed to make the scope priceable.
- "clarifications": array of what you could not decide and a researcher should state an assumption for.

Keep every string under ${MAX_TEXT} characters and every array under ${MAX_LIST} items. Do not invent quantities the question does not give.`;

/** A scope that failed to parse, or a scoper that could not answer. */
export class ScopeError extends Error {
  constructor(message, { code, statusCode }) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
  }
}

/** Parse a model's reply. One JSON object, bare or in a single fenced block; anything else
 *  throws `scope_malformed`. */
export function parseScope(text) {
  const raw = String(text ?? "").trim();
  const fenced = /^```(?:json)?\s*\n([\s\S]*?)\n```$/.exec(raw);
  let value;
  try {
    value = JSON.parse(fenced ? fenced[1] : raw);
  } catch {
    throw malformed("The scoper did not reply with JSON.");
  }
  return validateScope(value, { source: "The scoper's reply" });
}

/** Check a scope object, from the scoper or edited by the operator. Returns a clean copy. */
export function validateScope(value, { source = "The scope" } = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw malformed(`${source} is not an object.`);
  const extra = Object.keys(value).filter((key) => !FIELDS.has(key));
  if (extra.length) throw malformed(`${source} has fields a scope does not have: ${extra.join(", ")}.`);
  const scope = {};
  for (const field of TEXT_FIELDS) {
    if (typeof value[field] !== "string") throw malformed(`${source} needs "${field}" as text.`);
    scope[field] = value[field].trim();
    if (scope[field].length > MAX_TEXT) throw malformed(`"${field}" is over ${MAX_TEXT} characters.`);
  }
  for (const field of LIST_FIELDS) {
    const list = value[field];
    if (!Array.isArray(list) || list.some((entry) => typeof entry !== "string"))
      throw malformed(`${source} needs "${field}" as a list of text.`);
    if (list.length > MAX_LIST) throw malformed(`"${field}" has more than ${MAX_LIST} entries.`);
    scope[field] = list.map((entry) => entry.trim()).filter(Boolean);
    if (scope[field].some((entry) => entry.length > MAX_TEXT))
      throw malformed(`An entry in "${field}" is over ${MAX_TEXT} characters.`);
  }
  if (!scope.item) throw malformed(`${source} names no item.`);
  if (!SCOPE_MEASURES.includes(scope.measure))
    throw malformed(`"measure" must be one of ${SCOPE_MEASURES.join(", ")}.`);
  return scope;
}

/** The text every run receives after the objective. Written as an instruction, because the run
 *  prompts price whatever the objective says. */
export function pinnedScopeText(scope) {
  const list = (items) => (items.length ? items.join("; ") : "none stated");
  return [
    "Pinned scope. Price exactly this; do not re-scope it.",
    `- Item: ${scope.item}`,
    `- Measure: ${scope.measure}${scope.unitText ? ` (${scope.unitText})` : ""}. Give the band in this measure.`,
    ...(scope.quantityBasis ? [`- Quantity basis: ${scope.quantityBasis}`] : []),
    `- Includes: ${list(scope.inclusions)}`,
    `- Excludes: ${list(scope.exclusions)}`,
    ...(scope.centre ? [`- Centre: ${scope.centre}`] : []),
    ...(scope.assumptions.length ? [`- Assumptions: ${scope.assumptions.join("; ")}`] : []),
    ...(scope.clarifications.length
      ? [`- Not decided (state the assumption you price on): ${scope.clarifications.join("; ")}`]
      : []),
  ].join("\n");
}

/** The objective a run is started with: the question, then its pinned scope. */
export function scopedObjective(objective, scope) {
  return scope ? `${objective}\n\n${pinnedScopeText(scope)}` : objective;
}

/**
 * The scoper. `scope({objective})` returns `{scope, scopedBy, usage}`; `scopedBy` names the
 * runtime and model that answered. A malformed scope is reported, never retried until something
 * parses.
 */
export class ResearchScoper {
  #env;
  #model;
  #fetchImpl;

  /** `env` holds the provider key (the companion passes the API loop's own copy). */
  constructor({ env = process.env, model = null, fetchImpl = globalThis.fetch } = {}) {
    this.#env = env;
    this.#model = model ?? env.RESEARCH_SCOPE_MODEL ?? DEFAULT_SCOPE_MODEL;
    this.#fetchImpl = fetchImpl;
  }

  async scope({ objective, signal } = {}) {
    const text = String(objective ?? "").trim();
    if (!text) throw new ScopeError("Write the question to scope.", { code: "scope_empty", statusCode: 400 });
    let reply;
    try {
      reply = await chatOnceWithRetries({
        env: this.#env,
        model: this.#model,
        systemPrompt: SCOPE_SYSTEM_PROMPT,
        prompt: text,
        timeoutMs: SCOPE_TIMEOUT_MS,
        signal,
        fetchImpl: this.#fetchImpl,
      });
    } catch (error) {
      throw new ScopeError(`The scoper could not answer: ${error?.message ?? String(error)}`, {
        code: "scope_unavailable",
        statusCode: 503,
      });
    }
    return {
      scope: parseScope(reply.text),
      scopedBy: { runtime: "api-loop", model: this.#model, reasoning: null },
      usage: reply.usage ?? null,
    };
  }
}

function malformed(message) {
  return new ScopeError(message, { code: "scope_malformed", statusCode: 422 });
}
