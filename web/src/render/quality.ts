/** Rendering quality presets. Desktop-only targets; `high` is the default. */

export interface QualitySettings {
  shadowMapSize: number;
  msaaSamples: number;
  ambientOcclusion: boolean;
  bloom: boolean;
  /** Subtle depth-of-field for the miniature look. */
  tiltShift: boolean;
  /** WebGPU only: record draw commands once and replay them each frame. */
  snapshotRendering: boolean;
}

export const QUALITY: Record<'low' | 'medium' | 'high' | 'ultra', QualitySettings> = {
  low: { shadowMapSize: 1024, msaaSamples: 1, ambientOcclusion: false, bloom: false, tiltShift: false, snapshotRendering: true },
  medium: { shadowMapSize: 2048, msaaSamples: 4, ambientOcclusion: false, bloom: true, tiltShift: false, snapshotRendering: true },
  // Ambient occlusion is off by default: Babylon 9.29's SSAO2 intermittently fails to bind its
  // sampler on WebGPU startup (~1 in 4 loads). Enable with `?quality=ultra` to test fixes.
  high: { shadowMapSize: 2048, msaaSamples: 4, ambientOcclusion: false, bloom: true, tiltShift: true, snapshotRendering: true },
  ultra: { shadowMapSize: 4096, msaaSamples: 4, ambientOcclusion: true, bloom: true, tiltShift: true, snapshotRendering: true },
};
