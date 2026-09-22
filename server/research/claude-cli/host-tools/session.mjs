// One run's host tools, opened and closed together: the `ResearchWebTools` that does the work,
// the socket bridge the CLI's relay calls into, and the `--mcp-config` entry that points the
// CLI at the relay. A runtime asks for a session per run and closes it when the run ends.

import process from "node:process";
import { DEFAULT_RESEARCH_SOURCE_DIRECTORY, ResearchWebTools } from "../../research-web-tools.mjs";
import { openHostToolBridge } from "./bridge.mjs";

export async function openHostToolSession({
  runId,
  budget,
  context = [],
  directory,
  tools,
  signal,
  snapshotDirectory = DEFAULT_RESEARCH_SOURCE_DIRECTORY,
  captureProvider = null,
  providerLedgers = [],
  webToolsOptions = {},
  nodeBin = process.execPath,
  relayPath = undefined,
  emit = () => {},
  onTerminal = () => {},
}) {
  const webTools = new ResearchWebTools({
    runId,
    budget,
    context,
    captureProvider,
    providerLedgers,
    snapshotDirectory,
    signal,
    // `tool.called` is dropped: the CLI stream already reports every tool call, with the id
    // that correlates it to its result, and a second copy from here would double-count them.
    // Everything else — above all `source.retrieved` with the retained snapshot — is the
    // host's own evidence and is the authoritative record of what was fetched.
    onEvent: (type, data) => {
      if (type !== "tool.called") emit(type, data);
    },
    ...webToolsOptions,
  });
  let bridge;
  try {
    bridge = await openHostToolBridge({
      directory,
      webTools,
      tools,
      onTerminal,
      onLog: (message) => emit("log", { message }),
    });
  } catch (error) {
    webTools.close();
    throw error;
  }
  let providerAccounting = null;
  return {
    webTools,
    mcpEntry: { nodeBin, relayPath, socketPath: bridge.socketPath, tools: [...tools] },
    terminal: () => bridge.terminal(),
    /** Close the socket and settle provider accounting. Safe to call twice. */
    async close() {
      if (providerAccounting) return providerAccounting;
      providerAccounting = webTools.close();
      await bridge.close();
      return providerAccounting;
    },
  };
}
