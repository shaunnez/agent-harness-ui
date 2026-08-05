import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  parsePlaywrightJsonReport,
  parseVerificationManifest,
  readVerificationManifest,
  resolveReportPath,
  runRepositoryVerification,
  VERIFICATION_MANIFEST_PATH,
  verificationSummaryCommand,
} from "../server/verification.mjs";
import { validateFocusedTestEvidence } from "../server/structured-output.mjs";

const candidate = { id: "AH-001", revisionNumber: 2, headRevision: "a".repeat(40) };
const manifest = (commands) => parseVerificationManifest(JSON.stringify({ version: 1, commands }));

test("reads verification commands from the repository and refuses a shell string", () => {
  const parsed = manifest([
    { id: "test", title: "Unit tests", command: ["npm", "test"] },
    { id: "e2e", command: ["npx", "playwright", "test"], report: { format: "playwright-json", outputFile: "report.json" } },
  ]);
  assert.equal(parsed.commands.length, 2);
  assert.deepEqual(parsed.commands[0].command, ["npm", "test"]);
  // A missing title falls back to the id rather than to nothing, so every row is nameable.
  assert.equal(parsed.commands[1].title, "e2e");
  assert.deepEqual(parsed.commands[1].report, { format: "playwright-json", outputFile: "report.json" });

  // The tempting shape, refused with the reason: a shell string can expand, chain and
  // substitute what the manifest does not say, so what ran would not be what was declared.
  assert.throws(
    () => manifest([{ id: "test", command: "npm test && rm -rf /" }]),
    /argv array, not a string/,
  );
  assert.throws(() => manifest([{ id: "test", command: [] }]), /non-empty argv array/);
  assert.throws(() => manifest([{ id: "test", command: ["npm", ""] }]), /non-empty strings/);
  assert.throws(() => manifest([{ id: "Test", command: ["npm"] }]), /lowercase id/);
  assert.throws(
    () => manifest([{ id: "a", command: ["x"] }, { id: "a", command: ["y"] }]),
    /repeats command id a/,
  );
  assert.throws(() => parseVerificationManifest('{"version":2,"commands":[]}'), /"version": 1/);
  assert.throws(() => parseVerificationManifest("{not json"), /not valid JSON/);
  assert.throws(() => parseVerificationManifest('{"version":1,"commands":[]}'), /non-empty commands array/);
});

test("refuses a report format the harness cannot check, rather than downgrading silently", () => {
  // A manifest that believes it is machine-checked must not be quietly believed on its exit
  // code alone — that is the difference between verified and assumed.
  assert.throws(
    () => manifest([{ id: "e2e", command: ["x"], report: { format: "junit-xml", outputFile: "r.xml" } }]),
    /not one the harness can parse/,
  );
  assert.throws(
    () => manifest([{ id: "e2e", command: ["x"], report: { format: "playwright-json" } }]),
    /needs an outputFile/,
  );
  assert.throws(
    () => manifest([{ id: "e2e", command: ["x"], report: { format: "playwright-json", outputFile: "/etc/passwd" } }]),
    /must be repository-relative/,
  );
  // Traversal is refused at resolve time too, since the manifest is repository content.
  assert.throws(() => resolveReportPath("/tmp/wt", "../../escape.json"), /resolves outside the candidate worktree/);
  assert.equal(resolveReportPath("/tmp/wt", "out/report.json"), path.resolve("/tmp/wt/out/report.json"));
});

test("decides a Playwright report from its own totals, and fails closed on a suite that ran nothing", () => {
  const ok = parsePlaywrightJsonReport(JSON.stringify({ stats: { expected: 12, unexpected: 0, flaky: 0, skipped: 1 } }));
  assert.equal(ok.passed, true);
  assert.match(ok.detail, /12 expected/);

  assert.equal(parsePlaywrightJsonReport(JSON.stringify({ stats: { expected: 4, unexpected: 1 } })).passed, false);
  // Flaky is not a pass: a test that only sometimes holds has not established anything.
  assert.equal(parsePlaywrightJsonReport(JSON.stringify({ stats: { expected: 4, flaky: 2 } })).passed, false);

  // Zero tests is the failure a misconfigured filter produces, and it must not read as green.
  const empty = parsePlaywrightJsonReport(JSON.stringify({ stats: { expected: 0 } }));
  assert.equal(empty.passed, false);
  assert.match(empty.detail, /no tests at all/);

  assert.throws(() => parsePlaywrightJsonReport("{}"), /does not look like a Playwright JSON report/);
  assert.throws(() => parsePlaywrightJsonReport("nope"), /not valid JSON/);
});

test("refuses the stage when the repository declares no verification commands", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-verify-"));
  try {
    // Refused rather than fallen back to a model-chosen command. A fallback would give the
    // harness evidence it cannot check while looking exactly like evidence it can.
    await assert.rejects(() => readVerificationManifest(directory), /declares no verification commands/);
    await assert.rejects(() => readVerificationManifest(directory), new RegExp(VERIFICATION_MANIFEST_PATH.replace(/\\/g, "\\\\")));

    await mkdir(path.join(directory, ".agent-harness"), { recursive: true });
    await writeFile(
      path.join(directory, VERIFICATION_MANIFEST_PATH),
      JSON.stringify({ version: 1, commands: [{ id: "test", command: ["npm", "test"] }] }),
      "utf8",
    );
    const parsed = await readVerificationManifest(directory);
    assert.deepEqual(parsed.commands[0].command, ["npm", "test"]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("produces evidence the existing contract accepts, from what the harness observed", async () => {
  const parsed = manifest([
    { id: "lint", command: ["npm", "run", "lint"] },
    { id: "test", command: ["npm", "test"] },
  ]);
  const evidence = await runRepositoryVerification({
    worktreePath: "/tmp/wt",
    candidate,
    manifest: parsed,
    now: () => "2026-08-05T00:00:00.000Z",
    readHeadRevision: async () => candidate.headRevision,
    runCommand: async ({ command }) => ({
      id: command.id,
      candidateId: candidate.id,
      candidateRevision: candidate.revisionNumber,
      bindingExplicit: true,
      title: command.title,
      command: command.command.join(" "),
      status: "passed",
      durationMs: 5,
    }),
  });

  // The point of the change: same shape, same validator, different source. Nothing here came
  // from a model, and the contract did not have to move to accommodate that.
  assert.equal(validateFocusedTestEvidence(evidence, candidate), evidence);
  assert.equal(evidence.status, "passed");
  assert.equal(evidence.bindingExplicit, true);
  assert.equal(evidence.rows.length, 2);
  // Bound to the exact commit the commands ran against, read rather than taken on trust.
  assert.equal(evidence.headRevision, candidate.headRevision);
  assert.match(evidence.command, /^\.agent-harness/);
  assert.equal(verificationSummaryCommand(parsed), `${parsed.source}: lint, test`);
});

test("stops at the first failure and says which commands never ran", async () => {
  const parsed = manifest([
    { id: "lint", command: ["npm", "run", "lint"] },
    { id: "test", command: ["npm", "test"] },
    { id: "build", command: ["npm", "run", "build"] },
  ]);
  const evidence = await runRepositoryVerification({
    worktreePath: "/tmp/wt",
    candidate,
    manifest: parsed,
    readHeadRevision: async () => candidate.headRevision,
    runCommand: async ({ command }) => ({
      id: command.id,
      candidateId: candidate.id,
      candidateRevision: candidate.revisionNumber,
      bindingExplicit: true,
      command: command.command.join(" "),
      status: command.id === "lint" ? "passed" : "failed",
      durationMs: 1,
      failureDetails: command.id === "test" ? "npm test exited 1." : null,
    }),
  });
  assert.equal(evidence.status, "failed");
  // Later commands would run against a tree the failing one may have left in a state nobody
  // declared, and the verdict is already decided.
  assert.deepEqual(evidence.executedCommandIds, ["lint", "test"]);
  assert.deepEqual(evidence.declaredCommandIds, ["lint", "test", "build"]);
  assert.equal(validateFocusedTestEvidence(evidence, candidate), evidence);
});

test("refuses to attribute evidence to a revision the worktree is not at", async () => {
  const parsed = manifest([{ id: "test", command: ["npm", "test"] }]);
  const run = (readHeadRevision) => runRepositoryVerification({
    worktreePath: "/tmp/wt",
    candidate,
    manifest: parsed,
    readHeadRevision,
    runCommand: async () => ({ id: "test", candidateId: candidate.id, candidateRevision: 2, bindingExplicit: true, command: "npm test", status: "passed" }),
  });

  // Evidence that does not name the tree it came from is evidence about nothing.
  await assert.rejects(() => run(async () => "b".repeat(40)), /would describe a different commit/);
  await assert.rejects(
    () => runRepositoryVerification({ worktreePath: "/tmp/wt", candidate: { id: "AH-1", revisionNumber: 1 }, manifest: parsed }),
    /recorded head revision/,
  );

  // Checked again after the commands, because the test stage is expected to dirty its
  // worktree: a commit that moved mid-run would leave the rows describing two trees.
  let calls = 0;
  await assert.rejects(
    () => run(async () => (++calls === 1 ? candidate.headRevision : "c".repeat(40))),
    /would describe a different commit/,
  );
});
