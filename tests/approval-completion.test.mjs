import test from "node:test";
import { defaultRuntimeSettings } from "../server/model-catalog.mjs";
import { migratePersistedTaskState } from "../server/store.mjs";
import {
  assert,
  JsonTaskStore,
  mkdtemp,
  os,
  path,
  rm,
  TaskOrchestrator,
} from "./orchestrator-test-support.mjs";

/**
 * A local merge writes into the operator's own checkout. Their working tree then sits ahead of
 * what their tooling expects, watchers and builds see changes nobody asked for, and the work has
 * to be retriggered by hand. Raising a pull request leaves the checkout alone, so it is the
 * default; the local merge remains available and is now opt-in.
 */
async function approvalTask(directory, overrides = {}) {
  const store = new JsonTaskStore(path.join(directory, "tasks.json"));
  await store.init();
  const task = await store.create({
    title: "Ship it",
    description: "A qualified candidate awaiting approval.",
    repositoryPath: directory,
    workflow: "implement",
    priority: "medium",
    ...overrides,
  });
  await store.update(task.id, (draft) => {
    draft.status = "awaiting-human-approval";
    draft.currentStage = "approval";
  });
  return { store, task };
}

test("raising a pull request is the default way approval completes", () => {
  assert.equal(defaultRuntimeSettings().approvalCompletion, "pull-request");
});

test("a new task snapshots the pull-request default", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-approval-default-"));
  try {
    const { task } = await approvalTask(directory);
    assert.equal(task.approvalCompletion, "pull-request");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("approving a merge into the local checkout is refused, and says what to do instead", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-approval-refuse-"));
  try {
    const { store, task } = await approvalTask(directory);
    const orchestrator = new TaskOrchestrator(store, {
      getStatus: async () => ({ available: true, authenticated: true, authMethod: "ChatGPT" }),
    });
    await assert.rejects(
      () => orchestrator.approveMerge(task.id),
      /raising a pull request, not by merging into the local checkout/,
    );
    // The task is untouched: refusing is not a state change.
    assert.equal((await store.get(task.id)).status, "awaiting-human-approval");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("a task that opted into a local merge is not refused for that reason", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-approval-optin-"));
  try {
    const { store, task } = await approvalTask(directory, { approvalCompletion: "local-merge" });
    assert.equal(task.approvalCompletion, "local-merge");
    const orchestrator = new TaskOrchestrator(store, {
      getStatus: async () => ({ available: true, authenticated: true, authMethod: "ChatGPT" }),
    });
    // It still fails — there is no candidate here — but on the candidate, not on the policy.
    await assert.rejects(
      () => orchestrator.approveMerge(task.id),
      (error) => {
        assert.doesNotMatch(error.message, /raising a pull request/);
        return true;
      },
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("a task recorded before the setting existed takes the pull-request default, not a local merge", () => {
  const state = {
    settings: defaultRuntimeSettings(),
    tasks: [
      {
        id: "AH-1",
        status: "awaiting-human-approval",
        currentStage: "approval",
        completedStages: [],
        artifacts: [],
        events: [],
        workPackages: [],
        candidates: [],
        decisions: [],
        approvals: [],
        runs: [],
        attemptsByStage: {},
        stageRunReservations: {},
        usage: {},
      },
    ],
  };
  assert.equal(migratePersistedTaskState(state), true);
  assert.equal(
    state.tasks[0].approvalCompletion,
    "pull-request",
    "a local merge is the surprising outcome, so nothing inherits it implicitly",
  );
});

/**
 * AH-032 reached the approval gate cleanly and then reported only "git exited with code 2". The
 * cause was that the PR's base branch had never been pushed: `git ls-remote --exit-code` exits 2
 * and prints nothing for a ref the remote does not have, so there was nothing left to report. The
 * fix the operator needs is one push, and the message has to say so.
 */
test("a pull request whose base branch is missing on the remote says exactly that", async () => {
  const { GitHubPullRequestManager } = await import("../server/github-pull-request.mjs");
  const calls = [];
  const manager = new GitHubPullRequestManager({
    run: async (_command, args) => {
      calls.push(args.join(" "));
      if (args[0] === "remote" && args.length === 1) return { stdout: "origin\n", stderr: "" };
      if (args[0] === "remote" && args[1] === "get-url")
        return { stdout: "https://github.com/acme/widgets.git\n", stderr: "" };
      // The remote genuinely does not have the ref: exit 0, no output.
      if (args[0] === "ls-remote") return { stdout: "", stderr: "" };
      return { stdout: "", stderr: "" };
    },
  });

  await assert.rejects(
    () =>
      manager.publish({
        task: { id: "AH-032", title: "Move the helpers", description: "d" },
        candidate: {
          id: "C1",
          revisionNumber: 1,
          headRevision: "a".repeat(40),
          baseRevision: "b".repeat(40),
          baseBranch: "feature/never-pushed",
          repositoryRoot: "/tmp/repo",
          worktreePath: "/tmp/repo",
        },
        intent: { headBranch: "agent-harness/ah-032-c1" },
      }),
    (error) => {
      assert.match(error.message, /has no refs\/heads\/feature\/never-pushed/);
      assert.match(error.message, /needs its base branch to exist on the remote/);
      assert.doesNotMatch(error.message, /exited with code/);
      return true;
    },
  );
  assert.ok(
    calls.some((call) => call.startsWith("ls-remote") && !call.includes("--exit-code")),
    "--exit-code hides the cause, so it is not used",
  );
});
