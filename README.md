# Agent Harness UI prototype

A runnable, front-end-only prototype for a deterministic local AI development workflow. It uses the approved Evidence Gate visual direction across the command centre, task library, skills, agents, settings, and every stage of the ten-step task workflow.

## Run locally

```powershell
npm install
npm run dev -- --host 127.0.0.1 --port 4173
```

Open `http://127.0.0.1:4173`.

## Prototype paths

- Use the stage navigator to inspect Triage, Repo scouts, Task spec, Grill me, Impl plan, Implement, Dev review, Test, Final review, and Human approval.
- Use `Demo controls` in the task header to jump to the active workflow, Grill me, failing test, blocked, and completed states.
- A failing test produces a deterministic failure packet. `Send to repair` routes back to Implement; three used attempts block the workflow; a human can grant one additional repair attempt.
- The Human approval screen records final approval, then exposes placeholder actions for opening a pull request and updating Linear.
- Sidebar navigation covers Command Centre, Tasks, Skills, Agents, and Settings. `New task` opens the mocked task creation flow.

## Assumptions

- This is a local, single-repository prototype using realistic mock data for `goose-hub`.
- No provider, repository, pull-request, or issue-tracker operation is performed.
- Harness evidence and model output are intentionally distinct; deterministic gates own status transitions.

## Verification

```powershell
npm run lint
npm run typecheck
npm run build
npm run test:sites
```

Visual artifacts and Playwright screenshots are in `output/playwright/`. The approved visual source is preserved at `design/reference-grill-approved.png`.
