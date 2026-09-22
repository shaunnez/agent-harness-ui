const policy = (model, reasoning = "high") => Object.freeze({ model, reasoning });
const sol = "gpt-6-sol";
const luna = "gpt-6-luna";
const sonnet = "claude-sonnet-5";
const shared = Object.freeze({
  triage: policy(luna),
  scouts: policy(luna),
  grill: policy(sol),
  specification: policy(sol),
  plan: policy(sol),
  "dev-review": policy(sol),
  test: policy(luna, "medium"),
  "final-review": policy(sol),
});

export const H06_MEDIUM_PROVIDER_COMPARISON = Object.freeze({
  policies: Object.freeze({
    "sol-implement": Object.freeze({ ...shared, implement: policy(sol), repair: policy(sol) }),
    "sonnet-implement": Object.freeze({ ...shared, implement: policy(sonnet), repair: policy(sonnet) }),
  }),
  trials: Object.freeze([
    Object.freeze({ id: "A", variant: "sol-implement", repetition: 1 }),
    Object.freeze({ id: "B", variant: "sonnet-implement", repetition: 1 }),
    Object.freeze({ id: "C", variant: "sonnet-implement", repetition: 2 }),
    Object.freeze({ id: "D", variant: "sol-implement", repetition: 2 }),
  ]),
  allowedModels: Object.freeze([sol, luna, sonnet]),
  allowedProviders: Object.freeze(["codex", "claude"]),
  trialConcurrency: 2,
  defaultModel: sol,
});
