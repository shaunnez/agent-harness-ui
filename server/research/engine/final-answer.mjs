// The final answer's JSON fence. The recipe's system prompt asks the model to finish with one, and
// its presence in a message is what tells a finding from running commentary.

const JSON_FENCE = /```json\s*([\s\S]*?)```/;

export function isFinalAnswerText(text) {
  return JSON_FENCE.test(String(text ?? ""));
}

/** The last ```json fence in a body of text, parsed. Last rather than first: the model quotes
 *  the schema back at itself mid-run often enough that taking the first fence picks up a
 *  template instead of an answer. Returns null rather than throwing on malformed JSON — a
 *  malformed answer is a run that produced no band, not a runtime failure. */
export function parseFinalJsonFence(text) {
  const body = String(text ?? "");
  const fences = [...body.matchAll(/```json\s*([\s\S]*?)```/g)];
  for (let index = fences.length - 1; index >= 0; index -= 1) {
    try {
      const parsed = JSON.parse(fences[index][1]);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
    } catch {
      // Try the fence before it: a truncated final fence should not hide a complete earlier one.
    }
  }
  return null;
}
