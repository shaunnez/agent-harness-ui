import { lookup as dnsLookup } from "node:dns/promises";
import net from "node:net";
import { ResearchProviderError, providerFailure } from "./research-provider-errors.mjs";

const SECRET_QUERY_KEYS = new Set([
  "token",
  "access_token",
  "api_key",
  "apikey",
  "authorization",
  "signature",
  "sig",
]);

export async function validatePublicSourceUrl(
  value,
  { lookup = dnsLookup, signal = null, allowPrivateNetwork = false } = {},
) {
  let url;
  try {
    url = value instanceof URL ? new URL(value) : new URL(value);
  } catch {
    throw policyError("unsupported_url_scheme", "Only valid HTTP and HTTPS source URLs are allowed.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:")
    throw policyError("unsupported_url_scheme", "Only HTTP and HTTPS source URLs are allowed.");
  if (url.username || url.password)
    throw policyError("url_credentials_blocked", "Source URLs must not contain credentials.");
  assertNoSecretQuery(url);
  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local"))
    throw policyError("private_network_url", "Loopback and private-network source URLs are blocked.");
  let addresses;
  if (net.isIP(hostname)) addresses = [{ address: hostname, family: net.isIP(hostname) }];
  else {
    try {
      addresses = await abortable(lookup(hostname, { all: true, verbatim: true }), signal);
    } catch (error) {
      if (signal?.aborted) throw cancelledError();
      if (error instanceof ResearchProviderError) throw error;
      throw providerFailure({ provider: "local", operation: "capture", category: "permanent" });
    }
  }
  if (!Array.isArray(addresses) || addresses.length === 0)
    throw policyError("source_resolution_failed", "The source hostname has no public address.");
  if (!allowPrivateNetwork && addresses.some(({ address }) => !isGlobalAddress(address)))
    throw policyError(
      "private_network_url",
      "Loopback, private, reserved and mixed-address source destinations are blocked.",
    );
  return {
    url,
    addresses: addresses.map(({ address, family }) => ({
      address,
      family: Number(family) || net.isIP(address),
    })),
  };
}

export function normalizeRequestedUrl(value) {
  const url = new URL(value);
  url.hash = "";
  if ((url.protocol === "https:" && url.port === "443") || (url.protocol === "http:" && url.port === "80"))
    url.port = "";
  return url.toString();
}

export function isGlobalAddress(value) {
  let address = String(value).toLowerCase().split("%")[0];
  if (address.startsWith("::ffff:")) address = address.slice(7);
  const family = net.isIP(address);
  if (family === 4) {
    const octets = address.split(".").map(Number);
    if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255))
      return false;
    const [a, b, c] = octets;
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 0) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0 && c === 2) ||
      (a === 198 && (b === 18 || b === 19 || b === 51)) ||
      (a === 203 && b === 0 && c === 113) ||
      a >= 224
    );
  }
  if (family !== 6) return false;
  if (address === "::" || address === "::1") return false;
  if (/^(fc|fd)/.test(address) || /^fe[89ab]/.test(address) || /^ff/.test(address)) return false;
  if (address.startsWith("2001:db8") || address.startsWith("2001:10") || address.startsWith("100::"))
    return false;
  return true;
}

function assertNoSecretQuery(url) {
  let hasAzureSignature = false;
  let hasAzureAccess = false;
  for (const key of url.searchParams.keys()) {
    const lower = key.toLowerCase();
    if (SECRET_QUERY_KEYS.has(lower) || lower.startsWith("x-amz-") || lower.startsWith("x-goog-"))
      throw policyError("secret_bearing_url", "Credential-bearing source URLs are blocked.");
    if (lower === "sig") hasAzureSignature = true;
    if (["se", "sp", "sv", "sr", "st"].includes(lower)) hasAzureAccess = true;
  }
  if (hasAzureSignature && hasAzureAccess)
    throw policyError("secret_bearing_url", "Credential-bearing source URLs are blocked.");
}

function policyError(code, message) {
  const error = new ResearchProviderError({
    provider: "host",
    operation: "capture",
    category: "policy_rejected",
    message,
  });
  error.code = code;
  return error;
}

function cancelledError() {
  const error = providerFailure({ provider: "local", operation: "capture", category: "cancelled" });
  error.code = "research_cancelled";
  return error;
}

async function abortable(promise, signal) {
  if (!signal) return promise;
  if (signal.aborted) throw cancelledError();
  let listener;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        listener = () => reject(cancelledError());
        signal.addEventListener("abort", listener, { once: true });
      }),
    ]);
  } finally {
    if (listener) signal.removeEventListener("abort", listener);
  }
}
