const frames = (pose: string) => Array.from({ length: 8 }, (_, index) => `mf.living.worker.${pose}.${index}`);
export const livingWorker = {
  walk: frames("walk"),
  scan: frames("scan"),
  type: frames("type"),
  frameDurationMs: 150,
};
