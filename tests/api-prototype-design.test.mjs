import test from "node:test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { assert, cleanup, createServer, createTask, fetch, TEST_CSRF_TOKEN } from "./api-test-support.mjs";

test("persists the design option and serves only the retained prototype asset", async () => {
  const { directory, origin, server, store } = await createServer();
  try {
    const response = await createTask(origin, {
      title: "Design-gated task",
      description: "Generate two directions before specification.",
      repositoryPath: directory,
      workflow: "implement",
      designRequested: true,
    });
    assert.equal(response.status, 201);
    const { task } = await response.json();
    assert.equal(task.designRequest.status, "not-started");
    assert.deepEqual(task.designRequest.policies, {
      "claude-design": {
        provider: "claude",
        model: "claude-opus-5",
        reasoning: "high",
        provenance: "settings-default",
      },
      "codex-design": {
        provider: "codex",
        model: "gpt-5.6-sol",
        reasoning: "high",
        provenance: "settings-default",
      },
    });

    const variantId = "variant-local";
    const bundlePath = path.join(directory, "prototypes", task.id, variantId);
    await mkdir(bundlePath, { recursive: true });
    await writeFile(path.join(bundlePath, "index.html"), "<!doctype html><h1>Prototype</h1>");
    await store.update(task.id, (draft) => {
      draft.designRequest.status = "awaiting-selection";
      draft.designRequest.variants = [
        {
          id: variantId,
          revision: 1,
          generator: "codex-design",
          provider: "codex",
          status: "ready",
          title: "Prototype",
          summary: "Local retained prototype.",
          designContract: "Private downstream design contract.",
          previewUrl: `/api/tasks/${task.id}/designs/${variantId}/preview`,
          externalUrl: null,
          bundlePath,
          bundleHash: "abc123",
          model: "gpt-5.6-luna",
          reasoning: "xhigh",
          createdAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
          error: null,
          usage: { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1, totalTokens: 2 },
        },
      ];
    });

    const preview = await fetch(`${origin}/api/tasks/${task.id}/designs/${variantId}/preview`);
    assert.equal(preview.status, 200);
    assert.match(preview.headers.get("content-security-policy"), /connect-src 'none'/);
    assert.match(await preview.text(), /Prototype/);

    const detail = await fetch(`${origin}/api/tasks/${task.id}`);
    const projected = await detail.json();
    assert.equal(projected.task.designRequest.variants[0].bundlePath, undefined);
    assert.equal(projected.task.designRequest.variants[0].designContract, undefined);

    const selected = await fetch(`${origin}/api/tasks/${task.id}/designs/${variantId}/select`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-agent-harness-csrf": TEST_CSRF_TOKEN,
      },
      body: JSON.stringify({ interactionSource: "operator-ui" }),
    });
    assert.equal(selected.status, 202);
  } finally {
    await cleanup(server, directory);
  }
});

test("validates exact design provider and reasoning selections server-side", async () => {
  const { directory, origin, server } = await createServer();
  try {
    const mismatch = await createTask(origin, {
      title: "Mismatched design provider",
      description: "The server must reject cross-provider design policies.",
      repositoryPath: directory,
      workflow: "implement",
      designRequested: true,
      designPolicies: {
        "claude-design": { provider: "codex", model: "gpt-5.6-sol", reasoning: "high" },
        "codex-design": { provider: "codex", model: "gpt-5.6-sol", reasoning: "high" },
      },
    });
    assert.equal(mismatch.status, 400);
    assert.match((await mismatch.json()).error, /claude-design requires a claude model/i);

    const unsupported = await createTask(origin, {
      title: "Unsupported design effort",
      description: "The server must reject unsupported reasoning levels.",
      repositoryPath: directory,
      workflow: "implement",
      designRequested: true,
      designPolicies: {
        "claude-design": { provider: "claude", model: "claude-opus-5", reasoning: "ultra" },
        "codex-design": { provider: "codex", model: "gpt-5.6-sol", reasoning: "high" },
      },
    });
    assert.equal(unsupported.status, 400);
    assert.match((await unsupported.json()).error, /does not support ultra reasoning/i);
  } finally {
    await cleanup(server, directory);
  }
});

test("changing design defaults does not alter an existing task snapshot", async () => {
  const { directory, origin, server } = await createServer();
  try {
    const createdResponse = await createTask(origin, {
      title: "Immutable design snapshot",
      description: "Later Settings changes must not rewrite this task.",
      repositoryPath: directory,
      workflow: "implement",
      designRequested: true,
    });
    assert.equal(createdResponse.status, 201);
    const created = (await createdResponse.json()).task;

    const current = (await (await fetch(`${origin}/api/settings`)).json()).settings;
    const settingsResponse = await fetch(`${origin}/api/settings`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        allowedModels: current.allowedModels,
        defaultModel: current.defaultModel,
        defaultReasoning: current.defaultReasoning,
        designPolicies: {
          "claude-design": { provider: "claude", model: "claude-sonnet-5", reasoning: "high" },
          "codex-design": { provider: "codex", model: "gpt-5.6-luna", reasoning: "xhigh" },
        },
      }),
    });
    assert.equal(settingsResponse.status, 200);

    const retained = (await (await fetch(`${origin}/api/tasks/${created.id}`)).json()).task;
    assert.equal(retained.designRequest.policies["claude-design"].model, "claude-opus-5");
    assert.equal(retained.designRequest.policies["codex-design"].model, "gpt-5.6-sol");
  } finally {
    await cleanup(server, directory);
  }
});
