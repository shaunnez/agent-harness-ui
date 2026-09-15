import { Filter, GlProgram, type Sprite, UniformGroup } from "pixi.js";

// Pixi's filter coordinates preserve the authored mask when the world pans or zooms.
const vertex = `
in vec2 aPosition;
out vec2 vTextureCoord;
uniform vec4 uInputSize;
uniform vec4 uOutputFrame;
uniform vec4 uOutputTexture;
void main() {
  vec2 p = aPosition * uOutputFrame.zw + uOutputFrame.xy;
  p.x = p.x * (2.0 / uOutputTexture.x) - 1.0;
  p.y = p.y * (2.0 * uOutputTexture.z / uOutputTexture.y) - uOutputTexture.z;
  gl_Position = vec4(p, 0.0, 1.0);
  vTextureCoord = aPosition * uOutputFrame.zw * uInputSize.zw;
}`;
const fragment = `
in vec2 vTextureCoord;
out vec4 finalColor;
uniform sampler2D uTexture;
uniform float uTime;
uniform float uExposure;
void main() {
  vec4 sampleMask = texture(uTexture, vTextureCoord);
  vec3 mask = sampleMask.rgb / max(sampleMask.a, 0.0001);
  float distance = mask.r;
  float cycle = fract(uTime / 7.0);
  float travel = 0.82 - cycle * 0.75;
  float crest = 1.0 - smoothstep(0.025, 0.13, abs(distance - travel));
  float envelope = sin(cycle * 3.14159265);
  float wash = (1.0 - smoothstep(0.0, 0.24, distance)) * (0.5 + 0.5 * sin(uTime * 0.897));
  float alpha = sampleMask.a * (crest * envelope * 0.30 + wash * 0.10);
  vec3 foam = vec3(0.69, 0.87, 0.88) * uExposure;
  finalColor = vec4(foam * alpha, alpha);
}`;

/** A shore-distance mask, not a translated ocean image. Alpha excludes rocks and bridge supports. */
export class CoastalSurf {
  private filter: Filter;
  private uniforms = new UniformGroup({
    uTime: { value: 1.8, type: "f32" },
    uExposure: { value: 1, type: "f32" },
  });
  constructor(readonly sprite: Sprite) {
    this.filter = new Filter({
      glProgram: GlProgram.from({ vertex, fragment, name: "coastal-shore" }),
      resources: { surfUniforms: this.uniforms },
      padding: 0,
    });
    sprite.eventMode = "none";
    sprite.filters = [this.filter];
    sprite.on("destroyed", () => this.filter.destroy());
  }
  update(seconds: number, lamps: number) {
    this.uniforms.uniforms.uTime = seconds;
    this.uniforms.uniforms.uExposure = 1 - lamps * 0.78;
  }
}
