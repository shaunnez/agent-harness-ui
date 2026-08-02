# Prototype Instructions

Run the local server yourself and open the preview in the browser available to this environment. Do not give the user server-start instructions when you can run it.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

Build app UI in `src/`. Keep `.openai/hosting.json`, `worker/index.js`, `scripts/prepare-sites-build.mjs`, and `tests/sites-worker.test.mjs` intact so the same local prototype can be handed to Sites. Before a Sites handoff, run `npm run build` and `npm run test:sites`; the build must leave `dist/client/index.html`, `dist/server/index.js`, and `dist/.openai/hosting.json`.

## Approved product-design direction

- Use the selected “Evidence Gate” direction as the shared visual system for every screen and workflow state: warm ink surfaces, compact full sidebar, horizontal stage navigator, structured evidence, restrained semantic colour, and a low-height event ledger.
- Use the selected “Stage Desk” direction only for the Grill Me interaction: one question at a time, repository evidence before answer choices, a recommended answer with concise rationale, accumulated decisions, and specification readiness.
- Render the command centre, all ten task stages, failure/repair, blocked, completed, and human-approval states coherently inside the same shell.
- Keep one universal task inspector across every stage: task brief, viewed versus active stage, skill/agent/model, execution metadata, collapsed run safeguards, then stage-specific decisions and living artifacts.
- Treat artifacts as durable handoffs between stages. They must be inspectable in a wide read-only viewer; do not use speculative acceptance-criteria previews before the specification exists.
- Show implementation plans as explicit dependency batches (`S1 → S2 + S3 in parallel → S4`) with drillable work-package detail, ownership, interfaces, verification commands, usage, and cost.
- Treat Implement as a work-package overview with package drill-down and a main-canvas inline diff. Keep the eight-part quality rubric as an implementation self-score, not a Dev Review verdict.
- Dev Review is a fresh-context code advisor with P0–P3 findings, file and line suggestions, one revision allowance, and visible repair lineage when a prior test failure caused a repair.
- Tests use a mixed result list with drillable success and failure detail, an explicit way back to the list, and global repair/retry actions outside individual result accordions.
- Final Review summarizes every prior stage with state, tokens, approximate cost, and the key outcome so a human can clearly see what was done.

## Durable workflow decisions

- Treat parallel implementation slices as isolated worktree units that become **ready for integration** after local qualification; never present a green slice as proof that the whole task passed.
- Assemble the qualified slice commits into an explicit, versioned integration candidate inside Implement. Dev Review, Test, Final Review, and Human Approval are bound to the exact candidate revision.
- A repair creates a new candidate revision and makes affected review/test verdicts stale. Preserve prior evidence for audit, show repair lineage, and rerun the invalidated gates.
- Keep primary and global workflow actions in a consistent command bar at the top of every stage. Long evidence must not hide the next safe action.
- Human Approval must show the candidate revision, target branch, merge method, and gate freshness, and the primary action must say **Approve & merge**.
- Keep **Run activity** collapsed by default. It is scoped chronological telemetry with Activity, Agent runs, Test runs, and Decisions filters; stage content and artifacts remain the source of truth.
- Discover selectable Codex models from the local model catalog, keep an explicit allowlist/default model/default reasoning policy in Settings, and snapshot that selection on each task so historical runs remain reproducible.
- Show model usage at task and agent-run granularity: input, output, cached input and cache rate. Label calculated dollar values **Approx. cost** and **API-rate estimate** because ChatGPT-plan execution does not expose an attributable provider charge.
- Persist a context manifest with every new model-owned artifact. Distinguish context supplied in the prompt from repository access permission, show truncation/size, and never claim that supplied context proves what the model semantically used.
- Describe retained worktrees as temporary isolated Git copies, scope the inspector list to the active task, and use compact inline rows rather than card-like white boxes.
- The full terminology, state machines, UI behavior, entity model, event contract, repair policy, cost model, and prototype-to-backend handoff are recorded in `docs/workflow-product-contract.md`.
- When a repair starts or is required, make that state explicit in Implement and visually invalidate every downstream candidate-bound gate. Prior Dev Review and Test evidence remains inspectable for audit, but must read as stale / rerun required rather than completed.
- Use one shared task-table component on Command Centre and Tasks. Recent tasks are the five most recently updated rows, include dates, and end with a full-width **See all tasks** link; search and filters must change the visible rows.
- Body and control text should normally be 14–16px, with metadata and other small text no smaller than 12px. Clickable disclosure rows need a visible hover treatment and caret.
- Render Markdown artifacts as styled HTML with raw source still available. Render candidate diffs as file-grouped, syntax-coloured unified diffs.
- Product metrics must be truthful. Do not show invented skill or agent success rates, model availability, connection health, or editable settings. Dollar values may be calculated only from recorded tokens and an identified API rate card; label them **Approx. cost** and **API-rate estimate**, and distinguish configured, discovered, and unsupported capabilities.
- Default new tasks to Luna XHigh for triage, selected scouts, Grill, specification, implementation, and test. Use Sol High for planning, repair, development review, and final review. Keep Luna Max available for controlled dogfood comparisons rather than silently making it the default.
- Use the Goose scout taxonomy: code path, dependency, pattern, schema, test inventory, and user journey. Dispatch only the evidence needed for the task (normally one low-risk, up to two medium-risk, and up to three high-risk scouts), retain the selected/skipped set, and pass a compact deterministic synthesis downstream.
- Evaluate model variants on repeated task suites using observed quality, gate pass rate, repair count, wall time, tokens, cache rate, work credits, and API-equivalent cost. Never infer quality from cost or completion alone.

## Current implementation boundary

- The real runtime uses role-specific GPT-5.6 policies through the user's existing ChatGPT-authenticated Codex CLI, with Luna XHigh as the general worker and Sol High at the high-leverage planning and review gates. Never request, read, store, or pass an OpenAI API key for this path.
- Keep the local companion bound to loopback. Investigation, planning, review, and final review are read-only; Implement and Repair may write only inside the isolated candidate worktree; Test may create temporary files inside the candidate but must leave the exact candidate revision clean.
- Persist local task state simply in `.data/tasks.json`; do not introduce an immutable event ledger without a concrete concurrency or audit requirement.
- Treat the attributable ChatGPT-plan dollar charge as unavailable. Show real token counts and cache rate; when a model has a verified rate card, show a clearly labeled API-rate estimate after cached-input discounts rather than presenting it as the user's actual billed charge.
- The hosted Sites build is a UI artifact only. Local Codex execution and repository access require the Node companion.
- Keep real and preview states truthful: the full single-candidate workflow is wired through human fast-forward merge. Multi-package scheduling, candidate assembly, normalized test results, and multiple providers remain prototype-only until their backend contracts exist.
