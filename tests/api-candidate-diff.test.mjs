import test from "node:test";
import {
  assert,
  cleanup,
  createServer,
  createTask,
  fetch,
  GitWorktreeManager,
  git,
  mkdir,
  mkdtemp,
  os,
  path,
  rm,
  writeFile,
} from "./api-test-support.mjs";

test("marks missing or dirty inventory rows as stale without mutating them", async () => {
  const { directory, origin, server, store } = await createServer();
  const repository = await mkdtemp(path.join(os.tmpdir(), "agent-harness-api-stale-inventory-"));
  try {
    await git(repository, ["init"]);
    await git(repository, ["config", "user.name", "Agent Harness Test"]);
    await git(repository, ["config", "user.email", "agent-harness@example.test"]);
    await writeFile(path.join(repository, "README.md"), "base\n", "utf8");
    await git(repository, ["add", "README.md"]);
    await git(repository, ["commit", "-m", "base"]);

    const task = await store.create({
      title: "Stale inventory rows",
      description: "Surface honest Git state.",
      repositoryPath: repository,
      workflow: "implement",
      priority: "medium",
    });
    const manager = new GitWorktreeManager(path.join(repository, ".data", "worktrees"));
    const base = await manager.base(task);
    const candidate = await manager.prepare(task, "C1", { baseRevision: base.baseRevision });
    await writeFile(path.join(candidate.worktreePath, "candidate.txt"), "candidate\n", "utf8");
    const committed = await manager.commit(candidate, "candidate worktree");
    await store.update(task.id, (draft) => {
      draft.candidates.push({
        ...candidate,
        headRevision: committed.headRevision,
        status: "ready_for_review",
      });
    });
    await rm(candidate.worktreePath, { recursive: true, force: true });

    const response = await fetch(`${origin}/api/runtime/worktrees`);
    assert.equal(response.status, 200);
    const payload = await response.json();
    const row = payload.rows.find((item) => item.kind === "candidate");
    assert.equal(row.currentState, "stale");
    assert.equal(row.gitExists, false);
    assert.equal(row.cleanupReady, false);
    assert.equal(row.gitHeadRevision, null);
    assert.equal(row.headRevision, committed.headRevision);
  } finally {
    await cleanup(server, directory);
    await rm(repository, { recursive: true, force: true });
  }
});

test("rejects stale or mismatched candidate diff requests", async () => {
  const { directory, origin, server, store } = await createServer();
  const repository = await mkdtemp(path.join(os.tmpdir(), "agent-harness-api-stale-"));
  try {
    await git(repository, ["init"]);
    await git(repository, ["config", "user.name", "Agent Harness Test"]);
    await git(repository, ["config", "user.email", "agent-harness@example.test"]);
    await writeFile(path.join(repository, "README.md"), "base\n", "utf8");
    await git(repository, ["add", "README.md"]);
    await git(repository, ["commit", "-m", "base"]);

    const task = await store.create({
      title: "Reject stale diff",
      description: "Reject mismatched candidate metadata.",
      repositoryPath: repository,
      workflow: "implement",
      priority: "medium",
    });
    const manager = new GitWorktreeManager(path.join(repository, ".data", "worktrees"));
    const base = await manager.base(task);
    const candidate = await manager.prepare(task, "C1", { baseRevision: base.baseRevision });
    await writeFile(path.join(candidate.worktreePath, "feature.txt"), "candidate\n", "utf8");
    const committed = await manager.commit(candidate, "candidate diff");
    candidate.headRevision = committed.headRevision;
    await store.update(task.id, (draft) => {
      draft.candidates.push({ ...candidate, files: committed.files, summary: committed.summary });
    });

    await store.update(task.id, (draft) => {
      draft.candidates[0].headRevision = "f".repeat(40);
    });
    const staleHead = await fetch(`${origin}/api/tasks/${task.id}/candidates/C1/diff`);
    assert.equal(staleHead.status, 400);
    assert.match((await staleHead.json()).error, /no longer matches its recorded revision/i);

    await store.update(task.id, (draft) => {
      draft.candidates[0].headRevision = committed.headRevision;
      draft.candidates[0].worktreePath = path.join(candidate.worktreePath, "nested");
    });
    await mkdir(path.join(candidate.worktreePath, "nested"), { recursive: true });
    const staleWorktree = await fetch(`${origin}/api/tasks/${task.id}/candidates/C1/diff`);
    assert.equal(staleWorktree.status, 400);
    assert.equal(staleWorktree.headers.get("x-agent-harness-error-category"), "operational");
    assert.match((await staleWorktree.json()).error, /no longer resolves to its recorded path/i);
  } finally {
    await cleanup(server, directory);
    await rm(repository, { recursive: true, force: true });
  }
});

test("caps oversized candidate diffs and marks them truncated", async () => {
  const { directory, origin, server, store } = await createServer();
  const repository = await mkdtemp(path.join(os.tmpdir(), "agent-harness-api-trunc-"));
  try {
    await git(repository, ["init"]);
    await git(repository, ["config", "user.name", "Agent Harness Test"]);
    await git(repository, ["config", "user.email", "agent-harness@example.test"]);
    await writeFile(path.join(repository, "README.md"), "base\n", "utf8");
    await git(repository, ["add", "README.md"]);
    await git(repository, ["commit", "-m", "base"]);

    const task = await store.create({
      title: "Truncate diff",
      description: "Return a capped unified diff.",
      repositoryPath: repository,
      workflow: "implement",
      priority: "medium",
    });
    const manager = new GitWorktreeManager(path.join(repository, ".data", "worktrees"));
    const base = await manager.base(task);
    const candidate = await manager.prepare(task, "C1", { baseRevision: base.baseRevision });
    await writeFile(
      path.join(candidate.worktreePath, "feature.txt"),
      `${"x".repeat(1000)}\n`.repeat(400),
      "utf8",
    );
    const committed = await manager.commit(candidate, "candidate diff");
    candidate.headRevision = committed.headRevision;
    await store.update(task.id, (draft) => {
      draft.candidates.push({ ...candidate, files: committed.files, summary: committed.summary });
    });

    const response = await fetch(`${origin}/api/tasks/${task.id}/candidates/C1/diff`);
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.candidateId, "C1");
    assert.equal(payload.truncated, true);
    assert.equal(payload.diff.length <= 300_000, true);
  } finally {
    await cleanup(server, directory);
    await rm(repository, { recursive: true, force: true });
  }
});

test("rejects assembly-only scope exceptions without exact ordered package commit membership", async () => {
  const { directory, origin, server, store } = await createServer();
  try {
    for (const item of [
      {
        name: "fabricated member head",
        mutate(candidate) {
          candidate.members[0].headRevision = "fabricated-head";
        },
      },
      {
        name: "missing member head",
        mutate(candidate) {
          candidate.members[1].headRevision = null;
        },
      },
      {
        name: "duplicate member order",
        mutate(candidate) {
          candidate.members[0].order = 2;
        },
      },
      {
        name: "noncanonical member order",
        mutate(candidate) {
          candidate.members.reverse();
        },
      },
      {
        name: "duplicate package commit heads",
        mutate(candidate, draft) {
          draft.workPackages[1].headRevision = draft.workPackages[0].headRevision;
          candidate.members[1].headRevision = candidate.members[0].headRevision;
        },
      },
    ]) {
      const response = await createTask(origin, {
        title: `Reject assembly-only ${item.name}`,
        description: "The empty-scope exception must prove the exact canonical assembly membership.",
        repositoryPath: directory,
        workflow: "implement",
      });
      const { task } = await response.json();
      await store.update(task.id, (draft) => {
        draft.status = "repair-required";
        draft.currentStage = "dev-review";
        draft.attemptsByStage.implement = draft.stageRunLimits.implement;
        draft.workPackages = [
          { id: "S2", status: "integrated", batch: 2, headRevision: "head-s2" },
          { id: "S1", status: "integrated", batch: 1, headRevision: "head-s1" },
        ];
        const reservation = {
          id: "reservation-assembly-only-3",
          stage: "implement",
          kind: "implementation",
          workflowAttempt: 3,
          candidateId: null,
          candidateRevision: null,
          candidateHeadRevision: null,
          authorizedRunScopes: [],
          reservedAt: "2026-08-04T00:02:00.000Z",
        };
        draft.stageRunReservations.implement = reservation;
        const candidate = {
          id: "C1",
          revisionNumber: 1,
          headRevision: "candidate-c1-r1",
          status: "repair_required",
          members: [
            { packageId: "S1", headRevision: "head-s1", order: 1 },
            { packageId: "S2", headRevision: "head-s2", order: 2 },
          ],
          sourceWorkflowAttempt: 3,
          sourceWorkflowReservationId: reservation.id,
          revisions: [
            {
              number: 1,
              headRevision: "candidate-c1-r1",
              reason: "assembly",
              sourceWorkflowAttempt: 3,
              sourceWorkflowReservationId: reservation.id,
              createdAt: "2026-08-04T00:03:00.000Z",
            },
          ],
        };
        item.mutate(candidate, draft);
        draft.candidates.push(candidate);
      });

      const grantResponse = await fetch(`${origin}/api/tasks/${task.id}/grant-retry`, { method: "POST" });
      assert.equal(grantResponse.status, 409, item.name);
      assert.match((await grantResponse.json()).error, /inconsistent workflow reservation/i, item.name);
      const unchanged = await store.get(task.id);
      assert.equal(unchanged.stageRunLimits.implement, 3, item.name);
      assert.equal(unchanged.decisions.length, 0, item.name);
    }
  } finally {
    await cleanup(server, directory);
  }
});
