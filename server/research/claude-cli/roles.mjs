// The four roles, as four CLI calls our code makes in order.
//
// Not `--agents`. That hands the model four named roles and lets it decide when to call each,
// with no guarantee the verifier ever runs. Orchestrating it here is the whole point: this
// file is the sequence, so the sequence is guaranteed. The two are alternatives, not a stack.
//
// Every role runs on the same model as the single-agent baseline by default. A cheaper model
// on the planner would probably pay for itself, but it would also confound the measurement:
// if four roles lose, we would not know whether the split lost or the cheaper planner did.
// Phase 2 asks one question, so it changes one thing.
//
// Tools narrow as the sequence proceeds, and the synthesiser has none. That is the structural
// difference from one agent: by the time the band is written, no new evidence can enter, so
// the band can only be built from what the verifier actually checked.

import { fileURLToPath } from "node:url";
import { parseFinalJsonFence } from "./stream.mjs";

const promptPath = (name) => fileURLToPath(new URL(`./role-prompts/${name}.txt`, import.meta.url));

/** The corpus tools, without web search. */
const CORPUS_TOOLS = ["mcp__qv__search_qv", "mcp__qv__get_qv_table", "mcp__qv__list_qv_sections"];

/**
 * The sequence. Order is the array order and is not configurable — a verifier that could be
 * reordered after the synthesiser would be decoration.
 */
export const RESEARCH_ROLE_SEQUENCE = Object.freeze([
  {
    role: "planner",
    promptPath: promptPath("planner"),
    // Survey only: the planner may see what the catalogue holds but has no reason to reach the
    // web, which is also the cheapest way to keep it from starting to price things.
    allowedTools: CORPUS_TOOLS,
    buildObjective: ({ scope }) => scope,
  },
  {
    role: "researcher",
    promptPath: promptPath("researcher"),
    allowedTools: [...CORPUS_TOOLS, "WebSearch"],
    buildObjective: ({ scope, outputs }) =>
      [
        scope,
        "",
        "--- PLAN FROM THE PLANNER ---",
        outputs.planner?.text ?? "(the planner produced no plan; decompose the scope yourself)",
      ].join("\n"),
  },
  {
    role: "verifier",
    promptPath: promptPath("verifier"),
    allowedTools: [...CORPUS_TOOLS, "WebSearch"],
    buildObjective: ({ scope, outputs }) =>
      [
        scope,
        "",
        "--- COMPONENTS FROM THE RESEARCHER, TO CHECK ---",
        outputs.researcher?.text ?? "(the researcher produced nothing; report every component as rejected)",
      ].join("\n"),
  },
  {
    role: "synthesiser",
    promptPath: promptPath("synthesiser"),
    // No tools at all. The band may only be built from what survived verification, and a
    // synthesiser that could search would quietly reintroduce unchecked evidence at the last
    // step — which is exactly the gap one agent has.
    allowedTools: [],
    buildObjective: ({ scope, outputs }) =>
      [
        scope,
        "",
        "--- COMPONENTS FROM THE RESEARCHER ---",
        outputs.researcher?.text ?? "(none)",
        "",
        "--- VERIFIER CHECKS ---",
        outputs.verifier?.text ?? "(the verifier produced nothing; treat every component as weakened)",
      ].join("\n"),
  },
]);

export const RESEARCH_ROLE_NAMES = RESEARCH_ROLE_SEQUENCE.map((entry) => entry.role);

/**
 * What the verifier changed, read off the outputs rather than judged by a model.
 *
 * This is phase 2's real question — "does the verifier catch something one agent got wrong?"
 * — and it has to be answered from artifacts, not from an opinion. A model asked to score its
 * own pipeline rewards whichever variant produces the more agreeable prose, which is the
 * failure PR #101 fixed in the SDLC scorecard. So: count the checks by status, and count how
 * many of the researcher's components did not survive into the final band.
 */
export function verifierEffect({ researcherText, verifierText, costBand }) {
  const checks = parseFinalJsonFence(verifierText)?.checks;
  const researcherComponents = parseFinalJsonFence(researcherText)?.components;
  const byStatus = { supported: 0, weakened: 0, rejected: 0 };
  for (const check of Array.isArray(checks) ? checks : []) {
    if (check?.status in byStatus) byStatus[check.status] += 1;
  }
  const researcherRoles = new Set(
    (Array.isArray(researcherComponents) ? researcherComponents : [])
      .map((component) => normalizeRole(component?.role))
      .filter(Boolean),
  );
  const finalRoles = new Set(
    (costBand?.components ?? []).map((component) => normalizeRole(component.role)).filter(Boolean),
  );
  const missingByName = [...researcherRoles].filter((role) => !finalRoles.has(role));
  return {
    checks: byStatus,
    // A challenge is a check the verifier did not wave through. It is not by itself evidence
    // the verifier was right — only that it did something a single agent had no step for.
    challenged: byStatus.weakened + byStatus.rejected,
    researcherComponents: researcherRoles.size,
    finalComponents: finalRoles.size,
    // An UPPER BOUND on what the verifier removed, and usually an overstatement: the
    // synthesiser rewords role labels, so a component that survived under a new name counts
    // here as dropped. The first live run showed 8 researcher components, 8 final components
    // and 3 "dropped" — three relabellings, not three removals.
    missingByName: missingByName.length,
    // Rename-immune, and therefore the number the decision rule uses. A component that was
    // genuinely removed makes the final list shorter; a component that was renamed does not.
    netComponentsRemoved: Math.max(0, researcherRoles.size - finalRoles.size),
  };
}

function normalizeRole(role) {
  return typeof role === "string" ? role.trim().toLowerCase().replace(/\s+/g, " ") : null;
}
