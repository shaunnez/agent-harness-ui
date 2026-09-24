# Handoff: scoping, the pack runtime, and a paused eval

24 September 2026. **Start here after compaction.** Branch `claude/research-projects-backend`.
The build below is committed (`5daabd8`); eval results are committed as they land.
Plan: `28-SCOPE-PACK-EVAL-PLAN.md`. Frozen eval: `29-EVAL-PREREGISTRATION.md`.

Shaun resumed the eval later on 24 September ("re-run luna alone the luna with opus"). A3 is
complete; A2 was running when this was last committed (10 of 13). The runner skips recorded
questions, so `node scripts/research-eval-local.mjs --arm A2` finishes whatever is left.

## Built this session (`npm test` 872 pass, `test:frontier` 169, typecheck and lint clean)

1. **One-run status.** A Quick question reads `single_run`, "One run, not cross-checked", never
   Agreed (`research-question-record.mjs` `singleRun`).
2. **Scoping step** (`server/research/research-scope.mjs`, `ResearchScope.tsx`).
   - One tools-less GPT-6 Luna call (`codex exec`, ChatGPT plan, medium) drafts a strict JSON scope:
     item, measure (per m², per m³, per metre, each, per house, total, per time), unitText,
     quantityBasis, inclusions, exclusions, centre, assumptions, clarifications. Malformed is a 422,
     never a guess. Haiku 4.5 on the subscription is the fallback only when Codex cannot answer.
   - `POST /api/research/questions/scope` drafts and stores nothing. `POST /api/research/questions`
     takes `scope` and `scopedBy`; stored as `scope_json` on the question, in the fingerprint, and
     appended to every run's objective (`scopedObjective`). External requests are scoped
     automatically, after the dedupe check, and marked unreviewed.
   - A band in a measure other than the scope's is disputed (`differingUnits(runs, scopeMeasure)`).
   - Ask form: Scope it → editable scope → Ask; "Ask without a scope" appears only if scoping
     failed. Fixture mode returns a recorded Luna scope for the roof example. Verified in the
     browser at 1280×900. Live: 6–9 s, about $0.001 per scope.
3. **`pack` runtime** (`server/research/pack/`, registered in `server/index.mjs`, not in Settings).
   - Luna High retrieves an evidence pack with the QV tools, web search and `fetch_source`; the host
     checks every item with `checkCostBandCitations`; only `qv-found` and `web-verified` items go
     forward (with the host's own row text); rejected and not-found items are listed.
   - Opus 5.5 High reasons with one tool, `request_evidence(query, why)`, capped at 2, each answered
     by a short Luna retrieval into the same host session and checked before it is returned.
   - Plumbing: `openHostToolSession({ lateTools })`, `session.setHandler`, `session.entryFor`;
     `ClaudeCliResearchRuntime` passes `session`, `checkComponents` and `emit` to its driver.
   - Evidence requests are answered one at a time (Opus can send two at once; a flaky test showed
     their evidence numbering raced).
   - Usage is summed with `byModel` and `byStage`. Tests: `tests/research-pack.test.mjs`.
   - Live smoke (roof, one run): completed, band $100–189/m² extra-over, every citation checked,
     both evidence requests used, 340 s, $0.48 API-rate (Opus $0.45, Luna $0.02 over 3 calls).
4. **No API keys anywhere.** Scoper, pack and eval run only through the `claude` CLI (claude.ai
   auth asserted, Anthropic variables stripped) and the `codex` CLI (ChatGPT auth asserted, OpenAI
   keys stripped). Tests assert both.
5. `AGENTS.md` records the decisions, including Shaun's mid-run waiver of the $4 disqualification.

## The eval so far

Runner: `node scripts/research-eval-local.mjs --arm A0|A2|A3 [--only id,id]` (reads this machine's
`.claude/launch.json` `research-api` env; skips any question that already has a result file).
Results: `29-eval/results/<arm>/<question>.json`. Runs hit by Luna capacity are set aside in
`29-eval/results/unassessed/<arm>/`, so a resume re-runs them (the pre-registered one re-run).

**Metric:** agreed, with every component of every run `qv-found`, `web-verified` or `allowance`.

| Arm | Assessed | Pass | Cost / question | Wall time / question |
|---|---|---|---|---|
| A0 Opus 5.5 alone | 13 of 13 | 5 | $2.99 avg ($1.74–$4.80) | 140 s |
| A3 Luna alone | 13 of 13 | 4 | $0.06 avg | 204 s |
| A2 Luna → Opus | 10 of 13 (running) | 4 | $1.45 avg | 449 s |

A0 by question: passes are facade, concrete paving, door hardware, interior finishes and roof
(open-a3). Roller doors is disputed: only one of three runs found a band. Agreed but a component failed its check: emergency lighting
(2 unsourced), metering wiring (1 web page not fetched), ground improvement open-a2 (2 web quotes
not on the page; all three runs gave an identical $270–420). Disputed: solar (low 1.83×), asbestos
open-a1 (2.17×), site electrical (1.33×, $4.80). Not established: HV network supply, which is the
right answer and means no arm can score above 12 of 13.

A3 by question: passes are door hardware, emergency lighting, metering wiring, site electrical.
Not established: HV network supply. Disputed: open-a1, open-a2, open-a3 (as well as the three below). Disputed: facade
(high 1.42×), concrete paving (the runs' units differed), roller doors (1.42×/1.38×). Agreed but
failed checks: interior finishes (1 QV row missing), solar (3 web quotes unverified; only two runs
banded).

A2 so far: passes are facade, emergency lighting, interior finishes, solar. Disputed: concrete
paving, metering wiring, door hardware, roller doors, site electrical. Not established: HV network
supply. Left: open-a1, open-a2, open-a3.

**Earlier pause (resolved):** GPT-6 Luna returned "Selected model is at capacity"** on 3 A3 questions (site
electrical, HV network supply, open-a1) and on 2 of 3 A2 runs of the first question. A retrieval
failure fails before Opus runs, so it costs little, but any failed run makes the question
incomplete and it must be re-run whole.

## Waiting on Shaun

- **Sol as a fourth arm?** Offered, not approved. GPT-6 Sol was measured earlier only on 7 scopes
  with its own prompt (`26-CODEX-BASELINE-RESULT.md`), so it has no score on this set. Adding it
  changes the pre-registered eval and needs Shaun's go-ahead.
- **Where research lives** (advice only, not decided): PlanCheck must run in dev and prod, so it
  cannot call the harness. Advised a PlanCheck-owned research request queue that the harness pulls
  from and posts approved answers back to, replaceable later by a hosted worker; flagged plan
  terms and usage limits for production use of the subscriptions.
- Done: the lone-band fix (Shaun: "Fix and commit and push"). A question where one of several runs
  found a band is `disputed` (`loneBand`), results re-scored, correction recorded in doc 29. Two
  banded runs that agree still count as agreed; revisit only if Shaun asks.

## Then

- Write `30-EVAL-RESULT.md`: the table above completed, diagnostics from doc 29 (cost by stage,
  evidence-request count, band distance from the recorded consensus, failures by cause), and the
  leader only if it beats the next arm by at least 2 of 13.
- Commit and push only when Shaun asks. Never commit the `.claude/launch.json` machine lines.
  `29-eval/results/` holds licensed QV row ids and bands but no row text; check before committing.
