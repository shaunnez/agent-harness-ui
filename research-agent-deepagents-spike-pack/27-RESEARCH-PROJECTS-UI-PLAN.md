# Plan: research projects in the harness UI

23 September 2026, against `main` at `d73d790` (PR #128 merged: `codex-cli` runtime, Settings →
Research agent). This is piece 3 of `25-NEXT-CODEX-SETTINGS-RESEARCH-PROJECTS.md`. It follows
`19-RESEARCH-PROJECT-PROTOTYPE-PROMPT.md`, corrected for what has changed since it was written, and
is the handoff to read first after compaction.

**Goal:** a person creates a *research* project, sees it as its own building in the world, asks a
costing question, watches the agents work, and reviews the answer: band, the three runs, which
citations checked out, and what could not be established. Then approves or rejects it, pinned to
the evidence it saw.

**Estimate:** 2½ to 3 days of build across four slices, each ending in a browser check. No paid
runs until the very last step, which needs a separate go-ahead.

**Status, 23 September:** decisions answered (three runs plus Quick; engine from Settings; fixture
mode first; screens reviewed first), except that research projects use the existing **Relay** base
for now instead of a new observatory. A clickable prototype of slices B–D is built in the real
Frontier app, sample world only (`npm run dev:frontier`, `?mode=fixture`): two research projects
from the recorded results (30 Opus scopes, 7 Codex scopes), the dock, question list, question
detail, review pinned to the evidence fingerprint, the ask form, and a Research choice in Project
setup. No backend, no live project, no model call. Slice A waits on review of the prototype.

**Slice A built, 23 September** (branch `claude/research-projects-backend`, stacked on PR #131).
Projects carry `kind` (saved projects read as delivery; a research project stores the sentinel
`research://<id>` and every delivery route refuses it). `research_questions` and `research_reviews`
tables, `question_id`/`run_label`/`outcome_json` on `research_runs`, and `POST/GET
/api/research/questions`, `GET /api/research/questions/:id`, `POST .../:id/review`. A question
starts 1 or 3 runs through `createRun`; its status is computed on every read from
`agreementForRuns`, so a failed, cancelled or plan-limited run makes it `incomplete`. Each run keeps
its cost band and per-component citation check (`citations.mjs` now labels each component by its
weakest citation; no check is `unchecked`, never a pass). An external `source` (provider +
request id) reuses its question. Reviews are pinned to a sha256 over the record minus the review
and activity, and nothing happens downstream of one. The live Frontier gateway serves all of it,
Project setup offers Research when the companion serves research, and running questions reread
every 5 s. Tests: `tests/research-questions.test.mjs` (stub runtimes, nothing spent). Browser
check on the isolated 4331/5174 pair: a live research project created on Relay, its empty question
list and the live ask note. **No live question has been asked**: that needs Shaun's go-ahead
(about $4–5 of Claude plan usage for three runs).

---

## Decisions to confirm before building

| # | Question | Recommendation |
|---|---|---|
| 1 | What is one "question": one run or three? | **Three runs by default.** Three-run agreement is the only verification we have (`trio.mjs`, `agreement.mjs`), and a single band cannot say "disputed". Offer a *Quick (1 run)* option that is labelled as unverifiable. |
| 2 | Which engine answers? | **The Settings → Research agent choice** (Claude CLI / Opus 5.5 by default), snapshotted per run, as built. |
| 3 | The 30 recorded results (`18a-review-feed.json`) | **Fixture mode now** (`?mode=fixture`), so every screen can be reviewed with real data and no spend. Optionally, a one-time import into a live "Top-30 pilot" project later. |
| 4 | Visual design | **A quick mock of the two main screens** (question list, question detail) in the existing Frontier style, approved before slice C is built. Everything else reuses existing windows. |

---

## What exists and what changed since doc 19

- **Research engine:** `server/research/claude-cli/` and `codex-cli/`, on the operator's plans only.
  Doc 19's Deep Agents / `RESEARCH_MODEL_API_KEY` / silent-fake section is obsolete.
- **Model choice:** Settings → Research agent is built (`src/frontier/views/ResearchSettings.tsx`),
  so doc 19 §5 is done.
- **Run records:** `research_runs` (`server/research/research-schema.mjs`) still has **no
  `projectId`**, and no concept of a question grouping three runs. `GET/POST /api/research/runs`
  exist (`research-routes.mjs`).
- **Projects:** `RuntimeProject = {id, name, repositoryPath, createdAt, archivedAt?}`
  (`src/domain/runtime.ts:850`), created by `createProject({name, repositoryPath})`
  (`server/project-routes.mjs`, `src/api.ts:216`, `runtime/contracts.ts:73`).
- **Buildings:** `baseVariants = ["bastion","command","relay","foundry"]`
  (`world-3d/appearance.ts:5`), balanced across projects by `chooseProjectAppearance`.
- **Windows to reuse:** `AgentActivity` (takes `RuntimeEvent[]`), the overlay host
  (`app/OverlayHost.tsx`, one `overlay.kind` per window), `BaseSelection` dock, `Projects`,
  `ProjectSetup`.
- **Real data for the review screens:** `18a-review-feed.json` (30 records: `status`, `range`,
  `consensus`, `agreement`, `currency`, `gst_basis`, `centre`, `as_of`, `basis`, `runs`,
  `qv_sources`, `web_sources`, `open_questions`, `review`, `record_sha256`), `18b-review-index.json`,
  and `18c-ask-feed.json` (three worked customer questions).
- **New since doc 19**, and needed on screen: checked citations per component (`quoteVerified`,
  snapshot, `verification.notes`), allowances (`basis: "allowance"`), retained sources by PDF page
  in `.data/research-sources/`, and the `incomplete` and plan-limit states.

---

## Slice A: the backend (about ½ day)

1. **Project kind.** `kind: "delivery" | "research"` on `RuntimeProject`, defaulting to
   `"delivery"` for every existing row (a store migration, like `researchPolicies`). For
   `research`, `repositoryPath` is optional and never validated. Delivery-only routes (new task,
   onboarding, worktrees) refuse a research project by id.
2. **Questions.** A `research_questions` table: `id, project_id, objective, profile, runs_planned,
   created_at, status`, with `question_id` and `project_id` columns on `research_runs`. The service
   gains `askQuestion({projectId, objective, profile, runs})`, which creates the question and starts
   its runs through the existing `createRun` (so each run keeps its own Settings snapshot).
3. **Question result.** The status comes from `agreementForRuns`: agreed, disputed,
   not_established or incomplete, with plan-limit failures counted as incomplete and never as
   "found nothing". The response is shaped like an `18a` record, so the UI has one record type for
   both fixture and live data.
4. **Reviews.** A `research_reviews` table: `question_id, decision (approved|rejected), note,
   reviewer, decided_at, evidence_sha256`. The hash covers everything but the review, as in 18a,
   and a review whose hash no longer matches is shown as out of date.
5. **Routes.** `POST /api/research/questions`, `GET /api/research/questions?projectId=`,
   `GET /api/research/questions/:id`, `POST /api/research/questions/:id/review`. Existing run
   routes are unchanged.
6. **Tests** on a throwaway database with stub runtimes, as in `tests/research-policies.test.mjs`:
   kind defaulting, question → three runs, status rules including incomplete and plan limit,
   review hash pinning.

## Slice B: the project in the world (about ½ day)

1. **Creation.** `ProjectSetup.tsx` gets a *Research project* choice. Choosing it hides the
   repository step and `RepositoryReadiness`, and keeps the existing model/colour controls.
2. **A fifth building.** `observatory` in `baseVariants`/`baseNames`, assigned to research projects
   only and kept out of the delivery rotation. For now it's the existing base kit plus a procedural
   dome/antenna, using the same Three.js material pipeline so project colour still works (per
   `AGENTS.md`, no CSS tinting). Colony slots are unchanged.
3. **Dock and lists.** Selecting a research base shows question counts (running, awaiting review,
   reviewed) and **Open research**. Delivery-only controls (New task, task counts, repository
   status) do not appear for it. `Projects.tsx` shows the kind.

## Slice C: the research window (about 1 day, after the mock is approved)

A new `overlay.kind: "research"` scoped to one project, with two views.

**Question list** (built from the index shape):
- **Columns:** title, status badge with `basis` beside it, range, and the four disqualifiers
  (currency, GST basis, centre, as-of), all sortable so a reviewer can reject on them before
  reading prose.
- **Also shown:** review state, and a filter for *Awaiting review / Disputed / Not established /
  Did not run*.

**Question detail:**
- **Answer:** range and consensus side by side, never averaged; agreement as two ratios (low and
  high).
- **Three runs side by side** whenever they disagree. The disagreement is the finding, as with the
  retaining wall at 1.251× in doc 19.
- **Components**, each marked as one of:
  - *QV row, found in capture*
  - *Web quote, verified on page p*
  - *Cited without being fetched*
  - *Quote not on the page*
  - *Allowance, assumed*

  Each opens the retained source text, by PDF page, from `.data/research-sources/`.
- **Open questions:** everything no run could establish.
- **Did not run:** a plan-limit or failed run reads *Did not run: plan limit reached*, never
  "no band".
- **Review:** approve or reject with a note, pinned to the evidence hash, shown as out of date if
  the evidence changes.

## Slice D: asking and watching (about ½ day)

1. **Ask.** A small form in the research window: question text, profile, runs (3 by default,
   Quick 1 with its warning), and the engine and model from Settings shown read-only with a link
   to change them. `18c-ask-feed.json` supplies the placeholder examples.
2. **Live activity.** Map research events (`run.started`, `tool.called`, `source.retrieved`,
   `finding.created`, `run.failed`) onto the `RuntimeEvent` shape `AgentActivity` already renders,
   one stream per run, labelled r1–r3. No new activity component.
3. **Nothing SDLC.** No gates, candidate diff, policy matrix, PR or repository readiness anywhere
   in a research project.

## Verification

- Unit and API tests for slice A; `npm test`, typecheck and lint green after every slice.
- **Browser, fixture mode**, at 1280 × 900 and 1440 × 1000:
  - create a research project;
  - see the observatory;
  - open the 30 recorded questions;
  - sort by disqualifier;
  - open a disputed one (three runs side by side), an unbanded one and an allowance-heavy one;
  - record and reload a review.
- **One live ask** at the end, 3 runs on the default Claude engine: about $15 of plan usage,
  **only with the operator's go-ahead**.

## Out of scope

The question classifier (people / SDLC / research routing), the Codex 30 × 3 rerun, the four-role
runtime's host tools, QV range-priced rows, and any change to delivery projects.

## Where approved answers go (open)

Approval stays as built for now: a review pinned to the evidence fingerprint, with nothing
downstream. Shaun is still deciding where the catalogue of approved prices lives. The idea on the
table: PlanCheck, which prices tenders against its own QV CostBuilder snapshot, sends unmatched
items to the Harness (perhaps through Linear); a research question runs; the answer is approved
automatically or by hand according to a setting; an approved answer joins the catalogue and can
update the tender. That is cross-project, so it is not being built yet.

What slice A must do so that any of these can follow without rework:

- record where a question came from (`source`: manual, or an external request id such as a
  Linear issue or a PlanCheck tender line), and reuse the question when the same request arrives
  twice, as Linear intake already does for tasks;
- keep the question record self-contained and exportable in the 18a shape, with its fingerprint;
- keep the review decision separate from any publishing step.

## After compaction, start here: slice A (the backend)

1. Read this file, then `AGENTS.md` (the 23 September entries).
2. The prototype is on `claude/research-projects-ui-plan`, PR #131 (not merged). Build slice A on
   a new branch stacked on it, because the backend serves the shapes the prototype already
   reads: `src/frontier/runtime/research.ts` (`ResearchQuestion`, `ResearchGateway`) and
   `RuntimeProject.kind`.
3. Server work: `kind` on projects (store migration, delivery by default, research needs no
   repository, delivery-only routes refuse research projects); `research_questions` and
   `research_reviews` tables; `question_id`/`project_id` on `research_runs`; `askQuestion`
   starting 1 or 3 runs through the existing `createRun` (each keeps its Settings snapshot);
   question status from `agreementForRuns`, with plan-limit and failed runs as incomplete; the
   four routes in slice A above; `source` as described in the previous section.
4. Client work: a live `ResearchGateway` in `src/frontier/runtime/live-gateway.ts`, enable the
   Research choice in Project setup when the runtime reports research support, and map run
   events onto question activity.
5. Tests on a throwaway database with stub runtimes (see `tests/research-policies.test.mjs`).
   No paid run: the first live question (about $15 of Claude plan usage) needs Shaun's go-ahead.
6. Preview with `.claude/launch.json` entries `research-api` (port 4331) and
   `research-frontier` (port 5174, an allowed origin). Do not touch the user's own servers on
   5199/4318.
