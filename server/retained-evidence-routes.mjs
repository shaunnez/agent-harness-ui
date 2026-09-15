import { buildEvaluationSummary } from "./evaluation.mjs";
import {
  findTaskArtifact,
  paginateTaskArtifacts,
  paginateTaskEvents,
  paginateTaskRuns,
  projectTaskCore,
  projectDesignRequest,
  projectTaskPollState,
  projectTaskSummary,
} from "./task-projections.mjs";

export function createRetainedEvidenceRoutes({ store, send, withActionEligibility }) {
  return async function handleRetainedEvidenceRoute(request, response, url) {
    if (request.method === "GET" && url.pathname === "/api/workspace/history") {
      if (typeof store.workspaceHead !== "function" || typeof store.workspaceHistory !== "function") {
        send(response, 200, {
          available: false,
          sourceId: null,
          upper: 0,
          floor: 0,
          coverageStartAt: null,
          capturedAt: new Date().toISOString(),
          reason: "Workspace catch-up and remembered pins are unavailable for this legacy store.",
        });
      } else
        send(
          response,
          200,
          url.searchParams.get("view") === "head"
            ? await store.workspaceHead()
            : await store.workspaceHistory(url.searchParams),
        );
      return true;
    }
    const watchedRunMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/runs\/([^/]+)$/);
    if (request.method === "GET" && watchedRunMatch) {
      if (typeof store.watchedRun !== "function") {
        send(response, 501, { error: "Exact run summaries are unavailable for this legacy store." });
      } else {
        const source = url.searchParams.get("sourceId");
        if (source && source !== (await store.workspaceHead()).sourceId) {
          send(response, 409, { error: "Workspace source changed. Refresh before watching this run." });
        } else if (url.searchParams.get("view") === "full") {
          send(response, 200, {
            run: await store.getRun(
              decodeURIComponent(watchedRunMatch[1]),
              decodeURIComponent(watchedRunMatch[2]),
            ),
          });
        } else
          send(
            response,
            200,
            await store.watchedRun(
              decodeURIComponent(watchedRunMatch[1]),
              decodeURIComponent(watchedRunMatch[2]),
            ),
          );
      }
      return true;
    }
    if (request.method === "GET" && url.pathname === "/api/tasks") {
      if (url.searchParams.get("view") === "poll") {
        const tasks =
          typeof store.listPollStates === "function"
            ? await store.listPollStates()
            : (await store.list()).map(projectTaskPollState);
        send(response, 200, { tasks });
        return true;
      }
      const full = url.searchParams.get("view") === "full";
      let tasks =
        full || typeof store.listSummaries !== "function" ? await store.list() : await store.listSummaries();
      if (full) {
        tasks = tasks.map((task) => ({ ...task, designRequest: projectDesignRequest(task.designRequest) }));
      }
      send(response, 200, {
        tasks: full || typeof store.listSummaries === "function" ? tasks : tasks.map(projectTaskSummary),
      });
      return true;
    }
    if (request.method === "GET" && url.pathname === "/api/evaluations/summary") {
      const tasks =
        typeof store.listEvaluationTasks === "function"
          ? await store.listEvaluationTasks()
          : await store.list();
      send(response, 200, buildEvaluationSummary(tasks));
      return true;
    }
    const taskActivityMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/activity$/);
    if (request.method === "GET" && taskActivityMatch) {
      const id = decodeURIComponent(taskActivityMatch[1]);
      const page =
        typeof store.pageEvents === "function" ? await store.pageEvents(id, url.searchParams) : null;
      const task = page ? null : await store.get(id);
      send(
        response,
        page || task ? 200 : 404,
        page ?? (task ? paginateTaskEvents(task, url.searchParams) : { error: "Task not found." }),
      );
      return true;
    }

    const taskRunsMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/runs$/);
    if (request.method === "GET" && taskRunsMatch) {
      const id = decodeURIComponent(taskRunsMatch[1]);
      const page = typeof store.pageRuns === "function" ? await store.pageRuns(id, url.searchParams) : null;
      const task = page ? null : await store.get(id);
      send(
        response,
        page || task ? 200 : 404,
        page ?? (task ? paginateTaskRuns(task, url.searchParams) : { error: "Task not found." }),
      );
      return true;
    }

    const taskArtifactMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/artifacts\/([^/]+)$/);
    if (request.method === "GET" && taskArtifactMatch) {
      const taskId = decodeURIComponent(taskArtifactMatch[1]);
      const artifactId = decodeURIComponent(taskArtifactMatch[2]);
      const artifact =
        typeof store.getArtifact === "function"
          ? await store.getArtifact(taskId, artifactId)
          : findTaskArtifact(await store.get(taskId), artifactId);
      send(
        response,
        artifact ? 200 : 404,
        artifact ? { artifact } : { error: "Task or artifact not found." },
      );
      return true;
    }

    const taskArtifactsMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/artifacts$/);
    if (request.method === "GET" && taskArtifactsMatch) {
      const id = decodeURIComponent(taskArtifactsMatch[1]);
      const page =
        typeof store.pageArtifacts === "function" ? await store.pageArtifacts(id, url.searchParams) : null;
      const task = page ? null : await store.get(id);
      send(
        response,
        page || task ? 200 : 404,
        page ?? (task ? paginateTaskArtifacts(task, url.searchParams) : { error: "Task not found." }),
      );
      return true;
    }

    const taskMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)$/);
    if (request.method === "GET" && taskMatch) {
      const id = decodeURIComponent(taskMatch[1]);
      if (url.searchParams.get("view") === "poll") {
        const persistedPollState =
          typeof store.getPollState === "function" ? await store.getPollState(id) : await store.get(id);
        const pollState =
          persistedPollState && "pollVersion" in persistedPollState
            ? persistedPollState
            : persistedPollState
              ? projectTaskPollState(persistedPollState)
              : null;
        send(response, pollState ? 200 : 404, pollState ? { task: pollState } : { error: "Task not found." });
        return true;
      }
      const core = url.searchParams.get("view") === "core";
      // Action admission must be derived from the authoritative retained task. The
      // bounded SQLite core projection intentionally omits normalized runs and
      // artifacts, but retry admission validates those identities and must fail
      // closed when they are inconsistent. Computing eligibility after getCore()
      // therefore turns valid exhausted candidate gates into false denials.
      const persistedTask = await store.get(id);
      const task = persistedTask ? withActionEligibility(persistedTask) : null;
      let responseTask = task ? { ...task, designRequest: projectDesignRequest(task.designRequest) } : null;
      if (task && core) {
        const pollState = typeof store.getPollState === "function" ? await store.getPollState(id) : null;
        responseTask = {
          ...projectTaskCore(task),
          ...(pollState ? { pollVersion: pollState.pollVersion } : {}),
        };
      }
      send(
        response,
        responseTask ? 200 : 404,
        responseTask ? { task: responseTask } : { error: "Task not found." },
      );
      return true;
    }

    return false;
  };
}
