import test from "node:test";
import {
  assert,
  cleanup,
  createServer,
  createTask,
  fetch,
  GitWorktreeManager,
  git,
  mkdtemp,
  os,
  path,
  readFile,
  rm,
  writeFile,
} from "./api-test-support.mjs";

test("snapshots controlled experiment inputs and reports measured outcomes separately", async () => {
  const { directory, origin, server, store } = await createServer();
  try {
    await git(directory, ["init"]);
    await git(directory, ["config", "user.name", "Agent Harness Test"]);
    await git(directory, ["config", "user.email", "agent-harness@example.test"]);
    await writeFile(path.join(directory, "README.md"), "experiment base\n", "utf8");
    await git(directory, ["add", "README.md"]);
    await git(directory, ["commit", "-m", "experiment base"]);
    const baseSha = (await git(directory, ["rev-parse", "HEAD"])).stdout.trim();

    const createResponse = await createTask(origin, {
      title: "Frozen experiment case",
      description: "Compare the same task brief under an explicit policy variant.",
      repositoryPath: directory,
      workflow: "implement",
      priority: "high",
      experiment: {
        groupId: "overnight-2026-08-03",
        variantId: "opaque-a",
        frozenBaseSha: baseSha,
        acceptanceCriteria: ["The result preserves the runtime contract."],
        verificationCommands: ["npm test"],
      },
    });
    assert.equal(createResponse.status, 201);
    const { task } = await createResponse.json();
    assert.equal(task.experiment.frozenBaseSha, baseSha);
    assert.match(task.experiment.taskBriefHash, /^[a-f0-9]{64}$/);
    assert.deepEqual(task.experiment.policyMatrix, task.agentConfig.stagePolicies);

    await store.update(task.id, (draft) => {
      draft.startedAt = "2026-08-03T00:00:00.000Z";
      draft.completedAt = "2026-08-03T00:10:00.000Z";
      draft.status = "awaiting-human-approval";
      draft.attemptsByStage["dev-review"] = 2;
      draft.candidates.push({ revisions: [{ reason: "assembly" }, { reason: "repair" }] });
      draft.usage = {
        inputTokens: 100,
        cachedInputTokens: 40,
        outputTokens: 20,
        totalTokens: 120,
        cost: 0.01,
        credits: 0.5,
      };
      const artifact = (stage, content, id) => ({
        id,
        stage,
        name: `${id}.md`,
        kind: "markdown",
        content,
        createdAt: "2026-08-03T00:01:00.000Z",
        startedAt: "2026-08-03T00:00:00.000Z",
        completedAt: "2026-08-03T00:01:00.000Z",
        durationMs: 60_000,
        model: "gpt-5.6-sol",
        reasoning: "high",
        agentRole: stage,
        usage: {
          inputTokens: 10,
          cachedInputTokens: 4,
          outputTokens: 2,
          totalTokens: 12,
          cost: 0.001,
          credits: 0.05,
        },
        contextManifest: { promptCharacters: 1_000, estimatedPromptTokens: 250 },
        gateResult: {
          verdict: content === "PASS" ? "PASS" : "REPAIR",
          candidateId: "C1",
          candidateRevision: 1,
          evaluatedAt: "2026-08-03T00:01:00.000Z",
          blockingReasons: content === "PASS" ? [] : ["Fixture repair"],
        },
      });
      draft.artifacts.push(
        artifact("dev-review", "REPAIR", "review-1"),
        artifact("dev-review", "PASS", "review-2"),
        artifact("test", "PASS", "test-1"),
      );
    });

    const humanResponse = await fetch(`${origin}/api/tasks/${task.id}/evaluation`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        score: 4,
        outcome: "accepted",
        rubric: { correctness: 5, maintainability: 3 },
        notes: "Human review",
      }),
    });
    assert.equal(humanResponse.status, 200);
    const blindResponse = await fetch(`${origin}/api/tasks/${task.id}/evaluation`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind: "blind",
        score: 5,
        outcome: "accepted",
        rubric: { overall: 5 },
        notes: "Locked blind review",
      }),
    });
    assert.equal(blindResponse.status, 200);

    const summaryResponse = await fetch(`${origin}/api/evaluations/summary`);
    assert.equal(summaryResponse.status, 200);
    const summary = await summaryResponse.json();
    assert.equal(summary.experiments.taskCount, 1);
    assert.equal(summary.observations.evaluatedTasks, 0);
    const variant = summary.experiments.variants[0];
    assert.equal(variant.sampleCount, 1);
    assert.equal(variant.firstPassGateSuccesses, 1);
    assert.equal(variant.firstPassGateSuccessRate, 0.5);
    assert.equal(variant.eventualGateSuccessRate, 1);
    assert.equal(variant.repairCount, 1);
    assert.equal(variant.retryCount, 1);
    assert.equal(variant.averageWallTimeMs, 600_000);
    assert.equal(variant.averageHumanScore, 4);
    assert.equal(variant.averageBlindScore, 5);
    assert.equal(variant.estimatedContextTokens, 750);

    await writeFile(path.join(directory, "README.md"), "repository moved\n", "utf8");
    await git(directory, ["add", "README.md"]);
    await git(directory, ["commit", "-m", "move experiment head"]);
    const movedResponse = await createTask(origin, {
      title: "Stale frozen base",
      description: "Reject a controlled task whose checkout no longer matches its declared base.",
      repositoryPath: directory,
      workflow: "implement",
      priority: "high",
      experiment: {
        groupId: "overnight-2026-08-03",
        variantId: "opaque-b",
        frozenBaseSha: baseSha,
        acceptanceCriteria: ["Reject a moved base."],
        verificationCommands: ["npm test"],
      },
    });
    assert.equal(movedResponse.status, 400);
    assert.match((await movedResponse.json()).error, /checked out at the frozen experiment base/i);
  } finally {
    await cleanup(server, directory);
  }
});

test("persists supported task attachments outside the repository", async () => {
  const { directory, origin, server } = await createServer();
  try {
    const content = "<main>Reference artifact</main>";
    const response = await createTask(origin, {
      title: "Attached evidence",
      description: "Use the supplied HTML as task evidence.",
      repositoryPath: directory,
      workflow: "investigate",
      priority: "medium",
      attachments: [
        {
          name: "reference.html",
          type: "text/html",
          size: Buffer.byteLength(content),
          data: Buffer.from(content).toString("base64"),
        },
      ],
    });
    assert.equal(response.status, 201);
    const { task } = await response.json();
    assert.equal(task.attachments.length, 1);
    assert.equal(task.attachments[0].name, "reference.html");
    assert.equal(await readFile(task.attachments[0].path, "utf8"), content);
    assert.equal(task.attachments[0].path.startsWith(directory), true);
  } finally {
    await cleanup(server, directory);
  }
});

test("records Grill answers and requires an explicit finish mode", async () => {
  const { directory, origin, server, grillAnswerRef, grillFinishRef } = await createServer();
  try {
    const response = await createTask(origin, {
      title: "Grill contract",
      description: "Persist an authoritative decision frontier.",
      repositoryPath: directory,
      workflow: "implement",
    });
    const { task } = await response.json();
    const bareFinishResponse = await fetch(`${origin}/api/tasks/${task.id}/grill/finish`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ acceptRemaining: true }),
    });
    assert.equal(bareFinishResponse.status, 400);
    assert.deepEqual(await bareFinishResponse.json(), {
      error: "Finishing Grill requires an explicit operator UI action.",
    });
    assert.equal(grillFinishRef(), null, "the AH-016-style bare automation call never reaches orchestration");

    const answerResponse = await fetch(`${origin}/api/tasks/${task.id}/grill/answers`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        questionId: "Q1",
        answer: "Preserve compatibility",
        interactionSource: "operator-ui",
      }),
    });
    assert.equal(answerResponse.status, 201);
    assert.deepEqual(grillAnswerRef(), {
      id: task.id,
      questionId: "Q1",
      answer: "Preserve compatibility",
      source: "operator",
    });

    const finishResponse = await fetch(`${origin}/api/tasks/${task.id}/grill/finish`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ acceptRemaining: true, interactionSource: "operator-ui" }),
    });
    assert.equal(finishResponse.status, 202);
    assert.deepEqual(grillFinishRef(), { id: task.id, acceptRemaining: true, source: "operator" });
  } finally {
    await cleanup(server, directory);
  }
});

test("creates a task with workflow implement", async () => {
  const { directory, origin, server } = await createServer();
  try {
    const response = await createTask(origin, {
      title: "Implement task",
      description: "Build the requested change.",
      repositoryPath: directory,
      workflow: "implement",
    });
    assert.equal(response.status, 201);
    const { task } = await response.json();
    assert.equal(task.workflow, "implement");
  } finally {
    await cleanup(server, directory);
  }
});

test("revises an awaiting plan only after a retained corrective decision", async () => {
  const { directory, origin, server, store, startedIdRef, startedKindRef } = await createServer();
  try {
    const response = await createTask(origin, {
      title: "Revise unsafe plan",
      description: "Keep plan approval explicit while allowing evidence-backed recovery.",
      repositoryPath: directory,
      workflow: "implement",
    });
    const { task } = await response.json();
    await store.update(task.id, (draft) => {
      draft.status = "awaiting-plan-approval";
      draft.currentStage = "plan";
      draft.attemptsByStage.plan = 1;
      draft.workPackages = [{ id: "S1", title: "Wrong scope" }];
      draft.artifacts.push({
        id: "plan-r1",
        stage: "plan",
        name: "implementation-plan.md",
        kind: "markdown",
        content: "Wrong plan",
        createdAt: "2026-08-08T00:00:00.000Z",
      });
    });

    const blindRevision = await fetch(`${origin}/api/tasks/${task.id}/plan`, { method: "POST" });
    assert.equal(blindRevision.status, 409);
    assert.match((await blindRevision.json()).error, /record the required plan correction/i);

    const decision = await fetch(`${origin}/api/tasks/${task.id}/decisions`, {
      method: "POST",
      body: JSON.stringify({
        question: "How must the plan change?",
        answer: "Use one package and existing repository-relative test paths.",
      }),
    });
    assert.equal(decision.status, 201);
    await store.update(task.id, (draft) => {
      draft.decisions.push({
        id: "plan-correction",
        question: "How must the plan change?",
        answer: "Use one package and existing repository-relative test paths.",
        createdAt: "2026-08-08T00:01:00.000Z",
      });
    });

    const revision = await fetch(`${origin}/api/tasks/${task.id}/plan`, { method: "POST" });
    assert.equal(revision.status, 202);
    assert.deepEqual(await revision.json(), { started: true });
    assert.equal(startedIdRef(), task.id);
    assert.equal(startedKindRef(), "planning");
  } finally {
    await cleanup(server, directory);
  }
});

test("returns an exact retained candidate revision diff when its recorded head is requested", async () => {
  const { directory, origin, server, store } = await createServer();
  const repository = await mkdtemp(path.join(os.tmpdir(), "agent-harness-api-revision-diff-"));
  try {
    await git(repository, ["init"]);
    await git(repository, ["config", "user.name", "Agent Harness Test"]);
    await git(repository, ["config", "user.email", "agent-harness@example.test"]);
    await writeFile(path.join(repository, "README.md"), "base\n", "utf8");
    await git(repository, ["add", "README.md"]);
    await git(repository, ["commit", "-m", "base"]);

    const task = await store.create({
      title: "Inspect retained diff",
      description: "Open a prior candidate revision without substituting the current head.",
      repositoryPath: repository,
      workflow: "implement",
      priority: "medium",
    });
    const manager = new GitWorktreeManager(path.join(repository, ".data", "worktrees"));
    const base = await manager.base(task);
    const candidate = await manager.prepare(task, "C1", { baseRevision: base.baseRevision });
    await writeFile(path.join(candidate.worktreePath, "feature.txt"), "first revision\n", "utf8");
    const first = await manager.commit(candidate, "candidate r1");
    await writeFile(path.join(candidate.worktreePath, "feature.txt"), "second revision\n", "utf8");
    const second = await manager.commit(candidate, "candidate r2");
    candidate.headRevision = second.headRevision;
    candidate.revisionNumber = 2;
    candidate.revisions = [
      {
        number: 1,
        headRevision: first.headRevision,
        reason: "assembly",
        createdAt: "2026-08-01T12:00:00.000Z",
      },
      {
        number: 2,
        headRevision: second.headRevision,
        reason: "repair",
        createdAt: "2026-08-01T12:05:00.000Z",
      },
    ];
    await store.update(task.id, (draft) => {
      draft.candidates.push({ ...candidate, files: second.files, summary: second.summary });
    });

    const params = new URLSearchParams({ headRevision: first.headRevision });
    const response = await fetch(`${origin}/api/tasks/${task.id}/candidates/C1/diff?${params}`);
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.revisionNumber, 1);
    assert.equal(payload.headRevision, first.headRevision);
    assert.match(payload.diff, /first revision/);
    assert.doesNotMatch(payload.diff, /second revision/);

    const missing = await fetch(
      `${origin}/api/tasks/${task.id}/candidates/C1/diff?headRevision=${"f".repeat(40)}`,
    );
    assert.equal(missing.status, 409);
    assert.match((await missing.json()).error, /no longer recorded/i);
  } finally {
    await cleanup(server, directory);
    await rm(repository, { recursive: true, force: true });
  }
});
