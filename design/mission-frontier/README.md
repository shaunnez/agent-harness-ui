# Mission Frontier — design and build handoff

Design review v1.1 · Implementation plan revision 1 · 6 September 2026

This is a portable design handoff for a **new frontend project**, grounded in the selected strategy-game world and the existing Agent Harness backend. The old frontend is not a visual or structural constraint.

The user requested the sequence **design → refinements → implementation plan → build**. This package now includes the designs, implementation plan and runnable goal prompts. It does not implement the product or change the backend; no build goal has been started.

The user accepted the world/overlay balance, project/base and task/crew mapping, and agent-policy controls. Building placement, persistent agent names, upgrades and unlocks are deferred to v2. The v1.1 refinement adds clear waiting/blocked states in Project headquarters and Watch an agent.

## Build handoff

- [IMPLEMENTATION-PLAN.md](IMPLEMENTATION-PLAN.md): architecture, bounded backend additions, M0–M7 milestones, all 25 screens, verification, runtime isolation and rollback.
- [BUILD-GOALS.md](BUILD-GOALS.md): paste-ready first-playable goal (M0–M3), full-v1 goal (M4–M7 after review), and continuation instructions.
- [ASSET-PRODUCTION.md](ASSET-PRODUCTION.md): Astra asset-agent ownership, calibration/first-playable/full kits, layer/anchor/alpha/animation requirements and dispatch prompt.
- [PLAN-VERIFICATION.md](PLAN-VERIFICATION.md): checks performed on this planning handoff, distinct from future product acceptance.

The initial packaging proposal is an independent `src/frontier` entry/build inside this repository, using the existing backend and preserving the current frontend. PixiJS world rendering is subject to a first integrated visual gate. The first build goal ends at a playable review checkpoint; it does not claim full-v1 completion.

## Review the designs

- Open `index.html` directly or through the local design-review server. The gallery groups screens by workflow and supports full-size viewing, review notes, and exporting notes.
- `reference/selected-world.png` is the selected option 3 from the second concept set.
- `screens/` contains the full-size page studies. Each is a representative state of a page; additional states and interactions are specified in `DESIGN-SPEC.md`.
- `BACKEND-COVERAGE.md` records which proposed behaviours already have APIs and which require decisions or additions later.
- `generation-prompts.json` retains the built-in ImageGen prompts. `asset-manifest.json` records source provenance and corrections.
- `generation-prompts-v1.1.json` records the three scoped ImageGen edits. All earlier images remain available.
- Screen 04 has Needs attention and Original v1 design states. Screen 19 has Repair required, Needs your answer and Running states. The state selector changes this design study only.
- `ATTENTION-CONTRACT.md` covers stage, reason, next actor, eligible action, dependency waits, approvals, failures and finished-run presentation across the whole workflow.

The review gallery is an artifact viewer, not the new application. Its notes are stored only in the browser until exported. Original notes are retained, and the new design states have separate feedback. No gallery control creates tasks, changes projects, invokes agents, or sends backend commands.

## Review priorities

1. The world-to-work transition: select a base, select a crew, then inspect or act.
2. The project headquarters and task command workspace: sufficient detail without losing the sense of a game.
3. Creation, decisions, model policies, and delivery: clear scope and explicit actions.
4. The visual balance of world, work overlays, and readable evidence.

Page names and screenshot IDs are stable so feedback can refer to a specific screen. Sample IDs, paths, timestamps, counts, models, candidate hashes, and prices are illustrative, not records of real execution. The written state rules govern behaviour; generated microcopy and incidental artwork do not define additional requirements.
