// Grade a committed PlanCheck candidate in a disposable archive and database.
// Hidden checks never enter the delivery checkout or its Git history.
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const exec = promisify(execFile);
const [repository, output] = process.argv.slice(2);
if (!repository || !output) throw new Error("Usage: p05.mjs <candidate-checkout> <new-output-directory>");
const candidate = path.resolve(repository);
const checkerRoot = fileURLToPath(new URL("./p05/", import.meta.url));
const head = (await exec("git", ["rev-parse", "HEAD"], { cwd: candidate })).stdout.trim();
const status = (await exec("git", ["status", "--porcelain"], { cwd: candidate })).stdout.trim();
if (status) throw new Error("Candidate changed before independent grading.");
await mkdir(output);
const workingRoot = await mkdtemp("/private/tmp/p317-grade-");
const checkout = path.join(workingRoot, "candidate");
const archive = path.join(workingRoot, "candidate.tar");
const composeProject = `p317grade${randomUUID().replaceAll("-", "").slice(0, 12)}`;
const checks = [];
let composeStarted = false;
const env = {
  ...process.env,
  COMPOSE_PROJECT_NAME: composeProject,
  POSTGRES_PORT: "0",
  PYTHON_BIN: "backend/.venv/bin/python",
  P317_CANDIDATE_ROOT: checkout,
  PYTHONPATH: checkout,
};

async function run(label, command, args, options = {}) {
  try {
    const result = await exec(command, args, {
      cwd: options.cwd ?? checkout,
      env,
      maxBuffer: 20_000_000,
      timeout: options.timeout ?? 240000,
    });
    await writeFile(path.join(output, `${label}.log`), result.stdout + result.stderr);
    return true;
  } catch (error) {
    const log = `${error.stdout ?? ""}\n${error.stderr ?? ""}`;
    await writeFile(path.join(output, `${label}.log`), log);
    if (error.killed || error.signal || /Cannot connect to the Docker daemon|Could not resolve the published PostgreSQL port/.test(log))
      throw new Error(`${label} apparatus failed: ${error.message}`);
    return false;
  }
}

try {
  await mkdir(checkout);
  await exec("git", ["archive", "--format=tar", "-o", archive, head], { cwd: candidate });
  await exec("tar", ["-xf", archive, "-C", checkout]);
  await rm(archive);
  if (!(await run("install", "make", ["install"], { timeout: 300000 })))
    throw new Error("PlanCheck dependency installation failed in the grader archive.");
  if (!(await run("e2e-install", "npm", ["ci", "--no-audit", "--no-fund"], { cwd: path.join(checkout, "e2e") })))
    throw new Error("Playwright dependency installation failed in the grader archive.");
  await copyFile(path.join(checkerRoot, "p317-hidden.spec.ts"), path.join(checkout, "e2e/tests/p317-hidden.spec.ts"));
  composeStarted = true;
  checks.push({
    id: "postgres-persistence-and-totals",
    passed: await run("postgres", "scripts/run-integration-isolated.sh", [path.join(checkerRoot, "test_p317_pg.py")], { timeout: 360000 }),
  });
  checks.push({
    id: "review-browser-selection",
    passed: await run("browser", "scripts/run-e2e-isolated.sh", ["tests/p317-hidden.spec.ts"], { timeout: 360000 }),
  });
  const result = {
    candidateHeadRevision: head,
    passed: checks.every((check) => check.passed),
    checks,
  };
  await writeFile(path.join(output, "checks.json"), `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify({ head, passed: result.passed, checks }));
  if (!result.passed) process.exitCode = 1;
} finally {
  if (composeStarted) {
    const cleanup = await exec("docker", ["compose", "--env-file", ".env.docker.example", "down", "--volumes"], {
      cwd: checkout,
      env,
      timeout: 60000,
    }).catch((error) => ({ stdout: "", stderr: error.message }));
    await writeFile(path.join(output, "cleanup.log"), cleanup.stdout + cleanup.stderr);
  }
  await rm(workingRoot, { recursive: true, force: true });
  const current = (await exec("git", ["rev-parse", "HEAD"], { cwd: candidate })).stdout.trim();
  if (current !== head) throw new Error("Candidate revision moved during independent grading.");
}
