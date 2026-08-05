import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { isProcessTimeoutError, runProcess } from "./process-runtime.mjs";

/**
 * Harness-executed verification.
 *
 * The test stage used to spend a model call and a sandboxed shell running deterministic
 * commands, then report what happened in prose. That has two costs. It forces
 * `networkAccess: true`, which is why the stage cannot run on Claude at all (#40) and needs
 * Codex credits. And it makes the harness unable to distinguish "ran the suite" from "ran
 * something adjacent and described it plausibly", because the only account of what happened
 * came from the thing being trusted.
 *
 * So the harness runs the commands and a model only interprets the result. Three properties
 * carry the determinism claim, and each is enforced here rather than asserted:
 *
 * 1. **Commands come from the repository, never from a model.** They are read from a
 *    committed manifest at `.agent-harness/verification.json` in the candidate worktree. The
 *    plan stage's model-authored `verification` strings are advisory prose for a human and
 *    are deliberately *not* an input to this file. If a model could choose or amend the
 *    command, harness execution would buy nothing — it would just move the same
 *    unverifiable claim one layer down.
 * 2. **Argv, not a shell string.** A command is an array and is spawned directly, so there
 *    is no shell to interpolate, expand or chain in something the manifest does not say.
 * 3. **Machine-readable where the repository offers it.** A declared report file is parsed
 *    and the parsed counts decide the row's status. Prose output is retained for a human but
 *    is never the source of a fact.
 *
 * **What this stage now depends on instead, stated plainly because it is a real trade:** the
 * harness's own execution environment, which is **not sandboxed**. Commands from the
 * repository's manifest run with the harness's privileges — that is the point (a test suite
 * needs a database, a compose stack, a loopback port), and it is strictly better than a
 * model choosing what to run. But it means the harness trusts the repository it is pointed
 * at. Pointing it at a repository whose manifest you have not read is arbitrary code
 * execution, and no sandbox stands behind it. See `docs/architecture` and the #47 PR.
 */

export const VERIFICATION_MANIFEST_PATH = path.join(".agent-harness", "verification.json");

/** One command's own ceiling. The stage's overall budget is the caller's timeout. */
export const DEFAULT_COMMAND_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_COMMANDS = 20;
const RETAINED_OUTPUT_CHARS = 4_000;

export class VerificationConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = "VerificationConfigError";
    this.code = "VERIFICATION_CONFIG";
  }
}

/**
 * Report formats the harness can check for itself. Keyed by the `format` a manifest
 * declares, so an unknown format is a refusal rather than a silent downgrade to
 * exit-code-only — a manifest that believes it is being checked machine-readably must not
 * quietly be believed on its exit code alone.
 */
export const REPORT_PARSERS = Object.freeze({
  "playwright-json": parsePlaywrightJsonReport,
});

/**
 * Validate a manifest. Pure, so every refusal is testable without a filesystem, and strict
 * on purpose: a manifest the harness half-understands is how an unverified command ends up
 * treated as verified.
 */
export function parseVerificationManifest(raw, source = VERIFICATION_MANIFEST_PATH) {
  let value;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    throw new VerificationConfigError(`${source} is not valid JSON: ${error.message}`);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new VerificationConfigError(`${source} must contain a JSON object.`);
  }
  if (value.version !== 1) {
    throw new VerificationConfigError(`${source} must declare "version": 1.`);
  }
  if (!Array.isArray(value.commands) || !value.commands.length) {
    throw new VerificationConfigError(`${source} must declare a non-empty commands array.`);
  }
  if (value.commands.length > MAX_COMMANDS) {
    throw new VerificationConfigError(`${source} declares ${value.commands.length} commands; at most ${MAX_COMMANDS} are allowed.`);
  }
  const ids = new Set();
  const commands = value.commands.map((entry, index) => {
    const label = `${source} command ${index + 1}`;
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new VerificationConfigError(`${label} must be an object.`);
    }
    if (typeof entry.id !== "string" || !/^[a-z0-9][a-z0-9-]{0,39}$/.test(entry.id)) {
      throw new VerificationConfigError(`${label} needs a lowercase id of letters, digits and dashes.`);
    }
    if (ids.has(entry.id)) throw new VerificationConfigError(`${source} repeats command id ${entry.id}.`);
    ids.add(entry.id);
    if (typeof entry.command === "string") {
      // Named explicitly because it is the tempting shape and it defeats the point: a shell
      // string can expand, chain and substitute things the manifest does not say, so what
      // ran would no longer be what was declared.
      throw new VerificationConfigError(
        `${label} command must be an argv array, not a string — the harness spawns it directly and never through a shell.`,
      );
    }
    if (!Array.isArray(entry.command) || !entry.command.length) {
      throw new VerificationConfigError(`${label} command must be a non-empty argv array.`);
    }
    for (const argument of entry.command) {
      if (typeof argument !== "string" || !argument.length) {
        throw new VerificationConfigError(`${label} command arguments must all be non-empty strings.`);
      }
    }
    if (entry.title != null && typeof entry.title !== "string") {
      throw new VerificationConfigError(`${label} title must be a string.`);
    }
    if (entry.timeoutMs != null && (!Number.isInteger(entry.timeoutMs) || entry.timeoutMs <= 0)) {
      throw new VerificationConfigError(`${label} timeoutMs must be a positive integer.`);
    }
    return {
      id: entry.id,
      title: typeof entry.title === "string" && entry.title.trim() ? entry.title.trim() : entry.id,
      command: [...entry.command],
      timeoutMs: entry.timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS,
      report: parseReportDeclaration(entry.report, label),
    };
  });
  return { version: 1, source, commands };
}

function parseReportDeclaration(report, label) {
  if (report == null) return null;
  if (typeof report !== "object" || Array.isArray(report)) {
    throw new VerificationConfigError(`${label} report must be an object.`);
  }
  if (!Object.hasOwn(REPORT_PARSERS, report.format)) {
    throw new VerificationConfigError(
      `${label} report format ${JSON.stringify(report.format)} is not one the harness can parse (${Object.keys(REPORT_PARSERS).join(", ")}).`,
    );
  }
  if (typeof report.outputFile !== "string" || !report.outputFile.trim()) {
    throw new VerificationConfigError(`${label} report needs an outputFile path relative to the repository root.`);
  }
  if (path.isAbsolute(report.outputFile)) {
    throw new VerificationConfigError(`${label} report outputFile must be repository-relative, not absolute.`);
  }
  return { format: report.format, outputFile: report.outputFile.trim() };
}

export async function readVerificationManifest(worktreePath) {
  const source = path.join(worktreePath, VERIFICATION_MANIFEST_PATH);
  const raw = await readFile(source, "utf8").catch(() => null);
  if (raw == null) {
    // Refused, not fallen back to. Falling back to a model-chosen command would give the
    // harness evidence it cannot check while looking exactly like evidence it can.
    throw new VerificationConfigError(
      `This repository declares no verification commands, so the harness cannot verify the candidate. `
        + `Add ${VERIFICATION_MANIFEST_PATH} with {"version":1,"commands":[{"id":"test","command":["npm","test"]}]} `
        + `and commit it. Commands must come from the repository so that what ran is what was declared.`,
    );
  }
  return parseVerificationManifest(raw, VERIFICATION_MANIFEST_PATH);
}

/**
 * Resolve a declared report file inside the worktree, refusing anything that escapes it.
 * Mirrors the worktree path guard: a manifest is repository content, so it is data to be
 * checked rather than a path to be trusted.
 */
export function resolveReportPath(worktreePath, outputFile) {
  const root = path.resolve(worktreePath);
  const resolved = path.resolve(root, outputFile);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new VerificationConfigError(`Report outputFile ${outputFile} resolves outside the candidate worktree.`);
  }
  return resolved;
}

/**
 * Playwright's JSON reporter. Counts are read from the report's own totals rather than
 * inferred from prose, and a report that does not look like one is a refusal — an
 * unparseable report is an unverified command, which fails closed.
 */
export function parsePlaywrightJsonReport(raw, source = "report") {
  let value;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    throw new VerificationConfigError(`${source} is not valid JSON: ${error.message}`);
  }
  const stats = value?.stats;
  if (!stats || typeof stats !== "object") {
    throw new VerificationConfigError(`${source} has no stats object; it does not look like a Playwright JSON report.`);
  }
  const counts = {};
  for (const field of ["expected", "unexpected", "flaky", "skipped"]) {
    const count = stats[field];
    if (count != null && (!Number.isInteger(count) || count < 0)) {
      throw new VerificationConfigError(`${source} stats.${field} must be a non-negative integer.`);
    }
    counts[field] = count ?? 0;
  }
  const total = counts.expected + counts.unexpected + counts.flaky + counts.skipped;
  if (!total) {
    // Zero tests is not a pass. A suite that ran nothing proves nothing, and it is the
    // failure mode a misconfigured filter produces.
    return { passed: false, counts, detail: `${source} reports no tests at all, so nothing was verified.` };
  }
  const passed = counts.unexpected === 0 && counts.flaky === 0;
  return {
    passed,
    counts,
    detail: passed
      ? `${counts.expected} expected, ${counts.skipped} skipped`
      : `${counts.unexpected} unexpected, ${counts.flaky} flaky, ${counts.expected} expected`,
  };
}

/**
 * The evidence contract's top-level `command` field wants one string, but harness
 * verification runs several. Naming the manifest and the ids is honest; joining the argv
 * lines with `&&` would read as a single shell command that was never run.
 */
export function verificationSummaryCommand(manifest) {
  return `${manifest.source}: ${manifest.commands.map((command) => command.id).join(", ")}`;
}

export function formatArgv(argv) {
  return argv.map((argument) => (/[\s"']/.test(argument) ? JSON.stringify(argument) : argument)).join(" ");
}

/**
 * Execute the repository's declared verification commands against a candidate worktree and
 * return evidence in the existing `validateFocusedTestEvidence` shape.
 *
 * The shape is deliberately unchanged — this changes where evidence comes from, not what it
 * looks like — so every consumer, gate-freshness rule and merge check keeps working. What
 * changes is that every field is now something the harness observed.
 */
export async function runRepositoryVerification({
  worktreePath,
  candidate,
  manifest,
  signal,
  now = () => new Date().toISOString(),
  runCommand = runVerificationCommand,
  readHeadRevision = gitHeadRevision,
}) {
  if (!candidate?.id || !Number.isInteger(candidate?.revisionNumber)) {
    throw new Error("Harness verification requires an active candidate identity.");
  }
  const resolved = manifest ?? (await readVerificationManifest(worktreePath));
  // The SHA is read here, not taken on trust, and again after the commands finish. Evidence
  // that does not name the tree it was produced from is evidence about nothing, and the test
  // stage is expected to dirty its worktree — so the commit must be what is pinned, and it
  // must still be pinned when the commands are done.
  const headRevision = await assertCandidateHead(worktreePath, candidate, readHeadRevision);
  const startedAt = now();
  const started = Date.now();
  const rows = [];
  for (const command of resolved.commands) {
    rows.push(await runCommand({ command, worktreePath, candidate, signal }));
    // Stop at the first failure: later commands run against a tree a previous command may
    // have left in a state nobody declared, and the verdict is already decided.
    if (rows.at(-1).status !== "passed") break;
  }
  const completedAt = now();
  await assertCandidateHead(worktreePath, candidate, readHeadRevision);
  return {
    headRevision,
    candidateId: candidate.id,
    candidateRevision: candidate.revisionNumber,
    bindingExplicit: true,
    command: verificationSummaryCommand(resolved),
    status: rows.every((row) => row.status === "passed") ? "passed" : "failed",
    startedAt,
    completedAt,
    durationMs: Math.max(0, Date.now() - started),
    rows,
    // Not part of the contract's checked fields; carried so the interpretation prompt and a
    // human reader can see which commands were skipped after a failure stopped the run.
    executedCommandIds: rows.map((row) => row.id),
    declaredCommandIds: resolved.commands.map((command) => command.id),
  };
}

/**
 * Assert the worktree is at the candidate's exact commit. Separate from
 * `verifyCandidate` in `GitWorktreeManager`, which brackets the whole stage: this narrows the
 * window to the commands themselves, so evidence cannot be attributed to a revision that was
 * only true either side of them.
 */
export async function assertCandidateHead(worktreePath, candidate, readHeadRevision = gitHeadRevision) {
  const expected = candidate?.headRevision;
  // A candidate with no recorded head cannot be bound to one. Callers reach this only for a
  // candidate that has been committed, so this is a programming error rather than a verdict.
  if (typeof expected !== "string" || !expected) {
    throw new Error("Harness verification requires a candidate with a recorded head revision.");
  }
  const observed = await readHeadRevision(worktreePath);
  if (observed !== expected) {
    throw new Error(
      `The candidate worktree is at ${observed || "an unknown revision"} but the candidate records ${expected}; verification evidence would describe a different commit.`,
    );
  }
  return observed;
}

async function gitHeadRevision(worktreePath) {
  const result = await runProcess("git", ["rev-parse", "HEAD"], {
    cwd: worktreePath,
    timeoutMs: 30_000,
    label: "verification:rev-parse",
  });
  if (result.code !== 0) throw new Error(`Could not read the candidate worktree's HEAD: ${result.stderr.trim()}`);
  return result.stdout.trim();
}

async function runVerificationCommand({ command, worktreePath, candidate, signal }) {
  const display = formatArgv(command.command);
  const started = Date.now();
  const row = {
    id: command.id,
    candidateId: candidate.id,
    candidateRevision: candidate.revisionNumber,
    bindingExplicit: true,
    title: command.title,
    command: display,
  };
  let result = null;
  let timedOut = false;
  try {
    result = await runProcess(command.command[0], command.command.slice(1), {
      cwd: worktreePath,
      // The harness's own environment, unsandboxed and deliberately so: this is the trade
      // the stage makes in exchange for a database, a compose stack or a loopback port
      // being reachable at all.
      env: process.env,
      timeoutMs: command.timeoutMs,
      signal,
      label: `verification:${command.id}`,
    });
  } catch (error) {
    timedOut = isProcessTimeoutError(error);
    if (!timedOut) {
      return {
        ...row,
        status: "failed",
        durationMs: Math.max(0, Date.now() - started),
        failureDetails: `${display} could not run: ${error instanceof Error ? error.message : String(error)}`,
        assertions: [{ label: "command started", actual: "no", expected: "yes" }],
      };
    }
  }
  const durationMs = Math.max(0, Date.now() - started);
  if (timedOut) {
    return {
      ...row,
      status: "failed",
      durationMs,
      failureDetails: `${display} exceeded its ${Math.round(command.timeoutMs / 1_000)}s budget and was terminated.`,
      assertions: [{ label: "completed within budget", actual: "no", expected: "yes" }],
    };
  }

  const assertions = [{ label: "exit code", actual: String(result.code), expected: "0" }];
  let reportOutcome = null;
  let reportError = null;
  if (command.report) {
    try {
      const reportPath = resolveReportPath(worktreePath, command.report.outputFile);
      const raw = await readFile(reportPath, "utf8");
      reportOutcome = REPORT_PARSERS[command.report.format](raw, command.report.outputFile);
      assertions.push({
        label: `${command.report.format} report`,
        actual: reportOutcome.detail,
        expected: "no unexpected or flaky results",
      });
    } catch (error) {
      // A declared report the harness cannot read means the command was not checked the way
      // the manifest says it is checked. That is unverified, and unverified is not passed.
      reportError = error instanceof Error ? error.message : String(error);
      assertions.push({ label: `${command.report.format} report`, actual: "unreadable", expected: "parseable" });
    }
  }
  const passed = result.code === 0 && !reportError && (reportOutcome ? reportOutcome.passed : true);
  return {
    ...row,
    status: passed ? "passed" : "failed",
    durationMs,
    // Always an array, never omitted. `isValidPersistedTestRow` in `run-activity.mjs` requires
    // `artifactReferences` and `assertions` to be arrays on every persisted row, and gate
    // freshness re-derives the verdict from the *persisted* summary rather than from the
    // in-memory evidence. An omitted field there reads as contradictory evidence and turns a
    // passing candidate into a repair — which is what it did until this was measured.
    artifactReferences: command.report
      ? [{ name: `${command.id} report`, kind: command.report.format, path: command.report.outputFile }]
      : [],
    assertions,
    failureDetails: passed
      ? null
      : [
        result.code === 0 ? null : `${display} exited ${result.code}.`,
        reportError ? `Declared report ${command.report.outputFile} could not be used: ${reportError}` : null,
        reportOutcome && !reportOutcome.passed ? reportOutcome.detail : null,
        retainedOutput(result),
      ].filter(Boolean).join("\n"),
  };
}

function retainedOutput(result) {
  const text = `${result?.stdout ?? ""}\n${result?.stderr ?? ""}`.trim();
  if (!text) return null;
  return text.length > RETAINED_OUTPUT_CHARS ? `…${text.slice(-RETAINED_OUTPUT_CHARS)}` : text;
}
