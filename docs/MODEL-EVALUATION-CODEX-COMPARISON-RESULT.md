# H05 Codex comparison result

## Outcome

The 22 September 2026 H05 Sol-versus-Luna comparison produced no valid model-performance observations. Both prepared trials passed their exact base-repository and isolation preflights, but a coordinator status check opened each live SQLite store from a second process. Store startup recovery treated the active workers as interrupted and cleared their run reservations. The model calls already in flight were allowed to settle, after which both trials failed before Implement and were adjudicated `invalid` with failure class `apparatus`.

Do not count either result as a model failure, pass, delivery-rate sample or Sol/Luna comparison. No candidate, independent behavior grade or blind review exists.

## Frozen campaign

- Campaign: `/Users/shaun/.codex/model-evaluation/20260922/h05-codex-comparison-v1`
- Public root: `/private/tmp/h-eval-h05-codex-comparison-v1`
- Harness source: `6831950347dd72de26f42df357b64b6d3246e1c5`
- H05 base: `56524724e31d17968383d1e24a2b1c70a0a46ca9`
- Mode: Codex-only, two concurrent trials, two hours / 200M tokens per trial, one-hour calls
- Provider enforcement: only `codex` was executable and allowed; no Claude or Astra call occurred

Each exact public checkout passed the five historical manifest commands under the real verification worker environment: lint, typecheck, 282 tests, build and Sites tests. Zero-inference task admission passed for both arms with empty provider ledgers. Native permission checks proved each arm could read its own repository and could not read its sibling, prior candidates, H05 qualification evidence or the grader source.

The first ad hoc baseline attempt inherited global 1Password commit signing and failed test fixtures that create temporary commits. Those receipts are retained as `baseline.json`; the authoritative worker-environment pass is `baseline-v2.json`. This was resolved before provider dispatch and did not invalidate the campaign.

## Invalid attempts

| Arm | Intended Implement / Repair | Furthest stage | Calls | Input | Cached input | Output | Total | Elapsed | Result |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| A | Sol High | Scouts | 3 Luna High | 573,840 | 459,520 | 8,156 | 581,996 | 4m 15.6s | Invalid apparatus |
| B | Luna High | Triage | 1 Luna High | 194,113 | 135,936 | 2,127 | 196,240 | 1m 46.8s | Invalid apparatus |

Combined usage was 778,236 tokens. Cached input is a subset of input and is shown separately. Neither intended implementation model ran.

The durable evidence is `apparatus-adjudication.json`, each trial's `provider-ledger.json`, `task.json`, `delivery-ended.json`, `worker.log`, preflight receipts and the campaign `report.json`. The report records one invalid trial in each variant, null accepted-delivery rates and no leader.

## Continuation boundary

No replacement trial was launched because the frozen contract allowed exactly two trials and explicitly prohibited automatic replacements. A replacement pair requires a new instruction from Shaun and a new campaign root; never reuse or overwrite this campaign.

Before any replacement, add or use a monitor that reads process state, worker logs and provider ledgers without constructing `SqliteTaskStore` or calling `init()` against a live worker database. Do not change the H05 task, model matrices, budgets, graders or repair limits. Re-run the exact base and zero-inference preflights in the new campaign, then launch at most the same two Codex-only arms.
