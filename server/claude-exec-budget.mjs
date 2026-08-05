import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { runProcess } from "./process-runtime.mjs";

/**
 * The Bash sandbox exec-argument budget.
 *
 * On macOS the Bash tool does not spawn `sandbox-exec` directly. It builds one
 * command *string* — `env … /usr/bin/sandbox-exec -p <PROFILE> <shell> -c <cmd>` —
 * and hands it to the outer shell as `zsh -c <string>`. The seatbelt profile is
 * therefore inlined on the command line, and `E2BIG` is that string exceeding
 * `ARG_MAX`. Every registered worktree in the repository adds three deny paths under
 * the *main* repository's `.git/worktrees/<name>/`, each of which expands into a rule
 * per ancestor component, so the budget is **per repository** and shared by every
 * concurrent stage running against it. Sweep and method in
 * `docs/claude-execution-provider-design.md`, §"What actually causes the write-stage
 * E2BIG — measured".
 *
 * Two rules govern this file, and they are the reason it looks the way it does.
 *
 * 1. **Measure, do not model.** Reimplementing the CLI's rule expansion here would
 *    produce a number that looks exact and goes stale — silently, and in the
 *    optimistic direction — the first time the CLI changes profile generation. So the
 *    authoritative path measures the real argv of a real CLI run (`measuredBytes`),
 *    and **only a measurement may refuse a stage.** `extrapolatedExecArgBoundBytes` is
 *    a fallback for *reporting* headroom when no measurement could be taken, it is
 *    labelled a bound and not an estimate everywhere it appears, and it is not allowed
 *    to gate anything — see the note on that function for the measured reason why.
 * 2. **Every input the stage varies, the check must vary** — the standing rule above
 *    `classifyClaudeWriteCanary`. What this check varies: repository, registered
 *    worktree count, cwd, and sandbox posture. What it deliberately holds fixed, and
 *    why each is safe to hold fixed:
 *    - **The command text.** The probe runs `/usr/bin/true` while a stage runs real
 *      commands. Only the `<cmd>` tail of the string differs, tens of bytes against a
 *      ~700 KB profile, and the reserve below is three orders of magnitude larger.
 *    - **The model.** The probe uses the cheapest model; the model never appears in
 *      the Bash exec argv at all.
 *    - **The environment size.** Measured at 1.5 KB across 24 vars and accounted in
 *      the same limit; the probe measures its own environment, which is built by the
 *      same `buildClaudeEnvironment` a stage uses.
 */

/** Measured on this host with `getconf ARG_MAX`, and the value the CLI's own E2BIG message implies. */
export const EXEC_ARG_LIMIT_BYTES = 1_048_576;

/**
 * One sweep data point, and **not a floor** despite the sweep having called it one: a
 * scratch repo at 3 registered worktrees and a 64-char cwd measured this much. A minimal
 * repo at a 12-char path later measured 346,302 — less than half — because the sweep's
 * repo carried its own root prefix through every rule in the profile. So this is the
 * anchor the extrapolation starts from, nothing more; there is no host floor to know.
 */
export const MEASURED_FLOOR_BYTES = 702_185;
export const MEASURED_FLOOR_WORKTREES = 3;
export const MEASURED_FLOOR_CWD_CHARS = 64;

/**
 * Measured two independent ways: ≈14.4 KB per worktree in the sweep, and 12,681 B per
 * worktree from a same-repo pair that differed only in registrations ((726,741 − 346,302)
 * / 30). The higher figure is used so the arithmetic charges more per worktree rather than
 * less. This is the one quantity here that travelled between layouts.
 */
export const MEASURED_BYTES_PER_WORKTREE = 14_414;

/**
 * The **worst** measured per-cwd-character cost, not the typical one: ≈301 B/char at 3
 * worktrees but ≈2,670 B/char at 11 with a deeper path, because a deeper cwd both
 * lengthens every rule and adds deny paths, so the factors interact multiplicatively.
 * The bound uses the worst of the two on purpose — see rule 1 above.
 */
export const BOUND_BYTES_PER_CWD_CHAR = 2_670;

/**
 * Held back from the ceiling, expressed in worktrees rather than as a percentage
 * because worktrees are the unit that consumes it.
 *
 * The preflight is inherently racy: the budget is per repository, so another task can
 * register a worktree between this check and the spawn, or during the run. Four
 * worktrees of slack is the price of that race being survivable rather than merely
 * detected. It is not a substitute for the mid-run guard — see the comment on
 * `preflightClaudeExecArgBudget`.
 */
export const PREFLIGHT_RESERVE_BYTES = 4 * MEASURED_BYTES_PER_WORKTREE;

/**
 * The inlined-profile exec limit is macOS seatbelt behaviour. Elsewhere the Bash tool
 * does not build this string, so there is no budget to preflight and the check reports
 * itself inapplicable rather than inventing a verdict for a mechanism that is absent.
 */
export function execArgBudgetApplies(platform = process.platform) {
  return platform === "darwin";
}

/**
 * Bucket the cwd length so the cache key does not change on every distinct task id.
 * A bucket is one worktree's worth of cwd characters (≈48 measured), rounded to 50,
 * so crossing a bucket is crossing something worth re-measuring.
 */
export const CWD_LENGTH_BUCKET_CHARS = 50;

export function cwdLengthBucket(length) {
  return Math.floor(Math.max(0, Number(length) || 0) / CWD_LENGTH_BUCKET_CHARS);
}

/**
 * Count what the CLI counts: entries under the **main** repository's
 * `.git/worktrees/`. That directory is the enumeration the deny paths are generated
 * from, so reading it directly avoids depending on `git worktree list`'s output shape.
 */
export async function readRegisteredWorktrees(cwd) {
  const common = await runProcess("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], {
    cwd,
    timeoutMs: 10_000,
    label: "git",
  }).catch(() => null);
  const gitCommonDir = common?.code === 0 ? common.stdout.trim() : "";
  if (!gitCommonDir) return { repositoryRoot: null, registeredWorktrees: null };
  const entries = await readdir(path.join(gitCommonDir, "worktrees"), { withFileTypes: true }).catch(() => null);
  return {
    repositoryRoot: path.dirname(gitCommonDir),
    // A missing directory means no worktree has ever been registered, which is a
    // count of zero. An unreadable one is not distinguishable here, and both give the
    // same answer the CLI would give.
    registeredWorktrees: entries ? entries.filter((entry) => entry.isDirectory()).length : 0,
  };
}

/**
 * A **bound**, not an estimate and not a prediction: extrapolated from the measured
 * sweep using the measured per-worktree cost and the *worst* measured per-character
 * cost, never subtracting below the measured floor.
 *
 * It is not allowed to refuse a stage, and this is measured rather than cautious. It has
 * been observed wrong in **both** directions, which is the whole argument:
 *
 * - 3 worktrees under a deep `/private/var/folders` root measured **765,023** where this
 *   gives **731,555** — ~33 KB *optimistic*, the direction that would wave through a
 *   stage about to die.
 * - 30 worktrees at a 12-char path measured **726,741** where this gives **1,091,363** —
 *   365 KB *pessimistic*, and past the ceiling: it would have refused 30 worktrees that in
 *   fact ran fine.
 *
 * Both follow from the same missing input: the repository root prefix repeats in every one
 * of the profile's thousands of rules, and the deny-path *set* varies by layout. So it
 * reports headroom and says it is a bound; `classifyExecArgBudget` refuses only on a
 * measurement.
 *
 * Do not "fix" this by adding a root-depth term. That is the road back to modelling the
 * CLI's rule expansion, which goes stale silently the moment the CLI changes profile
 * generation — the false-green class the standing rule exists for. If a tighter number
 * is needed, take a measurement.
 */
export function extrapolatedExecArgBoundBytes({ registeredWorktrees, cwdLength }) {
  const worktrees = Math.max(0, Number(registeredWorktrees) || 0);
  const chars = Math.max(0, Number(cwdLength) || 0);
  return MEASURED_FLOOR_BYTES
    + Math.max(0, worktrees - MEASURED_FLOOR_WORKTREES) * MEASURED_BYTES_PER_WORKTREE
    + Math.max(0, chars - MEASURED_FLOOR_CWD_CHARS) * BOUND_BYTES_PER_CWD_CHAR;
}

/**
 * Decide what an observed budget state means, and report the numbers an operator can
 * act on rather than only a boolean. Pure, so the safety-critical property — that an
 * exhausted budget refuses and names the remedy — is testable without spawning a CLI.
 *
 * Precedence, highest first:
 *
 * 1. An **observed** E2BIG outranks every computed number. It is the failure itself,
 *    not a prediction of it.
 * 2. A measured byte count outranks the bound.
 * 3. The bound reports and never refuses, for the measured reason on
 *    `extrapolatedExecArgBoundBytes`.
 * 4. Inapplicable, uncountable and unmeasured states report themselves as such and do
 *    not refuse. They are not passes in the canary's sense — nothing was verified — but
 *    refusing over a missing measurement rather than over a real ceiling would disable
 *    stages that run fine, and commit `856ed50` still fails the run if the shell cannot
 *    start. That trade is recorded here so it is a decision rather than an oversight.
 */
export function classifyExecArgBudget({
  sandbox = "read-only",
  applicable = true,
  repositoryRoot = null,
  registeredWorktrees = null,
  cwdLength = 0,
  measuredBytes = null,
  e2bigObserved = false,
  limitBytes = EXEC_ARG_LIMIT_BYTES,
  reserveBytes = PREFLIGHT_RESERVE_BYTES,
} = {}) {
  const base = {
    sandbox,
    applicable,
    repositoryRoot,
    registeredWorktrees,
    cwdLength,
    limitBytes,
    reserveBytes,
    bytesPerWorktree: MEASURED_BYTES_PER_WORKTREE,
  };
  if (!applicable) {
    return {
      ...base,
      ok: true,
      source: "not-applicable",
      usedBytes: null,
      availableBytes: null,
      worktreesRemaining: null,
      refusal: null,
      detail: "The inlined-profile exec limit is macOS-specific, so there is no exec-argument budget to preflight on this platform.",
    };
  }
  if (e2bigObserved) {
    // The probe's own shell could not start, so the number is not merely over the
    // bound — the ceiling has already been crossed at this cwd and worktree count.
    return {
      ...base,
      ok: false,
      source: "measured",
      usedBytes: null,
      availableBytes: 0,
      worktreesRemaining: 0,
      detail: "A probe run could not start a shell at this cwd (E2BIG), so the exec argument list already exceeds the OS ceiling.",
      refusal: execArgBudgetRefusal({ ...base, usedBytes: null, observed: true }),
    };
  }
  if (registeredWorktrees == null) {
    return {
      ...base,
      ok: true,
      source: "unavailable",
      usedBytes: null,
      availableBytes: null,
      worktreesRemaining: null,
      refusal: null,
      detail: "The registered worktree count for this repository could not be read, so the exec-argument budget was not established; the mid-run shell-start guard remains the only check.",
    };
  }
  const measured = Number.isFinite(measuredBytes) && measuredBytes > 0;
  const usedBytes = measured ? Math.round(measuredBytes) : extrapolatedExecArgBoundBytes({ registeredWorktrees, cwdLength });
  const headroomBytes = limitBytes - reserveBytes - usedBytes;
  const availableBytes = Math.max(0, headroomBytes);
  const worktreesRemaining = Math.floor(availableBytes / MEASURED_BYTES_PER_WORKTREE);
  const source = measured ? "measured" : "bound";
  const spend = `${usedBytes.toLocaleString("en-US")} of ${limitBytes.toLocaleString("en-US")} exec argument bytes`;
  const at = `at ${registeredWorktrees} registered worktrees`;
  const report = { ...base, source, usedBytes, availableBytes, worktreesRemaining };
  if (!measured) {
    // Reported, never refused. `worktreesRemaining` is still the number an operator
    // wants, and saying which side of the ceiling the extrapolation lands on is more
    // use than withholding it — but the wording must not let a bound read as an
    // observation, because it is capable of being wrong in either direction.
    return {
      ...report,
      ok: true,
      measurementUnavailable: true,
      refusal: null,
      detail: headroomBytes <= 0
        ? `No measurement could be taken; the bound puts this repository at ${spend} ${at}, already past the ceiling. The bound is not evidence and does not refuse a stage, so the mid-run shell-start guard remains the only check here.`
        : `${spend} bounded ${at}; ${availableBytes.toLocaleString("en-US")} bytes spare after the ${reserveBytes.toLocaleString("en-US")}-byte concurrency reserve, so about ${worktreesRemaining} more worktree${worktreesRemaining === 1 ? "" : "s"} fit by the bound, which is an extrapolation rather than a measurement.`,
    };
  }
  if (headroomBytes <= 0) {
    return {
      ...report,
      ok: false,
      detail: `${spend} are spent ${at}, leaving no room for the ${reserveBytes.toLocaleString("en-US")}-byte concurrency reserve.`,
      refusal: execArgBudgetRefusal({ ...report, observed: false }),
    };
  }
  return {
    ...report,
    ok: true,
    refusal: null,
    detail: `${spend} measured ${at}; ${availableBytes.toLocaleString("en-US")} bytes spare after the ${reserveBytes.toLocaleString("en-US")}-byte concurrency reserve, so ${worktreesRemaining} more worktree${worktreesRemaining === 1 ? "" : "s"} fit.`,
  };
}

/**
 * The refusal an operator sees, and the only thing they need in order to act.
 *
 * It never prunes. A registered worktree may hold someone's uncommitted work, so
 * removing one to make room for a stage would trade a loud recoverable failure for a
 * quiet unrecoverable one. The commands are named so the operator makes that judgement
 * per worktree, and there is deliberately no flag that skips this check.
 */
export function execArgBudgetRefusal({
  sandbox = "read-only",
  repositoryRoot = null,
  registeredWorktrees = null,
  usedBytes = null,
  limitBytes = EXEC_ARG_LIMIT_BYTES,
  reserveBytes = PREFLIGHT_RESERVE_BYTES,
  observed = false,
} = {}) {
  const where = repositoryRoot ? ` in ${repositoryRoot}` : "";
  const spend = usedBytes == null
    ? "already exceeds"
    : `needs ${usedBytes.toLocaleString("en-US")} of`;
  const ceiling = `${limitBytes.toLocaleString("en-US")}-byte OS exec argument ceiling`;
  return [
    `A Claude ${sandbox} stage cannot spawn${where}: the Bash sandbox profile is inlined on the command line, and this repository's`,
    `${registeredWorktrees ?? "unknown"} registered worktrees put it at ${spend} the ${ceiling}`,
    observed
      ? "— a probe run could not start a shell here at all."
      : `(${reserveBytes.toLocaleString("en-US")} bytes are held back for worktrees another task may register while this stage runs).`,
    "The budget is per repository and shared by every concurrent stage on it.",
    `Free capacity by removing worktrees whose work has landed — each removal returns about ${MEASURED_BYTES_PER_WORKTREE.toLocaleString("en-US")} bytes:`,
    "`git worktree list`, then `git worktree remove <path>` for each worktree you no longer need, then `git worktree prune`.",
    "Nothing is removed automatically, because a worktree can hold uncommitted work.",
  ].join(" ");
}

const SHIM_OUTPUT_FILE = "argv-bytes";

/**
 * The CLI validates `CLAUDE_CODE_SHELL` by *path*, not by asking the file what it is:
 * a path that does not read as a bash/zsh path is rejected with "is not a valid
 * bash/zsh path, falling back to detection" and the override is silently ignored.
 * Verified on 2.1.222 by measuring with three shim names — `zsh` and `measure-zsh`
 * both took effect, `measure-shell.sh` was ignored and recorded nothing.
 *
 * So the shim is named after the shell it hands off to. Naming rather than content is
 * the whole reason this matters, and a rejected override degrades to no measurement at
 * all — which classifies to the reported bound, and a bound never refuses.
 */
function shimFileName(realShell) {
  return `measure-${path.basename(realShell)}`;
}

/**
 * A shell shim that records the exec argument bytes it was handed and then execs the
 * real shell unchanged.
 *
 * This is how the sweep was measured and it is the reason the preflight can be
 * measured rather than modelled: it observes the CLI's own output instead of
 * predicting it, so it survives the CLI changing profile generation. Hazards it is
 * built against:
 *
 * - It sits in the exec path of every command the run makes, so it belongs to a
 *   short-lived probe run and never to a stage's own spawn.
 * - Both the output path and the real shell are baked in at generation time. The shim
 *   reads no environment variable and takes no argument as input, so nothing a model
 *   can influence reaches it.
 * - Measurement is best-effort and wrapped so that a failure to measure can never
 *   fail the command: the `exec` at the end is unconditional and passes `"$@"`
 *   through untouched.
 * - `wc -c` counts bytes, not characters, deliberately — the limit is a byte limit.
 */
export function argvMeasuringShimScript({ outputPath, realShell }) {
  return [
    "#!/bin/sh",
    "# Harness-generated. Records the exec argument bytes of this invocation, then execs",
    "# the real shell unchanged. Generated per probe run in harness-owned temp; takes no",
    "# input from the environment or from arguments.",
    "(",
    "  bytes=0",
    '  for arg in "$0" "$@"; do',
    "    # One NUL terminator per argument is charged in the same limit as the bytes.",
    `    n=$(printf '%s' "$arg" | wc -c | tr -d ' ')`,
    "    bytes=$((bytes + n + 1))",
    "  done",
    `  envbytes=$(env | wc -c | tr -d ' ')`,
    `  echo "$((bytes + envbytes))" >> ${JSON.stringify(outputPath)}`,
    ") 2>/dev/null || true",
    `exec ${JSON.stringify(realShell)} "$@"`,
    "",
  ].join("\n");
}

/**
 * The shell the shim hands off to: the operator's own `SHELL`, which is what the CLI
 * would have invoked without the shim, but only when it is one the CLI's own override
 * validation accepts. Anything else falls back to the shell the CLI's E2BIG message
 * names, which is also what its own detection would land on.
 */
export function resolveRealShell(environment = process.env) {
  const shell = environment?.SHELL;
  const usable = typeof shell === "string" && path.isAbsolute(shell) && /(bash|zsh)$/.test(path.basename(shell));
  return usable ? shell : "/bin/zsh";
}

export async function createArgvMeasuringShim(directory, { realShell = resolveRealShell() } = {}) {
  await mkdir(directory, { recursive: true });
  const outputPath = path.join(directory, SHIM_OUTPUT_FILE);
  const shimPath = path.join(directory, shimFileName(realShell));
  await writeFile(outputPath, "", "utf8");
  await writeFile(shimPath, argvMeasuringShimScript({ outputPath, realShell }), { encoding: "utf8", mode: 0o700 });
  return { shimPath, outputPath, realShell };
}

/**
 * The largest invocation the shim saw, which is the one that has to fit. A run makes
 * several Bash calls of slightly different lengths and only the longest is at risk.
 */
export async function readArgvMeasurement(outputPath) {
  const raw = await readFile(outputPath, "utf8").catch(() => "");
  const values = raw
    .split("\n")
    .map((line) => Number.parseInt(line.trim(), 10))
    .filter((value) => Number.isFinite(value) && value > 0);
  return values.length ? Math.max(...values) : null;
}
