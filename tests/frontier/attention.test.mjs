import assert from "node:assert/strict";
import test from "node:test";
import { projectTaskAttention } from "../../server/task-attention.mjs";
import { projectTaskCore, projectTaskSummary } from "../../server/task-projections.mjs";
import { makeFixtureTasks } from "../../src/frontier/fixtures/scenarios.ts";
import {
  isActiveRun,
  isExecuting,
  needsYou,
  packageState,
  runDuration,
  splitRecordedDetail,
} from "../../src/frontier/runtime/presentation.ts";

test("HQ counts decisions without counting a normal dependency wait", () => {
  const tasks = makeFixtureTasks().filter((task) => task.id.startsWith("PC-") && task.status !== "completed");
  assert.equal(tasks.length, 3);
  assert.equal(tasks.filter(isExecuting).length, 1);
  assert.equal(tasks.filter(needsYou).length, 2);
  assert.equal(packageState(tasks[0].workPackages[2], tasks[0].workPackages), "Waiting on S2");
});

test("an approved plan awaiting dispatch does not read as a dependency-blocked task", () => {
  const attention = projectTaskAttention({
    currentStage: "implement",
    status: "ready-for-implementation",
    workPackages: [
      { id: "S1", status: "planned", dependencies: [] },
      { id: "S2", status: "planned", dependencies: ["S1"] },
    ],
  });
  assert.equal(attention.kind, "idle");
  assert.equal(attention.nextActor, "you");
  assert.equal(attention.label, "Ready to implement");
});

test("a finished review and finished question generator remain parked while task attention persists", () => {
  for (const id of ["PC-148", "PC-153"]) {
    const task = makeFixtureTasks().find((item) => item.id === id);
    const run = task.runs[0];
    assert.equal(isActiveRun(task, run), false);
    assert.equal(runDuration(run, Date.now(), false), 360_000);
    assert.equal(runDuration(run, Date.now() + 3600_000, false), 360_000);
    assert.equal(needsYou(task), true);
  }
});

test("a failed package does not hide a healthy executing sibling", () => {
  const task = makeFixtureTasks().find((item) => item.id === "AH-054");
  assert.equal(isExecuting(task), true);
  assert.equal(projectTaskAttention(task).kind, "failed");
  // The fixture's reason is a realistic multi-line qualification failure, so assert the
  // verdict line the UI actually shows rather than pinning the whole command output.
  assert.equal(
    splitRecordedDetail(projectTaskAttention(task).reason).headline,
    "S2 did not qualify: playwright-e2e failed — make e2e-native exited 2.",
  );
});

test("missing evidence stays absent and unrelated updates never become waiting-since timestamps", () => {
  const attention = projectTaskAttention({
    status: "repair-required",
    currentStage: "dev-review",
    updatedAt: new Date().toISOString(),
  });
  assert.equal(attention.reason, null);
  assert.equal(attention.since, null);
  assert.equal(attention.nextActor, "you");
});

test("repair execution is explicit without rewriting the requesting gate", () => {
  const attention = projectTaskAttention({
    status: "repair-required",
    currentStage: "test",
    activeRunKind: "repair",
    error: "Failed assertion",
  });
  assert.equal(attention.kind, "running");
  assert.equal(attention.stage, "test");
  assert.equal(attention.label, "Repair running via Implement");
});

test("historical workers stay parked while the task has another active run", () => {
  const task = makeFixtureTasks().find((item) => item.id === "PC-142");
  const historical = task.runs.find((run) => run.stage === "plan");
  assert.equal(isActiveRun(task, historical), false);
  assert.equal(runDuration(historical, Date.now() + 60_000, false), 360_000);
  const closed = { ...task, status: "closed", attention: { kind: "failed" } };
  assert.equal(needsYou(closed), false);
  assert.equal(
    isActiveRun(
      closed,
      task.runs.find((run) => run.status === "running"),
    ),
    false,
  );
});

test("summary and inspector preserve the same retained run failure reason", () => {
  const task = makeFixtureTasks().find((item) => item.id === "AH-051");
  task.error = null;
  task.runs[0].error = "Retained provider preflight failed.";
  assert.equal(projectTaskSummary(task).attention.reason, "Retained provider preflight failed.");
  assert.deepEqual(projectTaskCore(task).attention, projectTaskSummary(task).attention);
});

test("terminal history does not revive an old blocker or failed package as a current decision", () => {
  const task = makeFixtureTasks().find((item) => item.id === "AH-054");
  for (const status of ["completed", "closed", "archived", "cancelled"]) {
    const attention = projectTaskAttention({ ...task, status, blocker: { detail: "Historical failure" } });
    assert.equal(attention.kind, "completed");
    assert.equal(attention.nextActor, null);
  }
});

test("a recorded reason keeps its verdict line separate from the command output", () => {
  // The shape a failed qualification actually persists: verdict, then the command's own
  // output. HTML collapses the newlines, so a summary that renders the whole string is one
  // unreadable paragraph — the split is what keeps the card to the verdict.
  const recorded = [
    "S1 did not qualify: playwright-e2e failed — make e2e-native exited 2.",
    "3 unexpected, 0 flaky, 83 expected",
    "Playwright unexpected results:",
    "- 15-tenant-branding.spec.ts › two accounts remain isolated",
  ].join("\n");
  const { headline, body } = splitRecordedDetail(recorded);
  assert.equal(headline, "S1 did not qualify: playwright-e2e failed — make e2e-native exited 2.");
  assert.equal(body, "3 unexpected, 0 flaky, 83 expected\nPlaywright unexpected results:\n- 15-tenant-branding.spec.ts › two accounts remain isolated");
  assert.ok(!headline.includes("\n"), "a headline never carries a line break into a summary row");
});

test("a single-line reason reports no output body, so nothing renders an empty box", () => {
  for (const recorded of [
    "S1 retained slice did not qualify under the corrected verification plan.",
    "  Padded on both sides.  ",
    "Trailing newline only.\n",
    "Blank lines only after the verdict.\n\n   \n",
  ]) {
    const { body } = splitRecordedDetail(recorded);
    assert.equal(body, null, `${JSON.stringify(recorded)} has no output beneath its verdict`);
  }
  assert.equal(splitRecordedDetail("  Padded on both sides.  ").headline, "Padded on both sides.");
});

test("an absent reason is not rendered as the string null", () => {
  for (const missing of [null, undefined, ""]) {
    assert.deepEqual(splitRecordedDetail(missing), { headline: "", body: null });
  }
});
