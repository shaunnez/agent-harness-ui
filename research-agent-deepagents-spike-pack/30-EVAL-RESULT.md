# Eval result: single agents, Luna → Opus, and DeepSeek

24 September 2026. Pre-registration and amendments: `29-EVAL-PREREGISTRATION.md`. Raw results:
`29-eval/results/<arm>/`. Runs set aside for a provider failure: `29-eval/results/unassessed/`.

**Shaun's decision (24 September):** DeepSeek 4.1 Flash (A5) becomes the default research engine,
and the "wide estimate" cutoff is 35%. Neither is built yet; see *Next* below.

## Result

| Arm | Passed (of 13) | Cost / question (API rate) | Time / question |
|---|---|---|---|
| **A5 DeepSeek 4.1 Flash, fixed prompt** (OpenCode Go plan) | **7** | **$0.09** | 5.8 min, run 4 questions at a time |
| A0 Opus 5.5 alone (Claude subscription) | 5 | $2.99 | 2.3 min |
| A2 Luna retrieves → Opus reasons | 5 | $1.37 | 7.2 min |
| A3 GPT-6 Luna alone (ChatGPT plan) | 4 | $0.06 | 3.4 min |
| A4 DeepSeek, first prompt (stopped at 10) | 0 of 10 | $0.10 | 5.4 min |

Passed = the frozen metric: agreed, and every component of every run a found QV row, a verified web
quote or a labelled allowance. By the pre-registered leader rule (beat the next arm by at least 2 of
13), **A5 leads**. Every run went through a CLI on a plan; no API key was used.

It is not a clean win. Read these with it:

1. **A5 still prices what should not be priced.** On HV network supply, where every other arm
   correctly returned no price, all three A5 runs gave a band ($94k–$358k, $101k–$196k,
   $110k–$137k). The grading below sent it to Review only because the runs disagreed; three runs
   agreeing on an invented price would have read Confident.
2. **A5's prompt was fixed after A4's failures on these questions** (one exact continuous quote; an
   unsourced largest component is not established). The rules are general, but the set was not
   unseen for this prompt. Doc 29 discloses it.
3. **A5's times are not comparable**: Shaun ran it four questions at a time. One roller-doors run
   failed when PlanCheck restarted (another agent's work, not the arm); per doc 29 it was set aside
   and re-run once, and passed.
4. **Nothing here measures accuracy.** The metric is consistency and checked sources. On facade,
   Opus and Luna → Opus each agreed internally with floors $210/m² apart.

## Grades

Each question is graded in code from its runs, and the grade decides what reaches a tender.

| Grade | Rule | Goes back |
|---|---|---|
| Confident | Agreed (the product's rule), every component of every run checked, allowances under a third of each run | The best band |
| Unsure | Disputed, every run priced in the same measure, the runs' midpoints within **35%**, every component checked | The best band and the full range, flagged "wide estimate" |
| No price | No run produced a band | "Not established", with who to ask |
| Review | Anything else | Nothing automatic |

Best band: the median of the runs' lows and the median of their highs, taken separately.

| Arm | Confident | Unsure (35%) | Review | No price | Applied automatically |
|---|---|---|---|---|---|
| A5 DeepSeek | 7 (54%) | 1 (8%) | 5 (38%) | 0, should be 1 | 62% |
| A2 Luna → Opus | 5 (38%) | 3 (23%) | 4 (31%) | 1 (8%) | 62% |
| A0 Opus | 5 (38%) | 0 | 7 (54%) | 1 (8%) | 38% |
| A3 Luna | 4 (31%) | 1 (8%) | 7 (54%) | 1 (8%) | 38% |

Confident is the pass metric: the allowance cap bit on 1 of 156 runs.

### Why 35%

With no true prices, the stand-in is agreement between arms: each answer's best-band midpoint
against the median of the *other* arms' Confident midpoints on the same question. Confident answers
themselves sit 7% from that (median; 16% at most), the ordinary disagreement between good arms.

| Midpoints within | Extra answers released (sources checked) | Their gap to the other arms |
|---|---|---|
| 25% | 1 | 6% |
| 30% | 4 | 14% |
| **35%** | **5** | **6%** |
| 40% | 7 | 12% |
| 50% | 9 | 15% |

Up to 35% the released answers are as close to the other arms as Confident ones are; beyond 40%
they drift. 35% also matches the agreement rule's own tolerance for high ends (1.35×). Dropping the
"every source checked" condition roughly doubles what is released, unchecked prices included, so
it stays. The 35% rests on five answers and a proxy: calibrate it on real bids.

## By question (grade, best band where applied)

| Question | DeepSeek (A5) | Opus (A0) | Luna → Opus (A2) | Luna (A3) |
|---|---|---|---|---|
| acp-facade-cladding-install | Confident 670–918 | Confident 476–994 | Confident 687–1,005 | Unsure 695–989 |
| concrete-paving-slab | Review | Confident 191–218 | Unsure 186–209 | Review |
| door-hardware-sets | Review | Confident 1,840–2,200 | Review | Confident 2,118–2,437 |
| emergency-lighting-exit-signage | Confident 339–457 | Review | Confident 335–446 | Confident 346–409 |
| industrial-roller-doors | Confident 10,300–17,800 | Review | Review | Review |
| interior-finishes-to-schedule | Confident 146,000–205,000 | Confident 132,600–160,000 | Confident 139,000–173,000 | Review |
| metering-control-instrumentation-wiring | Confident 50–95 | Review | Unsure 52–91 | Confident 60–95 |
| network-supply-connection-hv-metering | Review | No price | No price | No price |
| open-a1 | Review | Review | Review | Review |
| open-a2 | Confident 227–445 | Review | Review | Review |
| open-a3 | Review | Confident 158–241 | Confident 215–241 | Review |
| p-solar | Confident 11,300–21,100 | Review | Confident 12,805–20,800 | Review |
| site-electrical-reticulation | Unsure 87,503–132,733 | Review | Unsure 89,000–137,000 | Confident 122,000–168,000 |

## What this does not settle

- **Accuracy.** Proposed: research 30–50 items of a live tender before its bids arrive, then score
  every arm and every grade against the bids (about $200 at API rates across four arms).
- **The production worker.** A5 ran on the OpenCode Go plan with Code Mode and Parallel search. A
  DeepSeek worker on a company API key would be a different setup (its own search, direct tool
  calls) and needs the same 13 questions before it replaces A5's result.
- **Refusal.** DeepSeek's weakness is the no-price case. A stricter prompt line was declined as too
  specific; the accuracy test and a no-price-heavy question set would show how often it matters.

## Next

1. Make `opencode-cli` with DeepSeek 4.1 Flash the Settings default (engine list, model options,
   validation, picker), keeping Opus and Luna selectable.
2. Build the grades and best band into the question record, so the research API returns them.
3. The production path: DeepSeek workers, a container, hosting, and the PlanCheck research queue
   (`31-PLANCHECK-RESEARCH-QUEUE-PLAN.md`, drafted in another worktree).
