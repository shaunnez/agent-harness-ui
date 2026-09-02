import test from "node:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { JsonTaskStore } from "../server/store.mjs";
import { TaskOrchestrator } from "../server/orchestrator.mjs";
import {
  claudeDesignArgs,
  createClaudeDesignUrlCollector,
  parseUrl,
} from "../server/prototype-generator.mjs";
import { parseGrillQuestions } from "../server/structured-output.mjs";

const GRILL = `<grill-questions>{"questions":[{"question":"How safe?","whyItMatters":"A human gate is required.","options":[{"label":"Confirm first","description":"Require confirmation.","recommended":true},{"label":"Execute immediately","description":"Skip confirmation.","recommended":false}],"allowCustom":true}]}</grill-questions>`;

test("confines non-interactive Claude Design publication to DesignSync", () => {
  const args = claudeDesignArgs("session-123");
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

async function waitForStatus(store, id, status) {
  for (let attempt = 0; attempt < 1_000; attempt += 1) {
    const task = await store.get(id);
    if (task.status === status) return task;
    if (["failed", "blocked"].includes(task.status) && task.status !== status) {
      throw new Error(task.error ?? `Task stopped at ${task.status}.`);
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for ${status}.`);
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
          model: variant.provider === "claude" ? "claude-sonnet-5" : "gpt-5.6-luna",
          reasoning: variant.provider === "codex" ? "xhigh" : null,
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
        model: variant.provider === "claude" ? "claude-sonnet-5" : "gpt-5.6-luna",
        reasoning: null,
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
          throw new Error("Provider unavailable");
        }
        return {
          title: variant.generator,
          summary: "Ready for selection.",
          designContract: "Retained exact design contract.",
          externalUrl: `https://example.test/${variant.id}`,
          bundleHash: null,
          model: variant.provider === "claude" ? "claude-sonnet-5" : "gpt-5.6-luna",
          reasoning: null,
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

    await orchestrator.retryDesigns(task.id, { source: "operator" });
    const retried = await waitForStatus(store, task.id, "awaiting-design-selection");
    assert.equal(retried.designRequest.variants.length, 3);
    assert.deepEqual(
      retried.designRequest.variants.map((variant) => variant.revision),
      [1, 1, 2],
    );
    await orchestrator.selectDesign(task.id, priorVariantId, { source: "operator" });
    const specified = await waitForStatus(store, task.id, "awaiting-spec-approval");
    assert.equal(specified.designRequest.selectedVariantId, priorVariantId);
  } finally {
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});
