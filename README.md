# Agent Harness

A local-first AI development workflow that turns a task into inspectable, persistent agent work. The approved Evidence Gate prototype is available across all ten stages, and the real local runtime can now carry an implementation task from investigation through an explicitly approved, revision-bound Git candidate.

## What works now

- Real task creation with title, description, priority, workflow, and an absolute local repository path.
- GPT-5.4-mini agents launched through the local Codex CLI using the existing ChatGPT login. No API key is requested, stored, or passed to child processes.
- A grounded investigation pipeline that pauses at Grill Me with real agent-generated questions, persisted answers, explicit completion semantics, and retained Markdown artifacts.
- Persisted human decisions plus explicit specification and dependency-aware implementation-plan approvals.
- Dependency-batched work packages that execute concurrently in isolated Git worktrees, followed by ordered candidate assembly, candidate-bound review/test gates, repair revisions, and a revalidated fast-forward-only human merge action.
- A live task workspace with viewed-versus-active stages, top-of-stage actions, task/stage/candidate context, living artifact drill-down, scoped run activity, token counts, and honest plan-cost treatment.
- The original full prototype for multiple-provider workflow concepts that remain ahead of the real OpenAI/Codex-only runtime.

## Run locally

Prerequisites:

- Node.js 22 or newer.
- Codex CLI installed and authenticated with ChatGPT. Verify with `codex login status`.

```powershell
npm install
npm run dev
```

Open `http://127.0.0.1:4173`. The local companion API listens only on `127.0.0.1:4310`.

Optional environment settings:

```powershell
$env:AGENT_HARNESS_REPOSITORY = "C:\path\to\default-repository"
$env:AGENT_HARNESS_MODEL = "gpt-5.4-mini"
$env:AGENT_HARNESS_REASONING = "low"
$env:AGENT_HARNESS_DATA = "C:\path\to\tasks.json"
npm run dev
```

## Authentication and billing

Agent Harness calls `codex login status` and then spawns `codex exec --json` with GPT-5.4-mini. The child inherits the local Codex/ChatGPT session and explicitly removes `OPENAI_API_KEY` and `CODEX_API_KEY` from its environment. Credentials are never read by the app.

Codex reports input, cached-input, and output token counts. A ChatGPT plan does not expose a reliable per-task dollar charge, so the UI shows `Plan included` instead of inventing an approximate cost.

## Local architecture

```text
React/Vite UI :4173
    │ /api proxy
    ▼
Node companion :4310
    ├── JSON task store (.data/tasks.json)
    ├── task orchestrator (one active run per task)
    ├── Codex CLI subprocess (OAuth session; read-only or isolated workspace-write)
    └── Git worktree manager (.data/worktrees; guarded fast-forward merge)
            ▼
       selected local repository
```

The Vite/Sites build remains a frontend handoff. A hosted Cloudflare worker cannot launch the user's local Codex binary or access local repositories, so real agent execution requires the local companion process.

## Verification

```powershell
npm run lint
npm run typecheck
npm test
npm run build
```

The focused test suite covers the JSON store, interrupted-run recovery, Codex JSONL parsing, Grill and task/API gating, dependency parsing, the complete mocked multi-package candidate lifecycle including repair, real temporary Git slice assembly and merge, and the Sites fallback worker. Browser smoke artifacts are ignored by Git.

See [docs/implementation-handoff.md](docs/implementation-handoff.md) for API/data contracts, safety boundaries, current limitations, and the next build slices. The complete intended workflow remains in [docs/workflow-product-contract.md](docs/workflow-product-contract.md).
