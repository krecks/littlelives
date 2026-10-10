/**
 * The look of the world: time-of-day lighting, sky, colour grading and the colours of lamps,
 * lit windows and the selection marker (see docs/design/look.md for what it aims for). Pure
 * data; the renderer applies it.
 */

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

export interface Look {
  keys: LightKey[];
  /** Scales the sun's elevation; lower values give longer, more dramatic shadows. */
  sunHeight: number;
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
  /** Distance fog / aerial haze density. */
  fog: number;
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

// Sunset rule: only the direct sun turns warm. The sky fill and the image-based ambient stay
// neutral to cool and fairly strong, and the horizon/fog colour stays a pale, desaturated haze,
// so shadows read blue, greens stay green and only sunlit faces turn golden. The sun's intensity
// also fades to zero around sunrise/sunset in `lightingAt`, so the switch between sun and moon
// direction never pops.
const NIGHT = {
  sun: 0.6, sunColor: '#7088F2', sky: 0.5, skyColor: '#3A52C4', groundColor: '#1A2050', env: 0.05,
  clear: '#1E2C58', zenith: '#081232', exposure: 1.7, lamps: 1,
};

/**
 * Stylised realism: warm saturated sun with long golden-hour shadows, bluish ambient fill, soft
 * haze, blue moonlit nights with warm lamps.
 */
export const LOOK: Look = {
  keys: [
    { hour: 0, ...NIGHT },
    { hour: 4.8, ...NIGHT },
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
    { hour: 21, ...NIGHT },
    { hour: 24, ...NIGHT },
  ],
  sunHeight: 0.8,
  contrast: 1.1,
  exposure: 1.05,
  saturation: 14,
  highlightsHue: 38,
  highlightsDensity: 18,
  shadowsHue: 222,
  shadowsDensity: 26,
  nightGrade: 0.85,
  vignette: 1.2,
  fog: 0.0032,
  marker: ['#FFAE1F', '#FFC23D', '#FFDE94', '#7F95FF', '#F2604F'],
  windowGlow: '#FFC27A',
  lampColor: '#FFC27A',
};
