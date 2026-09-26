import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Credentials stay local to this checkout; explicit process environment takes precedence.
const linearEnvironment = fileURLToPath(new URL("../../.env.linear.local", import.meta.url));
if (existsSync(linearEnvironment)) process.loadEnvFile(linearEnvironment);

// Research settings (PlanCheck's rate library, the QV source) in a gitignored file beside it, and
// the API loop's keys in a file outside the repository. The companion takes the keys back out of
// its environment at startup and gives them only to the API loop (`server/index.mjs`).
const researchEnvironment = fileURLToPath(new URL("../../.env.research.local", import.meta.url));
if (existsSync(researchEnvironment)) process.loadEnvFile(researchEnvironment);
const researchKeys =
  process.env.RESEARCH_KEYS_FILE ?? path.join(os.homedir(), ".config", "eversor-research.env");
if (existsSync(researchKeys)) process.loadEnvFile(researchKeys);

const port = process.env.FRONTIER_QA_PORT ?? process.env.AGENT_HARNESS_PORT;
process.env.AGENT_HARNESS_PORT = port ?? "4321";

await import("../../server/index.mjs");
