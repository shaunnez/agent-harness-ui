import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { main } from "../scripts/eval.mjs";

// WP6 (docs/model-evaluation-plan.md section 5): `scripts/eval.mjs` only decides a campaign id
// and forwards flags to the three already-tested stages (WP3/WP4/WP5's own scripts), so these
// tests fake all three stages and assert the sequencing, the shared campaign id, and argument
// forwarding — no live companion, git, or model is involved.

async function withFixtures(t, { suiteId = "core", baselineId = "codex-hybrid" } = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "eval-entry-point-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const suitePath = path.join(dir, "suite.json");
  const variantsPath = path.join(dir, "variants.json");
  await writeFile(suitePath, JSON.stringify({ suiteId }), "utf8");
  await writeFile(variantsPath, JSON.stringify({ baselineId }), "utf8");
  return { suitePath, variantsPath };
}

function fakeStages(calls) {
  return {
    runSuite: async (argv) => {
      calls.push(["suite", argv]);
    },
    runJudge: async (argv) => {
      calls.push(["judge", argv]);
    },
    runReport: async (argv) => {
      calls.push(["report", argv]);
    },
  };
}

function flagValue(argv, flag) {
  const index = argv.indexOf(flag);
  return index === -1 ? undefined : argv[index + 1];
}

test("runs the suite, judge, and report stages in order under one shared campaign id", async (t) => {
  const { suitePath, variantsPath } = await withFixtures(t);
  const calls = [];
  const stages = fakeStages(calls);

  await main(["--suite", suitePath, "--variants", variantsPath], stages);

  assert.deepEqual(
    calls.map(([stage]) => stage),
    ["suite", "judge", "report"],
  );
  const [[, suiteArgv], [, judgeArgv], [, reportArgv]] = calls;
  const campaignId = flagValue(suiteArgv, "--resume");
  assert.match(campaignId, /^core-\d{8}T\d{6}Z$/);
  assert.equal(flagValue(judgeArgv, "--campaign"), campaignId);
  assert.equal(flagValue(reportArgv, "--campaign"), campaignId);
  assert.equal(flagValue(reportArgv, "--baseline"), "codex-hybrid");
  assert.equal(flagValue(suiteArgv, "--suite"), suitePath);
  assert.equal(flagValue(suiteArgv, "--variants"), variantsPath);
  assert.equal(flagValue(judgeArgv, "--suite"), suitePath);
});

test("--skip-judge skips the judge stage but still runs suite and report", async (t) => {
  const { suitePath, variantsPath } = await withFixtures(t);
  const calls = [];
  const stages = fakeStages(calls);

  await main(["--suite", suitePath, "--variants", variantsPath, "--skip-judge"], stages);

  assert.deepEqual(
    calls.map(([stage]) => stage),
    ["suite", "report"],
  );
});

test("--resume reuses the given campaign id instead of minting a new one", async (t) => {
  const { suitePath, variantsPath } = await withFixtures(t);
  const calls = [];
  const stages = fakeStages(calls);

  await main(["--suite", suitePath, "--variants", variantsPath, "--resume", "core-fixed-id"], stages);

  const [[, suiteArgv], [, judgeArgv], [, reportArgv]] = calls;
  assert.equal(flagValue(suiteArgv, "--resume"), "core-fixed-id");
  assert.equal(flagValue(judgeArgv, "--campaign"), "core-fixed-id");
  assert.equal(flagValue(reportArgv, "--campaign"), "core-fixed-id");
});

test("forwards --only-cases, --only-variants, and --api/--worktree-root to the suite stage", async (t) => {
  const { suitePath, variantsPath } = await withFixtures(t);
  const calls = [];
  const stages = fakeStages(calls);

  await main(
    [
      "--suite",
      suitePath,
      "--variants",
      variantsPath,
      "--only-cases",
      "a,b",
      "--only-variants",
      "x",
      "--api",
      "http://127.0.0.1:9999",
      "--worktree-root",
      "/tmp/wt",
      "--concurrency",
      "3",
      "--timeout-minutes",
      "5",
    ],
    stages,
  );

  const [[, suiteArgv]] = calls;
  assert.equal(flagValue(suiteArgv, "--only-cases"), "a,b");
  assert.equal(flagValue(suiteArgv, "--only-variants"), "x");
  assert.equal(flagValue(suiteArgv, "--api"), "http://127.0.0.1:9999");
  assert.equal(flagValue(suiteArgv, "--worktree-root"), "/tmp/wt");
  assert.equal(flagValue(suiteArgv, "--concurrency"), "3");
  assert.equal(flagValue(suiteArgv, "--timeout-minutes"), "5");
});

test("forwards --judge-model and --judge-reasoning to the judge stage only when given", async (t) => {
  const { suitePath, variantsPath } = await withFixtures(t);
  const calls = [];
  const stages = fakeStages(calls);

  await main(
    ["--suite", suitePath, "--variants", variantsPath, "--judge-model", "claude-sonnet-5", "--judge-reasoning", "high"],
    stages,
  );

  const [, [, judgeArgv]] = calls;
  assert.equal(flagValue(judgeArgv, "--judge-model"), "claude-sonnet-5");
  assert.equal(flagValue(judgeArgv, "--judge-reasoning"), "high");
});

test("a failing suite stage stops the pipeline before judge or report run", async (t) => {
  const { suitePath, variantsPath } = await withFixtures(t);
  const calls = [];
  const stages = {
    runSuite: async () => {
      throw new Error("companion unreachable");
    },
    runJudge: async (argv) => calls.push(["judge", argv]),
    runReport: async (argv) => calls.push(["report", argv]),
  };

  await assert.rejects(
    main(["--suite", suitePath, "--variants", variantsPath], stages),
    /companion unreachable/,
  );
  assert.deepEqual(calls, []);
});

test("requires --suite and --variants", async () => {
  await assert.rejects(main(["--variants", "v.json"], fakeStages([])), /--suite is required/);
  await assert.rejects(main(["--suite", "s.json"], fakeStages([])), /--variants is required/);
});

test("rejects a suite file with no suiteId field", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "eval-entry-point-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const suitePath = path.join(dir, "suite.json");
  const variantsPath = path.join(dir, "variants.json");
  await writeFile(suitePath, JSON.stringify({}), "utf8");
  await writeFile(variantsPath, JSON.stringify({ baselineId: "codex-hybrid" }), "utf8");

  await assert.rejects(
    main(["--suite", suitePath, "--variants", variantsPath], fakeStages([])),
    /no "suiteId" string field/,
  );
});
