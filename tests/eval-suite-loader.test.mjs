import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadSuite } from "../evals/lib/suite.mjs";
import { loadVariants } from "../evals/lib/variants.mjs";
import { defaultRuntimeSettings } from "../server/model-catalog.mjs";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const SETTINGS = defaultRuntimeSettings();
const ALLOWED_MODELS = SETTINGS.allowedModels;

// A minimal, self-contained catalogue — independent of whatever the ambient Codex install
// happens to report — so the validation-edge-case tests below are deterministic.
const FAKE_CATALOG = {
  models: [
    { id: "gpt-5.6-sol", editable: true, reasoningLevels: ["high", "xhigh"], label: "GPT-5.6 Sol" },
    { id: "gpt-5.6-luna", editable: true, reasoningLevels: ["medium", "xhigh"], label: "GPT-5.6 Luna" },
    { id: "claude-sonnet-5", editable: true, reasoningLevels: ["high", "xhigh"], label: "Claude Sonnet 5" },
    { id: "not-editable-model", editable: false, reasoningLevels: ["high"], label: "Unreported" },
  ],
};
const FAKE_ALLOWED_MODELS = ["gpt-5.6-sol", "gpt-5.6-luna", "claude-sonnet-5"];

const FULL_MATRIX = {
  triage: { model: "gpt-5.6-luna", reasoning: "xhigh" },
  scouts: { model: "gpt-5.6-luna", reasoning: "xhigh" },
  grill: { model: "gpt-5.6-luna", reasoning: "xhigh" },
  specification: { model: "gpt-5.6-luna", reasoning: "xhigh" },
  plan: { model: "gpt-5.6-sol", reasoning: "high" },
  implement: { model: "gpt-5.6-luna", reasoning: "xhigh" },
  repair: { model: "gpt-5.6-sol", reasoning: "high" },
  "dev-review": { model: "gpt-5.6-sol", reasoning: "high" },
  test: { model: "gpt-5.6-luna", reasoning: "xhigh" },
  "final-review": { model: "gpt-5.6-luna", reasoning: "xhigh" },
};

async function withTempDir(run) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "eval-suite-loader-"));
  try {
    return await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function writeJson(filePath, value) {
  await writeFile(filePath, JSON.stringify(value, null, 2), "utf8");
}

// --- loadSuite: the checked-in example file -------------------------------------------------

test("loadSuite loads the checked-in core suite", async () => {
  const suite = await loadSuite(path.join(REPO_ROOT, "evals", "suites", "core.json"));
  assert.equal(suite.suiteId, "core");
  assert.equal(suite.repositoryPath, REPO_ROOT);
  assert.match(suite.frozenBaseSha, /^[0-9a-f]{40}$/);
  assert.deepEqual(suite.verificationCommands, ["npm run lint", "npm run typecheck", "npm test"]);
  assert.equal(suite.cases.length, 6);

  const singlePackage = suite.cases.filter((item) => item.shape === "single-package");
  const multiPackage = suite.cases.filter((item) => item.shape === "multi-package");
  assert.equal(singlePackage.length, 4, "two copy/style cases plus two logic cases");
  assert.equal(multiPackage.length, 2);

  const withOwnVerification = suite.cases.filter(
    (item) => JSON.stringify(item.verificationCommands) !== JSON.stringify(suite.verificationCommands),
  );
  assert.equal(withOwnVerification.length, 2, "the two logic cases carry their own verification command");

  const inherited = suite.cases.find((item) => item.caseId === "readme-quickstart-wording");
  assert.deepEqual(inherited.verificationCommands, suite.verificationCommands, "null inherits the suite list");
  assert.equal(inherited.attachments.length, 0);
  const caseIds = new Set(suite.cases.map((item) => item.caseId));
  assert.equal(caseIds.size, 6, "every caseId is unique");
});

// --- loadSuite: validation --------------------------------------------------------------------

test("loadSuite rejects an unknown top-level field", async () => {
  await withTempDir(async (directory) => {
    const suitePath = path.join(directory, "suite.json");
    await writeJson(suitePath, {
      schemaVersion: 1,
      suiteId: "broken",
      repositoryPath: ".",
      frozenBaseSha: "a".repeat(40),
      verificationCommands: ["npm test"],
      cases: [],
      notAField: true,
    });
    await assert.rejects(() => loadSuite(suitePath), /unknown field: "notAField"/);
  });
});

test("loadSuite reads and base64-encodes an attachment relative to the suite file", async () => {
  await withTempDir(async (directory) => {
    await writeFile(path.join(directory, "fixture.png"), Buffer.from([1, 2, 3, 4]));
    const suitePath = path.join(directory, "suite.json");
    await writeJson(suitePath, {
      schemaVersion: 1,
      suiteId: "with-attachment",
      repositoryPath: ".",
      frozenBaseSha: "b".repeat(40),
      verificationCommands: ["npm test"],
      cases: [
        {
          caseId: "one",
          shape: "single-package",
          title: "A case with an attachment",
          description: "Exercises attachment loading.",
          workflow: "implement",
          workflowProfile: "auto",
          attachments: [{ path: "fixture.png" }],
          acceptanceCriteria: ["done"],
          verificationCommands: null,
        },
      ],
    });
    const suite = await loadSuite(suitePath);
    const [attachment] = suite.cases[0].attachments;
    assert.equal(attachment.name, "fixture.png");
    assert.equal(attachment.type, "image/png");
    assert.equal(attachment.size, 4);
    assert.equal(Buffer.from(attachment.data, "base64").toString("hex"), "01020304");
  });
});

test("loadSuite rejects an attachment type the create route would reject", async () => {
  await withTempDir(async (directory) => {
    await writeFile(path.join(directory, "fixture.exe"), Buffer.from([1, 2, 3, 4]));
    const suitePath = path.join(directory, "suite.json");
    await writeJson(suitePath, {
      schemaVersion: 1,
      suiteId: "with-bad-attachment",
      repositoryPath: ".",
      frozenBaseSha: "c".repeat(40),
      verificationCommands: ["npm test"],
      cases: [
        {
          caseId: "one",
          shape: "single-package",
          title: "A case with a disallowed attachment",
          description: "Exercises the reused validateAttachments check.",
          workflow: "implement",
          workflowProfile: "auto",
          attachments: [{ path: "fixture.exe" }],
          acceptanceCriteria: ["done"],
          verificationCommands: null,
        },
      ],
    });
    await assert.rejects(() => loadSuite(suitePath), /must be HTML, an image, or a ZIP file/);
  });
});

test("loadSuite rejects an invalid workflow and an invalid shape by naming the field", async () => {
  await withTempDir(async (directory) => {
    const base = {
      schemaVersion: 1,
      suiteId: "invalid",
      repositoryPath: ".",
      frozenBaseSha: "d".repeat(40),
      verificationCommands: ["npm test"],
    };
    const badWorkflowPath = path.join(directory, "bad-workflow.json");
    await writeJson(badWorkflowPath, {
      ...base,
      cases: [
        {
          caseId: "one",
          shape: "single-package",
          title: "t",
          description: "d",
          workflow: "not-a-real-workflow",
          workflowProfile: "auto",
          attachments: [],
          acceptanceCriteria: ["done"],
          verificationCommands: null,
        },
      ],
    });
    await assert.rejects(() => loadSuite(badWorkflowPath), /\.workflow must be one of/);

    const badShapePath = path.join(directory, "bad-shape.json");
    await writeJson(badShapePath, {
      ...base,
      cases: [
        {
          caseId: "one",
          shape: "medium-package",
          title: "t",
          description: "d",
          workflow: "implement",
          workflowProfile: "auto",
          attachments: [],
          acceptanceCriteria: ["done"],
          verificationCommands: null,
        },
      ],
    });
    await assert.rejects(() => loadSuite(badShapePath), /\.shape must be one of/);
  });
});

// --- loadVariants: the checked-in example file ------------------------------------------------

test("loadVariants loads the checked-in role-sweep variants against the real model catalog", async () => {
  const { readExecutionProviderCatalog } = await import("../server/model-catalog.mjs");
  const catalog = await readExecutionProviderCatalog();
  const { baselineId, variants } = await loadVariants(
    path.join(REPO_ROOT, "evals", "variants", "role-sweep.json"),
    { catalog, allowedModels: ALLOWED_MODELS },
  );
  assert.equal(baselineId, "codex-hybrid");
  assert.equal(variants.size, 11, "baseline plus one override per of the ten roles");
  const baseline = variants.get("codex-hybrid");
  assert.equal(Object.keys(baseline).length, 10);
  assert.equal(baseline.plan.model, "gpt-5.6-sol");

  const swap = variants.get("sonnet-implement");
  assert.equal(swap.implement.model, "claude-sonnet-5");
  assert.equal(swap.implement.reasoning, "xhigh");
  // Every other role stays identical to the baseline it extends.
  for (const role of Object.keys(baseline)) {
    if (role === "implement") continue;
    assert.deepEqual(swap[role], baseline[role], `${role} is inherited from the baseline unchanged`);
  }
});

// --- loadVariants: validation, against a fixed fake catalog ------------------------------------

test("loadVariants rejects a matrix missing a role, naming the role", async () => {
  await withTempDir(async (directory) => {
    const variantsPath = path.join(directory, "variants.json");
    const incomplete = { ...FULL_MATRIX };
    delete incomplete.repair;
    await writeJson(variantsPath, {
      schemaVersion: 1,
      baselineId: "baseline",
      variants: { baseline: { matrix: incomplete } },
    });
    await assert.rejects(
      () => loadVariants(variantsPath, { catalog: FAKE_CATALOG, allowedModels: FAKE_ALLOWED_MODELS }),
      /missing role: "repair"/,
    );
  });
});

test("loadVariants rejects an unknown model, naming the role", async () => {
  await withTempDir(async (directory) => {
    const variantsPath = path.join(directory, "variants.json");
    await writeJson(variantsPath, {
      schemaVersion: 1,
      baselineId: "baseline",
      variants: {
        baseline: {
          matrix: { ...FULL_MATRIX, implement: { model: "gpt-nonexistent", reasoning: "xhigh" } },
        },
      },
    });
    await assert.rejects(
      () => loadVariants(variantsPath, { catalog: FAKE_CATALOG, allowedModels: FAKE_ALLOWED_MODELS }),
      /implement must use an allowed model/,
    );
  });
});

test("loadVariants rejects a model outside the allow-list even if the catalog knows it", async () => {
  await withTempDir(async (directory) => {
    const variantsPath = path.join(directory, "variants.json");
    await writeJson(variantsPath, {
      schemaVersion: 1,
      baselineId: "baseline",
      variants: {
        baseline: {
          matrix: { ...FULL_MATRIX, test: { model: "not-editable-model", reasoning: "high" } },
        },
      },
    });
    await assert.rejects(
      () => loadVariants(variantsPath, { catalog: FAKE_CATALOG, allowedModels: FAKE_ALLOWED_MODELS }),
      /test must use an allowed model/,
    );
  });
});

test("loadVariants rejects a two-level extends chain, naming the field", async () => {
  await withTempDir(async (directory) => {
    const variantsPath = path.join(directory, "variants.json");
    await writeJson(variantsPath, {
      schemaVersion: 1,
      baselineId: "baseline",
      variants: {
        baseline: { matrix: FULL_MATRIX },
        middle: {
          extends: "baseline",
          override: { plan: { model: "claude-sonnet-5", reasoning: "xhigh" } },
        },
        leaf: {
          extends: "middle",
          override: { implement: { model: "claude-sonnet-5", reasoning: "xhigh" } },
        },
      },
    });
    await assert.rejects(
      () => loadVariants(variantsPath, { catalog: FAKE_CATALOG, allowedModels: FAKE_ALLOWED_MODELS }),
      /variants\.variants\["leaf"\]\.extends/,
    );
  });
});

test("loadVariants rejects an unknown top-level field, naming the field", async () => {
  await withTempDir(async (directory) => {
    const variantsPath = path.join(directory, "variants.json");
    await writeJson(variantsPath, {
      schemaVersion: 1,
      baselineId: "baseline",
      variants: { baseline: { matrix: FULL_MATRIX } },
      extraField: true,
    });
    await assert.rejects(
      () => loadVariants(variantsPath, { catalog: FAKE_CATALOG, allowedModels: FAKE_ALLOWED_MODELS }),
      /unknown field: "extraField"/,
    );
  });
});
