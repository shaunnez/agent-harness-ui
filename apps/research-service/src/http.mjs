// The research service's HTTP surface.
//
//   GET  /healthz                    no credential: up, which database, what the pacer has learned
//   POST /v1/batches                 PlanCheck sends items to research       (client token)
//   GET  /v1/batches/:id             a batch's items and answers             (client token)
//   GET  /v1/batches?batchId=…       the same, by PlanCheck's own batch id   (client token)
//   /api/research/…                  the review console's routes, from the engine (loopback only)
//   GET  /api/research/console       the engine, runs per question and pacing   (loopback only)
//   GET  /…                          the review console itself, dist/research-console (loopback only)
//
// A client token is compared by its SHA-256 against the configured hashes, in constant time. A
// client sees only its own batches. The console routes have no sign-in until Phase 5, so they
// answer only when the service listens on loopback, and only to a request whose Host is loopback.

import { timingSafeEqual } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { createResearchRoutes } from "@eversor/research-engine/research-routes.mjs";
import { describeBatch, tokenSha256, validateBatch } from "./batches.mjs";

const MAX_BODY_BYTES = 1_000_000;
const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".glb": "model/gltf-binary",
  ".gltf": "model/gltf+json",
  ".bin": "application/octet-stream",
  ".wasm": "application/wasm",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".mp3": "audio/mpeg",
  ".mp4": "video/mp4",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
};

export function createServiceServer({
  config,
  batches,
  questions,
  research,
  projects,
  pacer,
  db,
  log = () => {},
}) {
  const consoleRoutes = config.consoleEnabled
    ? createResearchRoutes({ researchService: research, researchQuestions: questions, send, readJson })
    : null;

  async function handle(request, response) {
    const url = new URL(request.url ?? "/", "http://research.invalid");
    if (url.pathname === "/healthz" && request.method === "GET") {
      await db.query("SELECT 1");
      return send(response, 200, { ok: true, database: db.kind, pacing: pacer.snapshot() });
    }

    if (url.pathname === "/v1/batches" || url.pathname.startsWith("/v1/batches/")) {
      const client = authenticate(request, config.clients);
      if (!client) return send(response, 401, { error: "Send a valid client token as a Bearer credential." });
      return batchRoute(request, response, url, client);
    }

    if (url.pathname.startsWith("/api/research/")) {
      if (!consoleRoutes || !loopbackHost(request.headers.host) || !sameOrigin(request))
        return send(response, 404, { error: "Not found." });
      if (url.pathname === "/api/research/projects" && request.method === "GET")
        return send(response, 200, { projects: await projects.list() });
      if (url.pathname === "/api/research/console" && request.method === "GET")
        return send(response, 200, {
          engine: { runtime: "api-loop", model: config.model, reasoning: "default" },
          runsPerQuestion: config.runsPerQuestion,
          pacing: pacer.snapshot(),
        });
      if (request.method !== "GET" && !isJson(request)) return send(response, 415, { error: "Send JSON." });
      if (await consoleRoutes(request, response, url)) return;
    }
    if (
      consoleRoutes &&
      (request.method === "GET" || request.method === "HEAD") &&
      !url.pathname.startsWith("/api/") &&
      !url.pathname.startsWith("/v1/") &&
      loopbackHost(request.headers.host)
    )
      return serveConsole(request, response, url, config.consoleDirectory);
    return send(response, 404, { error: "Not found." });
  }

  async function batchRoute(request, response, url, client) {
    if (url.pathname === "/v1/batches" && request.method === "POST") {
      if (!isJson(request)) return send(response, 415, { error: "Send JSON." });
      const input = validateBatch(await readJson(request));
      const { batch, created } = await batches.create(client, input);
      log(created ? "batch received" : "batch resent", { batch: batch.id, client, items: batch.itemCount });
      // 201 for a new batch; 200 when this client already sent this batch id, which is returned
      // as it stands, whatever this delivery held.
      return send(response, created ? 201 : 200, {
        batch: await describeBatch(batch, await batches.items(batch.id), questions),
        created,
      });
    }
    if (url.pathname === "/v1/batches" && request.method === "GET") {
      const externalId = url.searchParams.get("batchId");
      if (!externalId) return send(response, 400, { error: "Ask for a batch by its batchId." });
      const batch = await batches.findByExternalId(client, externalId);
      if (!batch) return send(response, 404, { error: "Batch not found." });
      return send(response, 200, {
        batch: await describeBatch(batch, await batches.items(batch.id), questions),
      });
    }
    const match = url.pathname.match(/^\/v1\/batches\/([^/]+)$/);
    if (match && request.method === "GET") {
      const batch = await batches.get(decodeURIComponent(match[1]));
      // Another client's batch reads as missing, not forbidden: its id says nothing.
      if (!batch || batch.client !== client) return send(response, 404, { error: "Batch not found." });
      return send(response, 200, {
        batch: await describeBatch(batch, await batches.items(batch.id), questions),
      });
    }
    return send(response, 404, { error: "Not found." });
  }

  return createServer((request, response) => {
    handle(request, response).catch((error) => {
      const status =
        Number(error?.statusCode) >= 400 && Number(error?.statusCode) < 600 ? Number(error.statusCode) : 500;
      if (status >= 500) log("request failed", { path: request.url, error: error?.message });
      if (!response.headersSent)
        send(response, status, {
          error: status >= 500 ? "The research service failed on this request." : error.message,
        });
      else response.end();
    });
  });
}

/**
 * The built review console, from `directory` (dist/research-console). A path with no file
 * extension is a route inside the app and gets index.html; a missing asset is a 404. Nothing
 * outside the directory is reachable.
 */
async function serveConsole(request, response, url, directory) {
  let relative;
  try {
    relative = decodeURIComponent(url.pathname).replace(/^\/+/, "");
  } catch {
    return send(response, 400, { error: "Bad path." });
  }
  const root = path.resolve(directory);
  let file = path.resolve(root, relative || "index.html");
  if (file !== root && !file.startsWith(root + path.sep)) return send(response, 404, { error: "Not found." });
  let info = await stat(file).catch(() => null);
  if (info?.isDirectory()) {
    file = path.join(file, "index.html");
    info = await stat(file).catch(() => null);
  }
  if (!info && !path.extname(file)) {
    file = path.join(root, "index.html");
    info = await stat(file).catch(() => null);
  }
  if (!info?.isFile())
    return send(response, 404, {
      error: relative ? "Not found." : "The review console is not built. Run npm run build:research-console.",
    });
  const index = path.basename(file) === "index.html";
  response.writeHead(200, {
    "content-type": CONTENT_TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream",
    "content-length": info.size,
    // Vite names built assets by content hash, so they never change under the same name.
    "cache-control": index
      ? "no-cache"
      : relative.startsWith("assets/")
        ? "public, max-age=31536000, immutable"
        : "public, max-age=3600",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "no-referrer",
  });
  if (request.method === "HEAD") return response.end();
  response.end(await readFile(file));
}

/** The client a Bearer token belongs to, or null. */
export function authenticate(request, clients) {
  const header = String(request.headers.authorization ?? "");
  const match = header.match(/^Bearer\s+(\S{16,512})$/);
  if (!match) return null;
  const presented = Buffer.from(tokenSha256(match[1]), "hex");
  let found = null;
  // Every configured hash is compared, so the time taken says nothing about which one matched.
  for (const client of clients) {
    const expected = Buffer.from(client.tokenSha256, "hex");
    if (expected.length === presented.length && timingSafeEqual(expected, presented)) found = client.name;
  }
  return found;
}

function loopbackHost(host) {
  const name = String(host ?? "")
    .replace(/:\d+$/, "")
    .replace(/^\[|\]$/g, "");
  return name === "127.0.0.1" || name === "localhost" || name === "::1";
}

/** A browser sends Origin on cross-site requests; one from anywhere but loopback is refused. */
function sameOrigin(request) {
  const origin = request.headers.origin;
  if (!origin) return true;
  try {
    return loopbackHost(new URL(origin).host);
  } catch {
    return false;
  }
}

function isJson(request) {
  return /^application\/json\b/i.test(String(request.headers["content-type"] ?? ""));
}

export function send(response, status, body) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  response.end(JSON.stringify(body));
}

export async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES)
      throw Object.assign(new Error("The request body is too large."), { statusCode: 413 });
    chunks.push(chunk);
  }
  if (!size) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw Object.assign(new Error("The request body is not JSON."), { statusCode: 400 });
  }
}
