# AH-003 browser verification handoff

Status: operator execution required. This is a handoff, not a browser-test report.

S4 assembles the S1-S3 implementation at one exact revision and gives an operator a
manual browser matrix for candidate freshness. The implementation agent does not
operate a browser, add browser automation, or claim the rows below were observed.

## Candidate and gate identity

The assembled candidate tuple for this slice is:

| Field | Value |
| --- | --- |
| Task | `AH-003` |
| Candidate ID | `C1` |
| Candidate revision | `1` |
| Integration head SHA | `41391df9003bd370fd8e51531eff16183b8b7163` |
| Slice base | `8f90273784dc7fc0157eda868d97b1a0b2ba019b` |
| S1 commit | `ef06ac1` |
| S2 commit | `e679cbb` |
| S3 commit | `41391df` |

`C1`, revision `1`, and the runtime-reported candidate `headRevision` must be
checked from `GET /api/tasks/AH-003`; do not infer a candidate identity from the
branch name. If the runtime reports another candidate tuple, stop the verification
and update this handoff in the new integration candidate before recording evidence.

Candidate-bound current evidence must match the active candidate's ID and revision;
the operator records the active candidate's full head SHA alongside that projection.
A missing active candidate, missing binding, ID mismatch, or revision mismatch is
stale. Historical evidence remains inspectable but cannot count as a current gate.

## Exact-SHA gate protocol

Run from the slice worktree. Capture the terminal output with the candidate tuple
above in the operator's evidence record; S4 does not create a report file.

```sh
git rev-parse HEAD
git status --short
npm test
npm run typecheck
npm run build
npm run test:sites
git rev-parse HEAD
git status --short
```

The first and second `git rev-parse HEAD` values must both be
`41391df9003bd370fd8e51531eff16183b8b7163`, and both status outputs must be empty.
If `npm run build` creates the ignored `dist/` output, remove that local generated
output after the check and re-run the final SHA/status lines. Do not commit, push,
merge, or deploy from this handoff.

## Local browser setup

The operator owns the browser step. Use a local, loopback-only runtime:

```sh
AGENT_HARNESS_REPOSITORY="$PWD" npm run dev
```

Open `http://127.0.0.1:4173/`. The companion is at `127.0.0.1:4310`; it is not a
public service. Confirm the active task tuple before each row:

```sh
node --input-type=module -e 'const p=await (await fetch("http://127.0.0.1:4310/api/tasks/AH-003")).json(); const t=p.task; const c=t?.candidates?.at(-1); console.log(JSON.stringify({taskId:t?.id,candidateId:c?.id,candidateRevision:c?.revisionNumber,candidateHead:c?.headRevision,projectedActive:t?.candidateFreshness?.activeCandidate},null,2))'
```

For the fresh baseline, use the persisted AH-003 task after it has real retained
evidence for Dev Review, Test, Final Review, and Approval. Do not manufacture a
passing task by changing verdicts. If edge-state coverage is needed without changing
the real task, stop the companion, copy the task store to a disposable path, and
restart with `AGENT_HARNESS_DATA` pointing at that copy. The following one-off
fixture modes mutate only that disposable copy; they are not production changes:

```sh
cp "$PWD/.data/tasks.json" /private/tmp/ah-003-browser-tasks.json
AGENT_HARNESS_DATA=/private/tmp/ah-003-browser-tasks.json AGENT_HARNESS_REPOSITORY="$PWD" npm run dev

export AH003_FIXTURE_DATA=/private/tmp/ah-003-browser-tasks.json
export AH003_TASK_ID=AH-003
export AH003_FIXTURE_MODE=missing-binding
node --input-type=module <<'NODE'
import { readFile, writeFile } from "node:fs/promises";

const file = process.env.AH003_FIXTURE_DATA;
const mode = process.env.AH003_FIXTURE_MODE;
const state = JSON.parse(await readFile(file, "utf8"));
const task = state.tasks.find((item) => item.id === process.env.AH003_TASK_ID);
if (!task) throw new Error("AH-003 task was not found in the disposable store.");
const candidate = task.candidates?.at(-1);
if (!candidate) throw new Error("The fixture needs an assembled candidate.");
const downstream = new Set(["dev-review", "test", "final-review", "approval"]);
const artifactFor = (stage) => task.artifacts?.find((item) => item.stage === stage);

if (mode === "missing-active-candidate") {
  task.candidates = [];
} else if (mode === "missing-binding") {
  const artifact = artifactFor("dev-review");
  if (!artifact) throw new Error("The fixture needs Dev Review evidence.");
  delete artifact.candidateId;
  delete artifact.candidateRevision;
  task.currentStage = "dev-review";
  task.status = "ready-for-review";
} else if (mode === "mismatched-revision") {
  const artifact = artifactFor("test");
  if (!artifact) throw new Error("The fixture needs Test evidence.");
  artifact.candidateRevision = candidate.revisionNumber + 99;
  task.currentStage = "test";
  task.status = "ready-for-test";
} else if (mode === "repair") {
  candidate.revisionNumber += 1;
  candidate.status = "ready_for_review";
  candidate.revisions = [
    ...(candidate.revisions ?? []),
    { number: candidate.revisionNumber, headRevision: candidate.headRevision, reason: "repair", createdAt: new Date().toISOString() },
  ];
  task.currentStage = "dev-review";
  task.status = "ready-for-review";
  task.completedStages = (task.completedStages ?? []).filter((stage) => !downstream.has(stage));
} else {
  throw new Error(`Unknown AH003_FIXTURE_MODE: ${mode}`);
}

await writeFile(file, `${JSON.stringify(state, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ mode, taskId: task.id, candidateId: candidate.id, candidateRevision: candidate.revisionNumber, candidateHead: candidate.headRevision }, null, 2));
NODE
```

The `repair` mode is a disposable browser projection fixture: it verifies that the
new active revision makes retained downstream evidence stale. The real revision
increment and audit-retention path is covered by the orchestrator tests. Restore or
discard the disposable store before returning to the fresh baseline.

## Operator-verifiable browser matrix

Use the hash routes below. For every row, record the observed result, an ISO-8601
timestamp, and a screenshot or screen-recording location in the operator's evidence
record. Also record the exact candidate ID, revision, and full head SHA printed by
the API check immediately before the row. The initial values below are the expected
fresh tuple; a repair fixture should be recorded as `C1 / r2 / <reported head SHA>`.

| ID | Setup | Route | Expected UI and action | Candidate ID / revision / SHA | Observed result, timestamp, evidence location |
| --- | --- | --- | --- | --- | --- |
| B1 Fresh evidence | Fresh baseline with all four candidate gates retained and matching `C1 r1` | `#/tasks/AH-003/approval` | Integration candidate shows `C1 r1` and its head; no stale banner; Final Review/Approval evidence is current; command bar offers `Approve & merge C1` only when the task is awaiting human approval. | `C1 / r1 / 41391df9003bd370fd8e51531eff16183b8b7163` | Pending operator observation; record ISO timestamp and evidence path. |
| B2 Missing binding | Disposable store, `AH003_FIXTURE_MODE=missing-binding` | `#/tasks/AH-003/dev-review` | Dev Review is not complete. The stage shows `Dev review requires rerun`, a human-readable binding reason such as `Evidence must be bound to C1 revision 1`, and a visible `Rerun Dev review`; confirm the stable API reason code is `missing-candidate-binding`. | `C1 / r1 / <reported head SHA>` | Pending operator observation; record ISO timestamp and evidence path. |
| B3 Mismatched revision | Disposable store, `AH003_FIXTURE_MODE=mismatched-revision` | `#/tasks/AH-003/test` | Test evidence is not current. The focused-Test panel identifies superseded candidate-bound evidence or `Rerun required`, explains that the evidence revision does not match the active revision, and does not count the mismatched row as passed/current; confirm API reason code `candidate-revision-mismatch`. | `C1 / r1 / <reported head SHA>` | Pending operator observation; record ISO timestamp and evidence path. |
| B4 Repair invalidation | Disposable store, `AH003_FIXTURE_MODE=repair` | `#/tasks/AH-003/dev-review` | Candidate is `C1 r2`; retained r1 evidence remains inspectable; Dev Review, Test, Final Review, and Human Approval stage steps all read `rerun required`; the stale banner explains the revision mismatch; global action is `Rerun Dev review`. | `C1 / r2 / <reported head SHA>` | Pending operator observation; record ISO timestamp and evidence path. |
| B5 Exact-candidate Test summary | Fresh baseline with matching Test artifact, envelope, rows, run summary, and `C1 r1` | `#/tasks/AH-003/test` | Focused-Test header reads `Candidate-bound structured evidence`, shows `C1 r1`, and lists only rows whose candidate bindings match the active candidate. Selecting a row opens details; Back returns to the list. | `C1 / r1 / 41391df9003bd370fd8e51531eff16183b8b7163` | Pending operator observation; record ISO timestamp and evidence path. |
| B6 Visible stale Final Review state | Disposable store, `AH003_FIXTURE_MODE=repair` | `#/tasks/AH-003/final-review` | Final Review summary does not show stale candidate evidence as `Passed`; downstream rows show `Stale after repair` or `Rerun required` with an actionable freshness reason, while historical artifact names remain available. | `C1 / r2 / <reported head SHA>` | Pending operator observation; record ISO timestamp and evidence path. |
| B7 Global rerun action | Disposable store, `AH003_FIXTURE_MODE=mismatched-revision` | `#/tasks/AH-003/test` | The primary command bar, outside the focused-Test row details, visibly offers `Rerun Test`. Verify it is the stage-level action; do not start a model run unless the operator has separately approved that local execution. | `C1 / r1 / <reported head SHA>` | Pending operator observation; record ISO timestamp and evidence path. |
| B8 Missing active candidate | Disposable store, `AH003_FIXTURE_MODE=missing-active-candidate` | `#/tasks/AH-003/approval` | No candidate is presented as current: the UI says `No candidate assembled` or equivalent, candidate-bound evidence is stale with a no-active-candidate message; confirm stable API reason code `missing-active-candidate`, and merge approval is unavailable. | `none / n-a / n-a` | Pending operator observation; record ISO timestamp and evidence path. |

## Handoff rules

- A browser row is valid only when its recorded tuple matches the API projection and
  the exact-SHA gate record. A screenshot without the tuple is insufficient.
- A repair creates a new candidate revision. All prior Dev Review, Test, Final Review,
  and Approval browser verdicts become historical and must be rerun for the new tuple.
- S1, S2, and S3 remain independently qualified slices. This document is S4's
  integration/browser handoff and does not turn their green checks into a whole-task
  pass until the operator completes the matrix.
- Do not add Playwright, Cypress, WebDriver, browser state, screenshots, or test
  reports to the repository. The operator supplies any visual evidence outside this
  slice worktree.
