import test from "node:test";
import {
  assert,
  GRILL_OUTPUT,
  JsonTaskStore,
  mkdtemp,
  os,
  parseGrillQuestions,
  parseWorkPackages,
  path,
  rm,
  SCOUT_OUTPUT,
  selectScoutDispatch,
  TaskOrchestrator,
  waitForStatus,
} from "./orchestrator-test-support.mjs";

test("parses grounded Grill questions and dependency batches", () => {
  assert.equal(parseGrillQuestions(GRILL_OUTPUT)[0].options[0].recommended, true);
  const packages = parseWorkPackages(
    `<work-packages>{"packages":[{"id":"S1","title":"API","description":"Add API.","dependencies":[],"ownedPaths":["server/api.mjs"],"verificationCommandIds":["test"]},{"id":"S2","title":"UI","description":"Add UI.","dependencies":[],"ownedPaths":["src/App.tsx"],"verificationCommandIds":["typecheck"]},{"id":"S3","title":"Contract","description":"Join both.","dependencies":["S1","S2"],"ownedPaths":["tests/contract.test.mjs"],"verificationCommandIds":["test"]}]}</work-packages>`,
  );
  assert.deepEqual(
    packages.map((item) => item.batch),
    [1, 1, 2],
  );
  assert.deepEqual(packages.find((item) => item.id === "S3")?.dependencies, ["S1", "S2"]);
  const fencedPackages = parseWorkPackages(
    '<work-packages>\n```json\n{"packages":[{"id":"S1","title":"API","description":"Add API.","dependencies":[],"ownedPaths":["server/api.mjs"],"verificationCommandIds":["test"]}]}\n```\n</work-packages>',
  );
  assert.deepEqual(
    fencedPackages.map((item) => item.ownedPaths),
    [["server/api.mjs"]],
  );
  assert.throws(
    () => parseWorkPackages('<work-packages>Before\n```json\n{"packages":[]}\n```\n</work-packages>'),
    /JSON block was invalid/i,
  );
  const absolute = parseWorkPackages(
    `<work-packages>{"packages":[{"id":"S1","title":"API","description":"Add API.","dependencies":[],"ownedPaths":["C:/repo/server/api.mjs"],"verificationCommandIds":["test"]}]}</work-packages>`,
    "C:/repo",
  );
  assert.deepEqual(absolute[0].ownedPaths, ["server/api.mjs"]);
  assert.throws(
    () =>
      parseWorkPackages(
        `<work-packages>{"packages":[{"id":"S1","title":"Escape","description":"Escape repo.","dependencies":[],"ownedPaths":["C:/outside/file.mjs"],"verificationCommandIds":["test"]}]}</work-packages>`,
        "C:/repo",
      ),
    /outside the selected repository/,
  );
  assert.throws(
    () =>
      parseWorkPackages(
        `<work-packages>{"packages":[{"id":"S1","title":"Directory","description":"Own src.","dependencies":[],"ownedPaths":["src"],"verificationCommandIds":["test"]},{"id":"S2","title":"File","description":"Own nested file.","dependencies":[],"ownedPaths":["SRC\\\\App.tsx"],"verificationCommandIds":["test"]}]}</work-packages>`,
      ),
    /both own/i,
  );
  assert.throws(
    () =>
      parseWorkPackages(
        `<work-packages>{"packages":[{"id":"S1","title":"Missing scope","description":"Unsafe scope.","dependencies":[],"ownedPaths":[],"verificationCommandIds":["test"]}]}</work-packages>`,
      ),
    /explicit repository-relative owned path/i,
  );
  assert.throws(
    () =>
      parseWorkPackages(
        `<work-packages>{"packages":[{"id":"S1","title":"Missing verification","description":"Cannot qualify this package.","dependencies":[],"ownedPaths":["src/App.tsx"],"verificationCommandIds":[]}]}</work-packages>`,
      ),
    /repository manifest command ID/i,
  );
});

test("runs the investigation frontier and retains each stage handoff", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-orchestrator-"));
  try {
    const store = new JsonTaskStore(path.join(directory, "tasks.json"));
    await store.init();
    const task = await store.create({
      title: "Map a repository",
      description: "Produce a grounded investigation handoff.",
      repositoryPath: directory,
      workflow: "investigate",
      priority: "medium",
    });
    const orchestrator = new TaskOrchestrator(store, {
      getStatus: async () => ({ available: true, authenticated: true, authMethod: "ChatGPT" }),
      runCodex: async ({ prompt, onEvent }) => {
        onEvent({ type: "activity", tone: "success", title: "Repository inspected", detail: "mock" });
        return {
          finalText: /<scout-report>/.test(prompt)
            ? SCOUT_OUTPUT
            : /<grill-questions>/.test(prompt)
              ? GRILL_OUTPUT
              : `## Artifact\n\n${prompt.match(/Your stage assignment:\n([^\n]+)/)?.[1] ?? "Ready"}`,
          usage: { inputTokens: 10, cachedInputTokens: 4, outputTokens: 5, totalTokens: 15 },
        };
      },
    });

    assert.equal(await orchestrator.start(task.id), true);
    let finished = null;
    for (let attempt = 0; attempt < 50; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
      finished = await store.get(task.id);
      if (finished.status !== "running" && finished.status !== "queued") break;
    }

    assert.equal(finished.status, "awaiting-grill", finished.error);
    assert.equal(finished.grillPolicy, "manual");
    assert.deepEqual(finished.completedStages, ["triage", "scouts"]);
    assert.equal(finished.artifacts.length, 5);
    assert.equal(finished.grillSession.questions.length, 1);
    await assert.rejects(
      orchestrator.finishGrill(task.id, { acceptRemaining: true }),
      /explicit operator action/,
    );
    await orchestrator.answerGrillQuestion(task.id, {
      questionId: "Q1",
      answer: "Preserve it",
      source: "operator",
    });
    await orchestrator.finishGrill(task.id, { source: "operator" });
    finished = await waitForStatus(store, task.id, "awaiting-spec-approval");
    assert.equal(finished.grillSession.questions[0].answerSource, "operator-answer");
    assert.equal(finished.grillSession.completionSource, "operator");
    assert.deepEqual(finished.completedStages, ["triage", "scouts", "grill", "specification"]);
    assert.equal(finished.artifacts.length, 6);
    assert.equal(finished.usage.totalTokens, 75);
    for (const stage of ["triage", "scouts", "grill", "specification"]) {
      assert.equal(finished.attemptsByStage[stage], 1, `${stage} consumes exactly one workflow attempt`);
      const reservation = finished.stageRunReservations[stage];
      assert.equal(reservation.stage, stage);
      assert.equal(reservation.workflowAttempt, 1);
      for (const run of finished.runs.filter((entry) => entry.stage === stage)) {
        assert.equal(run.workflowAttempt, 1, `${stage} run retains its workflow attempt`);
        assert.equal(run.workflowReservationId, reservation.id, `${stage} run retains its own reservation`);
      }
    }
    const dispatchedScoutNames = finished.scoutDispatch.selected.map((scout) => scout.name).sort();
    assert.deepEqual(
      finished.stageRunReservations.scouts.authorizedRunScopes.toSorted(),
      dispatchedScoutNames,
    );
    const scoutRuns = finished.runs.filter((run) => run.stage === "scouts");
    assert.deepEqual(scoutRuns.map((run) => run.role).sort(), dispatchedScoutNames);
    assert.equal(
      scoutRuns.every((run) => run.kind === "scout" && run.attempt === 1),
      true,
    );
  } finally {
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test("automatically accepts Grill recommendations only for a task that snapshotted the opt-in policy", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-auto-grill-"));
  try {
    const store = new JsonTaskStore(path.join(directory, "tasks.json"));
    await store.init();
    await store.updateSettings((draft) => {
      draft.grillPolicy = "auto-accept-recommendations";
    });
    const task = await store.create({
      title: "Opt-in automatic Grill",
      description: "Accept recommendations only because this task snapshots the setting.",
      repositoryPath: directory,
      workflow: "investigate",
      priority: "medium",
    });
    await store.updateSettings((draft) => {
      draft.grillPolicy = "manual";
    });
    assert.equal((await store.get(task.id)).grillPolicy, "auto-accept-recommendations");

    const orchestrator = new TaskOrchestrator(store, {
      getStatus: async () => ({ available: true, authenticated: true, authMethod: "ChatGPT" }),
      runCodex: async ({ prompt, onEvent }) => {
        onEvent?.({ type: "activity", tone: "success", title: "Repository inspected", detail: "mock" });
        return {
          finalText: /<scout-report>/.test(prompt)
            ? SCOUT_OUTPUT
            : /<grill-questions>/.test(prompt)
              ? GRILL_OUTPUT
              : "## Specification\n\nRecommendations were accepted under the task policy.",
          usage: { inputTokens: 10, cachedInputTokens: 4, outputTokens: 5, totalTokens: 15 },
        };
      },
    });

    assert.equal(await orchestrator.start(task.id), true);
    const finished = await waitForStatus(store, task.id, "awaiting-spec-approval");
    assert.equal(finished.grillSession.status, "completed");
    assert.equal(finished.grillSession.policySnapshot, "auto-accept-recommendations");
    assert.equal(finished.grillSession.completionSource, "automation-policy");
    assert.equal(finished.grillSession.acceptedRecommendationCount, 1);
    assert.equal(finished.grillSession.questions[0].answerSource, "automation-policy");
    assert.equal(finished.grillSession.questions[0].answer, "Preserve it");
    assert.match(finished.grillSession.completionReason, /Automatically accepted 1 recommended assumption/);
    assert.equal(
      finished.events.some((event) => event.title === "Grill recommendations accepted automatically"),
      true,
    );
  } finally {
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test("lets an operator manually accept every remaining Grill recommendation", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-manual-grill-"));
  try {
    const store = new JsonTaskStore(path.join(directory, "tasks.json"));
    await store.init();
    const task = await store.create({
      title: "Manual Grill acceptance",
      description: "Retain the bulk operator action without making it automatic.",
      repositoryPath: directory,
      workflow: "investigate",
      priority: "medium",
    });
    await store.update(task.id, (draft) => {
      draft.status = "awaiting-grill";
      draft.currentStage = "grill";
      draft.completedStages = ["triage", "scouts"];
      draft.grillSession = {
        status: "open",
        questions: parseGrillQuestions(GRILL_OUTPUT),
        createdAt: "2026-08-01T12:00:00.000Z",
        completedAt: null,
        completionReason: null,
        completionSource: null,
        policySnapshot: "manual",
        acceptedRecommendationCount: 0,
      };
    });
    const orchestrator = new TaskOrchestrator(store, {
      getStatus: async () => ({ available: true, authenticated: true, authMethod: "ChatGPT" }),
      runCodex: async () => ({
        finalText: "## Specification\n\nThe operator accepted the remaining recommendation.",
        usage: { inputTokens: 10, cachedInputTokens: 4, outputTokens: 5, totalTokens: 15 },
      }),
    });

    await orchestrator.finishGrill(task.id, { acceptRemaining: true, source: "operator" });
    const finished = await waitForStatus(store, task.id, "awaiting-spec-approval");
    assert.equal(finished.grillSession.questions[0].answerSource, "operator-accepted-recommendation");
    assert.equal(finished.grillSession.completionSource, "operator");
    assert.equal(finished.grillSession.acceptedRecommendationCount, 1);
    assert.match(finished.grillSession.completionReason, /Finished by the operator/);
  } finally {
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test("honours an explicit empty triage scout dispatch without fallback", () => {
  const selection = selectScoutDispatch(
    { title: "Small known change", description: "The exact file is already identified.", priority: "high" },
    `<scout-dispatch>{"scouts":[],"rationale":"The triage evidence already identifies the complete code path."}</scout-dispatch>`,
  );
  assert.deepEqual(selection.selected, []);
  assert.equal(selection.rationale, "The triage evidence already identifies the complete code path.");
});

test("auto-advances a zero-question Grill session into specification", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-zero-grill-"));
  try {
    const store = new JsonTaskStore(path.join(directory, "tasks.json"));
    await store.init();
    const task = await store.create({
      title: "Known bounded change",
      description: "No unresolved product decision remains.",
      repositoryPath: directory,
      workflow: "implement",
      priority: "low",
    });
    let scoutCalls = 0;
    const orchestrator = new TaskOrchestrator(store, {
      getStatus: async () => ({ available: true, authenticated: true, authMethod: "ChatGPT" }),
      runCodex: async ({ prompt }) => {
        if (/<scout-report>/.test(prompt)) {
          scoutCalls += 1;
          throw new Error("An explicit empty dispatch must not launch a fallback scout.");
        }
        const finalText = /Your stage assignment:\nClassify the task/.test(prompt)
          ? `<scout-dispatch>{"scouts":[],"rationale":"No additional scout evidence is needed."}</scout-dispatch>`
          : /Your stage assignment:\nSeparate repository facts/.test(prompt)
            ? `<grill-questions>{"questions":[]}</grill-questions>`
            : "## Specification\n\nThe bounded change is ready for approval.";
        return {
          finalText,
          usage: { inputTokens: 10, cachedInputTokens: 5, outputTokens: 5, totalTokens: 15 },
        };
      },
    });

    assert.equal(await orchestrator.start(task.id), true);
    const finished = await waitForStatus(store, task.id, "awaiting-spec-approval");
    assert.equal(scoutCalls, 0);
    assert.deepEqual(finished.scoutDispatch.selected, []);
    assert.equal(finished.scoutDispatch.skipped.length, 6);
    assert.equal(finished.scoutDispatch.rationale, "No additional scout evidence is needed.");
    assert.equal(finished.grillSession.status, "completed");
    assert.equal(finished.grillSession.questions.length, 0);
    assert.deepEqual(finished.completedStages, ["triage", "scouts", "grill", "specification"]);
    assert.equal(
      finished.events.some((event) => event.title === "Grill Me completed automatically"),
      true,
    );
    for (const stage of ["triage", "scouts", "grill", "specification"]) {
      assert.equal(finished.attemptsByStage[stage], 1, `${stage} consumes exactly one workflow attempt`);
      const reservation = finished.stageRunReservations[stage];
      assert.equal(reservation.stage, stage);
      assert.equal(reservation.kind, "investigation");
      assert.equal(reservation.workflowAttempt, 1);
      for (const run of finished.runs.filter((entry) => entry.stage === stage)) {
        assert.equal(run.workflowAttempt, 1);
        assert.equal(run.workflowReservationId, reservation.id);
      }
    }
  } finally {
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test("specification retry succeeds through the read-only specification path", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-specification-retry-"));
  try {
    const store = new JsonTaskStore(path.join(directory, "tasks.json"));
    await store.init();
    const task = await store.create({
      title: "Retry failed specification",
      description: "Recover the specification handoff after a failed synthesis.",
      repositoryPath: directory,
      workflow: "implement",
      priority: "medium",
    });
    await store.update(task.id, (draft) => {
      draft.status = "failed";
      draft.currentStage = "specification";
      draft.completedStages = ["triage", "scouts", "grill"];
      draft.attemptsByStage.specification = 1;
      draft.error = "The prior specification synthesis failed.";
    });
    let request;
    const orchestrator = new TaskOrchestrator(store, {
      getStatus: async () => ({ available: true, authenticated: true, authMethod: "ChatGPT" }),
      runCodex: async (options) => {
        request = options;
        return {
          finalText: "## Specification\n\nThe retry produced a grounded handoff.",
          usage: { inputTokens: 10, cachedInputTokens: 4, outputTokens: 5, totalTokens: 15 },
        };
      },
    });

    assert.equal(await orchestrator.start(task.id, "specification"), true);
    const finished = await waitForStatus(store, task.id, "awaiting-spec-approval");
    assert.equal(request.sandbox, "read-only");
    assert.equal(request.networkAccess, false);
    assert.equal(finished.currentStage, "specification");
    assert.equal(finished.attemptsByStage.specification, 2);
    assert.equal(finished.stageRunReservations.specification.kind, "specification");
    assert.equal(finished.runs.at(-1).role, "specification");
    assert.equal(finished.artifacts.at(-1).stage, "specification");
    assert.deepEqual(finished.completedStages, ["triage", "scouts", "grill", "specification"]);
  } finally {
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test("specification retry cancellation does not advance beyond specification", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-specification-cancel-"));
  try {
    const store = new JsonTaskStore(path.join(directory, "tasks.json"));
    await store.init();
    const task = await store.create({
      title: "Cancel specification retry",
      description: "Cancellation must preserve the failed specification boundary.",
      repositoryPath: directory,
      workflow: "implement",
      priority: "medium",
    });
    await store.update(task.id, (draft) => {
      draft.status = "cancelled";
      draft.currentStage = "specification";
      draft.completedStages = ["triage", "scouts", "grill"];
      draft.attemptsByStage.specification = 1;
    });
    let request;
    const orchestrator = new TaskOrchestrator(store, {
      runCodex: ({ signal, ...options }) => {
        request = { signal, ...options };
        return new Promise((_, reject) => {
          signal.addEventListener("abort", () => reject(new Error("Codex run cancelled.")), { once: true });
        });
      },
    });

    assert.equal(await orchestrator.start(task.id, "specification"), true);
    for (let attempt = 0; !request && attempt < 100; attempt += 1)
      await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(typeof request?.signal?.aborted, "boolean");
    assert.equal(await orchestrator.cancel(task.id), true);
    const cancelled = await waitForStatus(store, task.id, "cancelled");
    assert.equal(cancelled.currentStage, "specification");
    assert.deepEqual(cancelled.completedStages, ["triage", "scouts", "grill"]);
    assert.equal(cancelled.attemptsByStage.specification, 2);
    assert.equal(cancelled.activeRunKind, null);
    assert.equal(cancelled.runs.at(-1).status, "cancelled");
  } finally {
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test("specification retry rejects blocked, exhausted, and wrong-stage states", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-specification-boundary-"));
  try {
    const store = new JsonTaskStore(path.join(directory, "tasks.json"));
    await store.init();
    const task = await store.create({
      title: "Guard specification retry",
      description: "Keep specification retry eligibility explicit.",
      repositoryPath: directory,
      workflow: "implement",
      priority: "medium",
    });
    const orchestrator = new TaskOrchestrator(store, {
      runCodex: async () => {
        throw new Error("must not run");
      },
    });
    for (const item of [
      { status: "blocked", currentStage: "specification", attempts: 1 },
      { status: "failed", currentStage: "specification", attempts: 3 },
      { status: "failed", currentStage: "plan", attempts: 0 },
    ]) {
      await store.update(task.id, (draft) => {
        draft.status = item.status;
        draft.currentStage = item.currentStage;
        draft.attemptsByStage.specification = item.attempts;
      });
      assert.equal(
        await orchestrator.start(task.id, "specification"),
        false,
        `${item.status}:${item.currentStage}`,
      );
    }
  } finally {
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test("counts each failed investigation stage against its own retry allowance", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-investigation-budget-"));
  try {
    const store = new JsonTaskStore(path.join(directory, "tasks.json"));
    await store.init();
    const task = await store.create({
      title: "Count scout failures",
      description: "A failing scout stage must not reuse the successful triage reservation.",
      repositoryPath: directory,
      workflow: "investigate",
      priority: "low",
    });
    await store.update(task.id, (draft) => {
      draft.stageRunLimits.scouts = 2;
    });
    const orchestrator = new TaskOrchestrator(store, {
      getStatus: async () => ({ available: true, authenticated: true, authMethod: "ChatGPT" }),
      runCodex: async ({ prompt }) => {
        if (/<scout-report>/.test(prompt)) throw new Error("Scout failed deterministically.");
        return {
          finalText: `<scout-dispatch>{"scouts":[{"name":"scout-code-path","focus":"Trace the selected failure path.","reason":"The task requires one code-path fact."}],"rationale":"One code-path scout is required."}</scout-dispatch>`,
          usage: { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1, totalTokens: 2 },
        };
      },
    });

    assert.equal(await orchestrator.start(task.id), true);
    let failed = await waitForStatus(store, task.id, "failed");
    assert.equal(failed.currentStage, "scouts");
    assert.equal(failed.attemptsByStage.triage, 1);
    assert.equal(failed.attemptsByStage.scouts, 1);
    assert.notEqual(failed.stageRunReservations.triage.id, failed.stageRunReservations.scouts.id);

    assert.equal(await orchestrator.start(task.id), true);
    failed = await waitForStatus(store, task.id, "blocked");
    assert.equal(failed.currentStage, "scouts");
    assert.equal(failed.attemptsByStage.triage, 1);
    assert.equal(failed.attemptsByStage.scouts, 2);
    assert.equal(await orchestrator.start(task.id), false);
  } finally {
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});
