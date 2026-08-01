import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { parseCodexEvent, selectCodexCandidate } from "../server/codex-runtime.mjs";
import { JsonTaskStore } from "../server/store.mjs";

test("parses Codex final messages and usage", () => {
  assert.deepEqual(
    parseCodexEvent(JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "Ready" } })),
    { type: "message", text: "Ready" },
  );
  assert.equal(
    parseCodexEvent(
      JSON.stringify({ type: "item.completed", item: { type: "command_execution", command: "npm test", exit_code: 1 } }),
    ).commandFailed,
    true,
  );
  assert.deepEqual(
    parseCodexEvent(
      JSON.stringify({ type: "turn.completed", usage: { input_tokens: 10, cached_input_tokens: 4, output_tokens: 5 } }),
    ),
    { type: "usage", usage: { inputTokens: 10, cachedInputTokens: 4, outputTokens: 5, totalTokens: 15 } },
  );
});

test("prefers a Windows Codex runtime with its sandbox helper", () => {
  const candidates = ["C:\\standalone\\codex.exe", "C:\\desktop\\codex.exe"];
  const selected = selectCodexCandidate(candidates, (candidate) =>
    candidate.endsWith("desktop\\codex-windows-sandbox-setup.exe"),
  );
  assert.equal(selected, process.platform === "win32" ? candidates[1] : candidates[0]);
});

test("persists tasks and recovers interrupted runs", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-store-"));
  try {
    const filePath = path.join(directory, "tasks.json");
    const store = new JsonTaskStore(filePath);
    await store.init();
    const task = await store.create({
      title: "Inspect auth",
      description: "Confirm the runtime uses ChatGPT login.",
      repositoryPath: directory,
      workflow: "investigate",
      priority: "medium",
    });
    await store.update(task.id, (draft) => {
      draft.status = "running";
    });
    const reloaded = new JsonTaskStore(filePath);
    await reloaded.init();
    const recovered = await reloaded.get(task.id);
    assert.equal(recovered.status, "failed");
    assert.match(recovered.error, /stopped while this task was running/i);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
