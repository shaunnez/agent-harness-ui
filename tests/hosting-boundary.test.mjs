import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, request as httpRequest } from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { assertHttpBoundary, corsHeaders, httpBoundaryFromEnvironment } from "../server/http-security.mjs";
import { createStaticUi } from "../server/static-ui.mjs";

const TOKEN = "csrf";

function request({ host, origin, method = "GET", csrf = TOKEN, contentType = "application/json" }) {
  return {
    method,
    headers: {
      host,
      ...(origin ? { origin } : {}),
      "content-type": contentType,
      "x-agent-harness-csrf": csrf,
    },
  };
}

test("the default boundary is loopback-only, as before", () => {
  assert.doesNotThrow(() => assertHttpBoundary(request({ host: "127.0.0.1:4321" }), TOKEN));
  assert.doesNotThrow(() => assertHttpBoundary(request({ host: "localhost:4321" }), TOKEN));
  assert.throws(
    () => assertHttpBoundary(request({ host: "harness.example.ts.net" }), TOKEN),
    /only accepts loopback hosts/,
  );
  assert.throws(
    () => assertHttpBoundary(request({ host: "127.0.0.1:4321", origin: "https://evil.example" }), TOKEN),
    /origin is not allowed/,
  );
});

test("a page served by the companion itself may mutate from its own origin", () => {
  assert.doesNotThrow(() =>
    assertHttpBoundary(
      request({ host: "127.0.0.1:4321", origin: "http://127.0.0.1:4321", method: "POST" }),
      TOKEN,
    ),
  );
  assert.doesNotThrow(() =>
    assertHttpBoundary(
      request({ host: "localhost:4321", origin: "http://localhost:4321", method: "PUT" }),
      TOKEN,
    ),
  );
  // Same-origin still needs the per-process token and JSON.
  assert.throws(
    () =>
      assertHttpBoundary(
        request({ host: "127.0.0.1:4321", origin: "http://127.0.0.1:4321", method: "POST", csrf: "wrong" }),
        TOKEN,
      ),
    /CSRF token/,
  );
  // A different port on loopback is a different origin.
  assert.throws(
    () => assertHttpBoundary(request({ host: "127.0.0.1:4321", origin: "http://127.0.0.1:9999" }), TOKEN),
    /origin is not allowed/,
  );
});

test("a rebound DNS name cannot qualify as same-origin", () => {
  assert.throws(
    () =>
      assertHttpBoundary(
        request({ host: "attacker.example:4321", origin: "http://attacker.example:4321", method: "POST" }),
        TOKEN,
      ),
    /only accepts loopback hosts/,
  );
});

test("configured hosts and origins extend the boundary for a tailnet name", () => {
  const boundary = httpBoundaryFromEnvironment({
    AGENT_HARNESS_ALLOWED_HOSTS: " Harness.Example.ts.net , other.internal",
    AGENT_HARNESS_ALLOWED_ORIGINS: "https://tools.example.ts.net",
  });
  assert.deepEqual([...boundary.allowedHosts], ["harness.example.ts.net", "other.internal"]);
  assert.doesNotThrow(() =>
    assertHttpBoundary(
      request({ host: "harness.example.ts.net", origin: "https://harness.example.ts.net", method: "POST" }),
      TOKEN,
      boundary,
    ),
  );
  assert.doesNotThrow(() =>
    assertHttpBoundary(
      request({ host: "harness.example.ts.net", origin: "https://tools.example.ts.net" }),
      TOKEN,
      boundary,
    ),
  );
  assert.equal(
    corsHeaders("https://tools.example.ts.net", boundary)["access-control-allow-origin"],
    "https://tools.example.ts.net",
  );
  assert.throws(() => corsHeaders("https://tools.example.ts.net"), /origin is not allowed/);
  assert.throws(
    () => assertHttpBoundary(request({ host: "unlisted.example.ts.net" }), TOKEN, boundary),
    /only accepts loopback hosts/,
  );
});

test("an empty environment leaves the boundary loopback-only", () => {
  const boundary = httpBoundaryFromEnvironment({});
  assert.equal(boundary.allowedHosts.size, 0);
  assert.equal(boundary.allowedOrigins.size, 0);
});

async function serveBuild(files) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-static-"));
  for (const [name, content] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(directory, name)), { recursive: true });
    await writeFile(path.join(directory, name), content);
  }
  const handler = await createStaticUi(directory);
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    if (handler && (await handler(req, res, url))) return;
    res.writeHead(404);
    res.end("api-404");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return {
    handler,
    get(pathname, headers = {}, method = "GET") {
      return new Promise((resolve, reject) => {
        const req = httpRequest({ host: "127.0.0.1", port, path: pathname, method, headers }, (res) => {
          const chunks = [];
          res.on("data", (chunk) => chunks.push(chunk));
          res.on("end", () =>
            resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }),
          );
        });
        req.on("error", reject);
        req.end();
      });
    },
    async close() {
      await new Promise((resolve) => server.close(resolve));
      await rm(directory, { recursive: true, force: true });
    },
  };
}

test("no build directory means no static UI", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-static-empty-"));
  assert.equal(await createStaticUi(directory), null);
  await rm(directory, { recursive: true, force: true });
});

test("the built UI is served with SPA fallback, caching and ranges, never shadowing /api", async (t) => {
  const site = await serveBuild({
    "index.html": "<!doctype html><title>Frontier</title>",
    "assets/app-abc123.js": "console.log(1)",
    "media/arrival.mp4": "0123456789",
  });
  t.after(() => site.close());

  const index = await site.get("/");
  assert.equal(index.status, 200);
  assert.match(index.headers["content-type"], /text\/html/);
  assert.equal(index.headers["cache-control"], "no-cache");
  assert.match(index.body, /Frontier/);

  const asset = await site.get("/assets/app-abc123.js");
  assert.equal(asset.status, 200);
  assert.match(asset.headers["content-type"], /javascript/);
  assert.match(asset.headers["cache-control"], /immutable/);

  const routed = await site.get("/tasks/abc?mode=fixture");
  assert.equal(routed.status, 200);
  assert.match(routed.body, /Frontier/);

  assert.equal((await site.get("/assets/missing.js")).body, "api-404");
  assert.equal((await site.get("/api/unknown")).body, "api-404");
  assert.equal((await site.get("/api")).body, "api-404");
  assert.equal((await site.get("/", {}, "POST")).body, "api-404");

  const partial = await site.get("/media/arrival.mp4", { range: "bytes=2-5" });
  assert.equal(partial.status, 206);
  assert.equal(partial.body, "2345");
  assert.equal(partial.headers["content-range"], "bytes 2-5/10");
  assert.match(partial.headers["content-type"], /video\/mp4/);

  const suffix = await site.get("/media/arrival.mp4", { range: "bytes=-3" });
  assert.equal(suffix.body, "789");
  assert.equal((await site.get("/media/arrival.mp4", { range: "bytes=50-" })).status, 416);

  const head = await site.get("/", {}, "HEAD");
  assert.equal(head.status, 200);
  assert.equal(head.body, "");
});

test("paths cannot escape the build directory", async (t) => {
  const site = await serveBuild({ "index.html": "ok" });
  t.after(() => site.close());
  for (const attempt of ["/../../etc/passwd", "/%2e%2e/%2e%2e/etc/passwd", "/..%2f..%2fetc%2fpasswd"]) {
    const response = await site.get(attempt);
    assert.ok(!/root:/.test(response.body), `${attempt} must not leak files outside the build`);
  }
  assert.equal((await site.get("/%E0%A4%A")).body, "api-404");
});
