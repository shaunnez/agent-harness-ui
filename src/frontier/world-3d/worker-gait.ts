import { type Object3D, Quaternion, Vector3 } from "three";

/**
 * The authored worker export is 80 unparented rigid parts, so a leg cannot inherit a parent
 * rotation. Each part is swung about a shared hip pivot instead, and the parts below the knee are
 * swung again about the knee that the hip has already moved. The authored tool clip only drives the
 * arm, so the legs stay free for this walk without fighting the mixer.
 */
const upperLeg = ["thigh", "thigh_armour", "knee", "knee_actuator_outer_pin"];
const lowerLeg = ["shin", "shin_shell", "shin_longitudinal_plate_seam", "segmented_foot", "foot_ceramic_toe"];

/** Blender's duplicate suffix survives glTF as a trailing ordinal on an otherwise shared name. */
function partName(name: string) {
  return name.replace(/\d+$/, "");
}

interface GaitPart {
  node: Object3D;
  restPosition: Vector3;
  restQuaternion: Quaternion;
  right: boolean;
  lower: boolean;
}
export interface WorkerGait {
  parts: GaitPart[];
  hip: { left: Vector3; right: Vector3 };
  knee: { left: Vector3; right: Vector3 };
}

/**
 * Ground covered by one full cycle, in world units. A planted foot travels the swing arc backwards
 * over roughly half a cycle, so matching that arc to this distance is what keeps the feet from
 * skating; retune it alongside the hip and knee amplitudes below.
 */
export const gaitStrideCycle = 2.72;

export function buildGait(body: Object3D): WorkerGait | null {
  const parts: GaitPart[] = [];
  const thigh: Record<string, Vector3 | null> = { left: null, right: null };
  const knee: Record<string, Vector3 | null> = { left: null, right: null };
  body.traverse((node) => {
    const base = partName(node.name);
    const lower = lowerLeg.includes(base);
    if (!lower && !upperLeg.includes(base)) return;
    const right = node.position.x > 0;
    parts.push({
      node,
      restPosition: node.position.clone(),
      restQuaternion: node.quaternion.clone(),
      right,
      lower,
    });
    const side = right ? "right" : "left";
    if (base === "thigh") thigh[side] = node.position.clone();
    if (base === "knee") knee[side] = node.position.clone();
  });
  if (!parts.length || !thigh.left || !thigh.right || !knee.left || !knee.right) return null;
  // The hip sits above the thigh by half the thigh-to-knee span; the knee pivots on its own part.
  const hipOf = (t: Vector3, k: Vector3) => new Vector3(t.x, t.y + (t.y - k.y) * 0.5, t.z);
  return {
    parts,
    hip: { left: hipOf(thigh.left, knee.left), right: hipOf(thigh.right, knee.right) },
    knee: { left: knee.left, right: knee.right },
  };
}

const swing = new Quaternion();
const flex = new Quaternion();
const axis = new Vector3(1, 0, 0);
const pivot = new Vector3();
const placed = new Vector3();

/**
 * `phase` advances with distance walked so the stride stays locked to ground speed at any pace, and
 * `blend` fades the cycle out so a worker settles into its rest pose at a patrol waypoint.
 */
export function applyGait(gait: WorkerGait, phase: number, blend: number) {
  if (blend <= 0.001) {
    restGait(gait);
    return;
  }
  for (const part of gait.parts) {
    const lead = part.right ? phase + Math.PI : phase;
    // A leg reaches forward on the positive half of the cycle; -X keeps +Z the forward foot.
    const hipAngle = -Math.sin(lead) * 0.42 * blend;
    // The knee only folds one way, and folds most as the trailing leg lifts to swing through.
    const kneeAngle = Math.max(0, -Math.sin(lead)) * 0.75 * blend;
    const hip = part.right ? gait.hip.right : gait.hip.left;
    swing.setFromAxisAngle(axis, hipAngle);
    placed.copy(part.restPosition).sub(hip).applyQuaternion(swing).add(hip);
    if (part.lower) {
      const knee = part.right ? gait.knee.right : gait.knee.left;
      pivot.copy(knee).sub(hip).applyQuaternion(swing).add(hip);
      flex.setFromAxisAngle(axis, kneeAngle);
      placed.sub(pivot).applyQuaternion(flex).add(pivot);
      part.node.quaternion.copy(flex).multiply(swing).multiply(part.restQuaternion);
    } else {
      part.node.quaternion.copy(swing).multiply(part.restQuaternion);
    }
    part.node.position.copy(placed);
  }
}

export function restGait(gait: WorkerGait) {
  for (const part of gait.parts) {
    part.node.position.copy(part.restPosition);
    part.node.quaternion.copy(part.restQuaternion);
  }
}

/** Both feet push off once per half cycle, so the body rises at twice the stride frequency. */
export function gaitBob(phase: number, blend: number) {
  return Math.abs(Math.sin(phase)) * 0.055 * blend;
}
