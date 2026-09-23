# Codex baseline: 30 pinned scopes on GPT-6 Sol

23 September 2026. `codex-cli` runtime, GPT-6 Sol at high reasoning, ChatGPT plan, host tools on
(`fetch_source`, `read_source`), 30 scopes x 3 runs, concurrency 3. About 100 minutes of wall time.
The full report is `.data/research-codex-cli/benchmark.json` (not committed).

| | Codex (GPT-6 Sol) | Recorded Opus baseline |
|---|---|---|
| Scenarios with a cost band | **2 of 30** | 28 of 30 |
| Runs with a band | 2 of 90 | — |
| Three-run agreement | 2, but each is one banded run, not three | 18 |
| No band | 27 | 2 |
| Incomplete (a run failed) | 1 (`data-rack-and-network-hardware`, repeated 403 on one URL) | — |
| QV rows cited / found in the capture | 285 / 285 | — |
| Web figures cited / quote verified | 111 / 107 (4 never fetched, 0 misquoted) | — |
| Cost | $65.64 API-rate estimate; the plan bills nothing per call | ~$5/scenario of Claude plan usage |

## What it means

The harness works on Codex. Every tool reached the host, 89 of 90 runs completed, and the
citations are unusually clean: every QV row it cited exists, and every web quote it fetched was on
the page.

GPT-6 Sol does not produce bands under this recipe. In almost every run it priced the
components it could source (QV rows, fetched vendor pages) and then refused to total them, giving
reasons like "the exact-scope band cannot be calculated without assigning unsupported quantities
or combining rows whose coverage may overlap". It reads the recipe's "never invent a number" and
"never combine an aggregate row with its own components" as forbidding any total that rests on
an assumption. Opus reads the same prompt as allowing a total from stated assumptions, and says
which ones.

The two bands it did give fall inside Opus's recorded ranges:

| Scope | Codex | Opus (three runs) |
|---|---|---|
| Concrete paving slab | $190–220/m² | $190–240, $175–220, $210–240 |
| Emergency lighting and exit signage | $335–435/ea | $350–480, $315–420, $370–525 |

## Not a pass/fail

Codex has no baseline of its own, and this is not a port check. The recipe was written and tuned
on Opus, so what this shows is how the recipe behaves on another model: on Codex it yields
well-cited components and almost no totals.

A comparison on equal terms would need a Codex version of the prompt that allows a total from
stated, cited assumptions, which changes the recipe and needs its own run. Until then, keep
research on `claude-cli` (the Settings default) and treat Codex as a component finder.

The benchmark's "agreed" count treats one banded run with two unbanded ones as agreement. That
does no harm on the Opus baseline, where scenarios band on all three runs, but it overstates
Codex, and should be tightened before the next measurement.

## After: Codex's own prompt (`server/research/codex-cli/codex-system-prompt.txt`)

Same harness, same 7 scopes (six Opus banded consistently, and one it correctly left unbanded), 3 runs
each. The prompt says distinct components are added, a close row may stand in with a stated
adjustment, minor unpublished items are labelled allowances, a main cost driver or professional fee
with no source means not established, and a part a rate already includes is not added again.

| Scope | Codex, own prompt (3 runs) | Allowances per run | Opus (recorded) |
|---|---|---|---|
| Channel drain | $620–850, $612–823, $615–880 /m | 0 | $570–620, $620–700, $580–800 |
| Stud partition walls | $179–229, $179–229, $187–236 /m² | 1–2 | $190–233, $190–240, $185–249 |
| ACP cladding | $569–784, $627–873, $657–843 /m² | 1–2 | $470–620, $511–710, $475–625 |
| Benchtop | $655–871, $635–915, $777–1,043 /m | 0–1 | $545–700, $650–865, $640–800 |
| Retaining wall | $845–1,186, $755–879, $818–1,062 /m² | 0–1 | $581–727, $727–865, $727–838 |
| Door hardware | $1,548–1,935, **$1,040–1,320**, $1,480–1,826 /leaf (disputed) | 1–3 | $1,520–2,090, $1,790–2,050, $1,950–2,500 |
| Switchboard (should be no band) | no band, **$16.3k–28.6k**, run failed | 0 | no band x3 |

- 6 of 7 scopes banded, 5 in three-run agreement, 1 disputed. Under the Opus prompt, 0 of these 18
  runs banded.
- Citations: 108 of 108 QV rows found in the capture; 32 of 32 web quotes verified on the fetched
  page. Allowances fell from 25 in the single-run check to 19 across 21 runs.
- Switchboard is not solved: one run still banded, this time from five fetched web pages rather
  than allowances, one declined, and one was stopped for refetching a page over the 1 MB limit.
- Codex's bands run 10–30% above Opus on cladding and the retaining wall. Whether that is
  double-counting or a fuller scope is a reviewer's call.
- Cost: $22.39 API-rate estimate on the ChatGPT plan, about 35 minutes.

Next, if pursued: the full 30 x 3 under this prompt, which is the only measurement comparable to
the Opus baseline.
