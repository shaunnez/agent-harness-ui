import test from "node:test";
import {
  assert,
  buildExecutionRequest,
  buildScoutRequest,
  buildStageRequest,
  buildWorkPackageRequest,
  createTask,
} from "./runtime-test-support.mjs";

test("context manifests report description truncation independently across every prompt shape", () => {
  for (const length of [5_999, 6_000, 6_001, 10_000, 10_001]) {
    const marker = "__TASK_CONTEXT_SENTINEL__";
    const description = `${"x".repeat(length - marker.length)}${marker}`;
    const task = createTask({
      id: "AH-CONTEXT",
      title: "T".repeat(299),
      description,
      workflow: "implement",
      priority: "high",
      artifacts: [],
      decisions: [],
      attachments: [],
    });
    const candidate = {
      id: "C1",
      revisionNumber: 3,
      baseRevision: "a".repeat(40),
      headRevision: "b".repeat(40),
    };
    const workPackage = {
      id: "S1",
      title: "Context",
      description: "Keep accounting exact.",
      dependencies: [],
      ownedPaths: ["server/prompts.mjs"],
      verification: ["npm test"],
    };
    const requests = [
      buildStageRequest(task, "triage"),
      buildExecutionRequest(task, "dev-review", candidate),
      buildWorkPackageRequest(task, workPackage, { baseRevision: candidate.baseRevision }),
      buildScoutRequest(
        task,
        { name: "scout-code-path", focus: "Trace prompt construction.", reason: "Verify accounting." },
        null,
      ),
    ];
    const expectedLabels = [
      "Task ID, title, description, workflow, and priority",
      "Task ID, title, and description",
      "Task ID, title, and description",
      "Task ID, title, priority, and scoped description",
    ];
    for (const [index, request] of requests.entries()) {
      const source = request.contextManifest.sources.find((item) => item.kind === "task");
      const expectedDescriptionLength = Math.min(length, 6_000);
      const includesWorkflow = source.label.includes("workflow");
      const includesPriority = source.label.includes("priority");
      const expectedIncluded =
        task.id.length +
        task.title.length +
        expectedDescriptionLength +
        (includesWorkflow ? task.workflow.length : 0) +
        (includesPriority ? task.priority.length : 0);
      const expectedOriginal =
        task.id.length +
        task.title.length +
        description.length +
        (includesWorkflow ? task.workflow.length : 0) +
        (includesPriority ? task.priority.length : 0);
      assert.equal(source.label, expectedLabels[index]);
      assert.equal(source.includedCharacters, expectedIncluded);
      assert.equal(source.originalCharacters, expectedOriginal);
      assert.equal(source.truncated, length > 6_000);
      assert.equal(request.contextManifest.promptCharacters, request.prompt.length);
      assert.equal(request.prompt.includes(marker), length <= 6_000);
      assert.equal(request.prompt.includes("\nWorkflow:"), includesWorkflow);
      assert.equal(request.prompt.includes("\nPriority:"), includesPriority);
    }
  }
});

test("candidate review prompts name the exact structured finding fields", () => {
  const task = createTask({
    id: "AH-GATE-PROMPT",
    title: "Review prompt",
    description: "Return candidate-bound findings.",
    workflow: "implement",
    artifacts: [],
    decisions: [],
    attachments: [],
    workPackages: [
      {
        id: "S1",
        verificationRuns: [
          {
            candidateId: "S1",
            candidateRevision: 1,
            headRevision: "b".repeat(40),
            executionKind: "focused-package",
            status: "passed",
            durationMs: 38_034,
            rows: [
              { id: "frontend-lint", status: "passed" },
              { id: "frontend-test", status: "passed" },
            ],
          },
        ],
      },
    ],
  });
  const request = buildExecutionRequest(task, "dev-review", {
    id: "C1",
    revisionNumber: 2,
    baseRevision: "a".repeat(40),
    headRevision: "b".repeat(40),
    members: [{ packageId: "S1", headRevision: "b".repeat(40), order: 1 }],
  });

  assert.match(request.prompt, /Every blocking candidate defect needs deterministic reproductionEvidence/);
  assert.match(request.prompt, /"kind":"candidate-defect"/);
  assert.match(request.prompt, /"title":"Concise finding title"/);
  assert.match(request.prompt, /"detail":"Concrete failure scenario and smallest correction"/);
  assert.match(request.prompt, /"file":"src\/example\.ts"/);
  assert.match(
    request.prompt,
    /Do not run tests, builds, linters, type checks, package scripts, or verification-manifest commands/,
  );
  assert.match(request.prompt, /Use at most four targeted repository commands/);
  assert.match(
    request.prompt,
    /Every command must be constructed to exit zero when the intended inspection succeeds/,
  );
  assert.match(request.prompt, /A non-zero diagnostic command invalidates an otherwise-PASS review/);
  assert.match(
    request.prompt,
    /S1 @ b{40}: PASSED \(frontend-lint=PASSED, frontend-test=PASSED\) in 38034ms/,
  );
  assert.match(request.prompt, /Full exact-candidate manifest verification belongs to the later Test gate/);
  assert.match(request.prompt, /Do not inspect global memory, skill, plugin, cache, configuration/);
  assert.doesNotMatch(request.prompt, /"path":/);
});

test("implementation prompts make the no-change marker part of one unambiguous output contract", () => {
  const task = createTask({
    id: "AH-NOOP-PROMPT",
    title: "Qualify an already-satisfied package",
    description: "Retain repository evidence for a legitimate no-op.",
    workflow: "implement",
    artifacts: [],
    decisions: [],
    attachments: [],
  });
  const request = buildWorkPackageRequest(
    task,
    {
      id: "S1",
      title: "Confirm existing contract",
      description: "Change nothing when the repository already matches.",
      dependencies: [],
      ownedPaths: ["server/prompts.mjs"],
      verificationCommandIds: ["unit"],
    },
    { baseRevision: "a".repeat(40) },
  );

  assert.match(
    request.prompt,
    /exact H2 headings in order: Outcome, Changes, Verification, Ownership exceptions, Remaining risks/,
  );
  assert.ok(
    request.prompt.indexOf("Critical completion contract") <
      request.prompt.indexOf("Task ID: AH-NOOP-PROMPT"),
    "the no-op machine contract must be visible before the large task context",
  );
  assert.match(request.prompt, /ordinary prose saying "no changes" is not machine-readable/);
  assert.match(
    request.prompt,
    /append this machine-readable marker as the final non-blank line after Remaining risks/,
  );
  assert.match(
    request.prompt,
    /<no-changes-needed>\{"reason":"one sentence citing the repository evidence"\}<\/no-changes-needed>/,
  );
  assert.match(request.prompt, /marker is mandatory for every no-change outcome/);
  assert.match(request.prompt, /fail the package as an unproven empty diff/);
});

test("work-package prompts use only the exact approved specification and plan", () => {
  const task = createTask({
    id: "AH-APPROVED-CONTEXT",
    artifacts: [
      {
        id: "SPEC-1",
        stage: "specification",
        name: "task-specification.md",
        content: "APPROVED SPEC",
        createdAt: "2026-08-01T00:00:00.000Z",
      },
      {
        id: "PLAN-1",
        stage: "plan",
        name: "implementation-plan.md",
        content: "SUPERSEDED PLAN",
        createdAt: "2026-08-01T00:01:00.000Z",
      },
      {
        id: "PLAN-2",
        stage: "plan",
        name: "implementation-plan-r2.md",
        content: "EXACT APPROVED PLAN",
        createdAt: "2026-08-01T00:02:00.000Z",
      },
      {
        id: "PLAN-3",
        stage: "plan",
        name: "implementation-plan-r3.md",
        content: "UNAPPROVED LATER PLAN",
        createdAt: "2026-08-01T00:04:00.000Z",
      },
    ],
    approvals: [
      {
        id: "APP-SPEC",
        stage: "specification",
        artifactId: "SPEC-1",
        note: "",
        createdAt: "2026-08-01T00:00:30.000Z",
      },
      {
        id: "APP-PLAN",
        stage: "plan",
        artifactId: "PLAN-2",
        note: "",
        createdAt: "2026-08-01T00:03:00.000Z",
      },
    ],
  });
  const request = buildWorkPackageRequest(
    task,
    {
      id: "S1",
      title: "Use the approved handoff",
      description: "Do not read rejected plan revisions.",
      dependencies: [],
      ownedPaths: ["server/prompts.mjs"],
      verificationCommandIds: ["unit"],
    },
    { baseRevision: "a".repeat(40) },
  );

  assert.match(request.prompt, /APPROVED SPEC/);
  assert.match(request.prompt, /EXACT APPROVED PLAN/);
  assert.doesNotMatch(request.prompt, /SUPERSEDED PLAN|UNAPPROVED LATER PLAN/);
  assert.deepEqual(
    request.contextManifest.sources.filter((source) => source.kind === "artifact").map((source) => source.id),
    ["SPEC-1", "PLAN-2"],
  );
});

test("context manifests report title truncation at 299, 300, and 301 characters", () => {
  for (const length of [299, 300, 301]) {
    const marker = "__TASK_TITLE_SENTINEL__";
    const title = `${"T".repeat(length - marker.length)}${marker}`;
    const task = createTask({
      id: "AH-TITLE-CONTEXT",
      title,
      description: "Short untruncated description.",
      workflow: "implement",
      priority: "high",
      artifacts: [],
      decisions: [],
      attachments: [],
    });
    const candidate = {
      id: "C1",
      revisionNumber: 3,
      baseRevision: "a".repeat(40),
      headRevision: "b".repeat(40),
    };
    const workPackage = {
      id: "S1",
      title: "Context",
      description: "Keep accounting exact.",
      dependencies: [],
      ownedPaths: ["server/prompts.mjs"],
      verification: ["npm test"],
    };
    const requests = [
      buildStageRequest(task, "triage"),
      buildExecutionRequest(task, "dev-review", candidate),
      buildWorkPackageRequest(task, workPackage, { baseRevision: candidate.baseRevision }),
      buildScoutRequest(
        task,
        { name: "scout-code-path", focus: "Trace prompt construction.", reason: "Verify accounting." },
        null,
      ),
    ];

    for (const request of requests) {
      const source = request.contextManifest.sources.find((item) => item.kind === "task");
      const includesWorkflow = source.label.includes("workflow");
      const includesPriority = source.label.includes("priority");
      const expectedIncluded =
        task.id.length +
        Math.min(length, 300) +
        task.description.length +
        (includesWorkflow ? task.workflow.length : 0) +
        (includesPriority ? task.priority.length : 0);
      const expectedOriginal =
        task.id.length +
        length +
        task.description.length +
        (includesWorkflow ? task.workflow.length : 0) +
        (includesPriority ? task.priority.length : 0);

      assert.equal(source.includedCharacters, expectedIncluded);
      assert.equal(source.originalCharacters, expectedOriginal);
      assert.equal(source.truncated, length > 300);
      assert.equal(request.prompt.includes(marker), length <= 300);
      assert.equal(request.contextManifest.promptCharacters, request.prompt.length);
    }
  }
});

test("artifact manifests account for transformations, prefixes, separators, and aggregate caps", () => {
  const patchContent = "Retained review evidence.\n\n<details><summary>Candidate patch</summary>\n";
  const planContent = "P".repeat(6_000);
  const task = createTask({
    artifacts: [
      {
        id: "artifact-spec",
        stage: "specification",
        name: "task-specification.md",
        content: patchContent,
        model: "gpt-5.6-luna",
        usage: { totalTokens: 10 },
      },
      {
        id: "artifact-plan",
        stage: "plan",
        name: "implementation-plan.md",
        content: planContent,
        model: "gpt-5.6-luna",
        usage: { totalTokens: 10 },
      },
      {
        id: "artifact-implement",
        stage: "implement",
        name: "implementation-candidate.md",
        content: "I".repeat(7_000),
        model: "gpt-5.6-luna",
        usage: { totalTokens: 10 },
      },
      {
        id: "artifact-review",
        stage: "dev-review",
        name: "development-review.md",
        content: "R".repeat(7_000),
        model: "gpt-5.6-sol",
        usage: { totalTokens: 10 },
      },
      {
        id: "artifact-test",
        stage: "test",
        name: "test-evidence.md",
        content: "T".repeat(7_000),
        model: "gpt-5.6-sol",
        usage: { totalTokens: 10 },
      },
    ],
  });
  const request = buildExecutionRequest(task, "implement", {
    id: "C1",
    revisionNumber: 1,
    baseRevision: "a".repeat(40),
    headRevision: "b".repeat(40),
  });
  const artifactSources = request.contextManifest.sources.filter((source) => source.kind === "artifact");
  const contextLabel =
    "Retained workflow artifacts (the specification and plan are approval-gated; review/test artifacts may describe failures):\n";
  const contextStart = request.prompt.indexOf(contextLabel) + contextLabel.length;
  const contextEnd = request.prompt.indexOf("\n\nUse these retained handoffs", contextStart);
  const renderedContext = request.prompt.slice(contextStart, contextEnd);

  assert.equal(request.contextManifest.promptCharacters, request.prompt.length);
  assert.equal(
    artifactSources.reduce((sum, source) => sum + source.includedCharacters, 0),
    renderedContext.length,
  );
  const specification = artifactSources.find((source) => source.id === "artifact-spec");
  const plan = artifactSources.find((source) => source.id === "artifact-plan");
  const testEvidence = artifactSources.find((source) => source.id === "artifact-test");
  const specificationPrefix =
    "## specification: task-specification.md\nModel: gpt-5.6-luna; tokens: 10; estimated cost: unavailable\n";
  const planPrefix =
    "## plan: implementation-plan.md\nModel: gpt-5.6-luna; tokens: 10; estimated cost: unavailable\n";
  const transformedSpecification =
    "Retained review evidence.\n\n_Exact patch omitted from agent context; inspect the candidate revision when required._";

  assert.equal(specification.originalCharacters, patchContent.length);
  assert.equal(
    specification.includedCharacters,
    specificationPrefix.length + transformedSpecification.length,
  );
  assert.equal(transformedSpecification.length > patchContent.length, true);
  assert.equal(specification.truncated, true, "narrative patch omission is a truncating transformation");
  assert.equal(plan.originalCharacters, planContent.length);
  assert.equal(plan.includedCharacters, 2 + planPrefix.length + 5_000);
  assert.equal(plan.truncated, true, "the per-artifact cap is reported independently of raw length");
  assert.equal(testEvidence.originalCharacters, 7_000);
  assert.equal(testEvidence.truncated, true, "the aggregate context cap is reported for the final artifact");
  assert.match(request.prompt, /Exact patch omitted from agent context/);
  assert.doesNotMatch(request.prompt, /<details><summary>Candidate patch/);
});

test("scout manifests preserve priority, exclude workflow, and cap triage at 4,000 characters", () => {
  for (const length of [3_999, 4_000, 4_001]) {
    const marker = "__TRIAGE_CONTEXT_SENTINEL__";
    const triageContent = `${"t".repeat(length - marker.length)}${marker}`;
    const task = createTask({
      description: "Scout the task-relevant route.",
      workflow: "implement",
      priority: "high",
    });
    const request = buildScoutRequest(
      task,
      { name: "scout-code-path", focus: "Trace the route.", reason: "The route is task-relevant." },
      { id: `triage-${length}`, name: "triage.md", content: triageContent },
    );
    const taskSource = request.contextManifest.sources.find((source) => source.kind === "task");
    const triageSource = request.contextManifest.sources.find((source) => source.id === `triage-${length}`);

    assert.equal(taskSource.label, "Task ID, title, priority, and scoped description");
    assert.equal(request.prompt.includes("Priority: high"), true);
    assert.equal(request.prompt.includes("Workflow:"), false);
    assert.equal(triageSource.includedCharacters, Math.min(length, 4_000));
    assert.equal(triageSource.originalCharacters, length);
    assert.equal(triageSource.truncated, length > 4_000);
    assert.equal(request.prompt.includes(marker), length <= 4_000);
    assert.equal(request.contextManifest.promptCharacters, request.prompt.length);
  }

  const emptyArtifact = buildScoutRequest(
    createTask(),
    { name: "scout-code-path", focus: "Trace the route.", reason: "The route is task-relevant." },
    { id: "empty-triage", name: "triage.md", content: "" },
  );
  assert.doesNotMatch(emptyArtifact.prompt, /No triage artifact was retained/);
  assert.deepEqual(
    emptyArtifact.contextManifest.sources.find((source) => source.id === "empty-triage"),
    {
      kind: "artifact",
      id: "empty-triage",
      label: "triage.md",
      stage: "triage",
      includedCharacters: 0,
      originalCharacters: 0,
      truncated: false,
    },
  );
});
