// `ResearchRuntime` as a thin tool-calling loop over an OpenAI-compatible API (Shaun, 24 September:
// "build the thin loop now, and lets test it against the 13 questions").
//
// Same harness as every other research runtime: the queue, one host-tool session per run, QV from
// PlanCheck's library, host-owned `fetch_source`/`read_source`, every citation checked after the
// run, the transcript scanned for credentials. What differs is that nothing is spawned: the loop
// runs in this process and calls the host tools over the run's socket, and web search is a host
// tool too (Parallel, key on the host). So a run costs a few megabytes instead of an OpenCode
// process's ~400 MB, and the only credentials are the host's own.
//
// Provider keys (`OPENCODE_API_KEY`, `BASETEN_API_KEY`, `PARALLEL_API_KEY`) are read from the host
// environment and never logged; Shaun chose API keys for production workers. Not in the Settings
// picker: it is measured first, as eval arm A6.

import {
  allowedToolName,
  QV_TOOL_DEFINITIONS,
  RELAY_TOOL_DEFINITIONS,
} from "../claude-cli/host-tools/definitions.mjs";
import { ClaudeCliResearchRuntime } from "../claude-cli/runtime.mjs";
import { CODEX_SYSTEM_PROMPT_PATH } from "../codex-cli/runtime.mjs";
import { ParallelSearchProvider } from "../parallel-search-provider.mjs";
import { QV_TOOL_NAMES } from "../qv-plancheck.mjs";
import {
  API_LOOP_EMPTY_OUTPUT_ERROR_CODE,
  API_LOOP_SOFT_TOOL_CALLS,
  classifyApiLoopCall,
  runChatLoop,
} from "./chat-loop.mjs";
import { connectHostTools } from "./host-client.mjs";
import { resolveApiModel } from "./providers.mjs";

export const API_LOOP_RESEARCH_RUNTIME_ID = "api-loop";
export const DEFAULT_API_LOOP_MODEL = "opencode-go/deepseek-v4.1-flash";

/** Web search is a host tool here, beside the two every runtime has. */
export const API_LOOP_HOST_TOOLS = Object.freeze(["web_search", "fetch_source", "read_source"]);

/** The hard cap per run: the same 15 minutes Shaun set for DeepSeek on OpenCode. */
export const API_LOOP_MAX_RUNTIME_MS = 15 * 60_000;

/** The Codex recipe (it allows a total from stated, cited assumptions) in this loop's tool names,
 *  with the three rules DeepSeek needed on OpenCode (`29-EVAL-PREREGISTRATION.md`, A5). */
export function apiLoopSystemPrompt(prompt) {
  const body = String(prompt)
    .replace(/mcp__[A-Za-z0-9_-]+?__([A-Za-z0-9_]+)/g, "$1")
    .replace(/\bWebSearch\b/g, "web_search");
  return (
    `${body}\n\n` +
    "Web pages: find them with web_search and read them only with fetch_source; a figure is citable only " +
    "from a page fetched that way. An excerpt is ONE continuous passage copied character for character from " +
    "the fetched text: never join separate passages with '...', never write escape sequences such as \\n, and " +
    "keep it to the sentence or table row that states the figure. Copy figures exactly as the page writes " +
    'them, including "k", dashes and commas: never reformat a number ($1.1k stays $1.1k, not $1,100). ' +
    "When a web component's amount is not the quoted figure itself (a rate times a quantity, a " +
    "cost shared across a count, hours times an hourly rate), show the working in two fields: " +
    '"rate": {"low","high","unit"}, the figure exactly as the page states it, and "quantity": ' +
    '{"low","high","unit","basis"}, what you multiplied it by (the same number for low and high ' +
    "when it is fixed; a fraction such as 0.025 for one item shared across 40). The amount must then " +
    "equal rate × quantity: the host recomputes it and checks the rate against the page, and an " +
    "amount it cannot trace to the quote is marked unsupported. " +
    "Quote only from fetch_source or " +
    'read_source text, never from a web_search snippet. For a PDF, "page" is required: the physical page ' +
    "number fetch_source or read_source gave for the text you quote; a PDF quote without it cannot be checked. " +
    "Before finishing, check the largest " +
    "component: if it rests on no cited QV row, close proxy or fetched quote, the band is not established. " +
    `You have about ${API_LOOP_SOFT_TOOL_CALLS} tool calls in total: if the main cost is still unsourced by ` +
    "then, finish with not established rather than keep searching."
  );
}

function loopTools() {
  return [...QV_TOOL_NAMES, ...API_LOOP_HOST_TOOLS].map((name) => ({
    name,
    cliName: QV_TOOL_DEFINITIONS[name] ? `mcp__qv__${name}` : allowedToolName(name),
    definition: RELAY_TOOL_DEFINITIONS[name],
  }));
}

export function apiLoopDriver({ env = process.env, fetchImpl = globalThis.fetch } = {}) {
  return Object.freeze({
    label: "API loop",
    transcript: { kind: "api-loop-transcript", name: "API loop JSON transcript" },
    emptyOutputCode: API_LOOP_EMPTY_OUTPUT_ERROR_CODE,
    // Nothing to spawn and no login to probe: the run's own model call proves its key.
    assertAuth: async () => ({ binary: null }),
    defaultModel: (source) => source.RESEARCH_API_LOOP_MODEL ?? DEFAULT_API_LOOP_MODEL,
    metadata: ({ model, allowedTools }) => ({
      cliModel: model,
      provider: resolveApiModel(model).provider.label,
      allowedTools: allowedTools.join(","),
      costBasis: "api_rate_estimate",
    }),
    async call({ session, budget, model, systemPrompt, objective, signal, onEvent, onRawLine, onCeiling }) {
      resolveApiModel(model);
      if (!session?.qv)
        throw new Error(
          "The API loop answers QV from PlanCheck's rate library only; set RESEARCH_QV_SOURCE=plancheck.",
        );
      const host = await connectHostTools(session.entryFor([]).socketPath);
      try {
        return await runChatLoop({
          env,
          model,
          systemPrompt: apiLoopSystemPrompt(systemPrompt),
          objective,
          tools: loopTools(),
          host,
          timeoutMs: Math.min(budget?.maxRuntimeMs ?? API_LOOP_MAX_RUNTIME_MS, API_LOOP_MAX_RUNTIME_MS),
          signal,
          ceilings: budget ?? null,
          onEvent,
          onRawLine,
          onCeiling,
          fetchImpl,
        });
      } finally {
        await host.close().catch(() => undefined);
      }
    },
    classify: classifyApiLoopCall,
  });
}

export class ApiLoopResearchRuntime extends ClaudeCliResearchRuntime {
  /** `fetchImpl` answers the model calls; tests pass a stub, nothing else should. */
  constructor({ env = process.env, webToolsOptions = {}, fetchImpl = globalThis.fetch, ...options } = {}) {
    const searchProvider =
      webToolsOptions.searchProvider ??
      (env.PARALLEL_API_KEY ? new ParallelSearchProvider({ apiKey: env.PARALLEL_API_KEY }) : null);
    super({
      id: API_LOOP_RESEARCH_RUNTIME_ID,
      systemPromptPath: CODEX_SYSTEM_PROMPT_PATH,
      hostTools: API_LOOP_HOST_TOOLS,
      allowedTools: loopTools().map((tool) => tool.cliName),
      ...options,
      env,
      webToolsOptions: { ...webToolsOptions, ...(searchProvider ? { searchProvider } : {}) },
      driver: apiLoopDriver({ env, fetchImpl }),
    });
  }
}
