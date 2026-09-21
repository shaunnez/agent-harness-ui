# Model baseline and repeatable delivery evaluation

Date: 22 September 2026.
Status: baseline remains a hypothesis; the user has authorized case selection and evaluation across Agent Harness, PlanCheck and MyStrataAssist, to continue after compaction. No production policy has changed. Isolated evaluation is underway; current receipts and campaign versions are in MODEL-EVALUATION-CHECKPOINT.md. Resume from [MODEL-EVALUATION-RUN.md](MODEL-EVALUATION-RUN.md).

## Decision

Qualify one understandable delivery policy, then improve it through bounded champion–challenger comparisons. Optimize for independently acceptable changes delivered without operator rescue. Treat correctness, resource consumption, elapsed time and human review burden as distinct measurements.

Start with Sonnet 5 High for implementation and repair, Sol High for specification, planning and reviews, and Luna for bounded fact gathering and test narration. Use Astra High selectively at one difficult specification or planning stage. These are engineering starting choices, not benchmark findings about model superiority. Keep the incumbent policy as the experimental control until promotion is earned.

The unit being evaluated is a versioned policy: model and effort per role, workflow depth, prompts, context supply, tools, approval/clarification rules, and bounded retries. A whole-policy comparison establishes which combination works better. It does not identify which individual role caused a difference.

The established approach is task-based agent evaluation with repeated trials and independently checked outcomes. Anthropic describes coding-agent tasks, trials and graders; SWE-bench separates the issue/base revision, reference patch, tests that must start passing, and tests that must keep passing. Apply those principles to this harness rather than adopting another orchestration platform. [Anthropic agent evaluations](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents), [SWE-bench dataset contract](https://www.swebench.com/SWE-bench/guides/datasets/).

## 1. Authority and verified implementation

Inspected main: `b585649795887356c25559ffd4a9c7f37316ba31`. Inspected evaluation proposal: PR #101 at `272c99e3c615de26b276cddf41dd0c7e529fade1`. Recheck both before implementation. Existing dirty design work is unrelated and must be preserved.

This proposal revises the recommended experimental approach in `model-policy-evaluation-plan.md` and PR #101's experiment documents; it does not rewrite their historical evidence or change executable defaults. Reconcile the selected policy explicitly before implementation: current AGENTS.md specifies Sol High for repair/final review, while built-in defaults and the recorded baseline use Luna for those roles. The proposed Sonnet repair policy below is an intentional proposed change, not a claim about current behavior.

The current stages have different responsibilities:

| Role | Actual contract | Evaluation implication |
| --- | --- | --- |
| Triage | Locate the likely surface, scope/risk, and select scouts; Fast triage also creates a bounded change contract | Grade routing and missed risks; Fast triage is more than classification |
| Scouts | Gather narrow cited facts; no solution design; reports are aggregated deterministically | Measure evidence accuracy and important omissions, not prose sophistication |
| Grill | Identify consequential human decisions and recommended answers | Missing an important question and asking unnecessary questions are separate failures |
| Specification | Synthesize scope, acceptance criteria and test strategy from evidence and decisions | Check requirements coverage and invented/omitted requirements |
| Plan | Define package dependencies, path ownership and verification command IDs | Check executable decomposition, interfaces, unnecessary fragmentation and verification coverage |
| Implement | Write an isolated package within declared ownership | Grade changed behavior, regressions, ownership and integration |
| Repair | Fix consolidated typed candidate defects while preserving approved work | Check root-cause resolution and regressions introduced by the repair |
| Dev Review | Read the exact candidate diff and validate material findings; no test execution | Evaluate defect detection and false alarms on known defective and clean candidates |
| Test | Narrate/interpret verification already executed by the harness | The model does not write the tests or decide whether their exit codes passed |
| Final Review | Reconcile request, decisions, implementation and retained gate evidence | Check traceability, missed acceptance gaps and operator readability |

Sources: `server/prompts.mjs`, `server/scouts.mjs`, `server/orchestrator-investigation.mjs`, `server/orchestrator-specification-planning.mjs`, `server/orchestrator-work-packages.mjs`, `server/orchestrator-repair-execution.mjs`, and `server/orchestrator-gate-evaluation.mjs`.

Fast already omits separate Grill/specification/plan calls when a valid bounded contract permits it; Test and Final Review then have deterministic paths. Preserve those eligibility rules. Changing workflow depth during a model comparison confounds the result.

Model quality is constrained by the handoff. Planning currently receives a specification excerpt capped at 8,000 characters and a two-command repository inspection instruction. Track truncation and missing evidence when diagnosing failures. Do not assume replacing the model repairs an inadequate handoff; test a prompt/context fix separately.

## 2. Proposed baseline: `delivery-v1`

| Role | Small, eligible for existing Fast path | Medium / ordinary bounded work | Hard, bounded work |
| --- | --- | --- | --- |
| Triage | Luna High | Luna High | Luna High |
| Scouts, when needed | Luna High | Luna High | Luna High |
| Grill, when needed | Sol High | Sol High | Sol High |
| Specification, when needed | Sol High | Sol High | Sol High |
| Plan, when needed | Sol High | Sol High | Astra High |
| Implement | Sonnet 5 High | Sonnet 5 High | Sonnet 5 High |
| Repair | Sonnet 5 High | Sonnet 5 High | Sonnet 5 High |
| Dev Review | Sol High | Sol High | Sol High |
| Test narration, when needed | Luna Medium | Luna Medium | Luna Medium |
| Final Review, when model-owned | Sol High | Sol High | Sol High |

Exact IDs: `gpt-5.6-luna`, `gpt-5.6-sol`, `gpt-6-astra`, `claude-sonnet-5`. Effort values are `medium` or `high` as shown. There is no blanket model override. Skipped/deterministic stages consume no model call, regardless of a stored role default.

For a hard task whose principal difficulty is resolving a specification rather than technical decomposition, move the single Astra assignment from Plan to Specification, leaving Plan on Sol High. Decide and record this before dispatch. Material unresolved product choices still require authoritative input: a stronger specification model is not permission to invent them. No automatic second Astra review/repair call is part of the initial policy.

Why this starting point:

- Keep capable models on the stages that create executable contracts and inspect the result. Sonnet implementation plus Sol review provides model/provider diversity without paying frontier rates on every run. Diversity is a hypothesis about useful independent judgment, not proof that errors are uncorrelated.
- Keep the implementation model capable while establishing reliability. Test Luna High/Max and Terra as later implementation challengers; neither low price nor a historical subsidy establishes cost per correct change.
- Avoid an effort grid initially. High is an explicit starting setting for substantive engineering; it is not equivalent compute across providers. Lower effort only after matched testing shows acceptable behavior.
- Keep repair bounded under the existing attempt limits. Start with the same repair model as implementation so ordinary delivery retains a different reviewer. On exhausted reasoning-related failures, stop with retained evidence; test a snapshotted stronger repair policy as a later challenger. Do not add an unbounded model-escalation ladder.
- Opus, Fable and future releases enter as named challengers. The user's Opus readability concern is a criterion to measure, not evidence that all Claude models are unsuitable. Do not predict unreleased model quality.

This follows the general accuracy-first, then cost/latency approach; the exact assignments above are this proposal's choices, not vendor recommendations. [OpenAI model selection](https://developers.openai.com/api/docs/guides/model-selection). Claude's effort guidance also recommends evaluating effort changes and distinguishes thinking effort from visible response length. [Claude effort](https://platform.claude.com/docs/en/build-with-claude/effort).

## 3. Difficulty, risk and readiness

Use three separate recorded properties, without building a sophisticated router:

| Property | Meaning | Initial behavior |
| --- | --- | --- |
| Difficulty | Small, medium, hard, complex | Selects the capability policy; complexity is not file count alone |
| Risk | Low, medium, high consequence of a wrong change | Selects required assurance, evidence and approvals |
| Readiness | Ready, needs clarification, needs decomposition | Determines whether autonomous implementation can safely begin |

- **Small:** familiar, isolated change with clear acceptance; existing Fast eligibility must also pass.
- **Medium:** bounded feature or bug involving several ordinary interactions; defaults to the ordinary policy.
- **Hard:** bounded but requires difficult diagnosis, architecture, integration or invariant reasoning; selective Astra assignment.
- **Complex:** several unresolved subproblems or material decisions; first produce a bounded decomposition/clarification. Resolved work can then become medium/hard tasks. If already well specified and safely expressible in the existing package system, it may proceed as hard; do not mechanically split every large task into a new task hierarchy.

Triage proposes a classification with cited reasons, and deterministic sensitive-boundary rules establish a risk floor. Unknown difficulty defaults to medium; unresolved consequential requirements set readiness to needs clarification. Allow an operator override and retain its provenance. Triage must not silently reduce an operator-specified risk level. Evaluate the router separately on labelled cases, especially small but high-risk changes.

Map to existing Fast/Standard/High-risk workflow semantics, rather than replacing their state machine. Risk and difficulty are currently conflated in places and are not all available as independent persisted fields. Initial experiments can set these labels in their manifests and use explicit role matrices; introducing production controls is a later bounded implementation slice.

Nontechnical users describe the intended outcome and examples, receive a suggested classification, and see one status: progressing, needs a decision, ready for PR review, or stopped with a reason. Model/effort selection belongs in advanced settings. Automation receives the same task contract, not a bypass around approvals or candidate validation.

## 4. Build a small, reusable golden suite

Start with **12 delivery cases**: four small, four medium and four hard. Use two from each difficulty for development and reserve two for held-out validation. Include at least one case from each actively supported repository; do not claim qualification for an unrepresented repository. Add **four routing/abstention controls** separately. Grow toward 20–30 delivery cases from real incidents rather than inventing a large benchmark upfront.

Suggested coverage, to be replaced with reviewed real task IDs and exact revisions:

| Class | Four delivery cases |
| --- | --- |
| Small | Copy with a precise visual assertion; isolated UI interaction; narrow API validation bug; local persistence/readback regression |
| Medium | UI/API/database vertical feature; state refresh after a mutation; established-schema evolution; cross-module business rule |
| Hard | Concurrency/idempotency defect; authorization/data isolation; migration/backfill compatibility; interacting-package integration bug |
| Controls, separate | Missing material product decision; simple wording hiding a sensitive boundary; unready complex request needing decomposition; broken baseline environment |

A control succeeds by asking, routing or stopping appropriately. It is not counted as a delivered PR. High-risk delivery cases use isolated synthetic data and environments.

For every delivery case retain:

1. Case ID/version, repository, starting SHA, self-contained brief, difficulty/risk, and immutable fixtures. Freeze any screenshots, design reference and answers to consequential questions.
2. A reviewed reference implementation that passes the evaluator. A human previously solving it is useful starting material, not sufficient proof that the new evaluator is correct.
3. Independent task-specific acceptance checks: behavior that fails on the base and passes on the reference, plus existing behavior that must remain passing. Include browser interaction/visual inspection for UI requirements, API validation, and database migration/persistence checks where applicable.
4. An environment recipe: dependencies, services, database seed/reset, runtime/tool versions, resource allocation, command manifest and cleanup. Keep credentials and production records out of fixtures.
5. A concise grading rubric and case-specific unacceptable outcomes. Each acceptance criterion maps to a check or an identified human/model rubric item.
6. Expected readiness/clarification behavior, workflow profile, retry allowance, and time/resource ceilings. Choose ceilings after apparatus qualification, then freeze them before comparison.

The golden answer is expected behavior and constraints, not exact prose or a required code diff. Validate that unchanged code fails the new behavior checks and that meaningful seeded defects also fail. A baseline model failing a valid case is a model-policy result, not a reason to declare the case invalid.

Keep reference patches and held-out checks outside agent access, including later Git history and retained task artifacts that reveal the solution. Evaluate the exact candidate in a separate disposable grading checkout/database so evaluator files cannot be edited away and browser artifacts cannot dirty the candidate. Local worktrees can remain the execution mechanism; another container platform is not mandatory.

For Grill, use frozen requirements and an answer sheet independent of the model's recommendations. An evaluator may answer differently worded questions from that sheet; it must log the answers and not improvise features. If fully autonomous runs simply accept whatever each arm recommends, they may solve different tasks. Unanswerable material questions count as appropriate stops only in the designated controls.

## 5. Score delivery, not appearances

A **trial** is one complete task execution under a frozen policy, including its permitted repair loop. A repair is not a new independent trial. A **policy/package** is the group of role assignments; an implementation **work package** is a code slice. Keep those terms distinct in the data model.

Primary metric for ready delivery cases:

**Autonomous accepted-delivery rate = independently acceptable final candidates completed within the allowance and without substantive human rescue / valid scheduled delivery trials.**

Acceptance requires the task-specific checks, regression checks, material correctness/scope rubric, and exact-candidate evidence to pass. Count a model failure before candidate assembly, unusable output contract, exhausted repair allowance, or policy-budget exhaustion as non-delivery. Waiting states need a recorded trial end condition; merely reaching a parked task state is not always an outcome.

Separate these measures:

| Measure | Purpose |
| --- | --- |
| First-pass acceptance, before any repair | Detect whether the initial result is good |
| Eventual acceptance within the frozen loop | Measure the deployable policy's reliability |
| Acceptance by case and difficulty | Prevent easy tasks masking hard-task regressions |
| All-runs operational completion | Include infrastructure/provider failures experienced by users |
| Human interventions and review minutes | Detect hidden operator rescue or unreadable handoffs |
| Candidate defects and false review alarms | Explain failures and unnecessary repair |
| Total and per-stage resources | Include every attempt, retry, repair and failed run |
| Time to acceptable candidate | Separate execution, verification queue, provider wait and human wait |
| Delivery/publishing/merge status | Keep code correctness distinct from GitHub delivery and human decisions |

Only an adjudicated non-model apparatus failure can make a quality trial invalid. Keep its reason, original record and consumed resources visible; rerun under a predefined rule. Pending/cancelled/unexplained trials remain visible and block a final comparison when unresolved. Do not silently remove them or label them successes. Report an additional operational rate over all scheduled trials, so excluding an infrastructure failure from model-quality analysis cannot hide poor service reliability.

Resources per accepted delivery include unsuccessful valid trials. Also show total campaign expenditure including invalid trials. When there are zero acceptances, the ratio is unavailable/unbounded, never zero. Token totals, measured plan credits/quota where available, and versioned API-rate estimates are different units. Astra is currently absent from the built-in price table and Fable 5.1 has an explicitly unconfirmed placeholder: missing/unverified rates must block a dollar-cost ranking, not make a model appear cheap.

Use deterministic checks for behavior and state. Use a fixed, blinded external rubric grader for maintainability, scope and clarity, calibrated against a small engineering-reviewed sample. The external grader is not one of the changing workflow reviewers. Remove model names and policy labels from its input; adjudicate material disagreements. Persist both grader versions and scores bound to the candidate SHA, rubric and case version. A beautiful report cannot compensate for a failing correctness check.

Keep one primary decision metric, with explicit secondary constraints/tie-breakers. Select for reliability first; among packages with no observed material quality regression, compare resources per acceptance, elapsed time and human burden. Choose the practical tradeoff before the batch. Avoid a weighted magic score that allows low cost to cancel a data-integrity defect. The AWS article supports evaluating quality, latency and cost together; it does not prescribe this project's acceptance thresholds. [AWS model evaluation](https://aws.amazon.com/blogs/machine-learning/beyond-vibes-how-to-properly-select-the-right-llm-for-the-right-task/).

## 6. Initial comparison and promotion

Before inference, fix the scoring gaps listed in section 9, validate a reference solution and a deliberately wrong solution, qualify environment setup, and confirm actual model/effort dispatch. Freeze an independent experimental worktree root, task store and test database. A failed preflight stops the batch.

### Batch A: one vertical task, three policies, three trials = nine tasks

Choose a bounded UI/backend/database case from the development split with genuine planning decisions. Run:

- `incumbent-v1`: exact export of current effective policies, including repair behavior and workflow depth.
- `balanced-v1`: the medium column of the proposed baseline.
- `selective-frontier-v1`: balanced with Plan changed to Astra High. Every other assignment stays identical.

Record classification before dispatch; an experiment deliberately testing Astra on the same case is not production permission to route every medium task to Astra. Keep workflow depth, verification, tools, clarification policy and retry limits equal. Rotate or randomize arm order by repetition and cap concurrency. Resource conditions can materially affect coding-evaluation outcomes, so record them with the policy. [Anthropic infrastructure study](https://www.anthropic.com/engineering/infrastructure-noise).

This screens packages and tests whether frontier planning buys a useful improvement. It cannot establish broad defaults or precisely estimate small differences. Preserve failed runs. If a harness/prompt defect is fixed, version the experiment and rerun affected comparisons rather than pooling incompatible runs.

### Batch B: finalists on six held-out cases, two trials each = 24 tasks

Compare the best two qualified packages on the six untouched cases: two per difficulty. For a tiered policy, predefine its entire mapping before opening held-out results. Keep workflow depth fixed per case across arms, including Fast for eligible small cases. If Batch A is inconclusive, retain the incumbent in the comparison. Do not select a winner by cheapest single success.

Nine plus 24 is a proposed staged campaign, not an assertion that 33 trials establishes statistical confidence. The user's subsequent execution instruction authorizes this bounded evaluation through the existing authenticated runtimes. Establish conservative equal per-arm resource ceilings after apparatus qualification and freeze them before comparison; record consumption and enforce the ceiling in the runner rather than relying only on scoring-time disqualification. Do not purchase credits or switch to separately billed API execution under this authority. Stop early for repeated infrastructure defects, unavailable providers or invalid grading. Do not keep funding full workflows to diagnose the apparatus.

Before Batch B, freeze promotion requirements. Recommended initial release target: at least 90% autonomous accepted delivery in the measured ready-task suite, no material security/data-integrity escape, no unresolved systematic failure, and no observed case-class regression against the incumbent. With 12 held-out trials per arm, meeting 90% requires at least 11/12; that is only a small-sample release screen, not proof of a 90% population success rate. Repeats on a case are correlated evidence about that case. Show per-case results and uncertainty; never advertise a high-confidence SLA from this pilot.

If both miss the bar, inspect failure origins and repair the dominant problem rather than choosing the less bad package as a general autonomous default. A demonstrably improved policy may be piloted on a narrower supported class with explicit limits. If they tie, prefer the cheaper/faster policy only when the difference is operationally useful and measured; otherwise retain the incumbent and gather focused evidence.

After offline qualification, use a limited deployment on ordinary ready tasks with mandatory PR review. Track the first 20 eligible tasks without filtering failures; review incidents immediately. Twenty is an operational checkpoint, not a statistical guarantee. Expand only the case classes supported by evidence. Keep the previous version available for new tasks; do not rewrite running tasks' snapshots.

## 7. Optimisation and new models

Maintain one incumbent per supported difficulty mapping and one challenger at a time. Do not search the full model × effort × role grid.

1. Use traces to locate the cost or failure concentration. Distinguish bad requirements, missing context, plan ownership, implementation defects, false review alarms, environment failures and output parsing.
2. Save stage inputs and replay the changed role against the same evidence. Use realistic upstream artifacts, including representative imperfect handoffs. Grade the role's contract, then inspect downstream effects.
3. Change one role or one coherent hypothesis. For example: Sonnet High vs Sol High implementation; Sol High vs Astra High planning; Sonnet High vs Terra High implementation; Luna High vs Max on a bounded low-risk slice. Changing model and effort together tests the pair, not their independent effects.
4. For reviews, use known material defects and clean controls, measuring recall and false alarms. Cross-model review earns its place by catching real defects without needless repair, not by producing more findings.
5. Rerun the complete policy on matched tasks before promotion; a locally improved role can hurt the workflow. If two roles interact, run a small two-by-two comparison only after evidence points to that interaction.

Prioritize cheap stage screening before whole-task runs for later model updates. Astra/Fable should first challenge the difficult reasoning role; new Opus versions can challenge the same role or implementation, including clarity and structured-output validity. Keep output-contract and tool-use compatibility as admission checks. Do not make readability a hidden preference or infer model capability from pricing.

An open-source model is another candidate once its adapter supports the required tools, schemas, isolation, timeouts and telemetry. Measure the actual hosted/local deployment, including hardware cost, memory, concurrency and latency. Do not add that provider integration to this first qualification programme.

Every result fingerprints case/base/fixtures, role policies and resolved model IDs where exposed, provider/CLI versions, prompts/context rules, tools, workflow depth, retries, environment, evaluator and price card. Alias drift without a stable provider revision must be disclosed and triggers regression checks. Do not silently overwrite historical rates or selected policies.

When a model, prompt, tool or provider CLI changes: compatibility smoke test → targeted stage replay → matched end-to-end regression → limited rollout → explicit promotion. Run on demand for these changes and on a modest planned cadence once the suite is useful; do not rerun an expensive full campaign on every application commit. Held-out cases become regression cases after results guide tuning; introduce fresh held-out cases for later claims.

## 8. Learn from real work without learning the wrong lesson

Add a small review outcome: accepted as-is; cosmetic edits; material rework; rejected; or defect found after merge. Bind feedback and subsequent corrective changes to the exact candidate/policy. Capture review time with a simple recorded value rather than inferring it from PR age. A merge is not automatically proof of correctness, and a closed PR may have been cancelled for unrelated reasons.

Use the existing task/run store for observations. Keep controlled experimental results separate: difficult tasks tend to receive stronger models, so a raw production failure rate can unfairly make the stronger model look worse. Observations identify hypotheses and case candidates; they do not automatically promote model policies.

Periodically select representative successes, expensive repairs, false review alarms and escaped defects. An engineer sanitizes the case, reproduces the failure, writes/reviews acceptance checks, confirms the reference solution, and adds a versioned regression. Do not let an agent relabel its own output as golden truth. Prevent near-duplicate incidents and leaked reference solutions from dominating the suite.

No automatic fine-tuning, self-modifying prompts or learned router is needed initially. Learning means improving the case bank and promoting policies through evidence.

### Follow-up: bounded retry escalation

The user subsequently requested stronger reasoning and/or a stronger model when implementation fails. This is a production-policy hypothesis to qualify after the fixed-policy baseline, not an uncontrolled exception to the experiment. Failure alone does not justify escalation: distinguish a candidate defect from provider interruption, invalid output, missing requirements and broken verification infrastructure.

For a genuine code/reasoning failure, a later challenger may raise effort on the next permitted attempt and use a predeclared stronger repair model if the same material defect persists. Freeze the trigger, eligible model/effort pairs, total attempt allowance and budget before dispatch; escalating never resets the attempt count or weakens gates. Preserve provider constraints and explicit pins. The existing resolver escalates only unpinned Repair roles on eligible material candidate defects within the same provider; it does not implement a general implementation-retry ladder.

Keep escalation out of the first comparison by using explicit fixed policies and verifying actual dispatch. Then compare the selected baseline with its bounded escalation variant on matched cases, especially cases that previously required repair. Report initial-attempt success, eventual acceptance, escalation frequency and total resources separately. A deployed escalation policy must be represented in end-to-end qualification; it cannot be omitted from costs or credited as if the original model succeeded unaided.

## 9. Smallest implementation path

Reuse `server/evaluation.mjs`, `server/experiment-decision.mjs`, task policy snapshots, existing run telemetry and candidate evidence. Keep case/policy/grader definitions in repository files and trial outcomes in the existing store. Avoid another evaluation service, a new workflow engine or an elaborate experiment UI.

| Slice | Required work | Acceptance |
| --- | --- | --- |
| 1. Trustworthy outcomes | Classify pre-candidate failures; separate validity from delivery; bind declared checks to executed definitions; enforce comparability in ranking; preserve missing-cost coverage | Synthetic tests prove that early model failure cannot inflate delivery, contaminated policies cannot win, omitted frozen checks cannot pass, and unknown costs cannot win a cost comparison |
| 2. Golden case and runner | One validated vertical case, isolated provisioning, three frozen policies, candidate-bound external grading, explicit trial IDs and intervention recording | Base fails new feature checks; reference passes; a seeded defect fails; dry run performs no model execution or real publication |
| 3. Repeated evaluation | Batch A report, six held-out cases for Batch B, resource ceiling and predeclared promotion rules | Matched outcomes, all attempts and costs retained, per-case comparison, uncertainty and concrete promote/retain recommendation |
| 4. Limited team/autonomous delivery | Qualified policy selection, risk/readiness routing, PR evidence receipt and reviewed feedback | Intake-to-PR acceptance demonstrated on an isolated test repository; ambiguous tasks stop correctly; manual review/merge remains explicit |

The PR #101 scorer at the inspected head has three reproduced limitations relevant to slice 1: no-candidate failures become excluded unknowns; a policy-divergent variant can still be ranked as leader; and checking executed IDs against a run's own declared IDs does not prove the frozen experiment manifest was executed. Its 18 evaluation tests passed in this review, but those reproductions are not covered. Add focused behavioral regressions before changing the metric. Also validate prompt/runtime/workflow identity and bind human scores to candidate revisions rather than treating a task-level score as timeless.

For autonomous publication, the inspected checkout auto-advances specification, plan and run gates when configured, but `approvePullRequest` is a separate approval path and the recorded publication artifact is explicitly human approval. The user's tool-driven pipeline may provide that last step; its integration has not been verified here. Preserve exact-SHA publication and test the full route separately from model quality. If automation publishes a PR, record automation provenance rather than falsely claiming a human approved it. This is a qualification requirement for the intended workflow, not permission in this document to change publication authority.

Offline model trials should stop at the independently graded candidate/PR-ready receipt; exercise actual PR creation separately with mocked GitHub contracts and, when authorised, an isolated repository smoke test. Do not publish dozens of benchmark PRs into working repositories. Report ready-candidate success and actual publication success separately. Final merge remains manual under the requested operating model.

The user has authorized execution after compaction and delegated case selection across the three named projects. This document records that authority but does not itself change runtime settings, enable automated publication, start services or consume model-evaluation quota. Production policy promotion and rollout remain distinct from isolated evaluation. See the run brief for the ordered execution and reporting contract.
