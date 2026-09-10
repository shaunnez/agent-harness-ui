/**
 * Keep fixture git commits out of the developer's signing setup.
 *
 * Tests build throwaway repositories and commit in them constantly. Those commits inherit
 * the user's global config, so on a machine with `commit.gpgsign = true` every one of them
 * is a signing request against a real key — typically an agent behind a GUI (1Password,
 * gpg-agent, a Yubikey). Two things follow, and both were observed:
 *
 * 1. **The suite fails for reasons that have nothing to do with the code.** When the agent
 *    is locked, throttled, or slow to be approved, git returns `failed to write commit
 *    object` and roughly thirty tests fail at once. The harness runs this suite as a gate,
 *    so it reads that as a defect in the candidate and orders a repair that cannot help.
 * 2. **It is slow even when it works.** Each commit costs an agent round trip;
 *    `api-retained-evidence` alone went from 59s to 0.4s once signing was off.
 *
 * A fixture commit has no audience and proves nothing by being signed, so the tests opt out
 * rather than depending on how any given machine is configured. `GIT_CONFIG_*` is used in
 * preference to per-invocation `-c` flags because it reaches every git subprocess,
 * including the ones the server's own `GitWorktreeManager` spawns.
 */

const OVERRIDES = [
  ["commit.gpgsign", "false"],
  ["tag.gpgsign", "false"],
];

const existing = Number(process.env.GIT_CONFIG_COUNT ?? 0);
const base = Number.isInteger(existing) && existing > 0 ? existing : 0;
OVERRIDES.forEach(([key, value], index) => {
  process.env[`GIT_CONFIG_KEY_${base + index}`] = key;
  process.env[`GIT_CONFIG_VALUE_${base + index}`] = value;
});
process.env.GIT_CONFIG_COUNT = String(base + OVERRIDES.length);
