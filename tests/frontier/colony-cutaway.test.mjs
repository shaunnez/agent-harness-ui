import assert from "node:assert/strict";
import test from "node:test";
import { Group } from "three";
import { cutawayGroups } from "../../src/frontier/world-3d/cutaway.ts";

test("cutaway includes both shell and crown roof roots without hiding retained floors", () => {
  const base = new Group();
  const shell = new Group();
  const crown = new Group();
  base.add(shell, crown);
  const roof = new Group();
  roof.name = "MF_Roof";
  const separateRoof = new Group();
  separateRoof.name = "MF_Roof";
  const walls = new Group();
  walls.name = "MF_ShellCutaway";
  const floor = new Group();
  floor.name = "MF_Interior";
  shell.add(roof, walls, floor);
  crown.add(separateRoof);
  const groups = cutawayGroups(base);
  assert.deepEqual(groups, [roof, walls, separateRoof]);
  for (const object of groups) object.visible = false;
  assert.equal(roof.visible, false);
  assert.equal(separateRoof.visible, false);
  assert.equal(floor.visible, true);
  assert.deepEqual(cutawayGroups(undefined), []);
});
