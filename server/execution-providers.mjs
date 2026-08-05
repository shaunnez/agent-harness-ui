import { claudeExecutionProvider } from "./claude-runtime.mjs";
import { codexExecutionProvider } from "./codex-runtime.mjs";
import { DEFAULT_EXECUTION_PROVIDER } from "./run-activity.mjs";

/**
 * The execution-provider registry.
 *
 * One interface, one implementation per provider. Exactly the provider-specific
 * concerns live behind it: binary discovery and auth, spawn arguments, event
 * schema, usage extraction and sandbox mapping. `capabilities()` is the seam's
 * honesty mechanism — the harness reads a provider's confinement guarantee rather
 * than assuming one, so a provider offering something weaker than an OS-enforced
 * sandbox cannot be silently treated as equivalent.
 */
const PROVIDERS = new Map([
  [codexExecutionProvider.id, codexExecutionProvider],
  [claudeExecutionProvider.id, claudeExecutionProvider],
]);

export function listExecutionProviders() {
  return [...PROVIDERS.values()];
}

export function hasExecutionProvider(id) {
  return PROVIDERS.has(id ?? DEFAULT_EXECUTION_PROVIDER);
}

/** Resolve a provider by id. An unknown id throws rather than falling back. */
export function resolveExecutionProvider(id) {
  const providerId = id ?? DEFAULT_EXECUTION_PROVIDER;
  const provider = PROVIDERS.get(providerId);
  if (!provider) {
    throw new Error(
      `Unknown execution provider: ${providerId}. Known providers: ${[...PROVIDERS.keys()].join(", ")}.`,
    );
  }
  return provider;
}
