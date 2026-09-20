import assert from "node:assert/strict";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { createResearchRuntimeRegistry } from "../server/research/research-runtime-registry.mjs";
import { ResearchService } from "../server/research/research-service.mjs";
import { ResearchStore } from "../server/research/research-store.mjs";
import { migrateSqliteSchema } from "../server/sqlite-storage.mjs";
import { withDeepAgentsRuntime } from "./research-deepagents-test-support.mjs";

test("one agent completes the retained-source evidence loop through the durable research service", async () => {
  await withDeepAgentsRuntime(async ({ runtime, directory }) => {
    const db = new DatabaseSync(path.join(directory, "tasks.sqlite3"));
    db.exec("PRAGMA foreign_keys = ON");
    migrateSqliteSchema(db);
    const store = new ResearchStore(db, {
      sourceSnapshotDirectory: path.join(directory, "sources"),
    });
    const service = new ResearchService({
      store,
      registry: createResearchRuntimeRegistry([runtime]),
    });
    try {
      const created = await service.createRun({
        objective: "Find the fixture manufacturer's application requirement.",
        profile: "quick",
        runtimeId: "deepagents",
      });
      await service.settled(created.id);

      const run = await service.getRun(created.id);
      assert.equal(run.status, "completed");
      assert.equal(run.usage.searchCalls, 1);
      assert.equal(run.usage.toolCalls, 3);

      const sources = await service.listSources(created.id);
      assert.equal(sources.length, 1);
      assert.match(sources[0].contentSha256, /^[a-f0-9]{64}$/);
      assert.equal(sources[0].contentBytes > 0, true);

      const result = await service.getResult(created.id);
      assert.equal(result.findings.length, 1);
      assert.equal(result.findings[0].evidence.length, 1);
      assert.equal(result.findings[0].evidence[0].quoteVerified, true);
      assert.match(result.findings[0].evidence[0].snapshotRef, /^sha256:[a-f0-9]{64}$/);

      const events = await service.listEvents(created.id, { limit: 100 });
      assert.ok(events.events.some((event) => event.type === "source.retrieved"));
      assert.ok(events.events.some((event) => event.type === "finding.created"));
      assert.ok(events.events.some((event) => event.type === "run.completed"));
    } finally {
      await service.shutdown();
      db.close();
    }
  });
});
