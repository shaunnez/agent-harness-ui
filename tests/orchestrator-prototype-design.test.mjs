import test from "node:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { JsonTaskStore } from "../server/store.mjs";
import { TaskOrchestrator } from "../server/orchestrator.mjs";
import {
  buildPrototypePrompt,
  claudeDesignArgs,
  createClaudeDesignUrlCollector,
  createPrototypeGenerator,
  parseUrl,
} from "../server/prototype-generator.mjs";
import { parseGrillQuestions } from "../server/structured-output.mjs";
import { waitForTaskStatus } from "./wait-support.mjs";

const GRILL = `<grill-questions>{"questions":[{"question":"How safe?","whyItMatters":"A human gate is required.","options":[{"label":"Confirm first","description":"Require confirmation.","recommended":true},{"label":"Execute immediately","description":"Skip confirmation.","recommended":false}],"allowCustom":true}]}</grill-questions>`;

test("confines non-interactive Claude Design publication to DesignSync", () => {
  const args = claudeDesignArgs("session-123", {
    provider: "claude",
    model: "claude-opus-5",
    reasoning: "high",
  });
  assert.deepEqual(args.slice(args.indexOf("--model"), args.indexOf("--model") + 2), [
    "--model",
    "claude-opus-5",
  ]);
  assert.deepEqual(args.slice(args.indexOf("--effort"), args.indexOf("--effort") + 2), ["--effort", "high"]);
  assert.deepEqual(args.slice(args.indexOf("--tools"), args.indexOf("--tools") + 4), [
    "--tools",
    "DesignSync",
    "--allowedTools",
    "DesignSync",
  ]);
  assert.deepEqual(args.slice(args.indexOf("--permission-mode"), args.indexOf("--permission-mode") + 2), [
    "--permission-mode",
    "bypassPermissions",
  ]);
  assert.equal(args.includes("--safe-mode"), true);
  assert.equal(args.includes("--dangerously-skip-permissions"), false);
});

test("extracts a Claude Design URL without Markdown emphasis", () => {
  assert.equal(
    parseUrl("**https://claude.ai/design/project-123** — published"),
    "https://claude.ai/design/project-123",
  );
});

test("retains the published URL from the DesignSync tool result", () => {
  const collector = createClaudeDesignUrlCollector();
  collector.parse(
    JSON.stringify({
      type: "assistant",
      message: { content: [{ type: "tool_use", id: "design-1", name: "DesignSync", input: {} }] },
    }),
  );
  collector.parse(
    JSON.stringify({
      type: "user",
      message: {
        content: [
          {
            type: "tool_result",
            tool_use_id: "design-1",
            content: [{ type: "text", text: "Published https://claude.ai/design/task-light-mode" }],
          },
        ],
      },
    }),
  );
  assert.equal(collector.result(), "https://claude.ai/design/task-light-mode");
});

test("derives the canonical Claude Design URL from a correlated create_project result", () => {
  const collector = createClaudeDesignUrlCollector();
  collector.parse(
    JSON.stringify({
      type: "assistant",
      message: {
        content: [
          {
            type: "tool_use",
            id: "design-create",
            name: "DesignSync",
            input: { method: "create_project", name: "Light mode" },
          },
        ],
      },
    }),
  );
  collector.parse(
    JSON.stringify({
      type: "user",
      message: {
        content: [
          {
            type: "tool_result",
            tool_use_id: "design-create",
            content: "Project created successfully.",
          },
        ],
      },
      toolUseResult: {
        method: "create_project",
        projectId: "e400e0f0-1129-4703-8021-86daa218db92",
      },
    }),
  );
  assert.equal(collector.result(), "https://claude.ai/design/p/e400e0f0-1129-4703-8021-86daa218db92");
});

test("keeps design prompts task-driven and supplies retained repository evidence", () => {
  const prompt = buildPrototypePrompt(
    {
      id: "AH-042",
      title: "Explore the existing light mode",
      description: "Preserve the current app and show its existing screen in light mode.",
      decisions: [{ question: "Scope?", answer: "Existing screen only" }],
      artifacts: [
        {
          id: "artifact-1",
          stage: "grill",
          name: "decision-brief.md",
          content: "The app already has a persisted light/dark theme toggle.",
        },
      ],
    },
    "codex-design",
  );
  assert.match(prompt, /Preserve the current app and show its existing screen in light mode/);
  assert.match(prompt, /Scope\?: Existing screen only/);
  assert.match(prompt, /The app already has a persisted light\/dark theme toggle/);
  assert.match(prompt, /preserve its information architecture, component anatomy, density/i);
  assert.doesNotMatch(prompt, /The prototype must visibly demonstrate/);
  assert.doesNotMatch(prompt, /A2UI/);
});

test("invokes Codex Design with the exact snapshotted model and reasoning", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-design-generator-"));
  try {
    let invocation = null;
    const generate = createPrototypeGenerator({
      runCodexImpl: async (input) => {
        invocation = input;
        await Promise.all([
          writeFile(path.join(input.cwd, "index.html"), "<!doctype html><h1>Exact policy</h1>"),
          writeFile(path.join(input.cwd, "design.md"), "# Exact policy"),
          writeFile(
            path.join(input.cwd, "manifest.json"),
            JSON.stringify({ title: "Exact policy", summary: "Used the task snapshot." }),
          ),
        ]);
        return { usage: { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1, totalTokens: 2 } };
      },
    });
    const policy = {
      provider: "codex",
      model: "gpt-5.6-sol",
      reasoning: "high",
      provenance: "task-selection",
    };
    const result = await generate({
      task: {
        id: "AH-001",
        title: "Exact policy",
        description: "Use the retained task policy.",
        repositoryPath: directory,
        decisions: [],
        artifacts: [
          {
            id: "triage-1",
            stage: "triage",
            name: "triage.md",
            content: "Preserve the existing task workspace shell.",
          },
        ],
      },
      variant: { id: "variant-1", generator: "codex-design", provider: "codex", policy },
      bundlePath: directory,
      signal: new AbortController().signal,
    });
    assert.equal(invocation.model, "gpt-5.6-sol");
    assert.equal(invocation.reasoning, "high");
    assert.match(invocation.prompt, /Preserve the existing task workspace shell/);
    assert.equal(result.model, "gpt-5.6-sol");
    assert.equal(result.reasoning, "high");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

async function waitForStatus(store, id, status) {
  return waitForTaskStatus(store, id, status);
}

test("generates two retained designs, selects one exact revision, and supplies it to Task Spec", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-design-flow-"));
  try {
    const store = new JsonTaskStore(path.join(directory, "tasks.json"));
    await store.init();
    const task = await store.create({
      title: "Contextual chat companion",
      description: "Add safe contextual navigation and task actions.",
      repositoryPath: process.cwd(),
      workflow: "implement",
      priority: "medium",
      designRequested: true,
    });
    await store.update(task.id, (draft) => {
      draft.status = "awaiting-grill";
      draft.currentStage = "grill";
      draft.completedStages = ["triage", "scouts"];
      draft.grillSession = {
        status: "open",
        questions: parseGrillQuestions(GRILL),
        createdAt: new Date().toISOString(),
        completedAt: null,
        completionReason: null,
        completionSource: null,
        policySnapshot: "manual",
        acceptedRecommendationCount: 0,
      };
    });
    let specificationPrompt = null;
    const orchestrator = new TaskOrchestrator(store, {
      generatePrototype: async ({ variant, bundlePath }) => {
        await mkdir(bundlePath, { recursive: true });
        await writeFile(path.join(bundlePath, "index.html"), `<h1>${variant.generator}</h1>`);
        return {
          title: variant.generator === "claude-design" ? "Spatial companion" : "Evidence messenger",
          summary: `${variant.generator} retained summary`,
          designContract: `${variant.generator} exact implementation contract`,
          externalUrl:
            variant.generator === "claude-design" ? "https://claude.ai/design/mock-prototype" : null,
          bundleHash: variant.generator === "codex-design" ? "abc123" : null,
          model: variant.policy.model,
          reasoning: variant.policy.reasoning,
          usage: {
            inputTokens: 10,
            cachedInputTokens: 2,
            cacheWriteTokens: 0,
            outputTokens: 5,
            totalTokens: 15,
          },
        };
      },
      runCodex: async ({ prompt }) => {
        specificationPrompt = prompt;
        return {
          finalText: "## Outcome\n\nSelected design is specified.",
          usage: { inputTokens: 10, cachedInputTokens: 2, outputTokens: 5, totalTokens: 15 },
        };
      },
    });

    await orchestrator.finishGrill(task.id, { acceptRemaining: true, source: "operator" });
    let designed = await waitForStatus(store, task.id, "awaiting-design-selection");
    assert.equal(designed.designRequest.variants.length, 2);
    assert.deepEqual(
      designed.designRequest.variants.map((variant) => variant.status),
      ["ready", "ready"],
    );
    const selected = designed.designRequest.variants.find((variant) => variant.generator === "codex-design");

    await orchestrator.selectDesign(task.id, selected.id, { source: "operator" });
    designed = await waitForStatus(store, task.id, "awaiting-spec-approval");
    assert.equal(designed.designRequest.status, "selected");
    assert.equal(designed.designRequest.selectedVariantId, selected.id);
    assert.match(specificationPrompt, /Evidence messenger/);
    assert.match(specificationPrompt, /Bundle SHA-256: abc123/);
    assert.match(specificationPrompt, /codex-design exact implementation contract/);
    const specification = designed.artifacts.find((artifact) => artifact.stage === "specification");
    assert.equal(
      specification.contextManifest.sources.some(
        (source) => source.kind === "prototype" && source.id === selected.id,
      ),
      true,
    );
  } finally {
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test("a design-checked Fast task escalates instead of bypassing prototype selection", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-design-fast-"));
  try {
    const store = new JsonTaskStore(path.join(directory, "tasks.json"));
    await store.init();
    const task = await store.create({
      title: "Design before fast implementation",
      description: "The selected design must remain a governed input.",
      repositoryPath: process.cwd(),
      workflow: "implement",
      priority: "low",
      designRequested: true,
    });
    await store.update(task.id, (draft) => {
      draft.workflowProfile.selected = "fast";
      draft.workflowProfile.reason = "Operator requested fast.";
    });
    const orchestrator = new TaskOrchestrator(store, {
      generatePrototype: async ({ variant }) => ({
        title: variant.generator,
        summary: "Ready for selection.",
        externalUrl: `https://example.test/${variant.id}`,
        bundleHash: null,
        model: variant.policy.model,
        reasoning: variant.policy.reasoning,
        usage: { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1, totalTokens: 2 },
      }),
      runCodex: async ({ prompt }) => ({
        finalText: /Separate repository facts/.test(prompt)
          ? `<grill-questions>{"questions":[]}</grill-questions>`
          : `<scout-dispatch>{"scouts":[],"rationale":"No additional repository fact is required."}</scout-dispatch>`,
        usage: { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1, totalTokens: 2 },
      }),
    });

    assert.equal(await orchestrator.start(task.id), true);
    const designed = await waitForStatus(store, task.id, "awaiting-design-selection");
    assert.equal(designed.workflowProfile.selected, "standard");
    assert.match(designed.workflowProfile.reason, /two governed prototype revisions/i);
    assert.equal(designed.designRequest.variants.length, 2);
  } finally {
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test("retry retains successful provider evidence and replaces only the failed direction", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-design-retry-"));
  try {
    const store = new JsonTaskStore(path.join(directory, "tasks.json"));
    await store.init();
    const task = await store.create({
      title: "Retain prototype history",
      description: "A retry must not erase prior provider evidence.",
      repositoryPath: process.cwd(),
      workflow: "implement",
      priority: "medium",
      designRequested: true,
    });
    await store.update(task.id, (draft) => {
      draft.status = "awaiting-grill";
      draft.currentStage = "grill";
      draft.grillSession = {
        status: "open",
        questions: [],
        createdAt: new Date().toISOString(),
        completedAt: null,
        completionReason: null,
        completionSource: null,
        policySnapshot: "manual",
        acceptedRecommendationCount: 0,
      };
    });
    let failFirstClaude = true;
    const orchestrator = new TaskOrchestrator(store, {
      generatePrototype: async ({ variant }) => {
        if (variant.generator === "claude-design" && failFirstClaude) {
          failFirstClaude = false;
          const error = new Error("Provider unavailable");
          error.prototypeEvidence = {
            summary: "Claude retained partial output before publication failed.",
            designContract: "Partial implementation contract.",
            usage: { inputTokens: 3, cachedInputTokens: 1, outputTokens: 2, totalTokens: 5 },
            contextManifest: {
              stage: "specification",
              promptCharacters: 100,
              estimatedPromptTokens: 25,
              repositoryAccess: "none",
              policy: "Bounded design context.",
              sources: [],
            },
          };
          throw error;
        }
        return {
          title: variant.generator,
          summary: "Ready for selection.",
          designContract: "Retained exact design contract.",
          externalUrl: `https://example.test/${variant.id}`,
          bundleHash: null,
          model: variant.policy.model,
          reasoning: variant.policy.reasoning,
          usage: { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1, totalTokens: 2 },
        };
      },
      runCodex: async () => ({
        finalText: "## Outcome\n\nSelected design is specified.",
        usage: { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1, totalTokens: 2 },
      }),
    });

    await orchestrator.finishGrill(task.id, { source: "operator" });
    const failed = await waitForStatus(store, task.id, "failed");
    const priorVariantId = failed.designRequest.variants.find((variant) => variant.status === "ready").id;
    const failedClaude = failed.designRequest.variants.find((variant) => variant.status === "failed");
    assert.equal(failedClaude.summary, "Claude retained partial output before publication failed.");
    assert.equal(failedClaude.contextManifest.promptCharacters, 100);
    assert.equal(failedClaude.usage.totalTokens, 5);
    const originalPolicies = structuredClone(failed.designRequest.policies);
    assert.equal(
      failed.designRequest.variants.find((variant) => variant.status === "failed").model,
      "claude-opus-5",
    );
    await store.updateSettings((draft) => {
      draft.designPolicies = {
        "claude-design": { provider: "claude", model: "claude-sonnet-5", reasoning: "high" },
        "codex-design": { provider: "codex", model: "gpt-5.6-luna", reasoning: "xhigh" },
      };
    });

    await orchestrator.retryDesigns(task.id, { source: "operator" });
    const retried = await waitForStatus(store, task.id, "awaiting-design-selection");
    assert.equal(retried.designRequest.variants.length, 3);
    assert.deepEqual(
      retried.designRequest.variants.map((variant) => variant.revision),
      [1, 1, 2],
    );
    assert.deepEqual(retried.designRequest.policies, originalPolicies);
    assert.deepEqual(
      retried.designRequest.variants.slice(2).map((variant) => variant.policy),
      [originalPolicies["claude-design"]],
    );
    await orchestrator.selectDesign(task.id, priorVariantId, { source: "operator" });
    const specified = await waitForStatus(store, task.id, "awaiting-spec-approval");
    assert.equal(specified.designRequest.selectedVariantId, priorVariantId);
  } finally {
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});
