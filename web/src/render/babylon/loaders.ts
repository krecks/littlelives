/**
 * Model loading setup, imported by everything that loads glTF files (`models.ts`).
 *
 * - The glTF 2.0 loader and its extensions are fetched on first use, not with the main script
 *   (Babylon's lazy registration, like `registerBuiltInLoaders` but for glTF only).
 * - Decoders (meshopt geometry, the KTX2 texture transcoder and its WASM) come from our own
 *   `decoders/` folder, a mirror of Babylon's CDN layout (`tools/assets/decoders.mjs`): the
 *   page is cross-origin isolated, and the game shouldn't depend on a CDN anyway.
 */

import { RegisterSceneLoaderPlugin } from '@babylonjs/core/Loading/sceneLoader';
import { Tools } from '@babylonjs/core/Misc/tools';
import { registerBuiltInGLTFExtensions } from '@babylonjs/loaders/glTF/2.0/Extensions/dynamic';
import { GLTFFileLoaderMetadata } from '@babylonjs/loaders/glTF/glTFFileLoader.metadata';

// Every Babylon CDN URL (decoders, transcoders) resolves under this folder instead.
Tools.ScriptBaseUrl = new URL(`${import.meta.env.BASE_URL}decoders/`, location.href).href;

RegisterSceneLoaderPlugin({
  ...GLTFFileLoaderMetadata,
  createPlugin: async (options) => {
    const [{ GLTFFileLoader, RegisterGLTF2Loader }, { RegisterInstancedMesh }] = await Promise.all([
      import('@babylonjs/loaders/glTF/2.0/glTFLoader.pure'),
      import('@babylonjs/core/Meshes/instancedMesh.pure'),
    ]);
    RegisterInstancedMesh();
    RegisterGLTF2Loader();
    return new GLTFFileLoader(options[GLTFFileLoaderMetadata.name]);
  },
});
registerBuiltInGLTFExtensions();
