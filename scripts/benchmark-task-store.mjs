import { cp, mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { JsonTaskStore } from "../server/store.mjs";
import { SqliteTaskStore } from "../server/sqlite-store.mjs";
import { projectTaskCore, projectTaskSummary } from "../server/task-projections.mjs";

const requestedPath = process.argv[2] ?? process.env.AGENT_HARNESS_DATA ?? path.resolve(".data/tasks.json");
const sourcePath = path.resolve(requestedPath);
const sourceStat = await stat(sourcePath).catch(() => null);
if (!sourceStat?.isFile()) {
  console.error(`Task store not found: ${sourcePath}`);
  process.exitCode = 1;
} else {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-store-benchmark-"));
  const copyPath = path.join(directory, "tasks.json");
  try {
    await cp(sourcePath, copyPath);
    const jsonStore = new JsonTaskStore(copyPath);
    const jsonInitMs = await measure(() => jsonStore.init());
    const tasks = await jsonStore.list();
    const firstTaskId = tasks[0]?.id;
    const jsonListMs = await measureMany(100, () => jsonStore.list());
    const jsonGetMs = firstTaskId
      ? await measureMany(100, () => jsonStore.get(firstTaskId))
      : null;
    const jsonUpdateMs = firstTaskId
      ? await measure(() => jsonStore.update(firstTaskId, () => {}))
      : null;
    const sqliteStore = new SqliteTaskStore(path.join(directory, "tasks.sqlite3"), { legacyJsonPath: copyPath });
    const sqliteInitMs = await measure(() => sqliteStore.init());
    const sqliteListMs = await measureMany(100, () => sqliteStore.listSummaries());
    const sqliteGetMs = firstTaskId
      ? await measureMany(100, () => sqliteStore.getCore(firstTaskId))
      : null;
    const sqliteUpdateMs = firstTaskId
      ? await measure(() => sqliteStore.update(firstTaskId, () => {}))
      : null;
    const fullPayload = JSON.stringify({ tasks });
    const summaryPayload = JSON.stringify({ tasks: tasks.map(projectTaskSummary) });
    const largestTask = tasks
      .map((task) => ({ id: task.id, bytes: Buffer.byteLength(JSON.stringify(task)) }))
      .sort((left, right) => right.bytes - left.bytes)[0] ?? null;
    console.log(JSON.stringify({
      source: sourcePath,
      storeBytes: (await stat(sourcePath)).size,
      taskCount: tasks.length,
      largestTask,
      timingsMs: {
        json: {
          init: round(jsonInitMs),
          fullListAverage: round(jsonListMs),
          fullGetAverage: jsonGetMs == null ? null : round(jsonGetMs),
          noOpUpdate: jsonUpdateMs == null ? null : round(jsonUpdateMs),
        },
        sqlite: {
          firstImportAndInit: round(sqliteInitMs),
          summaryListAverage: round(sqliteListMs),
          coreGetAverage: sqliteGetMs == null ? null : round(sqliteGetMs),
          noOpUpdate: sqliteUpdateMs == null ? null : round(sqliteUpdateMs),
        },
        improvementPercent: {
          list: round(100 * (1 - sqliteListMs / jsonListMs)),
          get: jsonGetMs && sqliteGetMs != null ? round(100 * (1 - sqliteGetMs / jsonGetMs)) : null,
          update: jsonUpdateMs && sqliteUpdateMs != null ? round(100 * (1 - sqliteUpdateMs / jsonUpdateMs)) : null,
        },
      },
      payloadBytes: {
        fullList: Buffer.byteLength(fullPayload),
        summaryList: Buffer.byteLength(summaryPayload),
        reductionPercent: round(100 * (1 - Buffer.byteLength(summaryPayload) / Buffer.byteLength(fullPayload))),
        firstCore: tasks[0] ? Buffer.byteLength(JSON.stringify({ task: projectTaskCore(tasks[0]) })) : 0,
      },
    }, null, 2));
    sqliteStore.close();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function measure(operation) {
  const startedAt = performance.now();
  await operation();
  return performance.now() - startedAt;
}

async function measureMany(iterations, operation) {
  const startedAt = performance.now();
  for (let index = 0; index < iterations; index += 1) await operation();
  return (performance.now() - startedAt) / iterations;
}

function round(value) {
  return Math.round(value * 100) / 100;
}
