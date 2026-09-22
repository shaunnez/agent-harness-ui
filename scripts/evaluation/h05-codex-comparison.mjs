const policy = (model, reasoning = "high") => Object.freeze({ model, reasoning });

const shared = Object.freeze({
  triage: policy("gpt-5.6-luna"),
  scouts: policy("gpt-5.6-luna"),
  grill: policy("gpt-5.6-sol"),
  specification: policy("gpt-5.6-sol"),
  plan: policy("gpt-5.6-sol"),
  "dev-review": policy("gpt-5.6-sol"),
  test: policy("gpt-5.6-luna", "medium"),
  "final-review": policy("gpt-5.6-sol"),
});

export const H05_CODEX_COMPARISON = Object.freeze({
  policies: Object.freeze({
    "sol-implement": Object.freeze({
      ...shared,
      implement: policy("gpt-5.6-sol"),
      repair: policy("gpt-5.6-sol"),
    }),
    "luna-implement": Object.freeze({
      ...shared,
      implement: policy("gpt-5.6-luna"),
      repair: policy("gpt-5.6-luna"),
    }),
  }),
  trials: Object.freeze([
    Object.freeze({ id: "A", variant: "sol-implement", repetition: 1 }),
    Object.freeze({ id: "B", variant: "luna-implement", repetition: 1 }),
  ]),
  allowedModels: Object.freeze(["gpt-5.6-sol", "gpt-5.6-luna"]),
  allowedProviders: Object.freeze(["codex"]),
  trialConcurrency: 2,
});

const sol6 = "gpt-6-sol";
const luna6 = "gpt-6-luna";
const shared6 = Object.freeze({
  triage: policy(luna6),
  scouts: policy(luna6),
  grill: policy(sol6),
  specification: policy(sol6),
  plan: policy(sol6),
  "dev-review": policy(sol6),
  test: policy(luna6, "medium"),
  "final-review": policy(sol6),
});

export const H05_CODEX_COMPARISON_6 = Object.freeze({
  policies: Object.freeze({
    "sol-implement": Object.freeze({
      ...shared6,
      implement: policy(sol6),
      repair: policy(sol6),
    }),
    "luna-implement": Object.freeze({
      ...shared6,
      implement: policy(luna6),
      repair: policy(luna6),
    }),
  }),
  trials: H05_CODEX_COMPARISON.trials,
  allowedModels: Object.freeze([sol6, luna6]),
  allowedProviders: Object.freeze(["codex"]),
  trialConcurrency: 2,
  defaultModel: luna6,
});
