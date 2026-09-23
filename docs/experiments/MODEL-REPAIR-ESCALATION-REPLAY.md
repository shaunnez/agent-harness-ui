# Paired candidate Repair replay — 23 September 2026

**Decision:** keep automatic candidate Repair escalation **Off** for standard and high-risk Codex defaults. The optional, explicitly selected rung works, but this two-case comparison found no quality gain from GPT-6 Sol XHigh over High. High passed the independent behavior and compatibility checks in 4/4 trials; XHigh passed in 3/4, with one material H02 compatibility regression. This is directional evidence from two defects, not a general model ranking or a full autonomous task pass.

## Method and scope

Two historical, independently rejected candidate revisions were replayed through the harness's actual `repair` path. Each isolated run rehydrated the same task state, exact candidate-bound P1 Dev Review `candidate-defect` gate and repair-required freshness, then invoked one real Codex provider Repair call. Earlier stages were retained evidence, not rerun; downstream Dev Review, Test and Final Review were not run. Every valid run used the same case-specific prompt hash, model, repository base, limits and tool permissions. The only policy difference within each pair was Sol High versus Sol XHigh. Each policy was repeated twice per case. Reference fixes were absent from the agent checkouts. H03 was not used.

| Case | Broken behavior | Frozen broken/reference control | Prompt SHA-256 |
| --- | --- | --- | --- |
| H02 | Specification loses provenance for manual, automatic and legacy Grill answers | Broken 0/1; reference 1/1 | `92b34c9098060feb2d060c37188d75bcfbdc13687c7a8391174274f0addcd4e4` |
| H06 | Queued Linear work can apply after Off, and a failed Settings save can display transient Off | Broken 0/3; reference 3/3 | `594d3fd2e8b553b5191133fbb0fa3bd611cd55077540ca0186aa8abe8f1d7357` |

The controls used H02 broken `f2efd20` / reference `7975e66` and H06 broken `3e8ad50` / reference `a9f5890`. The frozen exact tests were injected only into separate grading copies. The H06 wider integration grader (version `h06-v6`, SHA-256 `e18d60c97187031315bbcbe0d3b39bf80678a29065fb61deea7abaccd94fe90d`) previously distinguished broken 0/7 from reference 7/7 and a mutant 5/7. It made no inference calls. Local replay manifests and receipts are under `/private/tmp/repair-escalation-paired-v3-20260923` and `/private/tmp/repair-escalation-h06-replacement-20260923`; they are private, nonportable evidence, not committed fixtures.

## Results

`Behavior` means the independent, externally observed repair behavior. H02 also had a compatibility check using the *unchanged original* test and a review of the existing UI consumer. H06 had a rendered Frontier Settings test plus the seven-check integration grader. All eight actual Repair runs reached a clean, committed candidate revision 2 and `ready-for-review`; this is not downstream acceptance.

| Case | Policy / rep | Candidate | Behavior | Compatibility / integration | Elapsed | Total tokens | API-rate estimate |
| --- | --- | --- | --- | --- | ---: | ---: | ---: |
| H02 | High 1 | `6fc1c66` | Pass | Pass | 119 s | 398,280 | $0.363 |
| H02 | High 2 | `cd7014d` | Pass | Pass | 176 s | 581,205 | $0.468 |
| H02 | XHigh 1 | `b0ca0cf` | Pass | **Fail: manifest shape** | 214 s | 748,498 | $0.619 |
| H02 | XHigh 2 | `52aa81b` | Pass | Pass | 227 s | 472,786 | $0.482 |
| H06 | High 1 | `ce19063` | Pass | 7/7 | 327 s | 1,131,044 | $0.856 |
| H06 | High 2 | `1fe0bb2` | Pass | 7/7 | 407 s | 1,544,164 | $1.036 |
| H06 | XHigh 1 | `03a185b` | Pass | 7/7 | 449 s | 1,448,350 | $1.023 |
| H06 | XHigh 2 | `c719025` | Pass | 7/7 | 430 s | 1,890,633 | $1.226 |

Across the four valid trials per policy, High used 3,654,693 tokens and $2.723 estimated API rates; XHigh used 4,560,267 tokens and $3.350. XHigh consumed 25% more tokens, took 28% longer in aggregate (22.0 versus 17.2 minutes), and had a 23% higher API-rate estimate without an observed quality gain. These are pricing estimates, not attributable ChatGPT-plan charges. The eight valid calls totalled 8,214,960 tokens and $6.073 estimated API rates.

The XHigh H02 first repair replaced grouped `decisions-*` manifest sources with one source per decision. Its modified tests pass, but the unchanged original test fails, and `RuntimeTaskDecisionSummary` uses `.find(source.kind === "decisions")`; that UI therefore reads only the first source. The provenance text itself passes the semantic checker. This is a real candidate regression, not a formatting preference.

**Grader limitation:** the frozen H02 test requires the reference fix's exact `(source: ...)` spelling and grouped count label. All four repairs use semantically valid `answerSource:` labels and fail that exact test. The frozen H06 Settings test calls the reference fix's exported `createLinearStatusGuard`; all four repairs use other implementations and fail before asserting behavior. Those failures remain in the receipts. After identifying this overfit, separate behavior checks were added and qualified against the broken and reference revisions: H02 checks the question/answer/source pairings and non-human labels; H06 exercises the rendered Frontier Settings across a pending failed save and tab switch. These **post-hoc** checks support the behavioral conclusion but cannot be described as predeclared primary scoring. The H06 frozen Linear checks pass 2/2 in all four repairs.

All valid H02 candidates passed lint, typecheck, the full 388-test suite, build and Sites checks. All valid H06 candidates passed lint, typecheck, their native full test suite, build and Sites checks; the second pair was rechecked after completion. The H06 first pair's agent-side timing and verification were affected by sparse dependency setup repaired mid-run, though independent checks after completion passed. The H06 second pair used complete dependencies and an explicit Command Line Tools path from preflight onward.

An earlier four-call replay attempt is **setup-invalid**, excluded from the table and decision: a nested macOS sandbox wrapper prevented Codex tools from writing. Two completed no-change calls consumed a known 911,364 tokens and $0.713 estimated API rates; two interrupted calls have unavailable usage. A later pair of H06 second-repetition slots stopped *before provider dispatch* because the active Xcode path was invalid; those slots have no model result and were replaced by the completed second pair above. No failed or cancelled receipt was overwritten.

## Consequence

Keep the explicit Repair rung available for operator-selected trials, with the existing candidate-defect gate and attempt limits. Do not promote XHigh automatically from these data. The next quality study should use a few more distinct, genuinely difficult candidate defects and implementation-agnostic black-box graders written before dispatch; retain H03 as a held-out case. No broader campaign, replacement run, model substitution, PR merge or deployment was performed here.
