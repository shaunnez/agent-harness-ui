// Research HTTP surface. The minimum needed to submit a run, watch it, cancel it and read the
// result. It follows the existing route-factory shape, so `api.mjs` gains one construction and
// one dispatch line, and it inherits the loopback/CSRF boundary `assertHttpBoundary` applies
// before any factory is reached.

import { createResearchQuestionRoutes } from "./research-question-routes.mjs";

export function createResearchRoutes({ researchService, researchQuestions = null, send, readJson }) {
  const questionRoutes = researchQuestions
    ? createResearchQuestionRoutes({ questions: researchQuestions, send, readJson })
    : () => false;
  return async function handleResearchRoute(request, response, url) {
    if (await questionRoutes(request, response, url)) return true;

    if (request.method === "GET" && url.pathname === "/api/research/runtimes") {
      send(response, 200, { runtimes: researchService.runtimeIds() });
      return true;
    }

    if (url.pathname === "/api/research/runs") {
      if (request.method === "GET") {
        send(response, 200, {
          runs: await researchService.listRuns({ limit: url.searchParams.get("limit") }),
        });
        return true;
      }
      if (request.method === "POST") {
        send(response, 201, { run: await researchService.createRun(await readJson(request)) });
        return true;
      }
    }

    const match = url.pathname.match(/^\/api\/research\/runs\/([^/]+)(?:\/(cancel|events|result|sources))?$/);
    if (!match) return false;
    const runId = decodeURIComponent(match[1]);
    const segment = match[2] ?? null;

    if (request.method === "GET" && !segment) {
      const run = await researchService.getRun(runId);
      send(response, run ? 200 : 404, run ? { run } : { error: "Research run not found." });
      return true;
    }

    if (request.method === "POST" && segment === "cancel") {
      const run = await researchService.cancel(runId);
      send(response, run ? 200 : 404, run ? { run } : { error: "Research run not found." });
      return true;
    }

    if (request.method === "GET" && segment === "events") {
      const page = await researchService.listEvents(runId, {
        afterOrdinal: url.searchParams.get("cursor") ?? 0,
        limit: url.searchParams.get("limit") ?? undefined,
      });
      send(response, page ? 200 : 404, page ?? { error: "Research run not found." });
      return true;
    }

    if (request.method === "GET" && segment === "sources") {
      const run = await researchService.getRun(runId);
      if (!run) {
        send(response, 404, { error: "Research run not found." });
        return true;
      }
      send(response, 200, { sources: await researchService.listSources(runId) });
      return true;
    }

    if (request.method === "GET" && segment === "result") {
      const run = await researchService.getRun(runId);
      if (!run) {
        send(response, 404, { error: "Research run not found." });
        return true;
      }
      const result = await researchService.getResult(runId);
      // A run that is still going has no result to read, and returning an empty one would let
      // a caller mistake "not yet" for "nothing found".
      if (!result) {
        send(response, 409, { error: `Research run ${runId} has no result yet.`, status: run.status });
        return true;
      }
      send(response, 200, { result, status: run.status });
      return true;
    }

    return false;
  };
}
