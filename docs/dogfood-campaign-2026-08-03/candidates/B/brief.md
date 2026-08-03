# Candidate B

## Issue

Agent-detail policy editor plus truthful Skill input/output contracts

## Frozen brief

Implement truthful Agent policy editing and Skill contract drill-ins in this repository.

Every non-deterministic Agent detail must edit model and reasoning through the existing runtime-settings contract and real local model catalog. Use one shared policy editor across Agents and Settings, with explicit save success/failure feedback, Reset to global default, and clear copy that changes apply only to new tasks because policies are snapshotted. Human Approval remains deterministic. Individual Goose scout pages edit the shared scouts policy unless the backend intentionally adds a real per-scout contract. Skill drill-ins must show truthful TypeScript domain/API input and output types and actual JavaScript prompt/parser source with filenames, distinguishing prompt, parser, persisted artifact, and UI type. Extract cohesive Agents, Skills, Settings, and shared-control modules where useful.

Acceptance criteria:
- Every non-deterministic Agent detail can edit a catalog-backed model and supported reasoning value and persist it through the existing runtime settings API.
- Agents and Settings share one policy-editor implementation, show save success/failure, support Reset to global default, and explain new-task-only snapshot behavior.
- Human Approval is presented as deterministic and individual scout pages truthfully edit the shared scouts policy.
- Skill drill-ins cite real source filenames and show truthful TypeScript boundary types plus actual JavaScript prompt/parser source while distinguishing each contract layer.
- New cohesive production files remain below roughly 500 lines where practical and focused tests cover policy and contract behavior.

Required verification commands:
- npm run lint
- npm run typecheck
- npm test
- npm run build
- npm run test:sites
- git diff --check

## Acceptance criteria

- Every non-deterministic Agent detail can edit a catalog-backed model and supported reasoning value and persist it through the existing runtime settings API.
- Agents and Settings share one policy-editor implementation, show save success/failure, support Reset to global default, and explain new-task-only snapshot behavior.
- Human Approval is presented as deterministic and individual scout pages truthfully edit the shared scouts policy.
- Skill drill-ins cite real source filenames and show truthful TypeScript boundary types plus actual JavaScript prompt/parser source while distinguishing each contract layer.
- New cohesive production files remain below roughly 500 lines where practical and focused tests cover policy and contract behavior.

## Verification commands

- `npm run lint`
- `npm run typecheck`
- `npm test`
- `npm run build`
- `npm run test:sites`
- `git diff --check`

Base: `4c9d56813ae1787f9099d24efd5a8f67ed90234f`

Brief hash: `ad22f5c77a69b5245e4ef9ad0ce878811b7fc81375c7245352e27dcbbabff32c`
