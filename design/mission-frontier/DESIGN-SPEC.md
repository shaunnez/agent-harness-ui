# Mission Frontier — interaction and screen design

Status: v1.1 design refinement. The user accepted the core world/overlay balance, entity mapping and agent controls. The current refinement clarifies waiting and blocked work in headquarters and agent views. Execution is specified separately in [IMPLEMENTATION-PLAN.md](IMPLEMENTATION-PLAN.md); this file does not claim a product build is complete.

## 1. Product direction

A strategy-game world is the primary way to oversee software work. Each project has a base. A task has a visible work site and an identifiable crew. Selecting a worker reveals what it is doing; selecting the task opens its brief, steps, evidence, and next action.

The player is a commander using selection, camera movement, and contextual actions. Walking an avatar to a terminal is not required. Creating tasks and making decisions must remain quick even when the world is large.

Forms, documents, configuration, and code use focused work overlays. Closing an overlay returns to the same camera, selected project, and task. Opening an overlay does not stop backend execution.

The user accepted the world-plus-overlays interaction and the project/base, task/crew and run/worker mapping. The selected visual target is `reference/selected-world.png`; detailed screens extend that direction. Building placement, persistent agent names, upgrades and unlocks are deferred to v2.

## 2. Navigation

Primary destinations: **World, Projects, Tasks, Agents, Skills, Usage, Settings**.

- World is the default destination and remembers the last camera and selection.
- Projects opens the base directory. Enter base changes the world camera and project scope.
- Tasks opens a searchable journal. Inspect task opens the task workspace; Locate in world returns to its crew.
- Agents opens current run instances, a role catalogue, and run history. Watch agent follows a selected run.
- Skills describes capabilities and their role-policy controls.
- Usage shows recorded tokens, time, estimates, and run history.
- Settings separates execution defaults from local game preferences and connection information.

A compact HUD and command menu provide every destination. Deep links can open any project, task, run, artifact, or settings section directly. A world action and a journal action open the same underlying task state.

### Camera and selection

- Drag empty terrain to pan; scroll/pinch to zoom; arrow keys offer keyboard panning.
- Click a base or worker to select; repeat selection or Enter opens its contextual inspector.
- Enter base and Watch agent are explicit commands; Space follows the selected crew.
- Escape closes the topmost overlay, then selection. It never cancels an agent run.
- A selection ring is blue. Amber and red identify decisions and blocked work independently of selection.
- Minimap clicks move the camera. Project search and task search provide a non-spatial route to everything.
- Camera rotation/tilt shown incidentally in an image is exploratory, not an accepted requirement; the baseline design uses the selected isometric view with pan and zoom.

Suggested shortcuts: G World, P Projects, J Tasks, A Agents, K Skills, U Usage, comma Settings, / Search. Shortcuts do not fire while editing text or when a dialog owns the relevant key.

## 3. World semantics

| Visible object | Product meaning | Selection opens |
| --- | --- | --- |
| Project base | A registered repository | Project headquarters and management |
| Task work site / labelled crew | One persisted task at its current stage | Task command workspace |
| Active worker | A recorded active run, or a specifically identified running package | Run inspector / Watch agent |
| Role portrait | A reusable capability, not a currently running worker | Role catalogue and defaults |
| Artifact capsule | A retained artifact or handoff | Read-only artifact viewer |
| Decision beacon | A persisted state requiring an operator response | Exact pending decision |
| Repair beacon | A task-level failure/blocker | Failure evidence and eligible recovery |
| Delivery pad / shuttle | Candidate publication and merge state | Approval or PR delivery status |

Unlabelled environmental activity is atmosphere. It never contributes to worker counts, task counts, progress, or usage. Active crews are keyed by backend task/run/package identity; changing models does not create a new fictional employee.

The world has two camera scales: an all-project overview and a project headquarters. At distance, show project identity and aggregated attention. Zooming reveals task crews. Dense occupancy becomes a count with a drill-down; overlapping labels never hide a decision.

The number of project bases and task work sites is dynamic. No fixed three-project or four-package product limit is implied by the examples. World layout is deterministic and stable; adding a project should not shuffle existing bases. The exact layout algorithm and rendering technology belong to the later plan.

### Activity and truthful motion

- Ambient water, foliage, and gentle machinery may loop independently of work.
- Strong worker animation requires a currently active run/package.
- A stage advance or artifact handoff may trigger a short movement after persisted state confirms it.
- Initial load and reconnect place objects at current state; do not replay old events as new work.
- Failed or blocked tasks stop their own work animation. Other tasks in that base continue normally.
- A lost connection softens worker activity and shows last-known state plus last update time.
- Completed delivery is shown only after the backend reports completion following the matching PR merge.
- Pausing visual motion or changing audio has no effect on backend execution.

## 4. Visual system

### The game loop and scene design

The recurring play loop is **establish a base → brief a task → configure its crew → dispatch → observe work → resolve decisions → review the delivery → launch after confirmed merge**. These are direct product actions. There is no resource grind that delays task work and no need to walk an avatar to reach a control.

The world is continuous, not a tiled board of dashboard cards. At overview scale, project bases are landmarks with project names and attention counts. Selecting a base changes the contextual HUD; Enter base moves the camera to its working campus. Each active task owns a labelled site or crew within that campus. A selection ring identifies the task independently of its stage or health.

Functional stations have a consistent physical vocabulary across projects:

| Task stage | Scene identity | What selecting it reveals |
| --- | --- | --- |
| Triage | Intake beacon and briefing console | Scope classification, risk and pending triage output |
| Repository scouts | Survey drones and scanning station | Selected scouts, observed repository evidence and synthesis |
| Grill | Communications terminal with an amber decision beacon | The next unanswered question and its repository evidence |
| Optional design | Projection workshop | Retained provider variants and the design decision |
| Task specification | Blueprint desk | Specification, recorded provenance and approval |
| Implementation plan | Assembly planning table | Dependency batches, ownership and verification |
| Implement | Modular fabrication workbenches | Dynamic package crews, qualification and candidate assembly |
| Development review | Inspection gantry | Candidate-bound findings and review outcome |
| Test | Diagnostics rig | Passed, failed and skipped checks with drill-down |
| Final review | Delivery inspection console | Full-journey evidence and current gate freshness |
| Human approval / PR delivery | Launch pad and cargo shuttle | Exact candidate approval, retained PR and merge state |

Stations are visual identities, not an obligation to draw eleven large buildings for every project. A small project uses a compact compound; selected tasks reveal the relevant work area. Implement expands into multiple workbenches only when persisted packages justify them. Dense scenes group inactive work while keeping every pending decision directly reachable.

**Selection HUD:** task identity and title; stage and state; active role/model/effort; recorded usage; Inspect task; Watch crew; the exact next eligible action. No selection shows compact global navigation and attention. A worker selection shows its run and package instead of a second independent task state.

**Attention queue:** an amber/red world control lists pending questions, approval requests, failures and blocked tasks. Selecting an item focuses its site and opens the relevant decision. Read/acknowledged presentation never changes backend task state. The same queue is accessible from the task journal.

**Motion:** a brief selection-ring response and camera ease communicate selection; working robots use role-specific loops, such as scanning, typing, assembling or inspecting. A persisted artifact may appear as a labelled capsule. A confirmed stage transition moves the task's crew toward the next station once, after state reconciliation. Progress percentages are never derived from animation duration. The final shuttle launch follows confirmed completion and remains optional under reduced motion.

**Feedback and progression:** new projects add new bases; concurrent packages populate more workbenches; retained outputs make a task's handoffs inspectable; completed deliveries appear in project history. This is the visible record of real work. Cosmetic appearance and audio can add playfulness without altering execution capacity, model quality, cost or permissions. No fabricated XP, agent level, speed-up currency or success rating is part of this v1.

**World edge cases:** unknown state uses quiet machinery and an explicit last-update marker; blocked workers stop only their own loop; reconnect positions crews immediately at current state; large task counts use stable groups and a selectable list; keyboard selection and search provide the same actions as mouse selection. No decorative object should look like an actionable task unless it has a real task identity.

The reference establishes ceramic white bases, dark structural metal, slate roads, bright blue water, purple vegetation, warm daylight, and friendly mechanical workers. Keep physical architecture coherent across overview, headquarters, and agent close-ups.

Work overlays use a quiet dark blue/teal surface with readable near-opaque content. The world remains visible around the edges. Blue owns selection and primary actions, amber owns pending human input, coral owns failures, and muted green owns verified success. Labels and icons accompany state colour.

Suggested foundations for refinement:

| Token | Value / intent |
| --- | --- |
| Reading surface | `#071923` |
| Secondary surface | `#102734` |
| Border | `#29404F` |
| Primary text | `#EFF5F8` |
| Secondary text | `#AFBEC8` |
| Primary action | `#286DD0` |
| Selection | `#57B0FF` |
| Decision | `#E8B454` |
| Failure | `#EF7772` |
| Success | `#85BE9C` |
| Body / controls | 15–16px, Inter-like sans serif |
| Metadata | 12–13px minimum |
| Page title | 24–28px |
| Control height | 40–44px; primary actions 44–48px |
| Panel radius | About 10px; minimal ornamental framing |
| Spacing rhythm | 4 / 8 / 12 / 16 / 24 / 32px |

Use one scroll owner within a long overlay and a fixed action area. Documents have a comfortable reading width; diffs can expand to nearly the full viewport. Do not make every datum a card. All generated sample numbers and copy require a consistency pass before final build specification.

## 5. Screen catalogue and interaction contracts

### 01 — World command centre

The selected reference. All projects and their attention signals are visible in the game world. Selecting a task opens its small HUD: task identity, actual stage, current worker, usage, artifact shortcuts, Inspect task, Configure eligible roles. New task is available without entering a base. World and Tasks are adjacent entry points. A task waiting for approval appears at delivery, with approval status rather than a completed animation.

Variants: nothing selected; crew selected; many tasks in a base; many projects; needs input; blocked; last-known state; completed task retained in history. Project filtering changes the displayed world and its scoped counts together.

### 02 — Projects

Searchable directory with project identity, repository, active tasks, attention, and last activity. Selecting a row opens a summary. Enter base is primary; View tasks and Manage project are secondary. Counts in the list and inspector derive from the same selected project.

Variants: no projects with Add project; loading without fake bases; failed load with Retry; empty search; suggested repository distinguished from a registered project. Archived projects remain discoverable if project archiving is adopted.

### 03 — Add a project

Repository and Review steps. Required: display name and absolute repository path. Validate repository reports what was actually discovered: repository root, branch/head, instructions, verification contract, delivery target. Registering a project and approving repository setup are separate actions.

Review shows the exact repository and any proposed file/command changes before Approve setup. Add project registers the project; a base appears only after successful creation. Local appearance is cosmetic and scoped to this device until broader persistence is agreed.

Variants: empty fields; validation in progress; invalid/non-Git path; duplicate repository; unavailable path; valid repository; setup proposal; registration failure with fields retained. No repository is created, cloned, deleted, or pushed by the Add project flow.

**Project management variant:** opened from Projects or headquarters, using this form anatomy. Name is editable. Repository identity is read-only after work exists; connecting another repository is a new project. Sections: Overview, Repository readiness, Appearance, Archive. Archive project explains whether active tasks prevent the action and that repositories/history are retained. Rename/archive backend support is a documented gap, not an existing capability.

### 04 — Project headquarters

A close camera on one base with all that project's current work. Task crews occupy appropriate functional areas. A compact project summary exposes repository readiness, scoped task list, and project settings. Needs-input controls open the actual pending task question. Watch crew and Inspect task are available from a selected work site.

Variants: empty project with Create first task; several simultaneous implementation packages; a blocked task alongside healthy tasks; project unavailable. A project-wide red state is not inferred from one failed task.

**v1.1 attention refinement:** task-attached beacons show stage and a specific waiting/blocked label. A compact Needs you list contains only tasks with a current operator action; dependency waits and ordinary PR polling do not inflate it. Selecting a beacon fills the task HUD with the recorded reason, next actor, state age when known, and a specific action such as Answer question or Review findings. The revised study shows Grill awaiting an answer, Dev review requiring repair, and Implement running with a dependent package waiting. See `ATTENTION-CONTRACT.md` for every stage and the distinction between task state and worker state.

### 05 — Task journal

Search, project, stage, and status filters affect rows and counts. Tabs separate Active, Needs input, Completed, Closed, and Archived. Rows show identity/title, project, stage, status, actual run policy, tokens, elapsed, and updated time. Sorting is explicit. Inspect task is the default row action; Locate in world restores spatial context.

Task menu contains only currently eligible lifecycle commands. Cancel run confirms the running task and consequences; Close task requires a reason such as not needed, duplicate, or superseded; Archive explains retained history and worktree handling. These are distinct from successful completion.

### 06 — New task: brief

Draft-first. Required title, description, and project; optional attachments; priority; workflow Investigate only or Investigate + implement; Auto/Fast/Standard/High-risk profile; optional design generation. Title and description start empty with examples as placeholders. Only operational defaults are preselected.

The right summary describes the planned stopping point. It shows no completed stages, prior evidence, or active agents. Investigation-only stops with specification/evidence and does not create a code patch. Next opens agent setup while retaining the draft.

Variants: invalid fields, unsupported attachment, repository readiness failure, partial attachment upload, no projects, dirty draft close confirmation. No task exists until final creation succeeds.

### 07 — New task: agent setup and review

A role/skill matrix shows profile defaults, allowed model, supported effort, and override source. The policy scope is this draft. Child scout roles currently share their coordinator policy. Human approval and deterministic harness work have no model picker.

Review repeats the exact title, project/repository, workflow, profile, attachments, design choice, and overrides. **Create task** is the final action. Success enters a queued task with a clear Start task action; creation and starting are separate.

Per-role overrides at creation need an explicit backend contract addition. Until that exists, a UI must not show apparently saved per-role choices that are ignored by POST /api/tasks. See backend coverage.

### 08 — Task command

The universal task workspace. Header: identity, project, status, current stage, current next action. A compact internal journey rail distinguishes completed/past, active, future, skipped, and stale stages. It is task navigation, not the old global sidebar.

Implement's main canvas shows dependency batches, package states and the currently selected package. Expand running, failed, blocked or selected packages; keep healthy completed rows quiet. One-package tasks use a single compact delivery slice. Package qualification is labelled Ready for integration. Candidate identity appears only after assembly exists.

The right inspector shows task brief, selected versus active stage, role/skill/model/effort, context, repository authority, safeguards, and usage. Evidence and Activity remain one click away. Selecting a previous stage opens retained evidence without changing active execution. Future stages cannot present recorded evidence.

**Package drill-down:** header package ID/title/status; owned paths; dependencies; run and attempt; commands; observed tool activity; changed files; qualification result; commit; retry/continue only when eligible. Breadcrumb Back to packages remains visible. A complete candidate diff is distinct from a package diff.

### 09 — Triage and repository scouts

Triage uses the same task workspace with risk/profile outcome, scope classification, selected/skipped scout rationale, and repository evidence. While running it shows observed activity and pending output, not a fabricated conclusion. The completed report is read-only and linked to its run.

Scouts shows the selected code path, dependency, pattern, schema, test inventory and user journey set. Each selected run can be inspected; skipped scouts have a reason. A coordinator synthesis appears only when retained. Context supplied and repository access are separate information.

### 10 — Grill / decision room

One question at a time, repository evidence first, then suggested options and concise recommendation rationale. Operator can choose a different option or write an answer. Record answer & next is explicit. Prior answers, remaining questions and decision provenance remain visible.

Accept remaining recommendations is a separate deliberate action with the remaining question count. Auto-accept is a settings opt-in and task snapshot; the screen labels recorded automation provenance when present. Zero-question sessions display that outcome without forcing a fake answer.

### 11 — Task design review

Optional subflow after Grill and before specification. Provider-labelled variants retain their model/effort, prompt/context, revision and preview. Compare, open full preview, select, request a revision, approve, or explicitly skip. A failed provider does not discard a successful sibling. Retry targets the failed direction with its original policy.

The page does not imply that a selected screenshot is already implemented. Later revisions make affected downstream design-dependent evidence stale.

### 12 — Specification

Rendered, read-only specification with source view and provenance. Outcome, scope, acceptance criteria, dependencies, risks and verification are clear. Approval is in a fixed command area. Request changes collects feedback; exact available behaviour depends on the backend command contract. No accidental approval from closing the viewer.

States: generating, awaiting approval, approved, changed/superseded, regeneration failure. An investigate-only task can conclude here with evidence and an explicit Continue to implementation option when supported.

### 13 — Implementation plan

Dependency batches with drillable package ownership, interfaces, checks, role policy, and repository authority. Planned packages are not presented as executing. Approve plan is distinct from Start implementation. Target changes show revalidation needs and retain the captured plan for audit.

States: generating, awaiting approval, approved/ready to start, stale target, already satisfied, plan correction needed. No speculative cost estimate is shown without an agreed estimation basis.

### 14 — Development review

Candidate-bound verdict and P0–P3 findings. Each finding includes concrete impact, file/line, recommended correction and retained evidence. The reviewer is a fresh-context run. The implementation self-score is not the independent verdict.

Repair actions show the affected candidate and downstream gates. Review tooling failure has a separate retry path from a confirmed code defect. Previous review revisions are retained and visibly stale where applicable.

### 15 — Test and repair

Mixed result list with counts, commands, duration and explicit skipped reasons. Selecting a result opens logs/assertions with Back to results. Global retry/repair actions sit outside individual test details.

Use Retry test on same candidate for an eligible execution retry. Use Return to Implement for a code repair. A new candidate revision invalidates affected review/test/final verdicts; the screen explains what will rerun. Exhausted allowances, missing evidence and stale identity have explicit reasons and supported next actions.

### 16 — Final review and Human approval

Final review synthesizes the full journey and current candidate. It can be running, passed, repair required, or unavailable; it cannot stand in for the human decision. Stage rows show meaningful outcome, actual tokens/time, and current/stale/not-required state. Unsupported pricing is explained once.

Human approval follows a passed current final review. It shows the exact candidate/revision/head, project, target branch, gate freshness, diff and approval note. Primary action is **Approve & raise PR**. The server revalidates identity and eligibility. A changed candidate returns to review rather than publishing silently.

### 17 — PR delivery and completion

States: opening PR; Awaiting PR merge; closed unmerged; identity drift; merged; completed. Awaiting merge displays retained PR identity, exact approved head, latest check time and Open PR. A closed-unmerged or changed-identity PR retains evidence and gives the supported recovery.

Completed changes the delivery state only after the backend confirms the matching merge. Then show the real completion time, journey, usage, retained artifacts, Return to project and Archive. A brief optional shuttle departure is feedback for completion, never its source of truth.

### 18 — Agents

Active runs, Role catalogue and Run history are separate tabs. Active rows identify task/project/package, actual role/skill, model/effort, status and usage. Watch agent focuses the world camera; Inspect task opens the workspace. Historic agents remain inspectable after their visual crew leaves the world.

The role catalogue configures defaults for future work. It is not a hiring screen. No invented productivity ratings, permanent personalities, availability guarantees or success percentages.

### 19 — Watch agent

Follow a worker in the world while its side panel shows actual observed Activity, Output and Context. Show tool commands/results, artifacts and errors supported by retained run data. Do not synthesize a hidden reasoning transcript or claim to stream unsupplied output tokens.

Run configuration is read-only once started. Configure future roles leads to an explicitly scoped editor. Usage distinguishes input, cached input, output, cache rate, elapsed, credits if recorded, and Approx. cost if supported. Permissions and supplied context have separate labels.

**v1.1 attention refinement:** a fixed region above Activity/Output/Context shows the task's stage, reason, required actor and next eligible action. The selected run's state appears separately. For example, a completed Grill run can leave the task waiting for an answer; a completed review run can leave the task requiring code repair. Both workers are parked, with their recorded runtime frozen. The gallery retains Running and adds Needs your answer and Repair required design states. A repair action explains candidate revision and gate consequences before execution.

### 20 — Skills and policy

Capability catalogue with purpose, input/output contract, execution boundary, source/provenance, relevant roles and observed run history. Global model/effort defaults are editable per canonical role/profile. Skill instructions themselves are read-only unless a future editing contract is approved.

Task-specific policy editing shows task and eligible future role, current versus proposed policy, and confirmation. Started roles stay locked with a reason. Model/effort choices come from the catalog and allowlist; unsupported historical policies remain visible as historical facts.

### 21 — Execution settings

Sections: allowed models and defaults; profile/role matrix; Grill interaction; design generation. Save affects new tasks and retains existing task snapshots. Unsaved changes, validation, catalog refresh failures and save failures preserve local input.

Design generation selects one eligible model/effort per provider independently of stage policies; retries retain task snapshots. Deterministic stages and operator-owned gates do not acquire a model merely to fill a table cell.

### 22 — World, connection and storage settings

Local preferences: label size, camera sensitivity, follow selection, reduced motion, ambient/effect audio. Audio defaults off. Visual pause or camera settings never change task execution.

Connection shows actual backend reachability, last check, provider/catalog status, Refresh and diagnostic help. It does not request an OpenAI API key for ChatGPT-authenticated Codex execution. Worktree inventory and retained-artifact controls identify exact task-owned copies; removal is a separate guarded action. World preferences are local until an explicit persistence contract exists.

### 23 — Usage and history

Filters by project/task/run/model/date, recorded tokens with cache discounts, actual timing, attributable charges labelled unavailable, and Approx. cost / API-rate estimate. Distinguish task wall time from summed agent runtime because packages can run in parallel. Unknown is not zero.

Comparisons use recorded gate quality, repair count, tokens/time/credits and human evaluation where available. No quality verdict is derived from cheapness or completion alone. A frontend export can contain the currently retrieved records with its scope and completeness stated.

### 24 — Evidence and diff viewer

Wide read-only rendered Markdown, raw source, file-grouped syntax-coloured unified diff, test evidence and context manifests. Candidate and revision are fixed in the header. Historical artifacts are clearly dated and stale when applicable. Large content has local scroll and explicit truncation information. Return preserves the originating task/stage.

Context shows supplied sources, sizes/truncation and repository permission. It makes no claim about which supplied text the model actually used. Opening an artifact never runs its contents.

### 25 — First launch and reconnection

First launch: connect companion → add project → create task. An empty landing pad conveys an unpopulated workspace. No fake agents or successful account checks. A labelled demo world is optional and never mixed with real records.

Reconnect keeps last-known state and unsent drafts, displays last update, pauses strong execution animation, and offers Retry. Reconnect resynchronizes current state before re-enabling mutations. Failed/partial reads explain their scope instead of blanking unrelated evidence.

## 6. Shared modal and state patterns

| Pattern | Content and action |
| --- | --- |
| Cancel run | Task, run/stage, what stops and what evidence remains; Confirm cancel |
| Close task | Reason, optional note, optional superseding task; Close task |
| Archive task/project | What becomes hidden, retained history, active-work eligibility; Archive |
| Policy change | Scope, current/proposed model and effort, affected future role; Confirm change |
| Repository setup | Exact proposed files/commands/repository, separate review and approval |
| Candidate approval | Exact task/candidate/revision/head/target; Approve & raise PR |
| Stale operation | Explain what changed, keep draft, Refresh and review again |
| Missing telemetry | Not recorded / Unavailable with specific reason; never fill with zero |
| Long artifact | Local scroll, source navigation, truncation state and return path |
| Search empty | Preserve query and filters, clear filters action, no false zero workspace |

All mutations show pending state and preserve user input on errors. A repeated click does not create a second logical request. The later implementation plan must resolve the backend's exact idempotency/concurrency mechanisms; this design does not assume every representative contract in old documentation is implemented.

## 7. Accessibility and responsive behaviour

The desktop reference is 1600 × 1024, with a useful 1488 × 1058 presentation. World labels and overlay content remain legible without zoom. Every world action has a keyboard/list equivalent. Focus stays in the active overlay and returns to its launcher. Escape affects only the topmost layer.

Selected, running, waiting, blocked, completed and stale use text/icon differences as well as colour. Reduced motion suppresses travel, camera easing and attention pulses while retaining immediate state changes. Data controls can use a higher-contrast opaque reading mode.

At narrower desktop widths, inspectors become temporary full-height sheets and tables retain sensible column priority or local horizontal scroll. On small screens, Tasks/Projects and focused overlays provide a usable fallback; the full game world is a desktop priority. No separate phone redesign is part of this pass.

## 8. Topics for design refinement

- The world/overlay balance, entity mapping and policy controls are accepted as the v1 foundation.
- Building placement, persistent agent names, upgrades and unlocks belong to v2.
- Current review focus: whether the revised headquarters and agent attention states make the stage, reason, actor and next action immediately clear.
- Should project management expose archiving in the first release, or only registration/readiness/appearance?
- Are independent child-scout policies required, or is the current shared coordinator policy acceptable?
- Which map and detail densities feel comfortable on the user's normal desktop?

These are review topics, not permissions or a build plan. User edits to the screen set come next.
