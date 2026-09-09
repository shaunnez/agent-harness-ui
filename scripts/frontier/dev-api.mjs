const port = process.env.FRONTIER_QA_PORT ?? process.env.AGENT_HARNESS_PORT;
process.env.AGENT_HARNESS_PORT = port ?? "4321";

await import("../../server/index.mjs");
