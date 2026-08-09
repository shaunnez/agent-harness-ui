import { existsSync } from "node:fs";
import { mkdir, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { getClaudeStatus } from "./claude-runtime.mjs";
import {
  DEFAULT_RUNTIME_MODEL,
  DEFAULT_RUNTIME_REASONING,
  normalizeModelId,
  readCodexModelCatalog,
} from "./model-catalog.mjs";
import {
  conciseToolResult,
  DEFAULT_STDOUT_BUDGET,
  formatCommand,
  isProcessTimeoutError,
  ProcessTimeoutError,
  runProcess,
} from "./process-runtime.mjs";

// Re-exported so existing importers keep a single Codex-runtime entry point while
// the implementations live in the shared, provider-agnostic module.
export { isProcessTimeoutError, ProcessTimeoutError, runProcess };

const STDOUT_BUDGET = DEFAULT_STDOUT_BUDGET;
export const DEFAULT_MODEL = normalizeModelId(process.env.AGENT_HARNESS_MODEL ?? DEFAULT_RUNTIME_MODEL);
export const DEFAULT_REASONING = process.env.AGENT_HARNESS_REASONING ?? DEFAULT_RUNTIME_REASONING;

export async function locateCodex() {
  if (process.env.CODEX_BIN) return process.env.CODEX_BIN;
  const command = process.platform === "win32" ? "where.exe" : "which";
  const result = await runProcess(command, ["codex"], { timeoutMs: 5_000, label: "Codex" });
  const pathCandidates = result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const candidates = [...(await desktopCodexCandidates()), ...pathCandidates];
  return selectCodexCandidate(candidates);
}

export function selectCodexCandidate(candidates, fileExists = existsSync) {
  const executableCandidates = candidates.filter((candidate) =>
    process.platform === "win32" ? candidate.toLowerCase().endsWith(".exe") : true,
  );
  if (process.platform === "win32") {
    const sandboxReady = executableCandidates.find((candidate) =>
      fileExists(path.join(path.dirname(candidate), "codex-windows-sandbox-setup.exe")),
    );
    if (sandboxReady) return sandboxReady;
  }
  return executableCandidates[0] ?? candidates[0] ?? null;
}

async function desktopCodexCandidates() {
  if (process.platform !== "win32" || !process.env.LOCALAPPDATA) return [];
  const binRoot = path.join(process.env.LOCALAPPDATA, "OpenAI", "Codex", "bin");
  const entries = await readdir(binRoot, { withFileTypes: true }).catch(() => []);
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(binRoot, entry.name, "codex.exe"))
    .filter((candidate) => existsSync(candidate));
}

export async function getCodexStatus() {
  try {
    const catalog = await readCodexModelCatalog();
    const binary = await locateCodex();
    if (!binary) {
      return { available: false, authenticated: false, authMethod: null, model: DEFAULT_MODEL, reasoning: DEFAULT_REASONING, binary: null, message: "Codex CLI was not found.", catalog };
    }
    const result = await runProcess(binary, ["login", "status"], { timeoutMs: 10_000, label: "Codex" });
    const message = `${result.stdout}\n${result.stderr}`.trim();
    const claude = await getClaudeStatus();
    return {
      available: true,
      authenticated: result.code === 0 && /logged in/i.test(message),
      authMethod: /chatgpt/i.test(message) ? "ChatGPT" : result.code === 0 ? "Codex login" : null,
      model: DEFAULT_MODEL,
      reasoning: DEFAULT_REASONING,
      binary,
      message: message || "Codex CLI is available.",
      catalog,
      providers: [
        { id: "codex", label: "Codex", available: true, authenticated: result.code === 0 && /logged in/i.test(message), executionEnabled: true, detail: /chatgpt/i.test(message) ? "ChatGPT signed in" : "Codex login" },
        claude,
      ],
    };
  } catch (error) {
    return { available: false, authenticated: false, authMethod: null, model: DEFAULT_MODEL, reasoning: DEFAULT_REASONING, binary: null, message: error.message, catalog: await readCodexModelCatalog() };
  }
}

export function parseCodexEvent(line) {
  let event;
  try {
    event = JSON.parse(line);
  } catch {
    return null;
  }

  if (event.type === "thread.started") {
    return { type: "activity", tone: "info", title: "Agent session started", detail: event.thread_id ?? "Codex thread created" };
  }

  if (event.type === "item.started" && event.item?.type === "command_execution") {
    return {
      type: "activity",
      tone: "info",
      title: "Inspecting repository",
      detail: formatCommand(event.item.command),
      toolCall: {
        id: event.item.id ?? null,
        name: "command_execution",
        category: "repository-command",
        phase: "started",
        result: null,
      },
    };
  }

  if (event.type === "item.completed" && event.item?.type === "command_execution") {
    const succeeded = event.item.status === "completed" || event.item.exit_code === 0;
    const runtimeScope = !succeeded && isRuntimeContextPreflightCommand(event.item.command)
      ? "context-preflight"
      : "agent-diagnostic";
    return {
      type: "activity",
      tone: succeeded ? "success" : "warning",
      title: succeeded ? "Repository command completed" : "Repository command returned a warning",
      detail: formatCommand(event.item.command),
      commandFailed: !succeeded,
      runtimeScope,
      toolCall: {
        id: event.item.id ?? null,
        name: "command_execution",
        category: "repository-command",
        phase: "completed",
        result: commandResult(event.item),
      },
    };
  }

  if (["item.started", "item.completed"].includes(event.type) && event.item?.type === "mcp_tool_call") {
    const toolName = String(event.item.tool ?? event.item.name ?? "").trim();
    if (!toolName) return null;
    const completed = event.type === "item.completed";
    const failed = completed && (event.item.status === "failed" || event.item.error != null);
    return {
      type: "activity",
      tone: failed ? "warning" : completed ? "success" : "info",
      title: completed ? `Tool ${failed ? "failed" : "completed"}` : "Tool started",
      detail: [event.item.server, toolName].filter(Boolean).join(" · "),
      toolCall: {
        id: event.item.id ?? null,
        name: toolName,
        category: "mcp",
        server: event.item.server ?? null,
        phase: completed ? "completed" : "started",
        result: completed
          ? conciseToolResult(event.item.result ?? event.item.output ?? event.item.error?.message ?? event.item.error)
          : null,
      },
    };
  }

  if (event.type === "item.completed" && event.item?.type === "agent_message") {
    return { type: "message", text: event.item.text ?? event.item.content ?? "" };
  }

  if (event.type === "turn.completed" && event.usage) {
    const inputTokens = Number(event.usage.input_tokens ?? 0);
    const cachedInputTokens = Number(event.usage.cached_input_tokens ?? 0);
    const cacheWriteTokens = Number(event.usage.cache_write_input_tokens ?? event.usage.cache_write_tokens ?? 0);
    const outputTokens = Number(event.usage.output_tokens ?? 0);
    return {
      type: "usage",
      usage: {
        inputTokens,
        cachedInputTokens,
        cacheWriteTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
      },
    };
  }

  return null;
}

function isRuntimeContextPreflightCommand(command) {
  const tokens = tokenizeRuntimePreflight(command);
  if (!tokens || tokens[0] !== "rg") return false;
  const positional = [];
  for (let index = 1; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (["-n", "--line-number", "-F", "--fixed-strings"].includes(token)) continue;
    if (["-C", "--context", "-m", "--max-count"].includes(token)) {
      index += 1;
      if (!/^\d+$/.test(tokens[index] ?? "")) return false;
      continue;
    }
    if (token.startsWith("-")) return false;
    positional.push(token);
  }
  if (positional.length !== 2 || !/^[A-Za-z0-9_.|\\:\-\s]+$/.test(positional[0])) return false;
  if (/[\$~]/.test(positional[1])) return false;
  const memoryRoot = path.resolve(process.env.CODEX_HOME ?? path.join(os.homedir(), ".codex"), "memories");
  return ["MEMORY.md", "memory_summary.md"].some((name) => positional[1] === path.join(memoryRoot, name));
}

function tokenizeRuntimePreflight(command) {
  if (Array.isArray(command)) return null;
  let source = String(command ?? "").trim();
  if (/[\r\n]/.test(source)) return null;
  const shell = source.match(/^(?:(?:\/bin\/)?(?:zsh|bash|sh))\s+-lc\s+([\s\S]+)$/);
  if (shell) {
    const argument = shell[1].trim();
    const quote = argument[0];
    if (!["'", "\""].includes(quote) || argument.at(-1) !== quote) return null;
    source = argument.slice(1, -1);
  }
  const tokens = [];
  let token = "";
  let quote = null;
  let escaped = false;
  const flush = () => {
    if (!token) return;
    tokens.push(token);
    token = "";
  };
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (escaped) {
      token += character;
      escaped = false;
      continue;
    }
    if (quote) {
      if (character === quote) quote = null;
      else if (character === "\\" && quote === "\"") escaped = true;
      else token += character;
      continue;
    }
    if (["'", "\""].includes(character)) {
      quote = character;
      continue;
    }
    if (/\s/.test(character)) {
      flush();
      continue;
    }
    if (["|", "&", ";", ">", "<", "`"].includes(character) || (character === "$" && source[index + 1] === "(")) {
      return null;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }
    token += character;
  }
  if (quote || escaped) return null;
  flush();
  return tokens;
}

export async function runCodex({
  cwd,
  prompt,
  signal,
  timeoutMs = 240_000,
  sandbox = "read-only",
  networkAccess = false,
  tempDirectory = null,
  model = DEFAULT_MODEL,
  reasoning = DEFAULT_REASONING,
  onEvent = () => {},
}) {
  const binary = await locateCodex();
  if (!binary) throw new Error("Codex CLI was not found. Install Codex and sign in with ChatGPT first.");
  if (!["read-only", "workspace-write"].includes(sandbox)) throw new Error(`Unsupported Codex sandbox: ${sandbox}`);

  const args = buildCodexSpawnArgs({ cwd, sandbox, networkAccess, model, reasoning });
  const runtimeTemp =
    tempDirectory ??
    process.env.AGENT_HARNESS_TEMP ??
    (process.platform === "win32" ? "C:\\tmp\\agent-harness" : path.join(os.tmpdir(), "agent-harness"));
  await mkdir(runtimeTemp, { recursive: true });
  const childEnv = buildCodexEnvironment(process.env, runtimeTemp);

  const result = await runProcess(binary, args, {
    timeoutMs,
    signal,
    env: childEnv,
    input: prompt,
    stdoutBudgetBytes: STDOUT_BUDGET,
    label: "Codex",
    onStdoutLine(line) {
      const parsed = parseCodexEvent(line);
      if (parsed) onEvent(parsed);
    },
  });
  if (result.code !== 0) {
    throw new Error(extractFailure(result.stdout) ?? cleanStderr(result.stderr) ?? `Codex exited with code ${result.code}.`);
  }

  let finalText = "";
  let usage = { inputTokens: 0, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 0, totalTokens: 0 };
  for (const line of result.stdout.split(/\r?\n/)) {
    const parsed = parseCodexEvent(line);
    if (parsed?.type === "message" && parsed.text.trim()) finalText = parsed.text.trim();
    if (parsed?.type === "usage") usage = parsed.usage;
  }
  if (!finalText) throw new Error("Codex completed without returning an artifact.");
  return { finalText, usage };
}

export function buildCodexSpawnArgs({ cwd, sandbox, networkAccess = false, model, reasoning }) {
  if (!["read-only", "workspace-write"].includes(sandbox)) throw new Error(`Unsupported Codex sandbox: ${sandbox}`);
  return [
    "exec",
    "--json",
    // Stage runs must not inherit optional desktop plugins, global skills or memory
    // instructions. Authentication still comes from CODEX_HOME, as documented by the
    // CLI, while the repository's own AGENTS.md remains available from `cwd`.
    "--ephemeral",
    "--ignore-user-config",
    "--disable",
    "memories",
    "--skip-git-repo-check",
    "--sandbox",
    sandbox,
    ...(networkAccess && sandbox === "workspace-write"
      ? ["-c", "sandbox_workspace_write.network_access=true"]
      : []),
    "--model",
    model,
    "-c",
    `model_reasoning_effort=\"${reasoning}\"`,
    "--cd",
    cwd,
    "-",
  ];
}

export function buildCodexEnvironment(source, runtimeTemp) {
  const allowed = [
    "PATH",
    "PATHEXT",
    "SYSTEMROOT",
    "WINDIR",
    "COMSPEC",
    "USERPROFILE",
    "HOMEDRIVE",
    "HOMEPATH",
    "APPDATA",
    "LOCALAPPDATA",
    "CODEX_HOME",
    "CODEX_BIN",
    "LANG",
    "LC_ALL",
    "TERM",
    "SSL_CERT_FILE",
    "SSL_CERT_DIR",
  ];
  const entries = Object.entries(source ?? {});
  const environment = {};
  for (const name of allowed) {
    const entry = entries.find(([key]) => key.toUpperCase() === name);
    if (entry?.[1] != null && entry[1] !== "") environment[entry[0]] = entry[1];
  }
  environment.TEMP = runtimeTemp;
  environment.TMP = runtimeTemp;
  environment.TMPDIR = runtimeTemp;
  return environment;
}

function extractFailure(stdout) {
  const lines = stdout.split(/\r?\n/).reverse();
  for (const line of lines) {
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    const raw = event.type === "turn.failed" ? event.error?.message : event.type === "error" ? event.message : null;
    if (!raw) continue;
    try {
      const nested = JSON.parse(raw);
      return nested.error?.message ?? raw;
    } catch {
      return raw;
    }
  }
  return null;
}

function cleanStderr(stderr) {
  const meaningful = stderr
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !/\bWARN\b/.test(line) && !/Reading additional input from stdin/i.test(line));
  return meaningful.at(-1) ?? null;
}

function commandResult(item) {
  if (Number.isInteger(item.exit_code)) return `Exit code ${item.exit_code}`;
  const exposed = item.aggregated_output ?? item.output ?? item.stderr ?? item.stdout;
  return exposed == null ? null : "Command completed with output (content not retained)";
}

/**
 * The Codex execution provider. Binary discovery, auth probe, spawn argv, the env
 * allowlist, event schema, usage extraction and sandbox mapping stay here; the
 * process machinery is shared through `process-runtime.mjs`.
 */
export const codexExecutionProvider = {
  id: "codex",
  label: "Codex",
  locate: locateCodex,
  status: getCodexStatus,
  catalog: () => readCodexModelCatalog(),
  defaults: () => ({ model: DEFAULT_MODEL, reasoning: DEFAULT_REASONING }),
  capabilities: () => ({
    // `codex exec --sandbox` is a single OS-level guarantee covering the agent's
    // own edits and anything it spawns, with no model-reachable waiver.
    sandboxes: { "read-only": "os-enforced", "workspace-write": "os-enforced" },
    confinementVerifiedBy: "provider",
    networkIsolation: true,
    grantsNetworkAccess: true,
    supportsReasoningLevels: true,
    stdoutBudgetBytes: STDOUT_BUDGET,
  }),
  run: runCodex,
  parseEvent: parseCodexEvent,
};
