// Playback state shared by the map (which reads it every frame) and the replay bar.
import { type ReplayFrame, replayDuration, replayFrame, replayMarks } from "./engine.ts";
import { type ReplayStep, replayScript } from "./script.ts";

export class ReplayController {
  t = 0;
  playing = true;
  speed = 1;
  follow = true;
  readonly script: ReplayStep[];
  readonly total: number;
  readonly marks: ReturnType<typeof replayMarks>;

  constructor(script: ReplayStep[] = replayScript) {
    this.script = script;
    this.total = replayDuration(script);
    this.marks = replayMarks(script);
  }
  tick(dt: number) {
    if (!this.playing) return;
    this.t = Math.min(this.total, this.t + dt * this.speed);
    if (this.t >= this.total) this.playing = false;
  }
  seek(t: number) {
    this.t = Math.max(0, Math.min(this.total, t));
  }
  toggle() {
    if (this.t >= this.total) this.t = 0;
    this.playing = !this.playing;
  }
  restart() {
    this.t = 0;
    this.playing = true;
  }
  frame(): ReplayFrame {
    return replayFrame(this.script, this.t);
  }
}
