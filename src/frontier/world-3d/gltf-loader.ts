import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import type { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

/**
 * Shared GLTFLoader configuration for every proof asset.
 *
 * Scanned kit pieces carry Draco-compressed geometry, which needs a decoder the plain loader does
 * not install. The decoder is served from `public/frontier/decoders/draco` rather than a CDN so the
 * scene keeps loading offline and on an isolated host, matching the self-contained rule the colony
 * assets already follow. WebP textures (`EXT_texture_webp`) need no decoder: GLTFLoader reads them
 * natively wherever the browser decodes WebP.
 *
 * One decoder instance is shared across loaders; its worker pool is what makes repeat loads cheap,
 * so callers must not dispose it between scenes.
 */
let shared: DRACOLoader | null = null;

export function dracoLoader() {
  if (!shared) {
    shared = new DRACOLoader();
    shared.setDecoderPath("/decoders/draco/");
  }
  return shared;
}

/** Pass to `useLoader(GLTFLoader, urls, configureGltfLoader)`. */
export function configureGltfLoader(loader: GLTFLoader) {
  loader.setDRACOLoader(dracoLoader());
}
