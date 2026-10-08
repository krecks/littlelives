/**
 * Player settings, persisted per browser in localStorage. Some apply live; the ones
 * listed in `RESTART_KEYS` take effect the next time a game is started or loaded.
 */

import { QUALITY, type QualitySettings } from '../render/quality';
import { VISUAL_STYLES, type VisualStyle } from '../render/styles';

export type QualityPreset = keyof typeof QUALITY;

export interface Settings {
  quality: QualityPreset;
  /** Look of the world: `classic` (warm stylised realism), `bright` (clean, pastel), `retro`. Applies live. */
  visualStyle: VisualStyle;
  renderer: 'auto' | 'webgl';
  /** Fraction of native resolution, 0.5..1. */
  resolutionScale: number;
  bloom: boolean;
  tiltShift: boolean;
  ambientOcclusion: boolean;
  autonomy: boolean;
  /** 0 disables autosave. */
  autosaveMinutes: number;
  cameraSensitivity: number;
  uiScale: number;
  clock24h: boolean;
  showFps: boolean;
  reducedMotion: boolean;
}

export const RESTART_KEYS: readonly (keyof Settings)[] = ['quality', 'renderer', 'ambientOcclusion'];

// Legacy key from the project's old name; kept so saves survive (and settings with them).
const STORAGE_KEY = 'open-sims-wasm.settings';

export const DEFAULT_SETTINGS: Settings = {
  quality: 'high',
  visualStyle: 'classic',
  renderer: 'auto',
  resolutionScale: 1,
  bloom: QUALITY.high.bloom,
  tiltShift: QUALITY.high.tiltShift,
  ambientOcclusion: QUALITY.high.ambientOcclusion,
  autonomy: true,
  autosaveMinutes: 5,
  cameraSensitivity: 1,
  uiScale: 1,
  clock24h: true,
  showFps: false,
  reducedMotion: false,
};

function load(): Settings {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Partial<Settings>;
    const merged = { ...DEFAULT_SETTINGS, ...stored };
    if (!VISUAL_STYLES.includes(merged.visualStyle)) merged.visualStyle = DEFAULT_SETTINGS.visualStyle;
    return merged;
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export const settings: Settings = $state(load());

$effect.root(() => {
  $effect(() => {
    const json = JSON.stringify(settings);
    try {
      localStorage.setItem(STORAGE_KEY, json);
    } catch {
      // Storage unavailable (private mode); settings still work for this session.
    }
  });
});

/** Choosing a preset resets the individual effect toggles to that preset's values. */
export function applyPreset(preset: QualityPreset): void {
  const q = QUALITY[preset];
  settings.quality = preset;
  settings.bloom = q.bloom;
  settings.tiltShift = q.tiltShift;
  settings.ambientOcclusion = q.ambientOcclusion;
}

export function resetSettings(): void {
  Object.assign(settings, DEFAULT_SETTINGS);
}

/** Renderer quality from settings; URL parameters still override for testing. */
export function qualityFromSettings(s: Settings, params: URLSearchParams): QualitySettings {
  const preset = QUALITY[(params.get('quality') as QualityPreset) ?? s.quality] ?? QUALITY.high;
  return {
    ...preset,
    bloom: s.bloom,
    tiltShift: s.tiltShift,
    ambientOcclusion: params.has('quality') ? preset.ambientOcclusion : s.ambientOcclusion,
    snapshotRendering: preset.snapshotRendering && params.get('snapshot') !== '0',
    visualStyle: (VISUAL_STYLES as readonly string[]).includes(params.get('style') ?? '') ? (params.get('style') as VisualStyle) : s.visualStyle,
  };
}
