# HUD depth design QA — 15 September 2026

Result: passed for the requested HUD component scope at normal 1488×1058 and 1280×720 viewports.

Reference/implementation comparison: [depth-comparison.png](design/mission-frontier/build-evidence/HUD/depth-comparison.png). Full laptop and desktop captures: depth-hq-answer-1280.png and depth-hq-answer-1488.png in the same evidence directory. Both were inspected after the final column alignment and control-width corrections.

Implemented anatomy: nested identity/actions/artifacts panel, inset Usage row, horizontal Skill/Model divider and vertical field divider, existing portrait, eligible primary action, Inspect and existing policy destination. Headquarters and World share the bottom-right New task/Agent roster/Skills/Settings controls. Both left panels use x=12px and width=235px; all bottom controls share the bottom=35px baseline. Minimap preserves the actual scene with aspect containment, a dark framed surface, higher-resolution capture and actual project-position markers.

Corrected during inspection: headquarters dock inherited an 880px cap, primary controls wrapped too tightly, project counts wrapped inconsistently, a landmark used the floating label coordinate, and the screenshot clipping output was unsuitable. Final comparison uses a crop of the inspected full screenshot.

Intentional differences: the reference task, usage values and future artifact tiles are concept data. Runtime data remains authoritative; no empty artifact placeholders or invented costs were added. The reference's connected coastal cartography is different artwork from the actual world. This pass improves its HUD presentation without altering scenery, assets, animation, camera or lighting behavior.

Keyboard dismissal, running/blocked selection, artifact viewer, Configure agent safeguards, HQ project defaults in New task, and the three management destinations were checked through computer use. Earlier full HUD acceptance remains dated in build-evidence/HUD/ACCEPTANCE.md. No performance benchmark or extreme zoom was used.
