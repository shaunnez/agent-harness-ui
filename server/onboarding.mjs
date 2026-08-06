import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { parseVerificationManifest, VERIFICATION_MANIFEST_PATH } from "./verification.mjs";

/**
 * Onboarding: propose a repository's verification manifest.
 *
 * #47 made the harness execute the repository's declared commands and refuse the test stage
 * when none are declared. That refusal is correct — the alternative is evidence the harness
 * cannot check — but without a remedy it means no repository except this one can be verified.
 *
 * This is the remedy, and the boundary it keeps is the whole point: **a model proposes, a human
 * approves, the file is committed, and verification time consults no model.** That is the plan
 * stage's pattern, not "a model picked the command on this run".
 *
 * Two guards live here rather than in a comment elsewhere:
 *
 * - **Evidence, not invention.** Every proposed command must trace to something already in the
 *   repository — a `package.json` script, a Makefile target, a CI workflow step. CI is the
 *   strongest evidence available because it is what the project already trusts to gate its own
 *   merges. A command with no such source is refused, not offered for approval.
 * - **A proposal is validated before it is shown.** It must satisfy `parseVerificationManifest`,
 *   so argv arrays, unique ids and known report formats are the onboarding agent's problem to
 *   get right rather than the operator's to discover afterwards.
 *
 * The guard that is *not* here, deliberately: nothing in this module is reachable from a stage.
 * If a failing test stage could invoke onboarding, a failing candidate could "fix" itself by
 * having a model rewrite its verification commands — the hollow determinism #47 removed, by a
 * longer route. Onboarding is an operator-initiated repository action, before any candidate.
 */

export class OnboardingError extends Error {
  constructor(message) {
    super(message);
    this.name = "OnboardingError";
    this.code = "ONBOARDING";
  }
}

const CI_DIRECTORY = path.join(".github", "workflows");

/**
 * Command runners, excluded when comparing a proposal against the repository's own evidence. The
 * runner is an environment detail — which python, which package manager — while the script path or
 * target is the thing being cited.
 */
const RUNNERS = new Set(["npm", "pnpm", "yarn", "bun", "npx", "node", "python", "python3", "make", "sh", "bash", "zsh", "uv", "poetry"]);
const MAX_EVIDENCE_LINES = 400;

/**
 * Read-only discovery of what the repository already says about verifying itself.
 *
 * Returns *sources*, not conclusions. The model's job is to choose among these and explain the
 * choice; this function's job is to make sure there is something to trace a choice back to.
 */
export async function discoverVerificationEvidence(repositoryRoot) {
  const packageJson = await readJson(path.join(repositoryRoot, "package.json"));
  const scripts = packageJson?.scripts && typeof packageJson.scripts === "object" ? packageJson.scripts : {};
  const makefile = await readText(path.join(repositoryRoot, "Makefile"));
  const workflows = await readWorkflows(path.join(repositoryRoot, CI_DIRECTORY));
  return {
    packageManager: detectPackageManager(packageJson, await listFiles(repositoryRoot)),
    scripts: Object.entries(scripts).map(([name, command]) => ({ name, command: String(command) })),
    makeTargets: makefileTargets(makefile),
    ciCommands: workflows.flatMap((workflow) => workflow.commands.map((command) => ({ workflow: workflow.name, command }))),
  };
}

function detectPackageManager(packageJson, files) {
  if (files.includes("pnpm-lock.yaml")) return "pnpm";
  if (files.includes("yarn.lock")) return "yarn";
  if (files.includes("bun.lockb")) return "bun";
  if (files.includes("package-lock.json") || packageJson) return "npm";
  return null;
}

function makefileTargets(makefile) {
  if (!makefile) return [];
  return makefile
    .split("\n")
    .map((line) => /^([a-zA-Z0-9][a-zA-Z0-9_.-]*):(?!=)/.exec(line)?.[1])
    .filter(Boolean);
}

async function readWorkflows(directory) {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  const workflows = [];
  for (const entry of entries) {
    if (!entry.isFile() || !/\.ya?ml$/.test(entry.name)) continue;
    const text = await readText(path.join(directory, entry.name));
    if (!text) continue;
    // Deliberately a line scrape rather than a YAML parse: the harness only needs the `run:`
    // strings as *evidence that the project runs them*, and adding a YAML dependency to read
    // them would be a larger commitment than the evidence is worth.
    const commands = text
      .split("\n")
      .slice(0, MAX_EVIDENCE_LINES)
      .map((line) => /^\s*(?:-\s*)?run:\s*(.+)$/.exec(line)?.[1]?.trim())
      .filter(Boolean)
      .map((command) => command.replace(/^["']|["']$/g, ""));
    workflows.push({ name: entry.name, commands });
  }
  return workflows;
}

/**
 * Does this proposed argv trace to something in the repository?
 *
 * Matched on the command's *tail* — the script name or make target — rather than on an exact
 * string, because `npm run lint`, `pnpm lint` and a CI step's `npm run lint --if-present` are
 * the same evidence. What it will not do is accept a command whose action appears nowhere.
 */
export function evidenceForCommand(argv, evidence) {
  const joined = argv.join(" ");
  const scriptNames = new Set(evidence.scripts.map((script) => script.name));
  const runner = argv[0];
  const isPackageRunner = ["npm", "pnpm", "yarn", "bun", "npx"].includes(path.basename(runner ?? ""));
  if (isPackageRunner) {
    const target = argv.find((argument, index) => index > 0 && !argument.startsWith("-") && argument !== "run");
    if (target && scriptNames.has(target)) return { kind: "package-script", detail: `package.json scripts.${target}` };
    if (target === "test" && scriptNames.has("test")) return { kind: "package-script", detail: "package.json scripts.test" };
  }
  if (path.basename(runner ?? "") === "make") {
    const target = argv[1];
    if (target && evidence.makeTargets.includes(target)) return { kind: "make-target", detail: `Makefile target ${target}` };
  }
  // Fallback: match on the *arguments*, not the runner. A CI step's
  // `python scripts/check_retired_references.py` and a proposal's `python3 scripts/…` cite the
  // same thing — and on macOS `python` is frequently only a shell alias, so a harness that spawns
  // argv directly *must* differ from CI here. Comparing whole strings rejected a correct
  // substitution for the digit in `python3`.
  //
  // Requiring a shared distinctive token still refuses invention: `npm run verify-everything`
  // shares no token with any script or CI step, and `curl https://example.test` shares none either.
  const tokens = argv.filter((argument, index) =>
    index > 0
    && !argument.startsWith("-")
    && argument !== "run"
    && argument.length > 3
    && !RUNNERS.has(path.basename(argument)));
  const sources = [
    ...evidence.ciCommands.map((entry) => ({
      kind: "ci-step",
      text: entry.command,
      detail: `${CI_DIRECTORY}/${entry.workflow}: ${entry.command}`,
    })),
    ...evidence.scripts.map((script) => ({
      kind: "package-script",
      text: `${script.name} ${script.command}`,
      detail: `package.json scripts.${script.name}`,
    })),
    ...evidence.makeTargets.map((target) => ({ kind: "make-target", text: target, detail: `Makefile target ${target}` })),
  ];
  const cited = sources.find((source) => tokens.some((token) => source.text.includes(token)));
  if (cited) return { kind: cited.kind, detail: cited.detail };
  return null;
}

const PROPOSAL_OPEN = "<verification-proposal>";
const PROPOSAL_CLOSE = "</verification-proposal>";

/**
 * Parse and validate an onboarding proposal.
 *
 * Refusals here are the onboarding agent's problem, not the operator's: a proposal that reaches
 * the approval diff has already been shown to be a well-formed manifest whose every command is
 * traceable. `determined: false` is a first-class answer — a repository whose verification
 * cannot be established gets an honest report rather than a plausible guess.
 */
export function parseOnboardingProposal(text, evidence) {
  const start = String(text ?? "").indexOf(PROPOSAL_OPEN);
  const end = String(text ?? "").indexOf(PROPOSAL_CLOSE);
  if (start < 0 || end <= start) throw new OnboardingError(`The onboarding agent returned no ${PROPOSAL_OPEN} block.`);
  let value;
  try {
    value = JSON.parse(text.slice(start + PROPOSAL_OPEN.length, end).trim());
  } catch (error) {
    throw new OnboardingError(`The onboarding proposal is not valid JSON: ${error.message}`);
  }
  if (value?.determined === false) {
    if (typeof value.reason !== "string" || !value.reason.trim()) {
      throw new OnboardingError("An undetermined proposal must say why the repository's verification could not be established.");
    }
    return { determined: false, reason: value.reason.trim(), commands: [], notes: normalizeNotes(value.notes) };
  }
  if (!Array.isArray(value?.commands) || !value.commands.length) {
    throw new OnboardingError("The onboarding proposal must declare commands, or set determined:false with a reason.");
  }
  // Validated as a manifest before anything else is said about it, so the operator never
  // approves something the harness would later refuse to read.
  const manifest = parseVerificationManifest(
    JSON.stringify({ version: 1, commands: value.commands.map(({ evidence: _ignored, ...rest }) => rest) }),
    "the onboarding proposal",
  );
  const commands = manifest.commands.map((command, index) => {
    const claimed = value.commands[index]?.evidence;
    const found = evidenceForCommand(command.command, evidence);
    if (!found) {
      throw new OnboardingError(
        `Proposed command ${command.id} (${command.command.join(" ")}) traces to nothing in the repository. `
          + "Every verification command must come from a package script, a Makefile target or a CI step.",
      );
    }
    return {
      ...command,
      evidence: found,
      // Kept for the approval diff: what the agent said its source was, beside what the harness
      // could actually find. They should agree; when they do not, the operator sees both.
      claimedEvidence: typeof claimed === "string" ? claimed.trim() : null,
    };
  });
  return { determined: true, reason: null, commands, notes: normalizeNotes(value.notes) };
}

function normalizeNotes(notes) {
  if (!Array.isArray(notes)) return [];
  return notes.filter((note) => typeof note === "string" && note.trim()).map((note) => note.trim().slice(0, 500));
}

/**
 * The file the operator approves. Written by the harness, never by the agent, and carrying its
 * own provenance so a later reader can see where the commands came from and who ratified them.
 */
export function renderManifestFile(proposal, provenance) {
  if (!proposal.determined) throw new OnboardingError("An undetermined proposal has no manifest to write.");
  return `${JSON.stringify({
    version: 1,
    provenance: {
      proposedBy: provenance.model,
      proposedAt: provenance.at,
      approvedBy: provenance.approvedBy ?? "operator",
      derivedFrom: proposal.commands.map((command) => command.evidence.detail),
    },
    commands: proposal.commands.map((command) => ({
      id: command.id,
      title: command.title,
      command: command.command,
      ...(command.report ? { report: command.report } : {}),
    })),
  }, null, 2)}\n`;
}

export { VERIFICATION_MANIFEST_PATH };

async function readJson(file) {
  const raw = await readText(file);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function readText(file) {
  return readFile(file, "utf8").catch(() => null);
}

async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  return entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
}
