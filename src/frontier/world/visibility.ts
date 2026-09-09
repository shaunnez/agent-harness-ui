interface VisibilitySource {
  readonly hidden: boolean;
  addEventListener(type: "visibilitychange", listener: () => void): void;
  removeEventListener(type: "visibilitychange", listener: () => void): void;
}

/** Owns the document subscription and the renderer's animation admission. */
export class AnimationVisibility {
  private motion = false;
  private connected = false;
  private source: VisibilitySource;
  private apply: (animate: boolean) => void;
  constructor(source: VisibilitySource, apply: (animate: boolean) => void) {
    this.source = source;
    this.apply = apply;
    source.addEventListener("visibilitychange", this.synchronize);
  }
  update(motion: boolean, connected: boolean) {
    this.motion = motion;
    this.connected = connected;
    this.synchronize();
  }
  private synchronize = () => this.apply(!this.source.hidden && this.motion && this.connected);
  dispose() {
    this.source.removeEventListener("visibilitychange", this.synchronize);
    this.apply(false);
  }
}
