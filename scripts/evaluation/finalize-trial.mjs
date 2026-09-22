import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { normalizeEvaluationInput } from "../../server/evaluation.mjs";
import { candidateBinding } from "../../server/evaluation-outcomes.mjs";
import { SqliteTaskStore } from "../../server/sqlite-store.mjs";
import { loadEvaluationCase } from "./case-contract.mjs";

const exec = promisify(execFile);
const root = fileURLToPath(new URL("../../", import.meta.url));
const [directory] = process.argv.slice(2);
if (!directory) throw new Error("Usage: finalize-trial.mjs <private-trial-directory>");
const config = JSON.parse(await readFile(path.join(directory, "config.json"), "utf8"));
const caseId = config.taskInput.experiment.evaluationContract.caseId;
const selectedCase = await loadEvaluationCase(caseId);
if (config.playwrightModule) process.env.EVAL_PLAYWRIGHT_MODULE = config.playwrightModule;
await readFile(path.join(directory, "delivery-ended.json"), "utf8");
const taskId = (await readFile(path.join(directory, "task-id.txt"), "utf8")).trim();
const store = new SqliteTaskStore(path.join(directory, "tasks.sqlite3"));
await store.init();
try {
  const task = await store.get(taskId);
  const candidate = task.candidates?.at(-1);
  if (!candidate?.headRevision) {
    console.log(JSON.stringify({ trial: config.trialId, status: "failed", reason: "no candidate" }));
  } else {
    if (task.activeRunIds?.length || task.activeRunKind) throw new Error("Delivery still has an active run.");
    const git = (args) => exec("git", args, { cwd: candidate.worktreePath });
    const head = (await git(["rev-parse", "HEAD"])).stdout.trim();
    const clean = (await git(["status", "--porcelain"])).stdout.trim();
    if (head !== candidate.headRevision || clean)
      throw new Error("Candidate identity or cleanliness drifted before grading.");
    const gradeRoot = path.join(directory, "independent-grade");
    await mkdir(gradeRoot);
    const checksDirectory =
      selectedCase.graderOutput === "directory" ? path.join(gradeRoot, "behavior") : gradeRoot;
    const checksFile = path.join(checksDirectory, "checks.json");
    const gradingProfile = path.join(gradeRoot, "checks.sb");
    // Repository imports/tests cannot access the private reference or other candidates.
    const originalProfile = await readFile(config.workerProfile, "utf8");
    await writeFile(
      gradingProfile,
      originalProfile
        .split("\n")
        .filter((line) => !line.includes(path.join(root, "evaluations")))
        .join("\n"),
    );
    try {
      const result = await exec(
        "/usr/bin/sandbox-exec",
        [
          "-f",
          gradingProfile,
          process.execPath,
          path.join(root, selectedCase.grader),
          candidate.worktreePath,
          selectedCase.graderOutput === "directory" ? checksDirectory : checksFile,
        ],
        { cwd: candidate.worktreePath, env: process.env, maxBuffer: 5_000_000, timeout: 180000 },
      );
      await writeFile(path.join(gradeRoot, "checks.log"), result.stdout + result.stderr);
    } catch (error) {
      await writeFile(path.join(gradeRoot, "checks.log"), `${error.stdout ?? ""}\n${error.stderr ?? ""}`);
      if (error.code !== 1) throw error;
    }
    const checks = JSON.parse(await readFile(checksFile, "utf8"));
    let rubricPassed = false;
    if (checks.passed) {
      const { rubric } = selectedCase;
      const result = await exec(
        process.execPath,
        [
          path.join(root, "scripts/evaluation/grade-rubric.mjs"),
          candidate.worktreePath,
          config.taskInput.experiment.frozenBaseSha,
          path.join(gradeRoot, "rubric"),
          caseId,
        ],
        { cwd: root, env: process.env, maxBuffer: 5_000_000, timeout: rubric.maxWallTimeMs + 30000 },
      );
      await writeFile(path.join(gradeRoot, "rubric.log"), result.stdout + result.stderr);
      const grade = JSON.parse(await readFile(path.join(gradeRoot, "rubric/grade.json"), "utf8"));
      if (grade.headRevision !== candidate.headRevision)
        throw new Error("Rubric candidate identity drifted.");
      rubricPassed = grade.grade.passed;
    }
    if (
      (await git(["rev-parse", "HEAD"])).stdout.trim() !== head ||
      (await git(["status", "--porcelain"])).stdout.trim()
    )
      throw new Error("Candidate changed during independent grading.");
    const contract = task.experiment.evaluationContract;
    await store.update(taskId, (draft) => {
      draft.evaluation = normalizeEvaluationInput(
        {
          trial: {
            ...draft.evaluation.trial,
            reason:
              checks.passed && rubricPassed
                ? "Independent behavior and rubric checks passed"
                : "Independent acceptance rejected the candidate",
            acceptance: {
              ...candidateBinding(draft),
              caseVersion: contract.caseVersion,
              graderVersion: contract.graderVersion,
              rubricVersion: contract.rubricVersion,
              outcome: checks.passed && rubricPassed ? "accepted" : "rejected",
              rubricPassed,
              checks: checks.checks,
            },
          },
        },
        draft.evaluation,
        draft,
      );
    });
    console.log(
      JSON.stringify({ trial: config.trialId, candidate: head, checks: checks.passed, rubricPassed }),
    );
  }
  await writeFile(path.join(directory, "task.json"), JSON.stringify(await store.get(taskId), null, 2));
} finally {
  store.close();
}
