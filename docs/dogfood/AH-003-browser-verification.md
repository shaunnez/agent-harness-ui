# AH-003 browser verification handoff

Status: operator execution required. This is a handoff, not a browser-test report.

S4 assembles the S1-S3 implementation at one exact revision and gives an operator a
manual browser matrix for candidate freshness. The implementation agent does not
operate a browser, add browser automation, or claim the rows below were observed.

## Candidate and gate identity

The operator supplies the harness-recorded revision and captures the assembled
candidate head from the checkout being verified:

| Field | Value |
| --- | --- |
| Task | `AH-003` |
| Candidate ID | `C1` |
| Candidate revision | `$AH003_EXPECTED_CANDIDATE_REVISION` (from the harness candidate record) |
| Integration head SHA | `$AH003_EXPECTED_HEAD` (captured from `git rev-parse HEAD`) |
| Slice base | `8f90273784dc7fc0157eda868d97b1a0b2ba019b` |

The handoff intentionally does not hard-code its own integration commit: committing
a handoff update changes that SHA. `C1`, the harness-recorded revision, checkout
HEAD, runtime `headRevision`, and the server-derived active projection must instead
be equal under the checks below. Do not infer candidate identity from a branch name.

Candidate-bound current evidence must match the active candidate's ID and revision;
the operator records the active candidate's full head SHA alongside that projection.
A missing active candidate, missing binding, ID mismatch, or revision mismatch is
stale. Historical evidence remains inspectable but cannot count as a current gate.

## Exact-SHA gate protocol

Run from the slice worktree. Capture the terminal output with the candidate tuple
above in the operator's evidence record; S4 does not create a report file.

```sh
export AH003_EXPECTED_CANDIDATE_ID=C1
export AH003_EXPECTED_CANDIDATE_REVISION='<revision from the harness candidate record>'
export AH003_EXPECTED_HEAD="$(git rev-parse HEAD)"
test -n "$AH003_EXPECTED_HEAD"
git status --short
npm test
npm run typecheck
npm run build
npm run test:sites
test "$(git rev-parse HEAD)" = "$AH003_EXPECTED_HEAD"
git status --short
```

The final `git rev-parse HEAD` must equal the captured `$AH003_EXPECTED_HEAD`, and
both status outputs must be empty.
If `npm run build` creates the ignored `dist/` output, remove that local generated
output after the check and re-run the final SHA/status lines. Do not commit, push,
merge, or deploy from this handoff.

## Local browser setup

The operator owns the browser step. Use a local, loopback-only runtime:

```sh
AGENT_HARNESS_REPOSITORY="$PWD" npm run dev
```

Open `http://127.0.0.1:4173/`. The companion is at `127.0.0.1:4310`; it is not a
public service. Confirm and assert the active task tuple before each row, using the
exported values from the exact-SHA gate protocol:

```sh
node --input-type=module <<'NODE'
const response = await fetch("http://127.0.0.1:4310/api/tasks/AH-003");
if (!response.ok) throw new Error(`Task API returned ${response.status}.`);
const { task } = await response.json();
const candidate = task?.candidates?.at(-1);
const active = task?.candidateFreshness?.activeCandidate;
const expectedId = process.env.AH003_EXPECTED_CANDIDATE_ID;
const expectedRevision = Number(process.env.AH003_EXPECTED_CANDIDATE_REVISION);
const expectedHead = process.env.AH003_EXPECTED_HEAD;
const expectNoActive = process.env.AH003_EXPECT_NO_ACTIVE === "1";
if (expectNoActive) {
  if (candidate || active) throw new Error("Expected no active candidate, but the API returned one.");
  console.log(JSON.stringify({ taskId: task.id, candidate: null, projectedActive: null }, null, 2));
  process.exit(0);
}
if (!Number.isInteger(expectedRevision) || !expectedHead) throw new Error("Set the exact expected revision and head first.");
if (candidate?.id !== expectedId || candidate?.revisionNumber !== expectedRevision || candidate?.headRevision !== expectedHead) {
  throw new Error("Runtime candidate does not match the harness revision and checkout HEAD.");
}
if (active?.id !== expectedId || active?.revisionNumber !== expectedRevision || active?.headRevision !== expectedHead) {
  throw new Error("Server-derived active candidate does not match the runtime candidate.");
}
console.log(JSON.stringify({ taskId: task.id, candidateId: candidate.id, candidateRevision: candidate.revisionNumber, candidateHead: candidate.headRevision, projectedActive: active }, null, 2));
NODE
```

Keep `AH003_EXPECT_NO_ACTIVE=0` for B1-B7. Before B4 and B6, set
`AH003_EXPECTED_CANDIDATE_REVISION` to the disposable baseline revision plus one.
Before B8, set `AH003_EXPECT_NO_ACTIVE=1`; restore both values before another row.

For the fresh pre-merge baseline, use the persisted AH-003 task after it has real
retained evidence for Dev Review, Test, and Final Review. Approval evidence does not
exist until merge completes. Do not manufacture a passing task by changing verdicts.
If edge-state coverage is needed without changing
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
the API check immediately before the row. The baseline tuple below is the asserted
ID, harness revision, and checkout HEAD. A repair fixture must record the API-reported
revision one greater than its disposable baseline and its fixture head.

| ID | Setup | Route | Expected UI and action | Candidate ID / revision / SHA | Observed result, timestamp, evidence location |
| --- | --- | --- | --- | --- | --- |
| B1 Fresh evidence | Fresh pre-merge baseline with Dev Review, Test, and Final Review evidence matching the asserted active tuple and no Approval artifact yet | `#/tasks/AH-003/approval` | Integration candidate shows the asserted ID, revision, and head; no stale banner; Approval reads `awaits approval`, not `requires rerun`; command bar offers `Approve & merge C1`. | Asserted baseline tuple from the identity check | Pending operator observation; record ISO timestamp and evidence path. |
| B2 Missing binding | Disposable store, `AH003_FIXTURE_MODE=missing-binding` | `#/tasks/AH-003/dev-review` | Dev Review is not complete. The stage shows `Dev review requires rerun`, an evidence-binding reason naming the active revision, and a visible `Rerun Dev review`; confirm the stable API reason code is `missing-candidate-binding`. | Fixture tuple from API; head must equal checkout HEAD | Pending operator observation; record ISO timestamp and evidence path. |
| B3 Mismatched revision | Disposable store, `AH003_FIXTURE_MODE=mismatched-revision` | `#/tasks/AH-003/test` | Test evidence is not current. The focused-Test panel identifies superseded candidate-bound evidence or `Rerun required`, explains that the evidence revision does not match the active revision, and does not count the mismatched row as passed/current; confirm API reason code `candidate-revision-mismatch`. | Fixture tuple from API; head must equal checkout HEAD | Pending operator observation; record ISO timestamp and evidence path. |
| B4 Repair invalidation | Disposable store, `AH003_FIXTURE_MODE=repair` | `#/tasks/AH-003/dev-review` | Candidate revision is exactly one greater than the disposable baseline; retained prior-revision evidence remains inspectable; Dev Review, Test, Final Review, and Human Approval stage steps all read `rerun required`; the stale banner explains the revision mismatch; global action is `Rerun Dev review`. | Repair fixture tuple from API; revision = baseline + 1 | Pending operator observation; record ISO timestamp and evidence path. |
| B5 Exact-candidate Test summary | Fresh baseline with matching Test artifact, envelope, rows, and persisted run summary | `#/tasks/AH-003/test` | Focused-Test header reads `Candidate-bound structured evidence`, shows the asserted active ID and revision, and lists only rows whose candidate bindings match it. Selecting a row opens details; Back returns to the list. | Asserted baseline tuple from the identity check | Pending operator observation; record ISO timestamp and evidence path. |
| B6 Visible stale Final Review state | Disposable store, `AH003_FIXTURE_MODE=repair` | `#/tasks/AH-003/final-review` | Final Review summary does not show stale candidate evidence as `Passed`; downstream rows show `Stale after repair` or `Rerun required` with an actionable freshness reason, while historical artifact names remain available. | Repair fixture tuple from API; revision = baseline + 1 | Pending operator observation; record ISO timestamp and evidence path. |
| B7 Global rerun action | Disposable store, `AH003_FIXTURE_MODE=mismatched-revision` | `#/tasks/AH-003/test` | The primary command bar, outside the focused-Test row details, visibly offers `Rerun Test`. Verify it is the stage-level action; do not start a model run unless the operator has separately approved that local execution. | Fixture tuple from API; head must equal checkout HEAD | Pending operator observation; record ISO timestamp and evidence path. |
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
