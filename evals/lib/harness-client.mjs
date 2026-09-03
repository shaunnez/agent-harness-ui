// Thin HTTP client the eval runner (WP3, docs/model-evaluation-plan.md section 5) uses to drive
// the local companion exactly the way the operator UI does: the same endpoints, the same CSRF
// header convention, and the same "no request body unless there is something to say" shape as
// `src/api.ts`'s `runTask`/`runTaskAction`. Kept dependency-free (only the platform `fetch`) so it
// runs from a plain Node script with no build step.

const JSON_CONTENT_TYPE = "application/json";

/**
 * @param {{ baseUrl: string, fetchImpl?: typeof fetch }} options
 */
export function createHarnessClient({ baseUrl, fetchImpl = fetch } = {}) {
  if (!baseUrl) throw new Error("createHarnessClient requires a baseUrl.");
  let csrfToken = null;

  async function send(method, requestPath, { body } = {}) {
    const headers = { "content-type": JSON_CONTENT_TYPE };
    if (method !== "GET" && csrfToken) headers["x-agent-harness-csrf"] = csrfToken;
    const response = await fetchImpl(new URL(requestPath, baseUrl), {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    let payload = {};
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        throw new Error(`${method} ${requestPath} returned a non-JSON response (${response.status}).`);
      }
    }
    if (!response.ok) {
      const error = new Error(payload.error ?? `${method} ${requestPath} failed with ${response.status}.`);
      error.statusCode = response.status;
      error.responseBody = payload;
      throw error;
    }
    return payload;
  }

  return {
    /** Reads the runtime status and caches the CSRF token every mutation below needs. */
    async connect() {
      const status = await send("GET", "/api/runtime/status");
      csrfToken = status.csrfToken ?? null;
      return status;
    },
    async settings() {
      const { settings } = await send("GET", "/api/settings");
      return settings;
    },
    /** GET /api/evaluations/summary (WP5, docs/model-evaluation-plan.md section 5): the live,
     * authoritative summary of controlled-experiment variants the report reads for blind scores
     * posted after this campaign ran (see `server/evaluation.mjs`'s `buildEvaluationSummary`). */
    async evaluationSummary() {
      return send("GET", "/api/evaluations/summary");
    },
    async createTask(payload) {
      const { task } = await send("POST", "/api/tasks", { body: payload });
      return task;
    },
    async getTask(id) {
      const { task } = await send("GET", `/api/tasks/${encodeURIComponent(id)}`);
      return task;
    },
    /**
     * Generic `POST /api/tasks/:id/:action`. `body` is omitted entirely (no request body at
     * all, matching `runTask` in `src/api.ts`) for actions that carry no note, such as `run`,
     * `implement`, `review`, `test`, `final-review`, and `repair`.
     */
    async runAction(id, action, body) {
      return send("POST", `/api/tasks/${encodeURIComponent(id)}/${action}`, { body });
    },
    async approveSpecification(id, note) {
      return this.runAction(id, "approve-spec", { note });
    },
    async approvePlan(id, note) {
      return this.runAction(id, "approve-plan", { note });
    },
    async finishGrill(id, { acceptRemaining }) {
      return this.runAction(id, "grill/finish", { acceptRemaining, interactionSource: "operator-ui" });
    },
    async cancel(id) {
      return this.runAction(id, "cancel");
    },
    /**
     * `POST /api/tasks/:id/evaluation` (WP4, docs/model-evaluation-plan.md section 5's blind
     * judge): posts a `kind: "blind"` or `kind: "human"` score. `body` mirrors what
     * `normalizeEvaluationInput` (`server/evaluation.mjs`) accepts.
     */
    async postEvaluation(id, body) {
      const { task } = await send("POST", `/api/tasks/${encodeURIComponent(id)}/evaluation`, { body });
      return task;
    },
  };
}
