import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import { PMREMGenerator } from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import type { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { disposeFinish, sceneFinish } from "./finish";

/** Contact shadows and restrained light bloom are part of the scene, not the React HUD. */
export function SceneFinish() {
  const { gl, scene, camera, size } = useThree();
  const pipeline = useRef<EffectComposer | null>(null);
  useEffect(() => {
    const environment = new RoomEnvironment();
    const generator = new PMREMGenerator(gl);
    const light = generator.fromScene(environment, 0.06);
    const previous = scene.environment;
    scene.environment = light.texture;
    scene.environmentIntensity = 0.35;
    const composer = sceneFinish(gl, scene, camera, Math.min(gl.getPixelRatio(), 1.5));
    pipeline.current = composer;
    return () => {
      pipeline.current = null;
      disposeFinish(composer);
      scene.environment = previous;
      light.dispose();
      generator.dispose();
      environment.dispose();
    };
  }, [gl, scene, camera]);
  useEffect(() => {
    pipeline.current?.setSize(size.width, size.height);
  }, [size.width, size.height]);
  useFrame((_, delta) => pipeline.current?.render(delta), 1);
  return null;
}
