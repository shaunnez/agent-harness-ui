// One run's host tools, opened and closed together: the `ResearchWebTools` that does the work,
// the socket bridge the CLI's relay calls into, and the `--mcp-config` entry that points the
// CLI at the relay. A runtime asks for a session per run and closes it when the run ends.

import process from "node:process";
import { QV_TOOL_NAMES } from "../../qv-plancheck.mjs";
import { extractPdfPages } from "../../research-pdf-text.mjs";
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
  // PlanCheck's rate library (`PlanCheckQvSession`), when it answers the QV tools instead of the
  // local capture. Its calls go through the same bridge, outside the web tools' budget, as the
  // local capture's calls always were.
  qv = null,
}) {
  const webTools = new ResearchWebTools({
    runId,
    budget,
    context,
    captureProvider,
    providerLedgers,
    snapshotDirectory,
    signal,
    // PDFs are read on this machine. Pricing schedules are published as PDFs, and without this
    // the agent's only route to one was a paid capture provider.
    pdfExtractor: extractPdfPages,
    // `tool.called` is dropped: the CLI stream already reports every tool call, with the id
    // that correlates it to its result, and a second copy from here would double-count them.
    // Everything else — above all `source.retrieved` with the retained snapshot — is the
    // host's own evidence and is the authoritative record of what was fetched.
    onEvent: (type, data) => {
      if (type !== "tool.called") emit(type, data);
    },
    ...webToolsOptions,
  });
  const qvTools = qv ? QV_TOOL_NAMES : [];
  const invoker = {
    invoke: (tool, input) => (qvTools.includes(tool) ? qv.invoke(tool, input) : webTools.invoke(tool, input)),
  };
  let bridge;
  try {
    bridge = await openHostToolBridge({
      directory,
      webTools: invoker,
      tools: [...tools, ...qvTools],
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
    qv,
    mcpEntry: tools.length ? { nodeBin, relayPath, socketPath: bridge.socketPath, tools: [...tools] } : null,
    qvEntry: qv ? { nodeBin, relayPath, socketPath: bridge.socketPath, tools: [...qvTools] } : null,
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
