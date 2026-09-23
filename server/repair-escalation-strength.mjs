// Shared by the local runtime and Frontier; keep this module free of Node imports.
const REASONING_ORDER = ["none", "low", "medium", "high", "xhigh", "max", "ultra"];
const MODEL_RANK = {
  "gpt-6-luna": 1,
  "gpt-6-sol": 2,
  "gpt-6-astra": 3,
  "claude-sonnet-5": 1,
  "claude-opus-5-5": 2,
};

function providerFor(model) {
  if (model.startsWith("gpt-")) return "codex";
  if (model.startsWith("claude-")) return "claude";
  return null;
}

export function isStrongerRepairPolicy(selected, proposed) {
  if (!selected?.model || !proposed?.model) return false;
  const provider = providerFor(selected.model);
  if (!provider || provider !== providerFor(proposed.model)) return false;
  const selectedReasoning = REASONING_ORDER.indexOf(selected.reasoning);
  const proposedReasoning = REASONING_ORDER.indexOf(proposed.reasoning);
  if (selectedReasoning < 0 || proposedReasoning < 0) return false;
  if (selected.model === proposed.model) return proposedReasoning > selectedReasoning;
  return (
    (MODEL_RANK[proposed.model] ?? 0) > (MODEL_RANK[selected.model] ?? 0) &&
    proposedReasoning >= selectedReasoning
  );
}
