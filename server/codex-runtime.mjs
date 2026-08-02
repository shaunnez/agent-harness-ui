import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { normalizeModelId, readCodexModelCatalog } from "./model-catalog.mjs";

const STDOUT_LIMIT = 2 * 1024 * 1024;
const STDERR_LIMIT = 256 * 1024;
const STDOUT_BUDGET = 2.5 * 1024 * 1024;
export const DEFAULT_MODEL = normalizeModelId(process.env.AGENT_HARNESS_MODEL ?? "gpt-5.4-mini");
export const DEFAULT_REASONING = process.env.AGENT_HARNESS_REASONING ?? "low";

export async function locateCodex() {
  if (process.env.CODEX_BIN) return process.env.CODEX_BIN;
  const command = process.platform === "win32" ? "where.exe" : "which";
  const result = await runProcess(command, ["codex"], { timeoutMs: 5_000 });
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
    const result = await runProcess(binary, ["login", "status"], { timeoutMs: 10_000 });
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

async function getClaudeStatus() {
  try {
    const locator = await runProcess(process.platform === "win32" ? "where.exe" : "which", ["claude"], { timeoutMs: 5_000 });
    const binary = locator.stdout.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
    if (!binary) return { id: "claude", label: "Claude", available: false, authenticated: false, executionEnabled: false, detail: "Not found" };
    const status = await runProcess(binary, ["auth", "status"], { timeoutMs: 10_000 });
    let authenticated = status.code === 0;
    try {
      authenticated = Boolean(JSON.parse(status.stdout).loggedIn);
    } catch {
      authenticated = status.code === 0 && /logged.?in|authenticated/i.test(`${status.stdout}\n${status.stderr}`);
    }
    return { id: "claude", label: "Claude", available: true, authenticated, executionEnabled: false, detail: authenticated ? "Signed in; execution not wired" : "Login required" };
  } catch {
    return { id: "claude", label: "Claude", available: false, authenticated: false, executionEnabled: false, detail: "Not found" };
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
    };
  }

  if (event.type === "item.completed" && event.item?.type === "command_execution") {
    const succeeded = event.item.status === "completed" || event.item.exit_code === 0;
    return {
      type: "activity",
      tone: succeeded ? "success" : "warning",
      title: succeeded ? "Repository command completed" : "Repository command returned a warning",
      detail: formatCommand(event.item.command),
      commandFailed: !succeeded,
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

export async function runCodex({
  cwd,
  prompt,
  signal,
  timeoutMs = 240_000,
  sandbox = "read-only",
  tempDirectory = null,
  model = DEFAULT_MODEL,
  reasoning = DEFAULT_REASONING,
  onEvent = () => {},
}) {
  const binary = await locateCodex();
  if (!binary) throw new Error("Codex CLI was not found. Install Codex and sign in with ChatGPT first.");
  if (!["read-only", "workspace-write"].includes(sandbox)) throw new Error(`Unsupported Codex sandbox: ${sandbox}`);

  const args = [
    "exec",
    "--json",
    "--skip-git-repo-check",
    "--sandbox",
    sandbox,
    "--model",
    model,
    "-c",
    `model_reasoning_effort=\"${reasoning}\"`,
    "--cd",
    cwd,
    "-",
  ];
  const childEnv = { ...process.env };
  delete childEnv.OPENAI_API_KEY;
  delete childEnv.CODEX_API_KEY;
  const runtimeTemp =
    tempDirectory ??
    process.env.AGENT_HARNESS_TEMP ??
    (process.platform === "win32" ? "C:\\tmp\\agent-harness" : path.join(os.tmpdir(), "agent-harness"));
  await mkdir(runtimeTemp, { recursive: true });
  childEnv.TEMP = runtimeTemp;
  childEnv.TMP = runtimeTemp;
  childEnv.TMPDIR = runtimeTemp;

  const result = await runProcess(binary, args, {
    timeoutMs,
    signal,
    env: childEnv,
    input: prompt,
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

function formatCommand(command) {
  if (Array.isArray(command)) return command.join(" ").slice(0, 220);
  return String(command ?? "Repository inspection").replace(/\s+/g, " ").slice(0, 220);
}

function runProcess(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      windowsHide: true,
      stdio: [options.input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stdoutBytes = 0;
    let stderr = "";
    let pending = "";
    let settled = false;

    if (options.input !== undefined) child.stdin.end(options.input);

    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
      callback(value);
    };
    const abort = () => {
      child.kill();
      finish(reject, new Error("Codex run cancelled."));
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(reject, new Error(`Codex run exceeded ${Math.round((options.timeoutMs ?? 0) / 1000)} seconds.`));
    }, options.timeoutMs ?? 240_000);

    options.signal?.addEventListener("abort", abort, { once: true });
    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      stdoutBytes += Buffer.byteLength(chunk);
      if (stdoutBytes > STDOUT_BUDGET) {
        child.kill();
        finish(reject, new Error("Codex exceeded the stage evidence-output budget. Narrow the task and retry."));
        return;
      }
      stdout = `${stdout}${text}`.slice(-STDOUT_LIMIT);
      pending += text;
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() ?? "";
      for (const line of lines) if (line.trim()) options.onStdoutLine?.(line);
    });
    child.stderr.on("data", (chunk) => {
      stderr = `${stderr}${chunk.toString()}`.slice(-STDERR_LIMIT);
    });
    child.on("error", (error) => finish(reject, error));
    child.on("close", (code, signalName) => {
      if (pending.trim()) options.onStdoutLine?.(pending);
      finish(resolve, { code: code ?? (signalName ? 1 : 0), signal: signalName, stdout, stderr });
    });
  });
}
