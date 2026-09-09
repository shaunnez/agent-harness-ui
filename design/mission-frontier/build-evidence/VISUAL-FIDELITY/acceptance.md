# Goal 3 acceptance

Qualified 6 September 2026. Result: ready for Shaun's visual review; no claim of Shaun's acceptance. Scope is one cinematic island, reusable parts and preserved v1 functionality. No unresolved P0/P1/P2 finding remains within that scope.

| Requirement | Evidence and observation | Status |
| --- | --- | --- |
| V0 authority/reference baseline | Verified checkout/remote/dirty files and service owners; before/ plus baseline-files.json and baseline-presentation.tar.gz; five reference images inspected | Pass |
| V1 camera, alpha and registration | Root and Astra calibration rendered in app; final metadata and cinematic-assets tests validate source/hash/dimensions/anchors/contact | Pass |
| V2 one island at all scales | after/world-1568.png, hq-1567.png, agent-1568.png; independent terrain, bridge, tree/shadow, roof, workers and semantic UI | Pass |
| V3 visible refinement | Full and focused reference/baseline/current comparisons in comparisons/; root design-qa.md records iterations and retained differences | Pass |
| Running / answer / repair | HQ presents PC-142, PC-153 and PC-148 together; agent-needs-answer/agent-repair PNG and text show task, stage, reason, next actor and relevant action | Pass |
| Dependency | PC-142 package S3 is waiting on S2; task/package drill and Back to packages retained; dependency is not an operator answer | Pass |
| Approval / completed | agent-approval.txt, approval-action.txt; agent-completed-run.txt explicitly parks prior Plan run while current Implement is working; completed-selected.txt shows no invented active run | Pass |
| Disconnected | after/disconnected.png and disconnected-performance.json preserve last-known state with activeWorkers0 and tickerRunningfalse | Pass |
| Canvas / camera | Actual project double-click, three worker picks, pan/zoom/minimap/Fit; artifact visible area opens retained evidence; corrected transparent hit bounds prevent interception | Pass |
| Readable controls / focus | UI reasons and actions stay outside artwork; raw artifact source toggle; panel close restores Inspect task focus; keyboard utility paths and local scroll remain reachable | Pass |
| Management and task creation | Projects/Agents/Skills/Usage/Settings opened; task search/filter and stage/package/artifact drill checked; phone creation wizard reached role configuration and final review, without launching a paid run | Pass |
| Model/reasoning / usage | Future role controls available; historical policies locked; task and run token/time/cache fields and Approx. cost semantics preserved | Pass |
| Viewports | Reference World/Agent1568×1003,HQ1567×1004; all three1488×1058,1280×720;390×844task/wizard fallback captures in after/ | Pass |
| Animation | animation/in-app-worker.gif, strip and16orderedframes over1.364s; fixed feet and tool reach observed. Motion-off identical crop pair | Pass |
| Performance | Normal and busy >=60s with camera work; selection<=100ms;20roundtrips;18.6027MiBwire;126.4375MiBmax observed decoded estimate | Pass; see performance.md |
| Native background / OS preference | Host hiding leaves document.visible; manual motion and unit lifecycle checked. Native hidden and OS preference switching not claimed | Environment-limited, as allowed by brief |
| Regression/build | 45frontier+8frontierAPI+4Sites=57pass,0fail,0skip; typecheck/lint/format and both builds pass; final two asset tests rerun after provenance-only fix | Pass |
| Provenance/rebuild/rollback | 21verified newPNG entries, editableblends, sourcearchives/licences, exactrebuildchain, art=classic rollback | Pass |
| Journal | New datedGoal3 post, originalstudy and olderposts retained; publication record belongs to journal-site/publication.json | Tracked by the confirmed publication record and final handoff |

## Evidence conditions

Canonical World baseline is before/world-1568-fit.png, not the initial unfitted resize capture. Reference study is conceptual and has illustrative content; its composition is not an identical runtime fixture. Baseline/current pairs share viewport, sample task state and Fit-world/default-detail camera setup; clocks naturally differ. Comparisons contain all three sources together plus matched focused crops. No CSS/HTML stand-in artwork was used.

Tests were run against final source; no new paid backend task was required or launched. The existing actual CLI investigation evidence remains in M3; M7's 1,040-test historical record is preserved separately. Full implementation/repair/PR dogfood remains future functional proof. Initial candidate-bound fixture actions remain disabled where the fixture lacks backend authority; this is not a broken UI control.

Read performance.md for the geometrically identical24sample lifecycle asset caveat and measurement methods. Console inspection of the final artifact returned no application errors. Wire capture recorded one empty favicon404. Existing main-chunk warning remains. Reduced-motion preference switching and true native page hiding are not available through the current browser controls; no native success is inferred from the unit tests.

## P3 and deliberate limits

- The original study still has denser, richer atmospheric composition. Terrain cliff layers remain stylised; new robot and ground are cleaner than retained weathered interiors. Review this character before expanding.
- Other project islands, cutaway floor/back/front layers and task stations intentionally retain v1 art. This goal does not recreate every room.
- At1280×720, agent content scrolls locally and the persistent navigation grazes the portrait's decorative left edge; heading/actions remain legible. Phone role tables use local horizontal overflow.
- The large main-chunk warning and favicon404 remain cosmetic/build follow-up. The game has not been pushed, merged or deployed.
