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

/**
 * How much of a workflow file is scanned for `run:` steps.
 *
 * Raised from 400 because a `run: |` block's *body* is the evidence, so the interesting lines are
 * several times more numerous than the `run:` keys and they cluster late — a real CI file's build,
 * test and e2e steps all sit past line 400. The cap survives only as a runaway guard against a
 * generated multi-megabyte YAML, and when it bites it is reported (`truncatedWorkflows`) rather
 * than dropping the tail of a file in silence, because "nothing there" and "I stopped looking" are
 * different findings.
 */
const MAX_EVIDENCE_LINES = 4000;

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
    // Empty in the ordinary case. Non-empty means the harness stopped reading a workflow before
    // its end, which is a different statement from "that workflow declares nothing".
    truncatedWorkflows: workflows
      .filter((workflow) => workflow.truncated)
      .map((workflow) => ({ workflow: workflow.name, scannedLines: MAX_EVIDENCE_LINES, totalLines: workflow.totalLines })),
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
    workflows.push({ name: entry.name, ...scrapeRunSteps(text) });
  }
  return workflows;
}

/**
 * Pull the `run:` steps out of a workflow file.
 *
 * Deliberately a line scrape rather than a YAML parse: the harness only needs the `run:` strings
 * as *evidence that the project runs them*, and adding a YAML dependency to read them would be a
 * larger commitment than the evidence is worth. Having now read a real repository's workflows, I
 * still think that is right — nothing here needs anchors, merge keys or type resolution — but the
 * scrape has to understand one piece of YAML syntax it previously did not.
 *
 * Block scalars. `run: |` and `run: >` put the commands on the *following* indented lines, so
 * taking everything after `run:` yielded the literal string "|" and lost the step. That is not a
 * cosmetic loss: a repository's compile, test and e2e steps are almost all written as blocks, so
 * they were invisible to both the prompt and the citation check, and a proposal could in principle
 * have been "traced" to a pipe character.
 *
 * Each non-empty body line becomes its own evidence command, with `\` continuations rejoined so a
 * wrapped invocation stays one command, and comment-only lines dropped.
 */
function scrapeRunSteps(text) {
  const allLines = text.split("\n");
  const truncated = allLines.length > MAX_EVIDENCE_LINES;
  const lines = truncated ? allLines.slice(0, MAX_EVIDENCE_LINES) : allLines;
  const commands = [];
  for (let index = 0; index < lines.length; index += 1) {
    const match = /^(\s*)(?:-\s*)?run:\s*(.*)$/.exec(lines[index]);
    if (!match) continue;
    const [, indent, rest] = match;
    const value = rest.trim();
    // `|`, `>`, and their chomping/indentation indicators: `|-`, `>+`, `|2`.
    if (/^[|>][+-]?\d*$/.test(value)) {
      const body = [];
      let cursor = index + 1;
      for (; cursor < lines.length; cursor += 1) {
        if (!lines[cursor].trim()) {
          body.push("");
          continue;
        }
        if (leadingSpaces(lines[cursor]) <= indent.length) break;
        body.push(lines[cursor]);
      }
      index = cursor - 1;
      commands.push(...blockScalarCommands(body));
      continue;
    }
    if (!value) continue;
    commands.push(value.replace(/^["']|["']$/g, ""));
  }
  return { commands, truncated, totalLines: allLines.length };
}

function leadingSpaces(line) {
  return /^\s*/.exec(line)[0].length;
}

function blockScalarCommands(body) {
  const commands = [];
  let continued = null;
  for (const raw of body) {
    const line = raw.trim();
    if (continued != null) {
      const continues = line.endsWith("\\");
      continued = `${continued} ${continues ? line.slice(0, -1).trim() : line}`.trim();
      if (!continues) {
        commands.push(continued);
        continued = null;
      }
      continue;
    }
    if (!line || line.startsWith("#")) continue;
    if (line.endsWith("\\")) {
      continued = line.slice(0, -1).trim();
      continue;
    }
    commands.push(line);
  }
  if (continued) commands.push(continued);
  return commands;
}

/**
 * Does this proposed argv trace to something in the repository?
 *
 * Matched on the command's *tail* — the script name, make target or script path — rather than on an
 * exact string, because `npm run lint`, `pnpm lint` and a CI step's `npm run lint --if-present` are
 * the same evidence. What it will not do is accept a command whose action appears nowhere, and — the
 * tighter rule — it will not accept a citation that is not distinctive: a bare word appearing
 * somewhere inside an unrelated step is not a source.
 */
export function evidenceForCommand(argv, evidence) {
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
  const sources = evidenceSources(evidence);

  // Fallback 1 — the command *minus its runner*, matched whole. A CI step's
  // `python scripts/check_retired_references.py` and a proposal's `python3 scripts/…` cite the
  // same thing, and on macOS `python` is frequently only a shell alias, so a harness that spawns
  // argv directly *must* differ from CI here. Comparing whole strings rejected a correct
  // substitution for the digit in `python3`; dropping the interpreter and comparing the rest
  // exactly keeps that insensitivity without loosening anything else.
  const tail = commandTail(argv.map(String));
  if (tail) {
    const exact = sources.find((source) => source.tails.includes(tail));
    if (exact) return { kind: exact.kind, detail: exact.detail };
  }

  // Fallback 2 — a shared token, but only a *distinctive* one: something that looks like a path or
  // a file, matched at token boundaries. A bare word is not a citation. The defect this replaces
  // let `python -m compileall -q backend` be "traced" to
  // `python -m pip install -r backend/requirements-dev.txt` on the word `backend` — the harness
  // found a worse source than the agent had claimed and recorded it as fact. Script and Makefile
  // names are still citeable, but only through fallback 1, where they must match exactly.
  const distinctive = argv.slice(1).filter((argument) =>
    !argument.startsWith("-")
    && argument !== "run"
    && !isRunner(argument)
    && isDistinctiveToken(argument));
  const cited = sources.find((source) => distinctive.some((token) => containsToken(source.text, token)));
  if (cited) return { kind: cited.kind, detail: cited.detail };
  return null;
}

/**
 * Every citable string in the repository, each with the tails a proposal could match exactly.
 *
 * `&&`- and `;`-joined CI steps are split, so a proposal citing one half of
 * `npm run api:types && git diff --exit-code …` traces to the step that runs it.
 */
function evidenceSources(evidence) {
  const sources = [];
  for (const entry of evidence.ciCommands ?? []) {
    const text = String(entry.command);
    sources.push({
      kind: "ci-step",
      text,
      detail: `${CI_DIRECTORY}/${entry.workflow}: ${text}`,
      tails: shellSegments(text).map((segment) => commandTail(segment.split(/\s+/))).filter(Boolean),
    });
  }
  for (const script of evidence.scripts ?? []) {
    const text = String(script.command);
    sources.push({
      kind: "package-script",
      text: `${script.name} ${text}`,
      detail: `package.json scripts.${script.name}`,
      tails: [script.name, ...shellSegments(text).map((segment) => commandTail(segment.split(/\s+/)))].filter(Boolean),
    });
  }
  for (const target of evidence.makeTargets ?? []) {
    sources.push({ kind: "make-target", text: target, detail: `Makefile target ${target}`, tails: [target] });
  }
  return sources;
}

function shellSegments(text) {
  return text.split(/\s*(?:&&|\|\||;)\s*/).map((segment) => segment.trim()).filter(Boolean);
}

/**
 * The command with its runner removed: what is actually being cited, rather than which interpreter
 * or package manager happens to reach it.
 */
function commandTail(parts) {
  let index = 0;
  while (index < parts.length && isRunner(parts[index])) index += 1;
  if (index < parts.length && parts[index] === "run") index += 1;
  return parts.slice(index).join(" ").trim();
}

function isRunner(token) {
  const base = path.basename(String(token));
  // `python3.11` and `python3` are the same runner as `python`.
  return RUNNERS.has(base) || RUNNERS.has(base.replace(/[\d.]+$/, ""));
}

/**
 * Distinctive enough to be a citation on its own: a path, or something with a file extension.
 * `backend` is not; `backend/requirements-dev.txt` and `scripts/run-e2e-native.sh` are.
 */
function isDistinctiveToken(token) {
  if (token.length <= 3) return false;
  if (token.includes("/")) return true;
  return /\.[A-Za-z][A-Za-z0-9]{0,7}$/.test(path.basename(token));
}

function containsToken(text, token) {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![\\w./-])${escaped}(?![\\w./-])`).test(text);
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
    const claimedEvidence = typeof claimed === "string" ? claimed.trim() : null;
    return {
      ...command,
      evidence: found,
      // Kept for the approval diff: what the agent said its source was, beside what the harness
      // could actually find. They should agree; when they do not, the operator sees both.
      claimedEvidence,
      evidenceDisagrees: claimedEvidence ? !citationsAgree(claimedEvidence, found.detail) : false,
    };
  });
  return {
    determined: true,
    reason: null,
    commands,
    notes: normalizeNotes(value.notes),
    // Surfaced, not refused.
    //
    // The temptation is to reject a proposal whose claimed citation disagrees with the one the
    // harness found — it was the only reason the `backend` mis-citation was visible at all. But
    // the claim is free-text prose from a model ("the compile step", "ci.yml build") and the found
    // citation is a fact the harness checked itself. Refusing on disagreement would give a model's
    // phrasing a veto over a harness-verified fact, which is #47's rule inverted: the guard is
    // that the command traces to the repository, and that guard runs regardless of what the model
    // said. What the mis-citation actually revealed was a broken matcher, now fixed.
    //
    // So the disagreement is raised where the operator is already looking — the approval diff —
    // rather than converted into a failure whose usual cause is wording.
    disagreements: commands
      .filter((command) => command.evidenceDisagrees)
      .map((command) => ({ id: command.id, claimed: command.claimedEvidence, found: command.evidence.detail })),
  };
}

/**
 * Lenient on phrasing, strict on substance: two citations agree if they name anything in common.
 * "package.json scripts.lint" agrees with "the lint script"; "invented citation" agrees with
 * nothing.
 */
function citationsAgree(claimed, found) {
  const words = (text) => new Set(
    text.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length >= 4),
  );
  const claimedWords = words(claimed);
  if (!claimedWords.size) return false;
  return [...words(found)].some((word) => claimedWords.has(word));
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
