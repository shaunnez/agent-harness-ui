#!/usr/bin/env node
/**
 * Manifest-driven creator for controlled model-policy experiment tasks.
 *
 * Creating 30 matched tasks by hand is not a campaign anybody finishes, and each arm
 * needs a frozen base, a pinned policy matrix for all ten roles and a `<case>__<arm>`
 * variant id. This script does that from one reviewable manifest.
 *
 * It is validate-first: nothing is created until `--commit` is passed, and the dry run
 * checks every repository, base commit, arm reference and policy eligibility before any
 * task exists. See `docs/model-eval-baseline-proposal.md` for the campaign this serves.
 *
 *   node scripts/experiment-run.mjs --manifest docs/experiments/<name>.json
 *   node scripts/experiment-run.mjs --manifest <path> --case C1-narrow --commit
 *
 * Deliberate omissions:
 * - It never moves a repository's HEAD. Task creation requires `HEAD == frozenBaseSha`,
 *   so the script reports the exact `git -C … checkout` to run and stops.
 * - It never sends a top-level `model`/`reasoning`. Those set the server's blanket-policy
 *   path, which replaces every per-role pin with one legacy override.
 * - It does not start, approve or gate a task. Creation only.
 */
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";

const run = promisify(execFile);

const POLICY_IDS = [
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
];

const PROFILES = new Set(["fast", "standard", "high-risk"]);
const WORKFLOWS = new Set(["implement", "investigate", "prototype"]);

function parseArguments(argv) {
  const options = { manifest: null, case: null, arm: null, commit: false, base: null };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--commit") options.commit = true;
    else if (flag === "--manifest") options.manifest = argv[++index];
    else if (flag === "--case") options.case = argv[++index];
    else if (flag === "--arm") options.arm = argv[++index];
    else if (flag === "--base") options.base = argv[++index];
    else throw new Error(`Unknown argument: ${flag}`);
  }
  if (!options.manifest) throw new Error("--manifest <path> is required.");
  return options;
}

async function git(repositoryPath, args) {
  const { stdout } = await run("git", ["-C", repositoryPath, ...args]);
  return stdout.trim();
}

/**
 * The harness issues one CSRF token per process and serves it on the runtime document.
 * A non-browser loopback client must echo it on every mutation.
 */
async function connect(baseUrl) {
  const response = await fetch(`${baseUrl}/api/runtime/status`);
  if (!response.ok)
    throw new Error(
      `The harness API at ${baseUrl} returned ${response.status}. Start it with \`npm run dev:api\` first.`,
    );
  const runtime = await response.json();
  if (!runtime.csrfToken) throw new Error("The runtime status document carried no CSRF token.");
  return { csrfToken: runtime.csrfToken, allowedModels: runtime.settings?.allowedModels ?? [] };
}

/**
 * Every role is pinned in every arm. A pinned role reports `task-override` as its policy
 * source, and the effective-policy resolver only applies automatic repair escalation to an
 * *unpinned* role — so pinning is what stops an arm quietly executing a policy other than
 * the one under test.
 */
function armMatrix(arm, armId) {
  const matrix = {};
  for (const role of POLICY_IDS) {
    const policy = arm.stagePolicies?.[role] ?? arm.default;
    if (!policy?.model || !policy?.reasoning)
      throw new Error(`Arm ${armId} has no policy for role ${role} and no \`default\`.`);
    matrix[role] = { model: String(policy.model), reasoning: String(policy.reasoning) };
  }
  return matrix;
}

function variantId(caseId, armId, repetition, repetitions) {
  // `<case>__<arm>` keeps one brief and one base inside each variant, which is what makes
  // per-case pairing a string split rather than a guess.
  return repetitions > 1 ? `${caseId}__${armId}__r${repetition}` : `${caseId}__${armId}`;
}

function validateManifest(manifest) {
  if (!manifest.groupId?.trim()) throw new Error("The manifest needs a `groupId`.");
  if (!manifest.arms || !Object.keys(manifest.arms).length)
    throw new Error("The manifest needs at least one entry in `arms`.");
  if (!Array.isArray(manifest.cases) || !manifest.cases.length)
    throw new Error("The manifest needs a non-empty `cases` array.");
  const seen = new Set();
  for (const item of manifest.cases) {
    if (!item.caseId?.trim()) throw new Error("Every case needs a `caseId`.");
    if (seen.has(item.caseId)) throw new Error(`Duplicate caseId: ${item.caseId}`);
    seen.add(item.caseId);
    if (!item.repositoryPath) throw new Error(`${item.caseId} has no \`repositoryPath\`.`);
    if (!/^[a-f0-9]{40,64}$/i.test(item.frozenBaseSha ?? ""))
      throw new Error(`${item.caseId} needs a full 40-character \`frozenBaseSha\`.`);
    if (!item.title?.trim() || !item.description?.trim())
      throw new Error(`${item.caseId} needs a \`title\` and \`description\`.`);
    if (!WORKFLOWS.has(item.workflow))
      throw new Error(
        `${item.caseId} has workflow ${item.workflow}; use one of ${[...WORKFLOWS].join(", ")}.`,
      );
    if (!PROFILES.has(item.workflowProfile)) {
      // `auto` would let keyword matching pick the profile, and `fast` changes workflow
      // depth — either turns a model comparison into a workflow comparison.
      throw new Error(
        `${item.caseId} must fix \`workflowProfile\` to standard or high-risk before execution, never auto.`,
      );
    }
    if (!item.acceptanceCriteria?.length || !item.verificationCommands?.length)
      throw new Error(`${item.caseId} needs \`acceptanceCriteria\` and \`verificationCommands\`.`);
    for (const armId of item.arms ?? Object.keys(manifest.arms)) {
      if (!manifest.arms[armId]) throw new Error(`${item.caseId} references unknown arm ${armId}.`);
    }
  }
}

/**
 * Rows are grouped by case, because creation requires the repository to sit at that case's
 * frozen base — arms for one case share a single checkout window and cannot be interleaved
 * across cases. Within a case the arm order is rotated by case index instead of left
 * alphabetical, so no single arm is consistently created first and inherits the same
 * position in provider load and prompt-cache order on every case.
 */
function plan(manifest, options) {
  const rows = [];
  const ordered = manifest.cases.filter((item) => !options.case || item.caseId === options.case);
  ordered.forEach((item, caseIndex) => {
    const repetitions = Math.max(1, Number(item.repetitions ?? 1));
    const armIds = [...(item.arms ?? Object.keys(manifest.arms))].sort();
    const offset = caseIndex % (armIds.length || 1);
    const rotated = [...armIds.slice(offset), ...armIds.slice(0, offset)];
    for (let repetition = 1; repetition <= repetitions; repetition += 1) {
      for (const armId of rotated) {
        if (options.arm && armId !== options.arm) continue;
        rows.push({
          caseId: item.caseId,
          armId,
          repetition,
          variantId: variantId(item.caseId, armId, repetition, repetitions),
          item,
          matrix: armMatrix(manifest.arms[armId], armId),
          providerConstraint: manifest.arms[armId].providerConstraint ?? null,
        });
      }
    }
  });
  return rows;
}

async function checkBases(rows) {
  const problems = [];
  const repositories = new Map();
  for (const row of rows) {
    const key = `${row.item.repositoryPath}|${row.item.frozenBaseSha}`;
    if (repositories.has(key)) continue;
    repositories.set(key, true);
    try {
      await git(row.item.repositoryPath, ["rev-parse", "--verify", `${row.item.frozenBaseSha}^{commit}`]);
    } catch {
      problems.push(
        `${row.caseId}: ${row.item.frozenBaseSha.slice(0, 12)} is not a commit in ${row.item.repositoryPath}.`,
      );
      continue;
    }
    const head = await git(row.item.repositoryPath, ["rev-parse", "HEAD"]);
    if (head !== row.item.frozenBaseSha.toLowerCase()) {
      problems.push(
        `${row.caseId}: ${row.item.repositoryPath} is at ${head.slice(0, 12)}, not the frozen base ${row.item.frozenBaseSha.slice(0, 12)}.\n` +
          `    Creation will be rejected. Run: git -C ${row.item.repositoryPath} checkout ${row.item.frozenBaseSha}`,
      );
    }
  }
  return problems;
}

function checkModels(rows, allowedModels) {
  if (!allowedModels.length) return [];
  const problems = [];
  for (const row of rows) {
    for (const [role, policy] of Object.entries(row.matrix)) {
      if (!allowedModels.includes(policy.model))
        problems.push(
          `${row.variantId}: role ${role} uses ${policy.model}, which is not in the runtime's allowed model list.`,
        );
    }
  }
  return [...new Set(problems)];
}

async function createTask(baseUrl, csrfToken, manifest, row) {
  const body = {
    title: row.item.title,
    description: row.item.description,
    repositoryPath: row.item.repositoryPath,
    workflow: row.item.workflow,
    workflowProfile: row.item.workflowProfile,
    priority: row.item.priority ?? "medium",
    // Pin all ten roles. No top-level `model`/`reasoning`: that would take the blanket
    // path and discard these pins.
    rolePolicyOverrides: row.matrix,
    ...(row.providerConstraint ? { providerConstraint: row.providerConstraint } : {}),
    experiment: {
      groupId: manifest.groupId,
      variantId: row.variantId,
      frozenBaseSha: row.item.frozenBaseSha,
      acceptanceCriteria: row.item.acceptanceCriteria,
      verificationCommands: row.item.verificationCommands,
      // Declared rather than defaulted. The server would supply the same value, but a
      // preregistered campaign should carry its decision metric in the manifest whose
      // hash is recorded, so the metric cannot be read as having been chosen later.
      decisionMetric: manifest.decisionMetric ?? "deterministic-delivery-rate",
      ...(manifest.budget ? { budget: manifest.budget } : {}),
    },
  };
  const response = await fetch(`${baseUrl}/api/tasks`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-agent-harness-csrf": csrfToken },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error ?? `HTTP ${response.status}`);
  return payload.task?.id ?? "unknown";
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const baseUrl = options.base ?? `http://127.0.0.1:${process.env.AGENT_HARNESS_PORT ?? 4310}`;
  const manifest = JSON.parse(await readFile(options.manifest, "utf8"));
  validateManifest(manifest);
  const rows = plan(manifest, options);
  if (!rows.length) throw new Error("No case/arm combination matched the given filters.");

  const { csrfToken, allowedModels } = await connect(baseUrl);
  const problems = [...(await checkBases(rows)), ...checkModels(rows, allowedModels)];

  console.log(
    `Experiment ${manifest.groupId}: ${rows.length} task${rows.length === 1 ? "" : "s"} planned.\n`,
  );
  for (const row of rows) {
    const models = [
      ...new Set(Object.values(row.matrix).map((policy) => `${policy.model}:${policy.reasoning}`)),
    ];
    console.log(
      `  ${row.variantId.padEnd(34)} ${row.item.workflowProfile.padEnd(10)} ${row.item.frozenBaseSha.slice(0, 8)}  ${models.join(", ")}`,
    );
  }

  if (problems.length) {
    console.log(`\n${problems.length} blocking problem${problems.length === 1 ? "" : "s"}:`);
    for (const problem of problems) console.log(`  - ${problem}`);
    process.exitCode = 1;
    return;
  }

  if (!options.commit) {
    console.log("\nDry run only. Nothing was created. Re-run with --commit to create these tasks.");
    return;
  }

  console.log("");
  for (const row of rows) {
    try {
      const id = await createTask(baseUrl, csrfToken, manifest, row);
      console.log(`  created ${id} ${row.variantId}`);
    } catch (error) {
      console.log(`  FAILED  ${row.variantId}: ${error.message}`);
      process.exitCode = 1;
    }
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
