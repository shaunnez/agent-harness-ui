const SEARCH_COMMAND = /(?:^|[|;&()\s])(?:rg|grep)(?:\s|$)/;
const NON_DIAGNOSTIC_COMMAND =
  /(?:^|[|;&()\s])(?:npm|pnpm|yarn|make|pytest|ruff|eslint|biome|tsc|vitest|jest|playwright)(?:\s|$)/;

export function isExpectedReadOnlySearchMiss(command, exitCode) {
  if (Number(exitCode) !== 1) return false;
  const text = Array.isArray(command) ? command.join(" ") : String(command ?? "");
  return SEARCH_COMMAND.test(text) && !NON_DIAGNOSTIC_COMMAND.test(text);
}

export function commandExitCode(result) {
  const match = String(result ?? "").match(/(?:exit(?:ed)?(?: with)?(?: code)?|code)\s*[:=]?\s*(-?\d+)/i);
  return match ? Number(match[1]) : null;
}
