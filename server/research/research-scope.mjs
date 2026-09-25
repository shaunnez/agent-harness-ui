// The scoping step: a question becomes a pinned scope before any run starts.
//
// The 30 recorded scopes agreed 18 of 28 because each was pinned: one item, one measure, one set
// of inclusions. The three open customer questions disagreed on units in 3 of 9 runs, because each
// run decided for itself what was being priced. Here one cheap, tools-less call decides that once,
// the operator can correct it, and every run is given the same pinned text.
//
// One call, no tools, JSON only. GPT-6 Luna on the ChatGPT plan through `codex exec`, with Haiku
// 4.5 on the Claude subscription as the fallback when Codex cannot answer at all. Neither path
// holds an API key: the CLIs' own auth gates run first, and their environments are built from
// allowlists (`codex-cli/auth.mjs`, `claude-cli/auth.mjs`).
//
// The reply is parsed strictly. A scope that is not the schema is an error, never a guess: a
// wrong scope pinned onto three runs is worse than none, because it makes them agree.

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { runProcess } from "../process-runtime.mjs";
import { assertSubscriptionAuth } from "./claude-cli/auth.mjs";
import { buildClaudeEnvironment, classifyCall, runClaudeCall } from "./claude-cli/cli-call.mjs";
import { EMPTY_OUTPUT_ERROR_CODE } from "./claude-cli/driver.mjs";
import { assertChatGptAuth } from "./codex-cli/auth.mjs";
import { classifyCodexCall, runCodexCall } from "./codex-cli/codex-call.mjs";

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

export const DEFAULT_SCOPE_MODEL = "gpt-6-luna";
export const DEFAULT_SCOPE_REASONING = "medium";
export const FALLBACK_SCOPE_MODEL = "claude-haiku-4-5";

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
 * runtime and model that answered. Codex (Luna) first; Claude (Haiku) only when Codex could not
 * answer at all, never when it answered badly: a malformed scope is reported, not retried
 * elsewhere until something parses.
 */
export class ResearchScoper {
  #env;
  #run;
  #drivers;

  constructor({ env = process.env, run = runProcess, drivers = null } = {}) {
    this.#env = env;
    this.#run = run;
    this.#drivers = drivers ?? [codexScopeDriver(env), claudeScopeDriver(env)];
  }

  async scope({ objective, signal } = {}) {
    const text = String(objective ?? "").trim();
    if (!text) throw new ScopeError("Write the question to scope.", { code: "scope_empty", statusCode: 400 });
    const unavailable = [];
    for (const driver of this.#drivers) {
      let reply;
      try {
        reply = await driver.call({ objective: text, run: this.#run, env: this.#env, signal });
      } catch (error) {
        unavailable.push(`${driver.label}: ${error?.message ?? String(error)}`);
        continue;
      }
      return {
        scope: parseScope(reply.text),
        scopedBy: { runtime: driver.runtime, model: driver.model, reasoning: driver.reasoning ?? null },
        usage: reply.usage ?? null,
      };
    }
    throw new ScopeError(`No scoper could answer. ${unavailable.join(" ")}`, {
      code: "scope_unavailable",
      statusCode: 503,
    });
  }
}

/** GPT-6 Luna through `codex exec`, with no tools, no web search and no shell. */
export function codexScopeDriver(env, { binary = null } = {}) {
  const model = env.RESEARCH_SCOPE_MODEL ?? DEFAULT_SCOPE_MODEL;
  const reasoning = env.RESEARCH_SCOPE_REASONING ?? DEFAULT_SCOPE_REASONING;
  return {
    label: "Codex",
    runtime: "codex-cli",
    model,
    reasoning,
    async call({ objective, run, env: callEnv, signal }) {
      const { binary: resolved } = await assertChatGptAuth({ binary, run });
      return inTemporaryDirectory(async (cwd) => {
        let text = "";
        const call = await runCodexCall({
          run,
          binary: resolved,
          env: callEnv,
          cwd,
          objective,
          model,
          reasoning,
          systemPrompt: SCOPE_SYSTEM_PROMPT,
          mcpConfig: null,
          allowedTools: [],
          timeoutMs: SCOPE_TIMEOUT_MS,
          signal,
          onRawLine: (line) => {
            const parsed = safeJson(line);
            if (parsed?.type === "item.completed" && parsed.item?.type === "agent_message")
              text = String(parsed.item.text ?? parsed.item.content ?? "");
          },
        });
        const verdict = classifyCodexCall(call);
        if (!verdict.ok) throw new Error(verdict.error.message);
        return { text, usage: call.usage };
      });
    },
  };
}

/** Haiku 4.5 through `claude -p`, on the subscription, with an empty tool list. */
export function claudeScopeDriver(env, { binary = null } = {}) {
  const model = env.RESEARCH_SCOPE_FALLBACK_MODEL ?? FALLBACK_SCOPE_MODEL;
  return {
    label: "Claude",
    runtime: "claude-cli",
    model,
    reasoning: null,
    async call({ objective, run, env: callEnv, signal }) {
      const { binary: resolved } = await assertSubscriptionAuth({ binary, run });
      return inTemporaryDirectory(async (cwd) => {
        const mcpConfigPath = path.join(cwd, "mcp.json");
        await writeFile(mcpConfigPath, JSON.stringify({ mcpServers: {} }));
        const call = await runClaudeCall({
          run,
          binary: resolved,
          // Built from the same allowlist as a research run: no ANTHROPIC_API_KEY, no base URL.
          env: buildClaudeEnvironment(callEnv, cwd),
          cwd,
          objective,
          model,
          systemPrompt: SCOPE_SYSTEM_PROMPT,
          mcpConfigPath,
          allowedTools: [],
          timeoutMs: SCOPE_TIMEOUT_MS,
          signal,
        });
        const verdict = classifyCall(call, { emptyOutputCode: EMPTY_OUTPUT_ERROR_CODE });
        if (!verdict.ok) throw new Error(verdict.error.message);
        return { text: String(call.resultLine?.result ?? call.finalText ?? ""), usage: call.usage };
      });
    },
  };
}

async function inTemporaryDirectory(work) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "research-scope-"));
  try {
    return await work(directory);
  } finally {
    await rm(directory, { recursive: true, force: true }).catch(() => undefined);
  }
}

function safeJson(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function malformed(message) {
  return new ScopeError(message, { code: "scope_malformed", statusCode: 422 });
}
