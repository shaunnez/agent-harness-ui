// Builds the research service from its configuration: the database and its schema, the engine's
// Postgres stores, the one research runtime (the API loop on a US-hosted provider), the shared
// pacer, the question service, the batch queue and its worker, and the HTTP server.
//
// Tests pass a `runtime` and a `scoper` in place of the live ones; nothing else changes.

import {
  API_LOOP_RESEARCH_RUNTIME_ID,
  ApiLoopResearchRuntime,
} from "@eversor/research-engine/api-loop/runtime.mjs";
import { AdaptivePacer } from "@eversor/research-engine/engine/pacer.mjs";
import {
  PgResearchProjectStore,
  PgResearchQuestionStore,
} from "@eversor/research-engine/pg/question-store.mjs";
import { PgResearchStore } from "@eversor/research-engine/pg/research-store.mjs";
import { migrateResearchSchema } from "@eversor/research-engine/pg/schema.mjs";
import { ResearchQuestionService } from "@eversor/research-engine/research-question-service.mjs";
import { createResearchRuntimeRegistry } from "@eversor/research-engine/research-runtime-registry.mjs";
import { ResearchScoper } from "@eversor/research-engine/research-scope.mjs";
import { ResearchService } from "@eversor/research-engine/research-service.mjs";
import { BatchStore, BatchWorker, SERVICE_MIGRATIONS } from "./batches.mjs";
import { US_PROVIDERS } from "./config.mjs";
import { openDatabase } from "./db.mjs";
import { createServiceServer } from "./http.mjs";

export async function createResearchServiceApp({ config, env, runtime = null, scoper, log = () => {} }) {
  const db = await openDatabase(config.databaseUrl);
  try {
    await migrateResearchSchema(db, { extra: [SERVICE_MIGRATIONS] });
    const projects = new PgResearchProjectStore(db);
    await projects.ensure(config.project);
    const pacer = new AdaptivePacer(config.pacing);
    const runs = new PgResearchStore(db, { sourceSnapshotDirectory: config.sourceSnapshotDirectory });
    const engine =
      runtime ??
      new ApiLoopResearchRuntime({
        env: { ...env, RESEARCH_API_LOOP_MODEL: config.model },
        pacer,
        maxConcurrentRuns: config.pacing.max,
        transcriptDirectory: config.transcriptDirectory,
        sourceSnapshotDirectory: config.sourceSnapshotDirectory,
      });
    const research = new ResearchService({
      store: runs,
      registry: createResearchRuntimeRegistry([usOnly(engine)]),
      // The service has no Settings screen: every run is the API loop on the configured model.
      settings: async () => ({
        researchPolicies: {
          agent: {
            runtime: API_LOOP_RESEARCH_RUNTIME_ID,
            provider: "api",
            model: config.model,
            reasoning: "default",
          },
        },
      }),
    });
    const questions = new ResearchQuestionService({
      questions: new PgResearchQuestionStore(db),
      research,
      runs,
      projects: () => projects.list(),
      scoper: scoper === undefined ? new ResearchScoper({ env, model: config.model, pacer }) : scoper,
    });
    await research.recoverInterrupted();
    const batches = new BatchStore(db);
    const requeued = await batches.recover();
    if (requeued) log("batch items requeued after a restart", { items: requeued });
    const worker = new BatchWorker({
      batches,
      questions,
      pacer,
      runsPerQuestion: config.runsPerQuestion,
      projectId: config.project.id,
      intervalMs: config.workerIntervalMs,
      log,
    });
    const server = createServiceServer({ config, batches, questions, research, projects, pacer, db, log });
    pacer.onChange((limit) => log("pacing changed", { limit, ...pacer.snapshot() }));

    return {
      config,
      db,
      pacer,
      research,
      questions,
      batches,
      worker,
      server,
      async listen() {
        await new Promise((resolve, reject) => {
          server.once("error", reject);
          server.listen(config.port, config.host, resolve);
        });
        worker.start();
        return server.address();
      },
      async close() {
        await worker.stop();
        await new Promise((resolve) => server.close(() => resolve()));
        await research.shutdown();
        await db.close();
      },
    };
  } catch (error) {
    await db.close().catch(() => undefined);
    throw error;
  }
}

/**
 * The runtime, refusing any run whose model is not on a US-hosted provider. The configuration
 * already refuses one; this is the same rule where a run starts, so no later path (a console run
 * naming a model, a changed default) can send tender text elsewhere.
 */
export function usOnly(runtime) {
  const guarded = {
    id: runtime.id,
    async start(request) {
      const model = String(request?.researchPolicy?.model ?? "");
      const provider = model.split("/")[0];
      if (request?.researchPolicy?.runtime !== runtime.id || !US_PROVIDERS.includes(provider))
        throw new Error(
          `The research service runs only on ${US_PROVIDERS.join(" or ")}; this run asked for ${model || "no model"}.`,
        );
      return runtime.start(request);
    },
    status: (runId) => runtime.status(runId),
    cancel: (runId) => runtime.cancel(runId),
    events: (runId) => runtime.events(runId),
    result: (runId) => runtime.result(runId),
  };
  if (typeof runtime.outcome === "function") guarded.outcome = (runId) => runtime.outcome(runId);
  return guarded;
}
