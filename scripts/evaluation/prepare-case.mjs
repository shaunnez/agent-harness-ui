import { execFile } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const exec = promisify(execFile);
const [caseId, sourceRepository, output] = process.argv.slice(2);
if (!caseId || !sourceRepository || !output)
  throw new Error("Usage: prepare-case.mjs <case-id> <source-repository> <new-output-directory>");
const bank = JSON.parse(
  await readFile(new URL("../../evaluations/cases/delivery-v1.json", import.meta.url), "utf8"),
);
const item = bank.cases.find((entry) => entry.id === caseId);
if (!item) throw new Error(`Unknown case: ${caseId}`);
await mkdir(output); // Refuse an existing directory: never destroy a retained trial.
const git = (cwd, args) => exec("git", args, { cwd, maxBuffer: 20_000_000 });
for (const name of ["base", "reference"]) {
  const cwd = path.resolve(output, name);
  await mkdir(cwd);
  await git(cwd, ["init", "--quiet"]);
  await git(cwd, [
    "fetch",
    "--quiet",
    "--depth=1",
    "--no-tags",
    pathToFileURL(path.resolve(sourceRepository)).href,
    item.baseSha,
  ]);
  await git(cwd, ["checkout", "--quiet", "--detach", "FETCH_HEAD"]);
  await rm(path.join(cwd, ".git/FETCH_HEAD"));
  await git(cwd, ["config", "user.name", "Evaluation reference preparation"]);
  await git(cwd, ["config", "user.email", "evaluation@example.invalid"]);
  await git(cwd, ["config", "commit.gpgsign", "false"]);
  if (name === "reference") {
    const { stdout: names } = await git(sourceRepository, [
      "diff",
      "--name-only",
      item.baseSha,
      item.referenceSha,
    ]);
    const files = names
      .trim()
      .split("\n")
      .filter(
        (file) =>
          !/^(docs\/|AGENTS.md$)/.test(file) &&
          (!item.referencePaths || item.referencePaths.some((prefix) => file.startsWith(prefix))),
      );
    const { stdout: patch } = await git(sourceRepository, [
      "diff",
      "--binary",
      item.baseSha,
      item.referenceSha,
      "--",
      ...files,
    ]);
    const patchPath = path.resolve(output, "reference.patch");
    await writeFile(patchPath, patch);
    await git(cwd, ["apply", patchPath]);
    await git(cwd, ["add", "--", ...files]);
    await git(cwd, ["commit", "--quiet", "-m", `Evaluation reference ${caseId} from reviewed change`]);
  }
}
await writeFile(
  path.join(output, "preparation.json"),
  `${JSON.stringify(
    {
      caseId,
      version: item.version,
      baseSha: item.baseSha,
      referenceSha: item.referenceSha,
      preparedAt: new Date().toISOString(),
      inferenceCalls: 0,
    },
    null,
    2,
  )}\n`,
);
console.log(JSON.stringify({ caseId, output, inferenceCalls: 0 }));
