/**
 * Rendering quality. Players set each part in Settings → Performance; these presets are for
 * testing (`?quality=`) and `high` gives the defaults.
 */

import type { VisualStyle } from './styles';

export interface QualitySettings {
  shadowMapSize: number;
  msaaSamples: number;
  ambientOcclusion: boolean;
  /** WebGPU only: record draw commands once and replay them each frame. */
  snapshotRendering: boolean;
  /**
   * Every lamp lights (clustered lighting, up to 32) rather than the four nearest the biggest
   * rooms. Measured on an M3 Pro at 2880×1800 with 20 lamps lit: +0.6 ms a frame on WebGPU,
   * +2.8 ms on WebGL2 (where supported; otherwise four lamps).
   */
  clusteredLamps: boolean;
  /** Initial visual style (changeable live with `Renderer.setVisualStyle`). Default `classic`. */
  visualStyle?: VisualStyle;
}

export const QUALITY: Record<'low' | 'medium' | 'high' | 'ultra', QualitySettings> = {
  low: { shadowMapSize: 1024, msaaSamples: 1, ambientOcclusion: false, snapshotRendering: true, clusteredLamps: false },
  medium: { shadowMapSize: 2048, msaaSamples: 4, ambientOcclusion: false, snapshotRendering: true, clusteredLamps: true },
  // Ambient occlusion is off by default: Babylon 9.29's SSAO2 intermittently fails to bind its
  // sampler on WebGPU startup (~1 in 4 loads). Enable with `?quality=ultra` to test fixes.
  high: { shadowMapSize: 2048, msaaSamples: 4, ambientOcclusion: false, snapshotRendering: true, clusteredLamps: true },
  ultra: { shadowMapSize: 4096, msaaSamples: 4, ambientOcclusion: true, snapshotRendering: true, clusteredLamps: true },
};
