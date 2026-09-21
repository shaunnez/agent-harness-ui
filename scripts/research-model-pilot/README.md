# Live-model research quality pilot (Q1–Q6)

Implements `08-LIVE-MODEL-QUALITY-PILOT-PLAN.md`. Q7 — the one paid live session — is a
separate authorization and is **not** performed by anything here.

## Commands

```sh
npm run research:model-pilot                       # dry run: no DNS, provider or model call
npm run research:model-pilot:score -- <session-dir> # offline scoring after the human review
```

The live session is deliberately awkward to enter:

```sh
RUN_RESEARCH_MODEL_PILOT=1 RESEARCH_PUBLIC_ONLY_ACKNOWLEDGED=1 npm run research:model-pilot
```

and additionally requires, before anything is constructed:

- `RESEARCH_MODEL_PROVIDER` and `RESEARCH_MODEL_ID` — a model is never inherited from a stray
  credential — plus `RESEARCH_MODEL_MAX_OUTPUT_TOKENS=8192`;
- `.env.research.local` present and mode `0600`, holding `RESEARCH_MODEL_API_KEY` and
  `FIRECRAWL_API_KEY` (and `SERPER_API_KEY` for the bounded fallback). The live command reads
  this file itself, before the runner is imported; a missing or world-readable file fails there
  rather than leaving the session credential-free and failing later for a confusing reason;
- `RESEARCH_MODEL_PILOT_FIRECRAWL_ALLOWANCE` and `RESEARCH_MODEL_PILOT_MODEL_CALL_ALLOWANCE`,
  the separately approved session allowance, which must admit the manifest exactly; and
- a clean worktree, so the report's lineage is exact.

## Files

| File | Role |
| --- | --- |
| `manifest.json` | The frozen four cases, their budgets, and the scorer-only oracle. |
| `contracts.mjs` | Manifest parsing, prompt building (oracle-free), bound arithmetic. |
| `preflight.mjs` | Native-runtime probe, git lineage, model identity, live guards, allowance. |
| `session-ledger.mjs` | One provider ledger for four cases; a case lease cannot reset it. |
| `runner.mjs` | Sequential session execution over the accepted runtime. |
| `review.mjs` | The blind human entailment packet. No model writes or reads it. |
| `score.mjs` | Structural checks plus the review-dependent verdict. |
| `finalize.mjs` | Artifact writing and offline reconstruction. |
| `secret-scan.mjs` | Artifact credential scan, counts and names only. |

## What a pass does and does not mean

`quoteVerified` is structural: the excerpt is an exact substring of a retained snapshot. It is
not support. Claim support is a human verdict in `review.json`, and the scorer refuses a
verdict until every claim has one. Four public-web cases are a small sample: a pass argues for
a separate operator-only activation slice, not for a default change or production use.
