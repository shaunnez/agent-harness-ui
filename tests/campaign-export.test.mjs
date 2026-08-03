import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import {
  appendCorrectionEvidence,
  assertPatchApplies,
  exportCandidatePatch,
  markCampaignReady,
} from "../server/campaign-export.mjs";

const exec = promisify(execFile);

test("exports apply-checkable patches and gates READY without rewriting blind scores", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-campaign-export-"));
  const repository = path.join(directory, "repository");
  try {
    await git(directory, ["init", "repository"]);
    await git(repository, ["config", "user.name", "Agent Harness Test"]);
    await git(repository, ["config", "user.email", "agent-harness@example.test"]);
    const sourcePath = path.join(repository, "source.txt");
    await writeFile(sourcePath, "alpha\n\nomega\n", "utf8");
    await git(repository, ["add", "source.txt"]);
    await git(repository, ["commit", "-m", "base"]);
    const baseRevision = (await git(repository, ["rev-parse", "HEAD"])).stdout.trim();
    await writeFile(sourcePath, "alpha\n\ncorrected\n", "utf8");
    await git(repository, ["commit", "-am", "candidate"]);
    const headRevision = (await git(repository, ["rev-parse", "HEAD"])).stdout.trim();
    const patchPath = path.join(directory, "candidate.diff");
    await exportCandidatePatch({ repositoryPath: repository, baseRevision, headRevision, outputPath: patchPath });
    const patch = await readFile(patchPath, "utf8");
    assert.match(patch, /\n \n/, "blank hunk context must retain its unified-diff prefix");
    await assertPatchApplies({ repositoryPath: repository, baseRevision, patchPath });

    const malformedPath = path.join(directory, "malformed.diff");
    await writeFile(malformedPath, patch.replace("\n \n", "\n\n"), "utf8");
    await assert.rejects(
      () => assertPatchApplies({ repositoryPath: repository, baseRevision, patchPath: malformedPath }),
      /failed git apply --check/i,
    );

    const readyPath = path.join(directory, "READY");
    await markCampaignReady({ checks: [{ repositoryPath: repository, baseRevision, patchPath }], readyPath });
    assert.match(await readFile(readyPath, "utf8"), /^READY /);

    const blindScoresPath = path.join(directory, "blind-scores.md");
    const lockedScores = "Locked blind score: 3.67\n";
    await writeFile(blindScoresPath, lockedScores, "utf8");
    const correctionsPath = path.join(directory, "corrections.jsonl");
    await appendCorrectionEvidence(correctionsPath, { candidate: "I", correction: "Patch serialization repaired" });
    await appendCorrectionEvidence(correctionsPath, { candidate: "B", correction: "Apply check recorded" });
    assert.equal(await readFile(blindScoresPath, "utf8"), lockedScores);
    assert.equal((await readFile(correctionsPath, "utf8")).trim().split("\n").length, 2);
  } finally {
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

function git(cwd, args) {
  return exec("git", args, { cwd, windowsHide: true });
}
