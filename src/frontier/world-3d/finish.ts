import { type Camera, type Scene, Vector2, type WebGLRenderer } from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { GTAOPass } from "three/addons/postprocessing/GTAOPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";

export function sceneFinish(gl: WebGLRenderer, scene: Scene, camera: Camera, pixelRatio = 1) {
  const composer = new EffectComposer(gl);
  composer.setPixelRatio(pixelRatio);
  const occlusion = new GTAOPass(scene, camera);
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
