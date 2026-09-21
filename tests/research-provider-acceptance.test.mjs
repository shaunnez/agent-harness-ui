import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";

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
