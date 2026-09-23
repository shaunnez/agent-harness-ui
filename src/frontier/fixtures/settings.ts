import { normalizeRepairLimits } from "../../repair-limits.ts";
import type { RuntimeModelCatalog, RuntimeSettings } from "../../domain.ts";
import { policyRoles } from "../runtime/policies.ts";

export function fixtureSettings(): { settings: RuntimeSettings; catalog: RuntimeModelCatalog } {
  const stagePolicies = Object.fromEntries(
    policyRoles.map(({ id }) => [
      id,
      {
        model: ["plan", "repair", "dev-review", "final-review"].includes(id) ? "gpt-6-sol" : "gpt-6-luna",
        reasoning: ["plan", "repair", "dev-review", "final-review"].includes(id) ? "high" : "xhigh",
      },
    ]),
  );
  return {
    settings: {
      grillPolicy: "manual",
      repairLimits: normalizeRepairLimits(null),
      repairEscalationPolicies: { fast: null, standard: null, "high-risk": null },
      gatePolicies: {},
      allowedModels: ["gpt-6-luna", "gpt-6-sol", "claude-opus-5-5"],
      defaultModel: "gpt-6-luna",
      defaultReasoning: "xhigh",
      stagePolicies,
      profileStagePolicies: {
        fast: structuredClone(stagePolicies),
        standard: structuredClone(stagePolicies),
        "high-risk": structuredClone(stagePolicies),
      },
      designPolicies: {
        "codex-design": { provider: "codex", model: "gpt-6-sol", reasoning: "high" },
        "claude-design": { provider: "claude", model: "claude-opus-5-5", reasoning: "high" },
      },
      pricing: {
        version: "sample",
        sourceUrl: "",
        verifiedAt: "",
        verifiedBy: "Sample settings; not a runtime check",
        rates: {},
      },
    },
    catalog: {
      fetchedAt: null,
      source: "Demonstration choices; not model discovery",
      models: [
        {
          id: "gpt-6-luna",
          label: "Luna",
          provider: "codex",
          reasoningLevels: ["low", "medium", "high", "xhigh", "max"],
        },
        {
          id: "gpt-6-sol",
          label: "Sol",
          provider: "codex",
          reasoningLevels: ["low", "medium", "high", "xhigh", "max", "ultra"],
        },
        {
          id: "claude-opus-5-5",
          label: "Opus 5.5",
          provider: "claude",
          reasoningLevels: ["low", "medium", "high", "xhigh", "max"],
        },
      ].map((model) => ({
        ...model,
        provider: model.provider as "codex" | "claude",
        description: "Sample policy choice",
        defaultReasoning: "high",
        pricing: null,
        availability: "configured",
        provenance: "configured",
        editable: true,
      })),
    },
  };
}
