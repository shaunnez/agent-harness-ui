// One isolated normal harness workflow. The caller prepares/fingerprints the trial;
// provider-native profiles confine model tools; a child OS profile confines verification.
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApiServer } from "../../server/api.mjs";
import { normalizeEvaluationInput } from "../../server/evaluation.mjs";
import { GitWorktreeManager } from "../../server/git-worktree.mjs";
import { priceModelUsage, priceUsage } from "../../server/model-catalog.mjs";
import { TaskOrchestrator } from "../../server/orchestrator.mjs";
import { runProcess } from "../../server/process-runtime.mjs";
import { SqliteTaskStore } from "../../server/sqlite-store.mjs";

const [configurationPath] = process.argv.slice(2);
const config = JSON.parse(await readFile(configurationPath, "utf8"));
process.env.CODEX_BIN = config.codexWrapper;
process.env.CLAUDE_BIN = config.claudeWrapper;
process.env.GIT_CONFIG_COUNT = "1";
process.env.GIT_CONFIG_KEY_0 = "commit.gpgsign";
process.env.GIT_CONFIG_VALUE_0 = "false";
const store = new SqliteTaskStore(path.join(config.privateRoot, "tasks.sqlite3"));
await store.init();
await store.updateSettings((settings) => {
  settings.allowedModels = config.allowedModels;
  settings.defaultModel = config.defaultModel ?? "gpt-5.6-sol";
  settings.defaultReasoning = "high";
  settings.grillPolicy = "manual";
  settings.gatePolicies = config.gatePolicies;
  if (config.repairLimits) settings.repairLimits = structuredClone(config.repairLimits);
});
const worktrees = new GitWorktreeManager(path.join(config.publicRoot, "w"));
const verificationEnvironment = Object.fromEntries(
  Object.entries(process.env).filter(([key]) =>
    [
      "PATH",
      "HOME",
      "USER",
      "LOGNAME",
      "SHELL",
      "TMPDIR",
      "TMP",
      "TEMP",
      "LANG",
      "LC_ALL",
      "GIT_CONFIG_COUNT",
      "GIT_CONFIG_KEY_0",
      "GIT_CONFIG_VALUE_0",
    ].includes(key),
  ),
);
const runVerification = async ({ signal, onQueueWait: _onQueueWait, ...input }) => {
  const result = await runProcess(
    "/usr/bin/sandbox-exec",
    [
      "-f",
      config.workerProfile,
      process.execPath,
      fileURLToPath(new URL("./verification-worker.mjs", import.meta.url)),
    ],
    {
      cwd: input.worktreePath,
      env: verificationEnvironment,
      input: JSON.stringify(input),
      signal,
      timeoutMs: config.taskInput.experiment.budget.maxWallTimeMs,
      stdoutBudgetBytes: 5_000_000,
      label: "isolated-verification",
    },
  );
  if (result.code !== 0) throw new Error(`Isolated verifier failed: ${result.stderr}`);
  return JSON.parse(result.stdout.trim());
};
const orchestrator = new TaskOrchestrator(store, {
  worktreeManager: worktrees,
  packageConcurrency: 1,
  runVerification,
});
const server = createApiServer({
  store,
  orchestrator,
  worktreeManager: worktrees,
  suggestedRepository: config.repository,
  csrfToken: "isolated-evaluation",
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let taskId;
let endReason = "workflow stopped";
const startedAt = Date.now();
try {
  const response = await fetch(`${origin}/api/tasks`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-agent-harness-csrf": "isolated-evaluation" },
    body: JSON.stringify(config.taskInput),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(`Task creation failed: ${body.error}`);
  taskId = body.task.id;
  // Freeze the existing runtime override onto this isolated task before any run.
  // Production defaults and all model/effort assignments remain unchanged.
  if (Object.keys(config.stageTimeoutOverridesMs ?? {}).length) {
    await store.update(taskId, (draft) => {
      draft.stageTimeoutOverridesMs = { ...config.stageTimeoutOverridesMs };
    });
  }
  await writeFile(path.join(config.privateRoot, "task-id.txt"), taskId);
  await writeFile(
    config.ledger,
    JSON.stringify(
      {
        deadline: startedAt / 1000 + config.taskInput.experiment.budget.maxWallTimeMs / 1000,
        invocations: [],
      },
      null,
      2,
    ),
  );
  if (process.argv.includes("--preflight")) {
    endReason = "zero-inference preflight only";
    console.log(JSON.stringify({ trial: config.trialId, taskId, preflight: true, inferenceCalls: 0 }));
  } else {
    await orchestrator.start(taskId);
    let lastState = "";
    let idleSince = null;
    for (;;) {
      const task = await store.get(taskId);
      const state = `${task.status}/${task.currentStage}/${task.runs.length}`;
      if (state !== lastState) {
        console.log(JSON.stringify({ trial: config.trialId, taskId, state, at: new Date().toISOString() }));
        lastState = state;
      }
      if (Date.now() - startedAt >= config.taskInput.experiment.budget.maxWallTimeMs) {
        endReason = "delivery wall allowance exhausted";
        await orchestrator.cancel(taskId);
        break;
      }
      if (orchestrator.isRunning(taskId) || task.activeRunIds?.length) idleSince = null;
      else if (task.status === "awaiting-grill") {
        // Explicit benchmark-user simulation, identical facts for every arm. No dynamic advice.
        for (const question of task.grillSession.questions.filter((entry) => !entry.answer))
          await orchestrator.answerGrillQuestion(taskId, {
            questionId: question.id,
            answer: config.answerSheet,
            source: "operator",
          });
        await orchestrator.finishGrill(taskId, { acceptRemaining: false, source: "operator" });
        idleSince = null;
      } else {
        idleSince ??= Date.now();
        // Auto-transitions reserve asynchronously. A quiet stopped workflow is finalized;
        // blocked/repair-required are not treated as terminal while a run is active.
        if (Date.now() - idleSince > 3000) {
          endReason = `${task.status}: ${task.error ?? "workflow quiescent"}`;
          break;
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
} catch (error) {
  endReason = `worker error: ${error.message}`;
  await writeFile(path.join(config.privateRoot, "worker-error.txt"), error.stack);
  if (taskId) await orchestrator.cancel(taskId);
} finally {
  await orchestrator.shutdown();
  const deliveryEndedAt = new Date().toISOString();
  if (taskId) {
    const ledger = JSON.parse(await readFile(config.ledger, "utf8"));
    const providerInvocations = ledger.invocations.map((entry) => ({
      id: entry.id,
      provider: entry.provider,
      model: entry.model,
      usage:
        entry.usage == null
          ? null
          : {
              ...entry.usage,
              totalTokens: entry.totalTokens,
              cost: priceModelUsage(entry.modelUsage) ?? priceUsage(entry.model, entry.usage),
              credits: null,
            },
    }));
    await store.update(taskId, (draft) => {
      draft.evaluation = normalizeEvaluationInput(
        {
          trial: {
            status: "completed",
            reason: endReason.slice(0, 1000),
            evaluator: "isolated-runner-v1",
            evidence: config.privateRoot,
            deliveryEndedAt,
            providerInvocations,
          },
        },
        draft.evaluation,
        draft,
      );
    });
    await writeFile(
      path.join(config.privateRoot, "task.json"),
      JSON.stringify(await store.get(taskId), null, 2),
    );
  }
  await writeFile(
    path.join(config.privateRoot, "delivery-ended.json"),
    JSON.stringify(
      { taskId, endReason, deliveryEndedAt, startedAt: new Date(startedAt).toISOString() },
      null,
      2,
    ),
  );
  await new Promise((resolve) => server.close(resolve));
  store.close();
}
