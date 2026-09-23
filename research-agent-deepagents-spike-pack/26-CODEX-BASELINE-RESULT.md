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
