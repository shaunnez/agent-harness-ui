# Agent Harness implementation handoff

Updated: 2026-08-02

## Delivered cut

The repository now contains both the approved ten-stage interaction prototype and a real local vertical slice that can carry an implementation-mode task through every workflow gate:

1. Triage and Repository Scouts run read-only against a selected repository.
2. Grill Me produces real, mutually exclusive questions and pauses for persisted answers. The user can answer every question or explicitly finish by accepting the remaining recommendations before specification synthesis begins.
3. Task Specification runs only after Grill is explicitly completed. Specification approval either completes an investigate-only task or starts planning for an implementation task.
4. Implementation Plan emits a validated work-package manifest with dependencies, topological batches, path ownership, and focused verification commands, then waits for explicit approval.
5. Implement creates one isolated worktree and harness-owned branch per work package. Packages in the same dependency batch run concurrently; dependent slices start with their complete dependency commit closure applied.
6. The harness assembles qualified package commits in deterministic topological order into a separate versioned integration candidate.
7. Development Review and Final Review run read-only against the exact candidate worktree and revision. Focused Test uses guarded worktree access for temporary test files, with exact-SHA and clean-status checks before and after the run.
8. A failed review or test retains its evidence and enables a candidate repair agent. Human Approval revalidates the clean source checkout, unchanged base SHA, and candidate worktree SHA before a fast-forward-only merge.
9. Candidate diff inspection verifies the recorded worktree and head revision before returning a capped unified diff, and the runtime viewer invalidates stale in-flight requests when candidate identity changes.
10. Focused Test emits a structured, candidate-bound result contract alongside its Markdown artifact. The real runtime renders drillable success/failure rows with return controls and keeps global repair actions outside individual results.
11. A read-only worktree inventory reports retained slice and candidate paths, branches, recorded/live revisions, cleanliness, lifecycle, and cleanup readiness without deleting or mutating anything.

The runtime models slices separately from the integration candidate. Downstream review, test, repair, and approval gates bind to the assembled candidate because that exact revision is the unit that can safely merge.

## Runtime and authentication contract

- Binary discovery uses `CODEX_BIN` when set, otherwise `where.exe codex` on Windows or `which codex` elsewhere.
- Readiness uses `codex login status` and reports availability, authentication method, configured model, and binary path.
- The canonical orchestrated workflow stage policy is:
  - Luna XHigh (`gpt-5.6-luna`, `xhigh`): triage, selected scouts, Grill Me, specification, implementation, and test.
  - Sol High (`gpt-5.6-sol`, `high`): implementation planning, repair, Development Review, and Final Review.
- The operator uses the ChatGPT-authenticated local Codex CLI. API keys are neither required nor forwarded to agent children; each child removes `OPENAI_API_KEY` and `CODEX_API_KEY` from its environment.
- Each Codex run records real input, cached-input, and output token counts, with cache rate shown where available. ChatGPT-plan sessions do not expose an attributable per-task dollar charge; calculated values are labelled **Approx. cost** and **API-rate estimate**.
- Prompts are streamed over stdin so accumulated artifacts do not hit the Windows command-line length limit.
- Investigation, planning, review, and final review use the `read-only` Codex sandbox. Implement and repair use `workspace-write` inside the isolated worktree. Focused Test uses `workspace-write` with its temp directory redirected below the candidate's ignored `.data/runtime-temp`; the orchestrator verifies the candidate SHA and a clean Git status both before and after the agent exits.
- Read-only runs have a four-minute timeout. Write runs have a ten-minute timeout. All runs retain bounded stdout/stderr and enforce a 2.5 MB evidence-output budget.

## Git safety contract

Implementation will not start unless:

- the selected directory is inside a Git repository;
- the source checkout has no tracked or untracked changes;
- the harness candidate branch does not already exist; and
- the resolved worktree destination remains below `.data/worktrees/<task>/<candidate>`.

The Codex implementation prompt prohibits commits, pushes, merges, dependency installation, credential access, and external contact. The harness inspects the resulting status, rejects likely secret files such as `.env`, private keys, and certificate bundles, and then creates the commit itself. A candidate artifact records base/head SHA, branch, file count, diff stat, and a capped patch.

Merge is deliberately narrow: `Approve & fast-forward merge` succeeds only if the original checkout is clean, still at the candidate base SHA, the candidate worktree still matches the reviewed head SHA, and `git merge --ff-only <candidate SHA>` succeeds. Worktrees and branches are retained for inspection; there is no automated cleanup yet.

Repository hooks and configured Git identity are respected. A hook or missing identity can stop candidate creation and leave the worktree intact for diagnosis.

## API surface

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | Local companion liveness |
| `GET` | `/api/runtime/status` | Codex/ChatGPT readiness and suggested repository |
| `GET` | `/api/runtime/worktrees` | Read-only retained slice/candidate worktree inventory with live Git state |
| `GET` | `/api/tasks` | Persisted task list |
| `POST` | `/api/tasks` | Validate and create a task |
| `GET` | `/api/tasks/:id` | Full task, decisions, approvals, candidates, artifacts, usage, and activity |
| `GET` | `/api/tasks/:id/candidates/:candidateId/diff` | Verified, capped unified diff for the recorded candidate revision |
| `POST` | `/api/tasks/:id/run` | Start or retry investigation |
| `POST` | `/api/tasks/:id/cancel` | Abort the active Codex subprocess |
| `POST` | `/api/tasks/:id/decisions` | Record an authoritative human question/answer pair |
| `POST` | `/api/tasks/:id/grill/answers` | Answer one generated Grill question |
| `POST` | `/api/tasks/:id/grill/finish` | Complete Grill, optionally accept remaining recommendations, and start specification synthesis |
| `POST` | `/api/tasks/:id/approve-spec` | Approve the specification; complete investigation or start planning |
| `POST` | `/api/tasks/:id/plan` | Retry a failed planning run |
| `POST` | `/api/tasks/:id/approve-plan` | Authorize isolated implementation |
| `POST` | `/api/tasks/:id/implement` | Create a worktree and candidate |
| `POST` | `/api/tasks/:id/review` | Run candidate-bound development review |
| `POST` | `/api/tasks/:id/test` | Run candidate-bound focused test agent |
| `POST` | `/api/tasks/:id/repair` | Create a repaired candidate revision |
| `POST` | `/api/tasks/:id/final-review` | Run the holdout final review |
| `POST` | `/api/tasks/:id/approve-merge` | Revalidate and fast-forward merge the exact candidate |
| `POST` | `/api/tasks/:id/grant-retry` | Human-grant one bounded, usable stage or repair attempt after exhaustion |

Both endpoints include the same stable integer `runtimeSchemaVersion`, which local companion clients may use for compatibility checks.

The API validates action eligibility from persisted task status. A task has one in-memory active run, and retry allowance is counted per stage. The UI polls an open running task every 1.25 seconds and backs off to five seconds when idle.

## Persistence contract

`.data/tasks.json` remains a deliberately straightforward local document. In addition to the original task brief, stage state, usage, artifacts, and capped activity, a task now stores:

- `attemptsByStage` rather than presenting a global run counter as a stage retry count;
- `decisions` and `approvals` with timestamps;
- a `grillSession` with generated options, recommendation provenance, answer source, completion reason, and timestamps;
- `workPackages` with dependencies, topological batch, ownership, verification, attempt state, worktree/branch, files, and exact package commit;
- `candidates` with base/head SHA, branch, repository/worktree paths, lifecycle status, revision number, and revision lineage;
- ordered candidate membership linking every assembled package ID and commit;
- artifact-level candidate ID/revision provenance; and
- structured focused-test evidence retained beside the Markdown artifact; and
- `activeRunKind` for interruption recovery.

Writes use a temporary file plus rename and are serialized in-process. Atomic replacement has bounded backoff for transient Windows rename errors only. Startup adds defaults to older task documents and converts the old `awaiting-approval` state. A task found in `running` state is marked failed with an explicit interruption event. This is intentionally not an immutable temporal ledger.

## Frontend behavior

- Real tasks use the approved shell and keep Tasks highlighted while drilled in.
- The global next action is in the stage command bar; duplicate header actions were removed.
- Completed stages remain green while a selected historical stage remains blue.
- The universal inspector preserves task brief, viewed/active stage context, model/access/sandbox metadata, decision frontier, current candidate identity, and living artifacts.
- Human decisions can be recorded inline and are injected into every downstream prompt.
- Grill Me distinguishes an open decision session from recorded history, reveals a text field for a custom single-choice answer, and makes finishing with recommendations explicit.
- Implement shows packages by dependency batch with status, declared ownership, attempts, and package commit; candidate membership is visible in the inspector.
- Candidate diff inspection opens a verified, revision-bound inline diff and prevents stale asynchronous responses from crossing candidate changes.
- Test artifacts include structured candidate-bound rows with command, duration, assertions, failure details, and drill-back controls while preserving the Markdown narrative.
- The real runtime exposes a drillable, read-only inventory of retained slice and candidate worktrees with live Git state and cleanup readiness.
- Candidate artifacts, failed gate evidence, and repaired revisions remain drillable.
- Approval history is visible in the universal inspector with stage, note fallback, and timestamp; switching tasks resets the viewed-stage context to the new task.
- Access-boundary copy and the inspector's agent/sandbox metadata are derived from the active stage, while viewed-stage artifacts remain independently selectable.
- The footer reports real input, cached-input, and output tokens plus cache rate, and labels calculated values **Approx. cost** and **API-rate estimate**; ChatGPT-plan usage does not expose an attributable per-task dollar charge.
- Queued and gated tasks appear as needing input rather than pretending they are actively running.

## Known limitations and next work

1. Work-package concurrency is one agent per package in the active dependency batch with no configurable global concurrency limit. Git worktree preparation is serialized to avoid repository lock contention; agent executions are concurrent.
2. Slice qualification is still agent-reported focused verification. Candidate-level Focused Test is normalized into structured records, but per-slice qualification is not yet captured in the same contract.
3. Assembly conflicts stop safely with all slice commits retained, but there is no dedicated conflict-resolution UI or integration-repair agent yet.
4. Focused Test is agent-assisted and its result list is normalized, but the harness still relies on the agent to choose appropriate repository-defined commands and summarize individual framework test cases.
5. Gate verdict parsing is conservative but simple: a top-line `PASS` advances; any other response requires repair. Structured output schemas and a code-specific rubric model should replace this.
6. Repairs update the current candidate branch and retain revision history/artifacts, but the data model does not yet represent a separate immutable candidate object for every revision.
7. API mutations do not yet use idempotency keys or optimistic revision tokens. Process-local locks prevent duplicate active agents only within one companion process.
8. Worktree cleanup readiness is visible but deliberately read-only. No cleanup mutation, rebase, conflict-resolution, repository picker, streamed activity, or PR publishing exists in the product UI.
9. The JSON store is appropriate for one local user, not concurrent or remote workers.
10. The hosted Sites artifact is UI-only: a Cloudflare worker cannot access the user's local Codex login, Git checkouts, or filesystem.
11. The real runtime is limited to the canonical orchestrated stage policy above; prototype-only concepts are not wired into this workflow.

## Fast verification record

- `npm run lint`
- `npm run typecheck`
- `npm test` (48 tests at this handoff)
- `npm run build`
- `npm run test:sites`
- Real ChatGPT-authenticated Codex CLI subprocess smoke through stdin returned the requested Markdown and usage without API keys.
- Real temporary-Git test: create two isolated slice commits, assemble them into one candidate, validate its SHA, and fast-forward merge.
- The latest campaign completed three legacy and three parallel-scheduler dogfood tasks; all six reached human-approved fast-forward merge. See `docs/dogfood-report.md` for candidate revisions, failure-budget accounting, and remediations.
- Browser smoke: completed-task merge summary, approval history, active/viewed-stage separation, historical Test evidence, task switching, and task-list aggregates rendered without console errors.
- Browser smoke after the scheduler cut: existing completed tasks render without console errors; focused server-render coverage exercises open/completed Grill and mixed package batches.
