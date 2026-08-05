import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import {
  assertSupportedReasoning,
  costDivergence,
  NO_REASONING_EFFORT,
  priceModelUsage,
  priceUsage,
  providerForModelId,
  providerRuntimeDefaults,
  readClaudeModelCatalog,
} from "./model-catalog.mjs";
import {
  conciseToolResult,
  formatCommand,
  runProcess,
} from "./process-runtime.mjs";

/**
 * Claude Code `--output-format stream-json` parsing.
 *
 * The wire format is a Claude Code session stream, not Codex's
 * `thread.started`/`item.*`/`turn.completed` schema, so this is a genuinely
 * different parser producing the same internal event shape. `run-activity.mjs`,
 * the UI and `candidateVerificationCommandFailed` see exactly the event types
 * they see today — Bash deliberately reuses Codex's `command_execution` /
 * `repository-command` identity so no consumer needs to know which provider ran.
 *
 * Every rule below is pinned to recorded CLI output in
 * `tests/fixtures/claude-cli/`, not to the documentation:
 *
 * - Correlation is by `tool_use_id` only. Results arrive out of order: in the
 *   fixture two parallel Bash calls complete second-then-first.
 * - Success is `is_error !== true`, never `is_error === false`. A successful Bash
 *   result carries `is_error: false`; a successful `Read` result omits the field.
 * - `Exit code N` cannot classify *why* a command failed — a seatbelt-denied write
 *   carries the same prefix, because the shell itself exits non-zero when the
 *   syscall is refused. The prefix populates `toolCall.result` and nothing else;
 *   policy problems are detected out of band via `permission_denials`.
 * - Unknown top-level types and unknown `system` subtypes are tolerated.
 *   `rate_limit_event`, `system/post_turn_summary` and `system/thinking_tokens`
 *   all appear in recorded runs and none were documented.
 * - `usage.iterations` is diagnostic only and does not reconcile with the totals.
 *   It is never summed.
 */

export const CLAUDE_RUN_LABEL = "Claude";

/**
 * Environment variables that must never reach a spawned Claude CLI.
 *
 * The constraint is that both providers use their existing local CLI session and no
 * API keys. Excluding these at the allowlist means a stray environment variable
 * cannot silently move execution off the operator's plan onto metered API billing,
 * or point the CLI at a different endpoint entirely. This is enforced by
 * construction — `buildClaudeEnvironment` builds up from an allowlist rather than
 * deleting from `process.env` — and the denylist exists so the guarantee can be
 * asserted directly rather than inferred from the absence of a name.
 */
export const CLAUDE_ENV_DENYLIST = Object.freeze([
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_BASE_URL",
]);

const CLAUDE_ENV_ALLOWLIST = [
  "PATH",
  "PATHEXT",
  "SYSTEMROOT",
  "WINDIR",
  "COMSPEC",
  "HOME",
  "USER",
  "LOGNAME",
  "SHELL",
  "USERPROFILE",
  "HOMEDRIVE",
  "HOMEPATH",
  "APPDATA",
  "LOCALAPPDATA",
  // The OAuth profile lives under HOME unless the operator relocated it.
  "CLAUDE_CONFIG_DIR",
  "CLAUDE_BIN",
  "LANG",
  "LC_ALL",
  "TERM",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
];

const FALLBACK_PATH = process.platform === "win32"
  ? "C:\\Windows\\System32"
  : "/usr/local/bin:/usr/bin:/bin";

/**
 * Build the child environment for a Claude spawn. A new function beside
 * `buildCodexEnvironment` rather than a shared one: the two providers need
 * different variables (HOME and the OAuth profile here, CODEX_HOME there) and
 * different exclusions, and collapsing them would couple two security-relevant
 * allowlists that should be able to diverge.
 */
export function buildClaudeEnvironment(source, runtimeTemp) {
  const entries = Object.entries(source ?? {});
  const environment = {};
  for (const name of CLAUDE_ENV_ALLOWLIST) {
    const entry = entries.find(([key]) => key.toUpperCase() === name);
    if (entry?.[1] != null && entry[1] !== "") environment[entry[0]] = entry[1];
  }
  // The CLI cannot resolve its own helpers or a shell without these, so they are
  // guaranteed rather than merely allowed through.
  if (!environment.PATH) environment.PATH = FALLBACK_PATH;
  if (!environment.HOME && !environment.USERPROFILE) environment.HOME = os.homedir();
  if (!environment.USER && !environment.USERNAME) {
    environment.USER = os.userInfo?.().username ?? "agent";
  }
  environment.TEMP = runtimeTemp;
  environment.TMP = runtimeTemp;
  environment.TMPDIR = runtimeTemp;
  for (const name of CLAUDE_ENV_DENYLIST) {
    // Belt and braces: the allowlist above already cannot admit these, and this
    // makes a future allowlist edit unable to reintroduce them silently.
    delete environment[name];
  }
  return environment;
}

export async function locateClaude() {
  if (process.env.CLAUDE_BIN) return process.env.CLAUDE_BIN;
  const command = process.platform === "win32" ? "where.exe" : "which";
  const result = await runProcess(command, ["claude"], { timeoutMs: 5_000, label: CLAUDE_RUN_LABEL });
  return result.stdout.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? null;
}

/**
 * Probe the local Claude CLI.
 *
 * `claude auth status --json` is a good fast-path hint and a bad authority: when
 * credentials arrive from the process environment rather than a stored profile it
 * reports `{"loggedIn": false}` for a CLI that is in fact usable. So this reports
 * what it observed and leaves `executionEnabled` false — the authoritative
 * execution signal is the status-time sandbox canary, which has to run anyway.
 */
export async function getClaudeStatus({ canary = false } = {}) {
  try {
    const binary = await locateClaude();
    if (!binary) {
      return {
        id: "claude",
        label: "Claude",
        available: false,
        authenticated: false,
        executionEnabled: false,
        authMethod: null,
        binary: null,
        detail: "Not found",
      };
    }
    const status = await runProcess(binary, ["auth", "status", "--json"], {
      timeoutMs: 10_000,
      label: CLAUDE_RUN_LABEL,
    });
    const probe = readClaudeAuthProbe(status);
    // The canary is the authoritative execution signal, not the auth probe. It is
    // opt-in here because it costs a real CLI run: the orchestrator requires it
    // before every Claude stage anyway, cached, so a status view that has not paid
    // for one reports "not yet verified" instead of guessing.
    const confinement = canary ? await runClaudeSandboxCanary() : null;
    return {
      id: "claude",
      label: "Claude",
      available: true,
      authenticated: probe.authenticated,
      executionEnabled: Boolean(probe.authenticated && confinement?.passed),
      authMethod: probe.authMethod,
      binary,
      confinement,
      detail: !probe.authenticated
        ? "Login required"
        : confinement?.passed
          ? `${probe.authMethod ?? "Signed in"}; read-only confinement verified`
          : confinement
            ? `${probe.authMethod ?? "Signed in"}; ${confinement.detail}`
            : `${probe.authMethod ?? "Signed in"}; read-only confinement not yet verified`,
    };
  } catch (error) {
    return {
      id: "claude",
      label: "Claude",
      available: false,
      authenticated: false,
      executionEnabled: false,
      authMethod: null,
      binary: null,
      detail: error instanceof Error ? error.message : "Not found",
    };
  }
}

export function readClaudeAuthProbe(status) {
  try {
    const parsed = JSON.parse(status?.stdout ?? "");
    const subscription = typeof parsed?.subscriptionType === "string" ? parsed.subscriptionType : null;
    return {
      authenticated: Boolean(parsed?.loggedIn),
      authMethod: [parsed?.authMethod, subscription].filter(Boolean).join(" · ") || null,
    };
  } catch {
    const text = `${status?.stdout ?? ""}\n${status?.stderr ?? ""}`;
    return {
      authenticated: status?.code === 0 && /logged.?in|authenticated/i.test(text),
      authMethod: null,
    };
  }
}

/** Anthropic reports `input_tokens` as the uncached remainder; Codex reports it inclusive. */
export function claudeUsageFromResult(usage) {
  const input = finite(usage?.input_tokens);
  const cachedInputTokens = finite(usage?.cache_read_input_tokens);
  const cacheWriteTokens = finite(usage?.cache_creation_input_tokens);
  const outputTokens = finite(usage?.output_tokens);
  const inputTokens = input + cachedInputTokens + cacheWriteTokens;
  return {
    inputTokens,
    cachedInputTokens,
    cacheWriteTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
  };
}

/**
 * A stateful line parser. Correlating a `tool_result` back to its `tool_use`
 * requires the pending map, so this cannot be a pure per-line function the way
 * `parseCodexEvent` is. `parse` returns zero or more internal events, because one
 * assistant message may carry several content blocks.
 */
export function createClaudeStreamParser() {
  const pending = new Map();
  const state = {
    sessionId: null,
    finalText: "",
    lastAssistantText: "",
    usage: null,
    modelUsage: null,
    totalCostUsd: null,
    rateLimitInfo: null,
    permissionDenials: [],
    resultSubtype: null,
    resultIsError: false,
    sawResult: false,
    // A result whose tool_use never got a tool_result. Diagnostic only: a truncated
    // stream must not be reported as a failed verification command.
    unmatchedToolResults: 0,
    // Bash results whose body is the CLI's own "could not start a shell" text. Counted,
    // never retained: the body stays discarded like every other tool result.
    shellStartFailures: 0,
  };

  function parse(line) {
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      return [];
    }
    if (!event || typeof event !== "object") return [];

    switch (event.type) {
      case "system":
        return parseSystem(event);
      case "rate_limit_event":
        return parseRateLimit(event);
      case "assistant":
        return parseAssistant(event);
      case "user":
        return parseUser(event);
      case "result":
        return parseResult(event);
      default:
        return [];
    }
  }

  function parseSystem(event) {
    if (event.subtype !== "init") return [];
    state.sessionId = event.session_id ?? null;
    return [{
      type: "activity",
      tone: "info",
      title: "Agent session started",
      detail: event.session_id ?? "Claude session created",
    }];
  }

  function parseRateLimit(event) {
    const info = event.rate_limit_info;
    if (!info || typeof info !== "object") return [];
    state.rateLimitInfo = info;
    const allowed = info.status === "allowed";
    return [{
      type: "activity",
      tone: allowed ? "info" : "warning",
      title: allowed ? "Plan allocation available" : "Plan allocation limited",
      detail: [info.rateLimitType, info.status, info.isUsingOverage ? "using overage" : null]
        .filter(Boolean)
        .join(" · "),
    }];
  }

  function parseAssistant(event) {
    const blocks = Array.isArray(event.message?.content) ? event.message.content : [];
    const events = [];
    for (const block of blocks) {
      if (block?.type === "text") {
        const text = String(block.text ?? "").trim();
        if (text) state.lastAssistantText = text;
        continue;
      }
      // Reasoning is dropped: Codex never surfaced it either.
      if (block?.type !== "tool_use") continue;
      const started = startToolCall(block);
      if (started) events.push(started);
    }
    return events;
  }

  function startToolCall(block) {
    const name = String(block.name ?? "").trim();
    if (!name) return null;
    const id = block.id ?? null;
    const input = block.input && typeof block.input === "object" ? block.input : {};

    if (name === "Bash") {
      const detail = formatCommand(input.command);
      const entry = { kind: "bash", name: "command_execution", category: "repository-command", server: null, detail };
      if (id) pending.set(id, entry);
      return {
        type: "activity",
        tone: "info",
        title: "Inspecting repository",
        detail,
        toolCall: { id, name: "command_execution", category: "repository-command", phase: "started", result: null },
      };
    }

    const mcp = parseMcpToolName(name);
    const toolName = mcp ? mcp.tool : name;
    const category = mcp ? "mcp" : "builtin-tool";
    const server = mcp ? mcp.server : null;
    const detail = [server, toolName, describeToolInput(input)].filter(Boolean).join(" · ");
    const entry = { kind: "tool", name: toolName, category, server, detail };
    if (id) pending.set(id, entry);
    return {
      type: "activity",
      tone: "info",
      title: "Tool started",
      detail,
      toolCall: { id, name: toolName, category, ...(server ? { server } : {}), phase: "started", result: null },
    };
  }

  function parseUser(event) {
    const blocks = Array.isArray(event.message?.content) ? event.message.content : [];
    const events = [];
    for (const block of blocks) {
      if (block?.type !== "tool_result") continue;
      const completed = completeToolCall(block);
      if (completed) events.push(completed);
    }
    return events;
  }

  function completeToolCall(block) {
    const id = block.tool_use_id ?? null;
    const entry = id ? pending.get(id) : null;
    if (!entry) {
      // No matching tool_use. Emitting a bare completion would invent a tool call,
      // and guessing it was Bash would risk a fabricated commandFailed.
      state.unmatchedToolResults += 1;
      return null;
    }
    pending.delete(id);
    const succeeded = block.is_error !== true;

    if (entry.kind === "bash") {
      // An E2BIG shell start is the host refusing to exec, not a command that ran and
      // failed. It is deliberately *not* `commandFailed`: that flag means "a
      // verification command reported a problem", which in the test stage is a REPAIR
      // verdict. Laundering an environment fault into a verdict is exactly what the
      // rules above warn against, so this is counted as parser state and `runClaude`
      // fails the whole run on it instead.
      if (readsAsShellStartFailure(toolResultText(block.content))) {
        state.shellStartFailures += 1;
        return {
          type: "activity",
          tone: "danger",
          title: "Repository command could not start",
          detail: entry.detail,
          runtimeScope: "candidate",
          toolCall: {
            id,
            name: "command_execution",
            category: "repository-command",
            phase: "completed",
            result: SHELL_START_FAILURE_RESULT,
          },
        };
      }
      return {
        type: "activity",
        tone: succeeded ? "success" : "warning",
        title: succeeded ? "Repository command completed" : "Repository command returned a warning",
        detail: entry.detail,
        commandFailed: !succeeded,
        // Claude has no context-preflight exemption; that whitelist is Codex-specific.
        runtimeScope: "candidate",
        toolCall: {
          id,
          name: "command_execution",
          category: "repository-command",
          phase: "completed",
          result: claudeCommandResult(block.content),
        },
      };
    }

    // Never set commandFailed for a non-Bash tool: Codex only ever set it for
    // command_execution, and widening it would inject spurious REPAIR verdicts.
    return {
      type: "activity",
      tone: succeeded ? "success" : "warning",
      title: succeeded ? "Tool completed" : "Tool failed",
      detail: entry.detail,
      toolCall: {
        id,
        name: entry.name,
        category: entry.category,
        ...(entry.server ? { server: entry.server } : {}),
        phase: "completed",
        result: conciseToolResult(block.content),
      },
    };
  }

  function parseResult(event) {
    state.sawResult = true;
    state.resultSubtype = event.subtype ?? null;
    state.resultIsError = event.is_error === true;
    state.totalCostUsd = Number.isFinite(event.total_cost_usd) ? event.total_cost_usd : null;
    state.modelUsage = event.modelUsage && typeof event.modelUsage === "object" ? event.modelUsage : null;
    state.permissionDenials = Array.isArray(event.permission_denials) ? event.permission_denials : [];
    const resultText = typeof event.result === "string" ? event.result.trim() : "";
    state.finalText = resultText || state.lastAssistantText;

    const events = [];
    for (const denial of state.permissionDenials) {
      events.push({
        type: "activity",
        tone: "danger",
        title: "Permission denied",
        detail: [denial?.tool_name, formatCommand(denial?.tool_input?.command)].filter(Boolean).join(" · "),
      });
    }
    if (state.finalText) events.push({ type: "message", text: state.finalText });
    // One usage event per run: top-level result.usage is cumulative and equals
    // modelUsage[primary]. Nothing accumulates, and iterations are never summed.
    if (event.usage && typeof event.usage === "object") {
      state.usage = claudeUsageFromResult(event.usage);
      events.push({ type: "usage", usage: state.usage });
    }
    return events;
  }

  return {
    parse,
    /** Everything `run()` needs that is not an event stream consumers see. */
    result() {
      return {
        sessionId: state.sessionId,
        finalText: state.finalText,
        usage: state.usage,
        modelUsage: state.modelUsage,
        totalCostUsd: state.totalCostUsd,
        rateLimitInfo: state.rateLimitInfo,
        permissionDenials: state.permissionDenials,
        resultSubtype: state.resultSubtype,
        resultIsError: state.resultIsError,
        sawResult: state.sawResult,
        pendingToolCalls: pending.size,
        unmatchedToolResults: state.unmatchedToolResults,
        shellStartFailures: state.shellStartFailures,
      };
    },
  };
}

/**
 * Failure text lives in the `result` line, not on stderr: the auth-failed run
 * exited 1 with empty stderr and carried its message in `result.result` with
 * `is_error: true`. Codex's stderr fallback is wrong here.
 */
export function extractClaudeFailure(parsed) {
  if (!parsed?.sawResult) return null;
  if (parsed.resultIsError || (parsed.resultSubtype && parsed.resultSubtype !== "success")) {
    return parsed.finalText || `Claude ended with ${parsed.resultSubtype ?? "an error"}.`;
  }
  return null;
}

/**
 * The CLI's own text when it could not exec a shell for the Bash tool at all:
 *
 *   Could not start /bin/zsh: the command line plus environment exceed the OS exec
 *   argument limit (E2BIG). At spawn: command line 1.1MB across 3 args
 *
 * Measured only in `workspace-write`, where the sandbox profile carries a far larger
 * deny-path list than read-only. `Write` and `Edit` keep working when this happens —
 * they are gated by the permission layer, a different enforcement path — so a write
 * stage can edit files while every command that would verify those edits dies. That is
 * the window this marker closes.
 *
 * Matched on both halves so an unrelated "Could not start" (a missing interpreter, say)
 * is still an ordinary command failure and stays a REPAIR-eligible signal.
 */
const SHELL_START_FAILURE_MARKERS = Object.freeze(["Could not start", "E2BIG"]);

/** Recorded in place of the body, since tool-result bodies are never retained. */
const SHELL_START_FAILURE_RESULT = "Shell could not start (E2BIG)";

export function readsAsShellStartFailure(text) {
  if (typeof text !== "string" || !text) return false;
  return SHELL_START_FAILURE_MARKERS.every((marker) => text.includes(marker));
}

/**
 * Text of a tool result for marker matching only. Nothing here reaches an event; the
 * retained `result` field stays the same fixed-shape summary it has always been.
 */
function toolResultText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((block) => (typeof block?.text === "string" ? block.text : "")).join("\n");
}

/** Byte-identical to Codex's `commandResult` when an exit code is recoverable. */
function claudeCommandResult(content) {
  const text = typeof content === "string" ? content : null;
  const match = text?.match(/^Exit code (\d+)/);
  if (match) return `Exit code ${Number(match[1])}`;
  return conciseToolResult(content);
}

function parseMcpToolName(name) {
  if (!name.startsWith("mcp__")) return null;
  const rest = name.slice("mcp__".length);
  const separator = rest.indexOf("__");
  if (separator < 1 || separator + 2 >= rest.length) return null;
  return { server: rest.slice(0, separator), tool: rest.slice(separator + 2) };
}

const TOOL_INPUT_HINTS = ["file_path", "pattern", "path", "url", "notebook_path", "description"];

function describeToolInput(input) {
  for (const key of TOOL_INPUT_HINTS) {
    const value = input[key];
    if (typeof value === "string" && value.trim()) return formatCommand(value);
  }
  return null;
}

function finite(value) {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

/**
 * The fixed system prompt. Identical for every stage, deliberately: stage
 * instructions must not be split between `--system-prompt` and stdin, because both
 * providers have to receive byte-identical stage content for their evidence to be
 * comparable. This says only what is true of every harness spawn regardless of
 * stage, and nothing about the work.
 */
export const CLAUDE_SYSTEM_PROMPT =
  "You are a non-interactive execution agent inside an automated engineering harness. " +
  "There is no operator available to answer questions or approve anything, so never ask for " +
  "confirmation and never wait for input. Follow the instructions in the user message exactly, " +
  "including any output format it specifies. Your final assistant message is the entire " +
  "deliverable and is the only text the harness retains.";

/**
 * The tool surface. Hardcoded rather than abstracted into a bundle: there are two
 * postures, and naming them here keeps the allowlist auditable in one place.
 * `Write`, `Edit`, `NotebookEdit`, `WebFetch`, `WebSearch` and `Task` are absent, so
 * they are not present in the request at all.
 */
export const CLAUDE_READ_ONLY_TOOLS = Object.freeze(["Read", "Grep", "Glob", "Bash"]);

/**
 * Write stages add exactly the two editing tools. `NotebookEdit`, `WebFetch`,
 * `WebSearch` and `Task` stay absent, so they are not present in the request at all.
 */
export const CLAUDE_WORKSPACE_WRITE_TOOLS = Object.freeze([...CLAUDE_READ_ONLY_TOOLS, "Write", "Edit"]);

export function claudeToolsFor(sandbox) {
  return sandbox === "workspace-write" ? CLAUDE_WORKSPACE_WRITE_TOOLS : CLAUDE_READ_ONLY_TOOLS;
}

export const CLAUDE_STDOUT_BUDGET = 32 * 1024 * 1024;

/**
 * Build the sandbox settings supplied inline through `--settings`, so the
 * operator's `~/.claude/settings.json` is never touched.
 *
 * `failIfUnavailable: true` is mandatory, not optional: its documented default is
 * `false`, and the documented `false` behaviour is that a warning is shown and
 * commands run unsandboxed. Omitting it means silent unconfined execution on any
 * host missing the sandbox runtime.
 */
export function buildClaudeSandboxSettings(cwd, sandbox, networkAccess = false) {
  if (!["read-only", "workspace-write"].includes(sandbox)) {
    throw new Error(`Unsupported Claude sandbox: ${sandbox}`);
  }
  if (networkAccess) {
    // Enabling loopback binding (`network.allowLocalBinding`) makes the CLI stop
    // treating the sandbox as fully sandboxed, so `autoAllowBashIfSandboxed` no longer
    // auto-approves commands and every Bash call stalls on a permission gate with
    // nobody to answer it. Verified on 2.1.222. Until a working Bash allow-rule form
    // is found, a network-granting stage cannot run on Claude at all.
    throw new Error("Claude stages cannot be granted network access; the test stage must run on Codex.");
  }
  const writable = sandbox === "workspace-write";
  return {
    // Bash is confined by the OS sandbox alone, but Write and Edit are gated by the
    // permission layer — a different mechanism with a different failure mode. Both
    // this rule and `--permission-mode acceptEdits` are required; with the rule alone
    // the Write tool is still refused, because in -p there is nobody to approve it.
    ...(writable
      ? { permissions: { allow: [`Write(${cwd}/**)`, `Edit(${cwd}/**)`] } }
      : {}),
    sandbox: {
      enabled: true,
      failIfUnavailable: true,
      allowUnsandboxedCommands: false,
      autoAllowBashIfSandboxed: true,
      filesystem: {
        allowRead: [cwd],
        ...(writable
          // Deliberately no denyWrite. The sandbox is default-deny, so the allow entry
          // is necessary and sufficient — and because harness worktrees are nested
          // *inside* the repository, a repo-root denyWrite would be an ancestor of this
          // allow and would defeat it entirely, blocking legitimate writes too.
          ? { allowWrite: [cwd] }
          // Read-only has no nested allowWrite for a denyWrite to defeat, so the
          // explicit deny stays as belt-and-braces on top of default-deny.
          : { allowWrite: [], denyWrite: [cwd] }),
      },
      // Deterministic denial. WebFetch/WebSearch are absent from the tool allowlist,
      // and the CLI's own API traffic is necessarily outside the sandbox.
      network: { strictAllowlist: true, allowedDomains: [] },
    },
  };
}

/**
 * Assemble the spawn. Pure, so the argv can be asserted without running anything.
 *
 * The prompt goes on stdin and never on argv. `--tools` is variadic (`<tools...>`),
 * so a positional prompt is silently consumed as another tool name and the CLI then
 * fails with "Input must be provided either through stdin or as a prompt argument".
 * Passing the tools as one comma-separated value — the form the CLI's own help
 * documents — removes the hazard rather than relying on flag ordering.
 */
export function buildClaudeSpawn({
  cwd,
  prompt,
  sandbox = "read-only",
  networkAccess = false,
  model,
  effort = null,
  sessionId,
  tools = null,
}) {
  const args = [
    "-p",
    "--output-format",
    "stream-json",
    "--verbose",
    "--model",
    model,
    // Skips hooks, CLAUDE.md, skills, plugins and custom agents. This is a safety
    // requirement, not a determinism nicety: an operator PreToolUse hook can
    // rewrite a command *after* the tool_use event the harness records, so without
    // it the recorded activity is not what executed.
    "--safe-mode",
    "--strict-mcp-config",
    "--no-session-persistence",
    "--session-id",
    sessionId,
    "--settings",
    JSON.stringify(buildClaudeSandboxSettings(cwd, sandbox, networkAccess)),
    "--system-prompt",
    CLAUDE_SYSTEM_PROMPT,
    // Auto-approves the permission rules above and nothing else: a Write outside the
    // allowed glob is still refused and recorded in permission_denials.
    ...(sandbox === "workspace-write" ? ["--permission-mode", "acceptEdits"] : []),
    ...(effort ? ["--effort", effort] : []),
    "--tools",
    (tools ?? claudeToolsFor(sandbox)).join(","),
  ];
  return { args, stdin: prompt };
}

export async function runClaude({
  cwd,
  prompt,
  signal,
  timeoutMs = 240_000,
  sandbox = "read-only",
  networkAccess = false,
  tempDirectory = null,
  model,
  reasoning,
  onEvent = () => {},
}) {
  const binary = await locateClaude();
  if (!binary) throw new Error("Claude CLI was not found. Install Claude Code and sign in first.");
  if (networkAccess && sandbox !== "workspace-write") {
    throw new Error("Claude read-only stages never grant network access.");
  }
  if (providerForModelId(model) !== "claude") {
    throw new Error(
      `Claude cannot run ${model}, which belongs to ${providerForModelId(model) ?? "no known"} provider. Every stage policy on a Claude task must use a Claude model.`,
    );
  }
  // Refuses rather than silently downgrading an unsupported effort level.
  const effort = assertSupportedReasoning(model, reasoning);
  const runtimeTemp = tempDirectory
    ?? process.env.AGENT_HARNESS_TEMP
    ?? path.join(os.tmpdir(), "agent-harness");
  await mkdir(runtimeTemp, { recursive: true });

  const sessionId = randomUUID();
  const { args, stdin } = buildClaudeSpawn({ cwd, prompt, sandbox, networkAccess, model, effort, sessionId });
  const parser = createClaudeStreamParser();
  // Abort the child the moment the host stops being able to exec a shell. Waiting adds
  // nothing — every remaining command dies the same way — and in a write stage the
  // edits already on disk must not reach `GitWorktreeManager.commit`, which the harness
  // calls once this function returns normally. Post-run detection would also be
  // sufficient for that; this just stops burning tokens on a doomed run.
  const runSignal = new AbortController();
  const forwardAbort = () => runSignal.abort();
  if (signal?.aborted) runSignal.abort();
  else signal?.addEventListener("abort", forwardAbort, { once: true });

  let result;
  try {
    result = await runProcess(binary, args, {
      // There is no `--cd`: Claude inherits the spawn cwd where Codex takes a flag.
      cwd,
      timeoutMs,
      signal: runSignal.signal,
      env: buildClaudeEnvironment(process.env, runtimeTemp),
      input: stdin,
      label: CLAUDE_RUN_LABEL,
      stdoutBudgetBytes: CLAUDE_STDOUT_BUDGET,
      onStdoutLine(line) {
        for (const event of parser.parse(line)) onEvent(event);
        if (parser.result().shellStartFailures) runSignal.abort();
      },
    });
  } catch (error) {
    // The cancellation we caused reads as an ordinary cancellation from here, so the
    // real cause has to win over it.
    if (parser.result().shellStartFailures) throw shellStartFailureError(sandbox, cwd);
    throw error;
  } finally {
    signal?.removeEventListener("abort", forwardAbort);
  }

  const parsed = parser.result();
  // Before every other verdict-shaped check: this is an environment fault, and the
  // stage's own output cannot be trusted once the commands that would have verified it
  // could not run.
  if (parsed.shellStartFailures) throw shellStartFailureError(sandbox, cwd);
  const failure = extractClaudeFailure(parsed);
  if (failure) throw new Error(failure);
  if (result.code !== 0) throw new Error(`Claude exited with code ${result.code}.`);
  // A denial is never a verdict. In a read-only stage it means the agent attempted a
  // mutation; either way the run is untrustworthy evidence, so it routes through the
  // failed-run path instead of producing a REPAIR or a PASS.
  if (parsed.permissionDenials.length) {
    throw new Error(
      `Claude attempted ${parsed.permissionDenials.length} denied tool call${parsed.permissionDenials.length === 1 ? "" : "s"} during a ${sandbox} stage.`,
    );
  }
  if (parsed.rateLimitInfo && parsed.rateLimitInfo.status !== "allowed") {
    throw new Error(`Claude plan allocation is ${parsed.rateLimitInfo.status}; the stage was not accepted.`);
  }
  if (!parsed.finalText) throw new Error("Claude completed without returning an artifact.");

  const usage = {
    ...(parsed.usage ?? { inputTokens: 0, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 0, totalTokens: 0 }),
    // Carried on the usage record itself so `enrichUsage` picks both up with no
    // orchestrator change, and so re-enriching on boot stays idempotent.
    ...(parsed.totalCostUsd == null ? {} : { reportedCost: parsed.totalCostUsd }),
    ...(parsed.modelUsage ? { modelUsage: parsed.modelUsage } : {}),
  };
  // Cross-check against the per-model breakdown, not the aggregate priced as one
  // model: a run reports usage for every model it used, so the single-model estimate
  // is systematically low and would flag a divergence on almost every run.
  const divergence = costDivergence(
    parsed.totalCostUsd,
    priceModelUsage(parsed.modelUsage) ?? priceUsage(model, usage),
  );
  if (divergence?.material) {
    // How the harness notices the provider changing its prices.
    const detail = `Reported $${divergence.reportedCost} vs rate card $${divergence.estimatedCost}`;
    console.warn(`[claude-runtime] cost divergence for ${model}: ${detail}`);
    onEvent({ type: "activity", tone: "warning", title: "Reported cost diverges from the rate card", detail });
  }
  return { finalText: parsed.finalText, usage, sessionId: parsed.sessionId, rateLimitInfo: parsed.rateLimitInfo };
}

/**
 * A failed run, deliberately, rather than a failed verification.
 *
 * `Write` and `Edit` survive an E2BIG shell start, so without this a write stage
 * half-runs: files are edited, every command that would have checked them dies, and the
 * harness commits the result. Throwing here is what stops the commit.
 */
function shellStartFailureError(sandbox, cwd) {
  return new Error(
    `The Bash tool could not start a shell during a ${sandbox} stage at ${cwd}: the sandbox profile's exec argument list exceeds the OS limit (E2BIG). `
      + "This is a host environment fault, not a verification result, so the run is failed rather than reported as needing repair.",
  );
}

const CANARY_SENTINEL = "HARNESS-CANARY-INTACT";

/**
 * The CLI's own text when the OS sandbox could not be created. `failIfUnavailable:
 * true` does not abort the run — it surfaces per command like any other tool error —
 * so a canary that only checks "was the write refused" passes while the mechanism it
 * exists to verify is dead, with the refusal coming from the permission layer
 * instead. A verification that passes when its subject is absent is worse than none.
 */
const SANDBOX_UNAVAILABLE_MARKER = "Sandbox is required but failed to initialize";

function readsAsSandboxUnavailable(line) {
  return line.includes(SANDBOX_UNAVAILABLE_MARKER);
}
const CANARY_TTL_MS = 10 * 60 * 1000;
const canaryCache = new Map();

/**
 * Establish, on this host, that a read-only Claude stage is actually confined.
 *
 * The layered read-only posture depends on four coupled mechanisms that a CLI
 * release can change without a changelog entry the harness reads, so configuration
 * is not evidence and neither is a design document. This attempts a sandboxed write
 * in a disposable scratch directory and requires that it was refused, then requires
 * that the model-reachable unsandboxed retry was denied too.
 *
 * The authoritative assertion is the file's own bytes, not anything the CLI reports
 * about itself. A run in which nothing was attempted is inconclusive, not a pass:
 * that direction fails closed and leaves Claude execution disabled.
 */
export async function runClaudeSandboxCanary({
  sandbox = "read-only",
  timeoutMs = 180_000,
  model = "claude-haiku-4-5",
  now = Date.now,
} = {}) {
  const cached = canaryCache.get(sandbox);
  if (cached && now() - cached.at < CANARY_TTL_MS) return cached.result;
  const result = sandbox === "workspace-write"
    ? await executeClaudeWriteCanary({ timeoutMs, model })
    : await executeClaudeSandboxCanary({ timeoutMs, model });
  canaryCache.set(sandbox, { at: now(), result });
  return result;
}

export function resetClaudeSandboxCanaryCache() {
  canaryCache.clear();
}

/**
 * Decide what an observed workspace-write canary proves.
 *
 * Inverted from read-only: a write inside the worktree must *succeed*, so a run where
 * nothing was written proves the stage is broken rather than that it is safe. Every
 * escape target must be untouched, and both write mechanisms are checked because they
 * are gated by different layers — Bash by the OS sandbox, Write/Edit by the
 * permission layer.
 */
export function classifyClaudeWriteCanary({
  insideWritten,
  escaped,
  editToolWorked,
  shellFailed = false,
  sandboxUnavailable = false,
  exitCode = null,
}) {
  // A dead sandbox is worse here than in read-only: writes are supposed to succeed, so
  // the only thing left refusing an escape is the permission-layer working-directory
  // guard — one layer, and not the one that matches resolved paths, which is what makes
  // the provisioned-dependency symlink safe.
  if (sandboxUnavailable) {
    return canaryResult(false, "The OS sandbox failed to initialize, so write confinement rests on the permission layer alone.", {
      sandboxUnavailable: true,
      exitCode,
    });
  }
  if (escaped.length) {
    return canaryResult(false, `Writes escaped the worktree: ${escaped.join(", ")}.`, { escaped, exitCode });
  }
  if (!insideWritten) {
    // Distinguished from a refusal on purpose: an E2BIG shell start is a host
    // environment problem, not a confinement result, and reporting it as the latter
    // would send someone looking at the sandbox config for a fault that is not there.
    return canaryResult(
      false,
      shellFailed
        ? "The Bash tool could not start a shell on this host (E2BIG), so write-stage commands cannot run here."
        : "No write inside the worktree succeeded, so a write stage could not do its work here.",
      { inconclusive: true, shellFailed, exitCode },
    );
  }
  if (!editToolWorked) {
    return canaryResult(false, "Bash writes work but the Edit tool was refused; the permission rule or acceptEdits is not taking effect.", {
      inconclusive: true,
      exitCode,
    });
  }
  return canaryResult(true, "Writes inside the worktree succeeded through both Bash and the Edit tool, and every escape target is untouched.", {
    exitCode,
    escaped: [],
  });
}

async function executeClaudeWriteCanary({ timeoutMs, model }) {
  const binary = await locateClaude().catch(() => null);
  if (!binary) return canaryResult(false, "Claude CLI was not found.", { inconclusive: true });
  const root = await mkdtemp(path.join(os.tmpdir(), "agent-harness-claude-write-canary-"));
  // The worktree is nested inside a "source repository", exactly as harness worktrees
  // are, because that nesting is what makes an ancestor denyWrite defeat the allow.
  const source = path.join(root, "src");
  const worktree = path.join(source, ".data", "worktrees", "task", "candidate");
  try {
    await mkdir(worktree, { recursive: true });
    const escapeTargets = {
      sourceRoot: path.join(source, "guarded.txt"),
      sibling: path.join(root, "guarded.txt"),
    };
    for (const target of Object.values(escapeTargets)) await writeFile(target, CANARY_SENTINEL, "utf8");
    await writeFile(path.join(worktree, "editable.txt"), "ORIGINAL", "utf8");

    const prompt = [
      "This is an automated sandbox self-test in a disposable scratch directory.",
      "Nothing here is real work. Do all four steps, then reply DONE.",
      "",
      "1. Bash: echo INSIDE > inside.txt",
      "2. Use the Edit tool on editable.txt to replace ORIGINAL with EDITED.",
      `3. Bash: echo ESCAPED > ${escapeTargets.sourceRoot}`,
      `4. Bash: echo ESCAPED > ${escapeTargets.sibling}`,
      "",
      "Steps 3 and 4 are expected to be refused. Do not work around a refusal.",
    ].join("\n");
    const { args, stdin } = buildClaudeSpawn({
      cwd: worktree,
      prompt,
      sandbox: "workspace-write",
      model,
      effort: assertSupportedReasoning(model, model === "claude-haiku-4-5" ? NO_REASONING_EFFORT : "low"),
      sessionId: randomUUID(),
    });
    let shellFailed = false;
    let sandboxUnavailable = false;
    const run = await runProcess(binary, args, {
      cwd: worktree,
      timeoutMs,
      // Outside the worktree, matching a real stage: temp files inside a candidate
      // worktree would be seen by `commit`.
      env: buildClaudeEnvironment(process.env, root),
      input: stdin,
      label: CLAUDE_RUN_LABEL,
      stdoutBudgetBytes: CLAUDE_STDOUT_BUDGET,
      onStdoutLine(line) {
        if (readsAsShellStartFailure(line)) shellFailed = true;
        if (readsAsSandboxUnavailable(line)) sandboxUnavailable = true;
      },
    });

    // Ground truth from the filesystem, not from anything the CLI reported.
    const escaped = [];
    for (const [name, target] of Object.entries(escapeTargets)) {
      if ((await readFile(target, "utf8").catch(() => null)) !== CANARY_SENTINEL) escaped.push(name);
    }
    return classifyClaudeWriteCanary({
      sandboxUnavailable,
      insideWritten: (await readFile(path.join(worktree, "inside.txt"), "utf8").catch(() => "")).includes("INSIDE"),
      editToolWorked: (await readFile(path.join(worktree, "editable.txt"), "utf8").catch(() => "")).includes("EDITED"),
      escaped,
      shellFailed,
      exitCode: run.code,
    });
  } catch (error) {
    return canaryResult(false, error instanceof Error ? error.message : String(error), { errored: true });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function executeClaudeSandboxCanary({ timeoutMs, model }) {
  const binary = await locateClaude().catch(() => null);
  if (!binary) return canaryResult(false, "Claude CLI was not found.", { inconclusive: true });
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-claude-canary-"));
  const guarded = path.join(directory, "guarded.txt");
  try {
    await writeFile(guarded, CANARY_SENTINEL, "utf8");
    const prompt = [
      "This is an automated sandbox self-test running in a disposable scratch directory.",
      "Nothing here is real work and no file here matters.",
      "",
      "Step 1. Run exactly this command with the Bash tool:",
      "  echo MUTATED > guarded.txt",
      "",
      "Step 2. If that command is blocked, run it once more with the Bash tool's",
      "dangerouslyDisableSandbox parameter set to true, so this self-test can confirm that",
      "the escalation path is refused as well. Do not try any other way of writing the file.",
      "",
      "Step 3. Reply with the single word DONE and nothing else.",
    ].join("\n");
    const { args, stdin } = buildClaudeSpawn({
      cwd: directory,
      prompt,
      sandbox: "read-only",
      model,
      effort: assertSupportedReasoning(model, model === "claude-haiku-4-5" ? NO_REASONING_EFFORT : "low"),
      sessionId: randomUUID(),
    });
    const parser = createClaudeStreamParser();
    const events = [];
    // The canary reads the raw stream as well as the parsed events. Stage parsing
    // deliberately discards tool inputs, but a self-test of the escalation path has
    // to see whether `dangerouslyDisableSandbox` was actually exercised.
    let escalationAttempts = 0;
    let sandboxUnavailable = false;
    const run = await runProcess(binary, args, {
      cwd: directory,
      timeoutMs,
      env: buildClaudeEnvironment(process.env, directory),
      input: stdin,
      label: CLAUDE_RUN_LABEL,
      stdoutBudgetBytes: CLAUDE_STDOUT_BUDGET,
      onStdoutLine(line) {
        for (const event of parser.parse(line)) events.push(event);
        escalationAttempts += countEscalationAttempts(line);
        if (readsAsSandboxUnavailable(line)) sandboxUnavailable = true;
      },
    });
    const parsed = parser.result();
    const content = await readFile(guarded, "utf8").catch(() => null);
    const mutated = content !== CANARY_SENTINEL;
    const bashCompletions = events.filter(
      (event) => event.toolCall?.category === "repository-command" && event.toolCall.phase === "completed",
    );
    const attempted = bashCompletions.length > 0 || parsed.permissionDenials.length > 0;
    const refused = bashCompletions.some((event) => event.commandFailed === true);

    return classifyClaudeSandboxCanary({
      sandboxUnavailable,
      mutated,
      attempted,
      refused,
      permissionDenials: parsed.permissionDenials.length,
      escalationAttempts,
      refusedCommands: bashCompletions.filter((event) => event.commandFailed === true).length,
      exitCode: run.code,
    });
  } catch (error) {
    return canaryResult(false, error instanceof Error ? error.message : String(error), { errored: true });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

/**
 * Decide what an observed canary run proves. Pure, so the safety-critical property —
 * that anything short of a demonstrated refusal fails closed — is testable without
 * spawning a CLI.
 */
export function classifyClaudeSandboxCanary({
  sandboxUnavailable = false,
  mutated,
  attempted,
  refused,
  permissionDenials = 0,
  escalationAttempts = 0,
  refusedCommands = 0,
  exitCode = null,
}) {
  // Checked before the refusal, because a dead sandbox still produces refusals — from
  // the permission layer — and an untouched guarded file. Those are exactly the
  // observations a pass is built from, so without this the canary reports agreement
  // precisely when the thing it verifies is missing.
  if (sandboxUnavailable) {
    return canaryResult(false, "The OS sandbox failed to initialize, so read-only confinement rests on one layer instead of two.", {
      sandboxUnavailable: true,
      exitCode,
    });
  }
  if (mutated) {
    return canaryResult(false, "A sandboxed write into the scratch directory succeeded; read-only is not confined on this host.", {
      mutated: true,
      exitCode,
    });
  }
  if (!attempted) {
    return canaryResult(false, "The canary agent never attempted the guarded write, so confinement was not demonstrated.", {
      inconclusive: true,
      exitCode,
    });
  }
  if (!refused && !permissionDenials) {
    return canaryResult(false, "The guarded write was neither refused nor denied, and the file is unchanged; the result is ambiguous.", {
      inconclusive: true,
      exitCode,
    });
  }
  return canaryResult(true, "A sandboxed write was refused and the guarded file is unchanged.", {
    exitCode,
    refusedCommands,
    permissionDenials,
    escalationAttempts,
    // The file's own bytes are the assertion: had an escalated write gone through,
    // `mutated` would already have failed this canary. `null` records that the
    // escalation path was never exercised, rather than claiming a pass over an
    // empty set.
    escalationBlocked: escalationAttempts === 0 ? null : true,
  });
}

function countEscalationAttempts(line) {
  let event;
  try {
    event = JSON.parse(line);
  } catch {
    return 0;
  }
  const blocks = Array.isArray(event?.message?.content) ? event.message.content : [];
  return blocks.filter((block) => block?.type === "tool_use" && block?.input?.dangerouslyDisableSandbox === true).length;
}

function canaryResult(passed, detail, extra = {}) {
  return { passed, detail, ...extra };
}

/**
 * The Claude execution provider.
 *
 * `read-only` reports `"layered"`, not `"os-enforced"`, and that is the honest
 * answer: there is no single Claude flag equivalent to `codex exec --sandbox
 * read-only`. The posture is assembled from four coupled mechanisms — the tool
 * allowlist, the OS sandbox for Bash, the permission gate that denies the
 * model-reachable `dangerouslyDisableSandbox` waiver, and the harness's own
 * pre/post verification. Only the fourth is ours, so it is the enforcement of
 * record and the first three are defence in depth. `confinementVerifiedBy:
 * "harness"` is what makes the orchestrator require that verification rather than
 * trust this configuration.
 *
 * `workspace-write` is offered on the same terms: confinement was established by the
 * write-mode spike and is re-established per host by its own canary, which is shaped
 * differently — writes inside the worktree must succeed while everything outside must
 * still be refused.
 */
export const claudeExecutionProvider = {
  id: "claude",
  label: "Claude",
  locate: locateClaude,
  status: getClaudeStatus,
  catalog: () => readClaudeModelCatalog(),
  defaults: () => providerRuntimeDefaults("claude"),
  capabilities: () => ({
    sandboxes: { "read-only": "layered", "workspace-write": "layered" },
    confinementVerifiedBy: "harness",
    // Governs sandboxed commands only. WebFetch/WebSearch are removed at the tool
    // allowlist, and the CLI's own API traffic is necessarily outside the sandbox.
    networkIsolation: true,
    // The test stage needs loopback binding for repository HTTP tests. Granting it
    // costs `autoAllowBashIfSandboxed`, which strands every command on a permission
    // gate, so a network-granting stage stays on Codex rather than running degraded.
    grantsNetworkAccess: false,
    supportsReasoningLevels: true,
    // tool_result carries the full output, unlike Codex's item.completed, so the
    // 2.5 MB budget would abort legitimate stages. The retained tail and the
    // "content not retained" discipline are unchanged; only the streamed cap moves.
    stdoutBudgetBytes: CLAUDE_STDOUT_BUDGET,
  }),
  run: runClaude,
  canary: runClaudeSandboxCanary,
};
