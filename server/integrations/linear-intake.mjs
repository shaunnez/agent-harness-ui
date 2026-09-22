import { readFile } from "node:fs/promises";

export async function readLinearConfig(filePath) {
  if (!filePath) return null;
  const config = JSON.parse(await readFile(filePath, "utf8"));
  for (const key of ["organizationId", "appUserId", "clientId", "harnessUrl"]) {
    if (typeof config[key] !== "string" || !config[key].trim())
      throw new Error(`Linear configuration requires ${key}.`);
  }
  const url = new URL(config.harnessUrl);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error(
      "Linear harnessUrl must be an HTTP(S) application URL without credentials, query or fragment.",
    );
  }
  if (
    !config.projectMappings ||
    typeof config.projectMappings !== "object" ||
    Array.isArray(config.projectMappings) ||
    Object.entries(config.projectMappings).some(([key, value]) => !key || typeof value !== "string" || !value)
  ) {
    throw new Error(
      "Linear projectMappings must map Linear project UUIDs to registered Harness project IDs.",
    );
  }
  return config;
}

export class LinearIntake {
  #db;
  #store;
  #client;
  #config;
  #createTask;
  #running = null;
  #timer = null;
  #stopped = false;
  constructor({ store, client, config }) {
    if (!store.databaseHandle) throw new Error("Linear intake requires the SQLite task store.");
    this.#store = store;
    this.#db = store.databaseHandle();
    this.#client = client;
    this.#config = config;
    this.#db.exec(`CREATE TABLE IF NOT EXISTS linear_intake (
      session_id TEXT PRIMARY KEY, issue_id TEXT NOT NULL, payload_json TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued', task_id TEXT, attempts INTEGER NOT NULL DEFAULT 0,
      next_attempt_at INTEGER NOT NULL DEFAULT 0, last_error TEXT,
      received_at TEXT NOT NULL, completed_at TEXT
    )`);
  }
  setTaskCreator(createTask) {
    this.#createTask = createTask;
  }
  accept(payload) {
    if (
      payload.organizationId !== this.#config.organizationId ||
      payload.appUserId !== this.#config.appUserId ||
      payload.oauthClientId !== this.#config.clientId
    ) {
      throw Object.assign(new Error("Linear workspace or app identity does not match configuration."), {
        statusCode: 403,
      });
    }
    if (payload.type !== "AgentSessionEvent" || payload.action !== "created") {
      return { accepted: false, reason: "Only new issue agent sessions create tasks." };
    }
    const session = payload.agentSession;
    if (!session || typeof session.id !== "string" || !session.id || session.id.length > 200) {
      throw Object.assign(new Error("Linear agent session ID is required."), { statusCode: 400 });
    }
    const issueId = session.issue?.id ?? session.issueId;
    if (typeof issueId !== "string" || !issueId)
      return { accepted: false, reason: "Mention Harness on an issue to create a task." };
    if (session.organizationId !== payload.organizationId || session.appUserId !== payload.appUserId) {
      throw Object.assign(new Error("Linear session identity does not match its event."), {
        statusCode: 403,
      });
    }
    const existing = this.#db
      .prepare("SELECT session_id FROM linear_intake WHERE session_id = ?")
      .get(session.id);
    if (existing) return { accepted: true, duplicate: true };
    const outstanding = this.#db
      .prepare("SELECT count(*) AS count FROM linear_intake WHERE status != 'completed'")
      .get().count;
    if (outstanding >= 1000)
      throw Object.assign(new Error("Linear intake queue is full."), { statusCode: 503 });
    this.#db
      .prepare(`INSERT INTO linear_intake (session_id, issue_id, payload_json, received_at)
      VALUES (?, ?, ?, ?)`)
      .run(session.id, issueId, JSON.stringify(payload), new Date().toISOString());
    return { accepted: true, duplicate: false };
  }
  status() {
    return {
      enabled: true,
      mode: "create-for-review",
      organizationId: this.#config.organizationId,
      projectMappings: this.#config.projectMappings,
      counts: this.#db.prepare("SELECT status, count(*) AS count FROM linear_intake GROUP BY status").all(),
      recent: this.#db
        .prepare(`SELECT session_id AS sessionId, issue_id AS issueId, status,
        task_id AS taskId, attempts, last_error AS error, received_at AS receivedAt
        FROM linear_intake ORDER BY received_at DESC LIMIT 50`)
        .all(),
    };
  }
  retry(sessionId) {
    if (typeof sessionId !== "string") throw new Error("Provide a Linear sessionId.");
    const result = this.#db
      .prepare(`UPDATE linear_intake SET status = 'queued', attempts = 0,
      next_attempt_at = 0, last_error = NULL WHERE session_id = ? AND status = 'blocked'`)
      .run(sessionId);
    if (!result.changes) throw new Error("No blocked Linear intake receipt found.");
    this.kick();
  }
  start() {
    if (this.#timer) return;
    this.#timer = setInterval(() => this.kick(), 2_000);
    this.#timer.unref();
    this.kick();
  }
  kick() {
    if (this.#running || this.#stopped || !this.#createTask) return;
    // Catch infrastructure failures here as well: no unhandled rejection from a timer.
    this.#running = this.#drain()
      .catch(() => {
        console.error(
          "Linear intake could not process its durable queue; inspect the local integration status.",
        );
      })
      .finally(() => {
        this.#running = null;
      });
  }
  async stop() {
    this.#stopped = true;
    clearInterval(this.#timer);
    this.#timer = null;
    await this.#running;
  }
  // Also useful for deterministic offline qualification; no external execution is dispatched.
  async drain() {
    this.kick();
    await this.#running;
  }
  async #drain() {
    while (!this.#stopped) {
      const row = this.#db
        .prepare(`SELECT * FROM linear_intake WHERE status = 'queued'
        AND next_attempt_at <= ? ORDER BY received_at, session_id LIMIT 1`)
        .get(Date.now());
      if (!row) return;
      const attempts = row.attempts + 1;
      try {
        this.accept(JSON.parse(row.payload_json));
        const identity = await this.#client.identity();
        if (
          identity.organizationId !== this.#config.organizationId ||
          identity.appUserId !== this.#config.appUserId
        ) {
          throw new Error("Linear credentials belong to a different workspace or app.");
        }
        // Link promptly so Linear shows a responsive intake even before task creation completes.
        await this.#client.linkSession(row.session_id, `${this.#config.harnessUrl.replace(/\/$/, "")}#tasks`);
        let task = row.task_id
          ? await this.#store.get(row.task_id)
          : await this.#store.findExternalTask("linear", this.#config.organizationId, row.issue_id);
        if (!task) {
          const issue = await this.#client.issue(row.issue_id);
          if (issue.id !== row.issue_id) throw new Error("Linear returned a different issue identity.");
          const projectId = this.#config.projectMappings[issue.project?.id];
          const project = (await this.#store.listProjects()).find((item) => item.id === projectId);
          if (!project || project.archivedAt)
            throw new Error(
              "Map this Linear project UUID to an active registered Harness project, then retry intake.",
            );
          const input = linearTaskInput(issue, JSON.parse(row.payload_json), project);
          task = await this.#createTask(input, { externalSource: input.externalSource });
        }
        this.#db
          .prepare("UPDATE linear_intake SET task_id = ? WHERE session_id = ?")
          .run(task.id, row.session_id);
        await this.#client.linkSession(
          row.session_id,
          `${this.#config.harnessUrl.replace(/\/$/, "")}#task/${encodeURIComponent(task.id)}`,
        );
        await this.#client.completeSession(row.session_id, task.id);
        this.#db
          .prepare(`UPDATE linear_intake SET status = 'completed', attempts = ?,
          last_error = NULL, completed_at = ? WHERE session_id = ?`)
          .run(attempts, new Date().toISOString(), row.session_id);
      } catch (error) {
        this.#db
          .prepare(`UPDATE linear_intake SET status = ?, attempts = ?, next_attempt_at = ?,
          last_error = ? WHERE session_id = ?`)
          .run(
            attempts >= 5 ? "blocked" : "queued",
            attempts,
            Date.now() + Math.min(300_000, 5_000 * 2 ** attempts),
            String(error.message).slice(0, 1000),
            row.session_id,
          );
      }
    }
  }
}

export function linearTaskInput(issue, event, project) {
  if (typeof issue.title !== "string" || !issue.title.trim() || typeof issue.identifier !== "string") {
    throw new Error("Linear issue is missing its title or identifier.");
  }
  const metadata = [
    `Linear issue: ${issue.identifier} — ${issue.url}`,
    `Linear project: ${issue.project?.name ?? "None"}`,
    `Harness project: ${project.name}`,
    `Team: ${issue.team?.name ?? "Unknown"} (${issue.team?.key ?? ""})`,
    `Status at import: ${issue.state?.name ?? "Unknown"}`,
    `Priority: ${issue.priorityLabel ?? issue.priority ?? "None"}`,
    `Assignee: ${issue.assignee?.name ?? "Unassigned"}`,
    `Labels: ${(issue.labels?.nodes ?? []).map((label) => label.name).join(", ") || "None"}`,
    `Due date: ${issue.dueDate ?? "None"}; estimate: ${issue.estimate ?? "None"}`,
    `Cycle: ${issue.cycle?.name ?? issue.cycle?.number ?? "None"}`,
    `Parent: ${issue.parent ? `${issue.parent.identifier} — ${issue.parent.title}` : "None"}`,
  ];
  const links = (issue.attachments?.nodes ?? []).map(
    (attachment) => `- ${attachment.title}: ${attachment.url}`,
  );
  const relations = [
    ...(issue.relations?.nodes ?? []).map(
      (relation) =>
        `- ${issue.identifier} ${relation.type} ${relation.relatedIssue.identifier}: ${relation.relatedIssue.title}`,
    ),
    ...(issue.inverseRelations?.nodes ?? []).map(
      (relation) =>
        `- ${relation.issue.identifier} ${relation.type} ${issue.identifier}: ${relation.issue.title}`,
    ),
  ];
  const limited = ["labels", "attachments", "relations", "inverseRelations"].filter(
    (key) => issue[key]?.pageInfo?.hasNextPage,
  );
  const description = [
    issue.description?.trim() || "No description was supplied in Linear. Review the issue before starting.",
    "## Linear source",
    metadata.join("\n"),
    links.length ? `## Linked attachments (not downloaded)\n${links.join("\n")}` : "",
    relations.length ? `## Issue relations (context only)\n${relations.join("\n")}` : "",
    event.agentSession?.comment?.body ? `## Triggering comment\n${event.agentSession.comment.body}` : "",
    limited.length
      ? `Metadata limit: the first 100 ${limited.join(", ")} were imported; see Linear for the rest.`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");
  if (description.length > 20_000)
    throw new Error(
      "Linear brief exceeds the Harness 20,000-character limit. Shorten the issue or import a bounded task; content was not silently truncated.",
    );
  const title = `${issue.identifier}: ${issue.title.trim()}`;
  if (title.length > 300) throw new Error("Linear title exceeds the Harness 300-character limit.");
  return {
    title,
    description,
    repositoryPath: project.repositoryPath,
    workflow: "implement",
    priority: issue.priority === 1 || issue.priority === 2 ? "high" : issue.priority === 4 ? "low" : "medium",
    externalSource: {
      provider: "linear",
      organizationId: event.organizationId,
      issueId: issue.id,
      identifier: issue.identifier,
      url: issue.url,
      sessionId: event.agentSession.id,
      importedAt: new Date().toISOString(),
      projectId: project.id,
      issue,
      triggeringComment: event.agentSession.comment ?? null,
      previousComments: event.previousComments ?? [],
      guidance: event.guidance ?? [],
      promptContext: event.promptContext ?? null,
    },
  };
}
