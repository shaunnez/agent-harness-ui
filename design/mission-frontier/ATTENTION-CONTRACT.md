# Mission Frontier — waiting and blocked work

Design refinement v1.1 · 6 September 2026

The user accepted the core world/overlay balance, entity mapping and agent controls. Building placement, persistent names, upgrades and unlocks are deferred to v2. This refinement makes stopped work understandable in Project headquarters and Watch an agent without changing those foundations.

## Information that must be visible

A stopped task must answer these questions without opening an activity log:

1. Which task and stage is affected?
2. What is it waiting for, or what failed?
3. Who or what needs to act next?
4. What is the next eligible action?
5. Is the selected worker still executing, finished, or awaiting a dependency?

Use the same task identity, stage and reason on its world label, headquarters HUD and agent inspector. A long reason may be shortened for the world label; the full persisted detail remains readable in the inspector. Never replace the reason with a generic error code alone.

## Visual and behavioural states

| State | Appearance | Example | Action |
| --- | --- | --- | --- |
| Needs your answer | Amber question beacon | Grill · Question 2 of 4 | Answer question |
| Needs your approval | Amber approval/document beacon | Specification awaiting approval | Review specification |
| Waiting on dependency | Neutral clock/link marker | Implement · S3 waits for S2 | Open S2; no operator action required |
| Execution failed | Coral warning beacon | Test command could not finish | Inspect failure; retry only if eligible |
| Repair required | Coral tool/warning beacon | Dev review · 2 findings need code changes | View findings / Return to Implement when authorized |
| Blocked by repository state | Coral warning beacon | Implementation target advanced | Review blocker and exact eligible recovery |
| Waiting on external event | Quiet blue/grey clock | Awaiting matching PR merge | Open PR; Check GitHub when eligible |
| State unavailable | Grey connection marker | Connection lost; last-known state | Retry connection; no workflow mutation |

Blue remains selection, independently of state colour. The selected blocked worker retains its blue ring and gains a separate coral beacon. Colour is always paired with an icon and text. Healthy work stays visually quieter than an exception.

Do not make a shared room or an entire project appear failed because one task is blocked. Do not call a normal approval an error. Do not call a dependency wait a request for human intervention.

## Headquarters composition

The world remains dominant. Add three coordinated surfaces:

- **Task-attached label:** task ID, stage, state and one short reason. Show a question or warning beacon at that task's worker/workbench.
- **Needs you:** a compact list of tasks with a current operator decision or recovery. Keep a stable ordering, prioritizing material blockers then pending decisions; preserve age/order within each class. Show the number of affected tasks, not the number of packages or findings.
- **Selected task HUD:** stage/state, full concise reason, next actor, waiting-since time if recorded, selected run state/model, and one specific primary action.

The revised sample has three open tasks: PC-142 Implement has S2 running and S3 waiting for S2; PC-153 Grill needs an answer; PC-148 Dev review requires repair. The correct summary is 3 open tasks, 1 executing, 2 need you. The dependency does not create a third human-attention item.

If one task has both a running package and a failed package, show both facts: for example, “1 package running · S3 failed.” Keep the failed package selectable. Do not stop or hide its healthy sibling solely for visual consistency.

A task with an unresolved blocker but no available operator mutation still stays visible under attention, with “Inspect blocker” and its reason. That navigation is not a promise that a retry exists.

## Watch an agent

Keep the existing world close-up and right inspector. Place attention above Activity, Output and Context so logs cannot push it out of view.

Order:

1. Agent role and recorded model/effort.
2. Task attention: stage, reason, next actor, state age and eligible action.
3. Selected run status and the relevant step.
4. Observed activity, output and supplied context.
5. Recorded usage and secondary navigation.

Task state and run state are different. A review can finish successfully as an execution while finding code that needs repair. A question-generation run can finish while the task waits on an operator. Use “Review run finished” or “Question-generation run finished,” then separately state why the task cannot advance.

A parked historical worker may remain inspectable. It does not count as an active agent and has no continuously increasing runtime. If the task advances while watching an earlier run, show “Viewing previous run” and link to the active crew; do not change its historic policy or activity to imitate the new worker.

## Stage coverage

| Stage / situation | Information shown in headquarters and agent attention | Primary destination or eligible command |
| --- | --- | --- |
| Triage or scouts failed | Exact failed role, retained reason, failed/finished run state | Inspect error; Retry investigation when allowed |
| Grill awaits answers | Question position, question summary, Next: you | Answer question with repository evidence |
| Design awaits selection | Available variants, provider state, Next: you | Review designs |
| Design provider failed | Failed provider and retained successful variants | Retry failed design with recorded policy |
| Specification awaits approval | Retained specification revision, Next: you | Review specification, then explicit approval |
| Plan awaits approval | Retained plan revision and repository authority | Review plan, then explicit approval |
| Plan stale/unbound | Persisted target/authority reason | Revalidate plan when allowed |
| Implement dependency wait | Package ID and unfinished dependency ID | Open blocking package; no manual “complete” control |
| Implement failed/interrupted | Package, retained worktree/evidence, actual failure | Continue retained package or other eligible recovery |
| Dev review requests code changes | Finding count/severity, exact candidate, Next: you if repair awaits dispatch | View findings / Return to Implement |
| Review execution failed | Tool/provider failure and retry state, without a fabricated code verdict | Retry review when allowed |
| Test code defect | Failed command/assertion and exact candidate | Inspect test / Return to Implement when repair authorized |
| Test execution retry | Failed verification without an authorized candidate defect | Retry Test on same candidate when allowed |
| Final review stopped | Current candidate, missing/stale evidence or exact review outcome | Open review; eligible retry/repair |
| Human approval | Candidate/revision/head and fresh gates, Next: you | Review approval and Approve & raise PR |
| PR open | Exact PR, approved head, last reconciliation; Next: GitHub merge | Open PR / Check GitHub |
| PR closed, publication failed or target drifted | Persisted blocker reason and retained PR/candidate identity | Exact reconciliation/refresh/rebuild action when allowed |
| Retry allowance exhausted | Stage, recorded allowance, retained evidence and denial reason | Grant one attempt only when the server permits it; otherwise inspect |

These labels are presentation, not a replacement backend state machine. A chosen action must still carry the exact task, candidate and revision required by the current contract.

## Identity, timestamps and action eligibility

Current verified sources include:

- `src/domain/runtime.ts`: task.status, currentStage, blocker.code/detail/detectedAt, error, activeRunKind/activeRunIds, workPackages, candidates, grillSession and actionEligibility.
- `server/retry-admission-policy.mjs`: per-action allowed/reason and optional mode.
- `server/action-policy.mjs`: execution vs preflight-only admission.
- `src/components/runtime/runtimeCommandPolicy.ts`: current client action labels and stage-specific recovery branches.

A game action must use current server eligibility. In particular, `allowed: true` with `mode: preflight-only` is not permission to launch execution. Label it as a readiness check. Preserve a denial reason and offer evidence/navigation when execution is unavailable.

Use blocker.detectedAt, a retained decision/request timestamp or the exact transition event for “Waiting since.” Do not substitute task.updatedAt, which may change for unrelated activity. If a timestamp is absent, omit the duration or say “Start time not recorded.” A missing reason says “Reason not recorded” with an evidence link; it does not become a guessed diagnosis.

“Next: you” is derived only from a real pending operator decision/recovery. Dependency and external-event ownership are named separately. Current inspection did not establish a universal persisted attention record with normalized reason, actor and start time for every status; define any missing projection explicitly during the later backend integration work.

For repair, distinguish the gate that requested repair from the active execution kind. If a repair run writes through Implement while the task retains a failed Dev review/Test position, display both: “Repair running via Implement · requested by Test.” Mark affected candidate gates stale until rerun. Never move an agent merely because an animation reached a station.

## Interaction and verification scenarios

- Select a Grill beacon and reach the exact unanswered question with its evidence.
- Select an approval beacon and reach the retained specification, plan or candidate requiring approval.
- Select a blocked task and see its reason and recovery even when logs are long.
- Keep a healthy sibling running beside a blocked workbench.
- Open a waiting package and navigate to its dependency without presenting a human decision.
- Inspect a completed review worker while the task requires repair; its runtime remains frozen.
- On recovery, wait for persisted state before replacing the blocker with a running animation.
- On reconnect, reconcile current state and retain drafts; do not replay old blockers as new notifications.
- With reduced motion, retain all text, icons, selection and actions.

This is a design contract and a set of reviewable screen states. It does not implement workflow changes.
