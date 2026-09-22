# Provisional model policy and evaluation scorecard

23 September 2026. This is the default for **new** Harness installations and the source of Frontier Settings' **Use all Codex** and **Use all Claude** presets. Existing saved Settings and task snapshots are not rewritten. It is a practical starting policy, not a claim that the model comparison is complete.

## Evidence so far

| Case | Scope and treatment | Independent result | What it supports |
| --- | --- | --- | --- |
| Early H02 feasibility | Medium Harness UI/API/SQLite task; several balanced/high models under the original tight limits | No accepted delivery; many stopped before candidate review | Calibrated the runner and allowances. It does not rank the models. |
| H02 v7 | Sonnet 5 High Implement/Repair, Sol High review | 11/11 behavior checks; blind review rejected a Settings save-scope defect | Internal green gates are insufficient; Sonnet's implementation quality remains unproven for a default. |
| H05 GPT-5.6 | Small catalog task; Sol High versus Luna High Implement/Repair | Both accepted, 7/7 checks and blind review | Luna can handle this small task. |
| H05 GPT-6 | Same small task with GPT-6 Sol High versus Luna High | Both accepted, 7/7 checks and blind review | No observed migration regression on this one case. |
| H02 GPT-6 | Medium cross-layer task; only Implement/Repair changed between Sol High and Luna High | Sol accepted 11/11 and blind review after one repair; Luna rejected 9/11 after two repairs | Prefer Sol for medium Implement/Repair. Both passed a separate Settings save-isolation probe. |

The GPT-6 H02 deliveries took 27 and 30 minutes in parallel. Their all-call API-rate estimates were $6.07 for accepted Sol and $2.09 for rejected Luna; these are **not** attributable Codex subscription charges. The independent score is one trial per arm, not a pass-rate estimate. MyStrata M01 and PlanCheck P03 historical bases had unrelated quality failures before dispatch, so they supplied no model-performance result. H03 remains a hard **held-out** case.

Private receipts: `/Users/shaun/.codex/model-evaluation/20260923/h05-codex-6-migration-v1` and `/Users/shaun/.codex/model-evaluation/20260923/h02-codex-6-comparison-v1`. The exact H02 candidates are `a120292679628dad82534d25032321b1db1d2311` (Sol, accepted) and `4742783459eca197ec5c08484efb4841c0a45103` (Luna, rejected).

## Proposed defaults

The existing Fast, Standard and High-risk workflow profiles represent **scope and consequence**, not three measured intelligence tiers. Fast covers a proved narrow/low-risk change. Standard covers normal multi-file work. High risk covers security, data, migrations, concurrency and broad architecture, and can also be selected for a genuinely hard task. A complex task does not automatically require Astra; the operator can pin Astra to Specification, Plan or Dev Review when the work warrants it. Deterministic escalation, full candidate verification, and human PR approval remain in force.

Short names below: **L** = GPT-6 Luna, **S** = GPT-6 Sol, **N** = Claude Sonnet 5, **O** = Claude Opus 5.5. `M`, `H` and `X` mean Medium, High and XHigh reasoning/effort.

| Role | Default / All Codex Fast | Default / All Codex Standard and High risk | All Claude Fast | All Claude Standard | All Claude High risk |
| --- | --- | --- | --- | --- | --- |
| Triage, scouts | L-M | L-H | N-M | N-M | N-H |
| Grill, specification | S-H | S-H | N-H | N-H | N-H |
| Plan, Dev Review | S-H | S-H | N-H | O-H | O-H |
| Implement, Repair | L-H | S-H | N-H | N-X | N-X |
| Test | L-M | L-M | N-M | N-M | N-M |
| Final Review | S-H | S-H | N-M | N-M | N-M |
| Verified serious-defect Repair escalation | S-H | S-X | N-X | O-H | O-H |

The Settings fallback model is Sol High for Codex and Sonnet XHigh for Claude. Explicit stage policies take precedence. The provider buttons apply their complete profile-aware matrix and fallback to the Settings draft; they do not alter saved Settings until the operator clicks Save. On New Task, a provider preset snapshots the matching profile policies and constrains future role edits to that provider. Existing task snapshots remain reproducible.

The Codex Standard/High-risk column follows the accepted H02 role matrix. Fast Luna implementation follows the accepted H05 small-task trial. The Claude columns are **engineering hypotheses** built around Sonnet for delivery and Opus only where planning/review judgment can matter; Opus 5.5 has no Harness acceptance result yet. The [official OpenAI model-selection guide](https://developers.openai.com/api/docs/guides/model-selection) describes Luna as an efficient choice for scoped tasks and Sol as an everyday coding model, but vendor guidance is not a substitute for these Harness trials. There is no automatic Astra or Fable assignment in this baseline.

## Finish the evaluation without a large model grid

| Next experiment | Fixed comparison | Decision it informs |
| --- | --- | --- |
| One new medium task in a clean project baseline | Sol High versus Sonnet 5 High Implement/Repair; identical other roles, two independent repeats per arm | Whether a mixed-provider implementation beats the provisional Sol default. Qualify the exact repository baseline before dispatch. |
| Reviewer control set | Sol High Dev Review versus Opus 5.5 High on the same retained clean candidates and known-defect diffs | Material-defect detection and false alarms; do not judge a reviewer by verbosity or number of findings. |
| Held-out H03 hard task | Run the selected policy once, with frozen independent checks and one blind review | Whether the selected policy transfers to hard work. Do not tune prompts or policy on H03. |
| First ten ordinary PR-producing tasks | Record independent acceptance, operator fixes, escaped defects, retries, elapsed time and all-call usage | Confirm the provisional default in real use and roll back future-task defaults if material defects emerge. |

Keep task brief, base SHA, workflow profile, tools, allowances and grader fixed within each paired comparison. Count all attempts, including repairs and failures. Only change one role family at a time; otherwise a win cannot be attributed to a model choice. If a historical case has a pre-existing lint/type/test failure, qualify a different clean case rather than charging that failure to a model. The previous 48-run plan in `model-policy-evaluation-plan.md` remains a longer statistical programme; it is not required to choose a usable initial policy. No additional paid trials are started by this document.
