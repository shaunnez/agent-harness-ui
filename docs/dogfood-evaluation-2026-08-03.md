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

_Intentionally withheld until the locked blind-score commit exists._
