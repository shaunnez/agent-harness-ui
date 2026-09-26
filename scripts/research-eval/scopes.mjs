// The 30 pinned scopes, and the mapping from each to its row in the recorded baseline.
//
// A pinned scope fixes the parameters that drive the price — size, grade, duty, material,
// finish, nominal quantity — so that three runs of the same scenario are comparable. An
// unpinned one makes the agent invent them, and three runs then disagree by 3x. The files are
// read from the spike pack rather than copied here: they are the exact text all 90 recorded
// runs were given, and a second copy could drift from the thing the baseline was produced by.

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const PINNED_SCOPE_DIRECTORY = fileURLToPath(
  new URL("../../research-agent-deepagents-spike-pack/16-pinned-scopes/", import.meta.url),
);

export const RECORDED_RESULTS_PATH = fileURLToPath(
  new URL("../../research-agent-deepagents-spike-pack/17a-top30-results.json", import.meta.url),
);

/**
 * The recorded baseline keyed each scenario by its scope filename with the first `p-` removed
 * — `acp-facade-cladding-install` became `acfacade-cladding-install`, `p-cable` became
 * `cable`. That is a quirk of the shell loop that produced the 90 runs, not a naming scheme,
 * and it is reproduced verbatim because the alternative is renaming the baseline and losing
 * the ability to say the comparison is against the recorded numbers.
 */
export function recordedKeyForScope(scopeId) {
  return scopeId.replace("p-", "");
}

/** Every pinned scope, in a stable order. `_scope-writer-prompt.txt` is the prompt the scopes
 *  were written *by*, not a scope, and is excluded by its leading underscore. */
export async function loadPinnedScopes({ directory = PINNED_SCOPE_DIRECTORY, only = null } = {}) {
  const names = (await readdir(directory))
    .filter((name) => name.endsWith(".txt") && !name.startsWith("_"))
    .sort();
  const scopes = [];
  for (const name of names) {
    const id = name.slice(0, -4);
    if (only && !only.includes(id)) continue;
    scopes.push({
      id,
      recordedKey: recordedKeyForScope(id),
      objective: await readFile(path.join(directory, name), "utf8"),
    });
  }
  return scopes;
}

/** The recorded runs, reshaped into the `{ run, band }` pairs `agreementForRuns` takes. */
export async function loadRecordedBaseline({ resultsPath = RECORDED_RESULTS_PATH } = {}) {
  const raw = JSON.parse(await readFile(resultsPath, "utf8"));
  const baseline = new Map();
  for (const [key, runs] of Object.entries(raw)) {
    baseline.set(
      key,
      Object.entries(runs).map(([run, payload]) => ({
        run,
        band: payload?.band && payload.band.low != null && payload.band.high != null ? payload.band : null,
        costUsd: payload?.cost_usd ?? null,
        resolvedFrom: payload?.resolved_from ?? null,
      })),
    );
  }
  return baseline;
}
