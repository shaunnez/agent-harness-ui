import { readFileSync } from "node:fs";
import path from "node:path";

const manifestPath = path.join(process.cwd(), ".agent-harness", "verification.json");
const packagePath = path.join(process.cwd(), "package.json");

function readJson(filePath, label) {
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(`Unable to read ${label}: ${error.message}`, { cause: error });
  }
}

function formatArgv(argv) {
  return JSON.stringify(argv) ?? String(argv);
}

function diagnostic(command, reason) {
  const id = typeof command?.id === "string" ? command.id : "<missing id>";
  return `${id}: ${formatArgv(command?.command)} — ${reason}`;
}

function referencedScript(argv) {
  if (!Array.isArray(argv) || argv.some((argument) => typeof argument !== "string")) {
    return { error: "command must be a non-empty argv array of strings" };
  }

  if (argv[0] !== "npm") {
    return { error: "only npm commands are supported" };
  }

  // The existing manifest intentionally uses this npm shorthand and cannot be changed.
  if (argv.length === 2 && argv[1] === "test") {
    return { script: "test" };
  }

  if (argv.length !== 3 || argv[1] !== "run" || argv[2].length === 0) {
    return { error: 'expected ["npm", "run", "<script>"] or ["npm", "test"]' };
  }

  return { script: argv[2] };
}

function verifyManifest() {
  const manifest = readJson(manifestPath, ".agent-harness/verification.json");
  const packageJson = readJson(packagePath, "package.json");

  if (!Array.isArray(manifest.commands)) {
    throw new Error(".agent-harness/verification.json must contain a commands[] array");
  }

  const scripts = packageJson.scripts;
  const failures = [];

  for (const command of manifest.commands) {
    const resolution = referencedScript(command?.command);
    if (resolution.error) {
      failures.push(diagnostic(command, resolution.error));
      continue;
    }

    if (!scripts || typeof scripts !== "object" || !Object.hasOwn(scripts, resolution.script)) {
      failures.push(diagnostic(command, `package.json scripts does not define "${resolution.script}"`));
    }
  }

  if (failures.length > 0) {
    console.error(`Manifest integrity check failed for ${failures.length} command(s):`);
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log(`Verified ${manifest.commands.length} commands in .agent-harness/verification.json.`);
}

try {
  verifyManifest();
} catch (error) {
  console.error(`Manifest integrity check failed: ${error.message}`);
  process.exitCode = 1;
}
