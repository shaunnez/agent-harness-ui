import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import test from "node:test";
import { createIsolatedApi } from "../../../scripts/frontier/isolated-api.mjs";

test("Frontier origin, CSRF, persisted questions and denied stale answers use the real isolated API", async () => {
  const api = await createIsolatedApi();
  try {
    const status = await (await fetch(`${api.origin}/api/runtime/status`)).json();
    const headers = {
      origin: "http://127.0.0.1:5199",
      "content-type": "application/json",
      "x-agent-harness-csrf": status.csrfToken,
    };
    const payload = {
      title: "Clarify revision comparison",
      description:
        "Investigate the current revision comparison and clarify its whitespace and case policy. Do not implement.",
      repositoryPath: api.repositoryPath,
      workflow: "investigate",
      priority: "low",
    };
    const send = (url, body = {}, overrides = {}) =>
      fetch(`${api.origin}${url}`, {
        method: "POST",
        headers: { ...headers, ...overrides },
        body: JSON.stringify(body),
      });
    assert.equal((await send("/api/tasks", payload, { origin: "http://evil.invalid" })).status, 403);
    assert.equal((await send("/api/tasks", payload, { "x-agent-harness-csrf": "stale" })).status, 403);
    assert.equal((await api.store.list()).length, 0);
    const response = await send("/api/tasks", payload);
    assert.equal(response.status, 201, await response.clone().text());
    const { task } = await response.json();
    assert.equal(task.status, "queued");
    assert.equal((await send(`/api/tasks/${task.id}/run`)).status, 202);
    let record;
    for (let index = 0; index < 160; index++) {
      record = await api.store.get(task.id);
      if (record.status === "awaiting-grill" || record.status === "failed") break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.equal(record.status, "awaiting-grill", record.error ?? JSON.stringify(record.status));
    for (let index = 0; index < 160 && api.orchestrator.isRunning(task.id); index++) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    const summary = await (await fetch(`${api.origin}/api/tasks`)).json();
    assert.equal(summary.tasks[0].attention.kind, "answer");
    assert.equal(summary.tasks[0].attention.questionId, record.grillSession.questions[0].id);
    const answer = {
      questionId: record.grillSession.questions[0].id,
      answer: "Normalise labels",
      interactionSource: "operator-ui",
    };
    assert.equal((await send(`/api/tasks/${task.id}/grill/answers`, answer)).status, 201);
    const finish = await send(`/api/tasks/${task.id}/grill/finish`, {
      acceptRemaining: false,
      interactionSource: "operator-ui",
    });
    assert.equal(finish.status, 202, await finish.text());
    for (let index = 0; index < 160; index++) {
      record = await api.store.get(task.id);
      if (record.status === "awaiting-spec-approval" || record.status === "failed") break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.equal(record.status, "awaiting-spec-approval", record.error ?? "Specification not reached");
    const stale = await send(`/api/tasks/${task.id}/grill/answers`, {
      ...answer,
      answer: "Use exact labels",
    });
    assert.ok(stale.status >= 400);
    assert.equal((await api.store.get(task.id)).grillSession.questions[0].answer, "Normalise labels");
    assert.ok(record.artifacts.some((artifact) => artifact.stage === "specification"));
    assert.equal((await send(`/api/tasks/${task.id}/approve-spec`)).status, 200);
    assert.equal((await api.store.get(task.id)).status, "completed");
  } finally {
    await api.close();
    await rm(api.root, { recursive: true, force: true });
  }
});

test("an existing directory cannot be adopted as a test data store without its marker", async () => {
  await assert.rejects(createIsolatedApi({ root: process.cwd() }), /ENOENT/);
});
