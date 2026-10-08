/**
 * Visual styles: the same world, models and gameplay drawn with a different look.
 * A style only changes lighting, sky, post-processing, colour grading and material response
 * (see docs/design/look.md for what each style aims for). Pure data; the renderer
 * applies it, and switching is live.
 */

export type VisualStyle = 'classic' | 'bright' | 'retro';

export const VISUAL_STYLES: readonly VisualStyle[] = ['classic', 'bright', 'retro'];

/** One time-of-day keyframe. Colours are sRGB hex; intensities are PBR units. */
export interface LightKey {
  hour: number;
  /** Direct sun (or moon) intensity. */
  sun: number;
  sunColor: string;
  /** Hemispheric fill: tints the ambient (golden hour, blue hour, night). */
  sky: number;
  skyColor: string;
  groundColor: string;
  /** Image-based lighting (sky ambient + reflections) scale. */
  env: number;
  /** Horizon colour: clear colour, fog and the bottom of the sky dome. */
  clear: string;
  /** Top of the sky dome. */
  zenith: string;
  exposure: number;
  /** Interior lamps and lit windows, 0 (off) to 1 (night). */
  lamps: number;
}

export interface StylePreset {
  id: VisualStyle;
  label: string;
  description: string;
  keys: LightKey[];
  /** The sun arcs across the sky (false: a fixed afternoon sun, as in early life sims). */
  sunArc: boolean;
  /** Scales the sun's elevation; lower values give longer, more dramatic shadows. */
  sunHeight: number;
  toneMapping: 'aces' | 'neutral';
  contrast: number;
  /** Multiplies the time-of-day exposure. */
  exposure: number;
  /** Colour grading (Babylon colour curves, -100..100). */
  saturation: number;
  /** Warm highlights / cool shadows split toning: hue (degrees) and density (0..100). */
  highlightsHue: number;
  highlightsDensity: number;
  shadowsHue: number;
  shadowsDensity: number;
  /**
   * Moonlight grade strength at night (0..1, faded in with the lamps; see babylon/nightGrade.ts).
   * Grass reflects almost no blue, so a blue moon alone renders nights dark green; the grade turns
   * dark tones blue-grey while lamps and lit windows stay warm.
   */
  nightGrade: number;
  vignette: number;
  bloomThreshold: number;
  /** 0 disables bloom for this style. */
  bloomWeight: number;
  bloomKernel: number;
  /** Tilt-shift miniature blur: max radius in pixels at 1080p; 0 disables it for this style. */
  tiltShift: number;
  /** Edge sharpening amount (0 = off). */
  sharpen: number;
  /** Film grain intensity (0 = off). */
  grain: number;
  /** Distance fog / aerial haze density. */
  fog: number;
  /** Soft (filtered) or hard shadow edges. */
  softShadows: boolean;
  /** Render at 1/n resolution with nearest-neighbour upscaling (chunky retro pixels). */
  pixelScale: number;
  /** Nearest-neighbour texture filtering (low-res texture feel). */
  nearestTextures: boolean;
  /**
   * Selection marker colours from great mood to bad mood: warm golds while things go well,
   * periwinkle when low, coral when angry.
   */
  marker: string[];
  /** Night window glow colour. */
  windowGlow: string;
  /** Interior lamp colour. */
  lampColor: string;
}

// Night keys are shared within a style; the day keys shape golden and blue hour.
// Sunset rule (all styles): only the direct sun turns warm. The sky fill and the image-based
// ambient stay neutral to cool and fairly strong, and the horizon/fog colour stays a pale,
// desaturated haze, so shadows read blue, greens stay green and only sunlit faces turn golden.
// The sun's intensity also fades to zero around sunrise/sunset in `lightingAt`, so the switch
// between sun and moon direction never pops.
const CLASSIC_NIGHT = {
  sun: 0.6, sunColor: '#7088F2', sky: 0.5, skyColor: '#3A52C4', groundColor: '#1A2050', env: 0.05,
  clear: '#1E2C58', zenith: '#081232', exposure: 1.7, lamps: 1,
};
const BRIGHT_NIGHT = {
  sun: 0.6, sunColor: '#8EA4FF', sky: 0.52, skyColor: '#4A62C8', groundColor: '#283058', env: 0.08,
  clear: '#2B3B6E', zenith: '#121C44', exposure: 1.4, lamps: 1,
};
const RETRO_NIGHT = {
  sun: 0.38, sunColor: '#7480C8', sky: 0.32, skyColor: '#2E3A88', groundColor: '#12182E', env: 0.04,
  clear: '#18203A', zenith: '#0A0C18', exposure: 1.45, lamps: 1,
};

export const STYLES: Record<VisualStyle, StylePreset> = {
  // Stylised realism: warm saturated sun with long golden-hour shadows, bluish ambient fill,
  // visible bloom and haze, tilt-shift depth of field, blue moonlit nights with warm lamps.
  classic: {
    id: 'classic',
    label: 'Classic',
    description: 'Warm, painterly realism with golden-hour light, bloom and a miniature focus.',
    keys: [
      { hour: 0, ...CLASSIC_NIGHT },
      { hour: 4.8, ...CLASSIC_NIGHT },
      // Blue hour before dawn: the moon fades, the sky brightens to a deep blue.
      { hour: 5.6, sun: 0.15, sunColor: '#8A9AE6', sky: 0.44, skyColor: '#5C6CC4', groundColor: '#22284A', env: 0.12, clear: '#5A6494', zenith: '#1E2C66', exposure: 1.35, lamps: 0.85 },
      // Sunrise: a low peach sun, lavender ambient.
      { hour: 6.4, sun: 1.4, sunColor: '#FFB27A', sky: 0.22, skyColor: '#A6AAD8', groundColor: '#3E3C40', env: 0.36, clear: '#E2C0A8', zenith: '#4E6CB0', exposure: 1.16, lamps: 0.3 },
      { hour: 7.5, sun: 3.0, sunColor: '#FFDAB0', sky: 0.12, skyColor: '#B4C4E6', groundColor: '#5B5A48', env: 0.64, clear: '#DCDCD8', zenith: '#5C8ED6', exposure: 1.03, lamps: 0 },
      { hour: 9.5, sun: 3.5, sunColor: '#FFEAD0', sky: 0.09, skyColor: '#B0C8EA', groundColor: '#5E6B3C', env: 0.78, clear: '#C8DAEE', zenith: '#4A84D0', exposure: 1.0, lamps: 0 },
      { hour: 13, sun: 3.9, sunColor: '#FFF0D8', sky: 0.08, skyColor: '#A9C4E4', groundColor: '#5E6B3C', env: 0.82, clear: '#C9DDF0', zenith: '#3F7BCB', exposure: 0.95, lamps: 0 },
      { hour: 16.5, sun: 3.5, sunColor: '#FFE4BE', sky: 0.09, skyColor: '#B8C6E6', groundColor: '#5E6340', env: 0.76, clear: '#D2DAE6', zenith: '#5486CC', exposure: 1.0, lamps: 0 },
      // Golden hour: golden (not red) low sun with long shadows; cool, neutral ambient.
      { hour: 18, sun: 3.3, sunColor: '#FFBF7A', sky: 0.12, skyColor: '#A4B4DE', groundColor: '#545A46', env: 0.64, clear: '#E2D4C2', zenith: '#5A80C4', exposure: 1.03, lamps: 0.05 },
      // Sunset: the sun deepens to orange only as it touches the horizon.
      { hour: 19.2, sun: 2.1, sunColor: '#FFA968', sky: 0.22, skyColor: '#8E9ACE', groundColor: '#3E4046', env: 0.5, clear: '#DDB2A0', zenith: '#4A5EA6', exposure: 1.12, lamps: 0.4 },
      // Dusk / blue hour: lamps on, windows glow against a blue world.
      { hour: 20, sun: 0.3, sunColor: '#E8A08C', sky: 0.42, skyColor: '#5464C0', groundColor: '#22284A', env: 0.14, clear: '#6E70A0', zenith: '#26326E', exposure: 1.3, lamps: 0.85 },
      { hour: 21, ...CLASSIC_NIGHT },
      { hour: 24, ...CLASSIC_NIGHT },
    ],
    sunArc: true,
    sunHeight: 0.8,
    toneMapping: 'aces',
    contrast: 1.1,
    exposure: 1.05,
    saturation: 14,
    highlightsHue: 38,
    highlightsDensity: 18,
    shadowsHue: 222,
    shadowsDensity: 26,
    nightGrade: 0.85,
    vignette: 1.2,
    bloomThreshold: 0.72,
    bloomWeight: 0.3,
    bloomKernel: 64,
    tiltShift: 4.5,
    sharpen: 0,
    grain: 0,
    fog: 0.0032,
    softShadows: true,
    pixelScale: 1,
    nearestTextures: false,
    marker: ['#FFAE1F', '#FFC23D', '#FFDE94', '#7F95FF', '#F2604F'],
    windowGlow: '#FFC27A',
    lampColor: '#FFC27A',
  },
  // Clean and cartoony: soft even light, pastel sky, saturated colours, little haze, no blur.
  bright: {
    id: 'bright',
    label: 'Bright',
    description: 'Clean, colourful and soft, with gentle shadows and a pastel sky.',
    keys: [
      { hour: 0, ...BRIGHT_NIGHT },
      { hour: 4.8, ...BRIGHT_NIGHT },
      { hour: 5.6, sun: 0.2, sunColor: '#B4C4FF', sky: 0.38, skyColor: '#7A88C8', groundColor: '#343850', env: 0.24, clear: '#7A86B8', zenith: '#34489A', exposure: 1.25, lamps: 0.8 },
      { hour: 6.5, sun: 1.2, sunColor: '#FFC098', sky: 0.3, skyColor: '#C8C4E4', groundColor: '#4A4850', env: 0.5, clear: '#EED6C8', zenith: '#7A90D8', exposure: 1.12, lamps: 0.3 },
      { hour: 8, sun: 2.5, sunColor: '#FFE2C2', sky: 0.24, skyColor: '#D8E6FA', groundColor: '#A7C080', env: 0.95, clear: '#CFE6FA', zenith: '#6FA6EC', exposure: 1.05, lamps: 0 },
      { hour: 13, sun: 2.9, sunColor: '#FFF9F0', sky: 0.24, skyColor: '#DCEBFF', groundColor: '#A7C080', env: 1.05, clear: '#D4EBFF', zenith: '#5EA0F0', exposure: 1.0, lamps: 0 },
      { hour: 17.5, sun: 2.5, sunColor: '#FFE6CC', sky: 0.24, skyColor: '#E4E6F6', groundColor: '#A0B47C', env: 0.92, clear: '#E6E6F4', zenith: '#7AA0E8', exposure: 1.02, lamps: 0 },
      { hour: 19, sun: 2.1, sunColor: '#FFD29C', sky: 0.26, skyColor: '#C8CCEA', groundColor: '#6A6A60', env: 0.78, clear: '#F0DACA', zenith: '#7C96DA', exposure: 1.06, lamps: 0.2 },
      { hour: 20, sun: 0.4, sunColor: '#F4B098', sky: 0.36, skyColor: '#8C94D4', groundColor: '#3A3A50', env: 0.36, clear: '#9E9CC8', zenith: '#4C5AA8', exposure: 1.18, lamps: 0.8 },
      { hour: 21, ...BRIGHT_NIGHT },
      { hour: 24, ...BRIGHT_NIGHT },
    ],
    sunArc: true,
    sunHeight: 1.05,
    toneMapping: 'neutral',
    contrast: 1.02,
    exposure: 1.06,
    saturation: 18,
    highlightsHue: 30,
    highlightsDensity: 6,
    shadowsHue: 250,
    shadowsDensity: 14,
    nightGrade: 0.7,
    vignette: 0.35,
    bloomThreshold: 0.92,
    bloomWeight: 0.14,
    bloomKernel: 48,
    tiltShift: 0,
    sharpen: 0.25,
    grain: 0,
    fog: 0.0012,
    softShadows: true,
    pixelScale: 1,
    nearestTextures: false,
    marker: ['#FFA814', '#FFC233', '#FFE08A', '#7389FF', '#FF5444'],
    windowGlow: '#FFD9A0',
    lampColor: '#FFD8A8',
  },
  // Early-2000s life sim: muted colours, harder fixed sunlight, darker nights, chunky pixels.
  retro: {
    id: 'retro',
    label: 'Retro',
    description: 'Muted colours, hard light and chunky pixels, like the early-2000s classics.',
    keys: [
      { hour: 0, ...RETRO_NIGHT },
      { hour: 5, ...RETRO_NIGHT },
      { hour: 6.5, sun: 1.0, sunColor: '#E8B080', sky: 0.14, skyColor: '#8C90AC', groundColor: '#2C2A2C', env: 0.24, clear: '#B4AEA8', zenith: '#5A6A9A', exposure: 1.08, lamps: 0.5 },
      { hour: 8, sun: 3.5, sunColor: '#EDE2CA', sky: 0.07, skyColor: '#B0C0D8', groundColor: '#5A5A40', env: 0.5, clear: '#9FBAD8', zenith: '#7FA7D6', exposure: 0.95, lamps: 0 },
      { hour: 13, sun: 3.8, sunColor: '#F0E8D4', sky: 0.07, skyColor: '#B0C0D8', groundColor: '#5A5A40', env: 0.55, clear: '#A4C0DE', zenith: '#7FA7D6', exposure: 0.92, lamps: 0 },
      { hour: 18, sun: 3.2, sunColor: '#EAD6B0', sky: 0.08, skyColor: '#B8B8C8', groundColor: '#55523E', env: 0.5, clear: '#B0B8C8', zenith: '#7F9CC8', exposure: 0.95, lamps: 0.05 },
      { hour: 19.3, sun: 1.6, sunColor: '#DDA070', sky: 0.12, skyColor: '#7E84A4', groundColor: '#2C2C34', env: 0.3, clear: '#A09C9E', zenith: '#4A5A88', exposure: 1.02, lamps: 0.5 },
      { hour: 20.5, ...RETRO_NIGHT },
      { hour: 24, ...RETRO_NIGHT },
    ],
    sunArc: false,
    sunHeight: 1,
    toneMapping: 'aces',
    contrast: 1.18,
    exposure: 0.95,
    saturation: -22,
    highlightsHue: 45,
    highlightsDensity: 12,
    shadowsHue: 40,
    shadowsDensity: 10,
    nightGrade: 0.55,
    vignette: 0.6,
    bloomThreshold: 1,
    bloomWeight: 0,
    bloomKernel: 32,
    tiltShift: 0,
    sharpen: 0,
    grain: 6,
    fog: 0.0016,
    softShadows: false,
    pixelScale: 2,
    nearestTextures: true,
    marker: ['#EFA62E', '#F0BC4A', '#EED79A', '#8492E0', '#E0584A'],
    windowGlow: '#F0C070',
    lampColor: '#F2C890',
  },
};

export function stylePreset(style: string | undefined): StylePreset {
  return STYLES[style as VisualStyle] ?? STYLES.classic;
}
