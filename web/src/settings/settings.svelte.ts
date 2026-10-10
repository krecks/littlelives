/**
 * Player settings, persisted per browser in localStorage. Some apply live; the ones
 * listed in `RESTART_KEYS` take effect the next time a game is started or loaded.
 */

import { QUALITY, type QualitySettings } from '../render/quality';
import { VISUAL_STYLES, type VisualStyle } from '../render/styles';

export type QualityPreset = keyof typeof QUALITY;

export interface Settings {
  /** Look of the world: `classic` (warm stylised realism), `bright` (clean, pastel), `retro`. Applies live. */
  visualStyle: VisualStyle;
  renderer: 'auto' | 'webgl';
  /** Fraction of native resolution, 0.5..1. */
  resolutionScale: number;
  /** Shadow map size (1024, 2048 or 4096). */
  shadowDetail: number;
  /** 4× multisampling; off: FXAA. */
  antiAliasing: boolean;
  /** Every lamp lights (clustered lighting) rather than the four nearest the biggest rooms. */
  allLamps: boolean;
  ambientOcclusion: boolean;
  autonomy: boolean;
  /** 0 disables autosave. */
  autosaveMinutes: number;
  cameraSensitivity: number;
  uiScale: number;
  clock24h: boolean;
  showFps: boolean;
  reducedMotion: boolean;
  /** Interface sounds (buying, building, picking things up). */
  sound: boolean;
  /** Seconds without input before the camera starts watching on its own; 0: never. */
  directorDelay: number;
  /** How often the watching camera moves on: `calm` lingers, `lively` cuts sooner. */
  directorPace: 'calm' | 'lively';
  /** Fade the interface while the camera watches on its own. */
  hideHudWhileWatching: boolean;
  /** Slow down to normal speed for big moments (a first kiss, a new job, a fight at home). */
  autoSlow: boolean;
  /** Time-lapse while everyone at home sleeps or is at work. */
  skipQuietHours: boolean;
  /**
   * Clicking residents and the floor: `inspect` looks at a resident first (commands from their
   * panel); `always` gives orders straight away, as before.
   */
  directControl: 'inspect' | 'always';
  /** Residents speak out loud (docs/design/voices.md). Downloads the voice model when first on. */
  voices: boolean;
  /** Language residents speak (English only, for now). */
  voiceLanguage: 'en';
  voiceModel: 'paradee-8m';
  /** 0..1. */
  voiceVolume: number;
  /** Birds, crickets, and things in use at home (audio/world.ts). */
  worldSound: boolean;
  /** 0..1. */
  worldVolume: number;
}

export const RESTART_KEYS: readonly (keyof Settings)[] = ['renderer', 'shadowDetail', 'antiAliasing', 'allLamps', 'ambientOcclusion'];

// Legacy key from the project's old name; kept so saves survive (and settings with them).
const STORAGE_KEY = 'open-sims-wasm.settings';

export const DEFAULT_SETTINGS: Settings = {
  visualStyle: 'classic',
  renderer: 'auto',
  resolutionScale: 1,
  shadowDetail: QUALITY.high.shadowMapSize,
  antiAliasing: QUALITY.high.msaaSamples > 1,
  allLamps: QUALITY.high.clusteredLamps,
  ambientOcclusion: QUALITY.high.ambientOcclusion,
  autonomy: true,
  autosaveMinutes: 5,
  cameraSensitivity: 1,
  uiScale: 1,
  clock24h: true,
  showFps: false,
  reducedMotion: false,
  sound: true,
  directorDelay: 20,
  directorPace: 'calm',
  hideHudWhileWatching: false,
  autoSlow: true,
  skipQuietHours: true,
  directControl: 'inspect',
  voices: false,
  voiceLanguage: 'en',
  voiceModel: 'paradee-8m',
  voiceVolume: 0.8,
  worldSound: true,
  worldVolume: 0.6,
};

function load(): Settings {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Partial<Settings> & { quality?: QualityPreset };
    // Settings from before the quality preset was split up: what that preset set.
    const old = stored.quality && stored.shadowDetail === undefined ? QUALITY[stored.quality] : undefined;
    const preset = old ? { shadowDetail: old.shadowMapSize, antiAliasing: old.msaaSamples > 1, allLamps: old.clusteredLamps } : {};
    const merged = { ...DEFAULT_SETTINGS, ...preset, ...stored };
    // Settings that are gone (bloom, tilt-shift, the quality preset) aren't kept.
    for (const k of Object.keys(merged)) if (!(k in DEFAULT_SETTINGS)) delete (merged as Record<string, unknown>)[k];
    if (!VISUAL_STYLES.includes(merged.visualStyle)) merged.visualStyle = DEFAULT_SETTINGS.visualStyle;
    // Babble (0.14–0.19) is gone: anything but a language we have becomes the default.
    if (!['en'].includes(merged.voiceLanguage)) merged.voiceLanguage = DEFAULT_SETTINGS.voiceLanguage;
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

export function resetSettings(): void {
  Object.assign(settings, DEFAULT_SETTINGS);
}

/** Renderer quality from settings; `?quality=low|medium|high|ultra` still overrides for testing. */
export function qualityFromSettings(s: Settings, params: URLSearchParams): QualitySettings {
  const preset = QUALITY[params.get('quality') as QualityPreset] as QualitySettings | undefined;
  const chosen: QualitySettings = preset ?? {
    shadowMapSize: s.shadowDetail,
    msaaSamples: s.antiAliasing ? 4 : 1,
    ambientOcclusion: s.ambientOcclusion,
    snapshotRendering: true,
    clusteredLamps: s.allLamps,
  };
  return {
    ...chosen,
    snapshotRendering: chosen.snapshotRendering && params.get('snapshot') !== '0',
    visualStyle: (VISUAL_STYLES as readonly string[]).includes(params.get('style') ?? '') ? (params.get('style') as VisualStyle) : s.visualStyle,
  };
}
