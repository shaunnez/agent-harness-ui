import { randomUUID } from "node:crypto";
import { linearGrillReference } from "../linear-grill-contract.mjs";
import { grillUpdate, taskLink, taskUpdates } from "./linear-updates.mjs";

function replyFrom(event) {
  const item = event.action === "prompted" ? event.agentActivity : event.agentSession?.comment;
  if (!item) return null;
  return {
    id: item.id,
    userId: item.userId ?? item.user?.id,
    body: item.content?.body ?? item.body ?? "",
    signal: item.signal,
    sessionId: event.agentSession.id,
    issueId: event.agentSession.issue?.id ?? event.agentSession.issueId,
  };
}
function commandText(body) {
  return body.replace(/^\s*(?:<user\b[^>]*>[^<]*<\/user>|@harness)\s*/i, "").trim();
}
function invalidReply() {
  return Object.assign(new Error("Invalid Grill reply."), { code: "LINEAR_REPLY_INVALID" });
}

export class LinearWorkflow {
  constructor({ store, client, config, orchestrator, isEnabled = () => true }) {
    this.isEnabled = isEnabled;
    this.store = store;
    this.db = store.databaseHandle();
    this.client = client;
    this.config = config;
    this.orchestrator = orchestrator;
    this.db.exec(`CREATE TABLE IF NOT EXISTS linear_workflow_messages (
      id TEXT PRIMARY KEY, direction TEXT NOT NULL, event_key TEXT UNIQUE NOT NULL,
      task_id TEXT, session_id TEXT NOT NULL, payload_json TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued', attempts INTEGER NOT NULL DEFAULT 0,
      next_attempt_at INTEGER NOT NULL DEFAULT 0, last_error TEXT, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS linear_workflow_cursors (task_id TEXT PRIMARY KEY, revision INTEGER NOT NULL);`);
  }
  accept(event) {
    const reply = replyFrom(event);
    if (!reply || (event.action === "created" && !/^(answer|continue)\b/i.test(commandText(reply.body))))
      return false;
    if (
      typeof reply.id !== "string" ||
      !reply.id ||
      reply.id.length > 200 ||
      typeof reply.userId !== "string" ||
      !reply.userId ||
      reply.userId.length > 200 ||
      typeof reply.body !== "string" ||
      reply.body.length > 6000 ||
      (event.action === "prompted" &&
        (event.agentActivity.agentSessionId !== reply.sessionId ||
          (event.agentActivity.content?.type && event.agentActivity.content.type !== "prompt")))
    ) {
      throw Object.assign(new Error("Linear reply identity, content or size is invalid."), {
        statusCode: 400,
      });
    }
    const key = `reply:${reply.id}`;
    if (this.db.prepare("SELECT id FROM linear_workflow_messages WHERE event_key = ?").get(key)) return true;
    if (
      this.db
        .prepare(
          "SELECT count(*) AS count FROM linear_workflow_messages WHERE direction = 'in' AND status != 'completed'",
        )
        .get().count >= 1000
    )
      throw Object.assign(new Error("Linear reply queue is full."), { statusCode: 503 });
    this.db
      .prepare(`INSERT INTO linear_workflow_messages
      (id, direction, event_key, session_id, payload_json, created_at) VALUES (?, 'in', ?, ?, ?, ?)`)
      .run(randomUUID(), key, reply.sessionId, JSON.stringify(reply), new Date().toISOString());
    return true;
  }
  status() {
    return {
      counts: this.db
        .prepare(
          "SELECT direction, status, count(*) AS count FROM linear_workflow_messages GROUP BY direction, status",
        )
        .all(),
      recent: this.db
        .prepare(`SELECT id, direction, task_id AS taskId, status, attempts, last_error AS error
        FROM linear_workflow_messages ORDER BY rowid DESC LIMIT 50`)
        .all(),
    };
  }
  retry(id) {
    return (
      this.db
        .prepare(
          "UPDATE linear_workflow_messages SET status = 'queued', attempts = 0, next_attempt_at = 0, last_error = NULL WHERE id = ? AND status = 'blocked'",
        )
        .run(id).changes > 0
    );
  }
  enqueue(task, sessionId, key, content, reference = null) {
    this.db
      .prepare(`INSERT OR IGNORE INTO linear_workflow_messages
      (id, direction, event_key, task_id, session_id, payload_json, created_at)
      VALUES (?, 'out', ?, ?, ?, ?, ?)`)
      .run(
        randomUUID(),
        `${task.id}:${key}`,
        task.id,
        sessionId,
        JSON.stringify({ content, reference }),
        new Date().toISOString(),
      );
  }
  async drain() {
    if (!this.isEnabled()) return;
    await this.process("in", async (row) => {
      await this.applyReply(row);
      const reply = JSON.parse(row.payload_json);
      const task = await this.store.findExternalTask("linear", this.config.organizationId, reply.issueId);
      const pending = task && grillUpdate(task, this.config);
      if (
        reply.signal !== "stop" &&
        pending &&
        (task.externalSource.sessionId !== reply.sessionId ||
          this.db
            .prepare("SELECT id FROM linear_workflow_messages WHERE event_key = ? AND status = 'completed'")
            .get(`${task.id}:${pending.key}`))
      ) {
        // Keep a newly mentioned conversation usable too; re-show pending input after invalid replies.
        this.enqueue(task, reply.sessionId, `${row.event_key}:reminder`, pending.content, pending.reference);
      }
    });
    if (!this.isEnabled()) return;
    const rows = this.db
      .prepare(`SELECT id, revision FROM tasks
      WHERE json_extract(core_json, '$.externalSource.provider') = 'linear'
      AND json_extract(core_json, '$.externalSource.organizationId') = ?
      AND revision != COALESCE((SELECT revision FROM linear_workflow_cursors WHERE task_id = tasks.id), -1)`)
      .all(this.config.organizationId);
    for (const row of rows) {
      if (!this.isEnabled()) return;
      const task = await this.store.get(row.id);
      const sessionId = task.externalSource.sessionId;
      for (const update of taskUpdates(task, this.config))
        this.enqueue(task, sessionId, update.key, update.content, update.reference);
      // A crash before this cursor write is harmless: outbound keys are unique.
      this.db
        .prepare("INSERT OR REPLACE INTO linear_workflow_cursors (task_id, revision) VALUES (?, ?)")
        .run(row.id, row.revision);
    }
    await this.process("out", async (row) => {
      const { content, reference } = JSON.parse(row.payload_json);
      const task = await this.store.get(row.task_id);
      if (!task || task.externalSource?.organizationId !== this.config.organizationId) return "superseded";
      if (reference && grillUpdate(task, this.config)?.reference !== reference) return "superseded";
      if (
        /:(artifact|state|pr):/.test(row.event_key) &&
        !taskUpdates(task, this.config).some((update) => `${task.id}:${update.key}` === row.event_key)
      )
        return "superseded";
      await this.client.publishActivity(row.id, row.session_id, content);
    });
  }
  async process(direction, handle) {
    const rows = this.db
      .prepare(`SELECT * FROM linear_workflow_messages WHERE direction = ?
      AND status = 'queued' AND next_attempt_at <= ? ORDER BY rowid LIMIT 50`)
      .all(direction, Date.now());
    if (!rows.length) return;
    let identityChecked = false;
    for (const row of rows) {
      if (!this.isEnabled()) return;
      try {
        if (!identityChecked) {
          const identity = await this.client.identity();
          if (
            identity.organizationId !== this.config.organizationId ||
            identity.appUserId !== this.config.appUserId
          )
            throw new Error("Linear app identity changed.");
          identityChecked = true;
        }
        const status = (await handle(row)) ?? "completed";
        this.db
          .prepare(
            "UPDATE linear_workflow_messages SET status = ?, attempts = attempts + 1, last_error = NULL WHERE id = ?",
          )
          .run(status, row.id);
      } catch {
        // Provider/domain errors may embed private prompt content; status exposes only a safe diagnosis.
        const attempts = row.attempts + 1;
        this.db
          .prepare(
            "UPDATE linear_workflow_messages SET status = ?, attempts = ?, next_attempt_at = ?, last_error = ? WHERE id = ?",
          )
          .run(
            attempts >= 5 ? "blocked" : "queued",
            attempts,
            Date.now() + 5000 * 2 ** attempts,
            "Linear workflow delivery failed. Check app access and local task state, then retry this message ID.",
            row.id,
          );
      }
    }
  }
  async applyReply(row) {
    const reply = JSON.parse(row.payload_json);
    const task = await this.store.findExternalTask("linear", this.config.organizationId, reply.issueId);
    if (!task) throw new Error("No imported task matches this Linear reply.");
    this.db.prepare("UPDATE linear_workflow_messages SET task_id = ? WHERE id = ?").run(task.id, row.id);
    const user = await this.client.user(reply.userId);
    const respond = (body) =>
      this.enqueue(task, reply.sessionId, row.event_key, {
        type: "response",
        body: `${body}\n\n[Open ${task.id} in Harness](${taskLink(task, this.config)})`,
      });
    if (
      !user?.active ||
      user.app ||
      user.id !== reply.userId ||
      user.organization?.id !== this.config.organizationId
    ) {
      respond(
        "No action taken. Grill replies must come from an active human member of this Linear workspace.",
      );
      return;
    }
    const text = commandText(reply.body);
    const answer = text.match(/^answer\s+([a-f0-9]{12})\s*:\s*([\s\S]+)$/i);
    const continuation = text.match(/^continue\s+([a-f0-9]{12})$/i);
    const provenance = {
      eventId: reply.id,
      userId: user.id,
      userName: user.name,
      sessionId: reply.sessionId,
      issueId: reply.issueId,
      organizationId: this.config.organizationId,
      reference: (answer?.[1] ?? continuation?.[1] ?? "").toLowerCase(),
    };
    if (reply.signal === "stop") {
      if (this.orchestrator.isRunning(task.id)) await this.orchestrator.cancel(task.id);
      respond(
        "Stop request received. No Grill answer or continuation was applied; any active Harness run was asked to stop.",
      );
      return;
    }
    if (
      task.decisions.some((item) => item.linearReply?.eventId === reply.id) ||
      task.grillSession?.linearCompletion?.eventId === reply.id
    ) {
      respond("This reply has already been recorded. No duplicate action was taken.");
      return;
    }
    try {
      if (answer) {
        const question = task.grillSession?.questions.find(
          (item) => linearGrillReference(task, item) === provenance.reference,
        );
        if (!question) throw invalidReply();
        let value = answer[2].trim();
        if (/^\d+$/.test(value)) {
          const option = question.options[Number(value) - 1];
          if (!option) throw invalidReply();
          value = option.label;
        } else if (
          question.allowCustom === false &&
          !question.options.some((option) => option.label === value)
        )
          throw invalidReply();
        if (!value || value.length > 5000) throw invalidReply();
        await this.orchestrator.answerGrillQuestion(task.id, {
          questionId: question.id,
          answer: value,
          source: "linear",
          linear: provenance,
        });
        respond(`Recorded ${question.id}: ${value}`);
      } else if (continuation) {
        await this.orchestrator.finishGrill(task.id, { source: "linear", linear: provenance });
        respond(
          "Grill continuation recorded. Harness will follow its existing workflow and approval controls.",
        );
      } else {
        respond(
          "No action taken. Reply using `@Harness answer <reference>: <option number or answer>` or, after all answers, `@Harness continue <reference>`. Use the reference in the latest Grill question. Other approvals and commands remain in Harness.",
        );
      }
    } catch (error) {
      if (error.code !== "LINEAR_REPLY_INVALID") throw error;
      respond(
        "No action taken. The reply may be stale, already answered, invalid, or the task is no longer awaiting manual Grill. Use the latest question/reference and a listed option or permitted custom answer. Open Harness to review the current state.",
      );
    }
  }
}
