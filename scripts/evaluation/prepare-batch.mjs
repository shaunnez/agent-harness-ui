import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, mkdir, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { readExecutionProviderCatalog } from "../../server/model-catalog.mjs";
import { formatArgv, parseVerificationManifest } from "../../server/verification.mjs";
import { DEFAULT_REPAIR_LIMITS } from "../../src/repair-limits.ts";
import { loadEvaluationCase } from "./case-contract.mjs";
import { CODEX_6_IMPLEMENT_COMPARISON, H05_CODEX_COMPARISON } from "./h05-codex-comparison.mjs";
import { H06_MEDIUM_PROVIDER_COMPARISON } from "./medium-provider-comparison.mjs";

const exec = promisify(execFile);
const root = fileURLToPath(new URL("../../", import.meta.url));
const [campaignRoot, publicRoot, sourceRepository, mode = "prepare", caseId = "H02"] = process.argv.slice(2);
if (
  !campaignRoot ||
  !publicRoot ||
  !sourceRepository ||
  ![
    "prepare",
    "dry-run",
    "feasibility",
    "codex-comparison",
    "codex-6-comparison",
    "medium-provider-comparison",
  ].includes(mode)
)
  throw new Error(
    "Usage: prepare-batch.mjs <new-private-root> <new-public-root> <source-repository> [dry-run|feasibility|codex-comparison|codex-6-comparison|medium-provider-comparison] [H02|H05|H06]",
  );
const read = (relative) => readFile(path.join(root, relative), "utf8");
const git = (cwd, args) => exec("git", args, { cwd, maxBuffer: 30_000_000 });
const sha = (text) => createHash("sha256").update(text).digest("hex");
const selectedCase = await loadEvaluationCase(caseId);
const { item, contract, rubric } = selectedCase;
const comparisonMode = ["codex-comparison", "codex-6-comparison", "medium-provider-comparison"].includes(
  mode,
);
const comparison =
  mode === "medium-provider-comparison"
    ? H06_MEDIUM_PROVIDER_COMPARISON
    : mode === "codex-6-comparison"
      ? CODEX_6_IMPLEMENT_COMPARISON
      : H05_CODEX_COMPARISON;
if (mode === "codex-comparison" && caseId !== "H05")
  throw new Error("The historical Codex comparison is qualified only for H05.");
if (mode === "codex-6-comparison" && !["H02", "H05"].includes(caseId))
  throw new Error("The GPT-6 Codex comparison is qualified only for H02 and H05.");
if (mode === "medium-provider-comparison" && caseId !== "H06")
  throw new Error("The medium provider comparison is qualified only for H06.");
if (
  caseId !== "H02" &&
  ![
    "dry-run",
    "feasibility",
    "codex-comparison",
    "codex-6-comparison",
    "medium-provider-comparison",
  ].includes(mode)
)
  throw new Error("New cases support one trial only; no automatic comparison campaign.");
const incumbent = JSON.parse(await read("evaluations/incumbent-settings-snapshot.json"));
const policy = (model, reasoning = "high") => ({ model, reasoning });
const balanced = {
  triage: policy("gpt-5.6-luna"),
  scouts: policy("gpt-5.6-luna"),
  grill: policy("gpt-5.6-sol"),
  specification: policy("gpt-5.6-sol"),
  plan: policy("gpt-5.6-sol"),
  implement: policy("claude-sonnet-5"),
  repair: policy("claude-sonnet-5"),
  "dev-review": policy("gpt-5.6-sol"),
  test: policy("gpt-5.6-luna", "medium"),
  "final-review": policy("gpt-5.6-sol"),
};
const feasibility = mode === "feasibility" || caseId === "H05";
// Comparison arms pin their complete role matrix; the case fixes workflow depth.
const policies = comparisonMode
  ? comparison.policies
  : feasibility
    ? { balanced }
    : {
        incumbent: incumbent.profileStagePolicies["high-risk"],
        balanced,
        "astra-plan": { ...balanced, plan: policy("gpt-6-astra") },
      };
const catalog = await readExecutionProviderCatalog();
for (const matrix of Object.values(policies))
  for (const selected of Object.values(matrix)) {
    if (
      !catalog.models.some(
        (model) =>
          model.id === selected.model && model.editable && model.reasoningLevels.includes(selected.reasoning),
      )
    )
      throw new Error(`Unavailable frozen selection: ${JSON.stringify(selected)}`);
  }
const baseManifest = (
  await git(sourceRepository, ["show", `${item.baseSha}:.agent-harness/verification.json`])
).stdout;
const manifest = parseVerificationManifest(baseManifest);
const changed = (await git(root, ["status", "--porcelain"])).stdout;
if (mode !== "dry-run" && changed.trim())
  throw new Error("Commit the qualified harness before preparing an inference campaign.");
const harnessVersion = (await git(root, ["rev-parse", "HEAD"])).stdout.trim();
// User-selected quality-first allowances apply to every new evaluation mode.
// Retained campaigns keep their frozen limits; preparation never edits them.
const budget = {
  maxWallTimeMs: 7200000,
  maxTotalTokens: feasibility || comparisonMode ? 200000000 : 30000000,
};
const repairLimits = structuredClone(DEFAULT_REPAIR_LIMITS);
const stageTimeoutOverridesMs = Object.fromEntries(
  [
    "triage",
    "scouts",
    "grill",
    "specification",
    "plan",
    "implement",
    "repair",
    "dev-review",
    "test",
    "final-review",
  ].map((stage) => [stage, 3600000]),
);
const limits = { maxAgentRuns: 100, maxProviderInvocations: 1000 };
const order = comparisonMode
  ? comparison.trials.map((trial) => trial.variant)
  : feasibility
    ? ["balanced"]
    : [
        "incumbent",
        "balanced",
        "astra-plan",
        "balanced",
        "astra-plan",
        "incumbent",
        "astra-plan",
        "incumbent",
        "balanced",
      ];
const playwrightModule = process.env.EVAL_PLAYWRIGHT_MODULE
  ? await realpath(process.env.EVAL_PLAYWRIGHT_MODULE)
  : undefined;
if (mode !== "dry-run" && !playwrightModule)
  throw new Error("Freeze EVAL_PLAYWRIGHT_MODULE before preparing a campaign.");
const playwrightVersion = playwrightModule
  ? JSON.parse(await readFile(path.join(path.dirname(playwrightModule), "package.json"), "utf8")).version
  : "not-used-in-preflight";
const executable = async (name) => (await exec("which", [name])).stdout.trim();
const allowedProviders = comparisonMode ? [...comparison.allowedProviders] : ["codex", "claude"];
const executables = Object.fromEntries(
  await Promise.all(allowedProviders.map(async (provider) => [provider, await executable(provider)])),
);
const python = await executable("python3");
const versions = Object.fromEntries(
  await Promise.all(
    Object.entries(executables).map(async ([provider, cli]) => [
      provider,
      (await exec(cli, ["--version"])).stdout.trim(),
    ]),
  ),
);
const environment = {
  playwrightVersion,
  node: process.version,
  platform: process.platform,
  arch: process.arch,
  providers: versions,
  allowedProviders,
  packageConcurrency: 1,
  trialConcurrency: comparisonMode ? comparison.trialConcurrency : 1,
  gitSigning: "disabled only in isolated process/repositories",
  workflowProfile: selectedCase.workflowProfile,
  grill: "manual with frozen benchmark-user answers",
  stageTimeoutOverridesMs,
  repairLimits,
};
const deny = (paths) =>
  `(version 1)\n(allow default)\n${paths.map((entry) => `(deny file-read* (subpath ${JSON.stringify(entry)}))`).join("\n")}\n`;
const protectedPaths = [
  "/private/tmp/h-review-vault",
  ...(await readdir("/private/tmp"))
    .filter((entry) => entry.startsWith("h-review-") || entry.startsWith("h-eval-"))
    .map((entry) => path.join("/private/tmp", entry)),
  ...(await readdir(path.dirname(campaignRoot)))
    .filter((entry) => entry !== "tools")
    .map((entry) => path.join(path.dirname(campaignRoot), entry)),
  "/Users/shaun/projects",
  "/Users/shaun/.codex/model-evaluation",
  "/Users/shaun/.codex/memories",
  "/Users/shaun/.codex/sessions",
  "/Users/shaun/.claude/projects",
];
if (
  playwrightModule &&
  protectedPaths.some(
    (entry) => playwrightModule === entry || playwrightModule.startsWith(`${entry}${path.sep}`),
  )
)
  throw new Error("EVAL_PLAYWRIGHT_MODULE must be outside paths denied to the independent grader.");
await mkdir(campaignRoot);
await mkdir(publicRoot);
const trials = comparisonMode
  ? comparison.trials.map((trial) => ({ ...trial }))
  : order.map((variant, index) => ({
      id: `${feasibility ? "F" : "A"}${index + 1}`,
      variant,
      repetition: order.slice(0, index + 1).filter((value) => value === variant).length,
    }));
const freeze = {
  version: path.basename(campaignRoot),
  harnessVersion,
  caseId: item.id,
  baseSha: item.baseSha,
  caseVersion: `${caseId.toLowerCase()}-${sha(contract)}`,
  graderVersion: `${caseId.toLowerCase()}-${sha(await read(selectedCase.grader))}`,
  rubricVersion: `${rubric.version}-${sha(JSON.stringify(rubric))}`,
  environmentVersion: sha(JSON.stringify(environment)),
  executionVersion: comparisonMode
    ? mode === "medium-provider-comparison"
      ? "fixed-policy-native-permissions-v5-matched-provider-comparison"
      : "fixed-policy-native-permissions-v4-codex-provider-lock"
    : "fixed-policy-native-permissions-v3-package-repair",
  environment,
  budget,
  limits,
  stageTimeoutOverridesMs,
  repairLimits,
  policies,
  trials,
  brief: contract,
  manifest,
  primaryMetric: "autonomous-accepted-delivery-rate",
  maxWorkflowRuns: trials.length,
  mode,
  preparedAt: new Date().toISOString(),
};
await writeFile(path.join(campaignRoot, "freeze.json"), `${JSON.stringify(freeze, null, 2)}\n`);
for (const trial of trials) {
  const privateTrial = path.join(campaignRoot, trial.id);
  const publicTrial = path.join(publicRoot, trial.id);
  await mkdir(privateTrial);
  await mkdir(publicTrial);
  const repository = path.join(publicTrial, "repo");
  await mkdir(repository);
  await git(repository, ["init", "--quiet"]);
  await git(repository, [
    "fetch",
    "--quiet",
    "--depth=1",
    "--no-tags",
    pathToFileURL(await realpath(sourceRepository)).href,
    item.baseSha,
  ]);
  await git(repository, ["checkout", "--quiet", "-b", "evaluation-base", "FETCH_HEAD"]);
  await rm(path.join(repository, ".git/FETCH_HEAD"));
  await git(repository, ["config", "user.name", "Evaluation candidate"]);
  await git(repository, ["config", "user.email", "evaluation@example.invalid"]);
  await git(repository, ["config", "commit.gpgsign", "false"]);
  if (mode !== "dry-run") {
    const result = await exec("npm", ["ci", "--no-audit", "--no-fund"], {
      cwd: repository,
      maxBuffer: 10_000_000,
    });
    await writeFile(path.join(privateTrial, "npm-ci.log"), result.stdout + result.stderr);
  }
  const siblings = trials
    .filter((entry) => entry.id !== trial.id)
    .flatMap((entry) => [path.join(campaignRoot, entry.id), path.join(publicRoot, entry.id)]);
  const workerProfile = path.join(privateTrial, "worker.sb");
  await writeFile(
    workerProfile,
    deny([...protectedPaths, ...siblings, path.join(root, "evaluations"), path.join(root, "docs")]),
  );
  const providerProfile = path.join(privateTrial, "provider.sb");
  await writeFile(
    providerProfile,
    deny([...protectedPaths, ...siblings, campaignRoot, "/Users/shaun/.codex/worktrees"]),
  );
  const ledger = path.join(privateTrial, "provider-ledger.json");
  const guardConfig = path.join(privateTrial, "provider-config.json");
  await writeFile(
    guardConfig,
    JSON.stringify(
      {
        executables,
        allowedProviders,
        ledger,
        confinement: "native-provider",
        deniedReadPaths: [
          ...protectedPaths,
          ...siblings,
          path.dirname(campaignRoot),
          "/Users/shaun/.codex/worktrees",
        ],
        ...budget,
        ...limits,
      },
      null,
      2,
    ),
  );
  const wrappers = {};
  const preflight = await exec(process.execPath, [
    path.join(root, "scripts/evaluation/check-native-permissions.mjs"),
    guardConfig,
  ]);
  await writeFile(path.join(privateTrial, "native-permissions-preflight.json"), preflight.stdout);
  for (const provider of ["codex", "claude"]) {
    const wrapper = path.join(privateTrial, provider);
    const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
    await writeFile(
      wrapper,
      `#!/bin/sh\nexec ${[python, path.join(root, "scripts/evaluation/provider-guard.py"), guardConfig, provider].map(quote).join(" ")} "$@"\n`,
    );
    await chmod(wrapper, 0o700);
    wrappers[provider] = wrapper;
  }
  const config = {
    stageTimeoutOverridesMs,
    repairLimits,
    playwrightModule,
    trialId: trial.id,
    privateRoot: privateTrial,
    publicRoot: publicTrial,
    repository,
    ledger,
    workerProfile,
    codexWrapper: wrappers.codex,
    claudeWrapper: wrappers.claude,
    allowedModels: comparisonMode ? [...comparison.allowedModels] : incumbent.allowedModels,
    defaultModel: comparison.defaultModel,
    gatePolicies: incumbent.gatePolicies,
    answerSheet: contract,
    taskInput: {
      title: item.title,
      description: `${item.brief}\n\n${contract}`,
      repositoryPath: repository,
      workflow: "implement",
      priority: "medium",
      workflowProfile: selectedCase.workflowProfile,
      rolePolicyOverrides: policies[trial.variant],
      experiment: {
        groupId: `${caseId.toLowerCase()}-${path.basename(campaignRoot)}`,
        variantId: trial.variant,
        frozenBaseSha: item.baseSha,
        acceptanceCriteria: item.acceptanceCriteria,
        verificationCommands: manifest.commands.map((entry) => formatArgv(entry.command)),
        verificationManifest: manifest,
        decisionMetric: freeze.primaryMetric,
        budget,
        evaluationLimits: limits,
        evaluationContract: {
          caseId: item.id,
          ...Object.fromEntries(
            [
              "caseVersion",
              "graderVersion",
              "rubricVersion",
              "harnessVersion",
              "environmentVersion",
              "executionVersion",
            ].map((key) => [key, freeze[key]]),
          ),
          checkIds: selectedCase.checkIds,
        },
      },
    },
  };
  await writeFile(path.join(privateTrial, "config.json"), `${JSON.stringify(config, null, 2)}\n`);
}
console.log(JSON.stringify({ campaignRoot, publicRoot, trials: trials.length, mode, inferenceCalls: 0 }));
