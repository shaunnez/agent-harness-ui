#!/usr/bin/env node
/**
 * Record a task evaluation, including the fields no UI exposes.
 *
 * `POST /api/tasks/:id/evaluation` accepts a named rubric, a `blind` score kind and a
 * suite/case identity, but the settings UI posts only score, outcome and notes — so a
 * controlled campaign cannot record blind scores or per-case identity through the app.
 * This script closes that gap without building UI for a campaign that runs once.
 *
 *   node scripts/record-evaluation.mjs --task AH-090 --score 4 --outcome accepted \
 *     --kind blind --case C1-narrow --suite baseline-2026-09 \
 *     --rubric correctness=4,scope=5,readability=3 --evaluator shaun --notes "…"
 *
 * Scores are integers 1-5, and every rubric entry must be one too — the server rejects
 * anything else rather than coercing it.
 */
const OUTCOMES = new Set(["accepted", "rejected", "mixed"]);

const FLAGS = new Map([
  ["--task", "task"],
  ["--score", "score"],
  ["--outcome", "outcome"],
  ["--kind", "kind"],
  ["--notes", "notes"],
  ["--evaluator", "evaluator"],
  ["--suite", "suiteId"],
  ["--case", "caseId"],
  ["--rubric", "rubric"],
  ["--base", "base"],
]);

function parseArguments(argv) {
  const options = {
    task: null,
    score: null,
    outcome: null,
    kind: "human",
    notes: "",
    evaluator: null,
    suiteId: null,
    caseId: null,
    rubric: null,
    base: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const key = FLAGS.get(argv[index]);
    if (!key) throw new Error(`Unknown argument: ${argv[index]}`);
    index += 1;
    if (index >= argv.length) throw new Error(`${argv[index - 1]} needs a value.`);
    options[key] = key === "score" ? Number(argv[index]) : argv[index];
  }
  if (!options.task) throw new Error("--task <id> is required.");
  if (!Number.isInteger(options.score) || options.score < 1 || options.score > 5)
    throw new Error("--score must be an integer from 1 to 5.");
  if (!OUTCOMES.has(options.outcome))
    throw new Error(`--outcome must be one of ${[...OUTCOMES].join(", ")}.`);
  if (!["human", "blind"].includes(options.kind)) throw new Error("--kind must be human or blind.");
  return options;
}

function parseRubric(raw) {
  if (!raw) return undefined;
  const rubric = {};
  for (const pair of raw.split(",")) {
    const [name, value] = pair.split("=");
    const score = Number(value);
    if (!name?.trim() || !Number.isInteger(score) || score < 1 || score > 5)
      throw new Error(`Rubric entry "${pair}" must be name=<integer 1-5>.`);
    rubric[name.trim()] = score;
  }
  return rubric;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const baseUrl = options.base ?? `http://127.0.0.1:${process.env.AGENT_HARNESS_PORT ?? 4310}`;
  const runtimeResponse = await fetch(`${baseUrl}/api/runtime/status`);
  if (!runtimeResponse.ok)
    throw new Error(
      `The harness API at ${baseUrl} returned ${runtimeResponse.status}. Start it with \`npm run dev:api\` first.`,
    );
  const { csrfToken } = await runtimeResponse.json();
  if (!csrfToken) throw new Error("The runtime status document carried no CSRF token.");

  const body = {
    score: options.score,
    outcome: options.outcome,
    notes: options.notes,
    kind: options.kind,
    ...(options.evaluator ? { evaluator: options.evaluator } : {}),
    ...(options.suiteId ? { suiteId: options.suiteId } : {}),
    ...(options.caseId ? { caseId: options.caseId } : {}),
    ...(parseRubric(options.rubric) ? { rubric: parseRubric(options.rubric) } : {}),
  };
  const response = await fetch(`${baseUrl}/api/tasks/${encodeURIComponent(options.task)}/evaluation`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-agent-harness-csrf": csrfToken },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error ?? `HTTP ${response.status}`);
  const recorded = payload.task?.evaluation?.scores?.[options.kind];
  console.log(
    `Recorded ${options.kind} score ${recorded?.score ?? options.score}/5 (${recorded?.outcome ?? options.outcome}) on ${options.task}.`,
  );
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
