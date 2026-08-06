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
import { providerForModelId } from "../server/model-catalog.mjs";
import { JsonTaskStore } from "../server/store.mjs";
import { parseVerificationManifest } from "../server/verification.mjs";

const evidence = {
  packageManager: "npm",
  scripts: [{ name: "lint", command: "biome lint src" }, { name: "test", command: "node --test" }],
  makeTargets: ["e2e-native"],
  ciCommands: [{ workflow: "ci.yml", command: "npm run typecheck" }],
  truncatedWorkflows: [],
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
    assert.deepEqual(empty, {
      packageManager: null,
      scripts: [],
      makeTargets: [],
      ciCommands: [],
      truncatedWorkflows: [],
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("reads the body of a `run:` block scalar, not the pipe character", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-onboard-block-"));
  try {
    await mkdir(path.join(directory, ".github", "workflows"), { recursive: true });
    // The defect: `readWorkflows` took everything after `run:`, so a block scalar produced the
    // literal string "|" and the step's real commands vanished. A whole repository's compile, test
    // and e2e steps are written this way, so they were invisible — and "|" was, in principle, a
    // citeable evidence string.
    await writeFile(
      path.join(directory, ".github", "workflows", "ci.yml"),
      [
        "jobs:",
        "  validate:",
        "    steps:",
        "      - name: Lint frontend",
        "        run: npm run lint",
        "      - name: Compile and import backend",
        "        run: |",
        "          # a comment is not a command",
        "          python -m compileall -q backend",
        '          python -c "import backend.main"',
        "",
        "      - name: Test policy suites",
        "        run: >-",
        "          python -m pytest -q --junitxml=/tmp/results.xml \\",
        "            tests/policy/test_ask_postgres_policy.py",
        "        env:",
        "          MODE: '1'",
        "      - name: Run e2e",
        "        run: scripts/run-e2e-native.sh",
        "",
      ].join("\n"),
      "utf8",
    );

    const found = await discoverVerificationEvidence(directory);
    const commands = found.ciCommands.map((entry) => entry.command);
    assert.ok(!commands.includes("|"), `no bare block-scalar marker survives: ${JSON.stringify(commands)}`);
    assert.ok(!commands.includes(">-"));
    assert.deepEqual(commands, [
      "npm run lint",
      "python -m compileall -q backend",
      'python -c "import backend.main"',
      // A `\` continuation stays one command rather than becoming two fragments.
      "python -m pytest -q --junitxml=/tmp/results.xml tests/policy/test_ask_postgres_policy.py",
      "scripts/run-e2e-native.sh",
    ]);
    assert.deepEqual(found.truncatedWorkflows, []);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("says so when a workflow is longer than it reads", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-onboard-truncate-"));
  try {
    await mkdir(path.join(directory, ".github", "workflows"), { recursive: true });
    // A silent cap reads as "nothing there". The cap is now 4000 lines and reports when it bites,
    // so an incomplete scan cannot be mistaken for an empty repository.
    await writeFile(
      path.join(directory, ".github", "workflows", "long.yml"),
      `${Array.from({ length: 4100 }, (_unused, index) => `      # filler ${index}`).join("\n")}\n      - run: npm run lint\n`,
      "utf8",
    );
    const found = await discoverVerificationEvidence(directory);
    assert.deepEqual(found.ciCommands, []);
    assert.deepEqual(found.truncatedWorkflows, [{ workflow: "long.yml", scannedLines: 4000, totalLines: 4102 }]);
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

test("cites a CI step through a different interpreter than CI used", () => {
  // The real refusal this fixes: CI runs `python scripts/check_retired_references.py`, the proposal
  // used `python3`, and comparing whole strings rejected it over the digit. On macOS `python` is
  // often only a shell alias, so a harness that spawns argv directly *has* to differ from CI —
  // which made a correct substitution look like an invented command.
  const withCi = {
    ...evidence,
    ciCommands: [{ workflow: "ci.yml", command: "python scripts/check_retired_references.py" }],
  };
  const cited = evidenceForCommand(["python3", "scripts/check_retired_references.py"], withCi);
  assert.equal(cited?.kind, "ci-step");
  assert.match(cited.detail, /check_retired_references\.py/);

  // The script path is the citation, so the runner may differ freely.
  assert.equal(evidenceForCommand(["uv", "run", "scripts/check_retired_references.py"], withCi)?.kind, "ci-step");

  // Still refused: a different script, and a bare runner with nothing distinctive to cite.
  assert.equal(evidenceForCommand(["python3", "scripts/deploy_everything.py"], withCi), null);
  assert.equal(evidenceForCommand(["python3"], withCi), null);
  // A short token must not match by accident — `-m` and `up` are not citations.
  assert.equal(evidenceForCommand(["python3", "-m", "up"], withCi), null);
});

test("a citation has to be distinctive, not a word that appears somewhere", () => {
  // The real mis-citation: `python -m compileall -q backend` was "cited" by
  // `python -m pip install -r backend/requirements-dev.txt`, matched on the bare word `backend`.
  // The proposal's own claim named the correct step; the harness found a worse one and recorded it
  // as fact. A bare word is now never a citation.
  const installOnly = {
    ...evidence,
    ciCommands: [{ workflow: "ci.yml", command: "python -m pip install -r backend/requirements-dev.txt" }],
  };
  assert.equal(evidenceForCommand(["python", "-m", "compileall", "-q", "backend"], installOnly), null);

  // With the step that actually runs it present — which only the block-scalar fix makes visible —
  // it cites that step, and through a different interpreter.
  const withCompile = {
    ...evidence,
    ciCommands: [
      { workflow: "ci.yml", command: "python -m pip install -r backend/requirements-dev.txt" },
      { workflow: "ci.yml", command: "python -m compileall -q backend" },
    ],
  };
  const cited = evidenceForCommand(["python3", "-m", "compileall", "-q", "backend"], withCompile);
  assert.equal(cited?.kind, "ci-step");
  assert.match(cited.detail, /compileall/);

  // A path or a filename is distinctive enough to cite on its own, wherever in the step it appears.
  assert.equal(
    evidenceForCommand(["python3", "-m", "pip", "install", "-r", "backend/requirements-dev.txt"], installOnly)?.kind,
    "ci-step",
  );
  // But a path that only shares a *prefix* with one in the repository is not that path.
  assert.equal(evidenceForCommand(["python3", "-m", "compileall", "backend/main"], installOnly), null);
  assert.equal(evidenceForCommand(["cat", "backend/requirements-dev.txt.bak"], installOnly), null);

  // Half of an `&&`-joined step is still that step.
  const joined = { ...evidence, ciCommands: [{ workflow: "ci.yml", command: "npm run api:types && git diff --exit-code" }] };
  assert.equal(evidenceForCommand(["npm", "run", "api:types"], joined)?.kind, "ci-step");
  // And a neighbouring word from the same step is not.
  assert.equal(evidenceForCommand(["npm", "run", "types"], joined), null);
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

  // A disagreement is raised rather than refused. The claim is a model's prose; the found citation
  // is a fact the harness checked. Refusing here would let phrasing veto a verified fact, so the
  // disagreement goes where the operator is already looking instead.
  assert.equal(parsed.commands[0].evidenceDisagrees, false);
  assert.equal(parsed.commands[1].evidenceDisagrees, true);
  assert.deepEqual(parsed.disagreements, [
    { id: "typecheck", claimed: "invented citation", found: ".github/workflows/ci.yml: npm run typecheck" },
  ]);

  // Wording that differs but names the same thing is agreement, not a disagreement to chase.
  const paraphrased = parseOnboardingProposal(
    proposal([{ id: "lint", command: ["npm", "run", "lint"], evidence: "the lint script in package.json" }]),
    evidence,
  );
  assert.equal(paraphrased.commands[0].evidenceDisagrees, false);
  assert.deepEqual(paraphrased.disagreements, []);
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

test("dispatches the onboarding agent to the provider that owns the default model", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-onboard-provider-"));
  try {
    await writeFile(path.join(directory, "package.json"), JSON.stringify({ scripts: { test: "node --test" } }), "utf8");
    const store = new JsonTaskStore(path.join(directory, "tasks.json"));
    await store.init();

    // The bug this pins: the call hardcoded the Codex provider while passing the operator's
    // default model. Once that default became a Claude id, Codex refused it outright with
    // "not supported when using Codex with a ChatGPT account" — an error about the model, from
    // the wrong runtime, for a stage that had no business choosing a runtime at all.
    const dispatched = [];
    const orchestrator = new TaskOrchestrator(store, {
      getStatus: async () => ({ available: true, authenticated: true }),
      worktreeManager: { repositoryRoot: async (given) => given },
      runCodex: async (request) => {
        dispatched.push(request.model);
        return {
          finalText: `<verification-proposal>${JSON.stringify({ commands: [{ id: "test", command: ["npm", "test"] }] })}</verification-proposal>`,
          usage: { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1, totalTokens: 2 },
        };
      },
    });

    // `runCodex` overrides the resolved provider's run, so this asserts the model that was sent
    // rather than the transport; the provider it resolved is asserted through the model's owner.
    const proposed = await orchestrator.proposeOnboarding(directory);
    assert.equal(proposed.proposal.determined, true);
    const settings = await store.settings();
    assert.equal(dispatched.at(-1), settings.defaultModel);
    assert.equal(providerForModelId(settings.defaultModel), "claude", "the default model is a Claude id, so a Codex-pinned dispatch would fail");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
