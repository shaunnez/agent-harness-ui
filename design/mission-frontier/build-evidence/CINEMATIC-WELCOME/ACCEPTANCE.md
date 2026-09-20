# Cinematic welcome — 21 September 2026

Implemented in `codex/frontier-cinematic-welcome`, based on `46a37ad`, in the isolated `frontier-cinematic-welcome/agent-harness-ui` worktree. Preview: http://127.0.0.1:5248/.

## Accepted request

A normal first page load shows the supplied island image, plays the supplied arrival video, then reveals the left welcome panel using the supplied sidebar reference. Active existing projects replace the three setup steps, capped at three rows; View all opens the existing project directory. Project rows open their headquarters. The demo link opens `?mode=fixture#world`. Explicit world/workflow deep links and fixture visits bypass the introduction.

The video retains the supplied soundtrack and starts muted for browser autoplay compatibility. Enable sound / Mute sound controls toggle the soundtrack during playback. Skip intro, reduced-motion/browser motion preferences, rejected playback, media errors and an 18-second loading timeout all reveal a usable panel. The video is removed after the introduction. The Three.js world is not mounted until leaving the welcome page. Connection copy uses the real coordinator state; timestamps describe successful syncs rather than invented checks. Offline retained projects are explicitly last-known data.

## Verification

- `npm run test:frontier`: 145 passed, zero failures.
- `npm run typecheck`: passed.
- Changed TSX/test lint and changed-file format checks: passed.
- `npm run build:frontier`: passed; existing large-chunk warning remains.
- `git diff --check`: passed.
- In-app browser: observed automatic video playback and natural completion to the extracted final frame; exactly three live project rows; no video or world canvas remains on the welcome panel.
- Browser: Skip intro reveals the panel; Plancheck row enters the correct live headquarters; View demo world navigates to `?mode=fixture#world` and exposes the fixture world controls.
- Browser: isolated temporary component harness verified blocked-autoplay fallback, disconnected numbered steps, disabled setup actions while offline, and the reduced-motion path without a video. Harness removed after verification.
- Default 1280×720 viewport and larger desktop viewport checked. The sidebar scrolls locally on short viewports; footer verified reachable at scrollTop 86. Temporary browser viewport override reset.

No backend changes, project creation, task execution, PR, merge, or deployment. Existing user services and the source checkout are preserved; this preview uses the existing companion on port 4321 for reads.

## Media provenance

User-supplied originals retained unchanged:

- `/Users/shaun/Downloads/source.mp4`, SHA-256 `9320c37b54a04360723a8500a7909f92c0d372ddcab5eb789c29718bd060b2f3`.
- `/Users/shaun/Downloads/ChatGPT Image 21 Sept 2026, 10_03_13.png`, SHA-256 `9adda0f8c153edab2212954dca11158b72449a5ad286ce237f0bd24182e2311b`.
- Sidebar composition reference: `/var/folders/nr/bpphtrj50gz4_rjqtsdm36_00000gp/T/codex-clipboard-f20f2a52-88ea-4867-805d-6e0a6058fed0.png`.

Runtime files under `public/frontier/assets/welcome/`:

- `arrival.mp4`: about 5.3 MB, 1920×1080, 24 fps, about 10 seconds. Encoded H.264/yuv420p, CRF 22, fast-start metadata, original soundtrack encoded as stereo AAC at 128 kbps. SHA-256 `b5e0bc27dcee92c34adf70bc1c180e9d5be12bc4eb312a574f1417eaa3037e79`.
- `arrival-poster.jpg`: supplied second image encoded as JPEG quality 93. SHA-256 `19f44f193b5c21f75c44ae17af5e4d30b427f4ef8a5ce0c83ecbd138a7d63db0`.
- `arrival-end.jpg`: frame at 10 seconds, used after natural completion. SHA-256 `87ea0983845ed6d8582bd16fe221f82fcecf9c4f7d4b03f2bbd814ee45925c26`.

No generated replacement artwork or paid asset calls.

## Audio follow-up

Restored the original soundtrack after Shaun asked about missing audio. Verified the output contains AAC audio and clicked Enable sound in the browser: the control changed to Mute sound and the video reported `muted: false`, `paused: false`. Focused welcome tests, typecheck, changed-file lint and Frontier build passed.
