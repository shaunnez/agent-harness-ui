// Resolve a research runtime by identifier. Deliberately the smallest thing that works: a
// lookup and a shape check. Registering a runtime is the whole of the wiring change.

const REQUIRED_METHODS = ["start", "status", "cancel", "events", "result"];

export const DEFAULT_RESEARCH_RUNTIME_ID = "fake";

export function createResearchRuntimeRegistry(runtimes = []) {
  const byId = new Map();
  for (const runtime of runtimes) {
    assertResearchRuntime(runtime);
    if (byId.has(runtime.id)) throw new Error(`Research runtime ${runtime.id} is registered twice.`);
    byId.set(runtime.id, runtime);
  }
  return {
    ids() {
      return [...byId.keys()];
    },
    has(id) {
      return byId.has(id);
    },
    resolve(id) {
      const runtime = byId.get(id);
      if (!runtime) {
        const error = new Error(
          `Unknown research runtime "${id}". Available: ${[...byId.keys()].join(", ") || "none"}.`,
        );
        error.statusCode = 400;
        throw error;
      }
      return runtime;
    },
  };
}

export function assertResearchRuntime(runtime) {
  if (!runtime || typeof runtime.id !== "string" || !runtime.id)
    throw new Error("A research runtime must expose a non-empty string id.");
  for (const method of REQUIRED_METHODS) {
    if (typeof runtime[method] !== "function")
      throw new Error(`Research runtime ${runtime.id} is missing ${method}().`);
  }
  // Guard against the method arriving before the evidence for it does. `resume()` is added
  // when a runtime demonstrates mid-node continuation rather than a re-run (risk R6); until
  // then a runtime offering it would teach the store and the UI to expect something no other
  // runtime can honour.
  if ("resume" in runtime)
    throw new Error(
      `Research runtime ${runtime.id} exposes resume(), which is not part of the contract yet.`,
    );
  return runtime;
}
