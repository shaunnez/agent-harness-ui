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
  "http://127.0.0.1:5199",
  "http://localhost:5199",
]);

export const MISSING_ORIGIN_POLICY =
  "Allowed only for loopback non-browser clients that provide the per-process CSRF token and application/json.";

/**
 * Hosts and origins beyond loopback that this companion accepts, read from the environment.
 *
 * Both default to empty, which is the loopback-only companion this has always been. They exist
 * for a companion reached through something the operator controls — a container port published
 * to the host's loopback, or `tailscale serve` on a tailnet-only name — where the browser's
 * Host and Origin are that name rather than `127.0.0.1`. Hostnames are compared without port;
 * origins are exact (`https://harness.example.ts.net`).
 */
export function httpBoundaryFromEnvironment(environment = process.env) {
  return {
    allowedHosts: new Set(listOf(environment.AGENT_HARNESS_ALLOWED_HOSTS).map((host) => host.toLowerCase())),
    allowedOrigins: new Set(listOf(environment.AGENT_HARNESS_ALLOWED_ORIGINS)),
  };
}

const LOOPBACK_ONLY = Object.freeze({ allowedHosts: new Set(), allowedOrigins: new Set() });

export function assertHttpBoundary(request, csrfToken, boundary = LOOPBACK_ONLY) {
  const host = parseHost(request.headers.host);
  if (!host || !(isLoopback(host.hostname) || boundary.allowedHosts.has(host.hostname.toLowerCase())))
    throw httpError(403, "The local companion only accepts loopback hosts.");
  const origin = request.headers.origin;
  if (origin && !originAllowed(origin, request.headers.host, boundary))
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

export function corsHeaders(origin, boundary = LOOPBACK_ONLY) {
  if (!ALLOWED_BROWSER_ORIGINS.has(origin) && !boundary.allowedOrigins.has(origin))
    throw httpError(403, "The request origin is not allowed.");
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
    "access-control-allow-headers": "content-type,x-agent-harness-csrf",
    vary: "Origin",
  };
}

// A page the companion served itself (the built UI) sends its own origin on every mutation.
// That request is same-origin by definition, so it is accepted whenever its Host already passed
// the host check above — which is what stops a rebound DNS name from qualifying.
function originAllowed(origin, hostHeader, boundary) {
  if (ALLOWED_BROWSER_ORIGINS.has(origin) || boundary.allowedOrigins.has(origin)) return true;
  try {
    const parsed = new URL(origin);
    return (
      (parsed.protocol === "http:" || parsed.protocol === "https:") &&
      parsed.host.toLowerCase() === String(hostHeader ?? "").toLowerCase()
    );
  } catch {
    return false;
  }
}

function listOf(value) {
  return String(value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
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
