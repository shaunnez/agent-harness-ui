import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Credentials stay local to this checkout; explicit process environment takes precedence.
const linearEnvironment = fileURLToPath(new URL("../../.env.linear.local", import.meta.url));
if (existsSync(linearEnvironment)) process.loadEnvFile(linearEnvironment);

const port = process.env.FRONTIER_QA_PORT ?? process.env.AGENT_HARNESS_PORT;
process.env.AGENT_HARNESS_PORT = port ?? "4321";

await import("../../server/index.mjs");
