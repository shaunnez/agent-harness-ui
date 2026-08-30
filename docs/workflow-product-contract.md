# Workflow product and backend contract

This document records the product model behind the prototype. It is the source of truth for the future UI and orchestration backend unless a later product decision explicitly supersedes it.

## 1. Product premise

One task can use multiple providers, models, agents, skills, worktrees, and attempts. The UI must preserve that plurality without making the human reconstruct the workflow from logs.

The workflow has two levels of execution:

1. **Slice qualification** — implementation slices run in isolated worktrees and prove that their own outputs are ready to integrate.
2. **Candidate qualification** — the orchestrator assembles the compatible slice commits into a versioned integration candidate. Dev Review, Test, Final Review, and Human Approval make authoritative task-level decisions about that exact candidate revision.

A green slice is therefore **ready for integration**, not “the task passed.” The merged candidate is the unit that passes or fails the downstream gates.

## 2. Shared terminology

Use these terms consistently in the product, API, database, events, and documentation.

- **Provider**: the company or runtime that serves a model, such as OpenAI or Anthropic.
- **Model**: the exact model/version used by an agent run.
- **Agent**: a configured execution role with provider/model, reasoning, tools, skills, permissions, and budget policy.
- **Skill**: an inspectable and optionally editable instruction/tool bundle invoked by an agent.
- **Stage**: one of the ten visible workflow phases.
- **Workflow profile**: the persisted risk/efficiency policy (`fast`, `standard`, or `high-risk`) that controls required stages, scout limits, model policy, verification breadth, and repair limits.
- **Stage run**: one execution attempt of a stage. Attempts belong to individual stage/agent/gate runs, not vaguely to the entire task.
- **Slice / work package**: an independently executable part of the implementation plan.
- **Worktree**: the isolated repository checkout in which a slice or integration operation runs.
- **Integration candidate**: an immutable, versioned combination of slice commits plus integration changes, identified as `C1`, `C2`, and so on and pinned to a revision SHA.
- **Gate**: a review, test, policy, or approval decision bound to one exact candidate revision.
- **Repair packet**: structured failure evidence routed to the smallest responsible owner.
- **Artifact**: a durable, inspectable handoff created by a stage or run.
- **Run activity**: chronological operational telemetry. It is not a second representation of stage content.

Avoid using “model” when the UI means an agent, and avoid showing a singular model field for a task that used several models. Task summaries should show **Models** or a provider/model mix.

## 3. Canonical workflow

1. **Triage** — classify the request, risk, affected surface, and required policy.
2. **Repo Scouts** — run parallel, read-only repository investigations and retain their evidence.
3. **Grill Me** — resolve material ambiguities using repository/document evidence and record the decision frontier.
4. **Task Spec** — synthesize the full implementation contract, not just acceptance criteria.
5. **Implementation Plan** — create dependency-aware slices, interfaces, ownership, verification commands, and an integration strategy.
6. **Implement** — execute slices in isolated worktrees, qualify them, then assemble a versioned integration candidate.
7. **Dev Review** — a fresh-context code review of the whole candidate with the code-specific rubric and repair lineage.
8. **Test** — deterministic and/or agent-assisted candidate-level gates with drillable pass and failure evidence.
9. **Final Review** — a legible summary of every prior stage, costs, evidence, repairs, candidate identity, and outstanding risk.
10. **Human Approval** — explicitly approve the qualified candidate for a GitHub pull request using a visible target branch and exact candidate head. The task completes only after GitHub reports that exact PR merged.

Grill is a human decision gate by default. When it produces questions, the task pauses so the operator can answer them individually or explicitly accept all remaining recommendations. Automatic acceptance is available only through an opt-in Settings policy snapshotted onto new tasks; those answers and the session completion must identify automation as their source. A Grill run that produces no material questions may continue automatically under either policy.

Tasks may opt into a governed design exploration after Grill and before Task Spec. This is a subflow inside **Task Spec**, not an eleventh stage: Claude Design and Codex Design run independently, retain two provider-attributed prototype revisions, and pause for an explicit operator selection. Task Spec cannot start until one complete revision is selected. The selected revision is immutable for that specification run and is supplied—with its URL or local bundle hash, summary, and context manifest—to Specification, Plan, implementation, review, and test. The rejected variant remains inspectable for provenance but is never blended into downstream context. Provider failure retains partial output but fails the subflow closed; the operator may retry both generators. Local prototype HTML is served from a sandboxed frame under a restrictive content-security policy, and server filesystem paths are never projected to the client.

The stage navigator distinguishes:

- **Current execution stage** — where the workflow can advance.
- **Selected/viewed stage** — what the human is inspecting.
- **Completed stage** — recorded history before the current execution stage.
- **Failed/blocked stage** — the current gate that cannot advance.

Inspecting history must never accidentally mutate or advance the current workflow.

### Workflow profiles

- **Fast** is limited to one coherent, low-risk package. It normally uses zero scouts and at most one for an unresolved repository fact. A bounded change contract may replace separate Specification and Plan model calls only when acceptance criteria contain no unresolved decision and the contract names owned paths and validated focused verification command IDs. Skipped stages are persisted as `not-required` with a reason; they are never added to completed stages and never receive fabricated artifacts or runs.
- **Standard** is the compatibility-safe default for existing tasks and normal single-candidate implementation.
- **High-risk** retains the full workflow for multi-package, security, schema, migration, concurrency, data-integrity, or broad architectural work.

Profile selection is deterministic and inspectable. Operators may override it before implementation. Fast automatically escalates when discovered scope, path ownership, dependency boundaries, focused verification, or review findings exceed its limits. Escalation changes future policy but retains the prior selection and reason in history. If a committed fast slice first reveals a scope boundary or fails its focused qualification, the task returns to standard investigation and planning before more implementation; it retains the slice and telemetry for audit and does not fabricate an integration candidate.

## 4. Slice and candidate lifecycle

### Slice state machine

`planned → queued → running → ready_for_integration`

Exceptional states:

- `failed` — slice-local verification failed.
- `blocked` — policy, dependency, or human input prevents progress.
- `superseded` — a replacement slice revision exists.
- `integrated` — its exact commit is a member of a candidate.

Each slice records:

- dependency IDs and topological batch;
- owning agent and provider/model revision;
- worktree/branch;
- base revision and output commit;
- touched files and declared interfaces;
- validated focused manifest command IDs and results bound to the exact package commit;
- tokens, cache usage, approximate cost, and duration;
- artifacts and attempt history.

### Candidate state machine

`assembling → ready_for_review → reviewing → testing → ready_for_final_review → awaiting_human_approval → merging → merged`

Exceptional states:

- `conflicted` — assembly cannot complete automatically.
- `review_failed` — the candidate failed Dev Review.
- `test_failed` — the candidate failed one or more required test gates.
- `blocked` — repair allowance, policy, or human decision is required.
- `superseded` — a newer candidate revision exists.
- `merge_failed` — the approved revision could not be merged as recorded.

Candidate membership is explicit and ordered. It records every included slice commit, any integration-only commit, base revision, worktree, conflict resolutions, and merge order. A candidate ID is human-friendly; the revision SHA is the immutable identity.

## 5. Why review and test happen after integration

Slice-local checks are useful and should fail fast, but they cannot prove cross-slice behavior. Each package executes only its validated, argv-only subset of the repository manifest after the harness creates the exact package commit. Focused Test executes the complete repository manifest once for the assembled candidate revision and reuses that result unless the revision changes. Dev Review and Final Review consume the recorded results; they do not rerun the manifest. The candidate gates can therefore expose:

- incompatible interfaces;
- migration/API/UI mismatches;
- merge-order defects;
- hidden assumptions between parallel agents;
- integration-only edits;
- whole-product regressions.

This is a hybrid pipeline, not a choice between “review every slice” and “review only once.” Slices receive cheap local qualification; the candidate receives the expensive authoritative gates.

## 6. Gate binding, freshness, and invalidation

Every gate result must include:

- `candidate_id` and immutable `candidate_revision`;
- gate definition/version;
- status, start/end timestamps, and attempt number;
- runner/agent/provider/model/toolchain versions;
- command or rubric used;
- tokens, approximate cost, duration, and cache data;
- artifacts, findings, and structured failure reasons.

A gate is current only when its recorded candidate revision equals the current candidate revision and its definition/version is still accepted by policy.

Creating `C2` from a repair to `C1` makes `C1` review/test verdicts historical. They remain visible for audit and comparison but cannot count toward approval. The UI labels them **stale** or **superseded**, never silently discards them, and reruns every gate affected by the change.

The backend should compute invalidation from changed files, declared interfaces, dependency relationships, and gate coverage. Conservative policy may rerun the entire candidate gate suite. The UI must show which gates were invalidated and why.

## 7. Repair ownership and routing

A failure produces a structured repair packet containing:

- failing candidate and gate identity;
- concise symptom and expected/actual behavior;
- relevant logs, files, lines, test IDs, and artifacts;
- suspected ownership: slice, integration, plan/spec, or environment;
- required reruns and invalidated verdicts;
- remaining repair allowance.

A reviewer execution/tooling failure is a **review retry**, not a candidate repair. Failed telemetry remains retained and a fresh read-only review is required; the same reason gets one normal retry before a human must grant another attempt. Model-run shell commands are diagnostic telemetry, never authoritative verification. Only Harness-owned manifest rows can establish test success or failure. Review findings classify `candidate-defect` separately from `verification-gap`; a verification gap is routed to the Harness Test gate and cannot authorize source Repair. Candidate repair is authorized only by a confirmed candidate defect, an explicit acceptance gap, a security/data-integrity problem, or deterministic candidate verification failure. Reviewers inspect the complete candidate diff and return all blocking findings together. P2/P3 maintainability advice is non-blocking unless explicitly tied to an acceptance criterion.

Development Review is a bounded static review: at most four targeted repository commands, with test/build/lint/typecheck/package/manifest execution prohibited. Stage subprocesses use only repository-local commands and do not inspect global memory, skill, plugin, cache, configuration, or optional machine-specific paths.

Fast permits one automatic review-driven repair cycle. A further candidate defect stops for human direction. Every repair creates a new candidate revision, makes downstream evidence stale, and reruns every invalidated gate.

Route repair to the smallest responsible boundary:

- slice-owned defect → reopen that slice in a repair worktree;
- integration defect → repair the integration worktree;
- interface/spec defect → return to Implementation Plan or Task Spec;
- flaky/environment issue → Test/environment owner without changing product code.

Any source change creates a new immutable candidate revision. Do not mutate a candidate that already has recorded gate verdicts.

Attempts belong to the run being retried. The task UI may show a compact repair summary, but the backend must retain per-slice, per-agent, per-stage, and per-gate attempts.

## 8. UI contract

### Stage command bar

Every stage has a consistent action area at the top of the stage canvas. It communicates:

- current status and the exact object in scope;
- the next safe action;
- any secondary inspect/retry/repair action;
- why an action is disabled or blocked.

Primary actions should not be hidden below long evidence. Examples include `Start scouts`, `Confirm answer`, `Approve plan & start worktrees`, `Assemble candidate`, `Send C1 to tests`, `Send to repair`, `Send C2 to human approval`, and `Approve & raise PR for C2`.

Plan approval is not a forced choice. Before implementation authorization, an operator may record a concrete correction as a task decision and choose `Revise plan`. The bounded read-only planning attempt replaces the executable package graph while retaining the rejected plan artifact and run for audit. No repository write is authorized until a plan is explicitly approved.

### Investigation-to-implementation continuation

A completed investigate-only task may continue as one separately identified implementation task. The source investigation remains completed and read-only; it is never converted into a write-capable task. The implementation task records the source task ID, imports the approved investigation artifacts, decisions, and attachment references with their source IDs, and starts at read-only Implementation Plan. Plan approval remains the first authority that can advance the new task toward an isolated implementation worktree.

The continuation action is idempotent. Repeating it opens the already-linked implementation task instead of creating another task or duplicating planning authority. Both tasks retain the link in their persisted state and activity history.

### Implement

Implement is a work-package overview plus a distinct integration object.

- Slice rows drill into worktree, agent, provider/model, interfaces, checks, commits, usage, and artifacts.
- Dependency batches and arrows make execution order legible.
- The integration candidate card shows membership, revision, conflicts, integration worktree, merge queue, and candidate diff.
- `Inspect diff` opens a large inline candidate-bound code diff in the main canvas, with an obvious return path.

### Dev Review

Dev Review always names the candidate revision under review and inspects its complete diff. It uses a fresh-context reviewer, code-specific rubric, one consolidated P0–P3 response, file/line and reproduction evidence, acceptance-criterion links for blocking P2/P3 findings, suggested changes, and repair lineage. A repaired candidate shows that prior verdicts became stale and that the current review applies to the new revision. Reviewer tooling failure visibly requests review retry without asserting a candidate defect.

### Test

The default is a mixed result list showing passed and failed tests. Each result can expand or drill into commands, duration, logs, assertions, artifacts, ownership, and prior attempts. The UI must make the return to the result list obvious. Global actions such as retry or send to repair sit outside individual result details.

### Final Review

Final Review summarizes Triage, Repo Scouts, Grill Me, Task Spec, Implementation Plan, Implement, Dev Review, and Test. Each row shows completed, not-required, or stale state; key outcome; tokens; API-rate estimate; and artifacts/repairs when relevant. It explicitly identifies the candidate that cleared the gates and what will happen next. Fast generates this summary deterministically from recorded evidence when no unresolved risk remains; otherwise the configured model policy applies.

### Human Approval

Approval is not merely “approve.” It is `Approve & raise PR Cx` and shows:

- exact candidate ID and revision;
- target repository and branch;
- merge method;
- current required gate count;
- residual risks and policy acknowledgements;
- identity and timestamp of the approver;
- resulting PR number and URL, exact remote head, current GitHub state, and eventual merge commit or structured reconciliation failure.

Before recording PR publication, the companion compares the candidate's recorded base with the live GitHub target ref. If the target advanced, approval stops without opening a PR and the command bar offers **Refresh candidate from main**. Refresh fetches the remote target commit without moving the user's local target branch, runs only in the isolated candidate worktree, replays the candidate onto that commit, and records a new candidate revision with reason `target-refresh`. The prior revision and its evidence remain inspectable, while Dev Review, Test, Final Review, and Human Approval become stale and must run again. A refresh conflict aborts back to the recorded candidate head; it never leaves a partial rebase or silently resolves conflicts.

The UI describes this as refreshing the candidate rather than “merge main into branch.” A new approval pushes only the exact candidate SHA to a unique remote branch and raises or rediscovers one matching GitHub PR. The local target checkout remains untouched. The companion polls retained open PRs in the background and may also reconcile on demand. It completes the task only when the PR repository, number, base branch, head branch, and head SHA still match the approval intent and GitHub reports the PR merged. Closed-unmerged PRs and identity drift block rather than progressing.

### Recovery actions

Recovery actions are selected from typed failure state rather than a generic retry button:

- `target-diverged` offers **Refresh candidate from main**;
- an invalid approved work-package verification contract offers **Correct implementation plan** and returns to read-only Planning;
- a failed full-manifest Test with no typed blocking candidate defect may receive one explicit **Retry Test on Cx ry** against the unchanged candidate revision;
- a typed blocking candidate defect offers **Repair candidate**;
- exhausted model/tool attempts retain the bounded human retry-grant flow.

Every new work package must name at least one command ID from the repository-owned `.agent-harness/verification.json` manifest. Planning validates both presence and membership before presenting the plan for approval, and approval revalidates the same contract for migrated or previously persisted plans.

Fresh-context Development Review may use at most eight repository commands. Test and Final Review retain their two-command ceilings because their inputs are already candidate-bound and structured. Exceeding a ceiling still stops the model run and retains the failure; the higher Development Review allowance prevents ordinary candidate inspection from being misclassified as runaway review activity.

### Universal inspector

Keep one right sidebar across stages. It contains:

1. task title and description;
2. current execution stage vs selected stage;
3. active agent/skill/provider/model;
4. execution metadata and safeguards;
5. current integration candidate and gate freshness after Implement;
6. stage-specific decisions, artifacts, findings, or selected telemetry.

“Harness evidence” should not appear as unexplained jargon. Use concrete labels such as repository evidence, decision, artifact, gate result, or selected event.

### Run activity

Run activity is collapsed by default and opens into a chronological telemetry table. It answers “what just happened?” while the stage canvas answers “what does it mean and what can I do?”

Filters are **Activity**, **Agent runs**, **Test runs**, and **Decisions**. Events are not a separate user-facing category because all rows are events.

Each row records time, event, scope, model/agent, input/cached/output tokens, cache rate, work credits when available, clearly labelled API-rate estimate, duration, and artifact. Task/stage telemetry separately counts focused checks, full-manifest executions, review retries, and candidate repairs. It states that attributable ChatGPT-plan billing is unavailable. Scope must identify the candidate, slice, stage, or test run. Selecting a row sends its full evidence to the universal inspector. Avoid duplicating stage summaries or artifacts here.

## 9. Durable artifacts

Artifacts are first-class, versioned records, not transient UI copy. Important examples include:

- triage report;
- scout findings and cited code excerpts;
- Grill decision frontier and evidence;
- dual design prototype revisions, provider metadata, exact selected revision, and context manifests;
- full task specification;
- dependency graph and implementation plan;
- slice manifests, commits, and local check results;
- candidate manifest, lineage, diff, and conflict record;
- Dev Review rubric/findings;
- test result bundle/JUnit/logs;
- repair packets and invalidation decisions;
- final workflow summary;
- approval packet and merge record.

Artifact viewers should be wide, read-only by default, version-aware, linkable, and able to show provenance. Editable skills/prompts belong to their own configuration/editor flow, not an artifact viewer.

## 10. Suggested backend entities

Minimum relational/event model:

- `tasks`
- `workflow_stages`
- `stage_runs`
- `agents`
- `agent_revisions`
- `skills`
- `skill_revisions`
- `agent_runs`
- `work_packages`
- `work_package_dependencies`
- `worktrees`
- `slice_attempts`
- `integration_candidates`
- `candidate_members`
- `candidate_revisions`
- `gate_definitions`
- `gate_runs`
- `repair_packets`
- `repair_actions`
- `artifacts`
- `design_requests`
- `prototype_variants`
- `decisions`
- `usage_records`
- `approvals`
- `merge_records`
- `harness_events`

Use immutable revision tables for agents, skills, candidates, and gate definitions so historical runs remain reproducible.

## 11. API and event boundaries

Representative commands:

- create/update task title and description;
- start or pause a workflow;
- submit Grill answer/decision;
- approve specification or implementation plan;
- start/retry/cancel a slice attempt;
- assemble candidate from an ordered commit set;
- start/retry a candidate gate;
- create/route/resolve repair packet;
- grant one additional repair attempt;
- submit final review;
- approve and merge an exact candidate revision.

Representative queries:

- task summary with model/provider mix, tokens, cost, and stage status;
- workflow stage history and current command eligibility;
- dependency graph and slice attempts;
- current candidate membership, lineage, diff, and gate freshness;
- test/review results and repair ancestry;
- artifact content and provenance;
- filtered run activity stream.

Representative emitted events:

- `stage_run.started|completed|failed|blocked`
- `slice_attempt.started|qualified|failed`
- `candidate.assembling|ready|superseded|merged|merge_failed`
- `gate_run.started|passed|failed|invalidated`
- `repair_packet.created|routed|resolved`
- `artifact.created`
- `decision.recorded`
- `approval.requested|granted|rejected`

Commands that mutate workflow state require idempotency keys and optimistic concurrency against the expected task/candidate revision. Event records should be append-only.

## 12. Cost and usage

Store usage at the lowest available run granularity, then aggregate upward by slice, stage, candidate, task, provider, model, and day. Preserve:

- input/output/cache tokens when available;
- provider-reported cost when available;
- pricing-table version and calculated approximate cost otherwise;
- currency and rounding rules;
- non-model infrastructure/test costs separately.

Label calculated values **Approx. cost**. A task can display a total plus a provider/model breakdown.

## 13. Concurrency, auditability, and safety

- Only one candidate revision can be current, but historical candidates remain inspectable.
- Candidate assembly must verify expected base and member SHAs before writing.
- Gate completion uses compare-and-set so a late result cannot bless a superseded candidate.
- Approve-and-merge revalidates candidate identity, gate freshness, target head, permissions, and mergeability.
- Human actions record actor, timestamp, rationale, and acknowledged warnings.
- Secrets and raw model context must be redacted from artifacts and activity rows according to policy.
- Agent/skill configuration changes create revisions; they never rewrite the configuration attached to past runs.

## 14. Prototype-only behavior vs production behavior

The current prototype uses hard-coded data and a **Prototype states** menu to expose active, Grill, failed, blocked, and approval scenarios. That menu is intentionally not part of the production workflow.

Production replaces these controls with persisted task/candidate state, streamed run events, command eligibility from the orchestration service, repository/worktree operations, real model usage, and auditable merge APIs. The visual semantics and state distinctions in this document should remain stable across that transition.
