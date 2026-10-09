/**
 * Fixes for bugs in Babylon's own shaders, applied to the shader store before anything compiles.
 * Each names the Babylon version it was found in; drop a fix once an upgrade has it upstream.
 */

import { ShaderStore } from './core';
import '@babylonjs/core/Shaders/ShadersInclude/pbrClusteredLightingFunctions.js';
import '@babylonjs/core/ShadersWGSL/ShadersInclude/pbrClusteredLightingFunctions.js';

/** A wrong name in an include: replaced once (no-op if the text is no longer there). */
function patch(store: Record<string, string>, include: string, from: string, to: string): void {
  const text = store[include];
  if (text?.includes(from)) store[include] = text.split(from).join(to);
}

let applied = false;

export function applyShaderFixes(): void {
  if (applied) return;
  applied = true;
  // Babylon 9.29: clustered lights on a PBR material with sheen (our fabrics) pass `normalW`,
  // which doesn't exist inside the clustered lighting function (its normal is `N`): the WGSL
  // fails to compile and every pipeline after it is invalid.
  const sheen = ['computeSheenLighting(preInfo,normalW,', 'computeSheenLighting(preInfo,N,'] as const;
  patch(ShaderStore.IncludesShadersStoreWGSL, 'pbrClusteredLightingFunctions', ...sheen);
  patch(ShaderStore.IncludesShadersStore, 'pbrClusteredLightingFunctions', ...sheen);
}
