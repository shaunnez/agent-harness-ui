# Plan: scope the question, retrieve cheaply, reason with Opus, and measure it

24 September 2026. Shaun approved all three, in this order, after the model comparison in
`research-agent-qv-sync.md` and the session that followed: **(1) the scoping step, (2) Luna
retrieving and Opus 5.5 reasoning over a checked evidence pack, (3) the eval runs.** The eval runs
are authorized as part of that instruction; the budget below still applies.

**After compaction, start here.** Branch `claude/research-projects-backend` (stacked on PR #131,
uncommitted work on disk, nothing pushed). Read this file, then `AGENTS.md` (the 23–24 September
research entries), then `27-RESEARCH-PROJECTS-UI-PLAN.md` for slice A.

## Where things stand

- **Slice A built** (doc 27 status): research projects, questions (1 or 3 runs), status from
  `agreementForRuns`, unit comparison (`research-question-record.mjs`: runs pricing in different
  measures are disputed with no consensus), reviews pinned to the evidence fingerprint, the live
  Frontier gateway. Tests: `tests/research-questions.test.mjs`.
- **QV comes from PlanCheck by default** (`server/research/qv-plancheck.mjs`). The three QV tools
  are answered by the host through the host-tool relay; the token never enters the CLI's process
  tree. `RESEARCH_QV_SOURCE=local` (or a `corpusIndexPath` passed to the runtime) is the only way
  to use the local capture; the benchmark scripts set it, because the recorded baselines were run
  on it. Tests: `tests/research-qv-plancheck.test.mjs`.
- **Auth is automatic** (`server/research/plancheck-token.mjs`): the host mints with
  `RESEARCH_PLANCHECK_TOKEN_COMMAND`, renews 30 min before expiry, re-mints once on a refusal,
  shares one token across parallel runs, caches it 0600 in `RESEARCH_PLANCHECK_TOKEN_FILE`.
- **Row kinds**: research asks for `rate,elemental,benchmark,build_up,percent,fee`
  (`RESEARCH_PLANCHECK_ROW_KINDS`); every non-rate row is labelled, elemental rows show per-building
  cost per m² of floor area and fee rows their percentage. Watch: building-type queries now return
  mostly elemental rows; if that pushes detailed rates down, do two searches per call.
- **Tool trimming is already in** (compact rows, 12 hits by default, no `scope_notes`). The eval's
  old arm A1 is therefore folded into A0.
- **Preview**: `.claude/launch.json` `research-api` (4331) carries the PlanCheck env, including this
  machine's mint command and paths. **Never commit those lines**; the repository is public.
  PlanCheck's library runs at `http://127.0.0.1:8031` (PR EversorAI/eversor-plancheck#444).
- **Measured so far** (three open questions, 3 runs each, High): Opus 5.5 $2.63/question, Sonnet 5
  $1.49, GPT-6 Sol $1.88 (long-context tier). About 85% of cost is retrieved context re-read every
  turn; reasoning/output is 11–21%; citation checks are host code and free. Sonnet 5 is scrapped
  (6 of 11 web quotes not on the page). One quick Opus 5.5 run on PlanCheck data (RQ-013, roof
  question) was the first live run on the new source: 112 s, $0.94 API rate, band $120–157/m² extra
  (about +$144k–189k on 1,200 m², including ply deck and secondary framing), all 6 citations
  checked (4 QV rows found, 2 web quotes verified); 11 QV searches, 5 tables, 2 page fetches.
- **Fix first:** a Quick (one-run) question reads `agreed`, because one band agrees with itself.
  It must read as one unverified run instead (a `single_run` state or flag, shown as "One run, not
  cross-checked"), and `tests/research-questions.test.mjs` currently asserts the wrong thing.

## 1. The scoping step (about half a day)

A question becomes a pinned scope before any run starts. The 30 recorded scopes agreed 18 of 28
because they were pinned; the open questions disagreed on units in 3 of 9.

- `server/research/research-scope.mjs`: one tools-less call on GPT-6 Luna (`codex-cli`, ChatGPT
  plan; Haiku 4.5 is the fallback). It returns JSON only: `item`, `measure` (one of per m², per m³,
  per metre, each, per house, total, per time), `unitText`, `quantityBasis`, `inclusions[]`,
  `exclusions[]`, `centre`, `assumptions[]`, `clarifications[]` (what it could not decide). Parse
  strictly; a malformed scope is an error, never a guess.
- `POST /api/research/questions/scope {projectId, objective}` returns a draft, starts nothing.
  `POST /api/research/questions` accepts `scope`; it is stored on the question (`scope_json`), is
  part of the evidence fingerprint, and every run receives the objective plus the pinned scope
  text. An external request (`source.kind = external`) is scoped automatically and shows it.
- The unit check compares each band against the scope's `measure` as well as against the other
  runs.
- Ask form: "Scope it" first, then the editable scope, then Ask. Fixture mode shows a recorded
  scope and calls nothing.
- Tests with a stub scoper: strict parsing, scope on the record and in the fingerprint, runs get
  the pinned text, a band in another measure is disputed.

## 2. Luna retrieves, Opus reasons (about 1 day)

One run becomes two stages, both behind the existing runtime contract so the question service is
unchanged (a new runtime id, `pack`, registered beside `claude-cli` and `codex-cli`):

1. **Retrieve** on GPT-6 Luna (`codex-cli`, retrieval prompt): QV tools, `WebSearch`,
   `fetch_source`/`read_source`. Output is an evidence pack, not a band: candidate components, each
   with QV row ids or a retained `source_id` and exact excerpt, amount, unit, and a note of what
   was looked for and not found.
2. **Check the pack in the host** with the same code as `checkCostBandCitations`, against the rows
   and sources the retrieval stage retained. Only checked items go forward; rejected items are
   listed as rejected.
3. **Reason** on Opus 5.5 (`claude-cli`, reasoning prompt), given the pinned scope and the checked
   pack (target ~20k tokens), with no QV or web tools and one host tool,
   `request_evidence(query, why)`, capped at 2 calls, each answered by a short Luna retrieval into
   the same retained store and checked before it is returned. Its final answer is the existing
   cost-band fence, so outcomes, citations, agreement and the UI are unchanged.
4. Usage is the sum of both stages, by model, with the API-rate estimate as today.

Each of a question's three runs does its own retrieval, so agreement still tests retrieval as well
as reasoning. (A shared retrieval would be cheaper but only test the reasoning; measure it later if
at all.) Estimate: about $1.20 per three-run question against $2.63, unmeasured.

## 3. The eval (after 1 and 2)

- **Set:** 10 of the 30 pinned scopes (6 recorded agreed, 3 disputed, 1 not established, chosen
  and written down before any run) plus the three open customer questions from `18c`, scoped.
- **Arms**, 3 runs per question, all on PlanCheck's library, High reasoning:
  - A0: Opus 5.5 single agent, as built (trimmed tools).
  - A2: scope → Luna retrieve → Opus reason (`pack`).
  - A3: GPT-6 Luna single agent, end to end.
- **One decision metric, frozen before the run:** the share of questions ending **agreed with
  every component checked** (QV row found, quote verified, or a labelled allowance). Deterministic;
  no model's judgement enters it.
- **Diagnostics:** API-rate cost per question, wall time per question and per run, runs with a
  band, unit mismatches, band distance from the recorded Opus band on the pinned scopes, how often
  Opus requests more evidence, tokens by stage.
- **Budget:** equal per-arm cap of $4 API-rate per question; an arm over it is disqualified, not
  hidden. Rough total: A0 ~$34, A2 ~$16, A3 ~$1 (13 questions each).
- Freeze the set, arms, metric and budget in `29-EVAL-PREREGISTRATION.md` before starting. Report
  in `30-EVAL-RESULT.md` with the table and the leader, or no leader if the arms tie.

## Out of scope

Jev (skipped). Committing machine-specific `launch.json` lines. Publishing approved answers to
PlanCheck (still undecided; `research-agent-qv-sync.md`).
