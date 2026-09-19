/**
 * The clips `worker.glb` carries, and which one a robot plays.
 *
 * The export used to ship one clip, `worker_tool_work`, while `workActions` already named three
 * poses -- so four of the six actions stood still, and roaming was animated by hand in the renderer
 * because the parts had no parent hierarchy. The rigged export carries all four, authored from the
 * pivots and poses the production and sprite-rebuild scripts already owned.
 */
export const workerClips = ["worker_walk", "worker_scan", "worker_type", "worker_tool_work"] as const;
export type WorkerClip = (typeof workerClips)[number];

/** `workActions[...].pose` is the authored pose name; this is the clip that plays it. */
export const clipForPose: Record<"work" | "scan" | "type", WorkerClip> = {
  work: "worker_tool_work",
  scan: "worker_scan",
  type: "worker_type",
};

/**
 * Ground covered by one full `worker_walk` cycle, and the cycle's length, from the producer receipt
 * (`worker-metadata.json`). A planted foot travels the support arc backwards over half a cycle, so
 * playing the clip at this rate is what keeps the feet from skating; the renderer scales the clip by
 * `speed / walkCycleSpeed` for any other pace.
 */
export const walkStrideMetres = 0.9882;
export const walkCycleSeconds = 0.8;
export const walkCycleSpeed = walkStrideMetres / walkCycleSeconds;

export function clipForWorker(behavior: string, pose: "work" | "scan" | "type") {
  if (behavior === "roam") return "worker_walk" as const;
  return behavior === "work" ? clipForPose[pose] : null;
}
