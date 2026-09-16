import { type Camera, Matrix4, type Scene, Vector2, type WebGLRenderer, type WebGLRenderTarget } from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { GTAOPass } from "three/addons/postprocessing/GTAOPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";

/** Ambient occlusion is low frequency, so it survives being resolved at half the display size. */
const occlusionScale = 0.5;
/**
 * Seconds a reused occlusion buffer may go without a rebuild while the camera holds still. Long
 * enough that most frames skip the rebuild, short enough that a walking worker's contact shadow
 * keeps up with it rather than smearing along behind.
 */
const occlusionHold = 0.08;

/**
 * Decides when the occlusion buffer has to be rebuilt. The result depends only on the view, so a
 * parked camera can keep the buffer it already has; the interval is what lets the scene's own
 * movement catch up. Kept separate from the pass so the policy can be tested without a GPU.
 */
export class OcclusionCache {
  private readonly view = new Matrix4();
  private readonly projection = new Matrix4();
  private readonly hold: number;
  private held = Number.POSITIVE_INFINITY;
  constructor(hold = occlusionHold) {
    this.hold = hold;
  }
  expired(camera: Camera, delta: number) {
    this.held += delta;
    const still = this.view.equals(camera.matrixWorld) && this.projection.equals(camera.projectionMatrix);
    if (still && this.held < this.hold) return false;
    this.view.copy(camera.matrixWorld);
    this.projection.copy(camera.projectionMatrix);
    this.held = 0;
    return true;
  }
}

/**
 * Verified against three 0.186. `_renderGBuffer` is the pass's own switch for "normals and depth
 * were supplied, do not render them", and setting it is what lets the pass keep the gbuffer it
 * filled last time — the public `setGBuffer` would allocate a fresh render target instead. If a
 * later three drops the field the pass simply rebuilds every frame, as it does today.
 */
function reuseGBuffer(pass: GTAOPass, reuse: boolean) {
  const internal = pass as unknown as { _renderGBuffer?: boolean };
  if (typeof internal._renderGBuffer === "boolean") internal._renderGBuffer = !reuse;
}

/**
 * GTAO costs about half the day frame, and almost none of that is the occlusion itself: the pass
 * renders the entire scene a second time into a normal buffer before it samples anything. That
 * second pass only tells it what the camera sees, so this holds onto it between views — the same
 * bargain the shadow map already makes — and resolves the occlusion at half size on top.
 */
class CachedOcclusionPass extends GTAOPass {
  private readonly cache = new OcclusionCache();
  private readonly scale: number;
  constructor(scene: Scene, camera: Camera, scale = occlusionScale) {
    super(scene, camera);
    this.scale = scale;
  }
  override setSize(width: number, height: number) {
    super.setSize(Math.max(1, Math.round(width * this.scale)), Math.max(1, Math.round(height * this.scale)));
  }
  override render(
    renderer: WebGLRenderer,
    writeBuffer: WebGLRenderTarget,
    readBuffer: WebGLRenderTarget,
    deltaTime: number,
    maskActive: boolean,
  ) {
    reuseGBuffer(this, !this.cache.expired(this.camera, deltaTime));
    super.render(renderer, writeBuffer, readBuffer, deltaTime, maskActive);
  }
}

export function sceneFinish(gl: WebGLRenderer, scene: Scene, camera: Camera, pixelRatio = 1) {
  const composer = new EffectComposer(gl);
  composer.setPixelRatio(pixelRatio);
  const occlusion = new CachedOcclusionPass(scene, camera);
  occlusion.updateGtaoMaterial({ radius: 1.4, thickness: 1, distanceFallOff: 1, samples: 12 });
  occlusion.blendIntensity = 0.72;
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(occlusion);
  composer.addPass(new UnrealBloomPass(new Vector2(512, 512), 0.18, 0.35, 1.3));
  composer.addPass(new OutputPass());
  return composer;
}
export function disposeFinish(composer: EffectComposer) {
  for (const pass of composer.passes) pass.dispose();
  composer.dispose();
}
