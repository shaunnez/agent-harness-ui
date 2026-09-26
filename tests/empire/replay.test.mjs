import assert from "node:assert/strict";
import test from "node:test";
import { stageIds } from "../../src/domain.ts";
import { ReplayController } from "../../src/empire/replay/controller.ts";
import { replayDuration, replayFrame, replayMarks } from "../../src/empire/replay/engine.ts";
import { replayScript } from "../../src/empire/replay/script.ts";

const total = replayDuration(replayScript);
const frames = Array.from({ length: Math.ceil(total * 4) + 1 }, (_, i) => replayFrame(replayScript, i / 4));

test("the replay starts with a caravan marching from the Grand Market to the Watch Tower", () => {
  const first = replayFrame(replayScript, 0);
  assert.equal(first.from, "market");
  assert.equal(first.at, "triage");
  assert.equal(first.moving, true);
  assert.deepEqual(first.completed, []);
});

test("stages complete in workflow order and never un-complete", () => {
  let previous = [];
  for (const frame of frames) {
    for (const stage of previous) assert.ok(frame.completed.includes(stage), `${stage} lost at ${frame.t}`);
    const order = frame.completed.map((stage) => stageIds.indexOf(stage));
    assert.deepEqual(
      order,
      [...order].sort((a, b) => a - b),
    );
    previous = frame.completed;
  }
  const last = replayFrame(replayScript, total);
  assert.equal(last.finished, true);
  assert.deepEqual(last.completed, [...stageIds]);
  assert.equal(last.posture, "done");
});

test("a review finding sends a repair crew back and makes the old verdict stale until a fresh review", () => {
  const repair = frames.find((frame) => frame.repair);
  assert.ok(repair, "the replay walks the repair road");
  assert.equal(repair.from, "dev-review");
  assert.equal(repair.at, "implement");
  assert.ok(repair.stale.includes("dev-review"));
  assert.equal(repair.candidate, 1);
  const rebuilt = frames.find((frame) => frame.candidate === 2);
  assert.ok(rebuilt && rebuilt.t > repair.t, "repair raises candidate r2 after the repair march");
  const tested = frames.find((frame) => frame.at === "test" && !frame.moving);
  assert.ok(tested);
  assert.equal(tested.candidate, 2, "the manifest runs on the repaired candidate");
  assert.deepEqual(tested.stale, [], "a fresh review clears the stale verdict before test");
});

test("packages build in dependency batches before the candidate is assembled", () => {
  const withPackages = frames.filter((frame) => frame.packages.length);
  const s1Running = withPackages.find((frame) => frame.packages[0]?.status === "running");
  assert.ok(s1Running);
  assert.ok(s1Running.packages.slice(1).every((pkg) => pkg.status === "planned"));
  const assembled = frames.find((frame) => frame.candidate === 1);
  assert.ok(assembled.packages.every((pkg) => pkg.status === "integrated"));
});

test("human decisions are shown as waiting on you, never as work in progress", () => {
  const decrees = replayScript.filter((step) => step.kind === "decree");
  assert.deepEqual(
    decrees.map((step) => step.at),
    ["grill", "specification", "plan", "approval"],
  );
  assert.ok(decrees.every((step) => step.posture === "needs-you"));
});

test("stage marks cover all ten buildings in order", () => {
  const marks = replayMarks(replayScript);
  assert.deepEqual(
    marks.map((mark) => mark.stage),
    [...stageIds],
  );
  for (let i = 1; i < marks.length; i++) assert.ok(marks[i].t > marks[i - 1].t);
});

test("the controller plays at speed, stops at the end and restarts", () => {
  const controller = new ReplayController();
  controller.speed = 4;
  controller.tick(1);
  assert.equal(controller.t, 4);
  for (let i = 0; i < 200; i++) controller.tick(1);
  assert.equal(controller.t, controller.total);
  assert.equal(controller.playing, false);
  controller.toggle();
  assert.equal(controller.t, 0);
  assert.equal(controller.playing, true);
  controller.seek(-5);
  assert.equal(controller.t, 0);
});
