# Research service

The research piece on its own, for production: PlanCheck sends the tender items it could not price
from the QV catalogue, and the service researches each one with DeepSeek (the API loop, five runs,
the host's citation checks and grading) and returns graded prices. It runs only the research
engine (`packages/research-engine`), on a US-hosted provider, with its own Postgres. No harness
code, Claude, Codex or OpenCode is in it; `tests/research-boundary.test.mjs` and
`scripts/check-image.sh` hold that. Plan: `research-agent-deepagents-spike-pack/32-RESEARCH-SPLIT-PLAN.md`, Phase 3.

## Run it locally

```sh
cp apps/research-service/env.example apps/research-service/.env.local   # then fill in RESEARCH_SERVICE_CLIENTS
npm run client-token -w @eversor/research-service -- plancheck          # a token for PlanCheck, and its entry
npm run dev:research-service
```

`pglite:<directory>` runs Postgres inside the process, so a local run needs no Docker. The dev
command also reads the provider keys from `~/.config/eversor-research.env` and PlanCheck's local
rate-library settings from the harness's `.env.research.local`, when they exist.

## API

Every `/v1` route takes `Authorization: Bearer <client token>`. A client sees only its own batches.

| Route | |
|---|---|
| `POST /v1/batches` | `{batchId, reference?, items: [{id, description, unit?, quantity?, location?, notes?}]}`, up to 200 items. 201 with the batch; 200 with the batch already stored when this `batchId` was sent before. |
| `GET /v1/batches/:id` | The batch: `status` (`queued`, `running`, `done`), `counts`, and each item's `status` (`queued`, `researching`, `done`, `failed`) and, once done, its `answer`. |
| `GET /v1/batches?batchId=…` | The same, by PlanCheck's own batch id. |
| `GET /healthz` | No credential. The database kind and what the pacer has learned. |

An item's `answer` carries `grade` (`confident`, `unsure` "wide estimate", `no_price`, `review`),
`bestBand` (only for confident and unsure), `range`, `unit`, NZD GST exclusive, the reasons for a
review grade, open questions, the approximate cost, the evidence fingerprint and the standing
review, if any. An item PlanCheck sends again (same item `id`, any batch) returns the question it
already raised and starts nothing.

The review console's routes (`/api/research/…`, the same ones the harness serves) answer only when
the service listens on loopback, and only to a loopback `Host`, until sign-in exists (Phase 5).

## Pacing

Runs that call the model at once start at `RESEARCH_INITIAL_CONCURRENT_RUNS`, grow by one after 20
calls without a throttle, halve on a 429, and every run holds its next call for the provider's
`Retry-After`. The worker asks only as many questions as that leaves room for, so a batch of 100
waits as rows rather than as 500 runs against a limit that fits six. A run still queued when the
service stops fails as never started and is started again, up to twice.

## Build the image

```sh
docker build -f apps/research-service/Dockerfile -t eversor-research-service .
apps/research-service/scripts/check-image.sh eversor-research-service
```

The image has the engine, the service, `pg` and poppler, and nothing else: no PGlite, so it needs a
`postgres://` URL. It listens on `0.0.0.0:4400` with the console routes off.
