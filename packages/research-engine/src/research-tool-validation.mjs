import { ResearchToolError } from "./research-tool-errors.mjs";

export function normalizeSourceContent(body, mediaType) {
  if (mediaType === "text/html" || mediaType === "application/xhtml+xml") {
    const titleMatch = body.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
    const title = titleMatch ? normalizeWhitespace(decodeHtml(stripTags(titleMatch[1]))) : null;
    const withoutNoise = body
      .replace(/<(script|style|noscript|svg)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
      .replace(/<(br|\/p|\/div|\/li|\/section|\/article|\/h[1-6]|\/tr)>/gi, "\n");
    return { title, content: normalizeWhitespace(decodeHtml(stripTags(withoutNoise))) };
  }
  return { title: null, content: normalizeWhitespace(body) };
}

export function assertStrictObject(value, allowed) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new ResearchToolError("invalid_tool_input", "Tool input must be an object.");
  const extra = Object.keys(value).filter((key) => !allowed.includes(key));
  if (extra.length)
    throw new ResearchToolError("invalid_tool_input", `Unexpected tool input field "${extra[0]}".`);
}

export function requiredString(value, label, maxLength) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) throw new ResearchToolError("invalid_tool_input", `${label} is required.`);
  if (normalized.length > maxLength)
    throw new ResearchToolError("invalid_tool_input", `${label} must be ${maxLength} characters or fewer.`);
  return normalized;
}

export function optionalInteger(value, fallback, minimum, maximum, label) {
  if (value == null) return fallback;
  if (!Number.isInteger(value) || value < minimum || value > maximum)
    throw new ResearchToolError(
      "invalid_tool_input",
      `${label} must be an integer from ${minimum} to ${maximum}.`,
    );
  return value;
}

export function boundedConfidence(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 1)
    throw new ResearchToolError("invalid_tool_input", "Finding confidence must be between 0 and 1.");
  return number;
}

export function normalizeAuthority(value) {
  return value === "primary" || value === "secondary" ? value : "unknown";
}

export function containsQuoteVerified(value) {
  if (!value || typeof value !== "object") return false;
  if (Object.hasOwn(value, "quoteVerified")) return true;
  return Object.values(value).some((item) =>
    Array.isArray(item) ? item.some(containsQuoteVerified) : containsQuoteVerified(item),
  );
}

export function asToolError(error, fallbackCode, fallbackMessage) {
  if (error instanceof ResearchToolError) return error;
  const converted = new ResearchToolError(
    error?.code ?? error?.category ?? fallbackCode,
    error?.message ?? fallbackMessage,
  );
  converted.providerAttempt = error?.attempt ?? null;
  // Kept so a caller can tell an external provider's outage from one website failing: the
  // first says nothing about the research, the second is something the model can route around.
  converted.provider = error?.provider ?? null;
  converted.category = error?.category ?? null;
  return converted;
}

function stripTags(value) {
  return value.replace(/<[^>]+>/g, " ");
}

function decodeHtml(value) {
  const named = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity) => {
    if (entity[0] === "#") {
      const hex = entity[1]?.toLowerCase() === "x";
      const code = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return named[entity.toLowerCase()] ?? match;
  });
}

function normalizeWhitespace(value) {
  return String(value)
    .normalize("NFC")
    .replace(/\r/g, "")
    .replace(/[\t ]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}
