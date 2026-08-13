import { execFile } from "node:child_process";
import { appendFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);

export async function exportCandidatePatch({ repositoryPath, baseRevision, headRevision, outputPath }) {
  const { stdout } = await exec(
    "git",
    ["diff", "--binary", "--full-index", "--no-ext-diff", baseRevision, headRevision, "--"],
    { cwd: repositoryPath, maxBuffer: 32 * 1024 * 1024 },
  );
  const patch = normalizeUnifiedDiff(stdout);
  if (!patch.trim()) throw new Error("The candidate does not contain an exportable patch.");
  await writeFile(outputPath, patch, "utf8");
  await assertPatchApplies({ repositoryPath, baseRevision, patchPath: outputPath });
  return { outputPath, characters: patch.length };
}

export async function assertPatchApplies({ repositoryPath, baseRevision, patchPath }) {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-patch-check-"));
  const indexPath = path.join(temporaryDirectory, "index");
  try {
    validateUnifiedDiff(await readFile(patchPath, "utf8"));
    await exec("git", ["read-tree", baseRevision], {
      cwd: repositoryPath,
      env: { ...process.env, GIT_INDEX_FILE: indexPath },
    });
    await exec("git", ["apply", "--check", "--cached", patchPath], {
      cwd: repositoryPath,
      env: { ...process.env, GIT_INDEX_FILE: indexPath },
    });
  } catch (error) {
    throw new Error(`Candidate patch failed git apply --check: ${error.stderr?.trim() || error.message}`);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

function validateUnifiedDiff(patch) {
  let inHunk = false;
  const lines = String(patch).split("\n");
  for (const [index, line] of lines.entries()) {
    if (index === lines.length - 1 && line === "") continue;
    if (line.startsWith("@@ ")) {
      inHunk = true;
      continue;
    }
    if (inHunk && line.startsWith("diff --git ")) inHunk = false;
    if (inHunk && line === "") {
      throw new Error(
        "Candidate patch failed git apply --check: a unified-diff hunk contains an unprefixed blank context line.",
      );
    }
    if (inHunk && !/^[ +\\-]/.test(line)) {
      throw new Error(
        `Candidate patch failed git apply --check: invalid unified-diff hunk line ${JSON.stringify(line)}.`,
      );
    }
  }
}

export async function markCampaignReady({ checks, readyPath, label = "READY" }) {
  if (!Array.isArray(checks) || checks.length === 0) {
    throw new Error("READY requires at least one exported candidate patch check.");
  }
  for (const check of checks) await assertPatchApplies(check);
  await writeFile(readyPath, `${label} ${new Date().toISOString()}\n`, "utf8");
}

export async function appendCorrectionEvidence(correctionPath, evidence) {
  const existing = await readFile(correctionPath, "utf8").catch((error) => {
    if (error.code === "ENOENT") return "";
    throw error;
  });
  const entry = JSON.stringify({ ...evidence, appendedAt: new Date().toISOString() });
  await appendFile(correctionPath, `${existing && !existing.endsWith("\n") ? "\n" : ""}${entry}\n`, "utf8");
}

export function normalizeUnifiedDiff(value) {
  const normalized = String(value ?? "")
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "\n");
  return normalized && !normalized.endsWith("\n") ? `${normalized}\n` : normalized;
}
