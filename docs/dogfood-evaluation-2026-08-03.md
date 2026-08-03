# Overnight dogfood evaluation — 2026-08-03

## Blind-score lock

These scores were produced from the anonymized campaign bundle at `17fe949148c824f0a2393227ae39415cd16e71de`, before reading the private variant map, task model metadata, coordinator messages, or non-anonymized campaign material. The labels below are opaque candidate labels. The scores and blind rationales in this section are immutable after the locked-score commit; the revealed comparison is appended later.

The frozen implementation base is `4c9d56813ae1787f9099d24efd5a8f67ed90234f`. The evaluator reconstructed the only two available patches, B and I, from the bundle diffs in disposable detached worktrees. Both bundled unified diffs had blank hunk-context lines with the required leading space removed, so `git apply --check` initially reported a corrupt patch. The evaluator mechanically restored only those context prefixes and normalized line endings before applying the patches. This is a bundle-integrity defect recorded separately from candidate quality.

## Method and rubric

Each candidate receives a 1–5 score for the nine requested dimensions. A score of 5 is exceptional and fully evidenced; 4 is strong with limited gaps; 3 is adequate with material shortcomings; 2 is substantially deficient; and 1 means the deliverable is absent, unusable, or unsupported by evidence. When no candidate revision exists, 1 is the rubric floor for every dimension because there is no implementation to assess; it does not assert that nonexistent code is intrinsically poor.

Hard workflow failures are reported separately from subjective patch quality. Passing evaluator-run checks does not convert a campaign-blocked candidate into a completed run, and a candidate that never reached a fresh candidate-bound gate remains incomplete.

Abbreviations: FC = functional correctness; AC = acceptance-criteria coverage; RS = regression safety; CC = code clarity; M = maintainability; A/C = architecture and contracts; TQ = test quality; SD = scope discipline; UX/A11y = UX and accessibility.

| Candidate | Issue | FC | AC | RS | CC | M | A/C | TQ | SD | UX/A11y | Mean |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| A | Dashboard progress | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1.00 |
| B | Agent and Skill contracts | 4 | 4 | 4 | 4 | 3 | 4 | 4 | 4 | 3 | 3.78 |
| C | Agent and Skill contracts | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1.00 |
| D | Dashboard progress | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1.00 |
| E | Agent and Skill contracts | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1.00 |
| F | Structured activity | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1.00 |
| G | Structured activity | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1.00 |
| H | Structured activity | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1.00 |
| I | Dashboard progress | 3 | 4 | 4 | 4 | 3 | 4 | 4 | 4 | 3 | 3.67 |

## Hard failures and campaign outcomes

- A, C, D, E, F, G, and H are hard failures for delivery: each stopped in Implement after three attempts, has no candidate revision or head, contains only the bundle's no-candidate marker instead of a patch, and has no verification records.
- B is a hard workflow failure despite having an assessable revision. It stopped blocked in Dev Review after three Dev Review attempts. The anonymized bundle contains no candidate-bound gate verdict or verification record for B. Evaluator-run checks passed, but the campaign itself did not complete or reach Human Approval.
- I is a hard workflow failure despite having an assessable repaired revision. Revision 1 received `REPAIR` for a visually static progress ring. Revision 2 fixes that specific defect and passes evaluator-run checks, but the campaign stopped blocked in Dev Review after three attempts without a fresh revision-2 verdict. Prior evidence is therefore not a completed candidate-bound gate.
- None of the nine candidates completed the requested workflow. No candidate was merged.
- The malformed B and I diff serialization is a campaign-bundle hard defect. It did not change the reconstructed code scores because the repair was deterministic and limited to required unified-diff context prefixes.

## Candidate B — Agent-detail policy editor and Skill contracts

Candidate B is a strong but incomplete implementation. It wires a shared `PolicyEditor` into Agent detail and Settings, connects saving to the existing runtime settings path, and replaces prose-only Skill summaries with typed provenance backed by actual raw JavaScript sources. The final candidate changes four files with 611 insertions and 52 deletions; much of the volume is focused API and rendering coverage.

- **Functional correctness — 4/5.** Every non-deterministic Agent detail gets catalog-backed model and reasoning controls through `PolicyEditor`; `policyIdForRole` maps individual Goose scouts to `scouts`, and Human Approval is deterministic (`src/components/PolicyEditor.tsx:37`, `src/components/LibraryScreens.tsx:331`). Saving persists through the existing settings API and refreshes runtime state (`src/App.tsx:190`). One error-path flaw remains: if the settings update succeeds but `refreshRuntime()` fails, the editor reports a failed save even though persistence already occurred, because only the ancillary scorecard refresh is isolated.
- **Acceptance coverage — 4/5.** The shared editor provides Reset to global default, success/error states, new-task-only snapshot copy, supported reasoning values, and scout-policy truthfulness. Skill detail distinguishes TypeScript/API input and output, configuration, prompt, parser, persisted records, and UI-only presentation (`src/components/LibraryScreens.tsx:173`). The contract registry cites real filenames and excerpts imported raw source (`src/contracts/skillContracts.ts:144`, `src/contracts/skillContracts.ts:293`). The main gap is usability rather than missing mechanics: Settings renders 16 editor instances, including the shared `scouts` policy once as Repository scouts and again for each of six individual scouts.
- **Regression safety — 4/5.** Evaluator runs passed lint, typecheck, all 64 tests, build, Sites packaging tests, and `git diff --check`. New API tests cover catalog rejection and policy snapshot immutability. No candidate-specific browser console error was observed; the six font 403s came from the evaluator's external `node_modules` junction and are not part of the patch.
- **Code clarity — 4/5.** The shared save function and contract-rendering helpers have explicit names and clear layer boundaries. Dense inline JSX in Settings remains harder to scan, but the policy and contract concepts themselves are understandable.
- **Maintainability — 3/5.** The implementation reuses cohesive `PolicyEditor` and `skillContracts` modules, but grows `LibraryScreens.tsx` from 466 to 534 lines instead of extracting the new 60-line contract panel. That conflicts with the repository's practical 500-line boundary. Six duplicate Settings controls write the same `scouts` key, and two always-open 2,400-character prompt excerpts substantially duplicate `buildStageRequest` content.
- **Architecture/contracts — 4/5.** The UI saves through the real runtime-settings contract, task policy snapshots remain stable after later changes, the model catalog controls allowable values, and the TypeScript registry is exhaustively checked with `satisfies Record<StageId, SkillContract>` (`src/contracts/skillContracts.ts:473`). The registry is descriptive rather than a runtime validator, which it states truthfully.
- **Test quality — 4/5.** Tests cover API persistence and rejection, old/new task snapshots, allowed models and reasoning, reset payload preservation, shared scout mapping, deterministic approval, and every Skill contract layer. Some rendering tests inspect source text and static server markup rather than exercising interactive save failure/success in a browser, so they do not fully protect the feedback path.
- **Scope discipline — 4/5.** The production diff is limited to App and Library screen wiring and uses existing shared modules. The test expansion is large but directly related. Increasing an already near-limit screen file is the main scope-structure miss.
- **UX/accessibility — 3/5.** Browser QA at 1440, 1024, and 768 found no page-level horizontal overflow. Controls have labels, saved feedback uses `role="status"`, failures use `role="alert"`, and deterministic approval exposes no misleading selects. The Settings page is excessively long and repeats the same shared scout policy seven times; Skill source sections are open by default and show overlapping long excerpts, which weakens information hierarchy and scanability.

## Candidate I — Dashboard progress and shared table spacing

Candidate I is a repaired, mostly sound visual patch. It derives progress from unique valid completed stages, provides truthful ARIA values, binds the value to a real conic-gradient ring, contains table overflow, and adds scoped spacing hooks. It changes six files with 582 insertions and 88 deletions, including 258 new test lines.

- **Functional correctness — 3/5.** `getCompletedStageProgress` filters to known workflow stages, de-duplicates them, and computes a 0–100 percentage (`src/domain.ts:474`). Command Centre uses that count for visible and ARIA state (`src/components/CommandCentre.tsx:59`, `src/components/CommandCentre.tsx:153`), and the repaired CSS consumes `--workflow-progress` in a conic gradient with an explicit complete state (`src/styles.css:714`, `src/styles.css:735`). The shared table still has avoidable internal horizontal overflow at 1440: browser measurement found a 1,165px viewport with 1,184px scroll width, so a scrollbar is visible even with an empty table.
- **Acceptance coverage — 4/5.** The 0/10, partial, normalized, and 10/10 progress cases are covered; ARIA minimum, maximum, current value, and value text are present. Table overflow stays contained at 1024 and 768, and scoped selectors address Grill Me, Implement, repair lineage, approval, and context surfaces with 14px body and 12px metadata. The unnecessary 1440 table scrollbar prevents full marks.
- **Regression safety — 4/5.** Evaluator runs passed lint, typecheck, all 59 tests, build, Sites packaging tests, and `git diff --check`. Page scroll width equalled viewport width at 1440, 1024, and 768. Parallel evaluator test runs emitted Vite HMR port-collision messages, but every test passed and the collision was caused by the evaluator running B and I concurrently.
- **Code clarity — 4/5.** Progress normalization is a small named domain helper and the component uses explicit derived variables. The viewport wrapper makes overflow ownership apparent. Styles are grouped by the target workflow surfaces.
- **Maintainability — 3/5.** The patch adds 221 lines to the already 7,319-line stylesheet and 23 lines to the already oversized domain module instead of extracting a focused visual helper/style module. `RuntimeTaskWorkspace.tsx` also remains over 2,200 lines. This is understandable for a focused polish patch but does not follow the repository's modularization direction.
- **Architecture/contracts — 4/5.** `workflowStages.length` is the source for counts and ARIA maximum, and persisted `completedStages` rather than current-stage position drives progress. The optional `RecentTask` fields preserve compatibility. The hard cap also includes a redundant literal `10`, which could drift if the workflow count changes, but current behavior is correct.
- **Test quality — 4/5.** The tests protect zero, partial, duplicate/unknown, over-complete, and complete progress; after the revision-1 failure they explicitly assert that CSS consumes the custom property and styles completion. Rendering tests cover ten table columns and the new stage hooks. They do not perform layout measurement, so they missed the 19px 1440 table overflow.
- **Scope discipline — 4/5.** Changes remain within the requested dashboard, table, stage spacing, domain adapter, styles, and focused tests. The large stylesheet append and 258-line test addition are proportionally heavy but on-topic.
- **UX/accessibility — 3/5.** The ring is visually truthful and exposes a useful `aria-valuetext`. Browser QA confirmed no page-level overflow and contained scrolling at narrow widths. The persistent table scrollbar at 1440 is visibly noisy and contradicts the intent to avoid unnecessary overflow at that viewport. The evaluator had no anonymized populated task dataset, so row density and every live workflow surface were judged from source/render tests rather than a full populated browser state.

## Candidates without revisions

A, C, D, E, F, G, and H receive 1/5 in every dimension because there is no implementation diff, candidate head, verification record, or gate evidence to inspect. Their means are delivery scores, not code-review opinions. In particular, no Structured activity variant produced an assessable candidate, so this campaign supplies no blind quality evidence for that issue.

## Blind verification evidence

For B and I, the evaluator ran:

- `npm run lint`
- `npm run typecheck`
- `npm test`
- `npm run build`
- `npm run test:sites`
- `git diff --check`

All commands passed after deterministic reconstruction of the malformed bundle patches. Candidate B passed 64 repository tests plus four Sites tests. Candidate I passed 59 repository tests plus four Sites tests. Both builds produced the required Sites artifacts and only the existing large-chunk warning.

Browser QA used a real local companion and Vite server at approximately 1440px, 1024px, and 768px. Candidate B's Agent detail, shared-scout state, deterministic approval, Skill provenance, and Settings editor inventory were inspected. Candidate I's Command Centre, progress ARIA/style, page overflow, and contained table overflow were inspected. Screenshots were retained outside committed source evidence under each disposable worktree's ignored `output/playwright` directory.

## Revealed comparison

The private map was first read after locked-score commit `1519efbd91265f3da31ac3ff19b3919eed00c4f9`. It maps the opaque labels and task IDs as follows:

| Issue | H — hybrid | X — all Luna XHigh | M — Max hybrid |
| --- | --- | --- | --- |
| Dashboard progress | I · AH-001 | A · AH-002 | D · AH-003 |
| Agent and Skill contracts | C · AH-004 | B · AH-005 | E · AH-006 |
| Structured activity | G · AH-007 | H · AH-008 | F · AH-009 |

H uses Luna XHigh for production roles and Sol High for plan, repair, Dev Review, and Final Review. X uses Luna XHigh for every model-driven role. M uses Luna Max for production roles and Sol High for plan, repair, Dev Review, and Final Review. The mapping records the Max variant as model `gpt-5.6-luna` with reasoning `max`; it is a reasoning-policy variant of the same catalog model ID, not evidence of a separate provider.

“First gate” below means the first recorded candidate-bound Dev Review verdict. `Not reached/unrecorded` is not counted as either pass or failure. There were zero recorded first-pass `PASS` results: I recorded `REPAIR`, B reached Dev Review but its three runs exceeded 240 seconds without producing a verdict, and the other seven tasks never assembled a candidate.

### Dashboard progress

| Policy | Label · task | Locked quality | Candidate | First gate | Repairs | Completed | Wall time | Terminal blocker |
| --- | --- | ---: | --- | --- | ---: | --- | ---: | --- |
| H | I · AH-001 | 3.67 | revision 2 | REPAIR on revision 1 | 1 | No | 54.2 min | Revision-2 Dev Review exceeded 240 seconds on repeated attempts |
| X | A · AH-002 | 1.00 | None | Not reached | 0 | No | 44.8 min | Work package S2 exceeded 600 seconds |
| M | D · AH-003 | 1.00 | None | Not reached | 0 | No | 43.4 min | Work package S2 exceeded 600 seconds |

| Policy | Input | Output | Cached input | Cache rate | Work credits | API-rate estimate | Context size |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| H | 11,275,127 | 77,868 | 10,573,824 | 93.8% | 52.753 | $3.720369 | 126,840 chars · ~31,716 tokens |
| X | 2,187,310 | 32,913 | 1,983,232 | 90.7% | 2.999 | $0.184421 | 61,976 chars · ~15,498 tokens |
| M | 2,628,094 | 50,716 | 2,335,488 | 88.9% | 10.208 | $0.493937 | 75,797 chars · ~18,953 tokens |

H is the only Dashboard policy that produced an assessable patch, and the repaired patch scored 3.67. That is a delivery signal worth retesting, not a quality win: its first review found a P1, its repaired revision never obtained a fresh verdict, and it consumed more resources because it progressed through assembly, review, and repair while X and M stopped in Implement. The usage rows are therefore stage-depth-censored and cannot establish relative efficiency.

### Agent and Skill contracts

| Policy | Label · task | Locked quality | Candidate | First gate | Repairs | Completed | Wall time | Terminal blocker |
| --- | --- | ---: | --- | --- | ---: | --- | ---: | --- |
| H | C · AH-004 | 1.00 | None | Not reached | 0 | No | 86.1 min | Work package S4 exceeded 600 seconds |
| X | B · AH-005 | 3.78 | revision 1 | Unrecorded | 0 | No | 69.1 min | Dev Review exceeded 240 seconds on repeated attempts |
| M | E · AH-006 | 1.00 | None | Not reached | 0 | No | 41.9 min | Work packages S1 and S2 exceeded 600 seconds |

| Policy | Input | Output | Cached input | Cache rate | Work credits | API-rate estimate | Context size |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| H | 6,900,065 | 80,231 | 6,475,008 | 93.8% | 13.982 | $0.778371 | 116,438 chars · ~29,113 tokens |
| X | 14,145,624 | 118,206 | 13,419,520 | 94.9% | 13.886 | $0.979397 | 146,438 chars · ~36,614 tokens |
| M | 3,688,461 | 57,729 | 3,354,368 | 90.9% | 12.978 | $0.641528 | 82,258 chars · ~20,568 tokens |

X is the only policy that produced an assessable Agent and Skill patch, which scored 3.78 and passed every evaluator-run check. It still has no candidate-bound review verdict, so the result supports a larger X trial only after the timeout path is fixed. X's higher token and context totals reflect deeper progress and five assembled work packages; they cannot be compared as like-for-like execution cost against earlier H and M failures.

### Structured activity

| Policy | Label · task | Locked quality | Candidate | First gate | Repairs | Completed | Wall time | Terminal blocker |
| --- | --- | ---: | --- | --- | ---: | --- | ---: | --- |
| H | G · AH-007 | 1.00 | None | Not reached | 0 | No | 48.1 min | Work package S3 exceeded 600 seconds |
| X | H · AH-008 | 1.00 | None | Not reached | 0 | No | 56.7 min | Work package S3 exceeded 600 seconds |
| M | F · AH-009 | 1.00 | None | Not reached | 0 | No | 45.0 min | Work package S1 exceeded 600 seconds |

| Policy | Input | Output | Cached input | Cache rate | Work credits | API-rate estimate | Context size |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| H | 6,294,241 | 72,817 | 5,871,360 | 93.3% | 13.797 | $0.737472 | 98,877 chars · ~24,722 tokens |
| X | 6,972,561 | 92,652 | 6,460,160 | 92.7% | 8.572 | $0.564419 | 116,529 chars · ~29,137 tokens |
| M | 4,098,672 | 68,414 | 3,727,872 | 91.0% | 12.825 | $0.646513 | 86,621 chars · ~21,658 tokens |

No Structured activity policy produced a patch. Token, cache, credit, cost, and wall-time differences measure three censored failures rather than quality or successful throughput. This issue is too confounded to interpret and should not influence a model-policy recommendation.

### Campaign totals by policy

The quality mean below is delivery-weighted: absent candidates retain their locked 1.00 scores. It is not a mean over comparable completed patches.

| Policy | Locked mean | Assessable candidates | Completed | Repairs | Wall time | Input | Output | Cached input | Cache rate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| H | 1.89 | 1/3 | 0/3 | 1 | 188.4 min | 24,469,433 | 230,916 | 22,920,192 | 93.7% |
| X | 1.93 | 1/3 | 0/3 | 0 | 170.5 min | 23,305,495 | 243,771 | 21,862,912 | 93.8% |
| M | 1.00 | 0/3 | 0/3 | 0 | 130.3 min | 10,415,227 | 176,859 | 9,417,728 | 90.4% |

| Policy | Work credits | API-rate estimate | Aggregate context size |
| --- | ---: | ---: | ---: |
| H | 80.532 | $5.236212 | 342,155 chars · ~85,551 tokens |
| X | 25.458 | $1.728237 | 324,943 chars · ~81,249 tokens |
| M | 36.012 | $1.781978 | 244,676 chars · ~61,179 tokens |

H and X each produced one assessable candidate and completed none; their delivery-weighted means differ by only 0.04 and come from different issues. M consumed less wall time and fewer tokens but produced no candidate, so the lower totals are failure truncation rather than evidence of efficiency. H's much higher credit and API estimate is dominated by the Dashboard run that reached review and repair. Aggregate context sizes likewise grow with stage depth and are not controlled prompt-size measurements.

## Limitations and confounds

- This is one task per issue-policy cell, with no completed task and only two assessable patches. No statistical significance or stable ranking can be claimed.
- Seven outcomes are censored by 600-second implementation timeouts. The two assembled candidates are censored by 240-second Dev Review timeouts. Timeout behavior is the dominant campaign outcome.
- H and X share Luna XHigh for many production stages; they differ most at planning and review gates. A paired outcome therefore does not isolate one model from work-package decomposition, gate behavior, or timeout sensitivity.
- Candidate depth differs substantially. Wall time, tokens, cache, credits, API-rate estimates, and context size are not normalized to the same completed stage frontier.
- B has no recorded candidate-bound verdict despite three Dev Review attempts. I's revision-1 verdict is stale for repaired revision 2. First-pass and eventual gate success are therefore mostly unavailable, not negative measurements.
- The anonymized B and I diffs were malformed unified patches. The evaluator repaired serialization only, but future bundles should pass `git apply --check` before READY is published.
- Browser evaluation of I used the truthful empty local state because the anonymized bundle did not include a populated browser fixture. Source and render tests covered populated rows and workflow surfaces, but the evaluator did not claim full live-state visual coverage.

## Recommendations

1. **Run a larger balanced trial of H and X only after fixing the timeout and evidence path.** Both produced one assessable candidate across three attempts, on different issues. Repeat frozen small, medium, and high-risk briefs enough times to measure candidate yield, first-pass gate success, repairs, completion, and normalized per-stage usage. Keep blind scoring and exact policy snapshots.
2. **Treat M as a bounded diagnostic variant before a larger trial.** M produced zero candidates in three runs. Start with low-risk, single-package tasks and determine whether Luna Max work regularly exceeds the 600-second slice limit. Do not infer low quality from this campaign, but do not spend a full suite until candidate yield is demonstrated.
3. **Repair campaign infrastructure before comparing model quality.** Make timeout causes and partial outputs durable, validate bundle diffs with `git apply --check`, ensure every candidate-bound attempt records a verdict or explicit timeout result, and distinguish not-reached, timed-out, first-pass failure, repaired pass, and completed gates in the experiment manifest.
4. **Rerun the two surviving patches through fresh candidate-bound gates.** For I, remove the unnecessary 1440 table scrollbar and rerun Dev Review and Test on revision 2 or a successor. For B, remove duplicate shared-scout controls, extract the oversized contract panel, make post-save refresh failure truthful, and run Dev Review and Test.
5. **Keep cost interpretation stage-normalized.** Compare tokens, work credits, API-rate estimates, cache rate, wall time, and context size only at a common stage frontier or per successful candidate/gate. Continue labeling dollar values as API-rate estimates, not attributable ChatGPT-plan charges.

The human decision is whether to prioritize H's evidence of repair-capable delivery or X's evidence of a slightly higher-scoring first assembled patch. This sample does not justify choosing between them. The safest next step is an infrastructure-corrected H-versus-X trial, with M retained as a small diagnostic arm.
