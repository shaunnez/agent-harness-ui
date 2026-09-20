import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { colonyContract } from "../../src/frontier/world-3d/colony.ts";
import { propObstacles, propPlacements } from "../../src/frontier/world-3d/prop-placement.ts";
import { clearOfObstacles, clearStandingPoint } from "../../src/frontier/world-3d/room-clearance.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const receipt = JSON.parse(
  await readFile(
    path.join(root, "design/mission-frontier/assets/staging/meshy-kit/producer/props-metadata.json"),
    "utf8",
  ),
);

test("the shipped props match the receipt and meet the 40k / 4MB kit and individual targets", async () => {
  const manifest = JSON.parse(
    await readFile(path.join(root, "public/frontier/assets/3d-proof/manifest.json"), "utf8"),
  );
  const bytes = await readFile(path.join(root, "public/frontier", manifest.colony.props));
  assert.equal(createHash("sha256").update(bytes).digest("hex"), receipt.sha256);
  assert.equal(bytes.length, receipt.bytes);
  assert.ok(bytes.length <= 4_000_000);
  const gltf = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)));
  let total = 0;
  for (const [name, prop] of Object.entries(receipt.props)) {
    const body = gltf.nodes.find((node) => node.name === `${name}_body`);
    assert.ok(body && body.mesh !== undefined, name);
    const triangles = gltf.meshes[body.mesh].primitives.reduce(
      (sum, p) => sum + gltf.accessors[p.indices].count / 3,
      0,
    );
    assert.equal(triangles, prop.triangles, `${name} exported count`);
    const target = { MF_Prop_FabCell: 6000, MF_Prop_ServiceCart: 5000 }[name];
    if (target) {
      assert.equal(prop.preparation.targetTriangles, target);
      assert.ok(triangles <= target, name);
    }
    total += triangles;
  }
  assert.ok(total <= 40_000, `${total} triangles`);
  assert.equal(receipt.budget.triangles, 40_000);
  assert.equal(receipt.budget.bytes, 4_000_000);
  assert.ok(gltf.materials.every((material) => !/\.\d{3}$/.test(material.name)));
  assert.equal(
    new Set(gltf.materials.map((material) => material.pbrMetallicRoughness.baseColorTexture.index)).size,
    8,
    "normalizing material names must not merge the eight baked atlases",
  );
});

test("the completed kit places three fabrication cells and a cart in the reserved floor areas", () => {
  const cells = propPlacements.filter((prop) => prop.node === "MF_Prop_FabCell");
  assert.equal(cells.length, 3);
  for (const cell of cells) {
    for (const [x, z] of corners(cell)) {
      const along = x * -0.5 + (z * -Math.sqrt(3)) / 2;
      const across = (x * Math.sqrt(3)) / 2 - z * 0.5;
      assert.ok(along >= 8 && along <= 14 && Math.abs(across) <= 0.8);
    }
  }
  const cart = propPlacements.find((prop) => prop.node === "MF_Prop_ServiceCart");
  const pad = colonyContract.hq.rooms.dispatch.cargoPads.find((pad) => pad.id === "cargo_cart");
  assert.deepEqual([cart.position[0], cart.position[2]], pad.xz);
});

/** The rotated plan corners of a placement, in the order the footprint is authored. */
function corners(prop) {
  const yaw = ((90 - prop.facingDeg) * Math.PI) / 180;
  const [width, depth] = prop.footprint;
  const across = [Math.cos(yaw), -Math.sin(yaw)];
  const through = [Math.sin(yaw), Math.cos(yaw)];
  return [
    [-1, -1],
    [-1, 1],
    [1, 1],
    [1, -1],
  ].map(([a, b]) => [
    prop.position[0] + ((a * width) / 2) * across[0] + ((b * depth) / 2) * through[0],
    prop.position[2] + ((a * width) / 2) * across[1] + ((b * depth) / 2) * through[1],
  ]);
}

test("every placement names a root the built kit actually carries, at the size the receipt states", () => {
  for (const prop of propPlacements) {
    const built = receipt.props[prop.node];
    assert.ok(built, `${prop.node} is not in props-metadata.json`);
    const [width, height, depth] = built.size;
    // The footprints here are copied from the receipt so the runtime can reason about floor without
    // reading a GLB. Binding them means a rebuild that resizes a prop fails here rather than
    // silently leaving robots standing inside it.
    assert.equal(prop.footprint[0], width, `${prop.node} width`);
    assert.equal(prop.footprint[1], depth, `${prop.node} depth`);
    assert.equal(prop.height, height, `${prop.node} height`);
  }
});

test("placement ids are unique, because one console stands in twenty places", () => {
  const ids = propPlacements.map((prop) => prop.id);
  assert.equal(new Set(ids).size, ids.length);
  const consoles = propPlacements.filter((prop) => prop.node === "MF_Prop_WallConsole");
  assert.equal(consoles.length, 20);
  assert.equal(propObstacles.length, propPlacements.length);
});

test("the wall row keeps the producer's own geometry: radial 15, a 3.4 m pitch, facing the room", () => {
  for (const bearing of [150, 210, 270, 330, 30]) {
    const row = propPlacements.filter((prop) => prop.id.startsWith(`MF_Prop_WallConsole_${bearing}_`));
    assert.equal(row.length, 4, `bearing ${bearing}`);
    for (const console_ of row) {
      assert.equal(console_.facingDeg, bearing + 180);
      // Distance from the sector's radial line is the authored offset; distance along it is 15.
      const radians = (bearing * Math.PI) / 180;
      const along = console_.position[0] * Math.cos(radians) + console_.position[2] * Math.sin(radians);
      assert.ok(Math.abs(along - 15) < 1e-9, `${console_.id} sits at radial ${along}`);
    }
    const offsets = row
      .map((console_) => {
        const tangent = (bearing * Math.PI) / 180 + Math.PI / 2;
        return console_.position[0] * Math.cos(tangent) + console_.position[2] * Math.sin(tangent);
      })
      .sort((a, b) => a - b);
    for (let i = 1; i < offsets.length; i++)
      assert.ok(offsets[i] - offsets[i - 1] >= 3.39, `${bearing} pitch ${offsets[i] - offsets[i - 1]}`);
  }
});

test("no prop stands outside the HQ: every corner is inside the lobe wall it backs onto", () => {
  // Outer radius of the widest arc bay. A prop may sit in the wall's own 0.6 m thickness -- the
  // greybox wall row does, and the wall is what hides it -- but never beyond the parapet. The
  // dispatch bay is the exception: it is a shed on the front flat, outside the arc entirely, and
  // its props are held to their frozen cargo pad instead.
  const parapet = 17.4;
  const pads = colonyContract.hq.rooms.dispatch.cargoPads;
  for (const prop of propPlacements) {
    const pad = pads.find(
      (entry) =>
        Math.abs(entry.xz[0] - prop.position[0]) < 1e-9 && Math.abs(entry.xz[1] - prop.position[2]) < 1e-9,
    );
    for (const [x, z] of corners(prop)) {
      if (pad) {
        assert.ok(
          Math.abs(x - pad.xz[0]) <= pad.footprint[0] / 2 + 1e-9 &&
            Math.abs(z - pad.xz[1]) <= pad.footprint[1] / 2 + 1e-9,
          `${prop.id} overhangs pad ${pad.id}`,
        );
        continue;
      }
      const radius = Math.hypot(x, z);
      assert.ok(radius < parapet, `${prop.id} corner at radial ${radius.toFixed(2)}`);
    }
  }
});

test("the intake desk clears both briefing sockets, which the greybox console it replaces does not", () => {
  const desk = propObstacles.find((obstacle) => obstacle.name === "MF_Prop_IntakeDesk");
  const briefing = colonyContract.hq.rooms.briefing.sockets.filter((socket) =>
    socket.id.startsWith("hq_briefing_0"),
  );
  assert.equal(briefing.length, 3);
  for (const socket of briefing)
    assert.ok(
      clearOfObstacles([socket.xz[0], socket.y, socket.xz[1]], [desk]),
      `${socket.id} stands inside the intake desk`,
    );
});

test("a prop only ever blocks a socket its own room's plan already reserves for equipment", () => {
  // Equipment sockets are the working positions at the piece itself -- `clearStandingPoint` already
  // refuses the review dais pair on the contract's own 2.2 m reservation. Every other socket in the
  // HQ has to survive the props, or a room loses standing room it was drawn with.
  const blocked = [];
  for (const [id, room] of Object.entries(colonyContract.hq.rooms))
    for (const socket of room.sockets) {
      const point = [socket.xz[0], socket.y, socket.xz[1]];
      if (!clearOfObstacles(point, propObstacles)) blocked.push(`${id}/${socket.id}`);
    }
  assert.deepEqual(blocked.sort(), [
    "planning/hq_planning_table_01",
    "planning/hq_planning_table_02",
    "review/hq_review_dais_01",
    "review/hq_review_dais_02",
    "testing/hq_testing_bench_01",
    "testing/hq_testing_bench_02",
  ]);
  for (const name of blocked)
    assert.ok(name.includes("_table_") || name.includes("_dais_") || name.includes("_bench_"), name);
});

test("the review station stands where the contract's own clearance reserves floor for it", () => {
  const dais = propPlacements.find((prop) => prop.id === "MF_Prop_ReviewStation");
  const reserved = [9 * Math.cos((Math.PI * 11) / 6), 9 * Math.sin((Math.PI * 11) / 6)];
  assert.ok(Math.hypot(dais.position[0] - reserved[0], dais.position[2] - reserved[1]) < 1e-9);
  // The reservation is 2.2 m; the scan is 1.6 m in radius, so it fits with the walking margin.
  assert.ok(dais.footprint[0] / 2 + 0.6 <= 2.21);
  // And a point just outside the reservation is still a legal standing point, so the room is usable.
  assert.equal(clearStandingPoint([reserved[0] + 2.3, 4.3, reserved[1]], "hq_review_01"), true);
});
