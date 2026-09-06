# Backend coverage for the new frontend design

Inspected the current `agent-harness-ui` worktree on 6 September 2026. This is a design dependency record, not an implementation plan. Source code takes precedence over representative commands in older product documentation.

## Available in this checkout

| Design capability | Current authority |
| --- | --- |
| List/register projects | `server/project-routes.mjs`: GET and POST `/api/projects`; name, repositoryPath, id, createdAt |
| Inspect repository readiness | `server/runtime-settings-routes.mjs`: POST `/api/runtime/repository-contract` |
| Propose and separately approve repository setup | POST `/api/runtime/onboarding/propose` and `/approve` |
| Create task with workflow, profile, attachments and design request | `server/task-creation-routes.mjs`: POST `/api/tasks` |
| Read task summaries and cheap change markers | `server/retained-evidence-routes.mjs`: GET `/api/tasks`, `?view=poll`; task core/full/poll views |
| Read activity, runs and artifacts | GET `/api/tasks/:id/activity`, `/runs`, `/artifacts`, `/artifacts/:artifactId`; cursor pagination |
| Model/provider catalogue and settings | GET `/api/runtime/status`, GET/PUT `/api/settings` |
| Default and profile role policies | `RuntimeSettings.stagePolicies`, `profileStagePolicies`, allowlist and supported reasoning levels |
| Per-task future role policy | PUT/POST `/api/tasks/:id/role-policy` (also agent-policy alias), with lifecycle eligibility and server revalidation |
| Candidate-bound lifecycle actions | `server/task-action-routes.mjs`, `server/action-policy.mjs`, `server/role-policy-eligibility.mjs` |
| Candidate diff | GET `/api/tasks/:taskId/candidates/:candidateId/diff?headRevision=...` |
| Approval and PR reconciliation | `open-pr`, `reconcile-pr` and retained task/PR state |
| Close/archive tasks, continue investigation into implementation | `server/task-lifecycle-routes.mjs` and API functions |
| Worktree inventory/removal | Runtime and per-task worktree routes with current safeguards |
| Observed usage and evaluations | Task/run usage fields, pricing metadata, `/api/evaluations/summary` |

## Current event and update contract

The inspected client uses task `pollVersion` markers and separately fetches retained activity, runs, artifacts and core state. The inspected routes do not expose an SSE or WebSocket endpoint. The user's broader event stream may exist elsewhere; its external transport is not verified here.

The game should depend on current task/run state and retained events, with a transport adapter underneath. The design does not require changing the backend to a new streaming system merely to animate a world.

Actual `RuntimeEvent` fields are defined in `src/runtime-activity.ts`: id, at, category, tone, stage, title, detail, plus optional task-run, tool, artifact, decision, usage and candidate identity. Categories currently include activity, agent, artifact, decision and tool. Representative event names in `docs/workflow-product-contract.md` are not proof that those exact names are emitted.

The task supplies currentStage, status, activeRunKind, activeRunIds, workPackages, candidates, gateFreshness and pollVersion. Those fields ground world placement and action eligibility. Event text alone must not infer a completed stage or authorize a command.

## Gaps and explicit proposals

| Proposed design | Current limitation | Design treatment before planning |
| --- | --- | --- |
| Rename/archive a project | Project routes only list and create; no update/archive endpoint found | Preserve management design, label this as a backend addition in the review notes; define active-task and retention behaviour before build |
| Change a project's repository after tasks exist | Stored project has repositoryPath; tasks bind their own repository authority | Treat existing repository identity as read-only; adding another repository creates another project |
| Per-role policies during task creation | POST `/api/tasks` snapshots settings matrices, or applies a single requested model/effort across policies; it does not accept arbitrary per-role draft overrides | The proposed creation matrix requires a matching creation contract; never pretend ignored overrides were saved |
| Independent policies for individual scout children | `src/components/AgentRoles.ts` maps scout-* roles to the shared scouts policy | Show shared scope now; independent child settings are a product decision and backend extension |
| Persistent world layout, base appearance, camera/audio/motion settings | No such preferences in RuntimeSettings | Local-device preferences are a frontend design proposal; synchronized storage is undecided |
| Permanent agent identities, hires, levels or statistics | Backend records role configurations and ephemeral runs | Do not invent those concepts; avatar identity is presentation, run identity is persisted evidence |
| Source-editable skill catalogue | Existing UI owns role/skill labels; no general skill installation/editing API found | Catalogue descriptions and role policy are shown; source editing/install is outside this design |
| Realtime token/output stream | Retained run/tool/artifact activity exists; token-by-token output transport was not verified | Show observed activity and recorded usage; do not animate fabricated live throughput or private reasoning |
| Arbitrary task title/description edits, pause or drag-to-stage | Not established by the inspected action routes | Only explicit supported commands are enabled. Task closure/archive/cancel are separate actions |
| Arbitrary specification/plan edits from a viewer | Artifacts are retained evidence, not writable documents | Use request-change feedback/regeneration where supported; the exact command contract must be settled later |
| Global run/event pagination across projects | Read endpoints are task-scoped | Cross-project views are aggregations; do not claim a server global stream/index already exists |
| Cross-origin access from a separately hosted new frontend | Loopback runtime and CSRF contract apply; a new-origin permission contract was not verified | Deployment/origin integration is a later technical decision; keep current local security semantics |
| Consistent attention reason, next actor and waiting-since across every stage | Structured blocker detail/detectedAt and action eligibility exist; ordinary questions, approvals, dependencies and external waits use different task evidence | Derive from retained state explicitly, omit unavailable time/reason, and define any missing projection during integration; see ATTENTION-CONTRACT.md |

## Scope rules that the visual layer preserves

- Create, start, cancel, close, archive, approve, retry and repair are distinct commands.
- Model options come from the available catalogue and allowlist. Current or completed run snapshots remain read-only.
- Stage completion, package qualification and whole-candidate readiness are separate facts.
- Candidate actions carry the exact task/candidate/revision/head and eligibility context the server expects.
- Repair preserves evidence and makes affected downstream results stale.
- Approve & raise PR publishes the approved candidate. Awaiting PR merge is a live state; opening a PR is not completion.
- Dollar values use recorded usage and identified rates. Actual attributable ChatGPT-plan charges remain unavailable.
- Context supplied is different from permission to read a repository, and neither proves semantic use.
- New UI access must preserve loopback/CSRF and current task authority. There is no OpenAI API-key setup for the Codex CLI execution path.

## Provenance and sample content

All identifiers in the image studies are fictitious examples. Production UI must display IDs, names, heads, paths, counts, policies, timestamps and usage returned by the backend. PC/MS task prefixes are not a proposed backend renumbering scheme.

The written design specification resolves accidental generative-image copy differences. Confirmed material corrections are recorded in the asset manifest. No runtime, API, repository mutation, or backend test was executed to manufacture the depicted states.
