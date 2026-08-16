import test from "node:test";
import {
  assert,
  attachAssemblyLineage,
  attachCandidateProducerEvidence,
  attachExactCandidateGate,
  attachRunArtifact,
  bindLatestWorkflowAttempt,
  cleanup,
  createServer,
  createTask,
  exec,
  fetch,
  parseFocusedTestEvidence,
  path,
  RUNTIME_FRESHNESS_REASONS,
  refreshGateFreshness,
  twoRevisionCandidate,
  writeFile,
} from "./api-test-support.mjs";

test("returns backward-compatible structured run activity through task APIs", async () => {
  const { directory, origin, server, store } = await createServer();
  try {
    const response = await createTask(origin, {
      title: "Structured run API",
      description: "Expose only telemetry retained from the runtime.",
      repositoryPath: directory,
      workflow: "investigate",
      priority: "medium",
    });
    const { task } = await response.json();
    await store.update(task.id, (draft) => {
      draft.runs.push({
        id: "RUN-API",
        kind: "agent",
        status: "completed",
        stage: "triage",
        role: "triage",
        model: "gpt-5.6-luna",
        reasoning: "xhigh",
        startedAt: "2026-08-03T00:00:00.000Z",
        completedAt: "2026-08-03T00:00:01.000Z",
        durationMs: 1_000,
        artifactId: null,
        usage: {
          inputTokens: 10,
          cachedInputTokens: 4,
          outputTokens: 2,
          totalTokens: 12,
          credits: 0.1,
          cost: 0.001,
        },
        credits: 0.1,
        apiEstimate: 0.001,
        candidateId: null,
        candidateRevision: null,
        workPackageId: null,
        attempt: 1,
        retryOfRunId: null,
        repairOfRunId: null,
        toolCalls: [
          {
            id: "cmd-api",
            name: "command_execution",
            category: "repository-command",
            phase: "completed",
            result: "Exit code 0",
          },
        ],
        test: null,
        gateResult: null,
        error: null,
        source: "codex-jsonl",
      });
      draft.events.push({
        id: "event-api",
        at: "2026-08-03T00:00:01.000Z",
        category: "tool",
        tone: "success",
        stage: "triage",
        title: "Repository command completed",
        detail: "git status --short",
        runId: "RUN-API",
        toolCall: draft.runs[0].toolCalls[0],
      });
    });

    const detail = await (await fetch(`${origin}/api/tasks/${task.id}`)).json();
    const list = await (await fetch(`${origin}/api/tasks`)).json();
    const health = await (await fetch(`${origin}/api/health`)).json();
    assert.equal(health.runtimeSchemaVersion, 11);
    assert.equal(detail.task.runs[0].id, "RUN-API");
    assert.equal(detail.task.runs[0].toolCalls[0].result, "Exit code 0");
    assert.equal(detail.task.events.at(-1).runId, "RUN-API");
    assert.equal("runs" in list.tasks[0], false);
    assert.equal("events" in list.tasks[0], false);
    assert.equal(list.tasks[0].runCount, 1);
    assert.equal(list.tasks[0].eventCount, 2);
  } finally {
    await cleanup(server, directory);
  }
});

test("serves lightweight task projections, paginated retained evidence, and response metrics", async () => {
  const metrics = [];
  const { directory, origin, server, store } = await createServer({
    reportHttpMetric: (metric) => metrics.push(metric),
  });
  try {
    const response = await createTask(origin, {
      title: "Paged evidence",
      description: "Keep heavy evidence outside list and core polling payloads.",
      repositoryPath: directory,
      workflow: "implement",
    });
    const { task } = await response.json();
    await store.update(task.id, (draft) => {
      for (let index = 1; index <= 3; index += 1) {
        draft.artifacts.push({
          id: `artifact-${index}`,
          stage: "triage",
          name: `artifact-${index}.md`,
          kind: "markdown",
          content: `secret retained content ${index}`,
          createdAt: `2026-08-09T00:00:0${index}.000Z`,
          model: "gpt-5.6-luna",
          usage: { inputTokens: index, cachedInputTokens: 0, outputTokens: 1, totalTokens: index + 1 },
        });
        draft.runs.push({
          id: `run-${index}`,
          stage: "triage",
          startedAt: `2026-08-09T00:00:0${index}.000Z`,
        });
        draft.events.push({
          id: `event-${index}`,
          at: `2026-08-09T00:00:0${index}.000Z`,
          category: "agent",
          tone: "info",
          stage: "triage",
          title: `Agent event ${index}`,
          detail: `detail ${index}`,
        });
      }
    });

    const listResponse = await fetch(`${origin}/api/tasks`);
    const list = await listResponse.json();
    assert.equal(list.tasks[0].artifactCount, 3);
    assert.equal("content" in list.tasks[0].artifacts[0], false);
    assert.equal("runs" in list.tasks[0], false);
    assert.equal("events" in list.tasks[0], false);
    assert.ok(Number(listResponse.headers.get("content-length")) > 0);
    assert.equal(
      listResponse.headers.get("content-length"),
      listResponse.headers.get("x-agent-harness-response-bytes"),
    );
    assert.match(listResponse.headers.get("server-timing"), /^app;dur=/);

    const pollListResponse = await fetch(`${origin}/api/tasks?view=poll`);
    const pollList = await pollListResponse.json();
    assert.deepEqual(Object.keys(pollList.tasks[0]).sort(), ["id", "pollVersion"]);
    assert.equal(pollList.tasks[0].id, task.id);
    assert.ok(pollList.tasks[0].pollVersion);

    const pollTask = await (await fetch(`${origin}/api/tasks/${task.id}?view=poll`)).json();
    assert.deepEqual(pollTask.task, pollList.tasks[0]);
    assert.ok(Number(pollListResponse.headers.get("content-length")) < 200);

    const core = await (await fetch(`${origin}/api/tasks/${task.id}?view=core`)).json();
    assert.equal(core.task.artifactCount, 3);
    assert.equal("events" in core.task, false);
    assert.equal("runs" in core.task, false);

    const firstArtifacts = await (await fetch(`${origin}/api/tasks/${task.id}/artifacts?limit=2`)).json();
    assert.deepEqual(
      firstArtifacts.items.map((item) => item.id),
      ["artifact-3", "artifact-2"],
    );
    assert.ok(firstArtifacts.nextCursor);
    assert.equal("content" in firstArtifacts.items[0], false);
    const secondArtifacts = await (
      await fetch(
        `${origin}/api/tasks/${task.id}/artifacts?limit=2&cursor=${encodeURIComponent(firstArtifacts.nextCursor)}`,
      )
    ).json();
    assert.deepEqual(
      secondArtifacts.items.map((item) => item.id),
      ["artifact-1"],
    );

    const artifactContents = await (
      await fetch(`${origin}/api/tasks/${task.id}/artifacts?limit=2&include=content`)
    ).json();
    assert.deepEqual(
      artifactContents.items.map((item) => item.content),
      ["secret retained content 3", "secret retained content 2"],
    );

    const artifact = await (await fetch(`${origin}/api/tasks/${task.id}/artifacts/artifact-2`)).json();
    assert.equal(artifact.artifact.content, "secret retained content 2");
    const runs = await (await fetch(`${origin}/api/tasks/${task.id}/runs?limit=2`)).json();
    assert.deepEqual(
      runs.items.map((item) => item.id),
      ["run-3", "run-2"],
    );
    const activity = await (
      await fetch(`${origin}/api/tasks/${task.id}/activity?filter=agent&limit=2`)
    ).json();
    assert.deepEqual(
      activity.items.map((item) => item.id),
      ["event-3", "event-2"],
    );

    assert.ok(metrics.some((metric) => metric.path === "/api/tasks" && metric.responseBytes > 0));
    assert.ok(metrics.every((metric) => !Object.hasOwn(metric, "body")));
  } finally {
    await cleanup(server, directory);
  }
});

test("serves task summaries, core polling, and retained evidence directly from SQLite", async () => {
  const { directory, origin, server, store } = await createServer({ sqlite: true });
  try {
    const response = await createTask(origin, {
      title: "SQLite API",
      description: "Use normalized runtime persistence through the public API.",
      repositoryPath: directory,
      workflow: "implement",
    });
    assert.equal(response.status, 201);
    const { task } = await response.json();
    await store.update(task.id, (draft) => {
      draft.artifacts.push({
        id: "sqlite-artifact",
        stage: "triage",
        name: "sqlite.md",
        kind: "markdown",
        content: "SQLite retained content",
        createdAt: "2026-08-09T00:00:01.000Z",
        model: "gpt-5.6-luna",
        usage: { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1, totalTokens: 2 },
      });
    });

    const list = await (await fetch(`${origin}/api/tasks`)).json();
    assert.equal(list.tasks[0].artifactCount, 1);
    assert.equal("content" in list.tasks[0].artifacts[0], false);
    const core = await (await fetch(`${origin}/api/tasks/${task.id}?view=core`)).json();
    assert.equal(core.task.artifactCount, 1);
    assert.equal("events" in core.task, false);
    const page = await (await fetch(`${origin}/api/tasks/${task.id}/artifacts?limit=1`)).json();
    assert.equal(page.items[0].id, "sqlite-artifact");
    assert.equal("content" in page.items[0], false);
    const contentPage = await (
      await fetch(`${origin}/api/tasks/${task.id}/artifacts?limit=1&include=content`)
    ).json();
    assert.equal(contentPage.items[0].content, "SQLite retained content");
    const artifact = await (await fetch(`${origin}/api/tasks/${task.id}/artifacts/sqlite-artifact`)).json();
    assert.equal(artifact.artifact.content, "SQLite retained content");
  } finally {
    store.close();
    await cleanup(server, directory);
  }
});

test("keeps core action eligibility authoritative for an exhausted candidate gate", async () => {
  const { directory, origin, server, store } = await createServer({ sqlite: true });
  try {
    const response = await createTask(origin, {
      title: "Blocked Dev Review retry",
      description: "Retain exact-candidate evidence while authorizing one bounded retry.",
      repositoryPath: directory,
      workflow: "implement",
    });
    const { task } = await response.json();
    await store.update(task.id, (draft) => {
      draft.status = "blocked";
      draft.currentStage = "dev-review";
      draft.attemptsByStage["dev-review"] = draft.stageRunLimits["dev-review"];
      const candidate = attachAssemblyLineage(draft, {
        id: "C1",
        revisionNumber: 1,
        headRevision: "candidate-c1-r1",
        status: "ready_for_review",
      });
      draft.candidates.push(candidate);
      draft.runs.push(
        ...[1, 2, 3].map((attempt) => ({
          id: `run-dev-review-${attempt}`,
          stage: "dev-review",
          status: "failed",
        })),
      );
      bindLatestWorkflowAttempt(draft, "dev-review", "review");
    });

    const full = await (await fetch(`${origin}/api/tasks/${task.id}?view=full`)).json();
    const core = await (await fetch(`${origin}/api/tasks/${task.id}?view=core`)).json();

    assert.equal(full.task.actionEligibility.actions["grant-retry"].allowed, true);
    assert.deepEqual(core.task.actionEligibility.actions, full.task.actionEligibility.actions);
    assert.equal("events" in core.task, false);
    assert.equal("runs" in core.task, false);
    assert.deepEqual(core.task.artifacts, []);
  } finally {
    store.close();
    await cleanup(server, directory);
  }
});

test("returns live changelog commits, changed files, and a selected file diff", async () => {
  const { directory, origin, server } = await createServer();
  try {
    await exec("git", ["init", "-b", "main"], { cwd: directory });
    await exec("git", ["config", "user.name", "Harness Test"], { cwd: directory });
    await exec("git", ["config", "user.email", "harness@example.test"], { cwd: directory });
    const tracked = path.join(directory, "CHANGELOG_TEST.txt");
    await writeFile(tracked, "first\n", "utf8");
    await exec("git", ["add", "CHANGELOG_TEST.txt"], { cwd: directory });
    await exec("git", ["commit", "-m", "first changelog commit"], { cwd: directory });
    await writeFile(tracked, "first\nsecond\n", "utf8");
    await exec("git", ["add", "CHANGELOG_TEST.txt"], { cwd: directory });
    await exec("git", ["commit", "-m", "second changelog commit"], { cwd: directory });

    const commitsResponse = await fetch(`${origin}/api/changelog`);
    assert.equal(commitsResponse.status, 200);
    const commits = (await commitsResponse.json()).commits;
    assert.equal(commits.length, 2);
    assert.equal(commits[0].subject, "second changelog commit");
    const fullSha = commits[0].sha;
    assert.match(fullSha, /^[0-9a-f]{40}$/i);

    const detailResponse = await fetch(`${origin}/api/changelog/${fullSha}`);
    assert.equal(detailResponse.status, 200);
    const commit = (await detailResponse.json()).commit;
    assert.equal(commit.sha, fullSha);
    assert.equal(commit.files[0].path, "CHANGELOG_TEST.txt");

    const diffResponse = await fetch(
      `${origin}/api/changelog/${fullSha}/file?path=${encodeURIComponent("CHANGELOG_TEST.txt")}`,
    );
    assert.equal(diffResponse.status, 200);
    const diff = await diffResponse.json();
    assert.equal(diff.sha, fullSha);
    assert.match(diff.diff, /\+second/);
  } finally {
    await cleanup(server, directory);
  }
});

test("rejects noncanonical changelog commit IDs before Git lookup", async () => {
  const { directory, origin, server } = await createServer();
  try {
    const invalidIds = [
      "2f9a8bcd",
      "a".repeat(39),
      "a".repeat(41),
      "a".repeat(63),
      "a".repeat(65),
      "g".repeat(40),
    ];
    for (const commitSha of invalidIds) {
      for (const suffix of ["", "/file?path=CHANGELOG_TEST.txt"]) {
        const response = await fetch(`${origin}/api/changelog/${commitSha}${suffix}`);
        assert.equal(response.status, 400, `${commitSha}${suffix}`);
        assert.deepEqual(await response.json(), {
          error: "Commit ID must be exactly 40 or 64 hexadecimal characters.",
        });
      }
    }
  } finally {
    await cleanup(server, directory);
  }
});

test("returns persisted focused test evidence without dropping the Markdown artifact", async () => {
  const { directory, origin, server, store } = await createServer();
  try {
    const response = await createTask(origin, {
      title: "Focused test payload",
      description: "Return structured test evidence.",
      repositoryPath: directory,
      workflow: "implement",
    });
    const { task } = await response.json();
    await store.update(task.id, (draft) => {
      draft.status = "ready-for-final-review";
      draft.currentStage = "test";
      draft.artifacts.push({
        id: "artifact-1",
        stage: "test",
        name: "test-c1-r2.md",
        kind: "markdown",
        content:
          'PASS\n\n<focused-test-evidence>\n{"candidateId":"C1","candidateRevision":2,"command":"npm.cmd run test:runtime","status":"passed","durationMs":900,"rows":[{"id":"row-1","candidateId":"C1","candidateRevision":2,"command":"npm.cmd run test:runtime","status":"passed","durationMs":900,"title":"runtime.test.mjs","artifactReferences":[{"name":"Markdown test artifact","kind":"markdown","path":"artifacts/test.md"}],"assertions":[{"label":"workspace renders the test artifact","actual":"present","expected":"present"}],"failureDetails":null}]}\n</focused-test-evidence>',
        createdAt: "2026-08-01T12:00:00.000Z",
        model: "GPT-5.4-mini",
        usage: { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1, totalTokens: 2 },
        candidateId: "C1",
        candidateRevision: 2,
        focusedTest: parseFocusedTestEvidence(
          'PASS\n\n<focused-test-evidence>\n{"candidateId":"C1","candidateRevision":2,"command":"npm.cmd run test:runtime","status":"passed","durationMs":900,"rows":[{"id":"row-1","candidateId":"C1","candidateRevision":2,"command":"npm.cmd run test:runtime","status":"passed","durationMs":900,"title":"runtime.test.mjs","artifactReferences":[{"name":"Markdown test artifact","kind":"markdown","path":"artifacts/test.md"}],"assertions":[{"label":"workspace renders the test artifact","actual":"present","expected":"present"}],"failureDetails":null}]}\n</focused-test-evidence>',
        ),
      });
    });

    const fetched = await (await fetch(`${origin}/api/tasks/${task.id}`)).json();
    assert.equal(fetched.task.artifacts[0].kind, "markdown");
    assert.equal(fetched.task.artifacts[0].focusedTest.candidateId, "C1");
    assert.equal(fetched.task.artifacts[0].focusedTest.rows[0].candidateRevision, 2);
    assert.equal(fetched.task.artifacts[0].focusedTest.rows[0].artifactReferences[0].kind, "markdown");
  } finally {
    await cleanup(server, directory);
  }
});

test("serializes the authoritative freshness projection, stale reason, run status, and Markdown audit artifact", async () => {
  const { directory, origin, server, store } = await createServer();
  try {
    const response = await createTask(origin, {
      title: "Freshness projection payload",
      description: "Expose exact candidate-bound gate state.",
      repositoryPath: directory,
      workflow: "implement",
    });
    const { task } = await response.json();
    await store.update(task.id, (draft) => {
      draft.candidates.push({
        id: "C1",
        revisionNumber: 2,
        baseRevision: "a".repeat(40),
        baseBranch: "main",
        headRevision: "b".repeat(40),
        status: "ready_for_review",
        revisions: [],
      });
      draft.artifacts.push({
        id: "ART-DEV",
        stage: "dev-review",
        kind: "markdown",
        name: "dev-review-c1-r2.md",
        content: "# retained review evidence\n\nPASS",
        createdAt: "2026-08-03T00:01:00.000Z",
        candidateId: "C1",
        candidateRevision: 2,
        gateResult: {
          schemaVersion: 1,
          stage: "dev-review",
          verdict: "PASS",
          reportedVerdict: "PASS",
          candidateId: "C1",
          candidateRevision: 2,
          evaluatedAt: "2026-08-03T00:01:00.000Z",
          blockingReasons: [],
          findings: [],
        },
        usage: { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1, totalTokens: 2 },
      });
      draft.runs.push({
        id: "RUN-DEV",
        kind: "review",
        status: "completed",
        stage: "dev-review",
        role: "dev-review",
        model: "gpt-5.6-luna",
        reasoning: "xhigh",
        startedAt: "2026-08-03T00:00:00.000Z",
        completedAt: "2026-08-03T00:01:00.000Z",
        durationMs: 60_000,
        artifactId: "ART-DEV",
        usage: { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1, totalTokens: 2 },
        credits: null,
        apiEstimate: null,
        candidateId: "C1",
        candidateRevision: 2,
        workPackageId: null,
        attempt: 1,
        retryOfRunId: null,
        repairOfRunId: null,
        toolCalls: [],
        test: null,
        gateResult: null,
        evidenceError: null,
        freshness: null,
        error: null,
        source: "codex-jsonl",
      });
      draft.events.push({
        id: "EVENT-DEV",
        runId: "RUN-DEV",
        category: "agent",
        tone: "success",
        stage: "dev-review",
        title: "Review complete",
        detail: "PASS",
      });
      attachRunArtifact(draft, "RUN-DEV", draft.artifacts[0]);
      refreshGateFreshness(draft);
    });

    const fetched = await (await fetch(`${origin}/api/tasks/${task.id}`)).json();
    const freshness = fetched.task.gateFreshness["dev-review"];
    assert.equal(freshness.fresh, true);
    assert.deepEqual(freshness.target, { candidateId: "C1", candidateRevision: 2 });
    assert.equal(freshness.sourceRunId, "RUN-DEV");
    assert.equal(fetched.task.runs[0].status, "completed");
    assert.equal(fetched.task.runs[0].freshness.reasonCode, "fresh");
    assert.equal(fetched.task.events.at(-1).freshness.reasonCopy, RUNTIME_FRESHNESS_REASONS.fresh);
    assert.equal(fetched.task.artifacts[0].content, "# retained review evidence\n\nPASS");
  } finally {
    await cleanup(server, directory);
  }
});

test("retains failed-command REPAIR evidence as historical repair lineage only", async () => {
  const { directory, origin, server, store } = await createServer();
  try {
    const response = await createTask(origin, {
      title: "Historical repair authorizer with failed command telemetry",
      description: "A stale REPAIR gate must remain causal lineage without becoming fresh gate evidence.",
      repositoryPath: directory,
      workflow: "implement",
    });
    const { task } = await response.json();
    await store.update(task.id, (draft) => {
      draft.status = "ready-for-review";
      draft.currentStage = "dev-review";
      draft.attemptsByStage.implement = 2;
      draft.attemptsByStage["dev-review"] = draft.stageRunLimits["dev-review"];
      const candidate = twoRevisionCandidate();
      draft.candidates.push(candidate);
      attachCandidateProducerEvidence(draft, candidate);

      const historicalAuthorizer = draft.runs.find(
        (run) => run.id === candidate.revisions[1].authorizingGateRunId,
      );
      historicalAuthorizer.toolCalls = [
        {
          id: "historical-command-failure",
          name: "command_execution",
          category: "repository-command",
          phase: "completed",
          result: "Exit code 127",
        },
      ];

      draft.stageRunReservations.implement = {
        id: candidate.sourceWorkflowReservationId,
        stage: "implement",
        kind: "repair",
        workflowAttempt: 2,
        candidateId: "C1",
        candidateRevision: 1,
        candidateHeadRevision: "candidate-c1-r1",
        authorizedRunScopes: [],
        reservedAt: candidate.revisions[1].sourceWorkflowReservedAt,
      };
      draft.stageRunReservations["dev-review"] = {
        id: "reservation-c1-r2-review-3",
        stage: "dev-review",
        kind: "review",
        workflowAttempt: 3,
        candidateId: "C1",
        candidateRevision: 2,
        candidateHeadRevision: "candidate-c1-r2",
        authorizedRunScopes: [],
        reservedAt: "2026-08-04T00:02:00.000Z",
      };
    });

    const grantResponse = await fetch(`${origin}/api/tasks/${task.id}/grant-retry`, { method: "POST" });
    assert.equal(grantResponse.status, 200, JSON.stringify(await grantResponse.clone().json()));
    assert.deepEqual(await grantResponse.json(), { granted: true });
    const updated = await store.get(task.id);
    assert.equal(updated.stageRunLimits["dev-review"], 4);
    assert.equal(updated.decisions.at(-1).candidateRevision, 2);
    assert.equal(updated.decisions.at(-1).candidateAuthorizerRunIds.length, 1);
  } finally {
    await cleanup(server, directory);
  }
});

test("rejects exact-current and adjacent repaired candidates without durable repair producer evidence", async () => {
  const { directory, origin, server, store } = await createServer();
  try {
    for (const item of [
      { name: "exact current missing repair run", adjacent: false, mutation: "run" },
      { name: "exact current missing repair artifact", adjacent: false, mutation: "artifact" },
      { name: "adjacent missing repair run", adjacent: true, mutation: "run" },
      { name: "adjacent missing repair artifact", adjacent: true, mutation: "artifact" },
    ]) {
      const response = await createTask(origin, {
        title: `Reject ${item.name}`,
        description: "A repaired candidate must retain its exact producer run and linked artifact.",
        repositoryPath: directory,
        workflow: "implement",
      });
      const { task } = await response.json();
      await store.update(task.id, (draft) => {
        draft.status = "ready-for-review";
        draft.currentStage = "dev-review";
        draft.attemptsByStage.implement = 2;
        draft.attemptsByStage["dev-review"] = draft.stageRunLimits["dev-review"];
        const candidate = twoRevisionCandidate();
        draft.candidates.push(candidate);
        attachCandidateProducerEvidence(draft, candidate);
        draft.stageRunReservations.implement = {
          id: candidate.sourceWorkflowReservationId,
          stage: "implement",
          kind: "repair",
          workflowAttempt: 2,
          candidateId: "C1",
          candidateRevision: 1,
          candidateHeadRevision: "candidate-c1-r1",
          authorizedRunScopes: [],
          reservedAt: "2026-08-04T00:00:30.000Z",
        };
        draft.stageRunReservations["dev-review"] = {
          id: item.adjacent ? "reservation-c1-r1-review-3" : "reservation-c1-r2-review-3",
          stage: "dev-review",
          kind: "review",
          workflowAttempt: 3,
          candidateId: "C1",
          candidateRevision: item.adjacent ? 1 : 2,
          candidateHeadRevision: item.adjacent ? "candidate-c1-r1" : "candidate-c1-r2",
          authorizedRunScopes: [],
          reservedAt: item.adjacent ? "2026-08-04T00:00:15.000Z" : "2026-08-04T00:02:00.000Z",
        };
        const producerRun = draft.runs.find(
          (run) => run.workflowReservationId === candidate.sourceWorkflowReservationId,
        );
        if (item.mutation === "run") {
          draft.runs = draft.runs.filter((run) => run !== producerRun);
        } else {
          draft.artifacts = draft.artifacts.filter((artifact) => artifact.id !== producerRun.artifactId);
        }
      });

      const grantResponse = await fetch(`${origin}/api/tasks/${task.id}/grant-retry`, { method: "POST" });
      assert.equal(grantResponse.status, 409, item.name);
      assert.match(
        (await grantResponse.json()).error,
        /producer evidence|inconsistent workflow reservation|duplicate or inconsistent persisted identities/i,
        item.name,
      );
      const unchanged = await store.get(task.id);
      assert.equal(unchanged.stageRunLimits["dev-review"], 3, item.name);
      assert.equal(unchanged.decisions.length, 0, item.name);
    }
  } finally {
    await cleanup(server, directory);
  }
});

test("rejects repair retry authority without one unique durable authorizer artifact and run identity", async () => {
  const { directory, origin, server, store } = await createServer();
  try {
    for (const mutation of ["missing artifact", "duplicate run identity"]) {
      const response = await createTask(origin, {
        title: `Reject ${mutation}`,
        description: "A repair retry requires one unique durable authorizing gate.",
        repositoryPath: directory,
        workflow: "implement",
      });
      const { task } = await response.json();
      await store.update(task.id, (draft) => {
        draft.status = "repair-required";
        draft.currentStage = "dev-review";
        draft.attemptsByStage.implement = draft.stageRunLimits.implement;
        const candidate = attachAssemblyLineage(draft, {
          id: "C1",
          revisionNumber: 1,
          headRevision: "candidate-c1-r1",
          status: "repair_required",
        });
        draft.candidates.push(candidate);
        const authorizer = attachExactCandidateGate(draft, candidate);
        if (mutation === "missing artifact") {
          draft.artifacts = draft.artifacts.filter((artifact) => artifact.id !== authorizer.sourceArtifactId);
        }
        draft.runs.push(
          ...[1, 2, 3].map((attempt) => ({
            id:
              mutation === "duplicate run identity" && attempt === 3
                ? authorizer.sourceRunId
                : `run-failed-repair-authority-${attempt}`,
            stage: "implement",
            status: "failed",
          })),
        );
        bindLatestWorkflowAttempt(draft, "implement", "repair");
      });

      const grantResponse = await fetch(`${origin}/api/tasks/${task.id}/grant-retry`, { method: "POST" });
      assert.equal(grantResponse.status, 409, mutation);
      assert.match(
        (await grantResponse.json()).error,
        /authorizing gate|duplicate or inconsistent persisted identities|inconsistent workflow reservation/i,
        mutation,
      );
      const unchanged = await store.get(task.id);
      assert.equal(unchanged.stageRunLimits.implement, 3, mutation);
      assert.equal(unchanged.decisions.length, 0, mutation);
    }
  } finally {
    await cleanup(server, directory);
  }
});
