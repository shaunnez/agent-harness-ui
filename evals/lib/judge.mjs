// Blind judge for the eval runner (WP4, docs/model-evaluation-plan.md section 5). Scores every
// `bundle/<label>/` a campaign (WP3) exported, without ever letting the model that judges a
// candidate see which variant, model, or task produced it. `scripts/judge-eval-campaign.mjs` is
// the thin CLI wrapper; everything that builds a prompt, calls a provider, and posts a score
// lives here so it can be exercised directly in `tests/eval-judge.test.mjs`.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseJudgeVerdict } from "../../server/structured-output.mjs";
import { resolveExecutionProvider } from "../../server/execution-providers.mjs";
import { normalizeModelId, providerForModelId } from "../../server/model-catalog.mjs";
import { addDetachedWorktree } from "./campaign.mjs";

export const DEFAULT_JUDGE_MODEL = "claude-opus-5";
export const DEFAULT_JUDGE_REASONING = "high";

/**
 * Builds the judge's prompt from bundle content only. Deliberately takes no `taskId`,
 * `variantId`, model name, or `.data/` path as a parameter — the plan (section 5, WP4)
 * requires the prompt to carry none of those, and the simplest way to guarantee that is for
 * this function to have nothing to leak in the first place.
 */
export function buildJudgePrompt({ brief, acceptance, verification, patch }) {
  return [
    "You are a blind quality judge scoring one completed engineering task. You do not know, and must not",
    "guess at, which model, tool, or person produced this change — score only what is in front of you.",
    "",
    "You are given the task brief, its acceptance criteria, the verification command output the harness",
    "observed when it ran the repository's own verification commands, and the exact code change as a",
    "unified diff. You may also read surrounding files in your working directory for context.",
    "",
    "Score strictly against the acceptance criteria and the diff. Do not reward a style you merely",
    "prefer over another correct one, and do not infer authorship or tooling from coding style.",
    "",
    "## Brief",
    brief.trim(),
    "",
    "## Acceptance criteria",
    acceptance.trim(),
    "",
    "## Verification output",
    verification.trim(),
    "",
    "## Candidate diff",
    "```diff",
    patch.trim(),
    "```",
    "",
    "Return exactly one JSON object between <eval-judgment> and </eval-judgment> tags, shaped like:",
    '{ "score": <1-5>, "criteria": [{ "text": "<criterion, verbatim>", "met": true|false, "evidence": "<short evidence>" }], "defects": ["<short defect description>"], "notes": "<one paragraph>" }',
    "Include exactly one criteria entry per acceptance criterion above, in the same order. List every",
    "genuine defect you find, even a non-blocking one. Nothing outside the tags will be read.",
  ].join("\n");
}

/** `resolveExecutionProvider(...).run(...)` — the same call shape `orchestrator-runtime-boundaries.mjs`
 * uses for its own operator-initiated, non-task-bound provider calls (`proposeOnboarding`,
 * `verifyPricing`): a plain `{ cwd, prompt, sandbox, model, reasoning, timeoutMs }` request, no
 * task record or run reservation required. */
export async function defaultRunAgent({ cwd, prompt, model, reasoning, sandbox = "read-only", timeoutMs }) {
  const providerId = providerForModelId(model);
  if (!providerId) throw new Error(`No execution provider claims judge model ${model}.`);
  return resolveExecutionProvider(providerId).run({ cwd, prompt, sandbox, model, reasoning, timeoutMs });
}

function rubricFromCriteria(criteria) {
  const rubric = {};
  const seen = new Map();
  for (const criterion of criteria) {
    let key = criterion.text.slice(0, 80) || "criterion";
    const count = (seen.get(key) ?? 0) + 1;
    seen.set(key, count);
    if (count > 1) key = `${key} (${count})`.slice(0, 80);
    rubric[key] = criterion.met ? 5 : 1;
  }
  return rubric;
}

function deriveOutcome(judgment) {
  if (judgment.defects.length === 0 && judgment.criteria.every((criterion) => criterion.met)) return "accepted";
  if (judgment.score <= 2) return "rejected";
  return "mixed";
}

/** Every model any run in this campaign actually requested or actually used, so the judge can
 * refuse to also be one of the models under test (plan section 5, WP4). */
function modelsUnderTest(manifest) {
  const models = new Set();
  for (const run of manifest.runs ?? []) {
    for (const matrix of [run.policyMatrix, run.requestedPolicyMatrix]) {
      if (!matrix || typeof matrix !== "object") continue;
      for (const policy of Object.values(matrix)) {
        if (policy?.model) models.add(normalizeModelId(policy.model));
      }
    }
  }
  return models;
}

async function readJsonFile(filePath, fallback) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT" && fallback !== undefined) return fallback;
    throw error;
  }
}

async function readBundle(bundleDir) {
  const [brief, acceptance, verification] = await Promise.all([
    readFile(path.join(bundleDir, "brief.md"), "utf8"),
    readFile(path.join(bundleDir, "acceptance.md"), "utf8"),
    readFile(path.join(bundleDir, "verification.txt"), "utf8"),
  ]);
  const patch = await readFile(path.join(bundleDir, "candidate.patch"), "utf8").catch((error) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  return { brief, acceptance, verification, patch };
}

/**
 * Scores every exported bundle in one campaign and posts each valid verdict as a blind
 * evaluation. Mirrors `runEvalCampaign` (WP3, `evals/lib/campaign.mjs`) in spirit: never throws
 * for an ordinary per-bundle outcome (no patch, malformed judge output) — those are recorded in
 * `judge/<label>.json` and the returned `results`, and scoring continues with the next bundle. A
 * thrown error means the campaign itself could not be judged at all (missing manifest, or the
 * judge model is one of the models under test).
 */
export async function runJudgeCampaign({
  dataRoot = path.join(".data", "evaluations"),
  campaignId,
  client,
  judgeModel = DEFAULT_JUDGE_MODEL,
  judgeReasoning = DEFAULT_JUDGE_REASONING,
  runAgent = defaultRunAgent,
  suite = null,
  worktreeRoot = path.join(".data", "evaluations", "worktrees"),
  addWorktree = addDetachedWorktree,
  fallbackCwd = process.cwd(),
  onlyLabels = null,
  timeoutMs = 600_000,
}) {
  if (!campaignId) throw new Error("runJudgeCampaign requires a campaignId.");
  const campaignDir = path.join(dataRoot, campaignId);
  const manifestPath = path.join(campaignDir, "manifest.json");
  const manifest = await readJsonFile(manifestPath);

  const judgeModelId = normalizeModelId(judgeModel);
  const underTest = modelsUnderTest(manifest);
  if (underTest.has(judgeModelId)) {
    throw new Error(
      `Judge model ${judgeModel} is one of the models under test in campaign ${campaignId}; choose a different judge model.`,
    );
  }

  // Read once, up front: a bundle-to-task lookup that never touches the prompt-building path
  // below. `variant-map.json` (section 4.3) is "kept out of the blind bundle" on purpose, and
  // this only ever reads it to double-check `manifest.json`'s own record agrees — it is never
  // consulted while a prompt is being assembled.
  const variantMap = await readJsonFile(path.join(campaignDir, "variant-map.json"), {});

  let cwd = fallbackCwd;
  if (suite) {
    const worktreePath = path.join(worktreeRoot, `${campaignId}-judge`);
    await addWorktree({ repositoryPath: suite.repositoryPath, worktreePath, sha: suite.frozenBaseSha });
    cwd = worktreePath;
  }

  const judgeDir = path.join(campaignDir, "judge");
  await mkdir(judgeDir, { recursive: true });

  const runs = (manifest.runs ?? []).filter(
    (run) => run.bundleLabel && (!onlyLabels || onlyLabels.includes(run.bundleLabel)),
  );

  const results = [];
  for (const run of runs) {
    if (variantMap[run.taskId] && variantMap[run.taskId] !== run.variantId) {
      throw new Error(
        `variant-map.json disagrees with manifest.json about task ${run.taskId}'s variant; refusing to judge.`,
      );
    }
    const bundleDir = path.join(campaignDir, "bundle", run.bundleLabel);
    const bundle = await readBundle(bundleDir);
    if (!bundle.patch) {
      results.push({ label: run.bundleLabel, caseId: run.caseId, judgeStatus: "no-patch", posted: false });
      continue;
    }

    // Everything from here to `parseJudgeVerdict` sees only bundle content — no caseId,
    // variantId, taskId, or model name is in scope, so none of it can leak into the prompt.
    const prompt = buildJudgePrompt(bundle);
    let record;
    try {
      const agentResult = await runAgent({
        cwd,
        prompt,
        model: judgeModel,
        reasoning: judgeReasoning,
        sandbox: "read-only",
        timeoutMs,
      });
      const judgment = parseJudgeVerdict(agentResult.finalText);
      record = { judgeStatus: "valid", judgedAt: new Date().toISOString(), ...judgment };
    } catch (error) {
      record = { judgeStatus: "invalid", judgedAt: new Date().toISOString(), error: error.message };
    }
    await writeFile(path.join(judgeDir, `${run.bundleLabel}.json`), JSON.stringify(record, null, 2), "utf8");

    let posted = false;
    if (record.judgeStatus === "valid" && client) {
      await client.postEvaluation(run.taskId, {
        kind: "blind",
        score: record.score,
        rubric: rubricFromCriteria(record.criteria),
        outcome: deriveOutcome(record),
        evaluator: `judge:${judgeModel}`,
        suiteId: manifest.suiteId ?? null,
        caseId: run.caseId,
        notes: record.notes,
      });
      posted = true;
    }
    results.push({
      label: run.bundleLabel,
      caseId: run.caseId,
      taskId: run.taskId,
      judgeStatus: record.judgeStatus,
      score: record.score ?? null,
      posted,
    });
  }

  manifest.judgeModel = judgeModel;
  manifest.judgedAt = new Date().toISOString();
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");

  return { manifest, manifestPath, results };
}
