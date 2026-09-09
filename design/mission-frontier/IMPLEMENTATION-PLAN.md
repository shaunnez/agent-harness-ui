# Mission Frontier v1 — implementation plan

Plan revision 1 · 6 September 2026 · Execution status: M0–M3 completed and accepted by Shaun; Goal 2, M4–M7, completed on 6 September 2026. Native IAB verification limits and P3 follow-up are recorded in build-evidence/M7/acceptance.md. Current evidence and checkpoints live in [build-evidence/progress.md](build-evidence/progress.md); goal prompts remain in [BUILD-GOALS.md](BUILD-GOALS.md).

## 1. Outcome and delivery boundary

Build a new game-centred frontend for Agent Harness. The world is home: project bases, task work sites and identifiable worker runs connect directly to task creation, decisions, evidence, model policies and delivery. Users can reach every operational action through readable overlays and keyboard/search routes as well as world selection.

Deliver two independently verifiable outcomes:

1. **First playable, M0–M3:** a visually convincing world → headquarters → agent → pending decision → world journey, running/waiting/repair scenarios, and one bounded real local-backend workflow. End this goal with a working preview and evidence for Shaun's game-feel review.
2. **Complete v1, M4–M7:** all 25 designed destinations, full supported workflows, the specifically identified backend additions, and measured busy-world, reconnect, accessibility and performance checks. Start this goal after the first playable has been reviewed, incorporating that feedback.

The first playable is a deliberate subset. Passing it is not completion of v1. Internal asset and engineering gates are owned by the builder; they do not require permission for routine fixes. The single planned product review is the first playable. Material changes to the accepted visual direction or product scope require an explicit decision.

### Scope

- Required: cross-project world, project registration/management, task journal and creation, workflow stages and agents/steps, questions and approvals, artifacts/diffs, policies per supported agent role/skill, run history, tokens/time/approximate cost, truthful attention, current-state reconciliation and a usable desktop fallback.
- v2: manual building placement, persistent agent names, upgrades, unlocks, resource economy/XP and related progression systems.
- Not established by the accepted design: free camera rotation/tilt, arbitrary dragging of tasks between stages, editing skill source, independent policies for each scout child, token-by-token reasoning/output, cloud execution of local repository work, or publication of the new frontend.
- A persistent agent employee is not introduced. A visible worker is an actual run/package instance; a role portrait is a reusable capability.

## 2. Authority and current baseline

Use current user instructions first, then the applicable repository instructions and live code. For visual layout, use the selected world and the page/state image selected in `screen-catalog.json`. For workflow semantics, use the written contracts and backend evidence. The current Mission Frontier brief supersedes older Evidence Gate/Courier Rooms layout restrictions; their task/candidate safety rules remain applicable.

Read before starting:

- [DESIGN-SPEC.md](DESIGN-SPEC.md): world, camera, navigation, all 25 pages and detailed interactions.
- [ATTENTION-CONTRACT.md](ATTENTION-CONTRACT.md): stage, reason, next actor, eligibility and worker/task distinctions.
- [BACKEND-COVERAGE.md](BACKEND-COVERAGE.md): implemented capabilities and gaps.
- [ASSET-PRODUCTION.md](ASSET-PRODUCTION.md): renderer/asset agreement and Astra assignments.
- [screen-catalog.json](screen-catalog.json) and [asset-manifest.json](asset-manifest.json): selected studies and provenance.
- `docs/workflow-product-contract.md` and the current server contracts. Historical example event names are not proof of a current transport or emitted event.

Planning inspection: repository remote `https://github.com/shaunnez/agent-harness-ui.git`, HEAD `e31566a36ed871cdb3743b8aaadaf08e7f19c6fd`, detached worktree at `/Users/shaun/.codex/worktrees/7237/agent-harness-ui`. Existing changes include `AGENTS.md` and the untracked design pack. This identifies the inspected snapshot, not a mandate to build on an obsolete head. M0 rechecks the repository, base, files and runtime ownership; preserve the accepted design pack when selecting a build checkout.

Current stack: React 19, TypeScript, Vite, Inter and Phosphor icons; Node >=22.13; Biome; Node's test runner. The companion uses loopback HTTP and SQLite, and runs agents through the existing ChatGPT-authenticated Codex CLI. There is no OpenAI API-key requirement for this execution path.

## 3. Architecture decisions

### D1 — new application, independent entry/build

Initial packaging is a new frontend application in this repository, with its own entry at `src/frontier/index.html` and implementation beneath `src/frontier/`. A dedicated `vite.frontier.config.mjs` builds `dist/frontier/index.html`. Add `dev:frontier`, `build:frontier` and `test:frontier` scripts during M0. This is the proposed interpretation of “new project”: a separate application and visual system, initially colocated with the existing backend and contracts. Creating a second Git repository or a shared package is not required for v1.

Keep `src/main.tsx`, the current application entry/routes, `.openai/hosting.json`, `worker/index.js`, `scripts/prepare-sites-build.mjs` and `tests/sites-worker.test.mjs` intact. The existing `npm run build` must still produce `dist/client/index.html`, `dist/server/index.js` and `dist/.openai/hosting.json`. The new build has its own output and must not delete those files. Reuse the established toolchain; do not run a starter that overwrites the project.

The new app may import stable domain types and API functions. It must not import the old `App`, shell or global visual styles. Extract a genuinely shared contract only when an actual dependency requires it. Do not copy workflow eligibility rules into a new game engine.

### D2 — React overlays, PixiJS world

Use React/TypeScript and semantic DOM for navigation, live labels, HUD, forms, tables, evidence and inspectors. Use PixiJS 8 for terrain, buildings, workers, camera transforms, depth ordering and effects. Select and pin an available compatible PixiJS patch version in M0 after checking its official documentation and the installed Node/React toolchain. A React/Pixi wrapper and a second state library are unnecessary unless the first slice demonstrates a concrete need.

The camera is fixed isometric with pan/zoom. Overview, exposed headquarters and agent detail are authored compatible view compositions, with an explicit camera ease/crossfade when changing representation. A flat sprite cannot reveal unseen interiors or become a rotating 3D model. M1 proves these view transitions before full asset production. If the accepted fidelity cannot be reached, record the evidence and resolve the asset/renderer tradeoff; do not quietly lower the visual target or expand to a full 3D project.

The world is made of independently placed objects. A complete mockup image with click regions is not a passing game implementation. Background art may contain fixed scenery, but task sites, occupancy, workers, statuses, names and actions must remain independent.

Pixi owns transient animation/camera state. React owns navigation, drafts and semantic application state. Do not rerender the whole React tree each animation frame. Detach listeners, tickers and textures on disposal; account for development StrictMode lifecycle. Suspend unnecessary animation when hidden and supply reduced-motion output.

### D3 — one authoritative state path

```text
Existing loopback API + retained activity
              ↓
Typed runtime gateway / refresh coordinator
              ↓
Current task/run records + pure presentation projections
              ↓
React operational views          Pixi scene reconciler
              ↑                         ↑
              └── ID-based selection ───┘

Explicit user command → existing validated API → refreshed records
```

Implement a small gateway for the reads and commands the current milestone consumes. Reuse `src/api.ts` where compatible; add cancellation/request-generation guards at its boundary where needed. Provide distinct live and fixture adapters implementing the same frontend-facing contract. Fixture mode must be visibly labelled and must never call the real mutation API.

- Load project/task summaries first. Use `pollVersion` to detect changes; fetch selected core state and paginated activity/runs/artifacts only when needed.
- There is no verified SSE/WebSocket route in this checkout. Ship the initial live adapter over existing HTTP polling. Record any externally supplied stream contract before adopting it; do not build an invented streaming backend to support animation.
- Start with one non-overlapping global poll around every 2 seconds, selected-task refresh around every second, bounded read concurrency, and slower polling while hidden. These are proposed tunable defaults to measure in M3/M7, not API guarantees.
- Keep only one refresh owner. Ignore responses for an obsolete selection/request generation; cancel obsolete reads when supported. Core version and evidence counters control hydration rather than fetching every artifact every tick.
- Reconcile scene entities by project/task/run/package ID. Only a newer persisted transition may start a one-off handoff/travel animation. Initial load, historical paging and reconnect seed current state without replaying history. Repeated event IDs do not retrigger motion.
- Backend events are observations. Animation completion never advances a task, qualifies a package or enables an approval.
- Preserve current drafts and camera/selection through overlays and transient connection failures. Live status must have an observed successful refresh time; disconnected views explicitly show last-known state and suspend strong work animation.

### D4 — projection, selection and commands

Create pure, typed projections for project occupancy, task attention, active/historical workers, package dependency layout and usage display. Keep task waiting state separate from run execution status. A completed Grill run can coexist with `Needs your answer`; a completed review run can coexist with `Repair required`. A blocked package does not stop a healthy sibling for visual consistency.

World labels, headquarters and Watch an agent consume the same attention projection. They show stage, actual reason, next actor, recorded start time when available, and an evidence/action destination. Use current full/core eligibility before a command: `allowed: true, mode: preflight-only` means a readiness check, not permission to execute. Candidate-bound commands retain task/candidate/revision/head and denial evidence. Preserve existing explicit operator approval boundaries.

Task-to-project association currently follows repository identity, not a required task `projectId`. Reuse validated repository identity semantics. A `suggested:` project is a registration suggestion, not an editable persisted project. Plan stable slots using persisted project IDs once registered and a reconciled repository key before registration; renaming must not move a base or detach its tasks.

World layout uses stable automatic allocation, local-device persistence/versioning and deterministic fallback. Additions do not reshuffle existing bases. Growth allocates adjacent sites/regions and groups distant entities; no baked limit on projects/tasks/packages. `1–N` implementation packages lay out by dependency batch. Distinguish ready-for-integration from integrated.

### D5 — narrow modules, created as needed

Suggested ownership boundaries, not a request to scaffold empty abstractions:

| Location | Responsibility |
| --- | --- |
| `src/frontier/app/` | Entry, hash/deep-link routes, command menu, overlay/focus ownership |
| `src/frontier/runtime/` | Gateway, refresh coordination, state/attention/usage projections |
| `src/frontier/world/` | Pixi lifecycle, camera, scene reconciliation, layout, labels, motion |
| `src/frontier/views/` | Projects, task workflow, agents, skills, usage, settings, evidence |
| `src/frontier/ui/` | Cohesive reused controls, tokens, readable layout patterns |
| `src/frontier/fixtures/` | Explicit preview scenarios; isolated from live mutations |
| `public/frontier/assets/` | Accepted runtime assets copied by the integration owner |
| `tests/frontier/` | Pure projection and isolated API integration tests |
| `design/mission-frontier/assets/` | Asset agent's sources, staging, provenance and QA |
| `design/mission-frontier/build-evidence/` | Checkpoints, screenshots, interaction/performance reports |

Keep files under roughly 500 lines where practical. Introduce a dependency or extraction because it solves a measured problem, not to anticipate every possible renderer or backend.

## 4. Backend work explicitly included in v1

These are proposed additions, not claims that these APIs already exist. Keep backward compatibility and use the same server validation, storage transaction and error patterns. Complete B0/B3 only as far as the first playable needs; B1/B2 belong to M4.

| ID | Change | Contract and acceptance |
| --- | --- | --- |
| B0 | New frontend local origin | `vite.frontier.config.mjs` proxies `/api` to a configured loopback companion. Use an available dedicated web port, proposed 5199, and add only its exact loopback origin(s) to `server/http-security.mjs` if needed. Keep CSRF, JSON content type and loopback Host/Origin checks; no wildcard CORS or Origin rewriting to bypass validation. Test accepted and rejected origins and stale CSRF handling. |
| B1 | Per-role policies in task creation | Add optional `rolePolicyOverrides` keyed by canonical role policy ID. Validate model allowlist/catalogue, reasoning levels and unknown keys before creating anything. Apply explicit role overrides consistently to the snapshotted profile matrices and effective selected policy. Preserve inherited defaults for omitted roles and all old requests. Reject ambiguous combinations of the new matrix and legacy blanket model/effort overrides; document precedence. Keep design-provider selections in their separate existing contract. Return the actual saved policies; verify after reload. Creation stays atomic and does not start execution. |
| B2 | Project display rename and archive/restore | Proposed commands: `PATCH /api/projects/:id` for display name, `POST /api/projects/:id/archive` and `/restore`. Repository identity and project ID remain immutable. Apply existing uniqueness/length rules. Archive hides an inactive project from the default world/new-task picker and retains all evidence; block archival while it has nonterminal tasks, active reservations/runs, pending approvals or an unresolved PR. Restore reuses the same identity. Enforce archive admission and new-task admission transactionally, including concurrency. No deletion of repositories or tasks. Suggested projects must be registered before editing. |
| B3 | Consistent lightweight attention | Add an optional pure server projection to summaries/core if current fields cannot supply all HQ labels without hydrating every task. Proposed fields: kind, stage, concise reason or null, recorded since or null, next-actor kind, and inspect destination identity. Derive from retained evidence using one projection; no second persisted state machine. Missing reason/time remains unavailable. Full/core action eligibility remains the authority for commands. Test every attention class and mixed package state. |

B2 storage note: projects are currently held in the settings record in both store implementations, including SQLite. Extend that record compatibly (for example optional `archivedAt`); do not invent a projects-table migration without inspecting a later schema. Default legacy records to active and preserve JSON import/export parity. Use store transactions for project/task admission and recheck archived state when a task is created, not only when the picker opens.

B1 policy note: ordinary roles use the current catalogue and role taxonomy. Scout children currently share the scouts policy; show that scope. Arbitrary independent child policies or editing skill implementation source require a separately accepted extension. Snapshot provenance must distinguish inherited defaults from task overrides. Repair and started/completed role policies keep existing lifecycle locks.

Other design gaps have explicit v1 treatment: source skill instructions are read-only; repository replacement creates another project; arbitrary drag-to-stage/pause controls are absent unless current backend admission supports the exact action; unsupported artifact edits use existing request-change/regeneration flows. Global usage/history initially aggregates summaries and pages run details on demand, with scope/completeness labelled. Do not present a task-scoped API as an unlimited global run index.

## 5. Milestones and dependency order

```text
M0 contracts + isolated setup
  ├─ code: shell/gateway/test harness ─┐
  └─ Astra A0: calibration assets ───┴─ M1 rendered fidelity proof
                                       ├─ code: world + attention ─┐
                                       └─ Astra A1: playable kit ─┴─ M2 playable world
                                                                    ↓
                                                          M3 real workflow + QA
                                                                    ↓
                                                      Shaun reviews first playable
                                                                    ↓
                        Astra A2 full kit + M4 management → M5 workflow → M6 insight
                                                                    ↓
                                                          M7 complete-v1 qualification
```

The main agent owns integration, browser use, dependencies and backend changes. One Astra asset subagent works only on assigned asset outputs; the main agent sends one asset ID at a time and reuses that agent. A delivered asset is not automatically accepted. No two agents edit the same files. Additional coding agents are optional later only after interfaces and disjoint ownership are explicit; they are not necessary to run this plan.

### M0 — execution contract and isolated environment

Deliver:

- Confirm repository/remote/head, applicable instructions and existing changes. Choose a `codex/` build branch/check-out without overwriting user work; preserve all design files. Record the actual baseline in `build-evidence/progress.md`.
- Add the independent frontend entry/config/scripts and minimal operational shell. Reuse installed conventions and lockfile. Establish runtime/fixture modes with explicit visible identification.
- Create typed gateway and scenario builders for the first slice; a small test API host reuses `createApiServer`, `SqliteTaskStore` and a disposable Git repository. Establish distinct data paths/ports for deterministic API tests and real Codex smoke work.
- Agree the calibration manifest with the asset agent before production; measure the source image geometry and intended screen footprints.

Pass when: legacy and new entries build independently; the frontend can read status/projects/task summaries from the assigned loopback API; origin/CSRF behaviour is tested; the test host cannot connect to the user's live data store; initial lint/types/build/test results and any inherited failures are recorded. New scripts resolve to real runnable checks, including pure TypeScript tests using the supported Node toolchain.

### M1 — rendered fidelity proof with Astra A0

Deliver one base module, worker and workbench plus enough scene art to compare overview, HQ and detail. Prove registration, layer occlusion, neutral/active worker appearance and camera representation changes. Use actual generated/source artwork and library icons; procedural boxes or CSS paintings do not replace missing environment assets.

Pass when: the integrated scene is recognizably the selected Mission Frontier design at intended display size; all three views remain coherent; labels are readable; no baked dynamic state, matte halo, obvious art seams or faux zoom into unavailable geometry; one credible working motion and its static counterpart render correctly. Save side-by-side reference/app evidence and asset acceptance IDs. Full kit production is blocked by this internal gate until it passes.

### M2 — world, headquarters and agent experience

Deliver the A1 first-playable kit integrated into stable automatic world layout, selection, pan/zoom, minimap, enter-base and watch-agent transitions. Implement shared attention, a minimal task/Grill inspector, local preferences and overlay return/focus behaviour. Fixture scenarios include the three v1.1 task examples, healthy work beside a failed package, awaiting approval, completion and disconnected last-known state. Live reads use the same view projections.

Pass when: three project bases and at least twelve fixture tasks remain selectable; selected identity/camera survive overlays; world/HQ/agent attention agree; Grill answer and repair navigation reach the exact task/stage; normal dependency waits do not inflate operator counts; previous runs remain historical; changing fixture state never calls a live endpoint. Selected blue feedback remains independent of amber/coral state. Active agents visibly work; finished workers do not accumulate runtime or continue work loops.

### M3 — one real local workflow and first-playable handoff

Deliver a minimal real task creation/start path, current-state refresh, Grill decision submission, artifact access, offline/reconnect handling and the full first-playable interaction test. Use a disposable repository and isolated companion store. Run one bounded actual Codex investigate-only task through a pending question/answer and specification completion; show recorded run IDs, policies, usage and artifacts. Use deterministic real-API fixtures to cover failure/repair and approvals that would otherwise require repeated paid work. If the model produces no questions, retain that valid result and verify pending-question behaviour through the deterministic API scenario; do not manufacture a real question event.

Pass when: browser actions persist through the real API and reload, one actual CLI-backed run has retained evidence, denied/stale actions do not mutate, network failure preserves drafts and reconnect does not replay old transitions. First-playable visual and interaction QA pass, relevant tests and both builds pass, and a measured baseline is saved. Deterministic fixtures must be reported separately from the actual model run.

End goal 1 here. Leave a working local preview, launch/resume commands in evidence, screenshots and known limitations. Ask Shaun to review game feel/fidelity and the world-to-work transition. Do not describe M4–M7 as completed or automatically mark the new designs approved.

### M4 — project/task management and policies

Deliver pages 02/03/05/06/07 with B1/B2, attachment/repository validation, profile/default inheritance, independent design-provider settings and future-role editing. Expand project administration and task closure/archive/cancel flows without conflating them. Keep task draft across navigation/errors; creation and start are separate.

Pass when: register/rename/archive/restore behave as specified through both store implementations; archive/create races are rejected correctly; task filters/search change results; creation snapshots every explicit and inherited policy exactly; no invalid override partially creates a task; completed/running role snapshots are immutable; repository authority and setup proposals are visible before their existing approval steps.

### M5 — complete task workflow and evidence

Deliver pages 08–17 and 24: research/scout evidence, Grill, provider-specific design retries, specification approval, dependency plans, dynamic implementation packages, candidate diff, P0–P3 review, tests/repair, final review, approval and PR reconciliation. Complete the A2 station/work props and justified transition motion. Preserve the adjacent task list/search route.

Pass when: all started stages are inspectable; unstarted future stages have no fabricated artifacts; 1/4/12-package layouts work; slice qualification and candidate integration are distinct; repair creates new candidate lineage and invalidates downstream gates; failed-provider retry retains siblings; a PR opening remains awaiting merge; only exact matching merge state yields completion. Use existing GitHub boundary mocks for deterministic publication/merge tests; do not push or open a real PR merely for UI QA.

### M6 — agents, skills, settings, usage and connection

Deliver pages 18–23 and 25 in full. Distinguish role catalogue from active runs and historical workers. Provide all supported policy controls, observed activity/context, task/run input/output/cached tokens, cache rate, task wall time versus aggregate run time, identified API-rate estimates, local camera/motion preferences and helpful reconnect/first-launch flows.

Pass when: saved defaults affect new tasks while history stays unchanged; design policy retries preserve provider snapshots; unavailable capabilities/charges are explicit; usage totals reconcile to test records; inactive/historical runs do not appear live; local display settings never stop backend execution; initial/offline/partial/stale/error/empty states are usable.

### M7 — complete-v1 qualification and handoff

Deliver full screen/state coverage, busy-world and accessibility checks, measured loading/frame/texture behaviour, clean production bundles, error handling and a release/rollback note. Apply fixes only to concrete findings; do not add v2 scope.

Pass when: every acceptance row below has actual evidence; relevant automated suites and both application builds pass; the protected Sites packaging is unchanged and passes its tests; no unresolved P0/P1/P2 visual/functionality issue remains; any P3 polish is explicitly listed. A clean install/build is reproducible from the lockfile, runtime assets have provenance, test-only tooling cannot mutate a live store, and the local preview is open. Preserve the existing frontend entry as the immediate UI rollback; do not automatically replace a running user's app or publish anything.

## 6. Screen-to-milestone coverage

Every screen also needs loading, empty, error, partial and unavailable states where applicable; an attractive default screenshot does not close the row.

| # | Catalogue ID / destination | First implemented | Full acceptance emphasis |
| --- | --- | --- | --- |
| 01 | `world` — World command centre | M2 | Cross-project scope, stable placement, attention, search, busy layout |
| 02 | `projects` — Projects | M4 | Counts/search, base/tasks/admin destinations |
| 03 | `project-setup` — Add a project | M4 | Register validated repository, retain inputs on failure, explicit setup approval |
| 04 | `project-base` — Project headquarters | M2 | v1.1 attention, dynamic task/package sites, healthy siblings |
| 05 | `tasks` — Task journal | M4 | Search/filter/date/scope, locate task, distinct lifecycle actions |
| 06 | `new-task` — Create a task | M3 subset; M4 full | Drafts, attachments, repository/profile/design choices |
| 07 | `task-policies` — Task execution & review | M4 | Defaults/overrides, provider separation, create then start |
| 08 | `task-workspace` — Task command | M2 subset; M5 full | Stage availability, candidate/packages, top next-action location |
| 09 | `research` — Research stages | M5 | Selected/skipped scouts, observed output, supplied context |
| 10 | `grill` — Decision room | M2 fixture; M3 live | Exact pending question/evidence; explicit answer; manual default |
| 11 | `design-review` — Design selection | M5 | Provider failure/success coexistence, retained retry policies |
| 12 | `specification` — Specification approval | M3 subset; M5 full | Rendered/raw artifact, exact current revision and approval |
| 13 | `plan` — Implementation plan | M5 | Dependency batches, scope/evidence; approval separate from start |
| 14 | `review` — Development review | M5 | Findings versus execution failure, repair lineage |
| 15 | `tests` — Tests & repair | M5 | Mixed results, drill-down/back, same-candidate retry versus repair |
| 16 | `approval` — Final review & approval | M5 | Journey evidence, fresh gates, exact candidate and operator action |
| 17 | `delivery` — PR delivery & completion | M5 | Open/merged/closed/drift identity, no early completion |
| 18 | `agents` — Agent roster | M6 | Current run instances versus reusable role catalogue/history |
| 19 | `agent-work` — Watch an agent | M2 | Running/needs-answer/repair, current versus previous run |
| 20 | `skills` — Skills & role policies | M6 | Read-only source, actual policy scope and eligibility |
| 21 | `settings` — Execution settings | M6 | Catalogue/allowlist, profiles, ordinary/design defaults |
| 22 | `world-settings` — World & connection settings | M2 subset; M6 full | Display-only effects, actual connection/updated metadata |
| 23 | `usage` — Usage & run history | M6 | Recorded totals, costs/availability, scoped pagination |
| 24 | `artifacts` — Evidence & diff viewer | M3 subset; M5 full | Wide readable viewer, raw source, file grouping, exact head |
| 25 | `connection` — First launch & reconnect | M0 subset; M6 full | Empty/offline/partial, restore drafts/current state |

## 7. Verification loop and evidence

For each coherent change: implement → run the narrow relevant checks → launch the assigned frontend/API → operate it through available computer-use tools → capture at the reference viewport/state → compare → fix → repeat affected checks. Keep progress updates concise and preserve concrete evidence between goal turns.

### Functional and integration checks

- Pure projection tests: all attention classes, old/unknown data, task/run disagreement, mixed packages, state age, missing prices, usage maths and stable world allocation.
- Refresh tests: delayed/out-of-order responses, selection switches, duplicate events, reconnect without replay, cancelled reads, bounded fetching and stale command responses.
- Real isolated API tests: policy validation/snapshots, archive/create concurrency, current eligibility, exact candidate identity, CSRF/origin and artifact/run pagination. Reuse current test injection patterns; mock external provider/GitHub boundaries, not the rules under test.
- Browser journeys: world/HQ/agent/decision return, create/configure/start, questions/approval, failed-run versus repair navigation, dependencies, wide diff, defaults/future policy, draft survival and keyboard-only access. Canvas picking, pan/zoom, occlusion and minimap must be exercised visually; DOM assertions alone do not cover them.
- The real CLI smoke is bounded to the disposable repository/store and one investigate-only task. Record whether it used actual model execution or injected test events. Missing authentication is a recorded integration blocker, not a reason to fabricate a passed run or ask for an API key.

### Commands

These existing checks are available now; choose focused tests while iterating and run the full required set at M3/M7 as applicable:

```sh
npm run typecheck
npm run lint
npm run format:check
npm test
npm run build
npm run test:sites
git diff --check
```

M0 introduces real runnable commands for the new entry: `npm run dev:frontier`, `npm run build:frontier`, `npm run test:frontier`, and `npm run test:frontier-api`. Prefer Node's existing test runner; pure `.ts` boundary tests can use supported type stripping on the pinned Node version. Add tooling only when a meaningful test needs it. Browser checks use the enabled computer-use surface and actual visible interactions; do not replace them with source-string assertions. Record exact commands and pass/fail/skip counts. Fix failures caused by this work; classify baseline failures separately rather than silently changing tests.

### Visual acceptance

- Source-size comparisons: selected world and both agent refinements are 1568×1003; HQ refinement is 1567×1004. Capture each matching state at its matching CSS viewport, then additionally check 1488×1058 desktop and 1280×720 compact desktop. A 390×844 check covers the safe list/overlay fallback, not a redesigned mobile world.
- Open the reference and current capture together. Evaluate composition, world/overlay balance, architecture/character fidelity, scale/spacing, type, contrast, occlusion, semantic state and actual action visibility. A screenshot existing on disk is not a visual pass.
- Reject a flattened scene, arbitrary generic game art, unlabelled sample data, unreadable text, misleading run motion or placeholders in the accepted milestone.
- No unresolved P0/P1/P2 visual or functional finding at the relevant gate. Keep P3 polish separate. Save a current `design-qa.md` with passed/blocked status, capture paths and concrete findings, plus milestone copies in build evidence.

### Proposed performance and scale acceptance

These are engineering targets for this plan, to measure and freeze at M1 on the actual target Mac/browser. If unattainable while preserving the visual target, report the measurement and tradeoff before changing the target.

| Scenario | Proposed check |
| --- | --- |
| Normal desktop | 10 projects, 100 open tasks, up to 30 visible workers; 60-second camera/selection run after warmup; median >=50 fps and p95 frame interval <=33 ms on a 60 Hz display |
| Stress world | 50 projects, 1,000 task summaries, up to 60 visible workers through grouping/culling; all tasks/attention reachable in search/list, no fixed occupancy cap or overlapping decision controls |
| Input | Selection/HUD acknowledgement p95 <=100 ms; server-dependent outcome is a separate measured latency |
| Repeated navigation | 20 world/HQ/detail round-trips; live texture count returns to a documented cache bound, no increasing listener/ticker count, no retained object leak |
| Loading/assets | Initial world payload target <=20 MiB and decoded resident textures <=192 MiB; detail assets loaded on demand. Record actual compressed bytes and texture dimensions/mipmaps separately |
| Background/reduced motion | No unnecessary hidden-tab work loop; reduced motion preserves all operational information and controls |

Use existing observed backend records or deterministic fixture builders for load, never create hundreds of real paid tasks for performance testing. Polling metrics include requests, payloads and response times; raw event throughput is not an invented model-speed metric.

### Evidence files

At build start create `build-evidence/progress.md` with milestone statuses, baseline, current owner, test mode, next action and unresolved risks. Add `M0/`…`M7/` records with test outputs, captures, state/source identity, asset IDs/checksums and measured results. Keep only evidence needed to assess the milestone. Update the screen matrix with evidence links instead of declaring all screens complete from one screenshot.

On compaction/resume, re-read the plan and progress, inspect the actual worktree, and continue the next incomplete acceptance item. Preserve completed work. A goal may complete only when its stated milestone range has passed; a budget or a final message is not acceptance evidence.

## 8. Runtime isolation, rollout and rollback

- Inspect listeners, PID command/cwd and store ownership before starting a companion. `scripts/dev.mjs` starts both the default API and Vite on fixed ports; do not launch it blindly beside a running user runtime.
- For this build's verification set distinct `AGENT_HARNESS_PORT`, `AGENT_HARNESS_DATA`, `AGENT_HARNESS_DATABASE` and `AGENT_HARNESS_REPOSITORY` to newly created disposable locations. Set `AGENT_HARNESS_API` for the frontend proxy. Record exact values and start/stop commands. Never acquire a second runtime lock on the user's database or edit `.data` to fabricate states.
- A configured HTTP origin is exact, loopback-only and covered by tests. Connecting to a different origin is not solved by disabling CSRF or weakening the backend boundary.
- Build requests authorize implementation and verification inside this project/disposable fixtures. They do not authorize pushing branches, raising/merging real PRs, deploying to Sites, or altering unrelated repositories for a demonstration.
- Local game preferences use namespaced/versioned storage. Draft persistence excludes secrets and binary attachments; keep sensitive attachments transient and reconstruct only with explicit user input. No new cloud persistence is required.
- Backend additions are optional/backward-compatible fields with legacy defaults and preserved export. Before running changed store code against real data, retain an export/backup and verify migration/rollback on a copy. UI rollback selects the old entry; data rollback is a separate verified procedure, never an automatic overwrite with stale JSON.
- The existing Sites package remains an unchanged UI artifact. Any future hosted Frontier artifact uses explicit demo mode; a hosted page does not gain local repository execution. Publishing is separate work after local qualification.

## 9. Risks and decision triggers

| Risk | Containment / decision trigger |
| --- | --- |
| Inconsistent art across views | A0/M1 calibration before mass production. Two corrective attempts for a concrete asset mismatch, then report evidence and a new approach; no silent art-style downgrade. |
| Generated animation flicker/registration | Prefer registered parts/tool motion, test actual playback; require a credible locomotion asset before depicting a walking robot. Do not slide a humanoid to imply a walk. |
| World obscures operational work | Shared attention + readable DOM overlays, keyboard/search parity and dense-world tests at each affected milestone. |
| Existing runtime differs from snapshot | M0 reinspection; list the smallest required plan correction with its source. Do not revive outdated API or model assumptions. |
| Missing or external event stream | Polling adapter works independently; streaming adoption needs a verified transport, IDs, order, replay and reconnect contract. |
| Backend additions grow into redesign | B0–B3 are the bounded additions. New business concepts, repo replacement, generic skill installation or arbitrary workflow control require separate scope. |
| Asset agent and builder conflict | Dedicated staging ownership, immutable accepted IDs/revisions, coordinator-controlled integration. A subagent cannot change renderer conventions or app files. |
| Unlimited refinement | Fix observed acceptance failures, stop at the stated goal milestone, retain P3 notes. Ask only for a material unresolved product/asset tradeoff. |

## 10. Sources

- Local implementation inspected on 6 September 2026: `package.json`, `vite.config.mjs`, `src/api.ts`, `src/App.tsx`, `src/domain/runtime.ts`, `server/index.mjs`, `server/http-security.mjs`, `server/project-routes.mjs`, `server/task-creation-routes.mjs`, `server/task-projections.mjs`, `server/retry-admission-policy.mjs`, both store implementations and `tests/api-contract-characterization.test.mjs`.
- [PixiJS architecture](https://pixijs.com/8.x/guides/concepts/architecture), [render loop](https://pixijs.com/8.x/guides/concepts/render-loop) and [performance guidance](https://pixijs.com/8.x/guides/concepts/performance-tips), retrieved 6 September 2026. The application choices and budgets above are this plan's engineering recommendations, not PixiJS guarantees.
- [Official OpenAI guidance on long-running work](https://learn.chatgpt.com/docs/long-running-work), retrieved 6 September 2026: durable outcome, constraints, verification and milestone records inform the execution prompts. Goal mode does not grant broader permissions.
