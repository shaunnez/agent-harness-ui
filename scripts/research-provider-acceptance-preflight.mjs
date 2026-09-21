export async function preflightResearchAcceptanceRuntime({
  loadDatabase = () => import("better-sqlite3"),
} = {}) {
  let database = null;
  try {
    const loaded = await loadDatabase();
    const Database = loaded.default ?? loaded;
    database = new Database(":memory:");
    database.prepare("SELECT 1 AS ready").get();
  } catch (error) {
    const detail = boundedLocalMessage(error);
    const failure = new Error(
      `Live provider acceptance runtime preflight failed before network dispatch: ${detail}`,
    );
    failure.code = "acceptance_runtime_preflight_failed";
    failure.cause = error;
    throw failure;
  } finally {
    database?.close();
  }
}

function boundedLocalMessage(error) {
  return String(error?.message ?? error ?? "native database dependency did not load")
    .slice(0, 500)
    .replace(/[\r\n]+/g, " ");
}
