# Next: Codex research, a research-model setting, research projects

23 September 2026, against `main` at `d3e2e09` (PR #125 merged). Three pieces of work, in the
order they should be done. The third is the big one, and its detailed brief already exists in
`19-RESEARCH-PROJECT-PROTOTYPE-PROMPT.md`. This document says what has changed since that brief
was written and what to add to it.

## Where things stand

- **One live research engine:** `server/research/claude-cli/`. It runs `claude -p` on the
  operator's claude.ai subscription and refuses to start on an API key. Deep Agents and the
  live-model pilot are deleted. Parts of `19-...` still describe them (LangChain
  `ChatAnthropic`, `RESEARCH_MODEL_API_KEY`, the silent fake); those parts are out of date.
- **What a run can do:** search the QV catalogue (`qv-corpus-server.py`), use the CLI's own
  `WebSearch`, and read pages and PDFs through host tools (`host-tools/`, `fetch_source` and
  `read_source`). After the run, every citation is checked (`citations.mjs`).
- **Model:** the runtime defaults to `claude-opus-5-5`, and `RESEARCH_CLAUDE_CLI_MODEL`
  overrides it. The benchmarks pin `claude-opus-5`, the model behind the recorded baseline.
- **Four roles:** `claude-cli-roles` (planner → researcher → verifier → synthesiser) exists but
  lacks the host tools and citation checks. The phase 2 comparison is deferred until after the
  UI.
- **Not in the product yet:** research runs have no `projectId`, and nothing in the Frontier UI
  shows them.

---

## 1. Research on Codex (GPT-6 Sol). About one day, plus a baseline run.

**Status (23 September):** built on `claude/research-codex-runtime` and pinned to two captured
runs; see `server/research/codex-cli/README.md`. The 30-scope baseline has not been run.

A third runtime, `codex-cli`, beside `claude-cli`. It uses the same recipe and scoring, with a
different CLI underneath.

**Reuse unchanged:** the two MCP servers (`qv-corpus-server.py` and `host-tools/mcp-server.mjs`),
`citations.mjs`, `qv-rows.mjs`, `trio.mjs`, `agreement.mjs` and the benchmark scripts.

**Build:**
1. **Command line.** Start from `buildCodexSpawnArgs` in `server/codex-runtime.mjs`, which the
   SDLC stages already use: `exec --json --ephemeral --ignore-user-config --sandbox read-only
   --model gpt-6-sol`. Add `--search` for web search and pass both MCP servers with
   `-c mcp_servers.<name>.command=… -c mcp_servers.<name>.args=[…]`. Pass the system prompt the
   way the SDLC stages pass theirs.
2. **Output reader.** A `codex exec --json` equivalent of `stream.mjs`, mapping Codex events onto
   the same neutral events (`tool.called`, `source.retrieved`, `finding.created`, usage). Pin it
   to a captured real run, as `stream.mjs` was, not to documentation.
3. **Login check.** Refuse to start unless Codex is signed in with ChatGPT; reuse the probe in
   `codex-runtime.mjs`. `AGENTS.md` rule: never request, read, store or pass an OpenAI API key.
4. **Usage.** A ChatGPT plan reports tokens but no dollar cost. Show tokens and cache rate, and
   label any dollar figure **Approx. cost / API-rate estimate** (rate card: `gpt-6-sol` in
   `server/model-catalog.mjs`).
5. Register it in `server/index.mjs`, and add `--runtime codex-cli` to the benchmark.

**Watch out for:**
- **No `--allowed-tools`.** Codex can run shell commands inside its read-only sandbox, which is
  a looser gate than Claude's tool list. Confirm the sandbox has no network access; otherwise
  the agent can fetch pages without going through `fetch_source`.
- **The baseline is Claude-specific.** The 28 priced / 18 agreed / 2 not-priced counts are Opus
  results. Codex needs its own 30-scope run, and that is a measurement, not a pass/fail port
  test. Ask before spending on it.

## 2. Pick the research model in Settings. Half a day to a day.

**Status (23 September):** built on the same branch: Settings → Research agent
(`src/frontier/views/ResearchSettings.tsx`, `src/research-policies.ts`), snapshotted onto each run
as `request.researchPolicy`.

Today the model comes from code or an environment variable. Add a **Research** section under
Frontier Settings (`src/frontier/views/ExecutionSettings.tsx` already edits per-role
`RuntimeAgentPolicy` against `status.catalog.models`).

1. **Runtime + model** for the one-agent path: `claude-cli` with a Claude model, or `codex-cli`
   with a Codex model, validated against the catalogue allowlist. Default: `claude-cli` /
   `claude-opus-5-5`.
2. **Per role** for the four-role path: planner, researcher, verifier and synthesiser, reusing
   the same policy editor. Default the researcher and verifier to Opus. Nobody has measured
   cheaper models there, and on the top-30 work Sonnet 5 priced 2 of 4 against Opus's 3 of 4.
3. **Snapshot the choice onto each run** when it starts, as delivery tasks snapshot their
   policies, so a run always records what answered it (`ResearchModelIdentity` is already on
   the run record). Changing the setting never changes a finished run.
4. **Server side:** persist the setting beside the existing execution policy, and have
   `ResearchService.createRun` resolve runtime + model from it when the request names neither.
   A request that names one still wins; the registry rejects unknown ids.

## 3. Research projects in the harness. Two to three days.

Follow `19-RESEARCH-PROJECT-PROTOTYPE-PROMPT.md`, sections 1–7. In short:

1. **Project kind.** `kind: "delivery" | "research"` on `RuntimeProject`
   (`src/domain/runtime.ts:850`), default `"delivery"`. `repositoryPath` becomes optional for
   research. A checkbox in `ProjectSetup.tsx` drops the repository step and
   `RepositoryReadiness`.
2. **A fifth building** (e.g. `observatory`) in `world-3d/appearance.ts`, assigned to research
   projects and kept out of the delivery rotation.
3. **Runs belong to projects.** `projectId` on the research run record, accepted on
   `POST /api/research/runs`, with `GET /api/research/runs?projectId=`. This is the change that
   makes everything else possible.
4. **Live activity.** Point `AgentActivity.tsx` at the research event stream.
5. **Model settings.** Piece 2 above, reached from the project.
6. **Review surface.** Build the list from the index and open the detail on click. Show
   status, range vs consensus, and the low/high agreement ratios. Put the four disqualifiers
   (currency, GST basis, centre, as-of date) in sortable columns. Show all three runs side by
   side when they disagree. Record a review decision pinned to the evidence hash.
   `18a-review-feed.json` / `18b-review-index.json` are 30 real records to build against.
7. **Asking a question.** The inverse of `Grill.tsx`: a person asks and the agent answers.
   `18c-ask-feed.json` has three worked examples.

**Additions to `19-...` since it was written:**
- **Show checked citations.** Each piece of evidence now carries `quoteVerified` and a snapshot.
  Show which QV rows and web quotes checked out, and show the reasons in the finding's
  `verification.notes` for any that did not (e.g. "cited without being fetched", "quote not on
  the page").
- **Retained sources are real now.** Fetched pages and PDFs are content-addressed in
  `.data/research-sources/`, so a reviewer can open the exact text the agent quoted, by PDF page.
- **Plan limits.** A run stopped by the plan limit is `claude_cli_plan_limit_reached`, and a
  scenario with any failed run is `incomplete`. Show both as "did not run", never as "found
  nothing".
- **Leave out** the SDLC controls (gates, candidate diff, PR), as `19-...` says.

---

## Open items worth a line each

- Add the host tools and citation checks to `claude-cli-roles` before any phase 2 spend.
- Disallow `Bash` explicitly in the research CLI call. The permission gate already blocks it,
  but the agent tried `curl` once when a PDF fetch failed.
- Consider `--strict-mcp-config` for research runs. They currently load the operator's other
  MCP servers (Linear, Miro and others): none are callable, but they fill the tool list and
  force `ToolSearch`. It changes the recorded configuration, so measure before and after.
- `qv-corpus-server.py` shows range-priced rows (496 of them, e.g. `458–920`) as unpriced,
  because it only reads the single-price (`scalar`) field. Fixing it changes what the agent
  sees, so rebaseline afterwards.
