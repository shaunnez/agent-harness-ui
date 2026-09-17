import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { FakeResearchRuntime } from "../server/research/fake-research-runtime.mjs";
import { createResearchRuntimeRegistry } from "../server/research/research-runtime-registry.mjs";
import { ResearchService } from "../server/research/research-service.mjs";
import { ResearchStore } from "../server/research/research-store.mjs";
import { migrateSqliteSchema } from "../server/sqlite-storage.mjs";

/** A research store on a throwaway database carrying the real migrated schema. */
export async function withResearchStore(body) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-research-"));
  const db = new DatabaseSync(path.join(directory, "tasks.sqlite3"));
  db.exec("PRAGMA foreign_keys = ON");
  migrateSqliteSchema(db);
  try {
    return await body({ store: new ResearchStore(db), db, directory });
  } finally {
    db.close();
    await rm(directory, { recursive: true, force: true });
  }
}

/** A service wired to a manually advanced fake runtime, so every test controls the clock. */
export async function withResearchService(body, { runtimeOptions } = {}) {
  return withResearchStore(async ({ store, db, directory }) => {
    const runtime = new FakeResearchRuntime({ autoAdvance: false, ...runtimeOptions });
    const service = new ResearchService({ store, registry: createResearchRuntimeRegistry([runtime]) });
    return body({ service, runtime, store, db, directory });
  });
}

/** Let queued microtasks and I/O callbacks run without depending on wall-clock timing. */
export async function settle(times = 4) {
  for (let index = 0; index < times; index += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

export async function waitFor(predicate, message, attempts = 500) {
  for (let index = 0; index < attempts; index += 1) {
    const value = await predicate();
    if (value) return value;
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error(`Timed out waiting for ${message}.`);
}

/** Run to completion the way a test wants it: step, let the consumer catch up, repeat. */
export async function runToEnd(service, runtime, runId) {
  while (runtime.advance(runId)) await settle(1);
  await service.settled(runId);
}
