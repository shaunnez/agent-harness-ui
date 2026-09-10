import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fixtureRun, fixtureTask } from "../src/frontier/fixtures/scenarios.ts";
import { attentionFor, isActiveRun } from "../src/frontier/runtime/presentation.ts";
import { workerBehavior } from "../src/frontier/world/worker-behavior.ts";

const readyStages = {
  "ready-for-implementation": "implement",
  "ready-for-review": "dev-review",
  "ready-for-test": "test",
  "ready-for-final-review": "final-review",
};

const projectedAttention = {
  kind: "idle",
  stage: "implement",
  label: "Ready for next step",
  reason: null,
  nextActor: "you",
  since: null,
  questionId: null,
};

test("all persisted ready statuses project to the semantic ready attention kind", () => {
  for (const [status, currentStage] of Object.entries(readyStages)) {
    const task = fixtureTask(`ready-${currentStage}`, "Ready task", "/demo/project", {
      status,
      currentStage,
      attention: { ...projectedAttention, stage: currentStage },
    });
    assert.equal(attentionFor(task).kind, "ready", status);
  }
});

test("ready projection does not replace exceptional or non-ready attention", () => {
  const exceptional = fixtureTask("ready-blocked", "Blocked ready task", "/demo/project", {
    status: "ready-for-test",
    currentStage: "test",
    attention: { ...projectedAttention, kind: "blocked", stage: "test" },
  });
  assert.equal(attentionFor(exceptional).kind, "blocked");

  for (const kind of ["running", "answer", "approval", "failed", "repair", "blocked", "dependency", "external", "completed"]) {
    const task = fixtureTask(`state-${kind}`, `${kind} task`, "/demo/project", {
      status: kind === "completed" ? "completed" : "queued",
      attention: { ...projectedAttention, kind },
    });
    assert.equal(attentionFor(task).kind, kind, kind);
  }
});

test("ready headquarters labels use a project-scoped green border while selected stays an outline", () => {
  const css = readFileSync(new URL("../src/frontier/ui/world-shell.css", import.meta.url), "utf8");
  const worldCanvas = readFileSync(new URL("../src/frontier/world/WorldCanvas.tsx", import.meta.url), "utf8");

  assert.match(css, /\.view-project \.world-label\.tone-ready\s*\{[\s\S]*border-color:\s*#4fca83/);
  assert.match(css, /\.world-label\.selected\s*\{[\s\S]*outline:\s*2px solid #57b0ff/);
  assert.match(worldCanvas, /world-label \$\{label\.kind\} tone-\$\{label\.attention\} \$\{label\.taskId === input\.selectedId/);
});

test("a completed run on a ready task remains parked without active worker presentation", () => {
  const run = fixtureRun("ready-run", "test", "completed");
  const task = fixtureTask("ready-inactive", "Ready after test", "/demo/project", {
    status: "ready-for-final-review",
    currentStage: "final-review",
    activeRunIds: [],
    runs: [run],
    attention: { ...projectedAttention, kind: "idle", stage: "final-review" },
  });

  assert.equal(attentionFor(task).kind, "ready");
  assert.equal(isActiveRun(task, run), false);
  assert.equal(workerBehavior(task, true, false, true), "park");
});
