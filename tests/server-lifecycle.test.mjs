import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, mkdtemp, rm } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { SqliteTaskStore } from "../server/sqlite-store.mjs";

function waitForOutput(child, pattern, timeoutMs = 5_000) {
  return new Promise((resolve, reject) => {
    let output = "";
    const timer = setTimeout(
      () => reject(new Error(`Timed out waiting for server output: ${output}`)),
      timeoutMs,
    );
    const read = (chunk) => {
      output += chunk.toString();
      if (!pattern.test(output)) return;
      clearTimeout(timer);
      child.stdout.off("data", read);
      child.stderr.off("data", read);
      resolve(output);
    };
    child.stdout.on("data", read);
    child.stderr.on("data", read);
  });
}

function waitForExit(child, timeoutMs = 5_000) {
  if (child.exitCode != null) return Promise.resolve(child.exitCode);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timed out waiting for server exit.")), timeoutMs);
    child.once("exit", (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
}

async function availablePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

test("a duplicate companion fails before interrupted-run recovery can rewrite live state", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-runtime-owner-"));
  const databasePath = path.join(directory, "tasks.sqlite3");
  const dataPath = path.join(directory, "tasks.json");
  const runtimeLockPath = `${databasePath}.runtime.lock`;
  const port = await availablePort();
  const store = new SqliteTaskStore(databasePath, { legacyJsonPath: dataPath });
  await store.init();
  const task = await store.create({
    title: "Retain the live owner",
    description: "A failed duplicate launch must not recover another process's run.",
    repositoryPath: process.cwd(),
    workflow: "implement",
    priority: "high",
  });
  store.close();
  const environment = {
    ...process.env,
    AGENT_HARNESS_DATABASE: databasePath,
    AGENT_HARNESS_DATA: dataPath,
    AGENT_HARNESS_PORT: String(port),
    AGENT_HARNESS_GITHUB_POLL_MS: "600000",
  };
  const startServer = () =>
    spawn(process.execPath, ["server/index.mjs"], {
      cwd: process.cwd(),
      env: environment,
      stdio: ["ignore", "pipe", "pipe"],
    });
  const first = startServer();
  try {
    await waitForOutput(first, /local runtime listening/i);
    await access(runtimeLockPath);
    const database = new DatabaseSync(databasePath);
    const row = database.prepare("SELECT core_json FROM tasks WHERE id = ?").get(task.id);
    const running = JSON.parse(row.core_json);
    running.status = "running";
    running.activeRunKind = "implementation";
    running.activeRunReservationId = "reservation-live";
    database
      .prepare("UPDATE tasks SET status = ?, core_json = ? WHERE id = ?")
      .run("running", JSON.stringify(running), task.id);
    database.close();

    const second = startServer();
    const duplicateError = await waitForOutput(second, /already has an active local runtime/i);
    assert.equal(await waitForExit(second), 1);
    assert.doesNotMatch(duplicateError, /EADDRINUSE/);
    const verification = new DatabaseSync(databasePath, { readOnly: true });
    const retained = JSON.parse(
      verification.prepare("SELECT core_json FROM tasks WHERE id = ?").get(task.id).core_json,
    );
    verification.close();
    assert.equal(retained.status, "running");
    assert.equal(retained.activeRunKind, "implementation");

    first.kill("SIGTERM");
    assert.equal(await waitForExit(first), 0);
    await assert.rejects(access(runtimeLockPath), { code: "ENOENT" });
  } finally {
    if (first.exitCode == null) {
      first.kill("SIGTERM");
      await waitForExit(first).catch(() => undefined);
    }
    await rm(directory, { recursive: true, force: true });
  }
});
