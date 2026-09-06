# Mission Frontier — source package boundary

This PR packages the independent game frontend, additive backend contracts, tests, 56 runtime asset entries, design study, current screenshots and written qualification records. A normal application install/build/test uses committed files; it does not need Blender or asset downloads.

The PR is based directly on `origin/main` at `91f6d3a8464842846153f0d621b5ba2360ccabd0`. It excludes the source checkout's pre-existing light-mode/design-generation commit `94c9f17` and local merge `e31566a`. Those changes and all source-workspace files are retained unchanged in `/Users/shaun/.codex/worktrees/7237/agent-harness-ui`.

## Included

- `src/frontier/`, the dedicated Vite configuration, dependencies and frontend/API tests.
- Canonical attention projection, project rename/archive/restore admission, task role-policy snapshots and candidate-bound repair/retry checks used by Frontier.
- `public/frontier/`: all runtime textures, registration metadata and content hashes. The cinematic presentation remains opt-in using `art=cinematic`.
- The complete original screen study and reference images, current Goal 3 browser captures, measured performance summaries and milestone acceptance documents.
- Authored image-processing and Blender scripts, selected production metadata, pack acquisition checksums and the publishers' Standard CC0 licence files.

## Retained locally

Large source raster duplicates, Blender binaries, imported mesh/texture libraries, downloaded asset archives, rejected render iterations, raw task/agent snapshots and full historic execution logs remain in the original workspace. They are not removed or silently replaced by the Git package. Historical evidence documents can name local-only files; their absence from a clone is not a failed application build.

The nested `journal-site/` repository is independently published and excluded from this public source PR. Its source history, audience configuration and hosting identity remain separate. The PR does not publish the game or change journal access.

## Building and testing a clone

Use a supported Node version (the PR qualification uses Node 24.19.0), then:

```sh
npm ci
npm run typecheck
npm run lint
npm run format:check
npm run build
npm run build:frontier
node --test tests/*.test.mjs tests/frontier/*.test.mjs tests/frontier/api/*.test.mjs
```

Build before the combined test command because the preserved Sites worker tests inspect the packaged output. `npm run dev:frontier` serves the independent app on loopback port 5199. Open `?mode=fixture&art=cinematic#world` for sample data. Live mode requires a compatible local Node companion; it does not run in hosted static previews.

## Rebuilding artwork

Application builds use the committed exports. The asset-authoring scripts require the retained inputs described in [the Goal 3 asset record](build-evidence/VISUAL-FIDELITY/assets.md). Restore that staging tree from the original workspace to reproduce the exact archived source chain.

For fresh authoring, the approved inputs are the free Standard editions of Quaternius Modular Sci-Fi MegaKit and Stylized Nature MegaKit. Publisher locations and acquired archive hashes are recorded in `assets/staging/cinematic-v1/astra/sources/acquisition.json`; licence files are alongside the corresponding source directories. Reacquisition may produce a newer archive, so verify its identity and requalify changed exports. Do not describe fresh procedural rendering as byte-identical to the retained qualified PNGs without checking the hashes.

Keep runtime art and semantic controls independently interactive. New artwork must preserve the existing projection, anchors and texture budgets and pass actual World/HQ/Agent review before replacing the committed exports.
