import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildJudgePrompt, DEFAULT_JUDGE_MODEL, runJudgeCampaign } from "../evals/lib/judge.mjs";

// WP4 (docs/model-evaluation-plan.md section 5): the blind judge is exercised against fixture
// campaign output (no real harness, git, or model in the loop) and a fake `runAgent`/`client`,
// exactly like `tests/eval-runner.test.mjs` fakes the harness API for WP3.

const VALID_JUDGE_TEXT = [
  "Some preamble the model might add.",
  "<eval-judgment>",
  JSON.stringify({
    score: 4,
    criteria: [{ text: "README quick-start names the real dev command", met: true, evidence: "line 12" }],
    defects: [],
    notes: "Clean, minimal change.",
  }),
  "</eval-judgment>",
].join("\n");

async function makeCampaignFixture({ runs, campaignId = "core-20260101T000000Z" } = {}) {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), "eval-judge-test-"));
  const campaignDir = path.join(dataRoot, campaignId);
  const manifest = {
    schemaVersion: 1,
    campaignId,
    suiteId: "core",
    runs: runs ?? [
      {
        caseId: "copy-fix-readme",
        variantId: "codex-hybrid",
        taskId: "AH-001",
        terminalState: "awaiting-human-approval",
        bundleLabel: "abcdef",
        policyMatrix: { triage: { model: "gpt-5.6-luna", reasoning: "xhigh" } },
        requestedPolicyMatrix: { triage: { model: "gpt-5.6-luna", reasoning: "xhigh" } },
      },
    ],
  };
  await mkdir(campaignDir, { recursive: true });
  await writeFile(path.join(campaignDir, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
  const variantMap = Object.fromEntries(manifest.runs.map((run) => [run.taskId, run.variantId]));
  await writeFile(path.join(campaignDir, "variant-map.json"), JSON.stringify(variantMap, null, 2), "utf8");
  for (const run of manifest.runs) {
    if (!run.bundleLabel) continue;
    const bundleDir = path.join(campaignDir, "bundle", run.bundleLabel);
    await mkdir(bundleDir, { recursive: true });
    await writeFile(path.join(bundleDir, "brief.md"), "# Fix the README\n\nUpdate the quick-start.\n", "utf8");
    await writeFile(
      path.join(bundleDir, "acceptance.md"),
      "- README quick-start names the real dev command\n",
      "utf8",
    );
    await writeFile(path.join(bundleDir, "verification.txt"), "PASS  npm test\n\nOverall: passed (10ms)\n", "utf8");
    await writeFile(path.join(bundleDir, "candidate.patch"), "diff --git a/README.md b/README.md\n", "utf8");
  }
  return { dataRoot, campaignDir, campaignId, manifest };
}

function fakeClient() {
  const calls = [];
  return {
    calls,
    async postEvaluation(id, body) {
      calls.push({ id, body });
      return { id };
    },
  };
}

test("buildJudgePrompt never receives or leaks a task/variant/model identifier", () => {
  const prompt = buildJudgePrompt({
    brief: "# Fix the README\n\nUpdate the quick-start.",
    acceptance: "- README quick-start names the real dev command",
    verification: "PASS  npm test\n\nOverall: passed (10ms)",
    patch: "diff --git a/README.md b/README.md\n",
  });
  for (const forbidden of ["AH-001", "codex-hybrid", "gpt-5.6-luna", "claude-opus-5", ".data/"]) {
    assert.ok(!prompt.includes(forbidden), `prompt must not contain ${forbidden}`);
  }
  assert.ok(prompt.includes("<eval-judgment>"));
});

test("a valid judge verdict is recorded and posted as a blind evaluation", async (t) => {
  const { dataRoot, campaignDir, campaignId } = await makeCampaignFixture();
  t.after(() => rm(dataRoot, { recursive: true, force: true }));

  const client = fakeClient();
  const seenPrompts = [];
  const runAgent = async ({ prompt, model, reasoning, sandbox }) => {
    seenPrompts.push(prompt);
    assert.equal(model, DEFAULT_JUDGE_MODEL);
    assert.equal(reasoning, "high");
    assert.equal(sandbox, "read-only");
    return { finalText: VALID_JUDGE_TEXT, usage: {} };
  };

  const { results, manifest } = await runJudgeCampaign({ dataRoot, campaignId, client, runAgent });

  assert.equal(results.length, 1);
  assert.equal(results[0].judgeStatus, "valid");
  assert.equal(results[0].score, 4);
  assert.equal(results[0].posted, true);
  assert.equal(manifest.judgeModel, DEFAULT_JUDGE_MODEL);
  assert.ok(manifest.judgedAt);

  assert.equal(client.calls.length, 1);
  const [{ id, body }] = client.calls;
  assert.equal(id, "AH-001");
  assert.equal(body.kind, "blind");
  assert.equal(body.score, 4);
  assert.equal(body.suiteId, "core");
  assert.equal(body.caseId, "copy-fix-readme");
  assert.equal(body.evaluator, `judge:${DEFAULT_JUDGE_MODEL}`);
  assert.equal(body.outcome, "accepted");
  assert.deepEqual(body.rubric, { "README quick-start names the real dev command": 5 });

  // Never included in the actual model call, not just the unit-tested prompt builder.
  for (const forbidden of ["AH-001", "codex-hybrid", "gpt-5.6-luna"]) {
    assert.ok(!seenPrompts[0].includes(forbidden));
  }

  const judgeRecord = JSON.parse(await readFile(path.join(campaignDir, "judge", "abcdef.json"), "utf8"));
  assert.equal(judgeRecord.judgeStatus, "valid");
  assert.equal(judgeRecord.score, 4);

  const persistedManifest = JSON.parse(await readFile(path.join(campaignDir, "manifest.json"), "utf8"));
  assert.equal(persistedManifest.judgeModel, DEFAULT_JUDGE_MODEL);
});

test("malformed judge output is rejected, recorded as invalid, and never posted", async (t) => {
  const { dataRoot, campaignDir, campaignId } = await makeCampaignFixture();
  t.after(() => rm(dataRoot, { recursive: true, force: true }));

  const client = fakeClient();
  const runAgent = async () => ({ finalText: "no tags here at all", usage: {} });

  const { results } = await runJudgeCampaign({ dataRoot, campaignId, client, runAgent });

  assert.equal(results.length, 1);
  assert.equal(results[0].judgeStatus, "invalid");
  assert.equal(results[0].posted, false);
  assert.equal(client.calls.length, 0);

  const judgeRecord = JSON.parse(await readFile(path.join(campaignDir, "judge", "abcdef.json"), "utf8"));
  assert.equal(judgeRecord.judgeStatus, "invalid");
  assert.ok(judgeRecord.error);
});

test("a bundle with no candidate.patch is skipped and never posted", async (t) => {
  const { dataRoot, campaignId, campaignDir } = await makeCampaignFixture();
  await rm(path.join(campaignDir, "bundle", "abcdef", "candidate.patch"));
  t.after(() => rm(dataRoot, { recursive: true, force: true }));

  const client = fakeClient();
  const runAgent = async () => {
    throw new Error("must not be called when there is no patch");
  };

  const { results } = await runJudgeCampaign({ dataRoot, campaignId, client, runAgent });

  assert.equal(results.length, 1);
  assert.equal(results[0].judgeStatus, "no-patch");
  assert.equal(results[0].posted, false);
  assert.equal(client.calls.length, 0);
});

test("refuses to run when the judge model is one of the models under test", async (t) => {
  const { dataRoot, campaignId } = await makeCampaignFixture({
    runs: [
      {
        caseId: "copy-fix-readme",
        variantId: "implement-opus",
        taskId: "AH-002",
        terminalState: "awaiting-human-approval",
        bundleLabel: "ghijkl",
        policyMatrix: { implement: { model: "claude-opus-5", reasoning: "high" } },
        requestedPolicyMatrix: { implement: { model: "claude-opus-5", reasoning: "high" } },
      },
    ],
  });
  t.after(() => rm(dataRoot, { recursive: true, force: true }));

  const client = fakeClient();
  const runAgent = async () => {
    throw new Error("must not be called when the judge model is under test");
  };

  await assert.rejects(
    () => runJudgeCampaign({ dataRoot, campaignId, client, runAgent, judgeModel: "claude-opus-5" }),
    /one of the models under test/,
  );
  assert.equal(client.calls.length, 0);
});

test("never calls approve-merge, open-pr, or complete-merged", async (t) => {
  const { dataRoot, campaignId } = await makeCampaignFixture();
  t.after(() => rm(dataRoot, { recursive: true, force: true }));

  const calledActions = [];
  const client = {
    async postEvaluation(id, body) {
      calledActions.push("postEvaluation");
      return { id, body };
    },
  };
  const runAgent = async () => ({ finalText: VALID_JUDGE_TEXT, usage: {} });

  await runJudgeCampaign({ dataRoot, campaignId, client, runAgent });

  assert.deepEqual(calledActions, ["postEvaluation"]);
  assert.ok(!calledActions.some((action) => ["approve-merge", "open-pr", "complete-merged"].includes(action)));
});
