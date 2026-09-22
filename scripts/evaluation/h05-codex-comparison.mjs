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
