import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createHarnessClient } from "../evals/lib/harness-client.mjs";
import { FORBIDDEN_ACTIONS, runEvalCampaign } from "../evals/lib/campaign.mjs";

// WP3 (docs/model-evaluation-plan.md section 5): the runner is exercised against a fake HTTP
// server that scripts task-status transitions per action, exactly like the real companion but
// without the harness, git, or a model in the loop. `addWorktree`/`sleepFn` are faked too, so
// these tests run in milliseconds against no real repository.

const CSRF_TOKEN = "test-csrf-token";
const NOOP_SLEEP = async () => {};
const NOOP_ADD_WORKTREE = async () => {};

function makeCase(caseId, overrides = {}) {
  return {
    caseId,
    shape: "single-package",
    title: `Case ${caseId}`,
    description: `Description for ${caseId}`,
    workflow: "implement",
    workflowProfile: "auto",
    attachments: [],
    acceptanceCriteria: ["done"],
    verificationCommands: ["npm test"],
    ...overrides,
  };
}

function makeVariants(ids) {
  return {
    baselineId: ids[0],
    variants: new Map(ids.map((id) => [id, { triage: { model: "m", reasoning: "high" } }])),
  };
}

function makeSuite(cases) {
  return {
    suiteId: "core",
    repositoryPath: "/unused-in-tests",
    frozenBaseSha: "a".repeat(40),
    verificationCommands: ["npm test"],
    cases,
  };
}

/**
 * A minimal fake companion: `onAction(task, action, body)` mutates the in-memory task however
 * the test wants, and every request is recorded in `requestLog` so tests can assert exactly
 * which endpoints the runner called and with what body.
 *
 * `onAction` may return a `{ statusCode, error }` object instead of mutating the task, to script
 * the WP3c gate-conflict race: the fake server then responds with that status and an error body
 * shaped like `TASK_TRANSITION_CONFLICT` instead of the usual `202`.
 */
async function startFakeServer(onAction) {
  const tasks = new Map();
  const requestLog = [];
  let counter = 0;

  const server = createServer(async (request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");
    let raw = "";
    for await (const chunk of request) raw += chunk;
    const body = raw ? JSON.parse(raw) : undefined;
    requestLog.push({ method: request.method, path: url.pathname, body });

    const send = (status, value) => {
      const text = JSON.stringify(value);
      response.writeHead(status, { "content-type": "application/json" });
      response.end(text);
    };

    if (request.method === "GET" && url.pathname === "/api/runtime/status")
      return send(200, { csrfToken: CSRF_TOKEN });
    if (request.method === "GET" && url.pathname === "/api/settings")
      return send(200, { settings: { allowedModels: [] } });

    if (request.method === "POST" && url.pathname === "/api/tasks") {
      counter += 1;
      const id = `AH-${String(counter).padStart(3, "0")}`;
      const task = {
        id,
        title: body.title,
        status: "queued",
        currentStage: "triage",
        workPackages: [],
        candidates: [],
        artifacts: [],
        attemptsByStage: {},
        usage: { inputTokens: 10, outputTokens: 5 },
        agentConfig: { stagePolicies: body.stagePolicies },
        startedAt: new Date().toISOString(),
        completedAt: null,
        updatedAt: new Date().toISOString(),
      };
      tasks.set(id, task);
      return send(201, { task });
    }

    const match = url.pathname.match(/^\/api\/tasks\/([^/]+)(?:\/(.+))?$/);
    if (match) {
      const task = tasks.get(match[1]);
      if (!task) return send(404, { error: "Task not found." });
      if (request.method === "GET" && !match[2]) return send(200, { task });
      if (request.method === "POST" && match[2]) {
        const result = onAction(task, match[2], body);
        if (result?.statusCode) {
          return send(result.statusCode, { error: result.error ?? "Conflict.", code: result.code });
        }
        return send(202, { started: true });
      }
    }
    return send(404, { error: "Not found." });
  });

  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    requestLog,
    tasks,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

async function withTempDataRoot(run) {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), "eval-runner-"));
  try {
    return await run(dataRoot);
  } finally {
    await rm(dataRoot, { recursive: true, force: true });
  }
}

const HAPPY_PATH_TRANSITIONS = {
  run: "awaiting-spec-approval",
  "approve-spec": "awaiting-plan-approval",
  "approve-plan": "ready-for-implementation",
  implement: "ready-for-review",
  review: "ready-for-test",
  test: "ready-for-final-review",
  "final-review": "awaiting-human-approval",
};

test("happy path reaches awaiting-human-approval and writes one manifest entry", async () => {
  const fake = await startFakeServer((task, action) => {
    task.status = HAPPY_PATH_TRANSITIONS[action] ?? task.status;
  });
  try {
    await withTempDataRoot(async (dataRoot) => {
      const client = createHarnessClient({ baseUrl: fake.baseUrl });
      await client.connect();
      const { manifest, manifestPath } = await runEvalCampaign({
        suite: makeSuite([makeCase("case-a")]),
        variants: makeVariants(["baseline"]),
        campaignId: "campaign-test",
        client,
        worktreeRoot: path.join(dataRoot, "worktrees"),
        dataRoot,
        sleepFn: NOOP_SLEEP,
        addWorktree: NOOP_ADD_WORKTREE,
      });
      assert.equal(manifest.runs.length, 1);
      const [run] = manifest.runs;
      assert.equal(run.caseId, "case-a");
      assert.equal(run.variantId, "baseline");
      assert.equal(run.terminalState, "awaiting-human-approval");
      const persisted = JSON.parse(await readFile(manifestPath, "utf8"));
      assert.equal(persisted.runs.length, 1);
    });
  } finally {
    await fake.close();
  }
});

test("approval calls carry the campaign note", async () => {
  const fake = await startFakeServer((task, action) => {
    task.status = HAPPY_PATH_TRANSITIONS[action] ?? task.status;
  });
  try {
    await withTempDataRoot(async (dataRoot) => {
      const client = createHarnessClient({ baseUrl: fake.baseUrl });
      await client.connect();
      await runEvalCampaign({
        suite: makeSuite([makeCase("case-a")]),
        variants: makeVariants(["baseline"]),
        campaignId: "campaign-note-test",
        client,
        worktreeRoot: path.join(dataRoot, "worktrees"),
        dataRoot,
        sleepFn: NOOP_SLEEP,
        addWorktree: NOOP_ADD_WORKTREE,
      });
      const specApproval = fake.requestLog.find((entry) => entry.path.endsWith("/approve-spec"));
      const planApproval = fake.requestLog.find((entry) => entry.path.endsWith("/approve-plan"));
      assert.equal(specApproval.body.note, "eval-runner:campaign-note-test");
      assert.equal(planApproval.body.note, "eval-runner:campaign-note-test");
    });
  } finally {
    await fake.close();
  }
});

test("a blocked task is recorded and the runner continues to the next pair", async () => {
  const fake = await startFakeServer((task, action) => {
    if (task.title === "Case blocked-case") {
      if (action === "run") task.status = "blocked";
      return;
    }
    task.status = HAPPY_PATH_TRANSITIONS[action] ?? task.status;
  });
  try {
    await withTempDataRoot(async (dataRoot) => {
      const client = createHarnessClient({ baseUrl: fake.baseUrl });
      await client.connect();
      const { manifest } = await runEvalCampaign({
        suite: makeSuite([makeCase("blocked-case"), makeCase("healthy-case")]),
        variants: makeVariants(["baseline"]),
        campaignId: "campaign-blocked-test",
        client,
        worktreeRoot: path.join(dataRoot, "worktrees"),
        dataRoot,
        concurrency: 1,
        sleepFn: NOOP_SLEEP,
        addWorktree: NOOP_ADD_WORKTREE,
      });
      assert.equal(manifest.runs.length, 2);
      const byCase = Object.fromEntries(manifest.runs.map((run) => [run.caseId, run]));
      assert.equal(byCase["blocked-case"].terminalState, "blocked");
      assert.equal(byCase["healthy-case"].terminalState, "awaiting-human-approval");
    });
  } finally {
    await fake.close();
  }
});

test("timeout cancels the task and records terminalState timeout", async () => {
  const fake = await startFakeServer((task, action) => {
    if (action === "run") task.status = "running"; // never advances past "running" on its own
    if (action === "cancel") task.status = "cancelled";
  });
  try {
    await withTempDataRoot(async (dataRoot) => {
      const client = createHarnessClient({ baseUrl: fake.baseUrl });
      await client.connect();
      const { manifest } = await runEvalCampaign({
        suite: makeSuite([makeCase("slow-case")]),
        variants: makeVariants(["baseline"]),
        campaignId: "campaign-timeout-test",
        client,
        worktreeRoot: path.join(dataRoot, "worktrees"),
        dataRoot,
        timeoutMinutes: 0,
        sleepFn: NOOP_SLEEP,
        addWorktree: NOOP_ADD_WORKTREE,
      });
      assert.equal(manifest.runs.length, 1);
      assert.equal(manifest.runs[0].terminalState, "timeout");
      const cancelCall = fake.requestLog.find((entry) => entry.path.endsWith("/cancel"));
      assert.ok(cancelCall, "the runner must cancel a timed-out task");
    });
  } finally {
    await fake.close();
  }
});

test("--resume skips pairs already present in the manifest", async () => {
  const fake = await startFakeServer((task, action) => {
    task.status = HAPPY_PATH_TRANSITIONS[action] ?? task.status;
  });
  try {
    await withTempDataRoot(async (dataRoot) => {
      const client = createHarnessClient({ baseUrl: fake.baseUrl });
      await client.connect();
      const suite = makeSuite([makeCase("case-a"), makeCase("case-b")]);
      const variants = makeVariants(["baseline"]);
      const campaignId = "campaign-resume-test";
      const worktreeRoot = path.join(dataRoot, "worktrees");

      await runEvalCampaign({
        suite: makeSuite([makeCase("case-a")]),
        variants,
        campaignId,
        client,
        worktreeRoot,
        dataRoot,
        sleepFn: NOOP_SLEEP,
        addWorktree: NOOP_ADD_WORKTREE,
      });
      const createsAfterFirstRun = fake.requestLog.filter(
        (entry) => entry.method === "POST" && entry.path === "/api/tasks",
      ).length;
      assert.equal(createsAfterFirstRun, 1);

      const { manifest } = await runEvalCampaign({
        suite,
        variants,
        campaignId,
        client,
        worktreeRoot,
        dataRoot,
        sleepFn: NOOP_SLEEP,
        addWorktree: NOOP_ADD_WORKTREE,
      });

      const createsAfterResume = fake.requestLog.filter(
        (entry) => entry.method === "POST" && entry.path === "/api/tasks",
      ).length;
      assert.equal(createsAfterResume, 2, "only case-b's pair should create a new task on resume");
      assert.equal(manifest.runs.length, 2);
      assert.deepEqual(manifest.runs.map((run) => run.caseId).sort(), ["case-a", "case-b"]);
    });
  } finally {
    await fake.close();
  }
});

test("a relative --worktree-root resolves to an absolute repositoryPath (WP3b)", async () => {
  const fake = await startFakeServer((task, action) => {
    task.status = HAPPY_PATH_TRANSITIONS[action] ?? task.status;
  });
  try {
    await withTempDataRoot(async (dataRoot) => {
      const client = createHarnessClient({ baseUrl: fake.baseUrl });
      await client.connect();
      const relativeWorktreeRoot = path.join(".", "eval-runner-relative-worktree-root-fixture", "worktrees");
      await runEvalCampaign({
        suite: makeSuite([makeCase("case-a")]),
        variants: makeVariants(["baseline"]),
        campaignId: "campaign-relative-root-test",
        client,
        worktreeRoot: relativeWorktreeRoot,
        dataRoot,
        sleepFn: NOOP_SLEEP,
        addWorktree: NOOP_ADD_WORKTREE,
      });
      const createCall = fake.requestLog.find(
        (entry) => entry.method === "POST" && entry.path === "/api/tasks",
      );
      assert.ok(createCall, "task creation must have been requested");
      assert.ok(
        path.isAbsolute(createCall.body.repositoryPath),
        `repositoryPath must be absolute, got ${createCall.body.repositoryPath}`,
      );
      assert.equal(
        createCall.body.repositoryPath,
        path.resolve(relativeWorktreeRoot, "campaign-relative-root-test-case-a-baseline"),
      );
    });
  } finally {
    await fake.close();
  }
});

test("an already-absolute --worktree-root is unchanged (WP3b)", async () => {
  const fake = await startFakeServer((task, action) => {
    task.status = HAPPY_PATH_TRANSITIONS[action] ?? task.status;
  });
  try {
    await withTempDataRoot(async (dataRoot) => {
      const client = createHarnessClient({ baseUrl: fake.baseUrl });
      await client.connect();
      const worktreeRoot = path.join(dataRoot, "worktrees");
      await runEvalCampaign({
        suite: makeSuite([makeCase("case-a")]),
        variants: makeVariants(["baseline"]),
        campaignId: "campaign-absolute-root-test",
        client,
        worktreeRoot,
        dataRoot,
        sleepFn: NOOP_SLEEP,
        addWorktree: NOOP_ADD_WORKTREE,
      });
      const createCall = fake.requestLog.find(
        (entry) => entry.method === "POST" && entry.path === "/api/tasks",
      );
      assert.equal(
        createCall.body.repositoryPath,
        path.join(worktreeRoot, "campaign-absolute-root-test-case-a-baseline"),
      );
    });
  } finally {
    await fake.close();
  }
});

// WP3c (docs/model-evaluation-plan.md, "Fix the gate-approval race that crashes the runner, and
// recognize `awaiting-already-satisfied`"): the row 6 baseline campaign crashed the whole runner
// process the first time WP1b's async `auto-on-clean` gate policy raced ahead of the runner's own
// poll-then-approve call. These tests reproduce that race against the fake server and confirm the
// runner absorbs the resulting 409 instead of dying, while still propagating any other error.

test("a 409 from approveSpecification does not crash pollUntilStopped; the run continues to its actual terminal state (WP3c)", async () => {
  let conflictDelivered = false;
  const fake = await startFakeServer((task, action) => {
    if (action === "approve-spec" && !conflictDelivered) {
      conflictDelivered = true;
      // Simulate WP1b's auto-on-clean gate policy racing ahead of the runner: the task has
      // already moved on server-side (as the policy would do) by the time this stale request
      // from the runner's earlier poll lands, and the server rejects the conflicting transition.
      task.status = "awaiting-plan-approval";
      return {
        statusCode: 409,
        code: "TASK_TRANSITION_CONFLICT",
        error: "Task state changed before the requested action could be reserved.",
      };
    }
    task.status = HAPPY_PATH_TRANSITIONS[action] ?? task.status;
  });
  try {
    await withTempDataRoot(async (dataRoot) => {
      const client = createHarnessClient({ baseUrl: fake.baseUrl });
      await client.connect();
      const { manifest } = await runEvalCampaign({
        suite: makeSuite([makeCase("case-a")]),
        variants: makeVariants(["baseline"]),
        campaignId: "campaign-409-spec-test",
        client,
        worktreeRoot: path.join(dataRoot, "worktrees"),
        dataRoot,
        sleepFn: NOOP_SLEEP,
        addWorktree: NOOP_ADD_WORKTREE,
      });
      assert.equal(manifest.runs.length, 1);
      assert.equal(manifest.runs[0].terminalState, "awaiting-human-approval");
      const specAttempts = fake.requestLog.filter((entry) => entry.path.endsWith("/approve-spec"));
      assert.equal(specAttempts.length, 1, "the runner must not retry approve-spec after a 409");
      assert.equal(
        manifest.runs[0].runnerApprovals.some((entry) => entry.stage === "specification"),
        false,
        "a swallowed 409 must not be recorded as a runner approval — the policy did it, not the runner",
      );
    });
  } finally {
    await fake.close();
  }
});

test("a 409 from approvePlan does not crash pollUntilStopped; the run continues to its actual terminal state (WP3c)", async () => {
  let conflictDelivered = false;
  const fake = await startFakeServer((task, action) => {
    if (action === "approve-plan" && !conflictDelivered) {
      conflictDelivered = true;
      task.status = "ready-for-implementation";
      return {
        statusCode: 409,
        code: "TASK_TRANSITION_CONFLICT",
        error: "Task state changed before the requested action could be reserved.",
      };
    }
    task.status = HAPPY_PATH_TRANSITIONS[action] ?? task.status;
  });
  try {
    await withTempDataRoot(async (dataRoot) => {
      const client = createHarnessClient({ baseUrl: fake.baseUrl });
      await client.connect();
      const { manifest } = await runEvalCampaign({
        suite: makeSuite([makeCase("case-a")]),
        variants: makeVariants(["baseline"]),
        campaignId: "campaign-409-plan-test",
        client,
        worktreeRoot: path.join(dataRoot, "worktrees"),
        dataRoot,
        sleepFn: NOOP_SLEEP,
        addWorktree: NOOP_ADD_WORKTREE,
      });
      assert.equal(manifest.runs.length, 1);
      assert.equal(manifest.runs[0].terminalState, "awaiting-human-approval");
      const planAttempts = fake.requestLog.filter((entry) => entry.path.endsWith("/approve-plan"));
      assert.equal(planAttempts.length, 1, "the runner must not retry approve-plan after a 409");
      assert.equal(
        manifest.runs[0].runnerApprovals.some((entry) => entry.stage === "plan"),
        false,
        "a swallowed 409 must not be recorded as a runner approval — the policy did it, not the runner",
      );
    });
  } finally {
    await fake.close();
  }
});

test("a non-409 error from approveSpecification still propagates and fails the pair (WP3c)", async () => {
  const fake = await startFakeServer((task, action) => {
    if (action === "approve-spec") {
      return { statusCode: 500, error: "internal error: boom" };
    }
    task.status = HAPPY_PATH_TRANSITIONS[action] ?? task.status;
  });
  try {
    await withTempDataRoot(async (dataRoot) => {
      const client = createHarnessClient({ baseUrl: fake.baseUrl });
      await client.connect();
      await assert.rejects(
        () =>
          runEvalCampaign({
            suite: makeSuite([makeCase("case-a")]),
            variants: makeVariants(["baseline"]),
            campaignId: "campaign-500-spec-test",
            client,
            worktreeRoot: path.join(dataRoot, "worktrees"),
            dataRoot,
            sleepFn: NOOP_SLEEP,
            addWorktree: NOOP_ADD_WORKTREE,
          }),
        /boom/,
      );
    });
  } finally {
    await fake.close();
  }
});

test("a non-409 error from approvePlan still propagates and fails the pair (WP3c)", async () => {
  const fake = await startFakeServer((task, action) => {
    if (action === "approve-plan") {
      return { statusCode: 503, error: "internal error: kaboom" };
    }
    task.status = HAPPY_PATH_TRANSITIONS[action] ?? task.status;
  });
  try {
    await withTempDataRoot(async (dataRoot) => {
      const client = createHarnessClient({ baseUrl: fake.baseUrl });
      await client.connect();
      await assert.rejects(
        () =>
          runEvalCampaign({
            suite: makeSuite([makeCase("case-a")]),
            variants: makeVariants(["baseline"]),
            campaignId: "campaign-503-plan-test",
            client,
            worktreeRoot: path.join(dataRoot, "worktrees"),
            dataRoot,
            sleepFn: NOOP_SLEEP,
            addWorktree: NOOP_ADD_WORKTREE,
          }),
        /kaboom/,
      );
    });
  } finally {
    await fake.close();
  }
});

test("a task reaching awaiting-already-satisfied is recorded with that exact terminalState (WP3c)", async () => {
  const fake = await startFakeServer((task, action) => {
    if (action === "run") {
      task.status = "awaiting-already-satisfied";
      return;
    }
    task.status = HAPPY_PATH_TRANSITIONS[action] ?? task.status;
  });
  try {
    await withTempDataRoot(async (dataRoot) => {
      const client = createHarnessClient({ baseUrl: fake.baseUrl });
      await client.connect();
      const { manifest } = await runEvalCampaign({
        suite: makeSuite([makeCase("case-a")]),
        variants: makeVariants(["baseline"]),
        campaignId: "campaign-already-satisfied-test",
        client,
        worktreeRoot: path.join(dataRoot, "worktrees"),
        dataRoot,
        sleepFn: NOOP_SLEEP,
        addWorktree: NOOP_ADD_WORKTREE,
      });
      assert.equal(manifest.runs.length, 1);
      assert.equal(manifest.runs[0].terminalState, "awaiting-already-satisfied");
      assert.equal(manifest.runs[0].finalStatus, "awaiting-already-satisfied");
      assert.notEqual(manifest.runs[0].terminalState, "awaiting-human-approval");
    });
  } finally {
    await fake.close();
  }
});

test("no forbidden action is ever requested", async () => {
  const fake = await startFakeServer((task, action) => {
    task.status = HAPPY_PATH_TRANSITIONS[action] ?? task.status;
  });
  try {
    await withTempDataRoot(async (dataRoot) => {
      const client = createHarnessClient({ baseUrl: fake.baseUrl });
      await client.connect();
      await runEvalCampaign({
        suite: makeSuite([makeCase("case-a")]),
        variants: makeVariants(["baseline"]),
        campaignId: "campaign-forbidden-test",
        client,
        worktreeRoot: path.join(dataRoot, "worktrees"),
        dataRoot,
        sleepFn: NOOP_SLEEP,
        addWorktree: NOOP_ADD_WORKTREE,
      });
      for (const entry of fake.requestLog) {
        for (const forbidden of FORBIDDEN_ACTIONS) {
          assert.ok(
            !entry.path.endsWith(`/${forbidden}`),
            `must never call ${forbidden} (saw ${entry.path})`,
          );
        }
      }
    });
  } finally {
    await fake.close();
  }
});
