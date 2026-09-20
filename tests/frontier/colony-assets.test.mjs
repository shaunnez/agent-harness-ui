import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { readColonyGlb, validateColonyGlb } from "../../scripts/frontier/validate-colony-assets.mjs";

const contract = JSON.parse(
  await readFile(
    new URL("../../design/mission-frontier/assets/staging/colony-hq-v1/contract.json", import.meta.url),
    "utf8",
  ),
);
function sample(change = () => {}) {
  const binary = Buffer.alloc(36);
  [0, 0, 0, 1, 0, 0, 0, 1, 0].forEach((n, i) => {
    binary.writeFloatLE(n, i * 4);
  });
  const json = {
    asset: { version: "2.0" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ name: "MF_Bridge", mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, material: 0 }] }],
    materials: [{ name: "structure_ivory_ceramic" }],
    buffers: [{ byteLength: binary.length }],
    bufferViews: [{ buffer: 0, byteLength: binary.length }],
    accessors: [{ bufferView: 0, componentType: 5126, type: "VEC3", count: 3 }],
  };
  change(json, binary);
  const encoded = Buffer.from(JSON.stringify(json));
  const padded = Buffer.alloc(Math.ceil(encoded.length / 4) * 4, 32);
  encoded.copy(padded);
  const result = Buffer.alloc(28 + padded.length + binary.length);
  result.writeUInt32LE(0x46546c67, 0);
  result.writeUInt32LE(2, 4);
  result.writeUInt32LE(result.length, 8);
  result.writeUInt32LE(padded.length, 12);
  result.writeUInt32LE(0x4e4f534a, 16);
  padded.copy(result, 20);
  result.writeUInt32LE(binary.length, 20 + padded.length);
  result.writeUInt32LE(0x004e4942, 24 + padded.length);
  binary.copy(result, 28 + padded.length);
  return result;
}
const validate = (bytes, options = {}) => validateColonyGlb(bytes, { kind: "span", contract, ...options });

test("colony import measures geometry in scene coordinates and binds the exact bytes", () => {
  const bytes = sample((json) => {
    json.nodes[0].translation = [5, 4.25, 2];
  });
  const result = validate(bytes);
  assert.equal(result.triangles, 1);
  assert.equal(result.bytes, bytes.length);
  assert.deepEqual(result.bounds, { min: [5, 4.25, 2], max: [6, 5.25, 2] });
  assert.deepEqual(validate(bytes, { expectedSha256: result.sha256 }), result);
  assert.throws(() => validate(bytes, { expectedSha256: "0".repeat(64) }), /hash differs/);
});

test("colony import rejects broken containers, graph cycles and missing groups", () => {
  assert.throws(() => readColonyGlb(Buffer.alloc(8)), /container/);
  const truncated = sample();
  truncated.writeUInt32LE(truncated.length - 1, 8);
  assert.throws(() => validate(truncated), /container/);
  assert.throws(
    () =>
      validate(
        sample((j) => {
          j.nodes[0].name = "wrong";
        }),
      ),
    /missing group/,
  );
  assert.throws(
    () =>
      validate(
        sample((j) => {
          j.nodes[0].children = [0];
        }),
      ),
    /cyclic/,
  );
  assert.throws(
    () =>
      validate(
        sample((j) => {
          j.nodes[0].translation = [null, 0, 0];
        }),
      ),
    /./,
  );
});

test("colony import rejects unportable resources and unknown semantic materials", () => {
  assert.throws(
    () =>
      validate(
        sample((j) => {
          j.buffers[0].uri = "other.bin";
        }),
      ),
    /embed one/,
  );
  assert.throws(
    () =>
      validate(
        sample((j) => {
          j.images = [{ uri: "remote.png" }];
        }),
      ),
    /embedded/,
  );
  assert.throws(
    () =>
      validate(
        sample((j) => {
          j.materials[0].name = "identity_task_status";
        }),
      ),
    /Unknown identity/,
  );
  assert.throws(
    () =>
      validate(
        sample((j) => {
          j.materials[0].name = "practical_unknown";
        }),
      ),
    /Unknown practical/,
  );
});

test("colony import rejects invalid accessors, nonfinite vertices and exceeded budgets", () => {
  assert.throws(
    () =>
      validate(
        sample((j) => {
          j.accessors[0].count = 300;
        }),
      ),
    /exceeds its buffer/,
  );
  assert.throws(
    () =>
      validate(
        sample((_j, b) => {
          b.writeFloatLE(NaN, 0);
        }),
      ),
    /Non-finite/,
  );
  const strict = structuredClone(contract);
  strict.budgets.bridgeSpan.triangles = 0;
  assert.throws(() => validate(sample(), { contract: strict }), /exceeds triangle/);
});
