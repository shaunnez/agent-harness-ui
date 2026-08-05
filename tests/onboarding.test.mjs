import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  discoverVerificationEvidence,
  evidenceForCommand,
  OnboardingError,
  parseOnboardingProposal,
  renderManifestFile,
  VERIFICATION_MANIFEST_PATH,
} from "../server/onboarding.mjs";
import { TaskOrchestrator } from "../server/orchestrator.mjs";
import { JsonTaskStore } from "../server/store.mjs";
import { parseVerificationManifest } from "../server/verification.mjs";

const evidence = {
  packageManager: "npm",
  scripts: [{ name: "lint", command: "biome lint src" }, { name: "test", command: "node --test" }],
  makeTargets: ["e2e-native"],
  ciCommands: [{ workflow: "ci.yml", command: "npm run typecheck" }],
};

const proposal = (commands, extra = {}) =>
  `noise before <verification-proposal>${JSON.stringify({ commands, ...extra })}</verification-proposal> noise after`;

test("discovers what the repository already says about verifying itself", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-onboard-"));
  try {
    await writeFile(
      path.join(directory, "package.json"),
      JSON.stringify({ scripts: { lint: "biome lint src", test: "node --test" } }),
      "utf8",
    );
    await writeFile(path.join(directory, "package-lock.json"), "{}", "utf8");
    await writeFile(path.join(directory, "Makefile"), "e2e-native:\n\t./scripts/run.sh\n\nVAR:=x\n", "utf8");
    await mkdir(path.join(directory, ".github", "workflows"), { recursive: true });
    await writeFile(
      path.join(directory, ".github", "workflows", "ci.yml"),
      "jobs:\n  build:\n    steps:\n      - run: npm ci\n      - run: 'npm run typecheck'\n",
      "utf8",
    );

    const found = await discoverVerificationEvidence(directory);
    assert.equal(found.packageManager, "npm");
    assert.deepEqual(found.scripts.map((script) => script.name), ["lint", "test"]);
    // `VAR:=x` is an assignment, not a target.
    assert.deepEqual(found.makeTargets, ["e2e-native"]);
    assert.deepEqual(found.ciCommands.map((entry) => entry.command), ["npm ci", "npm run typecheck"]);

    // A repository with none of these yields empty evidence rather than an error: "nothing to
    // trace to" is a finding the proposal step reports, not a crash here.
    const empty = await discoverVerificationEvidence(path.join(directory, "missing"));
    assert.deepEqual(empty, { packageManager: null, scripts: [], makeTargets: [], ciCommands: [] });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("traces a proposed command to the repository, or refuses it", () => {
  assert.equal(evidenceForCommand(["npm", "run", "lint"], evidence).kind, "package-script");
  assert.equal(evidenceForCommand(["npm", "test"], evidence).kind, "package-script");
  // Same evidence through a different package manager: the script is what is being cited.
  assert.equal(evidenceForCommand(["pnpm", "lint"], evidence).kind, "package-script");
  assert.equal(evidenceForCommand(["make", "e2e-native"], evidence).kind, "make-target");
  assert.equal(evidenceForCommand(["npm", "run", "typecheck"], evidence).kind, "ci-step");

  // Invention is the failure mode this exists to stop.
  assert.equal(evidenceForCommand(["npm", "run", "verify-everything"], evidence), null);
  assert.equal(evidenceForCommand(["make", "deploy"], evidence), null);
  assert.equal(evidenceForCommand(["curl", "https://example.test"], evidence), null);
});

test("refuses a proposal whose command traces to nothing", () => {
  assert.throws(
    () => parseOnboardingProposal(proposal([{ id: "all", command: ["npm", "run", "verify-everything"] }]), evidence),
    (error) => error instanceof OnboardingError && /traces to nothing in the repository/.test(error.message),
  );
});

test("validates a proposal as a manifest before an operator can approve it", () => {
  // The manifest rules from #47 apply here, so a shell string is refused at proposal time rather
  // than discovered after approval.
  assert.throws(() => parseOnboardingProposal(proposal([{ id: "lint", command: "npm run lint" }]), evidence), /argv array/);
  assert.throws(() => parseOnboardingProposal(proposal([{ id: "Lint", command: ["npm", "run", "lint"] }]), evidence), /lowercase id/);
  assert.throws(
    () => parseOnboardingProposal(
      proposal([{ id: "e2e", command: ["npm", "run", "lint"], report: { format: "junit-xml", outputFile: "r.xml" } }]),
      evidence,
    ),
    /not one the harness can parse/,
  );
  assert.throws(() => parseOnboardingProposal("no block here", evidence), /returned no <verification-proposal> block/);
  assert.throws(() => parseOnboardingProposal(proposal([]), evidence), /must declare commands/);
});

test("accepts a traceable proposal and records both claimed and found evidence", () => {
  const parsed = parseOnboardingProposal(
    proposal([
      { id: "lint", title: "Lint", command: ["npm", "run", "lint"], evidence: "package.json scripts.lint" },
      { id: "typecheck", command: ["npm", "run", "typecheck"], evidence: "invented citation" },
    ], { notes: ["The suite needs no external services."] }),
    evidence,
  );
  assert.equal(parsed.determined, true);
  assert.equal(parsed.commands[0].evidence.detail, "package.json scripts.lint");
  // What the agent claimed is kept beside what the harness could actually find, so a
  // disagreement is visible in the approval diff instead of being resolved silently.
  assert.equal(parsed.commands[1].claimedEvidence, "invented citation");
  assert.match(parsed.commands[1].evidence.detail, /ci\.yml/);
  assert.deepEqual(parsed.notes, ["The suite needs no external services."]);
});

test("treats an undetermined repository as a first-class answer, with a reason", () => {
  const parsed = parseOnboardingProposal(
    `<verification-proposal>${JSON.stringify({ determined: false, reason: "No test runner is configured." })}</verification-proposal>`,
    evidence,
  );
  assert.equal(parsed.determined, false);
  assert.equal(parsed.reason, "No test runner is configured.");
  assert.deepEqual(parsed.commands, []);
  // An honest "not determined" beats a plausible guess, but it still has to say why.
  assert.throws(
    () => parseOnboardingProposal(`<verification-proposal>${JSON.stringify({ determined: false })}</verification-proposal>`, evidence),
    /must say why/,
  );
  assert.throws(() => renderManifestFile(parsed, { model: "m", at: "t" }), /no manifest to write/);
});

test("renders a manifest the harness can read back, carrying its own provenance", () => {
  const parsed = parseOnboardingProposal(
    proposal([{ id: "test", title: "Node tests", command: ["npm", "test"] }]),
    evidence,
  );
  const file = renderManifestFile(parsed, { model: "claude-sonnet-5", at: "2026-08-06T00:00:00.000Z" });

  // The round trip is the point: what onboarding writes is exactly what #47's reader accepts.
  const manifest = parseVerificationManifest(file);
  assert.deepEqual(manifest.commands[0].command, ["npm", "test"]);
  const parsedFile = JSON.parse(file);
  assert.equal(parsedFile.provenance.proposedBy, "claude-sonnet-5");
  assert.equal(parsedFile.provenance.approvedBy, "operator");
  assert.deepEqual(parsedFile.provenance.derivedFrom, ["package.json scripts.test"]);
  // Provenance is recorded, not load-bearing: the reader ignores it, so a hand-edited manifest
  // without it still works.
  assert.equal(manifest.commands.length, 1);
});

test("commits an approved manifest only after its commands are seen to run", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-onboard-approve-"));
  try {
    const git = (args) => new Promise((resolve, reject) => {
      const child = spawn("git", args, { cwd: directory, stdio: "ignore" });
      child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`git ${args.join(" ")}`))));
    });
    await git(["init", "--initial-branch=main"]);
    await git(["config", "user.email", "t@example.test"]);
    await git(["config", "user.name", "T"]);
    await writeFile(path.join(directory, "package.json"), JSON.stringify({ scripts: { test: "node --test" } }), "utf8");
    await git(["add", "."]);
    await git(["commit", "-m", "base"]);

    const store = new JsonTaskStore(path.join(directory, "tasks.json"));
    await store.init();
    const proposal = parseOnboardingProposal(
      `<verification-proposal>${JSON.stringify({ commands: [{ id: "test", command: ["npm", "test"] }] })}</verification-proposal>`,
      { packageManager: "npm", scripts: [{ name: "test", command: "node --test" }], makeTargets: [], ciCommands: [] },
    );
    const target = path.join(directory, VERIFICATION_MANIFEST_PATH);
    const orchestrator = (status) => new TaskOrchestrator(store, {
      getStatus: async () => ({ available: true, authenticated: true }),
      worktreeManager: { repositoryRoot: async (given) => given },
      runVerification: async () => ({ status, rows: [{ command: "npm test", status }] }),
    });

    // A manifest whose commands do not run turns a configuration error into a per-task failure,
    // so it is never committed — and the repository is left exactly as it was.
    await assert.rejects(
      () => orchestrator("failed").approveOnboarding(directory, proposal),
      /did not pass in this repository, so the manifest was not committed/,
    );
    assert.equal(await readFile(target, "utf8").then(() => true).catch(() => false), false);

    const approved = await orchestrator("passed").approveOnboarding(directory, proposal);
    assert.equal(approved.manifestPath, VERIFICATION_MANIFEST_PATH);
    // What onboarding wrote is what #47's reader accepts.
    assert.deepEqual(parseVerificationManifest(await readFile(target, "utf8")).commands[0].command, ["npm", "test"]);

    // An undetermined proposal cannot be approved at all.
    await assert.rejects(
      () => orchestrator("passed").approveOnboarding(directory, { determined: false, reason: "x" }),
      /undetermined proposal cannot be approved/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
