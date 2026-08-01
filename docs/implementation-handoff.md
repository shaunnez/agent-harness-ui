# Agent Harness implementation handoff

Updated: 2026-08-01

## Delivered cut

This repository now contains two coherent layers:

1. The approved full-product interaction prototype. It covers the command centre, libraries, agents/skills/settings, all ten workflow stages, parallel implementation slices, candidate assembly, review, mixed tests, repair, final review, and human approval.
2. A real local investigation slice. It persists tasks and runs four separate GPT-5.4-mini Codex sessions—Triage, Repository Scouts, Decision Brief, and Task Specification—inside a read-only sandbox against a user-selected repository.

The real slice is intentionally smaller than the full workflow. It proves the critical product seam: a task created in the UI becomes plan-backed local model work, progresses through visible stages, and leaves durable artifacts that can be inspected from downstream context.

## Runtime contract

### Authentication

- Binary discovery uses `CODEX_BIN` when set, otherwise `where.exe codex` on Windows or `which codex` elsewhere.
- Readiness uses `codex login status` and reports only availability, authentication state, method, configured model, and the binary path.
- Agent runs explicitly remove API-key environment variables. They rely on the user's existing Codex ChatGPT session.
- The selected default is `gpt-5.4-mini` at low reasoning because the installed CLI currently rejects the desktop app's newer configured default and the user's global `xhigh` reasoning setting is too expensive for compact pipeline stages. Override with `AGENT_HARNESS_MODEL` and `AGENT_HARNESS_REASONING`.

### Process boundary

Each stage launches:

```text
codex exec --json --skip-git-repo-check --sandbox read-only \
  --model gpt-5.4-mini --cd <selected repository> <stage prompt>
```

Stdout is parsed as JSONL. Final agent messages become Markdown artifacts; `turn.completed` usage becomes task/artifact token metadata; bounded command/session events become scoped activity. Each process has a four-minute timeout, a 2.5 MB evidence-output budget, bounded retained stdout/stderr, Windows-hidden execution, and an abort signal.

### Safety boundary

- The companion binds to `127.0.0.1`, not the LAN.
- Repository paths must be absolute, readable directories.
- Real stages are read-only and prompts explicitly prohibit mutation, installs, commits, pushes, destructive commands, or contacting external services.
- Credentials and OAuth tokens are not read, copied, persisted, or returned by the API.
- Dollar cost is `null` for plan-backed work; the UI never fabricates a per-task charge.

## API surface

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | Local companion liveness |
| `GET` | `/api/runtime/status` | Codex/ChatGPT readiness and suggested repository |
| `GET` | `/api/tasks` | Persisted task list |
| `POST` | `/api/tasks` | Validate and create a task |
| `GET` | `/api/tasks/:id` | Full task, artifacts, usage, and activity |
| `POST` | `/api/tasks/:id/run` | Start or retry the current stage frontier |
| `POST` | `/api/tasks/:id/cancel` | Abort an in-memory active subprocess |

The UI polls an open running task every 1.25 seconds and backs off to five seconds when idle. Polling is sufficient for this cut; Server-Sent Events can replace it when command output needs to feel truly live.

## Persistence contract

`.data/tasks.json` holds a deliberately straightforward document:

- monotonically assigned `AH-###` task IDs;
- task brief, repository, priority, and workflow;
- status/current/completed stages and retry counter;
- model list and cumulative token usage;
- retained Markdown artifacts, including per-stage usage;
- a capped list of 250 scoped activity records.

Writes use a temporary file plus rename and are serialized in-process. A task found in `running` state after restart is marked failed with an explicit interruption event so it can be retried. This is not an immutable ledger and should not become one unless multi-process durability genuinely requires it.

## Frontend behavior

- App launch lands on the Command Centre.
- When real tasks exist, command/task tables show them instead of prototype rows.
- A real task opens the same approved shell with Tasks highlighted.
- Completed stages remain green while a separately selected historical stage remains blue.
- The main canvas shows the selected living artifact; the universal inspector keeps task brief, stage context, execution metadata, and all artifacts visible.
- Artifact drill-down uses the existing wide read-only viewer.
- Run activity is collapsed and scoped; artifacts remain the source of truth.
- The footer reports real token/cached-token usage and `Plan included` for cost.

## Known limitations

- Real execution stops after Task Specification and waits for review. The implementation-stage UI is still prototype data.
- No interactive Grill answer endpoint exists yet. The current Decision Brief agent settles low-risk assumptions and surfaces consequential questions for human review.
- One Node process owns run locks. A future multi-process service needs a database lease.
- The JSON store is appropriate for one local user, not concurrent remote users.
- There is no repository browser picker yet; the modal accepts an absolute path.
- The hosted Sites artifact is UI-only because Cloudflare cannot access a local Codex session or filesystem.

## Next vertical slices

1. Add an explicit specification approval and interactive decision-answer contract.
2. Turn the implementation plan into persisted work packages with dependency batches.
3. Create isolated Git worktrees and run one Codex implementation session per ready package.
4. Assemble versioned integration candidates and bind review/test evidence to a commit SHA.
5. Add deterministic test commands, mixed result drill-down, repair packets, and candidate invalidation.
6. Add final review and a guarded `Approve & merge` action with target branch/method confirmation.
7. Replace polling with SSE, then add configurable agent profiles and additional model providers without changing task terminology.

Track these against the repository epic and focused issues. Keep implementation incremental: every slice should leave the UI truthful and runnable even if downstream stages remain preview-only.

## Fast verification record

- `npm run lint`
- `npm run typecheck`
- `npm test`
- `npm run build`
- `GET /api/runtime/status` returns `authenticated: true`, `authMethod: ChatGPT`, and the configured GPT model on the current machine.
- Browser smoke: Command Centre → real task → stage workspace → New Task modal at 1440×1000.

### Live-run calibration note

The first end-to-end Goose Hub investigation used GPT-5.4 with the user's inherited high-context settings. It produced strong `triage.md` and `repository-scout.md` artifacts, but reported 974.8k total tokens (843.3k cached) before the downstream Grill run was manually cancelled. That was too expensive for a compact stage even on a large plan. The shipped defaults were therefore changed to GPT-5.4-mini at low reasoning, prompts now cap repository commands, and the subprocess now enforces a 2.5 MB evidence-output budget. The retained local QA task remains useful for testing completed-stage history, a blocked active frontier, artifact drill-down, and honest usage display; it is not checked into Git.
