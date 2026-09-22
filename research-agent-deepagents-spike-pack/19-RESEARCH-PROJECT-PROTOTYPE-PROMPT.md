# Prompt: a research project in the Frontier UI

A brief for whoever builds the prototype. Written 22 September 2026 against the code
as it stands, so the names below are real ones. Check them before you start — this was
accurate at commit `df2a37c`.

---

## The idea

A project in the colony is a delivery project: a repository, an SDLC, agents that
write code and open PRs. We want a second kind — a **research project** — that appears
in the same world, reuses the same windows, and answers questions instead of shipping
code. You tick a box at creation and get a different building.

It deliberately does **not** carry the SDLC controls: no repository contract, no gates,
no candidate diffs, no PR. What it does carry is a queue of questions, agents working
through them, and findings a person approves or rejects.

## What already exists

**A research runtime, unwired from projects.** `server/research/` holds a real service:
`research-routes.mjs`, `research-store.mjs`, `research-service.mjs`, a runtime registry,
source policy, snapshotting, a credit ledger, and search providers for Firecrawl,
Serper and Tavily. `src/domain/research.ts` defines the contracts — `ResearchProfile`
(`quick | standard | deep`), `ResearchRunState`, `ResearchEventType` (including
`worker.started`, `finding.created`, `budget.ceiling_hit`, `source.retrieved`),
`ResearchRole` (`planner | researcher | verifier | synthesiser`) and `ResearchBudget`
with hard ceilings.

**The gap that matters: a research run has no `projectId`.** Runs are standalone. The
API is `/api/research/runs` and `/api/research/runtimes`. Everything below hangs off
closing that gap.

**The colony.** `src/frontier/world-3d/colony.ts` reads placement from
`design/mission-frontier/assets/staging/colony-v2/contract.json` — a hub slot plus
`P1..P18` project slots on a hex lattice, extended clockwise as needed. Never edit that
JSON directly; the comment says changes go through the lead.

**Base appearance.** `world-3d/appearance.ts` has four variants — `bastion`, `command`,
`relay`, `foundry` — and four palettes. `chooseProjectAppearance` balances variants
across projects so the colony does not end up all one shape.

**Windows worth reusing.** `views/AgentActivity.tsx` renders a `RuntimeEvent[]` stream
with follow-tail and unread tracking. `views/Grill.tsx` walks a person through
questions one at a time with drafts and an accept-remaining escape.
`views/ExecutionSettings.tsx` already edits per-role `RuntimeAgentPolicy`
(`{model, reasoning}`) against an allowed-model list from `status.catalog.models`.

**The project type is tiny.** `src/domain/runtime.ts:832`:
`RuntimeProject = {id, name, repositoryPath, createdAt, archivedAt?}`. No kind field.
Creation is `createProject({name, repositoryPath})` in `runtime/contracts.ts:71` and
`src/api.ts:216`.

## What to build

### 1. Give a project a kind

Add `kind: "delivery" | "research"` to `RuntimeProject`, defaulting to `"delivery"` so
every existing row keeps working. Add it to `createProject`. Make `repositoryPath`
optional when `kind === "research"` — a research project has no repository, and
`views/RepositoryReadiness.tsx` should not run for it.

`views/ProjectSetup.tsx` gets the checkbox. It already imports the appearance controls
and `RepositoryReadiness`; tick the box and the repository step drops out.

### 2. A fifth building

Add a variant to `baseVariants` / `baseNames` in `world-3d/appearance.ts` — something
like `observatory` — and make `chooseProjectAppearance` assign it to research projects
rather than balancing it into the delivery rotation. Research projects take colony
slots like any other, so `colony.ts` needs no change.

A placeholder mesh is fine for the prototype. The point is that you can see from the
world which buildings think and which build.

### 3. Runs belong to projects

Add `projectId` to the research run record in `research-store.mjs`, accept it on
`POST /api/research/runs`, and add `GET /api/research/runs?projectId=`. This is the
one change that turns an unwired service into a feature.

### 4. Reuse the agent window

`ResearchEventType` already carries `worker.started`, `worker.completed`,
`tool.called`, `source.retrieved` and `finding.created`. Map those onto whatever
`RuntimeEvent` shape `AgentActivity` consumes and point the existing window at a
research run. Opening a research project should show the same live feed as opening a
delivery project — planner, researchers, verifier, synthesiser instead of coder and
reviewer.

### 5. Model configuration per research role

`ResearchRole` and `RuntimeAgentPolicy` already line up. Reuse `ExecutionSettings`
with the four research roles instead of the SDLC ones, against the same allowed-model
list.

Ground this in a measurement rather than a preference: on the work in
`17-TOP-30.md`, Haiku 4.5 produced a cost band on 0 of 4 scenarios, Sonnet 5 on 2 of 4,
Opus 5 on 3 of 4 — and Sonnet disagreed with Opus by 4x on internal doorsets from the
same source rows. Default the researcher and verifier roles to Opus. A planner or
synthesiser may well be fine on Sonnet; nobody has measured that yet.

### 6. The review surface

This is the part with real data behind it already. `18a-review-feed.json` and
`18b-review-index.json` in this pack are 30 finished research outputs in the shape a
reviewer needs:

- `status` — `agreed | disputed | not_established`
- `range` and `consensus` as separate fields, never averaged together
- `agreement` as a pair of ratios, low and high, because they diverge
- `currency`, `gst_basis`, `centre`, `as_of` — the four disqualifiers, sortable, so a
  reviewer rejects on those before reading any prose
- `qv_sources[]` — the real QV row with six-centre prices and a link to its page
- `open_questions[]` — everything no run could establish
- `review: {state, decision, reviewer, note, decided_at}` — empty, waiting
- `record_sha256` — covers everything but the review block, so a decision pins to the
  evidence version it was made against

Build the list off the index and fetch the detail record on open. Show `basis` next to
the status badge: the retaining wall record reads `disputed` at 1.251x, but its basis
explains that QV publishes 1.6m and 2.0m pole walls and not the 1.8m asked for, so the
runs bracketed rather than interpolated. Correct behaviour scoring as disagreement. A
threshold cannot see that and a reviewer sees it instantly.

For `disputed`, show all three runs side by side rather than a merged number. The
disagreement is the product: it localises the parameter the scope still leaves open.

### 7. Asking a question

`views/Grill.tsx` is the closest existing pattern — it already walks someone through
questions with drafts. The research direction needs the inverse: a person asks, agents
answer. `18c-ask-feed.json` has three worked examples, phrased the way a customer
would phrase them, each restating the question as a priceable scenario and listing
every assumption it had to invent before giving a number.

That is also the feedback-form path from the original direction note: a question comes
in, a classifier routes it to people, the SDLC, or research, and a research answer
lands in the same review queue as everything else.

## What to leave out of the prototype

The SDLC controls. No `views/CandidateDiff.tsx`, no `PolicyMatrix`, no
`RepositoryReadiness`, no gates, no PR. A research project that borrows those inherits
a workflow that does not fit and the prototype stops being a test of the idea.

## Working scripts in this pack

`14c-run-research.sh` runs one pinned scenario; `18d-ask.sh` answers one free-text
question. Both spawn the `claude` CLI on the operator's subscription, refuse to start
unless `claude auth status` reports `claude.ai`, and strip `ANTHROPIC_API_KEY`,
`ANTHROPIC_AUTH_TOKEN` and `ANTHROPIC_BASE_URL` — matching `CLAUDE_ENV_DENYLIST` in
`server/claude-runtime.mjs`. `14a-qv-mcp-server.py` is a dependency-free MCP stdio
server over the local QV capture.

Note the asymmetry: the SDLC agents run on the subscription through the CLI, while the
existing research runtime in `server/research/` takes `RESEARCH_MODEL_API_KEY` and
bills the API. If a research project should draw on the plan like everything else, that
is a real decision to make, and it means the research runtime spawns the CLI rather
than calling the Messages API.

## Honest state of the numbers

30 scenarios, 28 with a cost band, 90 runs, $149 of plan usage. **No quantity surveyor
has reviewed any of it.** Three runs agreeing means the scope was specified well enough
to reproduce, not that the answer is right. The prototype's job is to get those 28 in
front of someone who can say.
