import { Container, Graphics } from "pixi.js";
import { type WorkAction, workActions } from "./worker-behavior";

/** Illustrative tool feedback. These effects never represent file/test progress. */
export class ActivityEffect {
  readonly root = new Container();
  private beam = new Graphics();
  private pulses: Graphics[] = [];
  private sparks: Graphics[] = [];
  constructor(
    readonly action: WorkAction,
    x: number,
    y: number,
    scale: number,
  ) {
    const { color } = workActions[action];
    this.root.position.set(x, y);
    this.root.scale.set(scale);
    this.root.eventMode = "none";
    if (action === "fabricate") {
      this.beam.circle(0, 0, 3).fill({ color, alpha: 0.85 });
      for (let index = 0; index < 5; index++) {
        const spark = new Graphics().moveTo(0, 0).lineTo(3, -2).stroke({ color: 0xffdda7, width: 1 });
        this.root.addChild(spark);
        this.sparks.push(spark);
      }
    } else if (action === "communicate") {
      for (let index = 0; index < 3; index++) {
        const ring = new Graphics().ellipse(0, 0, 18, 8).stroke({ color, width: 1.4, alpha: 0.75 });
        this.root.addChild(ring);
        this.pulses.push(ring);
      }
    } else {
      // A bounded projected scan field on the station contact surface.
      this.beam
        .moveTo(-16, 0)
        .lineTo(8, -12)
        .lineTo(24, -3)
        .lineTo(0, 9)
        .closePath()
        .fill({ color, alpha: 0.12 })
        .stroke({ color, width: 1, alpha: 0.38 });
      for (let index = 0; index < 3; index++) {
        const line = new Graphics().moveTo(-12, 0).lineTo(10, -10).stroke({ color, width: 1.5, alpha: 0.7 });
        this.root.addChild(line);
        this.pulses.push(line);
      }
    }
    this.root.addChild(this.beam);
  }
  tick(time: number, offset: number) {
    const phase = ((time + offset) % workActions[this.action].period) / workActions[this.action].period;
    this.beam.alpha = 0.45 + Math.sin(phase * Math.PI * 2) * 0.25;
    this.sparks.forEach((spark, index) => {
      const step = (phase + index * 0.19) % 1;
      const angle = -Math.PI + index * 0.43;
      spark.position.set(Math.cos(angle) * step * 17, Math.sin(angle) * step * 12 + step * step * 6);
      spark.alpha = (1 - step) * 0.75;
    });
    this.pulses.forEach((pulse, index) => {
      const step = (phase + index / 3) % 1;
      if (this.action === "communicate") {
        pulse.scale.set(0.45 + step);
        pulse.position.set(26, -6 - step * 22);
      } else pulse.position.set(-5 + step * 16, -6 + step * 12);
      pulse.alpha = Math.sin(step * Math.PI) * 0.7;
    });
  }
}
