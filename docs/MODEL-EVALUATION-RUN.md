# Model evaluation execution brief

Updated: 22 September 2026. **Batch A complete: no challenger promoted; Batch B not launched.** Read [MODEL-EVALUATION-RESULTS.md](MODEL-EVALUATION-RESULTS.md) for the decision and [MODEL-EVALUATION-CHECKPOINT.md](MODEL-EVALUATION-CHECKPOINT.md) for retained receipts and continuation. The execution contract below remains the original scope.

## User intent and authority

Shaun has asked the assistant to select realistic issues and carry out the model-policy evaluation after compaction. The supported projects are Agent Harness itself, PlanCheck and MyStrataAssist. Own case discovery, acceptance checks, implementation of the evaluation foundation, execution, diagnosis and a concrete recommendation. Do not return to an abstract planning loop or ask Shaun to invent the task suite.

The detailed design is [MODEL-BASELINE-AND-EVALUATION.md](MODEL-BASELINE-AND-EVALUATION.md). Start with the fixed-policy comparison there; retry escalation is a subsequent bounded challenger. This instruction authorizes isolated evaluation using existing authenticated runtimes and local development/test environments. It does not authorize purchases, separately billed API fallback, production database changes, production policy activation, merges or deployments.

This brief is durable context, not a scheduler. Resume in this thread when the user continues after compaction.

## Verified starting state — refresh before changing anything

| Repository | Local path | Observed HEAD | Working tree |
| --- | --- | --- | --- |
| Agent Harness | `/Users/shaun/projects/agent-harness-ui` | `b585649795887356c25559ffd4a9c7f37316ba31` | Dirty design work plus these evaluation documents |
| PlanCheck | `/Users/shaun/projects/eversor-plancheck` | `6f5916b7b0f1c8ea9e010c4a6350c5b9be874556` | Seven changed entries; preserve them |
| MyStrataAssist | `/Users/shaun/projects/eversor-mystrataassist` | `2d1985321625e02c7e56eef0bcab7177093a81c9` | Clean at inspection |

PR #101: `https://github.com/shaunnez/agent-harness-ui/pull/101`, inspected head `272c99e3c615de26b276cddf41dd0c7e529fade1`. Its historical experiment documents are in `/Users/shaun/projects/agent-harness-ui/.claude/worktrees/frontier-3d-minimap-zoom-8efd8c/docs/experiments/`. Refresh the remote head/status and reconcile useful changes; do not assume its branch is merged or overwrite another agent's worktree.

Read applicable AGENTS.md files before work in each project. Recheck remotes, branches, dirty state and active services. Use isolated worktrees/checkouts and an independent evaluation task store, output root, ports and synthetic test databases. Preserve the user's services and retained evidence. Do not create a new background task or spawn subagents solely because this brief exists.

## Execution order

1. **Make the scorer trustworthy.** In an isolated harness worktree, reproduce and fix the three documented gaps: early failures excluded from delivery rate, policy-divergent arms eligible to win, and missing frozen verification commands accepted. Include independent acceptance, candidate-bound scores, invalid/pending trial accounting and missing-cost handling. Add behavioral regression tests and run the applicable repository checks. Qualify this foundation directly before trusting dogfood results from it.
2. **Select real cases.** Inspect issue history, resolved changes and current bounded work across the three projects. Prefer replaying suitable solved issues at their pre-fix commits, because they supply reviewed behavior and reference implementations. Do not manufacture product requirements just to populate a benchmark. New useful issues may be drafted where the code demonstrates a concrete defect or the user has supplied the requirement. Keep benchmark repeats in the isolated harness; do not flood working issue trackers with duplicate cases.
3. **Build the case bank.** Start with 12 delivery cases: four small, four medium, four hard, covering all three projects. Aim for four per project when suitable cases exist, but do not force unsuitable classifications for symmetry. Partition six development and six held-out cases, balanced by difficulty. Add four separate readiness/routing controls. Freeze briefs, base revisions, answers, reference fixes and external grading checks; keep solutions and later history inaccessible to evaluated agents. Reserve held-out cases from policy tuning.
4. **Qualify one vertical case.** Choose a bounded UI/backend/database task with real planning decisions. Start with the harness if it has a suitable case and easier isolated provisioning; otherwise use the better PlanCheck or MyStrataAssist case. Prove unchanged code fails task-specific checks, the reference passes, a meaningful defective candidate fails, and all baseline regressions are stable. Browser assertions must exercise the requested outcome. No paid inference is needed to diagnose a broken apparatus.
5. **Freeze policies and limits.** Export the incumbent effective policy. Define balanced and Astra-planning variants exactly as in the design. Verify provider availability and the actual dispatch model/effort, including repair. Use the existing Codex/Claude authenticated runtimes, with no silent substitution. Set equal conservative per-case/per-arm time, attempt and resource ceilings before dispatch. Ensure the runner prevents new dispatch after the allowance is exhausted; document any in-flight overshoot limit. If a material allowance cannot be established, ask only for that missing limit with the prepared batch and resource estimate.
6. **Run Batch A.** Three policies × three trials on the vertical development case. Rotate order, bound concurrency, retain all failed/invalid receipts and grade the exact final candidates independently. Count repairs inside a trial. If failures come from the apparatus, fix and version it before continuing; do not erase those attempts or pool incompatible results. Keep the report and checkpoint current as the batch progresses.
7. **Run Batch B when justified.** Two finalists × six untouched cases × two trials. Freeze complete difficulty mappings and promotion criteria first. Use the limits and reporting requirements in the design. If the first batch exposes a blocker, resolve it or report the concrete blocker instead of wasting 24 more workflows.
8. **Deliver a decision.** Provide per-case and per-policy outcomes, first-pass and eventual acceptance, interventions, missed defects/false alarms, elapsed time and total resources per acceptance. Distinguish recorded usage, API-rate estimates and actual charges. State the supported task/repository classes and uncertainty. Recommend exact default policies, a narrower pilot or retention of the incumbent. Do not silently activate production defaults.

Use the harness's normal stages for trial delivery once its evaluation foundation is trustworthy. Do not replace an unsuccessful arm with an unrecorded manual implementation. Preparation of reference solutions is evaluator work, never a trial success. Benchmark candidates stop at a graded PR-ready receipt; publication capability is a separate isolated qualification, not dozens of real benchmark PRs.

## Retry escalation decision

Do not upgrade every failed call automatically. Classify failure first:

- Transient transport/provider interruption: bounded retry under the same policy where safe, preserving partial state and avoiding duplicate effects.
- Environment, missing permission, missing product decision or broken check: fix or stop at that boundary; additional reasoning does not supply missing authority or infrastructure.
- Candidate implementation defect: provide concrete failure evidence; a later escalation policy may increase effort and then use a designated stronger model if the same defect persists.

The initial comparison keeps model/effort assignments fixed. Afterwards, qualify a bounded escalation variant of the selected package. Freeze its trigger, ladder, provider constraints, total attempts and budget. All escalated attempts count in cost/time and eventual acceptance; initial failure remains a first-pass failure. Escalation is measurable when it is part of the declared policy.

Current code evidence: `server/effective-policy.mjs` has a narrower, same-provider, unpinned Repair escalation for material candidate defects. Explicit role pins suppress it. Check implementation retries and repair reservations separately before extending this behavior. Do not assume a general ladder already exists.

## Continuation and receipts

Create a checkpoint beside this brief before the first trial, with the isolated implementation path/branch, case/experiment versions, task store, commands, owned processes, ceilings, trial IDs and output locations. Update it after each completed preparation slice and trial. Read that checkpoint after every compaction; inspect durable state before rerunning anything. Do not interpret a disconnect or lost console output as proof a provider call failed.

The final delivery is working evaluation tooling, a reusable reviewed case bank, retained repeated-run evidence and a defensible policy recommendation. Production routing changes, unrestricted escalation, broader model-provider integration and rollout remain separately identifiable follow-up work.
