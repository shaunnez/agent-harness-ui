# Overnight agent runbook

Updated: 2026-08-03

Checkpoint: `df437ecd5aa622b518352af78922d441d963f558` on `origin/codex/evidence-gate-ui-convergence`

This runbook is designed for two Codex tasks:

1. **Overnight coordinator** — reviews, implements, integrates, and runs up to nine controlled dogfood tasks.
2. **Blind evaluator** — waits for the anonymized campaign bundle, scores it without model labels, then reveals the mapping only after scores are fixed.

The coordinator may delegate to subagents because the launcher prompt explicitly authorizes it. Every implementation subagent must use a separate Git worktree and branch. Dogfood candidates must stop before final Human Approval and must never merge.

## Shared implementation preamble

Every implementation subtask must receive this complete preamble rather than relying on conversation history:

```text
Work from commit df437ecd5aa622b518352af78922d441d963f558 on origin/codex/evidence-gate-ui-convergence in C:\Users\nimbl\projects\agent-harness-ui.

Read AGENTS.md completely before acting. Use an isolated Git worktree and a codex/<descriptive-name> branch; never edit another agent's checkout. Create a goal for the stated objective and work persistently until it is achieved or genuinely blocked.

Preserve unrelated work. Keep new production files below 500 lines where practical. Do not make an existing oversized file larger when a cohesive extraction is feasible. Use real runtime data and do not introduce mock metrics, fabricated tool calls, or fake workflow states.

Preserve .openai/hosting.json, worker/index.js, scripts/prepare-sites-build.mjs, and tests/sites-worker.test.mjs. Removing the old Sites/prototype page means removing UI code that is proven unreachable; it does not authorize breaking Sites packaging.

Use apply_patch for edits. Run proportionate focused tests while working. Before handoff run npm run lint, npm run typecheck, npm test, npm run build, npm run test:sites, and git diff --check. For UI changes, start the local server yourself and run browser QA at approximately 1440px, 1024px, and 768px. Retain useful screenshots outside the committed source unless the repository already tracks such evidence.

Commit and push the task branch, but do not merge it, open a PR, or change the default branch. Report the branch, commit SHA, changed files, checks, screenshots, and unresolved risks to the coordinator.
```

## Launcher prompt 1 — overnight coordinator

Copy this entire prompt into one Codex task. Recommended model: Sol XHigh.

```text
You are the overnight coordinator for C:\Users\nimbl\projects\agent-harness-ui. Read docs/overnight-agent-runbook.md and AGENTS.md completely before acting.

Create a goal: "Complete the bounded overnight Agent Harness review, implementation, integration, and dogfood campaign without merging any dogfood candidate or the integration branch into the default branch."

You are explicitly authorized to spawn subagents for the bounded subtasks in the runbook. Use at most the available concurrency. Give every subagent the full Shared implementation preamble plus its complete subtask prompt. Every code-writing subagent must use a separate worktree and codex/<task> branch based on df437ecd5aa622b518352af78922d441d963f558. Never let two agents edit the same checkout. Keep the coordinator checkout clean.

Work in these phases:

PHASE 1 — parallel audit and feature branches

Dispatch these three independent subagents:

A. Code audit — Sol XHigh
Perform a read-only evidence-backed audit of the frontend, backend, orchestration, persistence, worktree safety, prompts, and tests. Find actual bugs, race conditions, unsafe boundaries, inconsistent contracts, duplicated logic, dead prototype code, oversized files, irrelevant or brittle tests, and missing browser/failure/migration/security coverage. Investigate TaskWorkspace.tsx, LiveRun.tsx, prototype data in domain.ts, and unused portions of StageViews.tsx with an import/deletion graph. Write docs/code-quality-audit-2026-08-03.md with P0-P3 findings, exact file/line evidence, root cause, fix, verification, and a sequenced modularization/deletion plan. Do not modify production code. Commit and push codex/code-quality-audit.

B. Dashboard and visual polish — Luna XHigh
Fix the dashboard workflow dial so the ring is driven by actual completed-stage percentage and is complete at 10/10. Improve horizontal spacing in shared task-table columns without unnecessary 1440px overflow. Refine Grill Me, Implement, repair lineage, and approval/context typography and spacing. Keep normal text 14-16px and small text at least 12px. Preserve the Evidence Gate direction and accessible progress semantics. Keep the diff focused on CommandCentre, TaskTable, extracted visual helpers, and relevant styles. Browser-test at 1440px, 1024px, and 768px. Commit and push codex/dashboard-spacing-polish.

C. Agent configuration and Skill contracts — Luna Max
Add model and reasoning editing to every non-deterministic Agent detail screen. Save through the existing runtime settings contract, provide success/failure feedback, Reset to global default, and explain that changes apply only to new tasks because policies are snapshotted. Preserve Settings and use one shared policy editor so the two surfaces cannot drift. Human Approval remains deterministic. Individual scouts edit the shared scout policy unless the backend intentionally gains per-scout policies. Improve Skill drill-ins with truthful TypeScript domain/API input and output types plus actual JavaScript prompt/parser source, source filenames, and clear distinctions between prompt, parser, persisted artifact, and UI type. Extract Agents, Skills, Settings, and shared controls from LibraryScreens.tsx where useful. Commit and push codex/agent-policy-skill-contracts.

While those agents run, the coordinator implements this branch in its own isolated worktree:

D. Evaluation foundation and success metrics — Sol High
Create codex/evaluation-foundation from the checkpoint. Extend the observational scorecard into a native experiment system with experiment group and variant IDs, frozen base SHA, task-brief hash, policy matrix, acceptance/verification definition, per-role model/reasoning snapshot, first-pass and eventual gate success, repair/retry count, wall time and per-role duration, token/cache/credit/API-estimate totals, context size, and human/blind quality score with rubric and notes. Show sample counts with percentages. Keep historical observations separate from controlled experiments and do not imply statistical significance. Prefer new cohesive modules under 500 lines. Commit and push.

Wait for all Phase 1 agents. Inspect their diffs and test evidence; do not accept claims without checking. Do not integrate a branch with unresolved P0/P1 correctness problems.

PHASE 2 — integration, activity, routes, and cleanup

Create codex/overnight-integration from df437ecd5aa622b518352af78922d441d963f558. Cherry-pick the acceptable Phase 1 commits one at a time, resolving duplication intentionally. Run focused checks after each integration.

Then dispatch up to three subagents from the current integration revision, again using independent worktrees:

E. Structured run activity — Sol High
Extend the backward-compatible event/run contract with available stable run ID/kind, stage, role, model, reasoning, start/end/duration, artifact ID, usage, credits, API estimate, decisions, tests, approvals, retries, and repair relationships. Capture tool-call name/category and concise result only when Codex JSONL genuinely exposes it. Do not fabricate telemetry. Extract a focused RunActivity component under 500 lines with working Activity, Agent runs, Test runs, Decisions, and Tool calls filters plus artifact/run drilldown. Add parser, migration, API, render, filter, and interrupted-run tests. Commit and push codex/structured-run-activity.

F. Deep-link routing — Luna XHigh
Add stable hash routes for Skill detail, Agent detail, task/stage, artifact viewer, candidate diff, changelog commit/file, and test-result detail where identity exists. Back, forward, reload, Escape, and close must restore the correct parent route. Do not encode ephemeral toast/loading state. Extract and test route parsing/serialization, invalid routes, and historical URLs. Avoid a new routing dependency unless it materially simplifies the implementation. Commit and push codex/deep-link-routing.

G. Legacy cleanup and modularization — Sol XHigh
Read the completed code audit first. Prove legacy code is unreachable with import searches, route analysis, builds, and tests before deleting it. Likely candidates are TaskWorkspace.tsx, LiveRun.tsx, unused StageViews code, prototype domain data, obsolete CSS, and tests that support only removed paths. Preserve production diff viewers and all required Sites packaging files. Refactor oversized RuntimeTaskWorkspace, StageViews, domain, and styles into cohesive modules, targeting production files below roughly 500 lines without cosmetic fragmentation. Commit and push codex/legacy-ui-modularization.

Wait for Phase 2. Integrate acceptable commits one at a time into codex/overnight-integration, resolving conflicts and shared abstractions deliberately. Apply confirmed P0/P1 audit fixes if they are not already addressed. Do not integrate speculative large rewrites whose risk exceeds their value.

Run npm run lint, npm run typecheck, npm test, npm run build, npm run test:sites, and git diff --check. Run browser QA across Command Centre, Tasks, Skills, Agents, Settings, a completed task, a repair state, Activity, and important deep links. Commit and push codex/overnight-integration. Do not merge it into the default branch and do not open a PR.

PHASE 3 — controlled dogfood campaign, maximum nine tasks

Use a clean evaluation checkout pinned to df437ecd5aa622b518352af78922d441d963f558 so all variants share the same base. Do not use the newly integrated implementation as the experimental base. If the harness cannot operate from detached HEAD, create a dedicated evaluation-base branch pointing exactly at the checkpoint.

Run these three identical issue briefs under three policy variants, nine tasks total:

1. Dashboard progress dial plus shared task-table spacing.
2. Agent-detail policy editor plus truthful Skill input/output contracts.
3. Structured run activity telemetry and drilldown.

Variants:
- H hybrid: Luna XHigh for triage, scouts, Grill, specification, implementation, and test; Sol High for plan, repair, Dev Review, and Final Review.
- X all Luna XHigh: Luna XHigh for every model-driven role.
- M Max hybrid: Luna Max for the Luna production roles; Sol High for plan, repair, Dev Review, and Final Review.

Within each issue, use the same frozen brief, attachments, base SHA, acceptance criteria, and verification commands. If per-task policy selection is unavailable, change settings only long enough to create a task that snapshots the policy, then restore the previous settings immediately. Run sequentially where needed to prevent settings races.

You may answer Grill questions and approve intermediate specification/plan gates using the evidence-backed recommended choice. Never click or call Approve & merge. Every candidate must stop at Human Approval, failure, or a genuine blocker. Do not bypass failed gates. Stop a variant if the same root blocker repeats three times.

Collect task IDs, exact policy snapshots, candidates, outcomes, duration, attempts, repairs, gate results, tokens, cache, credits, API estimates, and context size. Create a machine-readable manifest and an anonymized blind-review bundle with briefs, acceptance criteria, verification evidence, and candidate diffs labelled only by opaque candidate letters. Keep the variant mapping separate. Do not declare a quality winner.

Commit and push the anonymized bundle and factual report on codex/dogfood-campaign-2026-08-03. Keep the private mapping in .data/evaluations/2026-08-03/variant-map.json and ensure it is not committed. Add a READY marker to the campaign branch only after the blind bundle is complete. Do not merge any candidate or campaign branch.

Finish with a concise coordinator report containing all branches/commits, integrated changes, rejected changes and why, test/build/browser results, campaign task IDs/states, and exact paths needed by the blind evaluator. Do not mark the goal complete while any required phase remains unfinished unless genuinely blocked.
```

## Launcher prompt 2 — independent blind evaluator

This may be started after the coordinator, or started concurrently and told to wait for the READY marker. Recommended model: Sol XHigh.

```text
You are the independent blind evaluator for the Agent Harness overnight campaign in C:\Users\nimbl\projects\agent-harness-ui.

Read AGENTS.md and docs/overnight-agent-runbook.md completely. Create a goal: "Blindly score the completed overnight dogfood campaign, reveal variants only after scores are fixed, and publish an evidence-backed comparison without merging candidates."

Wait for origin/codex/dogfood-campaign-2026-08-03 to contain the campaign READY marker. Use short bounded status checks and provide occasional commentary rather than blocking silently. Do not read .data/evaluations/2026-08-03/variant-map.json, task model metadata, coordinator messages that reveal variants, or any non-anonymized campaign material before blind scoring is committed.

Create an isolated worktree and codex/dogfood-blind-review-2026-08-03 from the ready campaign branch. Read only the anonymized bundle initially.

For each candidate, score 1-5 with concrete evidence for functional correctness, acceptance-criteria coverage, regression safety, code clarity, maintainability, architecture/contracts, test quality, scope discipline, and UX/accessibility where relevant. Run supplied verification commands where safe. Record hard failures separately from subjective quality.

Write and commit the locked blind scores and rationales before revealing the model mapping. The commit message must clearly say that the blind scores are locked. Only after that commit exists may you read the private variant mapping.

After revealing the mapping, compare paired results by issue and policy: quality, first-pass gate success, repairs, completion, wall time, input/output/cache tokens, cache rate, work credits, API-rate estimate, and context size. Do not claim statistical significance from this sample. Recommend which model/reasoning variants deserve a larger trial, and identify any outcome that is too confounded to interpret.

Update docs/dogfood-evaluation-2026-08-03.md with the blind scores, revealed comparison, methodology limitations, and recommendations. Commit and push codex/dogfood-blind-review-2026-08-03. Do not merge the branch, Approve & merge any harness task, or modify the integration branch.

Run git diff --check and any safe verification needed for generated reports. Finish with branch and commit SHAs, evaluated task IDs/candidate labels, key results, and anything requiring human judgment. Do not mark the goal complete until the locked-score commit and revealed comparison commit both exist.
```

## Optional launcher prompt 3 — morning verification

Use this only after the coordinator and blind evaluator have finished.

```text
Review the overnight outputs for C:\Users\nimbl\projects\agent-harness-ui without merging anything.

Read AGENTS.md, docs/overnight-agent-runbook.md, docs/code-quality-audit-2026-08-03.md, the coordinator report, and docs/dogfood-evaluation-2026-08-03.md. Inspect origin/codex/overnight-integration and origin/codex/dogfood-blind-review-2026-08-03.

Verify the integration branch from a clean worktree with lint, typecheck, tests, build, test:sites, diff check, and targeted browser QA. Compare the implemented fixes to the audit and the user-approved backlog. Report what is safe to review, what should be rejected or revised, which dogfood candidates remain stopped at Human Approval, and the recommended next merge order. Do not merge, approve, close, or delete anything.
```

## Deferred item

Priority scheduling is feasible but intentionally excluded from the overnight scope. It needs an explicit queue-order, starvation, and pre-emption policy before implementation.
