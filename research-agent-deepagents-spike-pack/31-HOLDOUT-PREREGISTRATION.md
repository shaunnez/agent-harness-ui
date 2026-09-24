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
