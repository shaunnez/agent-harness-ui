# Agent Harness

A local-first AI development workflow that turns a task into inspectable, persistent agent work. The approved Evidence Gate prototype is available across all ten stages, and the real local runtime can now carry an implementation task from investigation through an explicitly approved, revision-bound Git candidate.

## What works now

- Real task creation with title, description, priority, workflow, risk-based workflow profile, and an absolute local repository path.
- Agents launched through the ChatGPT-authenticated local Codex CLI with no API key required or forwarded to child processes.
- A grounded investigation pipeline that pauses at Grill Me with real agent-generated questions, persisted answers, explicit completion semantics, and retained Markdown artifacts.
- Persisted human decisions plus explicit specification and dependency-aware implementation-plan approvals.
- Dependency-batched work packages that execute concurrently in isolated Git worktrees, followed by ordered candidate assembly, candidate-bound review/test gates, repair revisions, and a revalidated fast-forward-only human merge action.
- Persisted `fast`, `standard`, and `high-risk` profiles with deterministic selection, a pre-implementation operator override, automatic escalation, and explicit not-required stage reasons rather than fabricated completion evidence.
- Focused argv-only checks bound to each package commit, followed by one complete repository verification-manifest execution per candidate revision. Review and Final Review consume that retained evidence instead of rerunning it.
- A live task workspace with viewed-versus-active stages, top-of-stage actions, task/stage/candidate context, living artifact drill-down, scoped run activity, and real token/cache telemetry with clearly labelled API-rate estimates.
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
$env:AGENT_HARNESS_DATA = "C:\path\to\tasks.json"
$env:AGENT_HARNESS_MODEL = "gpt-5.6-luna"
$env:AGENT_HARNESS_REASONING = "xhigh"
npm run dev
```

## Authentication, model policy, and billing

Model policy is configurable by workflow profile and stage. The default policy is:

- Fast: Luna Medium for triage/optional scout, Luna High for implementation, Sol High for Plan and independent Development Review, and Luna Medium when a model-backed Final Review is required.
- Standard: Luna XHigh for investigation and implementation, Sol High for Plan and Development Review, and Luna Medium for Final Review.
- High-risk: the standard defaults, with an explicit opt-in to Sol XHigh for planning; it is not the general default.
- Repair starts with the profile's implementation model and escalates to Sol High for architectural defects or after a failed repair.

An eligible fast task normally calls only Triage, Implement, and one independent Development Review. Grill, Specification, and Plan are marked not required when one bounded change contract contains authoritative criteria, one package, owned paths, and focused manifest command IDs. Focused Test is harness-executed and Final Review is deterministic when the retained evidence contains no unresolved blocking risk. Human Approval keeps the same exact-candidate freshness and clean-worktree requirements.

Agent Harness checks `codex login status` and then spawns `codex exec --json` through the ChatGPT-authenticated local Codex CLI. No API key is required, requested, stored, or forwarded to child processes; credentials are not read by the app.

Codex reports real input, cached-input, and output token counts, with cache rate shown where available. ChatGPT-plan sessions do not expose an attributable per-task dollar charge. Calculated dollar values are labelled **Approx. cost** and **API-rate estimate** and are not ChatGPT-plan billing.

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
npm run test:sites
```

The suite covers profile selection/escalation, zero-scout fast tasks, explicit stage skipping, package-versus-candidate verification, once-per-revision manifest reuse, review retries, bounded repair, exact-candidate invalidation and Human Approval, plus the existing standard and multi-package lifecycles. Browser smoke artifacts are ignored by Git.

See [docs/implementation-handoff.md](docs/implementation-handoff.md) for API/data contracts, safety boundaries, current limitations, and the next build slices. The complete intended workflow remains in [docs/workflow-product-contract.md](docs/workflow-product-contract.md).
