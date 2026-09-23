#!/usr/bin/env node
// The scope → pack eval (`research-agent-deepagents-spike-pack/29-EVAL-PREREGISTRATION.md`).
//
//   node scripts/research-eval.mjs --arm A0|A2|A3 [--only id,id] [--out <dir>]
//   node scripts/research-eval.mjs --rescore [--out <dir>]
//
// Runs every pre-registered question three times on one arm and writes one JSON file per
// question under `<out>/<arm>/`, as soon as its three runs finish, so a stopped eval resumes
// where it stopped (a question with a result file is skipped). Status and checks are computed by
// the product's own `questionRecord`, so the eval scores exactly what the research window shows.
//
// QV comes from PlanCheck's library (`RESEARCH_QV_SOURCE=plancheck`, the default); the token
// command and file come from the environment, never from this file. Each arm runs on the
// operator's plans: Claude on the subscription, Codex on ChatGPT, never an API key.

import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { ClaudeCliResearchRuntime } from "../server/research/claude-cli/runtime.mjs";
import { CodexCliResearchRuntime } from "../server/research/codex-cli/runtime.mjs";
import { PackResearchRuntime } from "../server/research/pack/runtime.mjs";
import { questionRecord } from "../server/research/research-question-record.mjs";
import { scopedObjective } from "../server/research/research-scope.mjs";
import { resolveResearchBudget } from "../src/research-budget-policy.ts";

const PACK_DIRECTORY = fileURLToPath(new URL("../research-agent-deepagents-spike-pack/", import.meta.url));
const EVAL_DIRECTORY = path.join(PACK_DIRECTORY, "29-eval");
const RUNS = ["r1", "r2", "r3"];

/** The frozen arms. All High; all on PlanCheck's library. */
export const ARMS = {
  A0: {
    runtime: "claude-cli",
    model: "claude-opus-5-5",
    reasoning: "high",
    make: (env) => new ClaudeCliResearchRuntime({ env }),
  },
  A2: {
    runtime: "pack",
    model: "claude-opus-5-5",
    reasoning: "high",
    make: (env) => new PackResearchRuntime({ env }),
  },
  A3: {
    runtime: "codex-cli",
    model: "gpt-6-luna",
    reasoning: "high",
    make: (env) => new CodexCliResearchRuntime({ env }),
  },
};

/** The decision metric's passing checks: a found row, a verified quote, or a labelled allowance. */
const CHECKED = new Set(["qv-found", "web-verified", "allowance"]);

/** The frozen question set: ten pinned scopes and the three scoped open questions. */
export async function evalQuestions() {
  const set = JSON.parse(await readFile(path.join(EVAL_DIRECTORY, "question-set.json"), "utf8"));
  const open = JSON.parse(await readFile(path.join(EVAL_DIRECTORY, "open-scopes.json"), "utf8"));
  const pinned = [];
  for (const entry of set.pinned) {
    const objective = await readFile(path.join(PACK_DIRECTORY, "16-pinned-scopes", entry.file), "utf8");
    pinned.push({
      id: entry.id,
      kind: "pinned",
      recorded: entry.recorded,
      objective: objective.trim(),
      scope: null,
    });
  }
  return [
    ...pinned,
    ...open.map((item) => ({
      id: item.id,
      kind: "open",
      recorded: null,
      objective: item.objective,
      scope: item.scope,
    })),
  ];
}

/** Whether a question passes the decision metric: agreed, and every component of every run
 *  checked. */
export function passes(record) {
  return (
    record.status === "agreed" &&
    record.runs.every(
      (run) =>
        run.status === "completed" &&
        run.components.length > 0 &&
        run.components.every((item) => CHECKED.has(item.check)),
    )
  );
}

/** The product's own record for a question's runs: status, agreement and per-component checks. */
function score(question, runs, createdAt) {
  return questionRecord({
    question: {
      id: question.id,
      projectId: "eval",
      createdAt,
      title: question.id,
      objective: question.objective,
      profile: "standard",
      runsPlanned: 3,
      source: { kind: "manual" },
      scope: question.scope
        ? { scope: question.scope, scopedBy: { runtime: "codex-cli", model: "gpt-6-luna" }, reviewed: false }
        : null,
    },
    runs,
  });
}

/**
 * Re-score every recorded result with the current `questionRecord`, keeping the runs as recorded.
 * Used when the scoring rule is corrected mid-eval; the correction is recorded in doc 29.
 */
async function rescore(out) {
  const questions = new Map((await evalQuestions()).map((question) => [question.id, question]));
  for (const armId of Object.keys(ARMS)) {
    const directory = path.join(out, armId);
    const files = await readdir(directory).catch(() => []);
    for (const name of files.filter((file) => file.endsWith(".json")).sort()) {
      const file = path.join(directory, name);
      const result = JSON.parse(await readFile(file, "utf8"));
      const runs = result.runs.map((run) => ({
        id: `${result.question}-${run.run}`,
        runLabel: run.run,
        status: run.status,
        error: run.error,
        usage: run.usage,
        updatedAt: new Date().toISOString(),
        outcome: {
          costBand:
            run.band || run.checks.length ? { band: run.band, components: run.checks.map(() => ({})) } : null,
          citations: run.checks.length ? { checks: run.checks } : null,
        },
      }));
      const record = score(questions.get(result.question), runs, new Date().toISOString());
      const before = `${result.status}${result.passes ? " PASS" : ""}`;
      Object.assign(result, {
        status: record.status,
        passes: passes(record),
        consensus: record.consensus,
        range: record.range,
        unit: record.unit,
        unitsDiffer: record.unitsDiffer,
        agreement: record.agreement,
      });
      await writeFile(file, `${JSON.stringify(result, null, 2)}\n`);
      const after = `${result.status}${result.passes ? " PASS" : ""}`;
      console.log(`${armId} ${result.question}: ${after}${after === before ? "" : `  (was ${before})`}`);
    }
  }
}

async function runQuestion(runtime, arm, question) {
  const objective = scopedObjective(question.objective, question.scope);
  const startedAt = new Date().toISOString();
  const started = Date.now();
  const runs = await Promise.all(
    RUNS.map(async (label) => {
      const id = `eval-${arm.id}-${question.id}-${label}-${Date.now().toString(36)}`;
      const request = {
        id,
        objective,
        profile: "standard",
        context: [],
        budget: resolveResearchBudget("standard", null),
        researchPolicy: { source: "eval", runtime: arm.runtime, model: arm.model, reasoning: arm.reasoning },
      };
      const runStarted = Date.now();
      await runtime.start(request);
      for await (const _event of runtime.events(id));
      const status = await runtime.status(id);
      return {
        id,
        runLabel: label,
        runtimeId: arm.runtime,
        request: { researchPolicy: request.researchPolicy },
        model: { model: arm.model },
        status: status.status,
        error: status.error ?? null,
        outcome: runtime.outcome(id),
        usage: status.usage,
        elapsedMs: Date.now() - runStarted,
        updatedAt: new Date().toISOString(),
      };
    }),
  );
  const record = score(question, runs, startedAt);
  const costUsd = runs.reduce((sum, run) => sum + Number(run.usage?.estimatedCostUsd ?? 0), 0);
  return {
    question: question.id,
    kind: question.kind,
    arm: arm.id,
    status: record.status,
    passes: passes(record),
    consensus: record.consensus,
    range: record.range,
    unit: record.unit,
    unitsDiffer: record.unitsDiffer,
    agreement: record.agreement,
    costUsd: Math.round(costUsd * 10_000) / 10_000,
    elapsedMs: Date.now() - started,
    runs: runs.map((run, index) => ({
      run: run.runLabel,
      status: run.status,
      error: run.error,
      elapsedMs: run.elapsedMs,
      band: run.outcome?.costBand?.band ?? null,
      checks: record.runs[index].components.map((item) => item.check),
      citations: run.outcome?.citations?.summary ?? null,
      usage: run.usage,
    })),
  };
}

async function main() {
  const args = process.argv.slice(2);
  const option = (name) => {
    const index = args.indexOf(name);
    return index === -1 ? null : args[index + 1];
  };
  if (args.includes("--rescore")) return rescore(option("--out") ?? path.join(EVAL_DIRECTORY, "results"));
  const armId = option("--arm");
  if (!ARMS[armId]) throw new Error(`Choose --arm ${Object.keys(ARMS).join("|")}.`);
  const arm = { id: armId, ...ARMS[armId] };
  const only = option("--only")?.split(",") ?? null;
  const out = path.join(option("--out") ?? path.join(EVAL_DIRECTORY, "results"), armId);
  await mkdir(out, { recursive: true });
  const env = { ...process.env, RESEARCH_QV_SOURCE: process.env.RESEARCH_QV_SOURCE ?? "plancheck" };
  const runtime = arm.make(env);
  for (const question of await evalQuestions()) {
    if (only && !only.includes(question.id)) continue;
    const file = path.join(out, `${question.id}.json`);
    if (
      await readFile(file).then(
        () => true,
        () => false,
      )
    ) {
      console.log(`${armId} ${question.id}: already recorded`);
      continue;
    }
    const result = await runQuestion(runtime, arm, question);
    await writeFile(file, `${JSON.stringify(result, null, 2)}\n`);
    console.log(
      `${armId} ${question.id}: ${result.status}${result.passes ? " PASS" : ""} · $${result.costUsd.toFixed(2)} · ${Math.round(result.elapsedMs / 1000)} s · ${result.runs.map((run) => run.status).join("/")}`,
    );
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url))
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
