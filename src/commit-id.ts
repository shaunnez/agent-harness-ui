const CANONICAL_COMMIT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i;

export function isCanonicalCommitId(value: unknown): value is string {
  return typeof value === "string" && CANONICAL_COMMIT_ID.test(value);
}
