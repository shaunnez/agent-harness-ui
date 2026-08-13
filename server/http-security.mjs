const MUTATION_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
// 4173 is `vite preview`, 5173 is `vite dev`. Both are loopback and both are the same
// operator at the same machine; omitting the dev port made every mutation from `npm run dev`
// fail with a 403 that reads like an auth problem. Reads were unaffected, because browsers
// omit `Origin` on same-origin GETs — which is why this only showed up on save.
const ALLOWED_BROWSER_ORIGINS = new Set([
  "http://127.0.0.1:4173",
  "http://localhost:4173",
  "http://127.0.0.1:5173",
  "http://localhost:5173",
  "http://localhost:5174",
  "http://127.0.0.1:5174",
]);

export const MISSING_ORIGIN_POLICY =
  "Allowed only for loopback non-browser clients that provide the per-process CSRF token and application/json.";

export function assertHttpBoundary(request, csrfToken) {
  const host = parseHost(request.headers.host);
  if (!host || !isLoopback(host.hostname))
    throw httpError(403, "The local companion only accepts loopback hosts.");
  const origin = request.headers.origin;
  if (origin && !ALLOWED_BROWSER_ORIGINS.has(origin))
    throw httpError(403, "The request origin is not allowed.");
  if (!MUTATION_METHODS.has(request.method ?? "GET")) return;
  if (
    !String(request.headers["content-type"] ?? "")
      .toLowerCase()
      .startsWith("application/json")
  ) {
    throw httpError(415, "State-changing requests require application/json.");
  }
  if (!csrfToken || request.headers["x-agent-harness-csrf"] !== csrfToken) {
    throw httpError(403, "The local companion CSRF token is missing or invalid.");
  }
}

export function corsHeaders(origin) {
  if (!ALLOWED_BROWSER_ORIGINS.has(origin)) throw httpError(403, "The request origin is not allowed.");
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
    "access-control-allow-headers": "content-type,x-agent-harness-csrf",
    vary: "Origin",
  };
}

function parseHost(value) {
  try {
    return new URL(`http://${value}`);
  } catch {
    return null;
  }
}

function isLoopback(hostname) {
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "[::1]";
}

function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}
