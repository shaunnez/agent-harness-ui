import { createHash } from "node:crypto";
import { Matrix4, Quaternion, Vector3 } from "three";

const requiredGroups = {
  shell: [
    "MF_BaseFixed",
    "MF_ShellCutaway",
    "MF_Interior",
    "MF_Court",
    "MF_Props",
    "MF_Practicals",
    "MF_Sockets",
  ],
  crown: ["MF_Roof"],
  span: ["MF_Bridge"],
  end: ["MF_Bridge_End"],
  parcel: [
    "MF_Terrain",
    "MF_Planting",
    "MF_Road_Ring",
    ...[30, 90, 150, 210, 270, 330].flatMap((edge) => [`MF_Road_Spur_E${edge}`, `MF_Pad_E${edge}`]),
  ],
};
const identityRoles = new Set(["identity_roof_inset", "identity_roof_ring", "identity_trim"]);
const practicalRoles = new Set([
  "practical_warm_strip",
  "practical_warm_window_glass",
  "practical_station_marker",
  "practical_console_cyan",
  "practical_bollard_cap",
  "practical_delivery_beacon",
]);

/** Decode only self-contained, uncompressed glTF 2 assets produced by the local Blender pipeline. */
export function readColonyGlb(bytes) {
  if (
    !Buffer.isBuffer(bytes) ||
    bytes.length < 28 ||
    bytes.readUInt32LE(0) !== 0x46546c67 ||
    bytes.readUInt32LE(4) !== 2 ||
    bytes.readUInt32LE(8) !== bytes.length
  )
    throw new Error("Invalid colony GLB container");
  const jsonLength = bytes.readUInt32LE(12);
  if (bytes.readUInt32LE(16) !== 0x4e4f534a || 20 + jsonLength + 8 > bytes.length)
    throw new Error("Missing colony GLB JSON or binary chunk");
  const json = JSON.parse(
    bytes
      .subarray(20, 20 + jsonLength)
      .toString("utf8")
      .trim(),
  );
  const offset = 20 + jsonLength;
  const binaryLength = bytes.readUInt32LE(offset);
  if (bytes.readUInt32LE(offset + 4) !== 0x004e4942 || offset + 8 + binaryLength !== bytes.length)
    throw new Error("Invalid colony GLB binary chunk");
  const binary = bytes.subarray(offset + 8);
  if (
    json.asset?.version !== "2.0" ||
    json.buffers?.length !== 1 ||
    json.buffers[0].uri ||
    json.buffers[0].byteLength > binary.length
  )
    throw new Error("Colony GLB must embed one binary buffer");
  return { json, binary };
}

function accessorReader(json, binary, index) {
  const accessor = json.accessors?.[index];
  const view = json.bufferViews?.[accessor?.bufferView];
  const components = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[accessor?.type];
  const formats = {
    5121: [1, "readUInt8"],
    5123: [2, "readUInt16LE"],
    5125: [4, "readUInt32LE"],
    5126: [4, "readFloatLE"],
  };
  const format = formats[accessor?.componentType];
  if (
    !accessor ||
    !view ||
    !components ||
    !format ||
    accessor.sparse ||
    view.buffer !== 0 ||
    !Number.isInteger(accessor.count) ||
    accessor.count < 1
  )
    throw new Error("Unsupported or missing colony geometry accessor");
  const [size, method] = format;
  const stride = view.byteStride ?? components * size;
  const start = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const end = start + (accessor.count - 1) * stride + components * size;
  if (
    stride < components * size ||
    start < 0 ||
    end > binary.length ||
    end > (view.byteOffset ?? 0) + view.byteLength
  )
    throw new Error("Colony geometry accessor exceeds its buffer view");
  return {
    count: accessor.count,
    at(i) {
      if (!Number.isInteger(i) || i < 0 || i >= accessor.count)
        throw new Error("Colony vertex index out of range");
      const values = Array.from({ length: components }, (_, c) =>
        binary[method](start + i * stride + c * size),
      );
      if (!values.every(Number.isFinite)) throw new Error("Non-finite colony geometry");
      return values;
    },
  };
}

function nodeTransforms(json) {
  const transforms = new Map();
  const paths = new Map();
  function visit(index, parent, ancestors) {
    if (ancestors.includes(index) || transforms.has(index))
      throw new Error("Colony node graph is cyclic or multiply parented");
    const node = json.nodes?.[index];
    if (!node) throw new Error("Missing colony scene node");
    for (const [key, length] of [
      ["matrix", 16],
      ["translation", 3],
      ["rotation", 4],
      ["scale", 3],
    ]) {
      const value = node[key];
      if (
        value !== undefined &&
        (!Array.isArray(value) || value.length !== length || !value.every(Number.isFinite))
      )
        throw new Error("Invalid colony node transform");
    }
    const local = node.matrix
      ? new Matrix4().fromArray(node.matrix)
      : new Matrix4().compose(
          new Vector3(...(node.translation ?? [0, 0, 0])),
          new Quaternion(...(node.rotation ?? [0, 0, 0, 1])),
          new Vector3(...(node.scale ?? [1, 1, 1])),
        );
    const world = parent.clone().multiply(local);
    if (!world.elements.every(Number.isFinite)) throw new Error("Non-finite colony node transform");
    transforms.set(index, world);
    paths.set(
      index,
      [...ancestors, index].map((i) => json.nodes[i].name ?? ""),
    );
    for (const child of node.children ?? []) visit(child, world, [...ancestors, index]);
  }
  const scene = json.scenes?.[json.scene ?? 0];
  if (!scene?.nodes?.length) throw new Error("Colony GLB has no default scene");
  for (const index of scene.nodes) visit(index, new Matrix4(), []);
  return { transforms, paths };
}

function imageDimensions(bytes) {
  if (bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
    return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 4 < bytes.length) {
      if (bytes[offset++] !== 0xff) throw new Error("Invalid embedded JPEG");
      const marker = bytes[offset++];
      const length = bytes.readUInt16BE(offset);
      if ([0xc0, 0xc1, 0xc2].includes(marker))
        return [bytes.readUInt16BE(offset + 5), bytes.readUInt16BE(offset + 3)];
      if (length < 2) break;
      offset += length;
    }
  }
  throw new Error("Colony textures must be embedded PNG or JPEG");
}

export function validateColonyGlb(bytes, { kind, contract, expectedSha256 }) {
  if (!(kind in requiredGroups)) throw new Error(`Unknown colony asset kind: ${kind}`);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (expectedSha256 && expectedSha256 !== sha256)
    throw new Error("Colony asset hash differs from producer metadata");
  const { json, binary } = readColonyGlb(bytes);
  const { transforms, paths } = nodeTransforms(json);
  const nodes = new Map([...transforms.keys()].map((i) => [json.nodes[i].name, i]));
  const required = [...requiredGroups[kind]];
  if (kind === "shell") required.push(...Object.keys(contract.hq.rooms).map((room) => `MF_Interior_${room}`));
  for (const name of required) if (!nodes.has(name)) throw new Error(`Colony ${kind} missing group ${name}`);
  const materials = json.materials ?? [];
  for (const material of materials) {
    if (material.name?.startsWith("identity_") && !identityRoles.has(material.name))
      throw new Error(`Unknown identity material ${material.name}`);
    if (material.name?.startsWith("practical_") && !practicalRoles.has(material.name))
      throw new Error(`Unknown practical material ${material.name}`);
  }
  if (kind === "crown")
    for (const role of identityRoles)
      if (!materials.some((m) => m.name === role)) throw new Error(`Colony crown missing ${role}`);
  if ((json.images?.length ?? 0) > 8) throw new Error("Colony texture count exceeds eight");
  for (const image of json.images ?? []) {
    const view = json.bufferViews?.[image.bufferView];
    if (image.uri || !view || view.buffer !== 0)
      throw new Error("Colony textures must be embedded in the GLB");
    const dimensions = imageDimensions(
      binary.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength),
    );
    if (dimensions.some((n) => n < 1 || n > 2048)) throw new Error("Colony texture exceeds 2048 pixels");
  }
  let triangles = 0;
  let horizontalFaces = 0;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const [index, transform] of transforms) {
    const node = json.nodes[index];
    if (node.mesh === undefined) continue;
    for (const primitive of json.meshes?.[node.mesh]?.primitives ?? []) {
      if ((primitive.mode ?? 4) !== 4 || primitive.extensions)
        throw new Error("Colony geometry must use uncompressed triangles");
      const positions = accessorReader(json, binary, primitive.attributes?.POSITION);
      const indices =
        primitive.indices === undefined ? null : accessorReader(json, binary, primitive.indices);
      const count = indices?.count ?? positions.count;
      if (count % 3) throw new Error("Incomplete colony triangle");
      triangles += count / 3;
      const vertices = Array.from({ length: positions.count }, (_, i) =>
        new Vector3(...positions.at(i)).applyMatrix4(transform),
      );
      const lowY = vertices.reduce((value, p) => Math.min(value, p.y), Infinity);
      const highY = vertices.reduce((value, p) => Math.max(value, p.y), -Infinity);
      for (const point of vertices) {
        const xyz = point.toArray();
        for (let axis = 0; axis < 3; axis++) {
          min[axis] = Math.min(min[axis], xyz[axis]);
          max[axis] = Math.max(max[axis], xyz[axis]);
        }
        if (
          kind === "parcel" &&
          Math.hypot(point.x, point.z) > contract.colony.landRules.coastMaxRadius + 0.05
        )
          throw new Error("Parcel exceeds coast radius");
        if (kind === "crown") {
          if (point.y > contract.levels.crownEnvelopeMax + 0.05)
            throw new Error("Crown exceeds height envelope");
          for (const angle of contract.hq.footprint.flatsFace)
            if (
              point.x * Math.cos((angle * Math.PI) / 180) + point.z * Math.sin((angle * Math.PI) / 180) >
              contract.hq.footprint.apothem + 1.55
            )
              throw new Error("Crown exceeds hex eaves envelope");
        }
      }
      const terrain =
        kind === "parcel" &&
        paths
          .get(index)
          .some((name) => name === "MF_Terrain" || name.startsWith("MF_Road_") || name.startsWith("MF_Pad_"));
      if (terrain && materials[primitive.material]?.doubleSided)
        throw new Error("Terrain and roads must be single-sided");
      if (terrain)
        for (let i = 0; i < count; i += 3) {
          const [a, b, c] = [i, i + 1, i + 2].map((j) => {
            const vertex = indices ? indices.at(j)[0] : j;
            if (!vertices[vertex]) throw new Error("Colony vertex index out of range");
            return vertices[vertex];
          });
          const normal = new Vector3().subVectors(b, a).cross(new Vector3().subVectors(c, a));
          // Only upper horizontal surfaces: a closed core necessarily has downward bottom faces.
          if (
            Math.max(a.y, b.y, c.y) - Math.min(a.y, b.y, c.y) < 0.0001 &&
            a.y > 0 &&
            !(lowY > 0 && highY - lowY > 0.0001 && Math.abs(a.y - lowY) < 0.0001) &&
            normal.lengthSq() > 1e-12
          ) {
            horizontalFaces++;
            if (normal.y <= 0) throw new Error("Upper terrain or road face winds downward");
          }
        }
    }
  }
  if (!triangles) throw new Error("Colony asset has no triangles");
  const budget =
    contract.budgets[
      { shell: "hqShell", crown: "crown", parcel: "parcel", span: "bridgeSpan", end: "bridgeSpan" }[kind]
    ];
  if (triangles > budget.triangles || bytes.length > budget.bytes)
    throw new Error(`Colony ${kind} exceeds triangle or byte budget`);
  if (kind === "shell") {
    const sockets = [
      ...Object.values(contract.hq.rooms).flatMap((room) => room.sockets),
      ...contract.hq.hubOverflowSockets,
      ...contract.hq.courtSockets,
    ];
    for (const socket of sockets) {
      const index = nodes.get(socket.id);
      if (index === undefined) throw new Error(`Missing colony socket ${socket.id}`);
      const position = new Vector3().setFromMatrixPosition(transforms.get(index));
      if (position.distanceTo(new Vector3(socket.xz[0], socket.y, socket.xz[1])) > 0.05)
        throw new Error(`Colony socket differs from contract: ${socket.id}`);
    }
  }
  return {
    sha256,
    bytes: bytes.length,
    triangles,
    textures: json.images?.length ?? 0,
    meshes: json.meshes?.length ?? 0,
    bounds: { min, max },
    horizontalFaces,
  };
}
