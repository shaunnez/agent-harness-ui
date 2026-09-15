# 3D proof and exterior bases — PR qualification

16 September 2026. Shaun requested commit, push and a PR for the completed 3D proof and exterior extension. The connected colony, hexagonal HQ, spacecraft arrival sequence, Goal 6 and live renderer adoption remain future work.

## Review base

- Head branch: `codex/mission-frontier-3d-proof`.
- Base branch: `codex/mission-frontier-coastal-checkpoint-1`, currently `a6f637fe796bfedae3df476adae97f007ad7b2e0`.
- Dependency: [coastal PR #89](https://github.com/shaunnez/agent-harness-ui/pull/89), still open at publication preparation. The 3D review is stacked on it to keep the earlier coastal changes out of this incremental diff. After #89 merges, revalidate the 3D branch against main and retarget its PR; neither merge is part of this request.
- `origin/main` was refreshed and is already an ancestor of the review base. No additional main merge was needed.

## Delivered scope

An opt-in React Three Fiber / Three.js fixture renderer with portable coastal assets; one Command, Relay or Foundry base per project; independent browser-local building/colour choices; enlarged workers and cargo; station lights and sensors; same-building cutaways; project-scoped selection, minimap and Watch; and retained motion/day-night controls. Default Pixi and live data remain outside the 3D admission boundary.

Review the [exterior handoff](../EXTERIOR-BASES/HANDOFF.md), [world capture](../EXTERIOR-BASES/world-laptop.png), [three structures](../EXTERIOR-BASES/base-lineup.jpg) and [original/current comparison](../EXTERIOR-BASES/comparison-world.jpg). The original proof's recovery checks are separately dated in [its handoff](../3D-VISUAL-PROOF/HANDOFF.md).

## Fresh local checks

`qualification.json` records Node 26.8.1, the review base, source hashes and these successful commands:

- `npm run test:frontier`: 101 passed.
- `npm run typecheck`, `npm run lint`, `npm run format:check`: passed.
- `npm run build`, then `npm run test:sites`: build passed; four Sites tests passed.
- `npm run build:frontier`: passed.

The 21 application/manifest/integration source files match the prior exterior browser qualification exactly. This publication pass reuses that desktop/laptop evidence; it does not claim another full browser run, native-platform checks, root backend suite, live task execution, performance campaign or remote CI result. The existing build-size advisories remain.

## Asset handoff

The review includes the runtime GLBs and thumbnails, staging GLB exports, source scripts/contracts/provenance, the original scene/worker Blender files, and the four exterior-kit Blender files. The three staging picker previews are included so the integration script can run from the committed inputs. Editable scene files retain their packed image inputs. Local `.blend1` backups, downloaded source archives and intermediate renders remain preserved outside the commit. Asset regeneration from a clean machine is not newly qualified by this PR pass; the producer's earlier saved-source export and rebuild records remain separately dated.

The old single-scene proof GLB is retained along with the newer environment/base kit. The biggest new file is approximately 73 MiB. Asset distribution and removal of obsolete exports should be addressed deliberately during later renderer adoption.

## Next work

[NEXT-PHASE-HANDOFF.md](../../NEXT-PHASE-HANDOFF.md) contains the accepted expanding-colony and fixed hexagonal-room brief. It records a typical 3–8 projects and fewer than ten tasks per project, with neither number acting as a cap. The next deliverable is layout design; no new implementation or asset agent has been started by this PR request.
