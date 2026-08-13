import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { runProcess } from "./process-runtime.mjs";
import { parseVerificationManifest, VERIFICATION_MANIFEST_PATH } from "./verification.mjs";

const INSPECTION_TIMEOUT_MS = 10_000;

async function git(repositoryPath, args, { required = true } = {}) {
  const result = await runProcess("git", args, {
    cwd: repositoryPath,
    timeoutMs: INSPECTION_TIMEOUT_MS,
    label: "Repository contract inspection",
    stdoutBudgetBytes: 256 * 1024,
  });
  if (required && result.code !== 0) {
    throw new Error(result.stderr.trim() || `git ${args.join(" ")} failed.`);
  }
  return result.code === 0 ? result.stdout.trim() : null;
}

async function optionalFile(filePath) {
  return readFile(filePath, "utf8").catch((error) => {
    if (error?.code === "ENOENT") return null;
    throw error;
  });
}

export async function inspectRepositoryContract(repositoryPath) {
  if (!repositoryPath || !path.isAbsolute(repositoryPath)) {
    throw new Error("Choose an absolute local repository path.");
  }
  const info = await stat(repositoryPath).catch(() => null);
  if (!info?.isDirectory()) throw new Error("The selected repository path is not a readable directory.");

  const requestedPath = await realpath(repositoryPath);
  const rootOutput = await git(requestedPath, ["rev-parse", "--show-toplevel"]);
  const repositoryRoot = await realpath(rootOutput);
  const [branchOutput, headRevision, statusOutput, remoteUrl, agentsFile, verificationFile, nvmrc, nodeVersion, packageFile] = await Promise.all([
    git(repositoryRoot, ["branch", "--show-current"]),
    git(repositoryRoot, ["rev-parse", "HEAD"]),
    git(repositoryRoot, ["status", "--porcelain=v1"]),
    git(repositoryRoot, ["config", "--get", "remote.origin.url"], { required: false }),
    optionalFile(path.join(repositoryRoot, "AGENTS.md")),
    optionalFile(path.join(repositoryRoot, VERIFICATION_MANIFEST_PATH)),
    optionalFile(path.join(repositoryRoot, ".nvmrc")),
    optionalFile(path.join(repositoryRoot, ".node-version")),
    optionalFile(path.join(repositoryRoot, "package.json")),
  ]);

  let verification = {
    path: VERIFICATION_MANIFEST_PATH,
    present: verificationFile != null,
    valid: false,
    commandIds: [],
    error: null,
  };
  if (verificationFile != null) {
    try {
      const manifest = parseVerificationManifest(verificationFile);
      verification = { ...verification, valid: true, commandIds: manifest.commands.map((command) => command.id) };
    } catch (error) {
      verification = { ...verification, error: error instanceof Error ? error.message : "Verification manifest is invalid." };
    }
  }

  const runtimeDeclarations = [];
  if (nvmrc?.trim()) runtimeDeclarations.push({ source: ".nvmrc", value: nvmrc.trim() });
  if (nodeVersion?.trim()) runtimeDeclarations.push({ source: ".node-version", value: nodeVersion.trim() });
  if (packageFile != null) {
    try {
      const packageJson = JSON.parse(packageFile);
      if (typeof packageJson?.engines?.node === "string") {
        runtimeDeclarations.push({ source: "package.json engines.node", value: packageJson.engines.node });
      }
      if (typeof packageJson?.packageManager === "string") {
        runtimeDeclarations.push({ source: "package.json packageManager", value: packageJson.packageManager });
      }
    } catch {
      runtimeDeclarations.push({ source: "package.json", value: "Invalid JSON" });
    }
  }

  const normalizedRemote = remoteUrl || null;
  return {
    repositoryRoot,
    git: {
      branch: branchOutput || "detached HEAD",
      headRevision,
      clean: !statusOutput,
    },
    instructions: { path: "AGENTS.md", present: agentsFile != null },
    verification,
    runtime: { declarations: runtimeDeclarations },
    delivery: {
      remoteUrl: normalizedRemote,
      github: Boolean(normalizedRemote && /(?:github\.com[:/])/i.test(normalizedRemote)),
    },
  };
}
