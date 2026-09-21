#!/usr/bin/env node
// CHILD ENTRYPOINT. The only file in the repository permitted to import `deepagents`,
// `langchain`, `@langchain/*` or `langsmith` (architecture §5.4). Spawned by `adapter.mjs`
// with its research request on stdin; writes one NDJSON message per line to stdout
// (`event-protocol.mjs`) and nothing else — any stray `console.log` from here or a dependency
// would corrupt that stream, so diagnostics that are not a protocol message go to stderr.
//
// One Deep Agents agent. No subagents and no RAG. Search, fetch and evidence verification are
// requested over the parent-owned protocol; this process receives neither a search credential
// nor a general HTTP tool.
// `createSubAgentMiddleware({ generalPurposeAgent: false, subagents: [] })` is still present
// and deliberate: `deepagents` adds a working general-purpose subagent automatically even when
// no `subagents` option is given at all (G3 D2), and "no general-purpose subagent" is a
// stated security requirement, not an incidental one.

import process from "node:process";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { ChatAnthropic } from "@langchain/anthropic";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { AIMessage } from "@langchain/core/messages";
import { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";
import { ChatOpenAI } from "@langchain/openai";
import { createDeepAgent, createSubAgentMiddleware, StateBackend } from "deepagents";
import { modelCallLimitMiddleware, tool } from "langchain";
import { graphRecursionLimitForBudget } from "../../../src/research-budget-policy.ts";
import { encodeWorkerMessage } from "./event-protocol.mjs";
import { modelConstructorOptions } from "./model-config.mjs";
import { openHostToolChannel } from "./host-tool-client.mjs";

const startedAtMs = Date.now();

/** Host tool errors a model can correct on its own: malformed input it chose, and the two
 *  discovery ceilings that leave the run otherwise viable. Everything absent from this set —
 *  cancellation, deadline expiry, aggregate tool-call exhaustion, provider and protocol
 *  failures — still terminates the run, because no reply from the model can resolve it. */
const RECOVERABLE_TOOL_ERROR_CODES = new Set([
  "invalid_tool_input",
  "invalid_finding",
  "evidence_required",
  "too_much_evidence",
  "source_not_in_run",
  "pdf_page_required",
  "invalid_locator",
  "excerpt_not_found",
  "source_empty",
  "policy_rejected",
  "unknown_research_tool",
  "capture_ceiling_exceeded",
  "search_call_ceiling_exceeded",
]);

/** How many times one error code may be returned to the model before the run gives up on it.
 *  Counted per code, so unrelated corrections never consume each other's budget. */
const MAX_RECOVERABLE_STRIKES_PER_CODE = 2;

function send(message) {
  process.stdout.write(encodeWorkerMessage(message));
}
function sendEvent(event, data = {}) {
  send({ type: "research_event", event, data });
}
function sendLog(message) {
  send({ type: "log", message });
}
function sendUsage(usage, budgetState) {
  send({ type: "usage", usage, budgetState });
}
function sendResult(result) {
  send({ type: "result", result });
}
function sendError(error) {
  send({ type: "error", error });
}

/** No API key, no network, no provider package. Deterministic so tests need neither a
 *  credential nor a live model to prove the runtime plumbing (task §5: "prove runtime
 *  plumbing", not sophisticated prompting). One synthetic finding, then a final answer. */
class FakeToolCallingModel extends BaseChatModel {
  constructor({ label = "fake-research-model", delayMs = 0, misbehavior = null, scenario = "html" } = {}) {
    super({});
    this.label = label;
    this.delayMs = delayMs;
    this.misbehavior = misbehavior;
    this.scenario = scenario;
    this.calls = 0;
    this.submittedFinding = false;
    this.stage = 0;
    this.misbehaviorHandled = false;
  }
  _llmType() {
    return "fake-research-model";
  }
  get _identifyingParams() {
    return { label: this.label };
  }
  // Deep Agents binds filesystem/task tools regardless of the model; this must not throw.
  bindTools(tools, kwargs) {
    this.boundTools = tools;
    return this.withConfig({ ...(kwargs ?? {}) });
  }
  async _generate(messages) {
    if (this.delayMs) await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    this.calls += 1;
    const usage_metadata = { input_tokens: 120, output_tokens: 40, total_tokens: 160 };
    const response_metadata = { model_name: this.label };
    let message;
    if (this.misbehavior === "general_purpose_subagent" && !this.misbehaviorHandled) {
      this.misbehaviorHandled = true;
      // Probes the non-goal "no general-purpose subagent" directly (task §9, §11): even with
      // zero subagents configured, `deepagents` admits a working general-purpose worker unless
      // `createSubAgentMiddleware({ generalPurposeAgent: false })` says otherwise (G3 D2).
      message = new AIMessage({
        content: "",
        tool_calls: [
          {
            name: "task",
            args: { description: "delegate", subagent_type: "general-purpose" },
            id: "fake-gp-1",
            type: "tool_call",
          },
        ],
        usage_metadata,
        response_metadata,
      });
    } else if (this.misbehavior === "invalid_finding" && !this.misbehaviorHandled) {
      this.misbehaviorHandled = true;
      // Deliberately fails `submitFindingTool`'s zod schema (`claim` must be a non-empty
      // string): proves a malformed tool call is rejected at the tool boundary rather than
      // crashing the graph (task §11.5), and that the model can recover afterwards.
      message = new AIMessage({
        content: "",
        tool_calls: [{ name: "submit_finding", args: { claim: 12345 }, id: "fake-bad-1", type: "tool_call" }],
        usage_metadata,
        response_metadata,
      });
    } else if (this.misbehavior === "host_rejected_finding" && !this.misbehaviorHandled) {
      this.misbehaviorHandled = true;
      // Passes `submitFindingTool`'s zod schema and is rejected by the *host* instead, for
      // citing a source that never belonged to this run. This is a different boundary from
      // `invalid_finding`: a schema failure never leaves the child, while a host rejection
      // crosses the tool channel, and used to abort the graph rather than reach the model.
      message = new AIMessage({
        content: "",
        tool_calls: [
          {
            name: "submit_finding",
            args: {
              claim: "A claim citing a source this run never retained.",
              evidence: [{ sourceId: "source-not-in-this-run", excerpt: "unverifiable excerpt" }],
            },
            id: "fake-host-reject-1",
            type: "tool_call",
          },
        ],
        usage_metadata,
        response_metadata,
      });
    } else if (this.stage === 0) {
      this.stage = 1;
      message = new AIMessage({
        content: "",
        tool_calls: [
          {
            name: "web_search",
            args: { query: "fixture waterproofing installation requirements" },
            id: `fake-call-${this.calls}`,
            type: "tool_call",
          },
        ],
        usage_metadata,
        response_metadata,
      });
    } else if (this.stage === 1) {
      const search = latestToolJson(messages);
      this.stage = 2;
      message = new AIMessage({
        content: "",
        tool_calls: [
          {
            name: "fetch_source",
            args: { url: search?.results?.[0]?.url ?? "https://example.invalid/no-search-result" },
            id: `fake-call-${this.calls}`,
            type: "tool_call",
          },
        ],
        usage_metadata,
        response_metadata,
      });
    } else if (this.stage === 2) {
      const fetched = latestToolJson(messages);
      if (this.scenario === "pdf") {
        this.stage = 3;
        message = new AIMessage({
          content: "",
          tool_calls: [
            {
              name: "read_source",
              args: { sourceId: fetched?.source?.id ?? "missing-source", page: 2 },
              id: `fake-call-${this.calls}`,
              type: "tool_call",
            },
          ],
          usage_metadata,
          response_metadata,
        });
        return { generations: [{ text: message.content, message }], llmOutput: {} };
      }
      const excerpt = String(fetched?.content ?? "")
        .slice(0, 180)
        .trim();
      this.stage = 3;
      this.submittedFinding = true;
      message = new AIMessage({
        content: "",
        tool_calls: [
          {
            name: "submit_finding",
            args: {
              claim: "The retained fixture source states the tested installation requirement.",
              evidence: [
                {
                  sourceId: fetched?.source?.id ?? "missing-source",
                  excerpt,
                  authority: "primary",
                  locator: { section: "Application" },
                },
              ],
              confidence: 0.9,
            },
            id: `fake-call-${this.calls}`,
            type: "tool_call",
          },
        ],
        usage_metadata,
        response_metadata,
      });
    } else if (this.stage === 3 && this.scenario === "pdf") {
      const read = latestToolJson(messages);
      const excerpt = String(read?.content ?? "")
        .slice(0, 180)
        .trim();
      this.stage = 4;
      this.submittedFinding = true;
      message = new AIMessage({
        content: "",
        tool_calls: [
          {
            name: "submit_finding",
            args: {
              claim: "The retained PDF page states the tested requirement.",
              evidence: [
                {
                  sourceId: read?.sourceId ?? "missing-source",
                  excerpt,
                  authority: "primary",
                  locator: { page: 2 },
                },
              ],
              confidence: 0.9,
            },
            id: `fake-call-${this.calls}`,
            type: "tool_call",
          },
        ],
        usage_metadata,
        response_metadata,
      });
    } else {
      message = new AIMessage({
        content: "Research complete. One finding was recorded.",
        usage_metadata,
        response_metadata,
      });
    }
    return { generations: [{ text: message.content, message }], llmOutput: {} };
  }
}

function latestToolJson(messages) {
  for (let index = (messages ?? []).length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    const type = typeof message?.getType === "function" ? message.getType() : message?._getType?.();
    if (type !== "tool" || typeof message.content !== "string") continue;
    try {
      return JSON.parse(message.content);
    } catch {
      return null;
    }
  }
  return null;
}

/** Exported so a test can prove that a live constructor receives the configured maximum
 *  output token count without a network call. The constructor arguments themselves are owned
 *  by `model-config.mjs`; this function only decides which class they are handed to. */
export async function buildModel(modelConfig, env = process.env) {
  if (modelConfig.provider === "anthropic" || modelConfig.provider === "openai-compatible") {
    const apiKey = env[modelConfig.apiKeyEnvVar];
    if (!apiKey)
      throw new Error(
        `A ${modelConfig.provider} model was requested but ${modelConfig.apiKeyEnvVar} was not provided to the child.`,
      );
    const { provider, options } = modelConstructorOptions(modelConfig, apiKey);
    return provider === "anthropic" ? new ChatAnthropic(options) : new ChatOpenAI(options);
  }
  return new FakeToolCallingModel({
    label: modelConfig.model,
    delayMs: Number(modelConfig.fakeDelayMs ?? 0),
    misbehavior: modelConfig.fakeMisbehavior ?? null,
    scenario: modelConfig.fakeScenario ?? "html",
  });
}

function buildPrompt(config) {
  const lines = [
    `Research objective: ${config.objective}`,
    "",
    "You are the sole research agent for this run. There are no other agents to delegate to. " +
      "Use web_search to discover relevant primary or authoritative public sources, fetch_source " +
      "before relying on a result, use read_source when the initial preview omits a needed page or text, " +
      "and submit_finding with exact excerpts from retained sources and a physical page for PDFs. " +
      "Surface uncertainty and conflicting evidence. Never invent a price or specification. Stop " +
      "when the evidence is sufficient or a host budget ceiling is reached, then give a short answer.",
  ];
  if (config.context?.length) {
    lines.push("", `Supplied context references: ${JSON.stringify(config.context)}`);
  }
  if (config.constraints) lines.push("", `Constraints: ${JSON.stringify(config.constraints)}`);
  if (config.outputSchema)
    lines.push("", `Desired output shape (advisory): ${JSON.stringify(config.outputSchema)}`);
  return lines.join("\n");
}

function summarizeMessages(messages) {
  let modelCalls = 0;
  let toolCalls = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  const byModel = {};
  for (const message of messages ?? []) {
    const type = typeof message?.getType === "function" ? message.getType() : message?._getType?.();
    if (type === "ai") {
      modelCalls += 1;
      const usage = message.usage_metadata ?? null;
      const modelName =
        message.response_metadata?.model_name ?? message.response_metadata?.model ?? "unknown-model";
      const inTok = usage?.input_tokens ?? 0;
      const outTok = usage?.output_tokens ?? 0;
      inputTokens += inTok;
      outputTokens += outTok;
      byModel[modelName] ??= { inputTokens: 0, outputTokens: 0, modelCalls: 0, priced: false };
      byModel[modelName].inputTokens += inTok;
      byModel[modelName].outputTokens += outTok;
      byModel[modelName].modelCalls += 1;
    } else if (type === "tool") {
      toolCalls += 1;
    }
  }
  return { modelCalls, toolCalls, inputTokens, outputTokens, byModel };
}

function lastAiText(messages) {
  for (let index = (messages ?? []).length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    const type = typeof message?.getType === "function" ? message.getType() : message?._getType?.();
    if (type === "ai" && typeof message.content === "string" && message.content.trim())
      return message.content.trim();
  }
  return null;
}

function classifyError(error, { cancelled }) {
  if (cancelled) return { code: "research_cancelled", message: "The run was cancelled." };
  const name = error?.constructor?.name ?? error?.name ?? "";
  const message = error?.message ?? String(error);
  const ceiling = error?.ceiling ?? message.match(/\[research_ceiling:([^\]]+)\]/)?.[1];
  if (ceiling)
    return {
      code: error?.code ?? "research_ceiling_exceeded",
      message: message.replace(/\[research_ceiling:[^\]]+\]\s*/, ""),
      truncatedBy: ceiling,
    };
  if (/ModelCallLimit/i.test(name))
    return { code: "model_call_ceiling_exceeded", message, truncatedBy: "maxModelCalls" };
  if (/GraphRecursionError/i.test(name))
    return { code: "graph_recursion_limit_exceeded", message, truncatedBy: "maxDepth" };
  if (/AbortError/i.test(name) || /aborted/i.test(message)) {
    return {
      code: "research_timeout",
      message: "The run exceeded its runtime ceiling.",
      truncatedBy: "maxRuntimeMs",
    };
  }
  return { code: "model_or_tool_error", message };
}

async function main() {
  // LangSmith activates purely on environment variables (architecture §12). Reporting what
  // actually reached this process — rather than only what the adapter intended to send —
  // is what lets a test prove inactivity from inside the child instead of trusting the
  // parent's construction of the environment.
  const leakedTracingEnv = Object.keys(process.env).filter((key) => /^(LANGSMITH_|LANGCHAIN_)/.test(key));
  sendLog(`langsmith/langchain tracing env vars present in child: ${leakedTracingEnv.length}`);

  const host = await openHostToolChannel();
  const config = host.config;
  const findings = [];
  let hostBudgetState = null;

  // A tool error the model can act on is feedback, not a crash. Throwing it aborts the graph
  // and discards work the model has already done correctly — a malformed locator on an
  // otherwise correct finding used to destroy a run that had already retained the right
  // source. Those errors come back as a tool result the model can read and correct instead.
  //
  // The strike limit is what keeps that from becoming an infinite apology loop: a model that
  // ignores the same correction twice would otherwise spend its whole model-call allowance
  // re-making one mistake, so the second occurrence of a code is terminal after all.
  const toolErrorStrikes = new Map();

  const callHostTool = async (toolName, input) => {
    try {
      const response = await host.invoke(toolName, input);
      if (response.budgetState) hostBudgetState = response.budgetState;
      return response.result;
    } catch (error) {
      if (error?.budgetState) hostBudgetState = error.budgetState;
      const code = error?.code;
      if (code && RECOVERABLE_TOOL_ERROR_CODES.has(code)) {
        const strikes = (toolErrorStrikes.get(code) ?? 0) + 1;
        toolErrorStrikes.set(code, strikes);
        if (strikes <= MAX_RECOVERABLE_STRIKES_PER_CODE) {
          sendLog(`recoverable tool error returned to the model: ${code} (strike ${strikes})`);
          return { error: { code, message: error.message, recoverable: true } };
        }
      }
      throw error;
    }
  };

  const readContextTool = tool(async () => JSON.stringify(await callHostTool("read_context", {})), {
    name: "read_context",
    description:
      "Return the research objective's supplied context references. Each reference is only a {type, id} pair.",
    schema: z.object({}).strict(),
  });

  const webSearchTool = tool(async (input) => JSON.stringify(await callHostTool("web_search", input)), {
    name: "web_search",
    description:
      "Discover public web sources. Search snippets are discovery hints only; fetch a source before citing it.",
    schema: z
      .object({
        query: z.string().min(1).max(500),
        market: z.enum(["NZ", "AU", "US", "GLOBAL"]).optional(),
      })
      .strict(),
  });

  const fetchSourceTool = tool(async (input) => JSON.stringify(await callHostTool("fetch_source", input)), {
    name: "fetch_source",
    description:
      "Ask the host to safely fetch and retain an HTTP/HTTPS source. Returns bounded normalized text and a source id.",
    schema: z.object({ url: z.string().url().max(4_000) }).strict(),
  });

  const readSourceTool = tool(async (input) => JSON.stringify(await callHostTool("read_source", input)), {
    name: "read_source",
    description:
      "Read a bounded range from a source already retained in this run. PDFs require a retained physical page. This never recaptures the source.",
    schema: z
      .object({
        sourceId: z.string().min(1).max(200),
        page: z.number().int().positive().optional(),
        offset: z.number().int().nonnegative().optional(),
        limit: z.number().int().min(1).max(50_000).optional(),
      })
      .strict(),
  });

  const submitFindingTool = tool(
    async (input) => {
      const finding = await callHostTool("submit_finding", input);
      // A recoverable rejection comes back as an error envelope, not a finding. Pushing it
      // would enter an unaccepted claim into the run's evidence.
      if (finding?.error) return JSON.stringify(finding);
      findings.push(finding);
      return JSON.stringify({ findingId: finding.id, accepted: true });
    },
    {
      name: "submit_finding",
      description:
        "Submit one finding with exact excerpts from sources retained by fetch_source. The host verifies every excerpt. " +
        "For evidence from a PDF the locator must be exactly {page: <physical page number>} and nothing else — any " +
        "additional locator field is rejected. For HTML or text evidence the locator must omit `page`.",
      schema: z
        .object({
          claim: z.string().min(1).max(2_000),
          evidence: z
            .array(
              z
                .object({
                  sourceId: z.string().min(1).max(200),
                  excerpt: z.string().min(1).max(2_000),
                  locator: z
                    .object({
                      page: z.number().int().positive().optional(),
                      section: z.string().max(500).optional(),
                      selector: z.string().max(500).optional(),
                      charStart: z.number().int().nonnegative().optional(),
                      charEnd: z.number().int().nonnegative().optional(),
                    })
                    .strict()
                    .optional(),
                  authority: z.enum(["primary", "secondary", "unknown"]).optional(),
                })
                .strict(),
            )
            .min(1)
            .max(10),
          confidence: z.number().min(0).max(1).optional(),
          assumptions: z.array(z.string().max(500)).max(10).optional(),
        })
        .strict(),
    },
  );

  const model = await buildModel(config.model);
  const checkpointer = SqliteSaver.fromConnString(config.checkpoint.dbPath);
  const threadConfig = { configurable: { thread_id: config.checkpoint.threadId } };

  const agent = createDeepAgent({
    model,
    systemPrompt:
      "You are a bounded, single-agent research worker running behind the Eversor research runtime.",
    tools: [readContextTool, webSearchTool, fetchSourceTool, readSourceTool, submitFindingTool],
    backend: new StateBackend(),
    checkpointer,
    middleware: [
      // Belt and braces even with zero subagents configured: `deepagents` admits a working
      // general-purpose subagent by default unless this is explicit (G3 D2).
      createSubAgentMiddleware({ generalPurposeAgent: false, subagents: [] }),
      modelCallLimitMiddleware({ runLimit: config.budget.maxModelCalls, exitBehavior: "error" }),
    ],
  });

  let cancelled = false;
  const operatorAbort = new AbortController();
  const onSignal = () => {
    cancelled = true;
    operatorAbort.abort(new Error("Research run cancelled."));
  };
  process.on("SIGTERM", onSignal);
  process.on("SIGINT", onSignal);
  const signal = AbortSignal.any([operatorAbort.signal, AbortSignal.timeout(config.budget.maxRuntimeMs)]);

  sendEvent("phase.started", { phase: "investigate" });

  let errorInfo = null;
  try {
    await agent.invoke(
      { messages: [{ role: "user", content: buildPrompt(config) }] },
      {
        ...threadConfig,
        recursionLimit: graphRecursionLimitForBudget(config.budget),
        signal,
        durability: "sync",
      },
    );
  } catch (error) {
    errorInfo = classifyError(error, { cancelled });
  } finally {
    process.off("SIGTERM", onSignal);
    process.off("SIGINT", onSignal);
  }

  let messages = [];
  try {
    const state = await agent.getState(threadConfig);
    messages = state?.values?.messages ?? [];
  } catch (error) {
    sendLog(`Could not read back checkpoint state: ${error?.message ?? error}`);
  }

  const summary = summarizeMessages(messages);
  const usage = {
    modelCalls: summary.modelCalls,
    toolCalls: hostBudgetState?.toolCallsUsed ?? summary.toolCalls,
    searchCalls: hostBudgetState?.searchCallsUsed ?? 0,
    inputTokens: summary.inputTokens,
    outputTokens: summary.outputTokens,
    byModel: summary.byModel,
    partial: Boolean(errorInfo),
  };
  sendUsage(usage, {
    modelCallsUsed: summary.modelCalls,
    toolCallsUsed: hostBudgetState?.toolCallsUsed ?? summary.toolCalls,
    searchCallsUsed: hostBudgetState?.searchCallsUsed ?? 0,
    researchersStarted: findings.length ? 1 : 0,
    elapsedMs: hostBudgetState?.elapsedMs ?? Date.now() - startedAtMs,
    ...(errorInfo?.truncatedBy ? { ceilingHit: errorInfo.truncatedBy } : {}),
  });

  sendEvent("phase.completed", { phase: "investigate" });
  if (errorInfo?.truncatedBy) sendEvent("budget.ceiling_hit", { ceiling: errorInfo.truncatedBy });

  if (errorInfo) sendError(errorInfo);

  sendResult({
    runId: config.runId,
    ...(lastAiText(messages) ? { summary: lastAiText(messages) } : {}),
    findings,
    artifacts: findings.length
      ? [{ id: "brief", kind: "research-brief", name: "Research brief", contentRef: "inline:brief" }]
      : [],
    usage,
    ...(findings.length === 0
      ? { unresolvedQuestions: ["No finding was submitted before the run ended."] }
      : {}),
    ...(errorInfo?.truncatedBy ? { truncatedBy: errorInfo.truncatedBy } : {}),
  });
  host.close();
}

// Only when spawned as the child entrypoint. Importing this module — which a constructor test
// does, because this is the one file allowed to import a chat-model integration — must not
// start a graph or read stdin.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main()
    .then(() => {
      process.exitCode = 0;
    })
    .catch((error) => {
      // A structural failure — bad config, a model/checkpoint that could not even be
      // constructed — before any graph ever ran. Nothing partial to preserve.
      sendError({ code: "worker_startup_failed", message: error?.message ?? String(error) });
      process.stdin.destroy();
      process.exitCode = 1;
    });
}
