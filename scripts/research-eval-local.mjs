#!/usr/bin/env node
// Runs `research-eval.mjs` with the `research-api` preview's environment from this machine's
// `.claude/launch.json` (the PlanCheck API, token command and token file). The launch file's
// machine-specific lines are never committed; this script only reads them.
//
//   node scripts/research-eval-local.mjs --arm A2 [--only id,id]

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const launch = JSON.parse(readFileSync(path.join(root, ".claude", "launch.json"), "utf8"));
const preview = launch.configurations.find((entry) => entry.name === "research-api");
if (!preview?.env) throw new Error("No research-api configuration with an env in .claude/launch.json.");
const env = { ...process.env, ...preview.env };
// The eval runs on PlanCheck's library; the local capture path must not select the local file.
delete env.RESEARCH_QV_INDEX;
env.RESEARCH_QV_SOURCE = "plancheck";
if (env.RESEARCH_PLANCHECK_TOKEN_FILE && !path.isAbsolute(env.RESEARCH_PLANCHECK_TOKEN_FILE))
  env.RESEARCH_PLANCHECK_TOKEN_FILE = path.join(root, env.RESEARCH_PLANCHECK_TOKEN_FILE);
const result = spawnSync(
  process.execPath,
  [path.join(root, "scripts", "research-eval.mjs"), ...process.argv.slice(2)],
  {
    cwd: root,
    env,
    stdio: "inherit",
  },
);
process.exit(result.status ?? 1);
