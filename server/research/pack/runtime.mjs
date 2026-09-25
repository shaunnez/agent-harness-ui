// The `pack` research runtime: GPT-6 Luna retrieves, the host checks, Claude Opus reasons.
//
// One run, three steps, behind the same runtime contract as `claude-cli` and `codex-cli`, so a
// question, its agreement rule, its citation checks and the UI cannot tell it apart
// (`28-SCOPE-PACK-EVAL-PLAN.md` §2):
//
// 1. Retrieve. Luna, on the ChatGPT plan through `codex exec`, with the QV tools, web search and
//    the host's `fetch_source`/`read_source`. It returns an evidence pack, not a band.
// 2. Check. The host checks every item with the code that checks a final answer, against the
//    rows and pages this run retained. Only items that check out go forward.
// 3. Reason. Opus, on the Claude subscription, given the objective (with its pinned scope) and
//    the checked pack, with one tool: `request_evidence`, at most twice, each answered by a short
//    Luna retrieval into the same session and checked before it is returned. Its answer is the
//    existing cost-band fence, checked as every run's is.
//
// Why: about 85% of a single-agent run's cost is retrieved context re-read on every turn. Here
// the expensive model reads a compact, already-checked pack once. Whether that holds agreement
// is the eval's question, not this file's.
//
// Usage is the sum of every call, by model. Codex's share is an API-rate estimate; the Claude
// CLI prices its own. Neither is a charge: both run on the operator's plans.

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertSupportedReasoning } from "../../model-catalog.mjs";
import { assertSubscriptionAuth } from "../claude-cli/auth.mjs";
import { buildClaudeEnvironment, classifyCall, runClaudeCall } from "../claude-cli/cli-call.mjs";
import { DEFAULT_CLAUDE_CLI_MODEL, EMPTY_OUTPUT_ERROR_CODE } from "../claude-cli/driver.mjs";
import { HOST_TOOL_SERVER_NAME } from "../claude-cli/host-tools/definitions.mjs";
import { HOST_TOOL_RELAY_PATH } from "../claude-cli/qv-recipe.mjs";
import { ClaudeCliResearchRuntime } from "../claude-cli/runtime.mjs";
import { assertChatGptAuth } from "../codex-cli/auth.mjs";
import { classifyCodexCall, runCodexCall } from "../codex-cli/codex-call.mjs";
import { checkedPack, packText, parseEvidencePack } from "./evidence-pack.mjs";

export const PACK_RESEARCH_RUNTIME_ID = "pack";
export const DEFAULT_PACK_RETRIEVE_MODEL = "gpt-6-luna";
export const DEFAULT_PACK_RETRIEVE_REASONING = "high";
export const MAX_EVIDENCE_REQUESTS = 2;

const REQUEST_EVIDENCE = "request_evidence";
const REASON_ALLOWED_TOOLS = [`mcp__${HOST_TOOL_SERVER_NAME}__${REQUEST_EVIDENCE}`];
const DEFAULT_STAGE_TIMEOUT_MS = 15 * 60_000;
const REQUEST_TIMEOUT_MS = 6 * 60_000;

export const PACK_REASON_PROMPT_PATH = fileURLToPath(new URL("./reason-prompt.txt", import.meta.url));
export const PACK_RETRIEVE_PROMPT_PATH = fileURLToPath(new URL("./retrieve-prompt.txt", import.meta.url));

export function packDriver({ retrieveModel = null, retrieveReasoning = null } = {}) {
  const retrieval = (env) => ({
    model: retrieveModel ?? env?.RESEARCH_PACK_RETRIEVE_MODEL ?? DEFAULT_PACK_RETRIEVE_MODEL,
    reasoning: retrieveReasoning ?? env?.RESEARCH_PACK_RETRIEVE_REASONING ?? DEFAULT_PACK_RETRIEVE_REASONING,
  });
  return Object.freeze({
    label: "Pack (Luna retrieves, Opus reasons)",
    transcript: { kind: "pack-transcript", name: "Retrieval and reasoning transcripts (JSON lines)" },
    emptyOutputCode: EMPTY_OUTPUT_ERROR_CODE,
    lateTools: [REQUEST_EVIDENCE],
    /** Both plans, each proved: ChatGPT for retrieval, the Claude subscription for reasoning. */
    async assertAuth({ binary = null, run } = {}) {
      const codex = await assertChatGptAuth({ binary: binary?.codex ?? null, ...(run ? { run } : {}) });
      const claude = await assertSubscriptionAuth({
        binary: binary?.claude ?? null,
        ...(run ? { run } : {}),
      });
      return { binary: { codex: codex.binary, claude: claude.binary } };
    },
    defaultModel: (env) => env.RESEARCH_PACK_REASON_MODEL ?? DEFAULT_CLAUDE_CLI_MODEL,
    metadata: ({ model, reasoning, allowedTools, env }) => ({
      cliModel: model,
      ...(reasoning ? { effort: reasoning } : {}),
      retrieveModel: retrieval(env).model,
      retrieveReasoning: retrieval(env).reasoning,
      allowedTools: allowedTools.join(","),
      reasonAllowedTools: REASON_ALLOWED_TOOLS.join(","),
      costBasis: "claude_cli_cost_plus_codex_api_rate_estimate",
    }),
    call: (options) => runPack({ ...options, retrieval: retrieval(options.env) }),
    classify: (call) =>
      call.verdict ??
      (call.spawnError
        ? {
            ok: false,
            error: { code: "pack_failed", message: call.spawnError.message ?? String(call.spawnError) },
          }
        : { ok: false, error: { code: "pack_failed", message: "The pack run ended without a verdict." } }),
  });
}

async function runPack({
  run,
  binary,
  env,
  workingDirectory,
  objective,
  model,
  reasoning,
  systemPrompt,
  mcpConfig,
  allowedTools,
  budget,
  signal,
  session,
  checkComponents,
  emit = () => {},
  onCeiling = () => {},
  onEvent = () => {},
  onRawLine = () => {},
  retrieval,
}) {
  if (!session) throw new Error("The pack runtime needs a host tool session.");
  const retrievePrompt = await readFile(PACK_RETRIEVE_PROMPT_PATH, "utf8");
  const calls = [];
  const stageTimeout = Math.min(budget?.maxRuntimeMs ?? DEFAULT_STAGE_TIMEOUT_MS, DEFAULT_STAGE_TIMEOUT_MS);
  const stage = (name) => onRawLine(JSON.stringify({ type: "pack.stage", stage: name }));

  /** One Luna retrieval, checked. Returns the checked pack, or a failed verdict. */
  const retrieve = async (prompt, timeoutMs) => {
    const call = await runCodexCall({
      run,
      binary: binary.codex,
      env,
      cwd: workingDirectory,
      objective: prompt,
      model: retrieval.model,
      reasoning: retrieval.reasoning,
      systemPrompt: retrievePrompt,
      mcpConfig,
      allowedTools,
      timeoutMs,
      signal,
      ceilings: budget ?? null,
      onCeiling,
      // The retrieval's own "final answer" is a pack, not a finding; it is logged, not recorded.
      onEvent: (type, data) => onEvent(type === "finding.created" ? "log" : type, data),
      onRawLine,
    });
    calls.push({ stage: "retrieve", model: retrieval.model, call });
    const verdict = classifyCodexCall(call);
    if (!verdict.ok) return { verdict };
    const pack = parseEvidencePack(call.finalText);
    if (!pack)
      return {
        verdict: {
          ok: false,
          error: { code: "pack_retrieval_empty", message: "The retrieval stage returned no evidence pack." },
        },
      };
    const checked = await checkComponents(pack.items);
    return { pack: checkedPack(pack, checked, checked.rows) };
  };

  stage("retrieve");
  emit("log", { message: `Retrieving evidence with ${retrieval.model} (${retrieval.reasoning}).` });
  const first = await retrieve(objective, stageTimeout);
  if (first.verdict) return combine(calls, { verdict: stageFailure("Retrieval", first.verdict) });
  let numbered = first.pack.kept.length;
  emit("log", { message: packSummary("Evidence pack", first.pack) });

  let requests = 0;
  // Answered one at a time: Opus may send two requests at once, and each needs the evidence
  // numbering the previous one left, and its own retrieval rather than two racing on one session.
  let queue = Promise.resolve();
  const answer = async (input) => {
    const query = String(input?.query ?? "").trim();
    const why = String(input?.why ?? "").trim();
    if (!query) return { refused: "Say what evidence is needed in `query`." };
    if (requests >= MAX_EVIDENCE_REQUESTS)
      return {
        refused: `The limit of ${MAX_EVIDENCE_REQUESTS} evidence requests is reached. Price from the evidence you have.`,
      };
    requests += 1;
    const ordinal = requests;
    emit("log", { message: `Evidence request ${ordinal}: ${query}` });
    stage(`request-${ordinal}`);
    const more = await retrieve(
      `${objective}\n\nFOCUSED REQUEST from the pricing stage. Find only this, not the whole scope.\nNeeded: ${query}\nWhy: ${why || "not stated"}`,
      REQUEST_TIMEOUT_MS,
    );
    if (more.verdict) return { refused: `The retrieval failed: ${more.verdict.error.message}` };
    emit("log", { message: packSummary(`Evidence request ${ordinal}`, more.pack) });
    const text = packText(more.pack, {
      startAt: numbered + 1,
      heading: "MORE EVIDENCE (checked by the host)",
    });
    numbered += more.pack.kept.length;
    return { evidence: text };
  };
  session.setHandler(REQUEST_EVIDENCE, (input) => {
    const next = queue.then(() => answer(input));
    queue = next.catch(() => undefined);
    return next;
  });

  stage("reason");
  emit("log", {
    message: `Pricing from the checked pack with ${model}${reasoning ? ` (${reasoning})` : ""}.`,
  });
  const mcpConfigPath = path.join(workingDirectory, "reason-mcp.json");
  const entry = session.entryFor([REQUEST_EVIDENCE]);
  await writeFile(
    mcpConfigPath,
    JSON.stringify({
      mcpServers: {
        [HOST_TOOL_SERVER_NAME]: {
          command: entry.nodeBin,
          args: [entry.relayPath ?? HOST_TOOL_RELAY_PATH, entry.socketPath, entry.tools.join(",")],
        },
      },
    }),
    "utf8",
  );
  const reasoningCall = await runClaudeCall({
    run,
    binary: binary.claude,
    env: buildClaudeEnvironment(env, workingDirectory),
    cwd: workingDirectory,
    objective: `${objective}\n\n${packText(first.pack)}`,
    model,
    systemPrompt,
    mcpConfigPath,
    allowedTools: REASON_ALLOWED_TOOLS,
    effort: reasoning ? assertSupportedReasoning(model, reasoning) : null,
    maxUsd: budget?.maxUsd ?? null,
    timeoutMs: stageTimeout,
    signal,
    ceilings: budget ?? null,
    onCeiling,
    onEvent,
    onRawLine,
  });
  calls.push({ stage: "reason", model, call: reasoningCall });
  const verdict = classifyCall(reasoningCall, { emptyOutputCode: EMPTY_OUTPUT_ERROR_CODE });
  return combine(calls, {
    verdict: verdict.ok ? verdict : stageFailure("Reasoning", verdict),
    finalText: reasoningCall.finalText,
    resultLine: reasoningCall.resultLine,
    pack: { items: first.pack.kept.length, rejected: first.pack.rejected.length, evidenceRequests: requests },
  });
}

/** One call-shaped result for the runtime: the verdict, the final text, and every call's usage. */
function combine(calls, { verdict, finalText = "", resultLine = null, pack = null }) {
  return {
    verdict,
    finalText,
    resultLine,
    pack,
    toolCallCount: calls.reduce((sum, entry) => sum + (entry.call.toolCallCount ?? 0), 0),
    searchCallCount: calls.reduce((sum, entry) => sum + (entry.call.searchCallCount ?? 0), 0),
    sawCeiling: calls.some((entry) => entry.call.sawCeiling),
    usage: sumUsage(calls),
  };
}

/** Every call's usage, added, with a per-stage breakdown. A Claude call's `estimatedCostUsd` is
 *  the CLI's own figure; a Codex call's is priced from the rate card. */
export function sumUsage(calls) {
  const usage = {
    inputTokens: 0,
    outputTokens: 0,
    cachedTokens: 0,
    modelCalls: 0,
    toolCalls: 0,
    searchCalls: 0,
    estimatedCostUsd: 0,
    costBasis: "claude_cli_cost_plus_codex_api_rate_estimate",
    partial: false,
    byModel: {},
    byStage: [],
  };
  for (const { stage, model, call } of calls) {
    const part = call.usage ?? null;
    usage.byStage.push({
      stage,
      model,
      inputTokens: part?.inputTokens ?? 0,
      outputTokens: part?.outputTokens ?? 0,
      cachedTokens: part?.cachedTokens ?? 0,
      estimatedCostUsd: part?.estimatedCostUsd ?? null,
    });
    if (!part) {
      usage.partial = true;
      continue;
    }
    for (const field of [
      "inputTokens",
      "outputTokens",
      "cachedTokens",
      "modelCalls",
      "toolCalls",
      "searchCalls",
    ])
      usage[field] += Number(part[field] ?? 0);
    usage.estimatedCostUsd += Number(part.estimatedCostUsd ?? 0);
    for (const [name, entry] of Object.entries(part.byModel ?? {})) {
      usage.byModel[name] ??= { inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0, priced: true };
      const total = usage.byModel[name];
      total.inputTokens += Number(entry.inputTokens ?? 0);
      total.outputTokens += Number(entry.outputTokens ?? 0);
      total.estimatedCostUsd += Number(entry.estimatedCostUsd ?? 0);
      total.priced &&= entry.priced !== false;
    }
  }
  usage.estimatedCostUsd = Math.round(usage.estimatedCostUsd * 1e6) / 1e6;
  return usage;
}

function stageFailure(stage, verdict) {
  return { ...verdict, error: { ...verdict.error, message: `${stage}: ${verdict.error.message}` } };
}

function packSummary(label, pack) {
  const rows = pack.kept.filter((item) => item.check === "qv-found").length;
  const quotes = pack.kept.length - rows;
  return `${label}: ${pack.kept.length} checked (${rows} QV rows, ${quotes} web quotes), ${pack.rejected.length} rejected, ${pack.notFound.length} not found.`;
}

export class PackResearchRuntime extends ClaudeCliResearchRuntime {
  constructor({ retrieveModel = null, retrieveReasoning = null, ...options } = {}) {
    super({
      id: PACK_RESEARCH_RUNTIME_ID,
      systemPromptPath: PACK_REASON_PROMPT_PATH,
      ...options,
      driver: packDriver({ retrieveModel, retrieveReasoning }),
    });
  }
}
