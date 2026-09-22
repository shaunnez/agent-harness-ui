# Model policy, Astra evaluation and automatic routing plan

> Historical long-form plan. Policy fidelity and initial H02/H05 trials have since run. The current provisional role matrix, evidence scorecard and smaller remaining evaluation plan are in [model-policy-baseline-2026-09.md](model-policy-baseline-2026-09.md). The current user request to set provisional defaults supersedes this plan's older no-default-change instruction; the proposed 48-run statistical programme remains optional.

Date: 11 September 2026
Status: proposed delivery plan; implementation and evaluation runs have not started.

## Outcome

Make Frontier's selected model policies trustworthy, establish whether an Astra-heavy policy improves delivery, and use measured results to select models automatically where appropriate.

Success means correct, independently accepted changes with less operator intervention and acceptable execution time and resource consumption. Model completion, self-scores and inexpensive tokens are not sufficient evidence of success.

Deliver in order: **P1 policy fidelity → P2 evaluation readiness → P3 controlled comparison → P4 limited rollout → P5 automatic routing.** Each phase has its own acceptance gate. P1 is the recommended first implementation slice.

This document authorizes no model runs, default changes, service restarts, publication, PR delivery or implementation by itself. Those actions belong to future execution of the plan. The user owns policy promotion and the evaluation budget; the implementation owner produces the evidence and recommendation.

## Evidence and current limitations

The preceding read-only review found:

- Standard uses Luna XHigh for triage, scouts, Grill, specification, implementation, repair and Test; Sol High for Plan and Development Review; Luna Medium for Final Review.
- Saved High-risk settings strengthen Specification, Plan and Final Review. Built-in provider presets instead have identical Standard and High-risk matrices.
- Provider presets write explicit overrides for every role. Those overrides survive profile escalation, potentially preventing the stronger defaults expected from the new profile.
- Repair resolution ignores its repair role policy: it normally uses implementation policy and can force Codex Sol High after certain failures or risk findings, even for a Claude task.
- Auto profile selection starts with keyword matching. Negated risk terms can select High-risk. Later checks mainly govern escalation out of Fast.
- Fast changes workflow depth, including omitted model stages and deterministic closing gates. Outside Fast, scout caps currently follow priority.
- The inspected SQLite snapshot contained 73 tasks, six experiment-tagged tasks, no recorded evaluation scores and one Astra run. This is not a controlled model ranking.
- Astra was present in the local model catalogue and allowlist, but absent from the built-in pricing tables.

These are dated observations, not invariants. The planning checkout was clean at `f18c567374e9ec42f2e4d4ac2598948ec0698100`; the preceding review inspected an earlier head. Recheck the relevant implementation and settings before starting P1. Preserve concurrent work and user services.

Relevant implementation:

- `server/policy-defaults.mjs`, `server/task-policy-snapshot.mjs`, `server/model-catalog.mjs`
- `server/orchestrator-run-policy.mjs`, `server/orchestrator-repair-execution.mjs`
- `server/workflow-profiles.mjs`, `server/scouts.mjs`
- `server/evaluation.mjs`, `server/retained-evidence-routes.mjs`
- `src/frontier/runtime/policies.ts`, `src/frontier/views/PolicyMatrix.tsx`
- `docs/workflow-product-contract.md`

AGENTS.md's Sol High repair/final-review guidance conflicts with the observed Standard implementation. Reconcile this explicitly when implementing the agreed policy contract; do not silently declare either the current implementation or a proposed Astra matrix authoritative.

## Scope

Required: policy fidelity, clear provider-preset semantics, reproducible experiments, independent quality assessment, an opt-in Astra policy, staged promotion and auditable deterministic routing.

Preserve the current workflow gates, exact-candidate evidence, human approval, isolated worktrees, provider authentication and role-policy mutation eligibility. Use the existing CLI execution paths; do not introduce API-key execution for this programme.

Outside scope: a new orchestration framework, a learned routing service, automatic gate approval, automatic merging, a visual redesign, changes to design-generation policies, and broad prompt optimisation. Evaluate workflow-depth changes separately from model-policy changes.

## P1 — Make policy selection match execution

### Work

1. Establish one server-owned effective-policy resolver used for both reservation and execution. Make the repair role use its own selected policy. Any escalation must be explicit, provider-compatible and recorded before dispatch.
2. Distinguish preset inheritance from an operator's explicit per-role pin. Selecting a provider preset should retain that provider's profile-aware matrix, while changing an individual role pins that role. Provide a clear reset-to-preset/default action.
3. Treat “all Codex” and “all Claude” as provider constraints for model-owned workflow roles. Mixed selection remains supported. If no eligible escalation model exists within the constraint, surface an actionable block instead of silently crossing providers.
4. Persist policy version, profile, role, source, selected model/effort, effective model/effort and any escalation reason. Reuse existing snapshots and run metadata where possible; add only fields needed to close provenance gaps.
5. Show the effective upcoming policy and the actual recorded policy for past runs. A profile change must identify which future roles change and which remain pinned.
6. Preserve historical task/run snapshots. Treat legacy explicit overrides as pins when their intent cannot be recovered. Do not infer that a matrix matching a preset was necessarily chosen through that preset.
7. Define a narrow automatic repair-escalation contract: an eligible unpinned role may use a snapshotted stronger policy for a verified reasoning/candidate failure. Pinned roles require an explicit eligible policy change. Infrastructure failures do not trigger reasoning escalation. Repair limits remain unchanged.

Do not simultaneously change the shipped model defaults. P1 corrects selection semantics; P2 creates explicit experimental presets. Historical inconsistencies remain inspectable with truthful provenance.

### Acceptance

- A custom repair selection is the policy actually dispatched, including across retry and restart.
- Reservation and execution agree on provider, model and effort.
- Claude-only repair never silently executes on Codex, and vice versa.
- Profile escalation updates inherited future roles but preserves explicit pins and completed evidence.
- Unsupported/unavailable policies produce actionable errors rather than an arbitrary substitute.
- New-task preview, saved settings, task snapshot and run metadata agree.
- Existing tasks retain recorded history and lifecycle restrictions; legacy behaviour requiring a policy change is surfaced rather than silently rewritten.
- Focused regression tests cover these contracts, including mixed-provider tasks and concurrent eligibility changes.

## P2 — Prepare two policies and a valid comparison

### Experimental policies

Create immutable, named versions of:

- **Baseline v1:** a frozen export of the agreed existing matrices after P1, with its corrected repair semantics documented. Do not compare against the old broken resolver as if it were the same treatment.
- **Astra trial v1:** the proposed matrix below. It is opt-in and does not replace saved defaults.

| Role | Astra trial v1 |
| --- | --- |
| Triage | Astra Medium |
| Scouts | Luna High |
| Grill | Astra Medium |
| Specification | Astra High |
| Plan | Astra High |
| Implementation | Astra Medium for Standard; High for High-risk |
| Repair | Astra High |
| Development Review | Astra High |
| Test interpretation | Astra Medium |
| Final Review | Astra Medium for Standard; High for High-risk |

This is a hypothesis, not a validated optimal matrix. The initial comparison uses fixed Standard or High-risk workflows per case, never Auto/Fast. Deterministic verification remains authoritative in both arms. No XHigh/Max sweep is part of the first comparison.

All-Claude remains a supported preset under P1. A matched Claude comparison is a separate optional experiment after the two-arm pilot; do not claim that the pilot ranks Claude against Astra.

### Evaluation readiness

1. Extend the existing evaluation endpoints and summary rather than creating another evaluation store. Retain human and blind scores with explicit case and policy-version identity.
2. Record per-case base SHA, brief/attachment hashes, acceptance definition, prompt/skill versions, workflow profile/depth, environment/tool versions, verification manifest, model catalogue snapshot and actual policies at every run.
3. Validate comparison compatibility. Label or reject mismatched case/base/workflow/prompt records; an experiment group ID alone does not establish comparability.
4. Capture operator interventions and review minutes. Separate execution, verification queue, provider wait and human wait where recorded; report unknown where historical data cannot support the split.
5. Classify failures as candidate defect, output-contract failure, provider/auth/quota, environment/dependency, harness defect, cancellation or unknown. Preserve raw evidence and do not force uncertain failures into a model-quality category.
6. Bind gate success to the final exact candidate and fresh evidence. Do not treat an earlier PASS on a superseded revision as eventual success for the delivered candidate.
7. Count task outcomes once per task. Retried artifacts must not multiply that task's human score or hide failed attempts that produced no artifact.
8. Verify current first-party Astra rates before adding any estimate. Preserve unknown values and coverage counts. Keep API-rate estimates distinct from attributable subscription charges; never invent work-credit conversion rates.

### Acceptance

- Frozen policy versions and actual run policies can be exported and compared.
- Aggregation tests cover missing scores/costs, failed runs without artifacts, repeated artifacts, stale gates, differing bases and partial experiments.
- A paused task's waiting time cannot masquerade as model execution latency.
- The trial preset is selectable only when its models/efforts are eligible; unavailable models do not silently substitute.
- No existing defaults or historical price records change merely because the trial preset is installed.
- A dry run validates the experiment manifest and isolation without invoking a model.

## P3 — Run the controlled pilot

### Suite and execution

Prepare 12 cases: four narrow changes, four ordinary features/bugs, and four complex or consequential changes. Include specification ambiguity, frontend behaviour, cross-module logic, access-control/data-integrity concerns and a difficult repair. Use isolated non-production fixtures for consequential cases.

Each case has the same starting SHA, brief, acceptance checks, workflow depth, tools and budgets in both arms. Assign Standard or High-risk before execution. Use two independent repetitions per arm: **12 cases × 2 policies × 2 repetitions = 48 task runs**. This is an initial signal, not a claim of statistical certainty.

- Freeze acceptance checks before generation and keep independent checks outside candidate write access.
- Randomise/interleave arm order to reduce provider-load and cache-order bias.
- Use fresh isolated candidate worktrees, stable concurrency and the existing verification ceiling. Do not stress-test throughput during a quality comparison.
- Keep prompts and skills identical for the first policy comparison. Any model-specific prompt changes require a new experiment version.
- Define elapsed-time, retry, repair and resource ceilings before launch. Include a pilot of two matched cases in the planned total; inspect operational failures and usage before authorising the remaining cases.
- If pilot findings require configuration changes, version the experiment and rerun affected cases rather than pooling incompatible results.
- Stop the campaign for isolation failure, corrupted evidence or exhausted approved budget. Retain incomplete/failed attempts in the report.
- Do not publish candidate PRs or merge experimental outputs. Score readiness using retained candidates and checks.

Prepare a small separate reviewer test set containing known material defects and clean controls. Measure detection and false alarms; do not reward a reviewer merely for generating fewer findings. Freeze the set and its additional run budget before execution.

### Scorecard

| Measure | Definition |
| --- | --- |
| Accepted delivery rate | Independent acceptance checks and human review pass on the exact final candidate / all scheduled attempts; show unrun attempts separately |
| First-pass accepted delivery | Accepted without candidate repair or operator correction; report denominator and count |
| Material defects | Severity and type of missed or introduced defects; critical findings are individually reviewed |
| Operator burden | Intervention count and recorded review/correction minutes |
| Convergence | Repair/retry count, separated by classified cause |
| Delivery time | End-to-end elapsed time plus separate execution/wait components; report median and tail where sample size permits |
| Resource use | Input/output/cached tokens, supported credits and API estimates, including failed/repaired attempts |
| Reviewer quality | Known material defects detected and false positives on clean controls |

Report matched case-level results and paired differences, not only pooled averages. Show exact sample counts and uncertainty. Divide total arm resource consumption by accepted deliveries to expose expensive failure/rework; keep missing estimates explicit. Record post-approval defects during P4, since a pilot cannot establish long-term defect escape rates.

### Decision gate

Before launch, record the operator's acceptable resource ceiling and what improvement in review burden or elapsed time would justify Astra. Do not choose thresholds after seeing results.

Recommend Astra promotion only if independent correctness is at least as convincing on matched cases, no unexplained material regression remains, and the operational benefit justifies measured resource use. An inconclusive result means retain the baseline and collect targeted evidence, not declare a winner. Keep policy-level conclusions separate from claims about individual roles: changing many roles together does not identify which role caused an improvement.

Deliver a reproducible report containing manifest, versions, per-case evidence, excluded/incomplete records with reasons, quality scores, usage coverage and a specific promote/retain/extend recommendation.

## P4 — Roll out the selected policy gradually

1. Publish the recommendation for operator review; changing defaults is a separate explicit promotion action.
2. Apply the chosen version to new opt-in tasks first. Existing tasks retain their snapshots.
3. Observe the first ten real tasks as an initial checkpoint, with recorded operator burden, exact-candidate acceptance and any later defects. This checkpoint is not proof of long-term reliability.
4. Retain the baseline as a named selectable policy. Show the selected policy version and role exceptions in Frontier.
5. Roll back the default for future tasks if unexplained material quality regressions or unacceptable resource use appear. Do not rewrite running tasks or erase trial evidence.

Acceptance: promotion and rollback are explicit and auditable, task history stays reproducible, unknown usage remains truthful, and the checkpoint report supports continuing or reversing the rollout.

## P5 — Add explainable automatic model routing

Only start after P1–P4 establish trustworthy execution and usable outcome labels.

### Routing contract

- Keep workflow depth and model selection separate. Existing Fast/Standard/High-risk workflow behaviour remains governed by its own contract.
- Represent complexity, consequence and evidence confidence separately. Priority must not serve as a proxy for risk.
- Treat initial keyword matching as a conservative provisional signal. Use validated structured triage evidence to refine the model policy; unknown or contradictory evidence cannot establish eligibility for a cheaper path.
- Require positive evidence for narrow/low-consequence routing. Fix the negated-risk example without relying on a fragile global string-negation rule.
- Use a small, versioned server-side rule table mapping role and evidence to evaluated policies. No free-form model-generated model IDs, runtime code or arbitrary provider selection.
- Route only unpinned future roles, respect provider constraints, and record why each decision changed. Changes to consequential work must also trigger the existing workflow/gate escalation rules where applicable; stronger models never substitute for required gates.
- At candidate boundaries, use validated changed paths, interfaces and findings to reassess scope. Distinguish reasoning inadequacy from environment failures before escalating.
- Snapshot the router version, inputs, decision and eligible policies. Any dynamic escalation must be attributable and bounded by existing retry/repair limits.

### Delivery and acceptance

First run in **shadow mode**: recommend selections without changing execution. Measure disagreement with operator choices, unnecessary escalations, missed consequential cases and predicted savings with uncertainty. An expert agrees or rejects the recommendation using task evidence.

Then allow opt-in automatic routing only for evaluated case classes. Retain manual pins and a one-step return to a fixed policy. Add tests for small consequential changes, broad mechanical changes, incomplete evidence, conflicting risk signals, provider unavailability and lifecycle races.

Acceptance: every automatic choice has a recorded reason, no pin/provider constraint is silently overridden, required gates remain intact, and matched evaluation shows acceptable quality before each new routing class is enabled.

## Verification and delivery discipline

For each implementation phase, recheck repository/worktree state, inspect applicable instructions, keep the diff scoped, and run the narrowest relevant checks first. Existing starting points include:

```sh
node --test tests/runtime-repair-policy.test.mjs tests/orchestrator-runtime-policy.test.mjs tests/runtime-persistence-policy.test.mjs tests/api-task-creation-profile.test.mjs tests/workflow-profiles.test.mjs
node --test tests/evaluation.test.mjs
npm run test:frontier-api
npm run test:frontier
npm run lint
npm run format:check
npm run typecheck
npm test
npm run build:frontier
```

Select the relevant subset per slice, then complete broader checks appropriate to the final change. Verify actual browser behaviour for policy controls using an isolated local runtime; do not mutate real tasks for UI QA. Review the final diff and document checks that could not run. These commands are a future verification plan, not claims of tests passed.

Preserve the Sites handoff files. If a phase affects that build, also run `npm run build` and `npm run test:sites`. No publication is part of this programme.

## First implementation handoff

Start with P1 only. Its deliverable is a trustworthy policy contract and regression coverage, with no Astra rollout or experiment execution. Review that result before P2. P3's campaign budget, suite and independent scoring criteria must be concrete before runs start. The learned-router idea remains separate future work unless deterministic routing proves insufficient.

## External reference

The preceding advisory checked [OpenAI's agent model-selection guidance](https://developers.openai.com/tracks/building-agents#how-to-choose) and [Astra's model documentation](https://developers.openai.com/api/docs/models/gpt-6-astra). These support evaluating Astra for complex work; they do not establish the winning policy for this repository. Refresh catalogue eligibility and pricing at implementation/evaluation time.
