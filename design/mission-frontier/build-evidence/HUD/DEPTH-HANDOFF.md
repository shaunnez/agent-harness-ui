# HUD depth follow-up — 15 September 2026

Implemented the latest explicit screenshot feedback on the existing HUD branch, from clean revision 3b18fa1. The earlier simplification and alignment checkpoints remain historical in HANDOFF.md and ACCEPTANCE.md.

- Headquarters now retains World’s bottom-right New task / Agent roster / Skills / Settings panel. New task preserves the current project default; the other controls open existing destinations.
- Selection uses nested panels and dividers, an inset recorded Usage row, a small portrait, task identity/title/state, configured skill, recorded model, eligible primary action, Inspect and existing agent policies. Only persisted artifacts appear; reasons and waits remain optional details or full inspection.
- Project details and minimap share the same left edge and 235px width. The selection and action panels share their bottom baseline in World and HQ. Compact counts remain readable on a laptop.
- Minimap has a darker inset frame, aspect-contained higher-resolution actual scene capture and real project landmarks. Its underlying island artwork is unchanged and differs from the concept map.

Computer-use checks at normal 1488×1058 and 1280×720 covered World/HQ no selection, running/answer/repair selection, recorded wait details, artifact inspection, project-scoped New task, roster, skills, settings and policy safeguards. Escape dismissed overlays then selection. Earlier zero/multiple decisions and pins, persistence, long names and briefing acceptance remains valid; those contracts were not changed. Screenshots are depth-*.png; design-qa.md records the inspected source/implementation comparison.

Local checks: 84 Frontier tests, 18 Frontier API tests, four Sites tests, typecheck, lint, formatting and both builds passed. Existing bundle warnings remain. The first disposable API fixture run encountered the user’s interactive Git signing setup; the successful rerun disabled signing only through command-scoped Git environment values. Application signing safeguards and global configuration were unchanged. No real model, approval, full repository suite, remote CI, benchmarks or game publication was run.

Running preview: http://127.0.0.1:5207/?mode=fixture&scenario=workflow&art=cinematic#world . Its deterministic companion is on 4327; user services remain untouched. The independent journal is updated through its existing private publication workflow. Goal 6 and further art work remain separate.
