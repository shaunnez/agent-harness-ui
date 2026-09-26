// PlanCheck's batches: the tender items it could not price from the QV catalogue, sent here to be
// researched (20 to 100 at a time, Shaun, 26 September 2026).
//
// A batch is stored first and researched after, by a worker that asks one question per item. The
// queue is these rows, not memory: a restart loses nothing, and the worker picks up where it was.
// The worker never asks more questions than the pacer has room for, so a batch of 100 does not
// start 500 runs against a provider that allows six; the rest wait as rows that cost nothing.
//
// An item's answer is its question's record, read live, so a review or a retry shows at once.
// Each item is a question with an external source (`plancheck:<item id>`): an item PlanCheck sends
// again, in the same batch or a later one, finds the question it already raised and starts
// nothing.

import { createHash } from "node:crypto";

export const MAX_BATCH_ITEMS = 200;
const MAX_ID = 120;
const MAX_DESCRIPTION = 2_000;
const MAX_FIELD = 200;
const MAX_NOTES = 1_000;
const MAX_REFERENCE_KEYS = 10;
/** Tries at asking an item's question before it fails (a scoper outage, the database away). */
const MAX_ASK_ATTEMPTS = 3;
/** Retries of a question whose runs never started (a restart while they queued, a missing key). */
const MAX_START_RETRIES = 2;
const BATCH_ID_PREFIX = "RB";

export const SERVICE_MIGRATIONS = Object.freeze({
  scope: "service",
  migrations: [
    {
      version: 1,
      name: "batches",
      sql: `
        CREATE SEQUENCE IF NOT EXISTS research_batch_seq START 1;
        CREATE TABLE research_batches (
          id TEXT COLLATE "C" PRIMARY KEY,
          client TEXT NOT NULL,
          external_id TEXT NOT NULL,
          created_at TEXT COLLATE "C" NOT NULL,
          reference_json TEXT,
          item_count INTEGER NOT NULL,
          -- A batch sent twice (a retried POST) is the same batch.
          UNIQUE (client, external_id)
        );
        CREATE TABLE research_batch_items (
          batch_id TEXT COLLATE "C" NOT NULL REFERENCES research_batches(id) ON DELETE CASCADE,
          item_id TEXT COLLATE "C" NOT NULL,
          ordinal INTEGER NOT NULL,
          request_json TEXT NOT NULL,
          -- pending → asking → asked → done, or failed.
          status TEXT NOT NULL,
          question_id TEXT COLLATE "C",
          attempts INTEGER NOT NULL DEFAULT 0,
          start_retries INTEGER NOT NULL DEFAULT 0,
          error_json TEXT,
          updated_at TEXT COLLATE "C" NOT NULL,
          PRIMARY KEY (batch_id, item_id)
        );
        CREATE INDEX research_batch_items_queue_idx ON research_batch_items(status, batch_id, ordinal);
      `,
    },
  ],
});

/** A batch as PlanCheck sent it, checked and normalized, or a 400. */
export function validateBatch(input) {
  if (!isObject(input)) throw badRequest("Send a batch object.");
  const externalId = text(input.batchId, "batchId", MAX_ID, { required: true });
  if (!Array.isArray(input.items) || !input.items.length)
    throw badRequest("A batch needs at least one item.");
  if (input.items.length > MAX_BATCH_ITEMS)
    throw badRequest(`A batch holds at most ${MAX_BATCH_ITEMS} items; send the rest in another.`);
  const seen = new Set();
  const items = input.items.map((item, index) => {
    if (!isObject(item)) throw badRequest(`Item ${index + 1} is not an object.`);
    const id = text(item.id, `items[${index}].id`, MAX_ID, { required: true });
    if (seen.has(id)) throw badRequest(`Item ${id} appears twice in the batch.`);
    seen.add(id);
    const quantity = item.quantity == null ? null : Number(item.quantity);
    if (quantity != null && (!Number.isFinite(quantity) || quantity < 0))
      throw badRequest(`items[${index}].quantity must be a number of zero or more.`);
    return {
      id,
      description: text(item.description, `items[${index}].description`, MAX_DESCRIPTION, { required: true }),
      unit: text(item.unit, `items[${index}].unit`, 40),
      quantity,
      location: text(item.location, `items[${index}].location`, MAX_FIELD),
      notes: text(item.notes, `items[${index}].notes`, MAX_NOTES),
    };
  });
  let reference = null;
  if (input.reference != null) {
    if (!isObject(input.reference)) throw badRequest("reference is a flat object of strings.");
    const entries = Object.entries(input.reference);
    if (entries.length > MAX_REFERENCE_KEYS)
      throw badRequest(`reference holds at most ${MAX_REFERENCE_KEYS} keys.`);
    for (const [key, value] of entries)
      if (typeof value !== "string" || value.length > MAX_FIELD || key.length > 40)
        throw badRequest("reference is a flat object of short strings.");
    reference = Object.fromEntries(entries);
  }
  return { externalId, items, reference };
}

/** The research question an item asks: its words as PlanCheck sent them, with what it knows
 *  about quantity and place. The API loop's recipe already asks for NZD, GST exclusive. */
export function itemObjective(item) {
  return [
    item.description,
    item.unit ? `Unit: ${item.unit}.` : null,
    item.quantity != null ? `Quantity: ${item.quantity}.` : null,
    item.location ? `Location: ${item.location}.` : null,
    item.notes ? `Notes: ${item.notes}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

export class BatchStore {
  #db;

  constructor(db) {
    this.#db = db;
  }

  /** Stores a batch and its items as pending, or returns the batch this client already sent
   *  under the same id (`created: false`), unchanged, whatever this delivery holds. */
  async create(client, { externalId, items, reference }, { now = new Date().toISOString() } = {}) {
    const existing = await this.findByExternalId(client, externalId);
    if (existing) return { batch: existing, created: false };
    return this.#db.transaction(async (tx) => {
      const { rows } = await tx.query("SELECT nextval('research_batch_seq') AS next");
      const id = `${BATCH_ID_PREFIX}-${String(Number(rows[0].next)).padStart(3, "0")}`;
      const inserted = await tx.query(
        `INSERT INTO research_batches(id, client, external_id, created_at, reference_json, item_count)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (client, external_id) DO NOTHING`,
        [id, client, externalId, now, reference ? JSON.stringify(reference) : null, items.length],
      );
      if (Number(inserted.rowCount) !== 1) {
        const { rows: winner } = await tx.query(
          "SELECT * FROM research_batches WHERE client = $1 AND external_id = $2",
          [client, externalId],
        );
        return { batch: batchRecord(winner[0]), created: false };
      }
      for (const [index, item] of items.entries())
        await tx.query(
          `INSERT INTO research_batch_items(batch_id, item_id, ordinal, request_json, status, updated_at)
           VALUES ($1, $2, $3, $4, 'pending', $5)`,
          [id, item.id, index + 1, JSON.stringify(item), now],
        );
      const { rows: stored } = await tx.query("SELECT * FROM research_batches WHERE id = $1", [id]);
      return { batch: batchRecord(stored[0]), created: true };
    });
  }

  async get(id) {
    const { rows } = await this.#db.query("SELECT * FROM research_batches WHERE id = $1", [id]);
    return rows[0] ? batchRecord(rows[0]) : null;
  }

  async findByExternalId(client, externalId) {
    const { rows } = await this.#db.query(
      "SELECT * FROM research_batches WHERE client = $1 AND external_id = $2",
      [client, externalId],
    );
    return rows[0] ? batchRecord(rows[0]) : null;
  }

  async items(batchId) {
    const { rows } = await this.#db.query(
      "SELECT * FROM research_batch_items WHERE batch_id = $1 ORDER BY ordinal ASC",
      [batchId],
    );
    return rows.map(itemRecord);
  }

  async itemsIn(status) {
    const { rows } = await this.#db.query(
      `SELECT items.*, batches.client FROM research_batch_items AS items
       JOIN research_batches AS batches ON batches.id = items.batch_id
       WHERE items.status = $1 ORDER BY batches.created_at ASC, items.batch_id ASC, items.ordinal ASC`,
      [status],
    );
    return rows.map(itemRecord);
  }

  /** Takes up to `limit` pending items, oldest batch first, and marks them `asking`. Rows another
   *  worker holds are skipped rather than waited for, so two workers never take the same item. */
  async claim(limit, { now = new Date().toISOString() } = {}) {
    if (limit < 1) return [];
    const { rows } = await this.#db.query(
      `UPDATE research_batch_items AS items SET status = 'asking', updated_at = $2
       FROM (
         SELECT pending.batch_id, pending.item_id
         FROM research_batch_items AS pending
         JOIN research_batches AS batches ON batches.id = pending.batch_id
         WHERE pending.status = 'pending'
         ORDER BY batches.created_at ASC, pending.batch_id ASC, pending.ordinal ASC
         LIMIT $1
         FOR UPDATE OF pending SKIP LOCKED
       ) AS claimed
       WHERE items.batch_id = claimed.batch_id AND items.item_id = claimed.item_id
       RETURNING items.*, (SELECT client FROM research_batches WHERE id = items.batch_id) AS client`,
      [limit, now],
    );
    return rows.map(itemRecord).sort((a, b) => a.ordinal - b.ordinal);
  }

  async mark(item, fields, { now = new Date().toISOString() } = {}) {
    const next = {
      status: item.status,
      questionId: item.questionId,
      attempts: item.attempts,
      startRetries: item.startRetries,
      error: item.error,
      ...fields,
    };
    await this.#db.query(
      `UPDATE research_batch_items
       SET status = $3, question_id = $4, attempts = $5, start_retries = $6, error_json = $7, updated_at = $8
       WHERE batch_id = $1 AND item_id = $2`,
      [
        item.batchId,
        item.itemId,
        next.status,
        next.questionId ?? null,
        next.attempts,
        next.startRetries,
        next.error ? JSON.stringify(next.error) : null,
        now,
      ],
    );
    return { ...item, ...next };
  }

  /** Items a stopped worker was asking go back to the queue; asking again finds any question the
   *  first try raised, by its source key. */
  async recover() {
    const { rowCount } = await this.#db.query(
      "UPDATE research_batch_items SET status = 'pending' WHERE status = 'asking'",
    );
    return rowCount;
  }
}

export class BatchWorker {
  #batches;
  #questions;
  #pacer;
  #runsPerQuestion;
  #projectId;
  #intervalMs;
  #log;
  #timer = null;
  #running = null;
  #stopped = false;

  constructor({ batches, questions, pacer, runsPerQuestion, projectId, intervalMs = 2_000, log = () => {} }) {
    this.#batches = batches;
    this.#questions = questions;
    this.#pacer = pacer;
    this.#runsPerQuestion = runsPerQuestion;
    this.#projectId = projectId;
    this.#intervalMs = intervalMs;
    this.#log = log;
  }

  /** Questions allowed in flight: enough to keep the pacer's run slots full, and one more so the
   *  next question is scoped and waiting when a slot frees. */
  get questionLimit() {
    return Math.max(1, Math.ceil(this.#pacer.limit / this.#runsPerQuestion)) + 1;
  }

  start() {
    this.#stopped = false;
    const loop = async () => {
      if (this.#stopped) return;
      this.#running = this.tick().catch((error) =>
        this.#log("batch worker tick failed", { error: error.message }),
      );
      await this.#running;
      this.#running = null;
      if (!this.#stopped) this.#timer = setTimeout(loop, this.#intervalMs);
    };
    this.#timer = setTimeout(loop, 0);
  }

  async stop() {
    this.#stopped = true;
    if (this.#timer) clearTimeout(this.#timer);
    await this.#running;
  }

  /** One pass: settle the questions that finished, then ask as many new ones as there is room for. */
  async tick() {
    let inFlight = 0;
    for (const item of await this.#batches.itemsIn("asked")) {
      if (await this.#settle(item)) continue;
      inFlight += 1;
    }
    const room = this.questionLimit - inFlight;
    for (const item of await this.#batches.claim(room)) await this.#ask(item);
  }

  /** True when the item is finished with. */
  async #settle(item) {
    const record = await this.#questions.get(item.questionId, { activity: false });
    if (!record) {
      await this.#batches.mark(item, {
        status: "failed",
        error: { code: "question_missing", message: "The item's question is gone." },
      });
      return true;
    }
    if (record.status === "running" || record.status === "queued") return false;
    // Runs that never started spent nothing: start them again, a couple of times, before
    // leaving the item for a person.
    if (record.retryable && item.startRetries < MAX_START_RETRIES) {
      try {
        await this.#questions.retry(item.questionId);
        await this.#batches.mark(item, { startRetries: item.startRetries + 1 });
        return false;
      } catch (error) {
        this.#log("batch item retry failed", {
          batch: item.batchId,
          item: item.itemId,
          error: error.message,
        });
      }
    }
    await this.#batches.mark(item, { status: "done" });
    return true;
  }

  async #ask(item) {
    try {
      const { question } = await this.#questions.ask({
        projectId: this.#projectId,
        title: titleOf(item.request.description),
        objective: itemObjective(item.request),
        runs: this.#runsPerQuestion,
        source: { kind: "external", provider: item.client, requestId: item.itemId },
      });
      await this.#batches.mark(item, {
        status: "asked",
        questionId: question.id,
        attempts: item.attempts + 1,
        error: null,
      });
    } catch (error) {
      const attempts = item.attempts + 1;
      // A request the question service refuses will be refused again; anything else may pass.
      const refused = error?.statusCode >= 400 && error?.statusCode < 500 && error?.statusCode !== 409;
      const failed = refused || attempts >= MAX_ASK_ATTEMPTS;
      await this.#batches.mark(item, {
        status: failed ? "failed" : "pending",
        attempts,
        error: {
          code: error?.code ?? (refused ? "refused" : "ask_failed"),
          message: String(error?.message ?? error),
        },
      });
      this.#log("batch item ask failed", {
        batch: item.batchId,
        item: item.itemId,
        attempts,
        failed,
        error: error?.message,
      });
    }
  }
}

/** What PlanCheck reads for a batch: each item's state and, once its question has settled, the
 *  answer. `questions` is the question service; each record is read live. */
export async function describeBatch(batch, items, questions) {
  const described = [];
  for (const item of items) {
    // An answer only once the worker has settled the item: a question whose runs failed to start
    // has stopped running but is about to be retried, and is not an answer yet.
    const record =
      item.status === "done" && item.questionId
        ? await questions.get(item.questionId, { activity: false })
        : null;
    described.push({
      id: item.itemId,
      status: itemStatus(item),
      questionId: item.questionId ?? null,
      answer: record ? answerOf(record) : null,
      error: item.status === "failed" ? item.error : null,
    });
  }
  const counts = { queued: 0, researching: 0, done: 0, failed: 0 };
  for (const item of described) counts[item.status] += 1;
  return {
    id: batch.id,
    batchId: batch.externalId,
    createdAt: batch.createdAt,
    reference: batch.reference,
    status:
      counts.queued + counts.researching
        ? counts.researching || counts.done || counts.failed
          ? "running"
          : "queued"
        : "done",
    counts,
    items: described,
  };
}

/** The part of a question record a tender can use. Dollar amounts are NZD, GST exclusive. The
 *  grade decides what may go back automatically (`research-question-grade.mjs`); a price is sent
 *  only with a Confident or Wide estimate grade. */
function answerOf(record) {
  return {
    status: record.status,
    grade: record.grading?.grade ?? null,
    gradeLabel: record.grading?.label ?? null,
    bestBand: record.grading?.bestBand ?? null,
    range: record.grading?.range ?? record.range ?? null,
    reasons: record.grading?.reasons ?? [],
    unit: record.unit,
    currency: record.currency,
    gstBasis: record.gstBasis,
    basis: record.basis,
    openQuestions: record.openQuestions,
    citationsChecked: record.citationsChecked,
    costUsd: record.costUsd,
    evidenceSha: record.evidenceSha,
    review: record.review ? { decision: record.review.decision, decidedAt: record.review.decidedAt } : null,
  };
}

function itemStatus(item) {
  if (item.status === "failed") return "failed";
  if (item.status === "pending" || item.status === "asking") return "queued";
  if (item.status === "done") return "done";
  return "researching";
}

function batchRecord(row) {
  return {
    id: row.id,
    client: row.client,
    externalId: row.external_id,
    createdAt: row.created_at,
    reference: row.reference_json ? JSON.parse(row.reference_json) : null,
    itemCount: Number(row.item_count),
  };
}

function itemRecord(row) {
  return {
    batchId: row.batch_id,
    itemId: row.item_id,
    ordinal: Number(row.ordinal),
    request: JSON.parse(row.request_json),
    status: row.status,
    questionId: row.question_id ?? null,
    attempts: Number(row.attempts),
    startRetries: Number(row.start_retries),
    error: row.error_json ? JSON.parse(row.error_json) : null,
    ...(row.client ? { client: row.client } : {}),
  };
}

function titleOf(description) {
  const line = String(description).split("\n")[0].trim();
  return line.length > 90 ? `${line.slice(0, 89).replace(/\s+\S*$/, "")}…` : line;
}

function text(value, name, max, { required = false } = {}) {
  if (value == null || value === "") {
    if (required) throw badRequest(`${name} is required.`);
    return null;
  }
  if (typeof value !== "string") throw badRequest(`${name} must be text.`);
  const trimmed = value.trim();
  if (required && !trimmed) throw badRequest(`${name} is required.`);
  if (trimmed.length > max) throw badRequest(`${name} is longer than ${max} characters.`);
  return trimmed || null;
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function badRequest(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

/** The hash a client token is configured by. */
export function tokenSha256(token) {
  return createHash("sha256").update(String(token)).digest("hex");
}
