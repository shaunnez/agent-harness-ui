import { spawn } from "node:child_process";
import process from "node:process";

/**
 * Provider-agnostic child-process machinery.
 *
 * Extracted from `codex-runtime.mjs`: process-tree termination, abort handling,
 * the timeout path and the concise-result helpers are the same for every
 * execution provider and must not be duplicated per provider. Two things became
 * per-call options rather than module constants — the streamed stdout budget, so
 * a provider whose wire format carries full tool output can raise it without
 * touching the retained tail or the "content not retained" discipline; and the
 * run label, so a timeout or cancellation names the provider that actually timed
 * out. Both providers pass an explicit label, so the neutral default only ever
 * appears for a directly constructed error with no provider context.
 */

export const STDOUT_LIMIT = 2 * 1024 * 1024;
export const STDERR_LIMIT = 256 * 1024;
export const DEFAULT_STDOUT_BUDGET = 2.5 * 1024 * 1024;
export const DEFAULT_RUN_LABEL = "Agent";

export class ProcessTimeoutError extends Error {
  constructor(timeoutMs, label = DEFAULT_RUN_LABEL) {
    super(`${label} run exceeded ${Math.round(timeoutMs / 1_000)} seconds.`);
    this.name = "ProcessTimeoutError";
    this.code = "PROCESS_TIMEOUT";
    this.timeoutMs = timeoutMs;
    this.label = label;
  }
}

export function isProcessTimeoutError(error) {
  return error instanceof ProcessTimeoutError;
}

const FORMAT_COMMAND_LIMIT = 220;

/**
 * Truncates silently rather than lying about what ran: a cut string with no
 * marker reads as the whole command, which made a denied multi-line script
 * look like it was missing its `&&`/`;` separators instead of just being cut
 * off mid-line.
 */
export function formatCommand(command) {
  const joined = Array.isArray(command) ? command.join(" ") : String(command ?? "Repository inspection").replace(/\s+/g, " ");
  if (joined.length <= FORMAT_COMMAND_LIMIT) return joined;
  return `${joined.slice(0, FORMAT_COMMAND_LIMIT)}…`;
}

export function conciseToolResult(value) {
  if (value == null) return null;
  if (typeof value === "string") return `Text result · ${value.length} characters (content not retained)`;
  if (Array.isArray(value)) return `Array result · ${value.length} items (content not retained)`;
  if (typeof value === "object") return "Structured result (content not retained)";
  return `${typeof value} result (content not retained)`;
}

export function runProcess(command, args, options = {}) {
  const label = options.label ?? DEFAULT_RUN_LABEL;
  if (options.signal?.aborted) return Promise.reject(new Error(`${label} run cancelled before launch.`));
  const stdoutBudget = options.stdoutBudgetBytes ?? DEFAULT_STDOUT_BUDGET;
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      windowsHide: true,
      detached: process.platform !== "win32",
      stdio: [options.input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stdoutBytes = 0;
    let stderr = "";
    let pending = "";
    let settled = false;
    let terminating = false;
    let closeResult = null;
    let resolveClose;
    const closePromise = new Promise((resolveClosePromise) => {
      resolveClose = resolveClosePromise;
    });

    if (options.input !== undefined) child.stdin.end(options.input);

    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
      callback(value);
    };
    const terminate = async (error) => {
      if (settled || terminating) return;
      terminating = true;
      clearTimeout(timer);
      await terminateProcessTree(child, false);
      let closed = await waitForClose(closePromise, 2_000);
      if (!closed) {
        await terminateProcessTree(child, true);
        closed = await waitForClose(closePromise, 3_000);
      } else {
        await terminateProcessTree(child, true);
      }
      if (!closed) error.message = `${error.message} The process tree did not close after forced termination.`;
      finish(reject, error);
    };
    const abort = () => void terminate(new Error(`${label} run cancelled.`));
    const timer = setTimeout(() => {
      void terminate(new ProcessTimeoutError(options.timeoutMs ?? 240_000, label));
    }, options.timeoutMs ?? 240_000);

    options.signal?.addEventListener("abort", abort, { once: true });
    if (options.signal?.aborted) abort();
    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      stdoutBytes += Buffer.byteLength(chunk);
      if (stdoutBytes > stdoutBudget) {
        void terminate(new Error(`${label} exceeded the stage evidence-output budget. Narrow the task and retry.`));
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
    child.on("error", (error) => {
      resolveClose?.(null);
      if (!terminating) finish(reject, error);
    });
    child.on("close", (code, signalName) => {
      if (pending.trim()) options.onStdoutLine?.(pending);
      closeResult = { code: code ?? (signalName ? 1 : 0), signal: signalName, stdout, stderr };
      resolveClose?.(closeResult);
      if (!terminating) finish(resolve, closeResult);
    });
  });
}

export async function terminateProcessTree(child, force) {
  if (!child.pid) return;
  if (process.platform === "win32") {
    await runTreeKill(["/pid", String(child.pid), "/T", ...(force ? ["/F"] : [])]);
    return;
  }
  try {
    process.kill(-child.pid, force ? "SIGKILL" : "SIGTERM");
  } catch (error) {
    if (error?.code !== "ESRCH") {
      try {
        child.kill(force ? "SIGKILL" : "SIGTERM");
      } catch {
        // The close wait below remains the authoritative termination check.
      }
    }
  }
}

export function runTreeKill(args) {
  return new Promise((resolve) => {
    const killer = spawn("taskkill.exe", args, { windowsHide: true, stdio: "ignore" });
    killer.on("error", () => resolve());
    killer.on("close", () => resolve());
  });
}

export async function waitForClose(closePromise, timeoutMs) {
  return Promise.race([
    closePromise.then(() => true),
    new Promise((resolve) => setTimeout(() => resolve(false), timeoutMs)),
  ]);
}
