#!/usr/bin/env node
// The MCP stdio server the Claude CLI spawns for the host research tools. A relay, nothing
// more: it lists the tools, and forwards each call over the run's Unix socket to the parent
// process, which does the work (`bridge.mjs`).
//
//   node mcp-server.mjs <socket path> <tool,tool,…>
//
// Dependency-free, like `qv-corpus-server.py`, and deliberately so: it runs inside the CLI's
// process tree, where the rule is that nothing holds a credential or can reach the network on
// its own. It imports one local module, for the tool definitions, and nothing that fetches.
//
// stdout carries JSON-RPC and nothing else. Anything diagnostic goes to stderr, which the CLI
// keeps out of the protocol.

import { createConnection } from "node:net";
import process from "node:process";
import readline from "node:readline";
import { HOST_TOOL_SERVER_NAME, RELAY_TOOL_DEFINITIONS } from "./definitions.mjs";

/** What the CLI negotiated with the recorded Python server. Echoed back when the client asks
 *  for something else, because the tools-only subset used here is unchanged across versions. */
const DEFAULT_PROTOCOL_VERSION = "2024-11-05";

/** A cap on one tool result, as `qv-corpus-server.py` caps its own. The host already bounds
 *  page text at 50,000 characters; this is the backstop for a result that is not page text. */
const MAX_RESULT_CHARACTERS = 60_000;

const [socketPath, toolList = ""] = process.argv.slice(2);
if (!socketPath) {
  process.stderr.write("usage: mcp-server.mjs <socket path> <tool,tool,…>\n");
  process.exit(2);
}
const tools = toolList
  .split(",")
  .map((name) => name.trim())
  .filter((name) => Object.hasOwn(RELAY_TOOL_DEFINITIONS, name));

const pending = new Map();
let sequence = 0;
let connection = null;

function connect() {
  if (connection) return connection;
  connection = new Promise((resolve, reject) => {
    const socket = createConnection(socketPath);
    socket.setEncoding("utf8");
    let buffered = "";
    socket.once("connect", () => resolve(socket));
    socket.once("error", (error) => {
      connection = null;
      reject(error);
      for (const waiter of pending.values()) waiter.reject(error);
      pending.clear();
    });
    socket.on("data", (chunk) => {
      buffered += chunk;
      let newline = buffered.indexOf("\n");
      while (newline !== -1) {
        const line = buffered.slice(0, newline);
        buffered = buffered.slice(newline + 1);
        newline = buffered.indexOf("\n");
        let response;
        try {
          response = JSON.parse(line);
        } catch {
          continue;
        }
        const waiter = pending.get(response?.id);
        if (!waiter) continue;
        pending.delete(response.id);
        waiter.resolve(response);
      }
    });
    socket.on("close", () => {
      connection = null;
      for (const waiter of pending.values()) waiter.reject(new Error("The host tool socket closed."));
      pending.clear();
    });
  });
  return connection;
}

async function callHost(tool, input) {
  const socket = await connect();
  const id = `${process.pid}-${++sequence}`;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    socket.write(`${JSON.stringify({ id, tool, input })}\n`);
  });
}

function send(message) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
}

function text(value) {
  const body = typeof value === "string" ? value : JSON.stringify(value);
  return body.length > MAX_RESULT_CHARACTERS ? `${body.slice(0, MAX_RESULT_CHARACTERS)}…` : body;
}

async function handle(request) {
  const { id, method, params } = request;
  if (method === "initialize")
    return send({
      id,
      result: {
        protocolVersion: params?.protocolVersion ?? DEFAULT_PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: HOST_TOOL_SERVER_NAME, version: "1" },
      },
    });
  if (method === "tools/list")
    return send({
      id,
      result: {
        tools: tools.map((name) => ({ name, ...RELAY_TOOL_DEFINITIONS[name] })),
      },
    });
  if (method === "tools/call") {
    const name = params?.name;
    if (!tools.includes(name))
      return send({
        id,
        result: { content: [{ type: "text", text: `Unknown tool "${name}".` }], isError: true },
      });
    try {
      const response = await callHost(name, params?.arguments ?? {});
      if (response.ok)
        return send({ id, result: { content: [{ type: "text", text: text(response.result) }] } });
      return send({
        id,
        result: { content: [{ type: "text", text: text({ error: response.error }) }], isError: true },
      });
    } catch (error) {
      return send({
        id,
        result: {
          content: [
            { type: "text", text: `The host research tools are unreachable: ${error?.message ?? error}` },
          ],
          isError: true,
        },
      });
    }
  }
  // Notifications carry no id and get no reply. A request for anything else gets an empty
  // result, as the recorded Python server answers it, rather than an error the CLI must handle.
  if (id != null) send({ id, result: {} });
}

const lines = readline.createInterface({ input: process.stdin, crlfDelay: Number.POSITIVE_INFINITY });
lines.on("line", (line) => {
  if (!line.trim()) return;
  let request;
  try {
    request = JSON.parse(line);
  } catch {
    return;
  }
  handle(request).catch((error) => process.stderr.write(`research tools: ${error?.message ?? error}\n`));
});
lines.on("close", () => process.exit(0));
