# 32 · Research split plan

25 September 2026. Plan only: nothing here authorizes implementation, a prod deployment or a paid run. It is numbered 32 because another session has an unrelated, uncommitted `31-PLANCHECK-RESEARCH-QUEUE-PLAN.md`.

## The decision this plans

Shaun agreed on 25 September 2026:

- **The harness is dev only, with no prod access at all.** It keeps its research piece for evals: the Relay screens, fixture mode, and its comparison runtimes. Nothing reaches it from prod except Linear issues carrying IDs and failure codes, and scrubbed cases a human approved and merged by PR.
- **Research is a separate project that runs in prod**, inside the PlanCheck boundary: service, workers, database and review console. It runs research jobs, reviews declined ones and approves prices.
- **The research project runs only the DeepSeek runtime** (`api-loop`): DeepSeek over an OpenAI-compatible API, with tools run through the host and Parallel for search. There is no Claude and no Codex in the research project. In prod the model comes from Baseten, as recorded in the Azure hosting decisions on main.
- **The review console is a research-only build of Frontier.**
- **The research code stays in this repo, and there is one engine.** Prod images are built only from the research package. The harness evals run the same DeepSeek runtime that prod runs.

### Effect on other plans

- **`31-PLANCHECK-RESEARCH-QUEUE-PLAN.md`** (another session, 24 September, uncommitted) has "a harness worker (polls PlanCheck)". Under this decision, that worker belongs to the research service, not the harness. Its intake, auto-apply and promotion design can carry over unchanged.
- **The Azure hosting plan on main** puts the harness on an Azure VM reached over Tailscale. That's still the dev side: keep it in a separate subscription or resource group from PlanCheck prod, with no network path to it.

## Target layout

```
/                               harness: dev only, stays where it is (Sites handoff files untouched)
packages/research-engine/       DeepSeek runtime, service, stores, checks, grading, providers, contracts
apps/research-service/          prod server: research routes only, its own database, workers
src/frontier/research-console/  research-only Frontier entry → dist/research-console
```

The Claude CLI, Codex CLI, OpenCode and pack runtimes aren't part of the research project. They stay in the harness's `server/research/` as dev-only eval comparisons, built on the engine's base class. Retiring any of them is a separate call.

Import rules, checked in CI:

| Package | May import |
|---|---|
| `research-engine` | Node built-ins and its own files only. Nothing from `server/` or `src/`. No `claude`, `codex` or `opencode` process calls. |
| `apps/research-service` | `research-engine` only. |
| harness | `research-engine`, plus its own comparison runtimes. |
| research console bundle | No SDLC views (task workspace, New task, Grill, Linear, Companion). |

## What the code looks like today

### Two lines of work have split apart

This plan is written from branch `claude/research-workers-dev-prod-arch-a65968`, which sits on top of `claude/research-projects-backend`.

- **`claude/research-projects-backend`** is 18 commits ahead of their common base (`23561a0f`, 23 September). It carries the DeepSeek runtime (`server/research/api-loop/`), grading, citation checks by words and figures, scoping, the evals and the held-out suite (DeepSeek passes 10 of 15; Opus passes 5).
- **`main`** is 19 commits ahead of the same base, with a separate research implementation (`server/research/research-questions.mjs`, from `codex/research-projects-live`), the container runtime and the Azure hosting decisions.
- **Main has none of the DeepSeek work:** no `api-loop/`, no grading, no quote checks, no scope and no evals. Nothing in this plan can start until the two lines are reconciled (Phase 0).

### On the DeepSeek branch

- **The research tables already stand alone.** The eight research tables in the harness's `tasks.sqlite3` have no foreign key to a harness table, so they can move to their own database file unchanged.
- **The DeepSeek runtime is built on the Claude CLI runtime.** `ApiLoopResearchRuntime extends ClaudeCliResearchRuntime` (`api-loop/runtime.mjs:137`) and borrows the Codex system prompt path. The run lifecycle lives in the Claude CLI class: queueing, the host-tools session, citation and component checks, transcript scanning, events, results and cancellation. So the DeepSeek runtime currently pulls in both CLI runtimes and four harness modules (`claude-runtime`, `codex-runtime`, `process-runtime`, `model-catalog`).
- **Shared checking code lives under `claude-cli/`:** `citations`, `qv-recipe`, `qv-rows`, `agreement`, `host-tools/*`, `secret-scan` and `stream.isFinalAnswerText`. The grading and review code imports it from there.
- **Scoping runs on GPT-6 Luna through the Codex CLI**, falling back to Haiku through the Claude CLI (`research-scope.mjs`). The research project needs it on DeepSeek, or dropped.
- **The DeepSeek runtime isn't in the app's runtime registry** (`server/index.mjs:99-106`). It runs only from `scripts/research-eval.mjs`.
- **Provider setup:** `api-loop/providers.mjs` already has two providers: `opencode-go` (`OPENCODE_API_KEY`, for testing) and `baseten` (`BASETEN_API_KEY`, for prod).
- **There is no sign-in.** `research_reviews.reviewer` is free text.
- **Research projects are harness projects** with kind `research` (`server/store.mjs:402-422`).
- **The eval set came from PlanCheck's prod database** (`10e-extract-unpriced.sql`). The committed files have no tender, account, register or claim ID fields, but the item text hasn't been reviewed.

## Phases

Phases 1 to 4 are about 6 to 10 working days of agent work plus review, after Phase 0. Phase 5 is weeks and needs its own go-ahead.

### Phase 0: reconcile and decide (before any code)

1. **Reconcile the two lines of work.** Merge `claude/research-projects-backend` into main, deciding between its research question service and main's `research-questions.mjs`. This is the biggest unknown in the plan. Estimate it after a trial merge.
2. Classify the QV rate library, research questions and researched prices as either customer data or Eversor data. Then review the eval set's item text: record that it's fine to keep in dev, or scrub it.
3. Decide what a research project is in prod: one per PlanCheck account, or one standing project.
4. Decide how prod scopes questions: DeepSeek on Baseten, or no scoping step.

### Phase 1: cut the DeepSeek runtime free, in place (done)

**Mostly done on 26 September 2026**, when Shaun retired every research engine but the API loop. Rather than keep the CLI runtimes on a shared base, they were deleted: `HostedResearchRuntime` (`server/research/engine/hosted-runtime.mjs`) holds the lifecycle, the shared checking code moved to `server/research/engine/`, the API loop has its own copy of its prompt (`api-loop/system-prompt.txt`, text unchanged), and scoping calls DeepSeek on the API loop's key. Re-scoring every recorded arm gives identical grades.

**Done on 26 September 2026.** Steps 4 and 5 finished it: the research contracts (`src/domain/research.ts` and `src/research-{policies,budget-policy,runtime-contract}.ts`) moved to `server/research/engine/contracts/`, and the harness server, Frontier and tests import them from there. `tests/research-boundary.test.mjs` scans every module under `server/research/` and fails on an import that leaves it, on any npm package, on a path to a retired or delivery CLI runtime, and on `node:child_process` outside `pdftotext` and the PlanCheck token command. All tests, typecheck, lint and the build pass. Re-scoring gives the same grades before and after the move on both suites: 127 recorded results in `29-eval/results` and 45 in `31-holdout/results` (`--rescore --set` now reads the held-out questions). One 29-eval file, A6 `emergency-lighting-exit-signage`, re-scores as agreed/pass where it was saved as disputed; HEAD before the move gives the same, so the saved file predates a later scoring fix.

Goal: the DeepSeek path (`api-loop`, the service, the stores and the checks) imports no CLI runtime and no harness module.

1. Extract a `HostedRunRuntime` base class from `ClaudeCliResearchRuntime`. It takes the queue, host-tools session, citation and component checks, transcript scan, events, results and cancellation. The DeepSeek runtime extends it directly. The harness's CLI runtimes extend it too, so evals compare like with like.
2. Move the shared checking code out of `claude-cli/` into the core. Give the DeepSeek runtime its own copy of its prompt (today it borrows the Codex prompt path). The prompt text itself doesn't change, so A-arm results stay reproducible.
3. Make scoping injectable: `ResearchScoper` takes a model-call function. The harness passes the existing CLI callers; the research project passes a DeepSeek caller built on `api-loop/providers.mjs`.
4. Move `src/research-{policies,budget-policy,runtime-contract}.ts` into the core. The harness imports them from there.
5. Add a boundary test that walks the imports from the DeepSeek runtime and the service, and fails on any path into `claude-cli/`, `codex-cli/`, `opencode-cli/`, `pack/`, `server/` or `src/`.

Exit: all current tests pass, and re-checking the recorded eval arms, including the held-out suite, gives identical grades.

### Phase 2: move into a package (done)

**Done on 26 September 2026.** `server/research/` moved whole, with `git mv`, to `packages/research-engine/src/`, an npm workspace named `@eversor/research-engine` with no dependencies and one export pattern (`@eversor/research-engine/<path>` → `src/<path>`). Inside the package nothing changed: its imports are relative, so no research file was edited. The harness server, Frontier, scripts and tests import it by the package name only, and the boundary test now also fails on a relative path into the package from outside or on any dependency in its manifest. The research tests stay in `tests/` for now. The harness image copies `packages/` and makes the one workspace link itself, since it carries no `node_modules`. `npm test`, `test:frontier`, `test:frontier-api`, `typecheck`, `lint`, `build` and `test:sites` pass, and both eval suites re-score identically. Docker Desktop was not running, so the image was not built; the image's file layout was reproduced by hand and the companion started from it and answered on its research routes.

1. Add an npm workspace for `packages/research-engine`. Use `git mv` to keep file history.
2. Update the imports in the harness server, the tests, the scripts and the eval paths. The comparison runtimes stay in `server/research/` and import the engine.
3. Keep these green: `npm test`, `test:frontier`, `test:frontier-api`, `typecheck`, `lint`, `build`, `test:sites`, and the container build on main.

### Phase 3: research service skeleton, still dev only (done)

**Built on 26 September 2026**, with Shaun's answers folded in: Postgres rather than a second SQLite file, a queue that paces PlanCheck's batches (20 to 100 items), and the API PlanCheck calls. `apps/research-service` (`README.md` there):

- **Postgres stores in the engine** (`packages/research-engine/src/pg/`): run, question and project stores with the SQLite stores' methods, over an injected `query`/`exec`/`transaction` handle, so the engine still has no dependencies. JSON stays TEXT and keys sort in the C collation, so records and evidence fingerprints are byte-for-byte what SQLite gives. `tests/research-pg-parity.test.mjs` runs every store operation against both and requires identical results, and puts all 45 recorded held-out eval results through Postgres and the real question service: every one grades as recorded. The question service now awaits its store, so it runs on either.
- **The service** (`apps/research-service/src/`): `pg` for Postgres (Azure Database for PostgreSQL in prod), PGlite (`pglite:<dir>`, dev only) for local runs and tests without Docker. It registers only the API loop, behind a guard that refuses any run not on a US-hosted provider (Fireworks US or Baseten); its configuration refuses OpenCode Go, an unlisted model, and starting with no client credentials. It takes the provider and search keys out of its own environment before anything starts, as the harness does.
- **Pacing** (`engine/pacer.mjs`): runs calling the model at once start at 3, grow by one after 20 unthrottled calls, halve on a 429 (to a floor of 1, a ceiling of 6 by default), and every run holds its next call for the provider's `Retry-After`. The scoper shares it. The harness keeps its fixed cap.
- **PlanCheck's API**: `POST /v1/batches` (up to 200 items; a resent `batchId` returns the stored batch), `GET /v1/batches/:id` and `?batchId=`, each item's grade, best band, range, unit and reasons once its question settles. Client tokens are configured as SHA-256 hashes only and compared in constant time; a client sees only its batches. An item sent again (same item id, any batch) reuses its question and starts nothing.
- **The queue** is the batch tables, claimed with `FOR UPDATE SKIP LOCKED`; the worker asks only as many questions as the pacer has room for (run slots ÷ runs per question, plus one). Items being asked when the service stops go back to the queue. A run still queued when it stops now fails as `interrupted_before_start`, which a question may retry like a failed start (the harness gains this too); the worker retries such runs up to twice.
- **Research projects** are the service's own table. Phase 0.3 is still open, so the service asks every batch in one standing project (`plancheck`) and keeps PlanCheck's batch reference as opaque data; one project per account can follow without a schema change.
- **Review console routes** (the engine's `/api/research/…`, plus a projects list) answer only on a loopback listener to a loopback `Host` and origin; in the container they are off until sign-in (Phase 5).
- **Image**: `apps/research-service/Dockerfile` (engine, service, `pg`, poppler; 399 MB) with `scripts/check-image.sh`, which fails on any `claude`, `codex` or `opencode` binary or package, harness source, orchestrator module, `.data`, React, Vite, three.js or PGlite. The first build failed that check: npm installs a named workspace's devDependencies even with `--omit=dev`, so PGlite was in the image; the build now drops them from its own copy of the manifest before `npm ci`, and the rebuilt image passes. The repo has no CI, so the check runs by hand for now.

**Exit checks, 26 September 2026:**

- *Grades the same as the harness*: the parity test passes on PGlite and on a real Postgres 16 server through `pg` (`RESEARCH_TEST_POSTGRES_URL`), all 45 held-out results included.
- *The image runs*: against that Postgres 16, it applied both migrations, answered `/healthz` as `postgres`, served the token-protected batch routes, and kept the console routes off.
- *Live, against local PlanCheck, with a synthetic tender*: two made-up items (a 90 mm partition wall in Auckland, porcelain floor tiles in Wellington), five runs each on Fireworks US with QV from PlanCheck's rate library. Both came back **Confident** in 82 seconds for $0.22 in all: $165–$190 per m² of wall and $120–$183 per m² of floor, NZD excluding GST, every priced component a found QV row. The pacer grew from 3 to 6 runs at once with no throttles. Both items had close QV rows, so this shows the path works end to end, not how the service copes with items that need the web.

Still single process: runs execute inside the service, so separate worker containers stay in Phase 5, and what the pacer learns is lost on a restart.

Original plan:


1. Create `apps/research-service/index.mjs`, which:
   - mounts only the research routes
   - uses its own `research.sqlite3`
   - registers only the DeepSeek runtime (and the fake runtime for tests)
   - reads `BASETEN_API_KEY` and `PARALLEL_API_KEY` from its environment
2. Scope questions on DeepSeek, or skip scoping, following Phase 0.4.
3. Move research projects into the engine, following Phase 0.3. The harness keeps its own research projects for evals.
4. Write a Dockerfile that copies only `packages/research-engine`, `apps/research-service` and `dist/research-console`. Add a CI check that the image contains no `claude`, `codex` or `opencode` binaries, no `server/orchestrator*` and no `.data`. This image is separate from the harness image on main.
5. Register the DeepSeek runtime in the harness's Settings picker so harness evals exercise the same path. This needs Shaun's go-ahead, as `pack` did.

Exit: the service runs locally against a dev PlanCheck with synthetic tenders, and the eval set grades the same through it as through the harness.

### Phase 4: research-only Frontier build (3 to 5 days)

1. Add `src/frontier/research-console/` (`index.html`, `main.tsx`, `ResearchConsoleApp.tsx`):
   - the world showing research bases only
   - the research overlays (questions, question view, Ask, research settings, limited to DeepSeek)
   - no task workspace, New task, agent roster, Linear or Companion
2. Point its gateway at the research service API, and keep fixture mode.
3. Add `vite.research-console.config.mjs`, building to `dist/research-console`, which the research service serves.
4. Add a bundle check that fails if SDLC modules are present, for example `TaskPanel`, `WorkflowCommand`, `Grill` or `LinearSettings`.

Exit: Shaun reviews the screens in the browser, in fixture mode and against the local service.

### Phase 5: prod readiness (weeks, needs a separate go-ahead)

- **Access:** sign-in (OIDC SSO) with viewer, reviewer and approver roles. The reviewer comes from the signed-in identity, not free text.
- **Audit:** an audit log of reviews and approvals. Approvals are already pinned to the evidence fingerprint.
- **Data:** Postgres instead of SQLite, which means porting the stores' prepared statements.
- **Workers:** a queue with separate worker containers. Today runs happen inside the server process.
- **PlanCheck:**
  - job intake and results, taking the design from the 31 queue plan with the research service as the worker
  - approved prices into PlanCheck's catalogue
  - a PlanCheck service credential to replace the 24-hour token command
- **Models:** Baseten and Parallel on business terms, with keys in Key Vault. Run a parity eval on Baseten before switching over; the recorded arms ran on OpenCode Go.
- **Pipeline:** staging, a release pipeline, and change control on the research paths (CODEOWNERS, protected `main`).
- **Crossings:** a Linear issue template for prod-raised issues (IDs and failure codes only), and a written procedure for promoting scrubbed cases.

## What doesn't change

- The harness keeps research for evals, including its comparison runtimes and fixture mode.
- The DeepSeek runtime's behaviour stays the same: grading, citation checks, the five-run rule and the prompt text. Phases 1 and 2 are refactors, and recorded grades must come out identical.
- The Sites handoff files (`.openai/hosting.json`, `worker/index.js`, `scripts/prepare-sites-build.mjs`, `tests/sites-worker.test.mjs`) and the harness container on main stay as they are.

## Open questions for Shaun

Answered 26 September: same repo for now; a separate repo can follow later. Reconcile by keeping this branch's research question service and porting main's live research projects, retries and QV row display onto it.

Later idea (not planned): the research console's world as one research base on much larger land, with robots mining, exploring and so on, bound to recorded runs.

1. ~~How to reconcile the two research implementations (Phase 0.1).~~ Keep this branch's service (above).
2. The data classification (Phase 0.2).
3. What a research project is in prod (Phase 0.3).
4. How prod scopes questions (Phase 0.4).
5. Whether the DeepSeek runtime goes into the harness's Settings picker (Phase 3.5).
