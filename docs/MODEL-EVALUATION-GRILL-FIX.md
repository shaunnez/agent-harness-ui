# Grill correction and evaluation allowances — 22 September 2026

The requested product fix is implemented and locally qualified in isolated branch `codex/model-evaluation-20260922`, product commit `4c5caf3`. No new delivery evaluation or real reviewer call ran during this change. The historical rejected candidate and all its receipts remain unchanged; this fix does not turn that result into a pass.

## Product findings and correction

The retained H02 candidate `0389a30f502e63fe8cbccac399dcc874a4792afd` omits automatically selected answers from specification context, as the prior diagnostic confirmed. Current main `3878a2419979465a53171cd59a5cff455a6a2646` already copies those answers into `task.decisions` through `completeGrillSession`. Its remaining defect is that prompt construction labels them “human decisions” and drops the automation source. These are distinct implementations.

`server/prompt-decisions.mjs` now combines recorded decisions with resolved Grill answers, avoids duplicating a question, and includes the recorded answer source. This also covers older records that retained answers only in the session. Specification, Plan and other downstream prompts using the shared decision formatter receive the answer and its provenance. The context manifest reports recorded decisions without falsely claiming they are all human. Unknown legacy attribution remains unknown; no historical database migration is performed.

The Frontier UI concern was reproduced in the browser. Completed automatic questions and answers existed low in the inspector, while the central Grill pane showed only “Decisions recorded” and misleading instructions to continue. Completed Q&A now appears directly in the main Grill pane, with “Accepted automatically”, “Answered by operator”, or the recorded alternative source. Completed sessions remain inspectable after Specification starts. Manual answering remains interactive; zero-question sessions say “No material questions”.

## Allowances for new evaluations

The 200,000-token / five-minute reviewer allowance was an evaluator choice introduced in earlier evaluation work, not a provider requirement or a limit selected by Shaun. It should have been reconciled with the instruction to prioritize getting complex tasks working. The old completed review remains governed by its original frozen allowance; new work uses the following configuration.

| Scope | New allowance |
| --- | --- |
| Whole delivery task | Two hours and 30,000,000 total tokens |
| Each model stage call, including Implement and Repair | One hour, subject to the remaining whole-task deadline |
| Delivery run-count safeguards | 100 agent runs / 1,000 provider invocations |
| Independent blind review | One hour and 30,000,000 tokens, separate from delivery usage; one reviewer invocation |

The run-count safeguards use the existing API-supported maxima. These apply to every newly prepared evaluation mode, not only feasibility. Model assignments are unchanged. The ordinary workflow's repair/attempt policy is unchanged. These are generous ceilings, not target consumption, and not production runtime defaults. An in-flight call may still overshoot a token ceiling because final usage is reported after completion.

The rubric is versioned `delivery-rubric-v5`. The finalizer's previously hidden 330-second parent timeout now follows the declared review allowance plus 30 seconds for shutdown. The arbitrary one-to-three inspection-command / 1,500-output-token instruction is removed; review remains read-only with focused, bounded output. No old campaign freeze, review receipt or score was rewritten.

## Qualification

- Actual orchestration with a mocked provider captures the dispatched specification prompt and checks the automatically chosen answer, automation source and decision context manifest.
- Prompt tests cover automatic, manual, manually accepted recommendation and uncertain legacy sources, with and without duplicated decision rows, in Specification and Plan.
- A synthetic reviewer subprocess reports 229,204 tokens and successfully emits a grade with full usage under the new allowance. This verifies runner accounting; it is not a model review or model-quality result.
- Zero-inference preparation verifies all nine dry-run configurations and a real API-created SQLite task carry two hours / 30M tokens and all ten one-hour stage overrides. The first preparation exposed an unsupported 256-run value; the corrected 100-run value passed admission with zero provider invocations. Both preflight records are retained under `grill-allowance-preflight*` in the private evidence root; these are not delivery trials.
- Browser verification at 1280 × 900 used an isolated API and deterministic providers. Automatic Q&A is central and attributed; a non-recommended manual answer can be submitted, survives specification creation, and remains visible in recorded Grill. A fresh automatic fixture on the restarted corrected API confirms persisted reload and the new context-manifest wording. No production tasks were used.
- Passed: 36 focused tests; full core suite 764; Frontier 165; Frontier API 18; Sites 4; lint; format; typecheck; both application builds; verification-manifest validation. Build output retains the existing large-chunk advisory.

Private logs and QA launch metadata: `.data/grill-fix/` in the canonical worktree. The preview uses `http://127.0.0.1:5174/#task/AH-003`, with a fixture-only API on 4337. The obsolete 5297 QA server was stopped. User services were preserved. Preview process availability should be rechecked on resumption.

## Next evaluation unit

1. Extend the versioned independent H02 checker to assert that selected automatic answers and provenance actually reach Specification. Qualify against a passing reviewed reference, the task base, a context-loss mutant and the retained failing candidate. These product regression tests do not replace independent checker qualification.
2. Freeze one fresh balanced-policy H02 baseline with the corrected harness, qualified checker and new allowances. Run its exact isolated base's full preflight before any inference. Do not retry or amend the old candidate. One task plus one review has a maximum declared scope of three hours / 60M tokens; expected consumption is lower and no additional attempts should start silently.
3. Only after independent acceptance, compare a single role/model change on the same frozen case. One successful task does not establish a dependable pass rate or justify promoting defaults.

The latest request said another run was probable and asked for the next step; no fresh campaign has been launched. PlanCheck and MyStrataAssist still require their own full passing preflight and qualified acceptance checks. No comparison winner, PR publication, merge, production activation or deployment is claimed.
