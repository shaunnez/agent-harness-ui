import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { runProcess } from "./process-runtime.mjs";
import { parseVerificationManifest, VERIFICATION_MANIFEST_PATH } from "./verification.mjs";

const INSPECTION_TIMEOUT_MS = 10_000;

async function git(repositoryPath, args, { required = true } = {}) {
  let result;
  try {
    result = await runProcess("git", args, {
      cwd: repositoryPath,
      timeoutMs: INSPECTION_TIMEOUT_MS,
      label: "Repository contract inspection",
      stdoutBudgetBytes: 256 * 1024,
    });
  } catch (error) {
    error.statusCode ??= 503;
    throw error;
  }
  if (required && result.code !== 0) {
    const error = new Error(result.stderr.trim() || `git ${args.join(" ")} failed.`);
    error.code = "REPOSITORY_INSPECTION_FAILED";
    error.statusCode = 502;
    throw error;
  }
  return result.code === 0 ? result.stdout.trim() : null;
}

async function discoverDeliveryRemote(repositoryRoot) {
  const names =
    (await git(repositoryRoot, ["remote"], { required: false }))
      ?.split(/\r?\n/)
      .map((value) => value.trim())
      .filter(Boolean) ?? [];
  const ordered = ["origin", ...names.filter((name) => name !== "origin")];
  for (const name of ordered) {
    const remoteUrl = await git(repositoryRoot, ["remote", "get-url", name], { required: false });
    if (remoteUrl && /(?:github\.com[:/])/i.test(remoteUrl)) {
      return { remoteName: name, remoteUrl };
    }
  }
  return { remoteName: null, remoteUrl: null };
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
  const [
    branchOutput,
    headRevision,
    statusOutput,
    deliveryRemote,
    agentsFile,
    verificationFile,
    nvmrc,
    nodeVersion,
    packageFile,
  ] = await Promise.all([
    git(repositoryRoot, ["branch", "--show-current"]),
    git(repositoryRoot, ["rev-parse", "HEAD"]),
    git(repositoryRoot, ["status", "--porcelain=v1"]),
    discoverDeliveryRemote(repositoryRoot),
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
      verification = {
        ...verification,
        valid: true,
        commandIds: manifest.commands.map((command) => command.id),
      };
    } catch (error) {
      verification = {
        ...verification,
        error: error instanceof Error ? error.message : "Verification manifest is invalid.",
      };
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
        runtimeDeclarations.push({
          source: "package.json packageManager",
          value: packageJson.packageManager,
        });
      }
    } catch {
      runtimeDeclarations.push({ source: "package.json", value: "Invalid JSON" });
    }
  }

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
      remoteName: deliveryRemote.remoteName,
      remoteUrl: deliveryRemote.remoteUrl,
      github: Boolean(deliveryRemote.remoteUrl),
    },
  };
}
