# H05 Codex comparison v2 result

## Outcome

The clean replacement pair completed on 23 September 2026. Both arms produced a first-attempt candidate, passed the Harness Dev Review, Test and Final Review gates, passed all seven independent H05 behavior checks, and passed one blind Sol High rubric review with no findings. Neither arm used a repair, retry, human rescue, Claude model or Astra model.

The declared primary metric is tied at 1/1 accepted deliveries for each arm. This is one paired observation, so it does not establish a pass rate or a general model winner. On this small catalog task, Luna High implementation was accepted with lower elapsed time, token use and API-rate estimate.

| Arm | Implement / Repair | Delivery | Independent checks | Blind review | Repairs | Elapsed | Delivery tokens | Reviewer tokens | API-rate estimate |
| --- | --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: |
| A | Sol High | Accepted | 7/7 | Pass, no findings | 0 | 18m 28.6s | 2,207,325 | 184,966 | $3.753104 |
| B | Luna High | Accepted | 7/7 | Pass, no findings | 0 | 14m 04.2s | 1,789,047 | 146,029 | $1.829953 |

Cached input is included in input and total token counts, not added again. Arm A recorded 2,178,101 input, 1,812,736 cached input and 29,224 output delivery tokens. Arm B recorded 1,761,782 input, 1,446,912 cached input and 27,265 output delivery tokens. The dollar figures are calculated API-rate estimates, not attributable ChatGPT subscription charges. Reviewer usage is excluded from the delivery metric.

Relative to Arm A, Arm B finished about 24% sooner, used about 19% fewer delivery tokens and had an API-rate estimate about 51% lower. Both ran concurrently on the same host, so elapsed time is observed shared-host throughput rather than a standalone latency benchmark.

## Candidate shape

Arm A changed four files with 104 insertions and five deletions. It corrected the catalog condition, made unsupported availability explicit and added broader API, Claude catalog and runtime coverage.

Arm B changed two files with 82 insertions and one deletion. It made the smallest production correction and added one focused runtime regression covering Claude and Codex discovery, settings reference types, metadata, uniqueness, unsupported entries and input immutability.

Both implementations satisfy the frozen contract. The independent reviewer reported no material or minor findings for either candidate. The broader Sol test surface is useful evidence, but it did not reveal a behavior gap in the smaller Luna candidate under the qualified grader.

## Method and evidence

- Campaign: `/Users/shaun/.codex/model-evaluation/20260922/h05-codex-comparison-v2`
- Public root: `/private/tmp/h-eval-h05-codex-comparison-v2`
- Harness source: `a7208b346921efdcc32e3e6778dbf792dc0eddcd`; runtime evaluation code is unchanged from the v1 source, with the intervening commit recording the v1 result
- H05 base: `56524724e31d17968383d1e24a2b1c70a0a46ca9`
- Arm A candidate: `271cf4aa70e13b1608dc5c8c686fd0916e7e63b0`
- Arm B candidate: `caa7ded5f616e8ffd98709f5052b6a8ccdb3afb6`
- Limits per delivery: two hours, 200M total tokens and one hour per model call
- Repairs: two package corrections and two shared standard-profile candidate repairs
- Provider enforcement: Codex only; all delivery and reviewer ledgers are settled

Each fresh base passed lint, typecheck, 282 tests, build and Sites tests in the real verification-worker environment. Each zero-inference admission recorded the intended policy matrix, manual Grill, standard profile, repair limits and an empty provider ledger. Native permission checks proved each arm could read its own repository and could not read its sibling, prior candidates, H05 qualification evidence or grader source.

An earlier preparation under `/Users/shaun/.codex/model-evaluation/20260923/h05-codex-comparison-v2-abandoned-preflight` was abandoned before task admission or inference because its isolation check found that the runner's date-scoped protected paths did not deny the prior date's qualification evidence. The receipt is retained. The live campaign was prepared under the qualified 20260922 boundary and passed isolation. Future runner work should deny the entire model-evaluation evidence root rather than relying on a campaign-date parent.

The finalized machine report is `report.json`. It records comparable variants, no policy drift, both trials within budget, 100% first-pass gate success, no repairs or retries and no leader because the primary metric tied.

## Decision

For a small, well-bounded Harness change like H05, this result supports Luna High as a provisional Implement/Repair choice behind Sol High planning and reviews. It does not justify a global default change yet. The next useful evaluation is the same paired comparison on a qualified medium task, followed by a harder task that can exercise repair behavior. H03 is a relevant medium candidate but still needs an independent grader and baseline qualification before paid dispatch.
