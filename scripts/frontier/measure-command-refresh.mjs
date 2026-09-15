import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import os from "node:os";
import { createFixtureGateway } from "../../src/frontier/fixtures/gateway.ts";
import { RefreshCoordinator } from "../../src/frontier/runtime/coordinator.ts";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function measure(size, pinCount) {
  const gateway = createFixtureGateway(size);
  const reads = {};
  let concurrentRuns = 0,
    maxConcurrentRuns = 0;
  for (const method of [
    "status",
    "workspaceHead",
    "workspaceHistory",
    "projects",
    "markers",
    "summaries",
    "core",
    "runs",
    "activity",
    "watchedRun",
    "exactRun",
  ]) {
    const original = gateway[method];
    gateway[method] = async (...args) => {
      if (method === "watchedRun") maxConcurrentRuns = Math.max(maxConcurrentRuns, ++concurrentRuns);
      try {
        const response = await original(...args);
        reads[method] ??= { requests: 0, jsonBytes: 0 };
        const count = reads[method];
        count.requests++;
        count.jsonBytes += Buffer.byteLength(JSON.stringify(response));
        return response;
      } finally {
        if (method === "watchedRun") concurrentRuns--;
      }
    };
  }
  const runtime = new RefreshCoordinator(gateway);
  try {
    runtime.start();
    while (!runtime.getSnapshot().tasks.length) await sleep(5);
    runtime.setWatchRequests(
      runtime.getSnapshot().workspace.sourceId,
      Array.from({ length: pinCount }, (_, i) => ({
        taskId: `LOAD-${i + 1}-1`,
        runId: `R-LOAD-${i + 1}-1-implement-1`,
      })),
    );
    await sleep(10_200);
    assert.equal(reads.core?.requests ?? 0, 0);
    assert.equal(reads.runs?.requests ?? 0, 0);
    assert.equal(reads.activity?.requests ?? 0, 0);
    assert.ok(maxConcurrentRuns <= 2);
    assert.equal(reads.watchedRun?.requests ?? 0, pinCount);
    return {
      size,
      projects: runtime.getSnapshot().projects.length,
      tasks: runtime.getSnapshot().tasks.length,
      pinCount,
      windowMs: 10_200,
      reads,
      maxConcurrentRuns,
      refresh: { ...runtime.metrics },
    };
  } finally {
    runtime.stop();
  }
}
const results = [];
for (const size of ["normal", "stress"])
  for (const pinCount of [0, 4]) results.push(await measure(size, pinCount));
const report = {
  capturedAt: new Date().toISOString(),
  platform: `${os.platform()} ${os.arch()}`,
  cpu: os.cpus()[0]?.model,
  node: process.version,
  method:
    "Same-machine shared coordinator, real-time 10.2-second fixture windows. Counts are gateway reads; bytes are uncompressed serialized responses, excluding HTTP framing. Fixtures make zero network or provider calls. Browser viewport and frame checks are recorded separately.",
  results,
};
const output = process.argv[2];
if (output) await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
