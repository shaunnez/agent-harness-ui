/**
 * The bounded, redacted tail of a *failed* repository command.
 *
 * Every other tool result in this harness is discarded at parse time under the
 * "content not retained" discipline, and that discipline is right: tool-result
 * bodies are unbounded, attacker-influenced, and — per P1-6 in the 2026-08-03
 * audit — a place where inherited credentials surface. Nothing here relaxes it.
 *
 * The exception is narrow and load-bearing. When a gate kills a task it tells the
 * operator "a human must inspect the retained telemetry", and until now there was
 * no telemetry to inspect: `toolCall.result` held the string `Exit code 1` and the
 * bytes that explained it were already gone. A diagnostic that cannot be diagnosed
 * is the failure mode this module exists to close, so a failing command — and only
 * a failing command — keeps its last few lines.
 *
 * Three properties keep that exception from becoming the rule:
 *
 * 1. **Failure only.** A successful command retains nothing. Success is the common
 *    case and the one with no question to answer.
 * 2. **Bounded from the end.** The tail is what explains an exit code; the head is
 *    usually progress chatter. Both a line cap and a byte cap apply, because one
 *    500 KB line is as damaging to the store as 5,000 short ones.
 * 3. **Redacted before it is stored, not before it is displayed.** The store is the
 *    thing that persists and gets copied into bug reports, so a secret must never
 *    reach it. Redaction is deliberately over-eager: a masked token costs a
 *    re-run, a leaked one costs a rotation.
 */

/** Lines kept from the end. Enough for a stack trace or a test failure block. */
export const RETAINED_OUTPUT_LINE_LIMIT = 40;

/** Hard ceiling regardless of line count. A single line can exceed any line cap. */
export const RETAINED_OUTPUT_BYTE_LIMIT = 4_000;

export const REDACTION_PLACEHOLDER = "[redacted]";

/** Marker prepended when anything was dropped, so a tail never reads as the whole output. */
const TRUNCATION_MARKER = "…output truncated, showing the tail…";

/**
 * Patterns are matched against the tail *after* truncation but *before* storage.
 *
 * Each entry masks the secret while keeping the shape of the line, because the
 * surrounding text is the diagnostic value: `AWS_SECRET_ACCESS_KEY=[redacted]` tells
 * an operator which variable was wrong, which a wholesale line drop would not.
 */
const REDACTIONS = [
  // A PEM body is multi-line and runs first so no later rule mangles half of it:
  // half a private key in a bug report is still a compromised private key.
  {
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    replace: () => REDACTION_PLACEHOLDER,
  },
  // `NAME=secret`, `NAME: secret`, `"name": "secret"` for anything that names itself
  // a credential. The key survives; the value does not. The lookahead stops this rule
  // from eating an auth *scheme* as if it were the secret — `Authorization: Bearer x`
  // would otherwise mask the word `Bearer` and leave `x` in the clear.
  {
    pattern:
      /\b([A-Za-z0-9_.-]*(?:SECRET|TOKEN|PASSWORD|PASSWD|PASSPHRASE|API[_-]?KEY|ACCESS[_-]?KEY|PRIVATE[_-]?KEY|CREDENTIAL|AUTH)[A-Za-z0-9_.-]*)(\s*["']?\s*[:=]\s*["']?)(?!(?:Bearer|Basic|Token)\b)([^\s"',;]+)/gi,
    replace: (_match, key, separator) => `${key}${separator}${REDACTION_PLACEHOLDER}`,
  },
  // `Authorization: Bearer …` and friends, which carry no key name of their own.
  {
    pattern: /\b(Bearer|Basic|Token)\s+([A-Za-z0-9._~+/=-]{8,})/gi,
    replace: (_match, scheme) => `${scheme} ${REDACTION_PLACEHOLDER}`,
  },
  // Credentials embedded in a URL authority, where neither half names itself.
  {
    pattern: /\b([a-z][a-z0-9+.-]*:\/\/)([^\s/@:]+):([^\s/@]+)@/gi,
    replace: (_match, scheme, user) => `${scheme}${user}:${REDACTION_PLACEHOLDER}@`,
  },
  // Vendor-prefixed tokens are self-identifying and are the ones that actually leak
  // through logs in practice. Each length is a documented minimum, not an exact
  // width: vendors lengthen tokens over time and a pattern pinned to today's size
  // silently stops matching tomorrow's.
  {
    pattern:
      /\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{20,}|xox[abprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|ASIA[0-9A-Z]{16}|AIza[A-Za-z0-9_-]{35,}|glpat-[A-Za-z0-9_-]{20,}|npm_[A-Za-z0-9]{36,})\b/g,
    replace: () => REDACTION_PLACEHOLDER,
  },
  // JWTs. Three base64url segments is a shape nothing benign in command output has.
  {
    pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
    replace: () => REDACTION_PLACEHOLDER,
  },
];

/**
 * Masks every credential shape in `text`. Exported so the redaction rules can be
 * tested directly against known token formats rather than only through a tail.
 */
export function redactSecrets(text) {
  let redacted = String(text ?? "");
  for (const { pattern, replace } of REDACTIONS) redacted = redacted.replace(pattern, replace);
  return redacted;
}

/**
 * The retained tail of a failed command's combined output, or `null` when there is
 * nothing worth keeping.
 *
 * `null` rather than `""` because the field is absent-by-default in the event shape:
 * a consumer must be able to tell "this command succeeded, so nothing was kept" from
 * "this command failed and printed nothing", and the surrounding `commandFailed`
 * flag already carries that distinction.
 */
export function retainFailedCommandOutput(output) {
  const text = typeof output === "string" ? output : joinContentBlocks(output);
  if (!text.trim()) return null;

  const lines = text.replace(/\r\n/g, "\n").split("\n");
  // A trailing newline produces an empty final element that would otherwise consume
  // one of the 40 retained lines with nothing in it.
  while (lines.length && lines.at(-1).trim() === "") lines.pop();
  if (!lines.length) return null;

  let truncated = lines.length > RETAINED_OUTPUT_LINE_LIMIT;
  let tail = lines.slice(-RETAINED_OUTPUT_LINE_LIMIT).join("\n");

  if (Buffer.byteLength(tail, "utf8") > RETAINED_OUTPUT_BYTE_LIMIT) {
    truncated = true;
    // Slicing bytes can split a multi-byte character, so the buffer is decoded back
    // and any replacement character left at the cut is dropped.
    tail = Buffer.from(tail, "utf8")
      .subarray(-RETAINED_OUTPUT_BYTE_LIMIT)
      .toString("utf8")
      .replace(/^�+/, "");
  }

  const redacted = redactSecrets(tail).trimEnd();
  if (!redacted.trim()) return null;
  return truncated ? `${TRUNCATION_MARKER}\n${redacted}` : redacted;
}

/** Claude's tool results arrive as content blocks; Codex's arrive as a plain string. */
function joinContentBlocks(content) {
  if (!Array.isArray(content)) return "";
  return content.map((block) => (typeof block?.text === "string" ? block.text : "")).join("\n");
}
