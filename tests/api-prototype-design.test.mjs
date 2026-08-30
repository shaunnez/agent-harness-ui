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
