#!/usr/bin/env node
// CHILD ENTRYPOINT. The only file in the repository permitted to import `deepagents`,
// `langchain`, `@langchain/*` or `langsmith` (architecture §5.4). Spawned by `adapter.mjs`
// with its research request on stdin; writes one NDJSON message per line to stdout
// (`event-protocol.mjs`) and nothing else — any stray `console.log` from here or a dependency
// would corrupt that stream, so diagnostics that are not a protocol message go to stderr.
//
// One Deep Agents agent. No subagents, no web search, no RAG (non-goals, task §"Non-goals").
// `createSubAgentMiddleware({ generalPurposeAgent: false, subagents: [] })` is still present
// and deliberate: `deepagents` adds a working general-purpose subagent automatically even when
// no `subagents` option is given at all (G3 D2), and "no general-purpose subagent" is a
// stated security requirement, not an incidental one.

import process from "node:process";
import { z } from "zod";
import { ChatAnthropic } from "@langchain/anthropic";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { AIMessage } from "@langchain/core/messages";
import { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";
import { ChatOpenAI } from "@langchain/openai";
import { createDeepAgent, createSubAgentMiddleware, StateBackend } from "deepagents";
import { modelCallLimitMiddleware, tool, toolCallLimitMiddleware } from "langchain";
import { encodeWorkerMessage } from "./event-protocol.mjs";

const startedAtMs = Date.now();

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

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

/** No API key, no network, no provider package. Deterministic so tests need neither a
 *  credential nor a live model to prove the runtime plumbing (task §5: "prove runtime
 *  plumbing", not sophisticated prompting). One synthetic finding, then a final answer. */
class FakeToolCallingModel extends BaseChatModel {
  constructor({ label = "fake-research-model", delayMs = 0, misbehavior = null } = {}) {
    super({});
    this.label = label;
    this.delayMs = delayMs;
    this.misbehavior = misbehavior;
    this.calls = 0;
    this.submittedFinding = false;
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
  async _generate() {
    if (this.delayMs) await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    this.calls += 1;
    const usage_metadata = { input_tokens: 120, output_tokens: 40, total_tokens: 160 };
    const response_metadata = { model_name: this.label };
    let message;
    if (this.misbehavior === "general_purpose_subagent" && this.calls === 1) {
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
    } else if (this.misbehavior === "invalid_finding" && this.calls === 1) {
      // Deliberately fails `submitFindingTool`'s zod schema (`claim` must be a non-empty
      // string): proves a malformed tool call is rejected at the tool boundary rather than
      // crashing the graph (task §11.5), and that the model can recover afterwards.
      message = new AIMessage({
        content: "",
        tool_calls: [{ name: "submit_finding", args: { claim: 12345 }, id: "fake-bad-1", type: "tool_call" }],
        usage_metadata,
        response_metadata,
      });
    } else if (!this.submittedFinding) {
      this.submittedFinding = true;
      message = new AIMessage({
        content: "",
        tool_calls: [
          {
            name: "submit_finding",
            args: {
              claim:
                "The Deep Agents runtime executed one model call and one tool call behind the Eversor boundary.",
              confidence: 0.6,
              assumptions: ["Synthetic finding produced by the slice-2 proof-of-plumbing agent."],
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

async function buildModel(modelConfig) {
  if (modelConfig.provider === "anthropic") {
    const apiKey = process.env[modelConfig.apiKeyEnvVar];
    if (!apiKey)
      throw new Error(
        `Anthropic model requested but ${modelConfig.apiKeyEnvVar} was not provided to the child.`,
      );
    return new ChatAnthropic({ model: modelConfig.model, apiKey });
  }
  if (modelConfig.provider === "openai-compatible") {
    const apiKey = process.env[modelConfig.apiKeyEnvVar];
    if (!apiKey)
      throw new Error(
        `OpenAI-compatible model requested but ${modelConfig.apiKeyEnvVar} was not provided to the child.`,
      );
    return new ChatOpenAI({
      model: modelConfig.model,
      apiKey,
      configuration: { baseURL: modelConfig.baseURL },
    });
  }
  return new FakeToolCallingModel({
    label: modelConfig.model,
    delayMs: Number(modelConfig.fakeDelayMs ?? 0),
    misbehavior: modelConfig.fakeMisbehavior ?? null,
  });
}

function buildPrompt(config) {
  const lines = [
    `Research objective: ${config.objective}`,
    "",
    "You are the sole research agent for this run. There are no other agents to delegate to, " +
      "and no web search or document retrieval tools exist yet — call read_context to see the " +
      "supplied context references, then call submit_finding one or more times to record what " +
      "you conclude, then give a short final answer.",
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

  const config = JSON.parse(await readStdin());
  const findings = [];

  const readContextTool = tool(
    async () => {
      sendEvent("tool.called", { tool: "read_context" });
      return JSON.stringify(config.context ?? []);
    },
    {
      name: "read_context",
      description:
        "Return the research objective's supplied context references. There is no content " +
        "fetching or RAG yet — each reference is only a {type, id} pair.",
      schema: z.object({}).strict(),
    },
  );

  const submitFindingTool = tool(
    async (input) => {
      sendEvent("tool.called", { tool: "submit_finding" });
      const findingId = `${config.runId}-F${findings.length + 1}`;
      findings.push({
        id: findingId,
        claim: input.claim,
        producedBy: "researcher",
        evidence: [],
        ...(input.confidence == null ? {} : { confidence: input.confidence }),
        ...(input.assumptions?.length ? { assumptions: input.assumptions } : {}),
      });
      sendEvent("finding.created", { findingId });
      return `Recorded finding ${findingId}.`;
    },
    {
      name: "submit_finding",
      description:
        "Submit one research finding. There is no fetch_source tool yet, so a finding carries " +
        "no cited evidence in this slice — evidence.length is legitimately 0.",
      schema: z.object({
        claim: z.string().min(1).max(2_000),
        confidence: z.number().min(0).max(1).optional(),
        assumptions: z.array(z.string().max(500)).max(10).optional(),
      }),
    },
  );

  const model = await buildModel(config.model);
  const checkpointer = SqliteSaver.fromConnString(config.checkpoint.dbPath);
  const threadConfig = { configurable: { thread_id: config.checkpoint.threadId } };

  const agent = createDeepAgent({
    model,
    systemPrompt:
      "You are a bounded, single-agent research worker running behind the Eversor research runtime.",
    tools: [readContextTool, submitFindingTool],
    backend: new StateBackend(),
    checkpointer,
    middleware: [
      // Belt and braces even with zero subagents configured: `deepagents` admits a working
      // general-purpose subagent by default unless this is explicit (G3 D2).
      createSubAgentMiddleware({ generalPurposeAgent: false, subagents: [] }),
      modelCallLimitMiddleware({ runLimit: config.budget.maxModelCalls, exitBehavior: "error" }),
      toolCallLimitMiddleware({
        toolName: "read_context",
        runLimit: config.budget.maxToolCalls,
        exitBehavior: "continue",
      }),
      toolCallLimitMiddleware({
        toolName: "submit_finding",
        runLimit: config.budget.maxToolCalls,
        exitBehavior: "continue",
      }),
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
      { ...threadConfig, recursionLimit: 25, signal, durability: "sync" },
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
    toolCalls: summary.toolCalls,
    inputTokens: summary.inputTokens,
    outputTokens: summary.outputTokens,
    byModel: summary.byModel,
    partial: Boolean(errorInfo),
  };
  sendUsage(usage, {
    modelCallsUsed: summary.modelCalls,
    toolCallsUsed: summary.toolCalls,
    searchCallsUsed: 0,
    researchersStarted: findings.length ? 1 : 0,
    elapsedMs: Date.now() - startedAtMs,
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
}

main()
  .then(() => {
    process.exitCode = 0;
  })
  .catch((error) => {
    // A structural failure — bad config, a model/checkpoint that could not even be
    // constructed — before any graph ever ran. Nothing partial to preserve.
    sendError({ code: "worker_startup_failed", message: error?.message ?? String(error) });
    process.exitCode = 1;
  });
