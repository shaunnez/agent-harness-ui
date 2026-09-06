# M7 measured performance

Measured in the in-app browser on this Mac, with a 1568×1003 viewport at DPR 1. Its observed frame cadence is about 120 Hz. Fixtures never created real paid tasks. Frame statistics retain the latest 12,000 intervals; the measurement elapsed time spans the complete session, rather than implying every earlier frame remains in that window.

| Check | Observed | Gate |
| --- | --- | --- |
| Normal load | 10 projects / 100 tasks, representative worker grouping | No lost task records |
| Twenty world → HQ → agent → world trips | 296.52 seconds measured, 36 textures, 12 world root entities, 2 ticker listeners | Counts unchanged from warmup and 9-trip checkpoint |
| Normal frame rate | 120.48 fps median; 10.10 ms p95 interval | >=50 fps; <=33 ms p95 |
| Selection acknowledgement | 12 measured world selections; p95 9.1 ms | <=100 ms |
| Stress | 50 projects / 1,000 tasks, 52 world root entities | Last task and project reachable by search/Locate; attention remains in the journal |
| Stress frames | 219.44 seconds measured; 93.46 fps median; 15.10 ms p95 | No responsiveness collapse |
| Resident texture estimate after detail | 87,949,312 RGBA bytes, 83.88 MiB | <=192 MiB |
| Loaded compressed artwork after detail | 16,754,958 bytes, 15.98 MiB | Recorded separately from decode estimate |
| Conservative initial payload bound | 19,196,599 bytes, 18.31 MiB, including all non-raster output and optional detail | <=20 MiB |
| Reconnect | No fabricated handoff, retained selected task/draft | Restore current state rather than replay history |
| Motion off | `tickerRunning:false`; task controls/state remain available | Presentation-only effect |

Raw records: `performance-before.json`, `performance-nine-trips.json`, `performance-twenty-trips.json`, `performance-stress.json`, `payload-budget.json`, `motion-off.json`, `reconnect.json`. The 20 trips were counted only after a fresh warmup; an earlier interrupted automation batch was excluded.

The cache includes independent tool parts. Detail artwork loads on demand and remains cached. These byte figures are file-size and RGBA-dimension estimates, not a GPU driver/process memory profile. Entity rebuild totals are cumulative reconciliation work; live root entity and ticker counts are the leak check. No stronger process-memory claim is made.

`live-network.json` records actual local API resource sizes and durations separately from fixture frame tests. It contains 138 refresh cycles, 2 summary reads, 1 selected hydration and no refresh failures; startup/auth/model-catalogue reads are included. These are API timings, not model execution speed.

The IAB reports the background test page as visible, so `background.json` does not establish native suspension. Executable visibility-event tests cover stop-on-hide, no restart from hidden refreshes, correct resume, reduced motion/offline state and disposal. OS preference settings were not altered. Native backgrounding remains an explicitly unverified host check.
