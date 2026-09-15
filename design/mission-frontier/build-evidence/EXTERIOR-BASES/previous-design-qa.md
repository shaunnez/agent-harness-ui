# 3D visual proof — design QA

16 September 2026. Final local proof qualified for artistic review, not a claim of original-design equivalence or user approval. Previous root QA is retained unchanged in `design/mission-frontier/build-evidence/3D-VISUAL-PROOF/previous-design-qa.md`.

## Source and actual comparison

- Source: `design/mission-frontier/reference/selected-world.png`, `screens/project-base-attention-v1.1.png`, `screens/agent-work-blocked-v1.1.png`.
- Actual previous app: `build-evidence/3D-VISUAL-PROOF/baseline-world.jpg`.
- Actual final app: `world-day.jpg`, `cutaway-day.jpg`, `world-dusk.jpg`, `world-night.jpg`, `world-laptop.jpg`, `cutaway-laptop.jpg` in the same evidence folder.
- Inspected combined artifacts: `final-comparison.jpg` and `cutaway-comparison.jpg`, with full scenes and enlarged focused crops. `make-comparisons.py` records the crop/scale method. Captures are actual browser output; the original is a generated study. The one-base proof deliberately differs in content scope from the multi-project reference.

## Material discrepancies fixed in the loop

| Finding | Correction and evidence |
| --- | --- |
| Plain early warehouse and repeated boulder edge | Curved stepped service bays, radial roof armor, recessed facade/court, scanned coastal outcrops. Iterations 1–4 retained; final compared at normal size. |
| Blank/tall interior and oversized consoles | Framed wall services, ergonomic console heights, floor service strips, bench and two useful work areas. Same exported structure remains behind the cutaway. |
| Scanned rims looked like floating sheets | Rejected boundary-fan closure; final inset scanned faces intersect solid textured contact volumes. Actual final browser checked against iteration-4-day.jpg. |
| Camera reset on runtime refresh | Stable Canvas construction options and narrow camera-effect dependencies; pan/follow persisted across refreshes. |
| Labels collided with each other/clock | Projected collision separation with leaders and laptop camera fit; final 1568×1003 / 1280×720 inspected. |
| Black minimap capture | Explicit HDR-to-byte copy before pixel readback; minimap and base previews inspected after view/light changes. |
| Missing GLB/context loss could strand a loading view | Timeouts, error boundary and explicit Retry/Return routes; missing model and real forced WebGL loss exercised in browser. |

## Remaining design distance

The concept remains richer in asymmetry, material wear, architectural details, ground cover, prop density and character detail. Broad rock backing and scan texture transitions remain visible; foliage and the reused robot are simpler. These are recorded artistic review points. This bounded proof establishes real geometry, coherent exterior/interior scale, portable materials, truthful controls and runtime light/water; it does not approve expansion or full migration.

The original contains a complete HQ, whereas this proof has two representative work areas. The accepted task dock may cover foreground scenery on a laptop and can be dismissed with Escape. No extreme-zoom design changes were made.

See `design/mission-frontier/build-evidence/3D-VISUAL-PROOF/acceptance.md` for scoped matrix, actual motion/recovery evidence and checks. Technical passes are not artistic approval.
