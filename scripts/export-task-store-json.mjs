import path from "node:path";
import process from "node:process";
import { stat } from "node:fs/promises";
import { SqliteTaskStore } from "../server/sqlite-store.mjs";

const databasePath = path.resolve(
  process.argv[2] ?? process.env.AGENT_HARNESS_DATABASE ?? ".data/tasks.sqlite3",
);
const outputPath = path.resolve(
  process.argv[3] ?? `.data/tasks-export-${new Date().toISOString().replaceAll(":", "-")}.json`,
);
const databaseStat = await stat(databasePath).catch(() => null);
if (!databaseStat?.isFile()) {
  throw new Error(`SQLite task store not found: ${databasePath}`);
}
if (outputPath === databasePath) {
  throw new Error("JSON export path must not overwrite the SQLite task store.");
}
const store = new SqliteTaskStore(databasePath);
try {
  await store.init();
  const result = await store.exportJson(outputPath);
  console.log(JSON.stringify(result, null, 2));
} finally {
  store.close();
}
