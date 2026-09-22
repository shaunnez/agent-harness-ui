# Task workspace design evaluation

21 September 2026 · Visual refinement requested · No application implementation

## Outcome

Recover the clarity and panel definition of the original Mission Frontier designs inside one consistent task workspace. Preserve stage-specific work surfaces and every current runtime safeguard. The user's confirmed preference is clearer, more cohesive panels; navigation placement remains open.

This evaluation uses the eleven supplied screenshots, `src/frontier/views/TaskPanel.tsx`, `src/frontier/ui/task-workflow.css`, the current repository instructions and `DESIGN-SPEC.md`. The screenshot values and proposed controls are illustrative, not evidence of recorded runtime state. The original designs are visual references rather than implementation instructions.

## Assessment

The current screen already has borders. The problem is that too many regions have similar surface colour, border strength and textual emphasis. The repeated task title and description, general “Working” banner, nested package metadata, candidate notice and empty evidence area compete for attention. Meanwhile a small number of important facts—what is running, what it depends on and what needs the operator—lack a strong visual centre.

The concepts improve this through deliberate grouping, panel headers, stronger type hierarchy, aligned subdivisions, inset evidence and a clear primary action. The world and robot art contribute identity. Following Shaun's review, give that identity greater prominence through illustrated scout cards, a portrait-led Grill introduction, stronger worker portraits and a bounded workshop image for Implement. Preserve space for operational content and label concept illustrations so they do not imply a live worker feed.

| Reference | Retain | Normalise or correct |
| --- | --- | --- |
| 1 — current Implement | Recorded-state honesty, stage access restrictions, policies, safeguards, usage | Repeated identity, equally weighted surfaces, long metadata-first package view |
| 2 — original Implement | Current package emphasis, package relationships, distinct candidate region | Large scenic hero, separate bottom evidence layout, ambiguous package readiness counts |
| 3 — Scouts | Selected/skipped coverage, distinct scout runs, accumulating synthesis | Large repeated portraits; summed agent time must be separate from task elapsed time |
| 4 — Grill | One question, repository evidence before answers, recommendation rationale, decision history | Detached progress footer and unique modal shell; keep answer controls beside the form |
| 5 — Design review | Side-by-side directions, full preview, selected-provider provenance | Keep this optional subflow between Grill and Specification, not an eleventh stage |
| 6 — Specification | Wide rendered document, source access, section hierarchy, decisions | Primary actions move to the shared command bar; approval availability follows current backend eligibility |
| 7 — Plan | Dependency batches, ownership and interface detail | Do not add a fourth permanent column or world thumbnail; move selected-package detail into the centre |
| 8 — Dev review | Findings list, issue/impact/correction detail, candidate lineage | Separate implementation self-score from independent review verdict; shared action placement |
| 9 — Tests | Mixed results, useful assertion/log detail, global repair/retry controls | Retain the same stage navigator and inspector; distinguish failed execution from a code defect |
| 10 — Approval | Exact candidate, gate freshness, journey, approval note, diff access | Only show evidenced checklist assertions; keep Final review separate from Human approval |
| 11 — Delivery | PR identity, last check, approved → PR opened → merged sequence | The three delivery steps are content within Approval, not a replacement task navigator |

## Navigation recommendation

Recommend a horizontal stage navigator spanning the whole workspace above the centre and inspector. Use one stable order and vocabulary across all ten stages: Triage, Scouts, Grill, Specification, Plan, Implement, Dev review, Test, Final review, Approval. Full role names remain available in stage headings and accessible labels.

| Choice | Benefit | Cost |
| --- | --- | --- |
| Top, recommended for evaluation | Gives plans, code and documents the width currently consumed by the left rail; workflow reads in sequence | Uses a band of vertical space; ten labels require a full-width treatment and a deliberate narrow-window fallback |
| Side | Long names and per-stage state fit naturally; preserves more centre height | Permanently consumes about 172px plus its gap; compounded by the right inspector, it squeezes the main work |

The present grid is `172px minmax(0, 1fr) 290px` with two 14px gaps. At the same outer width and inspector size, removing the left rail returns about 186px to the centre. That is a geometric consequence, not a measured usability result.

At normal laptop and desktop widths, show all ten labelled steps in one row across the full shell. Do not fit them only above the centre. Use quiet completed markers, a clear viewed-stage selection, and a separate label for the active stage when inspecting history. Future stages stay inert. An exceptional state must not look like a completed step.

At compact overlay widths, use a labelled stage selector with current-stage context, rather than tiny text or a wrapped two-row workflow. Keep navigation placement stable across stages. Treat a user-selectable top/side option as a design-study comparison, not an automatic new product preference setting.

## Shared shell

1. Task identity header: project, task ID and title once; Role policies, Manage and Pin in a stable utility group. Existing window controls and Return to world remain owned by the overlay.
2. Full-width stage navigation.
3. Stage command bar: stage name, precise task state, short Now/Next text and one primary eligible action. Explain unavailable actions beside the control. Keep this above scrolling evidence.
4. Work area: flexible centre and approximately 280–300px inspector at normal desktop widths. Inside the centre, use at most two local regions such as result list and selected result. The global inspector never becomes a competing third local detail view.
5. Run activity: collapsed by default at the foot of the centre, with Activity, Agent runs, Test runs and Decisions filters. Stage artifacts remain available with their stage; do not bury them only in telemetry.

The inspector uses the same open sections and order: brief/outcome, role and run, usage, safeguards, supplied context/repository, recorded decisions where applicable. Avoid repeating the full title and description. Show task usage versus selected-run usage explicitly. Keep supplied context separate from permission to read the repository. No inspector accordions.

Selected packages, findings and tests own their detail in the centre. The inspector always refers to the task and viewed stage, with a named selected run when relevant. A historical view explains what is being inspected and where active work remains; historical content does not acquire current-stage mutation actions.

## Visual contract

- Fixed Mission Frontier dark palette for the study: deep ink shell, slightly lighter panel, darker inset code/evidence. Opaque reading surfaces keep the world from interfering with content.
- A visible but restrained one-pixel border defines each meaningful panel. A separated header identifies its job. Use row dividers inside panels, not a fresh card around every field.
- Three surface levels and no more than two panel nesting levels. Selected items use a blue border and restrained fill; reserve amber for a required decision/wait and red for failure/repair. Pair every colour with text or an icon.
- Body and controls 14–16px; metadata at least 12px. Stage headings 20–24px; panel headings 14–16px. Use regular/medium weight and consistent line height.
- Use a shared 8px spacing rhythm: 8px between related controls, 12–16px panel gaps, 16–20px panel padding. Shared modest corner radii of about 6–8px.
- Primary actions consistently appear in the stage command bar. Local form submission remains near the edited fields, with the command bar linking to that form rather than duplicating an independent submission path.
- Use prominent robot imagery where it establishes the worker or role: scout cards, Grill introduction and the inspector. Implement may use the user-supplied workshop illustration in a bounded banner; identify it as an illustration and keep recorded task state outside the image. Match its character and framing without assuming the art represents the current live scene.
- Use one consistent outline-icon family for section headings, actions, package metadata and artifact access. Icons supplement text labels. Specification sections use Outcome, Scope, Acceptance criteria and Verification symbols; acceptance criteria use numbered markers.
- Show the plan as three clearly bounded dependency batches with connected, selectable package cards. S1 branches to S2 and S3 in parallel, then both join S4. The selected card and its relevant dependency paths share a blue emphasis. Package details must change with selection, including ownership, interfaces, dependencies, verification and role policy. All nodes remain explicitly Planned until recorded execution exists.
- Visible keyboard focus, semantic controls, readable disabled explanations and preserved drafts are part of acceptance.

## Centre templates across stages

| Stage/surface | Dominant work area | Supporting detail |
| --- | --- | --- |
| Triage | Outcome, scope/risk and routing decision | Retained triage report and source references |
| Scouts | Selected run list/cards with actual run state | Selected scout evidence, selected/skipped coverage and synthesis status |
| Grill | One question, source evidence, answers and rationale field | Compact accumulated decisions; keep the universal inspector intact |
| Optional design review | Two provider directions and selected preview | Selection rationale and provider/model/context provenance |
| Specification | Readable rendered document with Source alternative | Scope, acceptance and verification sections; version identity |
| Plan | Dependency batches and selectable packages | Purpose, owned paths, interfaces, dependencies and checks |
| Implement | Actual package states and selected package/diff | Candidate assembly and slice qualification; integrated differs from ready for integration |
| Dev review | Findings list and selected finding | Issue, impact, smallest correction, candidate and repair lineage |
| Test | Result list and selected assertion/log | Recorded pass/fail/skip totals, commands and skipped reasons |
| Final review | Journey and candidate-bound readiness | Actual stage outcomes, usage and invalid/stale gates |
| Human approval | Exact candidate, current gates and diff access | Approval note and explicit PR publication confirmation |
| PR delivery | Exact PR and delivery state | Last verified check, history and retained artifacts |

Use these as a small family of content patterns within the shared shell. Do not force every stage into the same generic metadata card, and do not redesign the shell for each pattern.

## Retained capability register

| Capability | Treatment |
| --- | --- |
| Ten stages; past/current/future access | Keep; one navigator and canonical recorded-state rules |
| Role/model/reasoning policy access | Keep in header utilities; preserve task snapshots and started-run restrictions |
| Task management, pinning, cancel, retries | Keep in existing eligible actions; do not invent new execution endpoints |
| Worker and package inspection | Keep; compact identity plus Watch access, centre detail for selected package |
| Artifacts, raw source and candidate diffs | Keep; wide read-only viewer with exact origin and return path |
| Safeguards, attempts, repository authority | Keep visible in open inspector sections |
| Context manifests and truncation | Keep inspectable; never equate permission with context actually used |
| Tokens, cache, elapsed and approximate cost | Keep; unavailable remains unavailable and API-rate estimate stays labelled |
| Candidate revisions, stale gates and repair lineage | Keep in stage content; never mark downstream stale evidence as current approval |
| Task versus run waiting/executing state | Keep distinct, including finished runs leaving tasks awaiting decisions |
| Activity/history/evidence pagination | Rehome in the shared evidence/activity access; retain earlier-record loading |
| World/HQ, appearance, companion and backend | Outside this design change; preserve existing integration |

## State qualification and delivery slices

Before implementation is accepted, review normal desktop and laptop layouts with running, decision-needed, dependency-waiting, failed, repair-required, stale candidate, disconnected, unavailable evidence, historical and completed states. Include long titles, many packages, long diffs and multiple scout runs. Verify local scrolling, keyboard access and persistent access to the next safe action. No extreme-zoom redesign is proposed.

1. Review this proposal and the interactive study. Choose top or side navigation and confirm panel treatment.
2. Implement the shared shell and prove Implement, Grill and Test: these exercise wide work, focused input and exception handling.
3. Apply the same content primitives to remaining stages and the optional design/delivery subflows; preserve every item in the capability register.
4. Qualify against fixture scenarios and existing runtime contracts, then inspect live recorded tasks through the existing companion without starting work or publishing.

Application implementation, PR creation and publication require their own task scope. This evaluation does not replace the existing design contract or mark a proposed recommendation as accepted.

## Study verification

### First study

The accompanying interactive study is explicitly fictional and has no backend/network mutation path. It is available in this task's response and in the local preview at `http://127.0.0.1:5279/` while that preview server is running.

- Rendered all twelve study screens at a 1280px browser width; each produced its expected heading and content with no root horizontal overflow.
- Checked Grill, Implement and Test in both navigation modes at 1440px, 1024px, 390px and 320px browser widths. No root horizontal overflow or horizontal clipping was detected in their visible controls, panels and code blocks. Small widths use a stacked fallback, not a separate mobile design.
- Exercised package selection, finding selection, historical-stage navigation, return to the active stage and preservation of a Grill draft while opening activity.
- Inspected rendered Implement, Review and Test layouts in the browser. No page warnings or errors were captured during the initial twelve-screen run.

These checks qualify the study, not the application. The inline study grows vertically to fit its host; fixed-window local scrolling, sticky commands, full keyboard/focus behaviour, all exceptional runtime states and live task parity remain implementation acceptance work. No application build or runtime test suite was required or run for the documentation and isolated study.

### Visual refinement after review

Shaun accepted the high-level direction and requested the original designs' robot imagery, icons and batch/package presentation. The revised study now includes:

- Existing standard robot portrait art in the inspector, illustrated scout cards and a portrait-led Grill introduction.
- The supplied `Screenshot 2026-09-21 at 12.16.15 PM.png` workshop image as an Implement banner, visibly labelled Concept illustration. The source image is embedded unchanged; it is not a new production scene or live worker feed.
- Consistent outline icons on section headings, actions and plan metadata; numbered Specification acceptance criteria.
- A responsive S1 → S2 + S3 → S4 diagram with dashed batch containers, arrowed dependencies, selection emphasis and package-specific detail. Selecting any of the four packages updates its purpose, owned files, interface, dependencies, verification, notes and expected output.

Verification: the final script passed syntax checking; all twelve screens rendered at 1280px with loaded imagery, rendered icons and no root horizontal overflow. Scouts, Grill, Specification, Plan and Implement were checked in both navigation modes at 1440px, 1024px and 320px (30 combinations), with no detected horizontal overflow or clipping in visible panels and controls. All four plan selections displayed the matching detail and retained four dependency connections. An initial preview syntax error was corrected before this verification. Visual inspection covered the plan, scout cards, Grill, Implement and Specification.

Artwork and icon additions do not change the retained workflow semantics. The application and its runtime remain outside this study update.

## Later-stage refinement, grounded in current code

Shaun requested Implement, Dev review, Test, Final review and Approval under the same established design. His latest instruction gives the current code and this study precedence over the older reference images. This pass updates the interactive proposal, not application source or workflow behavior.

The code was inspected on local `main` at `48ca6b5`. The records, repository names, file paths, counts and revision identifiers in the study are fictional examples of these contracts, not observations of a live task.

| Current source | Grounding used in the study |
| --- | --- |
| `src/frontier/views/WorkPackages.tsx` and `src/domain/runtime.ts` | Dependency batches, selected package, owned paths, dependencies, verification, attempts, slice commit, retained worktree and run access. Preserve `ready_for_integration` versus `integrated`; waiting is derived from planned dependencies. |
| `src/frontier/views/CandidateEvidence.tsx` | Candidate revision/head/target, exact diff access, integrated slices, gate evidence, repair history, selected test assertions/output, prior-stage journey and PR delivery identity. |
| `src/frontier/views/StageEvidence.tsx` | Independent gate verdict, typed finding severity/kind, detail, file/line, reproduction evidence and acceptance criterion. Suggested code is explicitly unapplied. |
| `src/components/runtime/runtimeCommandPolicy.ts` and `src/frontier/runtime/workflow.ts` | An execution failure alone does not authorize code repair. The test example includes a candidate-defect finding; repair/retry controls stay global and eligibility-driven. Historical evidence does not gain mutation controls. |
| `src/components/runtime/operatorFinalReviewModel.ts` | Eight prior stages, usage aggregation, key outcome and candidate freshness. Unsupported pricing appears once beside the journey. |
| `src/frontier/views/WorkflowCommand.tsx` | Exact candidate-bound approval, operator note, identity/eligibility revalidation, and explicit publication action. The current app offers Proceed / Proceed with reason; the study's consolidated approval review is a proposed presentation of that existing boundary. |
| `src/frontier/runtime/diff.ts` | File-grouped unified diff lines with old/new line numbers and addition/removal/context distinction. Inline placement reuses the existing candidate-diff capability; no package-diff endpoint is assumed. |

The old tests image includes skipped rows. `RuntimeFocusedTestRow.status` currently permits only `passed` and `failed`, so the revised structured list uses those states. Any skip explanation remains in retained output unless the underlying contract changes. Likewise, a structured implementation rubric is not invented; the implementation report remains distinct from the independent review verdict.

### Stage treatments

- **Implement:** the same connected four-package plan now shows execution states. S1 is integrated, S2 runs, S3 is ready for integration, and S4 waits for both parallel slices. A clearly labelled study snapshot switches to an assembled candidate, enabling a main-canvas diff excerpt. The worktree path and slice qualification remain local package detail; the shared inspector remains stage-scoped.
- **Dev review:** portrait-led reviewer identity, two selectable severity-labelled findings, issue/impact, reproduction, acceptance linkage and an unapplied code suggestion. Current C1 r1 and a possible future repair are visually distinct; the future revision is not represented as already created.
- **Test:** four selectable recorded checks with command, duration, exit code, candidate, expected/actual values and retained output. Back to results clears selection. The C1 r2 example has a fresh passed Dev review but fails source preservation; Final review has not started. Revision history retains the earlier review evidence.
- **Final review:** candidate-bound gate cards, all eight prior stages with tokens, summed agent time and outcome, acceptance/readiness summary, and retained artifacts. The fictional journey totals 134K tokens plus 10K for Final review, matching the 144K task total. Prior-stage agent time is 26m 50s plus 2m Final review, distinct from 18m 42s task wall time.
- **Approval:** exact head and target, current evidence checklist, approval note, read-only diff access and a publication review preview. A separate illustrative delivery state shows awaiting PR merge; the mock confirmation never approves, pushes or opens a real PR.

The inspector, navigation choices, command placement, panel borders, colour semantics and icon family are preserved. Earlier screens and the existing PR-delivery surface remain available.

### Verification of this refinement

- The final script passed syntax checking. The fragment is approximately 674KB and reuses the existing embedded artwork.
- Implement, Dev review, Test, Final review and Approval were checked in both navigation modes at 1440px, 1024px and 320px browser widths: 30 combinations, with no detected root horizontal overflow, clipped visible controls/panels, unloaded imagery or missing icons. The wrapper consumes 32px, so content widths were 1408px, 992px and 288px respectively.
- Browser checks covered all four package selections and four dependency connections; the assembled-candidate snapshot and file switching; both review findings; passed and failed test detail, Back to results and disabled same-candidate retry; prior-stage evidence inspection; exact-revision diff and approval review; approval-note retention; and the explicitly simulated transition to awaiting-merge delivery.
- Desktop visual inspection covered all five requested stages at normal 1280–1440px widths. The final browser session reported no warning/error entries during the checked interactions.
- No application build, backend execution or live task mutation was run. These checks qualify the interactive design study, not implementation or live workflow parity.
