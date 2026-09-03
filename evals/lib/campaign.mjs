// Campaign orchestration for the eval runner (WP3, docs/model-evaluation-plan.md section 5).
// `scripts/run-eval-suite.mjs` is the thin CLI wrapper; everything that touches the filesystem,
// git, or the harness API lives here so it can be exercised directly against a fake HTTP server
// in `tests/eval-runner.test.mjs`.
import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { exportCandidatePatch } from "../../server/campaign-export.mjs";

const exec = promisify(execFile);

// Section 6.6 / evaluation.mjs's TERMINAL_STATUSES minus the merge/PR states this runner must
// never reach (see FORBIDDEN_ACTIONS below) — the plan's own stop list (section 5, step 4).
const TERMINAL_STOP_STATUSES = new Set(["awaiting-human-approval", "blocked", "failed", "cancelled"]);

// `awaiting-spec-approval`, `awaiting-plan-approval`, and `awaiting-grill` are section 3.1's
// three named gates: a task normally clears them on its own via `grillPolicy`/`gatePolicy`. If
// the runner still finds a task parked at one, it is the documented fallback operator and must
// call the same endpoint the UI calls (handled explicitly in `advanceParkedTask` below),
// recording that it did so in `runnerApprovals` (a high count is itself a finding, per the plan).
//
// Every other status that requires an explicit "start the next stage" call before the task can
// progress at all (see docs/eval-spike-2026-09-03-wp0b-verification.md's documented gaps: a
// fresh task sits at `queued` until `run` is called, and `ready-for-implementation` sits until
// `implement` is called). None of these pause for a human decision — an operator would just
// click the single available button — so they are not gates and are not counted as
// `runnerApprovals`.
const STAGE_ADVANCE_ACTIONS = {
  queued: "run",
  "ready-for-implementation": "implement",
  "repair-required": "repair",
  "ready-for-review": "review",
  "review-retry-required": "review",
  "ready-for-test": "test",
  "ready-for-final-review": "final-review",
};

// Guardrail (docs/model-evaluation-plan.md section 8): never call these from any evaluation
// code. There is no code path above that can produce them; this set exists only so a future
// edit cannot accidentally add one to STAGE_ADVANCE_ACTIONS without grepping past this comment.
export const FORBIDDEN_ACTIONS = Object.freeze(["approve-merge", "open-pr", "complete-merged"]);

const GATE_STAGES = ["dev-review", "test", "final-review"];

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomLabel(length = 6) {
  const alphabet = "abcdefghijklmnopqrstuvwxyz";
  let label = "";
  for (let index = 0; index < length; index += 1) {
    label += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return label;
}

/** Real `git worktree add --detach`. Tests inject a fake to avoid needing a real target repo. */
export async function addDetachedWorktree({ repositoryPath, worktreePath, sha }) {
  await mkdir(path.dirname(worktreePath), { recursive: true });
  const alreadyExists = await readFile(path.join(worktreePath, ".git"), "utf8").catch(() => null);
  if (alreadyExists) return; // `--resume`: reuse an existing worktree for this pair.
  await exec("git", ["worktree", "add", "--detach", worktreePath, sha], { cwd: repositoryPath });
}

/**
 * Clears exactly one parked status, mutating `runnerApprovals` when the status was one of the
 * three named gates. Returns `false` when the status is `running` or otherwise unrecognized —
 * the caller stops rather than guessing at an action the plan does not name.
 */
async function advanceParkedTask(client, task, { campaignId, runnerApprovals }) {
  const status = task.status;
  const note = `eval-runner:${campaignId}`;
  if (status === "awaiting-spec-approval") {
    await client.approveSpecification(task.id, note);
    runnerApprovals.push({ stage: "specification", status, action: "approve-spec", at: new Date().toISOString() });
    return true;
  }
  if (status === "awaiting-plan-approval") {
    await client.approvePlan(task.id, note);
    runnerApprovals.push({ stage: "plan", status, action: "approve-plan", at: new Date().toISOString() });
    return true;
  }
  if (status === "awaiting-grill") {
    await client.finishGrill(task.id, { acceptRemaining: true });
    runnerApprovals.push({ stage: "grill", status, action: "grill/finish", at: new Date().toISOString() });
    return true;
  }
  const action = STAGE_ADVANCE_ACTIONS[status];
  if (!action) return false;
  await client.runAction(task.id, action);
  return true;
}

/**
 * Polls a task to a stop point: one of the plan's four terminal statuses, an unrecognized
 * status the runner has no action for, or `--timeout-minutes` elapsed (which cancels the task
 * and records `terminalState: "timeout"`, per section 5 step 4).
 */
export async function pollUntilStopped(
  client,
  taskId,
  { campaignId, pollIntervalMs, timeoutAt, sleepFn = sleep, nowFn = Date.now },
) {
  const runnerApprovals = [];
  let task = await client.getTask(taskId);
  for (;;) {
    if (TERMINAL_STOP_STATUSES.has(task.status)) {
      return { task, terminalState: task.status, runnerApprovals };
    }
    if (nowFn() >= timeoutAt) {
      await client.cancel(taskId).catch(() => {});
      task = await client.getTask(taskId).catch(() => task);
      return { task, terminalState: "timeout", runnerApprovals };
    }
    if (task.status !== "running") {
      const cleared = await advanceParkedTask(client, task, { campaignId, runnerApprovals });
      if (!cleared) return { task, terminalState: task.status, runnerApprovals };
    }
    await sleepFn(pollIntervalMs);
    task = await client.getTask(taskId);
  }
}

function repairCountFor(task) {
  return (task.candidates ?? []).reduce(
    (sum, candidate) => sum + (candidate.revisions ?? []).filter((revision) => revision.reason === "repair").length,
    0,
  );
}

function gateVerdictsFor(task) {
  return (task.artifacts ?? [])
    .filter((artifact) => GATE_STAGES.includes(artifact.stage) && artifact.gateResult)
    .map((artifact) => ({
      stage: artifact.stage,
      verdict: artifact.gateResult.verdict ?? null,
      candidateRevision: artifact.gateResult.candidateRevision ?? artifact.candidateRevision ?? null,
      evaluatedAt: artifact.gateResult.evaluatedAt ?? null,
    }));
}

function wallTimeMsFor(task) {
  const end = task.completedAt ?? task.updatedAt ?? null;
  if (!task.startedAt || !end) return null;
  const duration = new Date(end).getTime() - new Date(task.startedAt).getTime();
  return Number.isFinite(duration) ? Math.max(0, duration) : null;
}

function buildManifestEntry({ kase, variantId, matrix, task, terminalState, runnerApprovals, bundleLabel }) {
  const candidate = task.candidates?.at(-1) ?? null;
  return {
    caseId: kase.caseId,
    variantId,
    taskId: task.id,
    terminalState,
    finalStatus: task.status,
    finalStage: task.currentStage,
    workPackageCount: task.workPackages?.length ?? 0,
    attemptsByStage: task.attemptsByStage ?? {},
    repairCount: repairCountFor(task),
    gates: gateVerdictsFor(task),
    usage: task.usage ?? null,
    wallTimeMs: wallTimeMsFor(task),
    requestedPolicyMatrix: matrix,
    policyMatrix: task.agentConfig?.stagePolicies ?? null,
    candidate: candidate
      ? {
          id: candidate.id,
          revisionNumber: candidate.revisionNumber ?? null,
          headRevision: candidate.headRevision ?? null,
          status: candidate.status ?? null,
        }
      : null,
    bundleLabel,
    runnerApprovals,
    recordedAt: new Date().toISOString(),
  };
}

async function writeVerificationSummary(candidate) {
  const run = candidate?.verificationRuns?.at(-1);
  if (!run) return "No verification run was recorded for this candidate.\n";
  const lines = (run.rows ?? []).map(
    (row) => `${row.status === "passed" ? "PASS" : "FAIL"}  ${(row.command ?? []).join(" ")}`,
  );
  lines.push("", `Overall: ${run.status} (${run.durationMs ?? "unknown"}ms)`);
  return `${lines.join("\n")}\n`;
}

/** Exports brief/acceptance/verification/candidate.patch into `bundle/<label>/`, per section 4.3. */
async function exportBundle({ dataRoot, campaignId, kase, task, worktreePath }) {
  const candidate = task.candidates.at(-1);
  const label = randomLabel();
  const bundleDir = path.join(dataRoot, campaignId, "bundle", label);
  await mkdir(bundleDir, { recursive: true });
  await writeFile(path.join(bundleDir, "brief.md"), `# ${kase.title}\n\n${kase.description}\n`, "utf8");
  await writeFile(
    path.join(bundleDir, "acceptance.md"),
    `${kase.acceptanceCriteria.map((criterion) => `- ${criterion}`).join("\n")}\n`,
    "utf8",
  );
  await writeFile(path.join(bundleDir, "verification.txt"), await writeVerificationSummary(candidate), "utf8");
  if (candidate?.headRevision && candidate?.baseRevision) {
    await exportCandidatePatch({
      repositoryPath: candidate.worktreePath ?? worktreePath,
      baseRevision: candidate.baseRevision,
      headRevision: candidate.headRevision,
      outputPath: path.join(bundleDir, "candidate.patch"),
    }).catch(async (error) => {
      await writeFile(path.join(bundleDir, "candidate.patch.error"), `${error.message}\n`, "utf8");
    });
  }
  return label;
}

async function readJsonFile(filePath, fallback) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}

function manifestPaths(dataRoot, campaignId) {
  const campaignDir = path.join(dataRoot, campaignId);
  return { campaignDir, manifestPath: path.join(campaignDir, "manifest.json"), variantMapPath: path.join(campaignDir, "variant-map.json") };
}

/** Runs at most `concurrency` async jobs at a time, preserving each job's own result/error. */
async function runWithConcurrency(items, concurrency, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  async function runNext() {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, runNext));
  return results;
}

/**
 * Runs one case x variant pair end to end: worktree, task creation, polling, and (when a
 * candidate exists) bundle export. Never returns a rejected promise for an ordinary harness
 * outcome (blocked/failed/timeout) — those are recorded in the manifest entry, per section 5
 * step "a blocked task is recorded and the runner continues to the next pair". A thrown error
 * here means the runner itself malfunctioned (e.g. the API was unreachable).
 */
export async function runPair({
  suite,
  kase,
  variantId,
  matrix,
  campaignId,
  client,
  worktreeRoot,
  dataRoot,
  timeoutMinutes,
  pollIntervalMs,
  sleepFn,
  nowFn = Date.now,
  addWorktree = addDetachedWorktree,
}) {
  const worktreePath = path.join(worktreeRoot, `${campaignId}-${kase.caseId}-${variantId}`);
  await addWorktree({ repositoryPath: suite.repositoryPath, worktreePath, sha: suite.frozenBaseSha });

  const created = await client.createTask({
    title: kase.title,
    description: kase.description,
    repositoryPath: worktreePath,
    workflow: kase.workflow,
    workflowProfile: kase.workflowProfile,
    attachments: kase.attachments,
    stagePolicies: matrix,
    grillPolicy: "auto-accept-recommendations",
    gatePolicy: { specification: "auto-on-clean", plan: "auto-on-clean" },
    experiment: {
      groupId: kase.caseId,
      variantId,
      frozenBaseSha: suite.frozenBaseSha,
      acceptanceCriteria: kase.acceptanceCriteria,
      verificationCommands: kase.verificationCommands,
    },
  });

  const timeoutAt = nowFn() + timeoutMinutes * 60_000;
  const { task, terminalState, runnerApprovals } = await pollUntilStopped(client, created.id, {
    campaignId,
    pollIntervalMs,
    timeoutAt,
    sleepFn,
    nowFn,
  });

  let bundleLabel = null;
  if ((task.candidates ?? []).length > 0) {
    bundleLabel = await exportBundle({ dataRoot, campaignId, kase, task, worktreePath });
  }

  return {
    entry: buildManifestEntry({ kase, variantId, matrix, task, terminalState, runnerApprovals, bundleLabel }),
    taskId: task.id,
  };
}

/**
 * Top-level campaign entry point: every case x every variant (section 2's definition of
 * "campaign"), honoring `--only-cases`/`--only-variants`, `--resume`, and `--concurrency`.
 */
export async function runEvalCampaign({
  suite,
  variants,
  campaignId,
  client,
  worktreeRoot,
  dataRoot = path.join(".data", "evaluations"),
  onlyCases,
  onlyVariants,
  concurrency = 1,
  timeoutMinutes = 90,
  pollIntervalMs = 15_000,
  sleepFn,
  nowFn = Date.now,
  addWorktree,
}) {
  // WP3b (docs/model-evaluation-plan.md section 5): resolve a relative `--worktree-root` to an
  // absolute path once, here, before it is used to build any per-pair worktree path. Every path
  // built from `worktreeRoot` below (the normal `repositoryPath` sent to `POST /api/tasks` in
  // `runPair`, and the `exportBundle` fallback) is a `path.join` off this value, so resolving it
  // once at the top of the campaign is sufficient to make all of them absolute.
  // `path.resolve` is a no-op for an input that is already absolute.
  worktreeRoot = path.resolve(worktreeRoot);
  const { campaignDir, manifestPath, variantMapPath } = manifestPaths(dataRoot, campaignId);
  await mkdir(campaignDir, { recursive: true });
  const manifest = await readJsonFile(manifestPath, { schemaVersion: 1, campaignId, suiteId: suite.suiteId, runs: [] });
  const variantMap = await readJsonFile(variantMapPath, {});
  const alreadyDone = new Set(manifest.runs.map((run) => `${run.caseId}|${run.variantId}`));

  const cases = onlyCases?.length ? suite.cases.filter((kase) => onlyCases.includes(kase.caseId)) : suite.cases;
  const variantIds = onlyVariants?.length
    ? [...variants.variants.keys()].filter((id) => onlyVariants.includes(id))
    : [...variants.variants.keys()];

  const pairs = [];
  for (const kase of cases) {
    for (const variantId of variantIds) {
      if (alreadyDone.has(`${kase.caseId}|${variantId}`)) continue; // --resume
      pairs.push({ kase, variantId, matrix: variants.variants.get(variantId) });
    }
  }

  // `manifest`/`variantMap` are mutated in place and re-serialized on every completed pair so a
  // crash mid-campaign loses at most one in-flight pair (`--resume` picks up from there). At
  // `--concurrency` above 1, multiple pairs finish interleaved; a bare `await writeFile(...)`
  // per pair would race (an older, smaller snapshot could finish writing after a newer one).
  // Chaining every write onto `persisted` instead forces them to complete in schedule order, and
  // since each write serializes whatever `manifest`/`variantMap` look like *when its turn comes
  // up* (monotonically growing), the last write in the chain always reflects every pair recorded
  // so far.
  let persisted = Promise.resolve();
  function persist() {
    persisted = persisted.then(() =>
      Promise.all([
        writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8"),
        writeFile(variantMapPath, JSON.stringify(variantMap, null, 2), "utf8"),
      ]),
    );
    return persisted;
  }

  await runWithConcurrency(pairs, concurrency, async ({ kase, variantId, matrix }) => {
    const { entry, taskId } = await runPair({
      suite,
      kase,
      variantId,
      matrix,
      campaignId,
      client,
      worktreeRoot,
      dataRoot,
      timeoutMinutes,
      pollIntervalMs,
      sleepFn,
      nowFn,
      addWorktree,
    });
    manifest.runs.push(entry);
    variantMap[taskId] = variantId;
    await persist();
  });

  return { manifest, manifestPath, variantMapPath, campaignDir };
}
