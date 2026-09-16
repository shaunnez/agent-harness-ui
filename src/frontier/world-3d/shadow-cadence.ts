/** Architecture is static, so only the workers' own shadows have to keep up with the scene. */
const shadowInterval = 1000 / 15;
/**
 * Frames that must pass between rebuilds whatever the clock says. A wall-clock gate on its own
 * inverts under load: once a frame costs more than the interval, every frame clears it and the
 * shadow map rebuilds on exactly the frames that can least afford it.
 */
const shadowFrames = 4;

/**
 * Decides when the shadow map may be rebuilt. Both gates have to open, so a fast display still
 * refreshes at the interval while a struggling one spends at most one frame in four on shadows.
 */
export class ShadowCadence {
  private readonly interval: number;
  private readonly frames: number;
  private since: number;
  private updated = Number.NEGATIVE_INFINITY;
  constructor(interval = shadowInterval, frames = shadowFrames) {
    this.interval = interval;
    this.frames = frames;
    // The first frame has no shadows to keep, so it rebuilds rather than waiting out the gates.
    this.since = frames;
  }
  expired(now: number) {
    this.since += 1;
    if (this.since < this.frames || now - this.updated < this.interval) return false;
    this.since = 0;
    this.updated = now;
    return true;
  }
}
