# Held-out suite (registered 25 September, before any run)

**Why.** Shaun asked how specific the recent tweaks are to the 13 eval questions. Several were fitted
to failures read on those 13: the QV-first exceptions, the change-question wording, the not-a-price
phrases, the thresholds replayed on their answers, and open-a3's scope pin. Arms A9 and A10 are
therefore optimistic on that set. This suite is unseen by every tweak: "perhaps we do a new suite of
questions and score them both?" Shaun asked for DeepSeek first ("We'll do deepseek first and see how it
goes before wasting money on an expensive opus send").

**Questions (15).**

- 12 pinned scopes from `16-pinned-scopes/` that no eval arm or tuning run has used: data rack,
  deflection-head seal, facade coating, garden bed, glass splashback, glazed vision panel, joinery
  painting, site establishment, solar connection switchboard works, sprinklers, steel connection
  fabrication, subgrade and basecourse. Their 22 September recorded statuses are kept in
  `31-holdout/question-set.json` for reference, as in doc 29.
- 3 open questions written for this suite (`31-holdout/open-questions.json`), scoped automatically
  by the product's scoper (GPT-6 Luna) and left unreviewed, as external requests are:
  - a 1.8 m timber paling fence along a 40 m boundary, with the old fence removed;
  - luxury vinyl plank replacing carpet in a 150 m² office, with uplift and preparation;
  - what Chorus charges to bring fibre into a new six-unit light industrial building. This is written
    as a likely quote-only item, like HV supply. Its right answer is decided after the runs by reading
    the sources, and is not assumed.

**Arms.** The DeepSeek loop frozen as A10 (API loop, DeepSeek 4.1 Flash on OpenCode Go, every check and
prompt rule as of commit b646bf0f, five runs). Opus (claude-cli, Opus 5.5 High, five runs) follows only
if Shaun approves the spend after seeing DeepSeek's result. No tuning on this suite: a change made
after seeing its results makes a new arm, which can only be scored on a fresh set.

**Metric.** As in doc 29: a question passes when it is agreed and every component of every scored run is
checked. Each arm is reported on the closest three of five, on its first three runs, and on fully
traced passes (with "worked from quote" not counting). A question whose right answer is "no price"
counts as right when it comes back not established.

**Accuracy.** Agreement is not accuracy. Where PlanCheck's retained variation schedules hold a
contractor's tendered rate for a comparable item, it is used as a reference, never sent to a model,
and reported beside the band with the caveat that one tender is one price.

## DeepSeek result (25 September)

A10 frozen: 15 questions × 5 runs, all at once, 9.5 minutes, $2.27, no errors. **14 of 15 agreed and 10
passed, 9 of them with every figure traced.** On its first three runs alone it also agreed 14 and
passed 10, so on this suite the five-run rule made no difference.

- Passed: facade coating, garden bed, glass splashback, site establishment, sprinklers, steel
  connections, subgrade and basecourse, the paling fence (open-b1) and vinyl plank (open-b2). Joinery
  painting passed on "worked from quote".
- Agreed but a check failed: data rack, deflection-head seal, glazed vision panel, solar switchboard
  works.
- Disputed: the Chorus fibre connection (open-b3), with runs from $0–8.4k to $14.9k–28.3k and one
  unpriced. It is not a quote-only item like HV. A Chorus price list the runs fetched gives a
  standard charge of $900 + GST per premises for a qualifying development (about $5,400 for six
  units), with non-standard pricing when feeder augmentation passes $500 per lot or trenching is
  needed. So it is priceable with a stated assumption, and the runs split on standard against
  non-standard. That price list's date is not established here.

**Against the 22 September recorded runs** (Opus 5 on the earlier harness, three runs, before
fetched-page quotes and every check since). This is not a like-for-like comparison. Where both
agreed, DeepSeek's band is well below the recorded one on three questions: data rack $15.1k–24.3k
against $28k–42k, glazed vision panel $697–1,094 against $1,100–1,900, and joinery painting $52–71 per m²
against $92.5–167.5. Agreement is not accuracy: on those three, one of the two is wrong, and only an
Opus run on the same harness, or a priced tender, would say which.

## Opus arm (registered 25 September, before its run)

Shaun: "ok do run opus". Arm `O5`: the claude-cli runtime, Opus 5.5 High, on the claude.ai
subscription (the runtime refuses any other login and strips API keys from the CLI's environment).
Five runs per question on the same 15 questions and the same checks, scored the same three ways. It
runs on its own recorded prompt. The API loop's prompt rules (QV first, not-a-price, stated working)
and its host answer review are not available on this runtime, so this is Opus as built against
DeepSeek as tuned. It runs two processes at once, each with the runtime's cap of three concurrent
CLIs (eight at once produced empty outputs before).

## Opus result (25 September)

O5: 15 questions × 5 runs, two processes of three CLIs, 35 minutes, $75.27 API-rate estimate on the
claude.ai subscription (a plan charge, not a bill), no errors. **11 agreed and 5 passed, 4 with every
figure traced.** Its first three runs alone also pass 5. It declined to price the glazed vision panel
and the Chorus connection (no price in all five runs), and joinery painting and solar were disputed.

| | DeepSeek loop (A10) | Opus (O5) |
|---|---|---|
| Agreed | 14 | 11 |
| Passed | 10 | 5 |
| Fully traced passes | 9 | 4 |
| Cost for the suite | $2.27 | $75.27 (API-rate estimate) |
| Time for the suite | 9.5 min | 35 min |

Why Opus fails: it agreed on price in six questions and failed the check. Every failure was a component
with no QV row, fetched page or allowance (6), a web page it cited but never fetched (3), or a QV row
that does not exist (1). These are gaps in how the citations are recorded. The API loop's prompt rules,
which close them, are not on the claude-cli runtime.

On price, where both agreed, the bands mostly overlap: data rack $15.1k–24.3k against $18k–22.7k,
sprinklers $44–81 against $44–57, steel connections $219–434 against $239–469, and subgrade $219–336
against $259–365. So of the three questions where DeepSeek was well below the 22 September runs, data
rack and joinery painting now sit with DeepSeek. Opus prices joinery at $46–57 (disputed) against the
22 September runs' $92.5–167.5, and it did not price the glazed vision panel. The clearest remaining
difference is site establishment: DeepSeek $5.7k–9.4k, Opus $2.4k–3.9k, and the 22 September runs
$3.3k–7k. Which is right is not measured here.

## Provider parity arm (registered 26 September, before its run)

Shaun: "Lets do fireworks". Arm `F10` is A10 with one change, the provider: DeepSeek 4.1 Flash on
Fireworks' US-only serverless endpoint (`us.api.fireworks.ai`, model
`accounts/fireworks/routers/deepseek-v4p1-flash-us`) instead of OpenCode Go. The prompt, checks, answer
review, five runs and questions are A10's, so this measures the provider, not the recipe.

**Decision rule, fixed now.** Fireworks US is acceptable for production if F10 passes at least 8 of the
15 questions (A10 passed 10) and agrees on at least 12 (A10 agreed 14), with no run failing for a
provider reason (refused key, rate limit, tool-call format). The two-question margin allows for
DeepSeek's run-to-run variance, which moved an unchanged arm from 6 to 4 on doc 29's set (A5 and its
repeat). Cost and time are reported beside it; at Fireworks' US rates (1.5x its global price, and
about 3x OpenCode Go's) the suite is expected to cost about $7.

