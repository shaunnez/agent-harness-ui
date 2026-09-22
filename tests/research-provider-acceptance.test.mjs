import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { preflightResearchAcceptanceRuntime } from "../scripts/research-provider-acceptance-preflight.mjs";
import {
  assertCompletedAcceptanceRun,
  closeAcceptanceResources,
} from "../scripts/research-provider-acceptance-live.mjs";

const execFileAsync = promisify(execFile);
const script = path.resolve("scripts", "research-provider-acceptance.mjs");

test("provider acceptance defaults to a network-free, artifact-free dry run", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "research-acceptance-dry-"));
  try {
    const { stdout } = await execFileAsync(process.execPath, [script], {
      cwd: directory,
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        FIRECRAWL_API_KEY: "must-not-appear",
        SERPER_API_KEY: "must-not-appear-either",
      },
    });
    const result = JSON.parse(stdout);
    assert.equal(result.mode, "dry-run");
    assert.equal(result.networkCalls, 0);
    assert.equal(result.modelCalls, 0);
    assert.equal(result.allowance.calculatedFirecrawlUpperBound, 12);
    assert.equal(stdout.includes("must-not-appear"), false);
    assert.deepEqual(await readdir(directory), []);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("provider acceptance preflight exercises and closes the native database before live work", async () => {
  const calls = [];
  class FakeDatabase {
    constructor(location) {
      calls.push(["open", location]);
    }
    prepare(sql) {
      calls.push(["prepare", sql]);
      return { get: () => calls.push(["get"]) };
    }
    close() {
      calls.push(["close"]);
    }
  }
  await preflightResearchAcceptanceRuntime({
    loadDatabase: async () => ({ default: FakeDatabase }),
  });
  assert.deepEqual(calls, [["open", ":memory:"], ["prepare", "SELECT 1 AS ready"], ["get"], ["close"]]);
});

test("provider acceptance preflight reports a bounded local failure without a live import", async () => {
  await assert.rejects(
    preflightResearchAcceptanceRuntime({
      loadDatabase: async () => {
        throw new Error("native ABI mismatch\nsecond line");
      },
    }),
    (error) => {
      assert.equal(error.code, "acceptance_runtime_preflight_failed");
      assert.match(error.message, /native ABI mismatch second line/);
      return true;
    },
  );
});

test("provider acceptance preserves the underlying fake-model run failure", () => {
  const assertions = [];
  assert.throws(
    () =>
      assertCompletedAcceptanceRun(
        {
          status: "failed",
          error: {
            code: "source_incomplete",
            message: "PDF block status partial at https://provider.invalid/private-detail",
          },
        },
        assertions,
      ),
    (error) => {
      assert.equal(error.code, "source_incomplete");
      assert.equal(error.message.includes("PDF block status partial"), true);
      assert.equal(error.message.includes("provider.invalid"), false);
      return true;
    },
  );
  assert.deepEqual(assertions, [
    { message: "The deterministic fake-model PDF run completed.", passed: false },
  ]);
});

test("provider acceptance closes the database even when runtime shutdown fails", async () => {
  let databaseClosed = false;
  await assert.rejects(
    closeAcceptanceResources(
      {
        async shutdown() {
          throw new Error("shutdown failed");
        },
      },
      {
        close() {
          databaseClosed = true;
        },
      },
    ),
    /shutdown failed/,
  );
  assert.equal(databaseClosed, true);
});
