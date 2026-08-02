# Agent Harness implementation handoff

Updated: 2026-08-02

## Delivered cut

The repository now contains both the approved ten-stage interaction prototype and a real local vertical slice that can carry an implementation-mode task through every workflow gate:

1. Triage, Repository Scouts, Decision Brief, and Task Specification run read-only against a selected repository.
2. Human decisions are persisted as authoritative context. Specification approval either completes an investigate-only task or starts planning for an implementation task.
3. Implementation Plan runs read-only and waits for explicit approval.
4. Implement verifies that the selected Git repository is clean, creates an isolated worktree and harness-owned branch, runs Codex with write access only in that worktree, and commits a versioned integration candidate.
5. Development Review and Final Review run read-only against the exact candidate worktree and revision. Focused Test uses guarded worktree access for temporary test files, with exact-SHA and clean-status checks before and after the run.
6. A failed review or test retains its evidence and enables a repair agent. Repair creates a new commit/revision and requires development review again.
7. Human Approval revalidates the clean source checkout, unchanged base SHA, and candidate worktree SHA before performing a fast-forward-only merge.

The current backend intentionally models one implementation session as one candidate. The richer prototype still demonstrates dependency batches, multiple slice worktrees, mixed test drill-down, candidate assembly, and multi-provider work; those remain the next product expansion rather than being falsely represented as real runtime behavior.

## Runtime and authentication contract

- Binary discovery uses `CODEX_BIN` when set, otherwise `where.exe codex` on Windows or `which codex` elsewhere.
- Readiness uses `codex login status` and reports availability, authentication method, configured model, and binary path.
- Every agent child removes `OPENAI_API_KEY` and `CODEX_API_KEY`; it relies on the user's existing Codex ChatGPT session.
- The default is `gpt-5.4-mini` at low reasoning. Override with `AGENT_HARNESS_MODEL` and `AGENT_HARNESS_REASONING`.
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
| `GET` | `/api/tasks` | Persisted task list |
| `POST` | `/api/tasks` | Validate and create a task |
| `GET` | `/api/tasks/:id` | Full task, decisions, approvals, candidates, artifacts, usage, and activity |
| `POST` | `/api/tasks/:id/run` | Start or retry investigation |
| `POST` | `/api/tasks/:id/cancel` | Abort the active Codex subprocess |
| `POST` | `/api/tasks/:id/decisions` | Record an authoritative human question/answer pair |
| `POST` | `/api/tasks/:id/approve-spec` | Approve the specification; complete investigation or start planning |
| `POST` | `/api/tasks/:id/plan` | Retry a failed planning run |
| `POST` | `/api/tasks/:id/approve-plan` | Authorize isolated implementation |
| `POST` | `/api/tasks/:id/implement` | Create a worktree and candidate |
| `POST` | `/api/tasks/:id/review` | Run candidate-bound development review |
| `POST` | `/api/tasks/:id/test` | Run candidate-bound focused test agent |
| `POST` | `/api/tasks/:id/repair` | Create a repaired candidate revision |
| `POST` | `/api/tasks/:id/final-review` | Run the holdout final review |
| `POST` | `/api/tasks/:id/approve-merge` | Revalidate and fast-forward merge the exact candidate |

The API validates action eligibility from persisted task status. A task has one in-memory active run, and retry allowance is counted per stage. The UI polls an open running task every 1.25 seconds and backs off to five seconds when idle.

## Persistence contract

`.data/tasks.json` remains a deliberately straightforward local document. In addition to the original task brief, stage state, usage, artifacts, and capped activity, a task now stores:

- `attemptsByStage` rather than presenting a global run counter as a stage retry count;
- `decisions` and `approvals` with timestamps;
- `candidates` with base/head SHA, branch, repository/worktree paths, lifecycle status, revision number, and revision lineage;
- artifact-level candidate ID/revision provenance; and
- `activeRunKind` for interruption recovery.

Writes use a temporary file plus rename and are serialized in-process. Startup adds defaults to older task documents and converts the old `awaiting-approval` state. A task found in `running` state is marked failed with an explicit interruption event. This is intentionally not an immutable temporal ledger.

## Frontend behavior

- Real tasks use the approved shell and keep Tasks highlighted while drilled in.
- The global next action is in the stage command bar; duplicate header actions were removed.
- Completed stages remain green while a selected historical stage remains blue.
- The universal inspector preserves task brief, viewed/active stage context, model/access/sandbox metadata, decision frontier, current candidate identity, and living artifacts.
- Human decisions can be recorded inline and are injected into every downstream prompt.
- Candidate artifacts, failed gate evidence, and repaired revisions remain drillable.
- Approval history is visible in the universal inspector with stage, note fallback, and timestamp; switching tasks resets the viewed-stage context to the new task.
- Access-boundary copy and the inspector's agent/sandbox metadata are derived from the active stage, while viewed-stage artifacts remain independently selectable.
- The footer reports real tokens/cached tokens and `Plan included`; ChatGPT plan usage does not expose a reliable per-task dollar charge.
- Queued and gated tasks appear as needing input rather than pretending they are actively running.

## Known limitations and next work

1. The planner produces useful Markdown but not yet a parsed dependency graph or executable work-package records. One Codex implementation session creates one candidate; parallel/ordered slices still need a scheduler and candidate assembly step.
2. Focused Test is agent-assisted. It is told to run only existing, non-interactive, non-E2E repository checks, but results are not yet normalized into a per-command/per-test list with accordion drill-down.
3. Gate verdict parsing is conservative but simple: a top-line `PASS` advances; any other response requires repair. Structured output schemas and a code-specific rubric model should replace this.
4. Repairs update the current candidate branch and retain revision history/artifacts, but the data model does not yet represent a separate immutable candidate object for every revision.
5. API mutations do not yet use idempotency keys or optimistic revision tokens. Process-local locks prevent duplicate active agents only within one companion process.
6. No worktree/branch cleanup, rebase, conflict-resolution, repository picker, streamed activity, or PR publishing exists in the product UI.
7. The JSON store is appropriate for one local user, not concurrent or remote workers.
8. The hosted Sites artifact is UI-only: a Cloudflare worker cannot access the user's local Codex login, Git checkouts, or filesystem.
9. The real runtime uses one OpenAI/Codex model today. Agent profiles and additional providers remain represented in the complete prototype but are not wired into task execution.

## Fast verification record

- `npm run lint`
- `npm run typecheck`
- `npm test` (23 tests at this handoff)
- `npm run build`
- `npm run test:sites`
- Real OAuth subprocess smoke through stdin: GPT-5.4-mini returned the requested Markdown and usage without API keys.
- Real temporary-Git test: create nested ignored worktree, commit candidate, validate SHA, and fast-forward merge.
- Three complete dogfood tasks reached human-approved fast-forward merge; see `docs/dogfood-report.md` for candidate revisions, failure-budget accounting, and remediations.
- Browser smoke: completed-task merge summary, approval history, active/viewed-stage separation, historical Test evidence, task switching, and task-list aggregates rendered without console errors.

### Live-run calibration note

The first Goose Hub investigation used GPT-5.4 with inherited high-context settings. It produced strong `triage.md` and `repository-scout.md` artifacts, but reported 974.8k total tokens (843.3k cached) before Grill was manually cancelled. Defaults were changed to GPT-5.4-mini at low reasoning, prompts cap repository commands, and subprocess output is bounded. That retained local task is useful for testing historical artifacts, a blocked frontier, and honest usage display; it is not committed to Git.
