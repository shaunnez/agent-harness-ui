import { type Camera, type Scene, type WebGLRenderer, WebGLRenderTarget } from "three";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { CopyShader } from "three/addons/shaders/CopyShader.js";
import { disposeFinish, sceneFinish } from "./finish";

/** Capture actual geometry with the same color and lighting treatment as the main canvas. */
export function captureScene(gl: WebGLRenderer, scene: Scene, camera: Camera, width: number, height: number) {
  const composer = sceneFinish(gl, scene, camera);
  const output = new WebGLRenderTarget(width, height);
  const copy = new ShaderPass(CopyShader);
  const previous = gl.getRenderTarget();
  composer.setSize(width, height);
  composer.renderToScreen = false;
  try {
    composer.render(0);
    // The finish pipeline is HDR. Convert its final sRGB pixels into a readable byte target.
    copy.render(gl, output, composer.readBuffer, 0, false);
    const pixels = new Uint8Array(width * height * 4);
    gl.readRenderTargetPixels(output, 0, 0, width, height, pixels);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return null;
    const image = context.createImageData(width, height);
    for (let row = 0; row < height; row++)
      image.data.set(pixels.subarray(row * width * 4, (row + 1) * width * 4), (height - row - 1) * width * 4);
    context.putImageData(image, 0, 0);
    return canvas.toDataURL("image/png");
  } finally {
    gl.setRenderTarget(previous);
    copy.dispose();
    output.dispose();
    disposeFinish(composer);
  }
}
