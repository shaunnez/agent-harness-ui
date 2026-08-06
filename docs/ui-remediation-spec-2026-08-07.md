# UI remediation spec — 2026-08-07

Source: operator review of AH-003 in the running app. Every item below is a real observed
defect or gap, not a speculative improvement.

## How to work

- Branch: work from `main` (currently `c2fd28a`). One commit per numbered item, or one per
  tier where items share a file.
- Verify after every item: `npm test` (baseline **310 pass, 0 fail** — do not land a
  regression), `npm run typecheck`, `npm run lint`, `npm run build`.
- Server-side changes need a server restart to take effect. The operator restarts it; do
  not assume a running server has your change. Ask them to restart, or verify against a
  freshly started one.
- Match the surrounding comment style. This codebase explains *why* a non-obvious
  constraint exists, in prose, at the point of the constraint. Do not add narration to
  obvious code, and do not strip existing comments.
- `AGENTS.md` records durable design decisions. Two decisions from this review belong
  there once implemented: **nothing in the right sidebar is an accordion**, and
  **future stages are not inspectable until they have started**. Note that the existing
  AGENTS.md line "collapsed run safeguards" is now superseded — update it, don't leave
  it contradicting the code.

## Do NOT delegate these — leave for the operator's Opus session

These are listed so nobody attempts them from this spec and lands something plausible
but wrong.

- **P0-1 (read-only Bash denials).** Requires empirically discovering which Bash
  allow-rule form the installed Claude Code CLI actually honours. A previous attempt
  assumed `Bash(*)` worked and it does not; the failure mode is silent (the run just
  fails later). Needs live experimentation against the CLI, not reasoning.
- **P2-11 (auto-approve gates).** The human gates are the product's core claim — an
  evidence gate that auto-approves is a design change to the trust model, not a settings
  toggle. Needs a design decision before code.
- **P1-7 second half (SSE/event stream).** The polling half is specified below and is
  safe. Replacing it with a stream is a separate architectural change.

---

# P0 — broken or actively misleading

## P0-2 · CSRF token expiry forces a page reload

**Symptom.** Advancing a stage (e.g. approving a gate) pops a CSRF-expired error; the
operator reloads the page and it works.

**Root cause.** `runtimeCsrfToken` in `src/api.ts` is assigned exactly once, by
`getRuntimeStatus()` at app boot (`src/api.ts:41-46`). The server mints a new
`crypto.randomUUID()` token on every start (`server/api.mjs:createApiServer`), so any
server restart leaves the page holding a dead token. `assertHttpBoundary` then rejects
every mutation with 403 forever (`server/http-security.mjs:25`).

**Change.** In the `request<T>()` helper in `src/api.ts`: when a mutating request fails
with 403 and the error names the CSRF token, re-fetch `/api/runtime/status` to refresh
`runtimeCsrfToken`, then retry the original request exactly once. Do not retry more than
once, do not retry non-403s, and do not retry GETs (they carry no token).

**Acceptance.** With the app open, restart the server, then approve a gate without
reloading — it succeeds. A genuinely invalid token still surfaces an error rather than
looping.

**Test.** `tests/api.test.mjs` already has a CSRF fixture (`TEST_CSRF_TOKEN`, and a
hostile-origin case near line 975). Add a client-level test if there is an existing
pattern for `src/api.ts`; if there is not, add a server-side test asserting a rotated
token rejects the old value, and verify the retry manually.

## P0-3 · No running indicator, and "rerun required" shown mid-run

**Symptom.** Dev review looked stuck. It was not — AH-003 attempt 3 was actively running.
Meanwhile the stage navigator, the main panel heading ("Dev Review requires rerun"), and
the repair-lineage rows all said "rerun required", with no way to act on it.

**Root cause.** Gate freshness is rendered without consulting whether a run for that
stage is currently in flight. `task.activeRunIds` / `task.activeRunKind` and the stage's
own running run are available on the task but not used by the stage navigator or the
stage presentation.

**Change.** Three places, one rule: *if a run for this stage is in flight, running state
wins over freshness state.*

1. Stage navigator (`src/components/RuntimeTaskWorkspace.tsx`, the
   `workflowStages.map(...)` block): show a spinner and the word `running` for the
   in-flight stage. There is already a `CircleNotch ... className="is-running spin"`
   precedent in `src/components/TaskTable.tsx:105`.
2. Main stage panel (`src/components/runtime/RuntimeStagePresentation.tsx`): while
   running, the heading must say the stage is running, not that it requires a rerun.
   Put the running indicator next to the title.
3. Repair lineage rows: suppress "Rerun required" for a stage whose rerun is already
   underway.

**Acceptance.** With a stage running, the navbar pip spins and reads `running`, the main
panel says running, and no surface offers or demands a rerun. When the run ends, the
freshness copy returns.

## P0-4 · Unstarted stages present as completed history

**Symptom.** Clicking Test, Final review, or Human approval on AH-003 shows a "Recorded
history" pill and "Historical stage · read-only, viewing retained evidence" — for stages
that have never run.

**Root cause.** `historical` is computed as `viewedStageId !== task.currentStage`
(`src/components/RuntimeTaskWorkspace.tsx`), which is true for *future* stages as well as
past ones.

**Change.** Distinguish three cases, not two: past (has a run or recorded evidence),
current, and future (no run, no artifact, not reached). Future stages must not render the
historical/read-only affordance, and must be disabled in the stage navigator — not
clickable, visually inert, with a title explaining they have not started. Use the
existing completed-stage data (`task.completedStages`, `task.runs`, `attemptsByStage`)
rather than inventing new state.

**Acceptance.** On a task at dev-review, stages 8–10 are unclickable and clearly not-yet-
started. Stages 1–6 remain inspectable as history. No stage claims retained evidence it
does not have.

**Test.** Add a unit test for the past/current/future classifier in
`src/components/runtime/workflow.ts` (that module already has testable helpers like
`isStageComplete`, `isStageInvalidatedByRepair`).

## P0-5 · "Inspect exact candidate diff" navigates to Command Centre

**Symptom.** Clicking it from the dev-review page lands on the Command Centre.

**Root cause.** To confirm. Start at `openCandidateDiff` in
`src/components/RuntimeTaskWorkspace.tsx` and the `onRouteDetailChange({ kind: ... })`
call it makes, then `parseHashRoute` / `serializeHashRoute` in `src/routes.ts`. The
likely shape is a detail kind that does not round-trip through the hash parser, so the
route falls back to the default screen. Reproduce first, then fix.

**Acceptance.** The button opens the diff viewer in place; browser back returns to the
stage; the URL round-trips (paste it in a new tab and the diff opens).

**Test.** `src/routes.ts` has route tests — assert the candidate-diff detail
serialises and parses back to itself.

## P0-6 · Broken avatar icon in the sidebar footer

**Symptom.** The `s.k.dev / Senior developer` block in the bottom-left sidebar renders a
broken-image box.

**Change.** Find the `img` in `src/components/Shell.tsx`. Either ship a real asset or
replace it with the initials-avatar treatment already used elsewhere (`SK` in a circle)
so there is no network-dependent image. Prefer the latter — this app is local-only and
must not depend on an external image host.

**Acceptance.** No broken image in any theme; no failed image request in the console.

---

# P1 — state the operator cannot see or trust

## P1-7 · Command Centre and Tasks never refresh

**Symptom.** Tasks do not visibly move through stages; status, input/output/cache tokens
and approximate cost are frozen until a manual refresh or reload.

**Root cause.** Only the *open* task polls (`src/App.tsx:166-175`, 1.25s while running,
5s otherwise). The `runtimeTasks` list backing both the Command Centre and Tasks screen
is fetched at boot and after mutations only.

**Change (polling only — do not build a stream).** Add a second effect in `src/App.tsx`
that calls `refreshTasks()` on an interval. Use a slower cadence than the active-task
poll: 5s when any task is `running`, 15s otherwise. Requirements:

- Skip the poll when the document is hidden (`document.visibilityState`), and refresh
  once immediately on becoming visible.
- Never clobber `activeRuntimeTask` — the existing active-task effect owns that.
- Failures are silent (match the existing `.catch(() => undefined)` treatment); a
  transient failure must not surface a toast or clear the list.

**Acceptance.** With a task running, the Command Centre and Tasks rows advance on their
own — stage, status, tokens, cache rate, cost — with no interaction.

## P1-8 · Connections panel: inconsistent state names, grey Claude

**Symptom.** Sidebar shows `Codex — Connected` (green) and `Claude — Signed in` (green
text, grey dot). Both are connected; the wording and the dot colour disagree.

**Change.** One vocabulary for both providers, driven by the same underlying fields.
Pick one term per state and use it for both: connected / signed-in-but-unverified /
not-signed-in / unavailable. Give Claude its own non-grey brand-ish colour distinct from
Codex's blue and from the semantic green/amber/red already in use — grey currently reads
as "inactive" when the provider is working. Check `src/styles/` for existing colour
tokens and add one rather than hardcoding a hex.

**Acceptance.** Both providers use identical state wording; Claude's indicator colour
matches its actual state and is not grey while signed in.

## P1-9 · Settings → Runtime connection is inconsistent per provider

**Symptom.** The section shows `Authentication / No API key is read or stored →
"ChatGPT signed in"`, then `Claude / claude.ai · team; read-only confinement not yet
verified → "Signed in · confinement not yet verified"`. The heading "Authentication" is
really the Codex row; the two providers are described in different vocabularies; the
confinement caveat is believed stale.

**Change.**
1. Make it two symmetric provider rows — one per provider, each with the same fields
   (provider, auth method, state) — rather than one generic "Authentication" heading that
   is secretly about Codex. Keep "No API key is read or stored" if still true, but attach
   it to the provider it describes.
2. Align the state vocabulary with P1-8 — same terms, same colours.
3. **Verify before removing the confinement caveat.** `docs/claude-write-confinement-spike.md`
   exists and read-only confinement is exactly what P0-1 is still failing on. Do not
   delete the caveat just because it is ugly; find what sets it, confirm whether it is
   still true, and only then remove it. If it is still true, reword it to be
   comprehensible instead.

**Acceptance.** Both providers described identically; no state string appears here that
does not appear in the sidebar; any remaining caveat is accurate.

## P1-10 · Remove the "Codex connected · ChatGPT plan session" header widget

**Symptom.** Top-right of the Command Centre, with a refresh icon, while the operator is
using Claude.

**Root cause.** `src/components/CommandCentre.tsx:100-116` hardcodes the string
`"Codex connected"` from `runtimeStatus.authenticated` — a provider-agnostic flag — and
appends `runtimeStatus.authMethod`. It is Codex-labelled regardless of which provider is
in use. The icon calls `onRefreshRuntime`.

**Change.** Delete the widget. Once P1-7 lands, its refresh role is redundant, and its
per-provider state belongs in the Connections panel (P1-8) where it can be correct.
Remove `onRefreshRuntime` / `runtimeRefreshing` plumbing only if nothing else uses it —
check before deleting props.

**Acceptance.** No Codex-labelled status appears while running Claude; nothing else in
the header regressed.

---

# P2 — features

## P2-12 · Run activity needs height and resizing

**Symptom.** Opening Run activity gives a short pane; the operator wants far more
vertical space and to be able to resize it.

**Change.** Two stages, land the first even if the second is deferred:
1. Increase the opened height substantially (a large viewport-relative height, e.g. `60vh`
   with a sensible min/max) — see `src/components/run-activity.css`.
2. Make it drag-resizable. A CSS `resize: vertical` on the scroll container is the cheap
   version and is acceptable; a custom drag handle with persisted height is the better
   version. Do not persist height to the server — local UI state only.

**Acceptance.** Opened Run activity fills a useful portion of the viewport and can be
resized; the resize does not break the surrounding layout at mobile widths (there are
responsive rules in `src/styles/polish-responsive.css`).

---

# P3 — polish, copy, information architecture

Each of these is small and independent. Batch them into a few commits.

| # | Item | Detail |
|---|---|---|
| P3-13 | Centre Needs-attention icons | The status icon column in the Command Centre attention list is top-aligned against a two-line label; vertically centre it |
| P3-14 | De-accordion the right sidebar | "Run safeguards" and "Context supplied" are `details`/collapsible; render them open and static. Nothing in the right sidebar should be an accordion. Update the contradicting `AGENTS.md` line |
| P3-15 | Repair lineage formatting | Rows run label and text together with no spacing and a too-small font (`Dev reviewThe terminal run failed…`). Give each row label/body separation and a readable size. Also make the collapsible obviously expandable — it currently gives no affordance |
| P3-16 | Decision frontier | Font is too small. Add copy explaining what it is and when it is used. **Investigate scope before changing behaviour**: determine whether it is grill-only or usable at any stage. If grill-only, either scope it to grill or say so in the copy — do not leave a free-text input implying it feeds every stage |
| P3-17 | Living artifacts | (a) Clicking must not scroll the main body; (b) reverse the order so triage is first; (c) show a timestamp per artifact (`artifact.createdAt` is already available — see `RuntimeInspectorPanels.tsx:253`) |
| P3-18 | Isolated worktrees copy | Explain what `slice`, `retained`, and `keep retained` mean, and what happens if they are used mid-run. Ground this in the real behaviour: `cleanupReady` is `exists && clean && currentState !== "active"` (`server/git-worktree.mjs:376`), and the remove endpoint re-derives readiness server-side and refuses an active worktree (`server/api.mjs`, the `DELETE .../worktrees/:rowId` handler). Copy must match that, not guess |
| P3-19 | Outcome evaluation availability | The scorecard inputs are always enabled. Determine when evaluation is actually accepted, then disable the inputs and button outside that window with copy saying when it becomes available |
| P3-20 | Delete the Codex-JSONL footnote | `src/components/RunActivity.tsx:158`: "Fields are shown only when persisted state or Codex JSONL exposes them. API-rate estimates are not attributable ChatGPT-plan charges." Codex-only and stale now that Claude runs exist. Delete it. Also review the sibling string at `RuntimeInspectorPanels.tsx:254` ("API-rate estimate · ChatGPT plan session") for the same problem |

---

## Known-good baseline

At `c2fd28a`: `npm test` → 310 pass, 0 fail. `npm run typecheck`, `npm run lint`,
`npm run build` all clean. If any of those differ before you start, stop and report
rather than building on a broken baseline.
