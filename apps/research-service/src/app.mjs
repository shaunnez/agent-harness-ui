// Builds the research service from its configuration: the database and its schema, the engine's
// Postgres stores, the one research runtime (the API loop on an approved provider), the shared
// pacer, the question service, the batch queue and its worker, and the HTTP server.
//
// Tests pass a `runtime` and a `scoper` in place of the live ones; nothing else changes.

import { resolveApiModel } from "@eversor/research-engine/api-loop/providers.mjs";
import {
  API_LOOP_RESEARCH_RUNTIME_ID,
  ApiLoopResearchRuntime,
} from "@eversor/research-engine/api-loop/runtime.mjs";
import { AdaptivePacer } from "@eversor/research-engine/engine/pacer.mjs";
import { PacerSync } from "@eversor/research-engine/engine/pacer-sync.mjs";
import { ToolCache } from "@eversor/research-engine/engine/tool-cache.mjs";
import { PgPacerStore } from "@eversor/research-engine/pg/pacer-store.mjs";
import {
  PgResearchProjectStore,
  PgResearchQuestionStore,
} from "@eversor/research-engine/pg/question-store.mjs";
import { PgResearchStore } from "@eversor/research-engine/pg/research-store.mjs";
import { migrateResearchSchema } from "@eversor/research-engine/pg/schema.mjs";
import { PgToolCacheStore } from "@eversor/research-engine/pg/tool-cache-store.mjs";
import { ResearchQuestionService } from "@eversor/research-engine/research-question-service.mjs";
import { createResearchRuntimeRegistry } from "@eversor/research-engine/research-runtime-registry.mjs";
import { ResearchScoper } from "@eversor/research-engine/research-scope.mjs";
import { ResearchService } from "@eversor/research-engine/research-service.mjs";
import { BatchStore, BatchWorker, SERVICE_MIGRATIONS } from "./batches.mjs";
import { APPROVED_PROVIDERS } from "./config.mjs";
import { openDatabase } from "./db.mjs";
import { createServiceServer } from "./http.mjs";
import { ModelRouter } from "./model-router.mjs";
import { ModelSettings } from "./model-settings.mjs";

export async function createResearchServiceApp({ config, env, runtime = null, scoper, log = () => {} }) {
  const db = await openDatabase(config.databaseUrl);
  try {
    await migrateResearchSchema(db, { extra: [SERVICE_MIGRATIONS] });
    const projects = new PgResearchProjectStore(db);
    await projects.ensure(config.project);
    const modelSettings = new ModelSettings(db, config.model);
    const pacers = new Map(
      APPROVED_PROVIDERS.map((provider) => [provider, new AdaptivePacer(config.pacing)]),
    );
    // Each provider has its own account limit, shared among workers through Postgres.
    const pacerSyncs = new Map(
      [...pacers].map(([provider, pacer]) => [
        provider,
        new PacerSync({ pacer, store: new PgPacerStore(db, { key: provider }) }),
      ]),
    );
    const pacerFor = (model) => pacers.get(resolveApiModel(model).providerId);
    const pacer = pacers.get(config.provider);
    const runs = new PgResearchStore(db, { sourceSnapshotDirectory: config.sourceSnapshotDirectory });
    // Every worker shares one set of searches, pages and QV reads, and a restart keeps them.
    const toolCache = new ToolCache({
      store: new PgToolCacheStore(db, { keepMs: config.toolCacheTtlMs }),
      ttlMs: config.toolCacheTtlMs,
    });
    const engine =
      runtime ??
      new ModelRouter(
        new Map(
          [...pacers].map(([provider, providerPacer]) => [
            provider,
            new ApiLoopResearchRuntime({
              env: { ...env, RESEARCH_API_LOOP_MODEL: config.model },
              pacer: providerPacer,
              toolCache,
              maxConcurrentRuns: config.pacing.max,
              transcriptDirectory: config.transcriptDirectory,
              sourceSnapshotDirectory: config.sourceSnapshotDirectory,
            }),
          ]),
        ),
      );
    const research = new ResearchService({
      store: runs,
      registry: createResearchRuntimeRegistry([approvedOnly(engine)]),
      // Read the shared choice for each new question; a recorded run keeps its own snapshot.
      settings: async () => ({
        researchPolicies: {
          agent: {
            runtime: API_LOOP_RESEARCH_RUNTIME_ID,
            provider: "api",
            model: await modelSettings.selected(),
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
      scoper:
        scoper === undefined
          ? {
              scope: async ({ model, ...input }) => {
                const selected = model ?? (await modelSettings.selected());
                return new ResearchScoper({ env, model: selected, pacer: pacerFor(selected) }).scope(input);
              },
            }
          : scoper,
      // PlanCheck sends the same tender lines again; an identical line answered recently is
      // answered by that question rather than five more runs.
      reuseAnswersForMs: config.reuseAnswersForMs,
    });
    await research.recoverInterrupted();
    await questions.resumeStaged();
    const batches = new BatchStore(db);
    const requeued = await batches.recover();
    if (requeued) log("batch items requeued after a restart", { items: requeued });
    const workerPacer = {
      get limit() {
        return Math.min(...[...pacers.values()].map((entry) => entry.limit));
      },
    };
    const worker = new BatchWorker({
      batches,
      questions,
      pacer: workerPacer,
      runsPerQuestion: config.runsPerQuestion,
      projectId: config.project.id,
      intervalMs: config.workerIntervalMs,
      log,
    });
    const pacing = {
      snapshot: async () => {
        const provider = resolveApiModel(await modelSettings.selected()).providerId;
        return { ...pacers.get(provider).snapshot(), shared: pacerSyncs.get(provider).snapshot() };
      },
    };
    const server = createServiceServer({
      config,
      batches,
      questions,
      research,
      projects,
      pacer: pacing,
      modelSettings,
      env,
      db,
      log,
    });
    for (const [provider, providerPacer] of pacers)
      providerPacer.onChange((limit) =>
        log("pacing changed", { provider, limit, ...providerPacer.snapshot() }),
      );

    return {
      config,
      db,
      pacer,
      pacerSync: pacerSyncs.get(config.provider),
      pacing,
      modelSettings,
      toolCache,
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
        for (const sync of pacerSyncs.values()) {
          await sync.sync();
          sync.start();
        }
        worker.start();
        return server.address();
      },
      async close() {
        await worker.stop();
        for (const sync of pacerSyncs.values()) await sync.stop();
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
 * The runtime, refusing any run whose model is not on an approved provider. The configuration
 * already refuses one; this is the same rule where a run starts, so no later path (a console run
 * naming a model, a changed default) can send tender text elsewhere.
 */
export function approvedOnly(runtime) {
  const guarded = {
    id: runtime.id,
    async start(request) {
      const model = String(request?.researchPolicy?.model ?? "");
      const provider = model.split("/")[0];
      if (request?.researchPolicy?.runtime !== runtime.id || !APPROVED_PROVIDERS.includes(provider))
        throw new Error(
          `The research service runs only on ${APPROVED_PROVIDERS.join(" or ")}; this run asked for ${model || "no model"}.`,
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
