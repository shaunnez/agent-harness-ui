# Goal 3 performance qualification

Measured 6 September 2026 on Shaun's Mac, production Vite build in Codex's embedded browser (browser ID 2), 1568 × 1003 CSS px, DPR 1. Blender was no longer rendering. These are local observations, not guarantees for other hardware or browser engines. Results are from the explicit `mode=fixture&art=cinematic` presentation.

| Gate | Observed result | Evidence | Result |
| --- | --- | --- | --- |
| Normal, >=60s | 10 projects / 100 tasks / 20 visible workers, 10 active; 22.1s warm-up; 102.8804s measured, 11,700 frame samples; median 119.05 FPS / p95 11.7ms | normal-performance.json | Pass: >=50 FPS, <=33ms |
| Busy world | 50 projects / 1,000 tasks / 50 representative workers, 1 active; 77.8818s, 8,562 frames; median 113.64 FPS / p95 11.9ms | stress-performance.json | Pass |
| Selection | 30 actual canvas picks across three workers yielded 20 completed post-paint timing samples (rapidly superseded effects cancel); p95 15.4ms, max 15.5ms | selection-performance.json | Pass: <=100ms |
| Lifecycle | 20 SPA World → HQ → Agent → World trips; 53 textures, 5 World scene entities and 2 ticker listeners before and after; exact original camera restored | lifecycle-before.json, lifecycle-after.json | Pass |
| Initial transfer | 19,506,329 wire response bytes, 18.6027 MiB, across 69 requests | production-cold-wire.json | Pass: <=20MiB |
| Estimated resident textures | Initial 119,734,272 RGBA bytes / 114.1875 MiB / 53 textures; after retained-original detail: 132,579,328 bytes / 126.4375 MiB / 55 textures | normal-performance.json, detail-texture-budget.json | Pass: <=192MiB |
| Motion off / disconnection | Motion-off image pair exactly identical; disconnected metrics stop the ticker and active workers | animation/motion-off-a.png, motion-off-b.png; disconnected-performance.json | Pass |
| Native background | Host visibility=false still returns document.hidden=false, visibilityState=visible | browser-limitations.json; tests/frontier/visibility.test.mjs | Environment-limited; no native pass claimed |

Normal and busy measurements included real drag, zoom, minimap and Fit world actions. Stress uses one representative per project, not 1,000 simultaneous animated agents. Task journal showed all 1,000 records; filtering Project 50 and Sample task 20 reached LOAD-50-20 and its action surface. Starting is unavailable in this read-only load fixture; no real task execution was inferred or launched. See stress-tasks.txt, stress-last-task.txt and stress-last-action.txt.

Selection instrumentation records from the selection callback to the second requestAnimationFrame after committed state and scene effects. This includes an intervening painted frame; it is not physical display photodiode latency. The earlier DOM-commit-only sample was replaced. Browser screenshot calls between actual canvas clicks ensured rendered states were inspected.

The cold-load probe is a read-only loopback reverse proxy over the built artifact. It counts socket bytesWritten, including headers and worker-owned Pixi asset fetches that main-window PerformanceResourceTiming omits. No API calls, source files or credentials are proxied. A fresh origin on port 5203 avoided cached resources. 68 responses were 200; one zero-body favicon 404 remains cosmetic. The proxy is stopped after collection. Initial compressed PNG content is 18,909,937 bytes, distinct from the full wire measurement. The inspector's main-window transfer field alone is not a valid whole-page budget.

No scene or artwork changed after the normal/busy measurements. Subsequent changes fixed transparent artifact hit bounds, measured selection after paint, and corrected provenance/status metadata. The final wire and selection samples include those changes. Lifecycle ran with the 24-sample exterior calibration, proven geometrically and dimensionally identical to its final 64-sample render; this is not a claim that their PNG bytes match. Busy measurement briefly overlapped lightweight checks; all Blender renders had finished.

The M7 baseline is historical: normal 120.48 FPS / p95 10.1ms, busy 93.46 / 15.1ms, estimated initial textures 83.88MiB. Larger landscape, shadow and articulated frames raise initial texture residency by about 30.31MiB; retained detail raises the observed total further, with headroom inside the gate. M7's 18.31MiB conservative payload is not exactly the same measurement method as this wire sample. Do not infer a general speed improvement from two different sessions.

Reduced-motion logic uses the same disabled-motion input as the explicit motion setting, and the visibility lifecycle unit test passes for background refresh, return, offline state and disposal. The host exposes no OS media-preference override; native reduced-motion preference switching was not directly exercised. The actual user motion control was. The earlier OS export receipt gap remains outside this art qualification.
