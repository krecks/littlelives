/**
 * Time-of-day lighting: interpolates sun, sky and exposure between keyframes.
 * Pure data + math; the renderer applies the result.
 */

import { Color3, Vector3 } from '@babylonjs/core';

interface Key {
  hour: number;
  /** Direct sun (or moon) intensity. PBR units: a white surface facing the light reflects ~this much. */
  sun: number;
  sunColor: string;
  /** Hemispheric fill: tints the ambient towards the sky colour (golden hour, blue hour, night). */
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
}

// Rough physical ratios: on a clear day direct sun is ~4-5x the sky's diffuse light on the
// ground; at golden hour they are about equal; at night the moon is ~1/400000 of the sun, which
// the "camera" compensates with a much higher exposure (and a blue, desaturated tint).
const NIGHT: Omit<Key, 'hour'> = {
  sun: 0.32, sunColor: '#9FB6FF', sky: 0.16, skyColor: '#5468A8', groundColor: '#1A1D28', env: 0.06,
  clear: '#141B2E', zenith: '#070B18', exposure: 1.25,
};

const KEYS: Key[] = [
  { hour: 0, ...NIGHT },
  { hour: 5, ...NIGHT },
  { hour: 6, sun: 0.5, sunColor: '#FF9A66', sky: 0.18, skyColor: '#C49AB0', groundColor: '#3A3036', env: 0.2, clear: '#E0A88E', zenith: '#4A5E9C', exposure: 1.2 },
  { hour: 7, sun: 2.0, sunColor: '#FFC48E', sky: 0.1, skyColor: '#F3C7A6', groundColor: '#5B5048', env: 0.45, clear: '#E8D2BE', zenith: '#6E95D4', exposure: 1.05 },
  { hour: 9, sun: 3.3, sunColor: '#FFEDD6', sky: 0.05, skyColor: '#CFE0F5', groundColor: '#6B6A55', env: 0.7, clear: '#BFD6EE', zenith: '#4A84D0', exposure: 1.0 },
  { hour: 13, sun: 3.8, sunColor: '#FFF7EC', sky: 0.04, skyColor: '#D3E3F5', groundColor: '#6B6A55', env: 0.8, clear: '#C3DAF0', zenith: '#3F7BCB', exposure: 0.95 },
  { hour: 17, sun: 3.3, sunColor: '#FFE5C2', sky: 0.05, skyColor: '#E0DDE8', groundColor: '#665D50', env: 0.7, clear: '#D3D7E2', zenith: '#5A88CC', exposure: 1.0 },
  { hour: 19, sun: 2.0, sunColor: '#FFA466', sky: 0.12, skyColor: '#F0B49A', groundColor: '#4E4246', env: 0.4, clear: '#EFAE88', zenith: '#5F6EB0', exposure: 1.1 },
  { hour: 20, sun: 0.3, sunColor: '#FF7A4E', sky: 0.18, skyColor: '#8A7FB4', groundColor: '#2C2834', env: 0.18, clear: '#B7889A', zenith: '#33428A', exposure: 1.2 },
  { hour: 21, ...NIGHT },
  { hour: 24, ...NIGHT },
];

const SUNRISE = 6;
const SUNSET = 20;

export interface Lighting {
  sunDirection: Vector3;
  sunIntensity: number;
  sunColor: Color3;
  skyIntensity: number;
  skyColor: Color3;
  groundColor: Color3;
  clearColor: Color3;
  zenithColor: Color3;
  exposure: number;
  /** Scale for image-based lighting (scene.environmentIntensity). */
  envIntensity: number;
}

/** Writes lighting for `minuteOfDay` into `out` (no allocations after the first call). */
export function lightingAt(minuteOfDay: number, out: Lighting): Lighting {
  const hour = (minuteOfDay / 60) % 24;
  let i = 0;
  while (i < KEYS.length - 2 && KEYS[i + 1].hour <= hour) i++;
  const a = KEYS[i];
  const b = KEYS[i + 1];
  const t = (hour - a.hour) / (b.hour - a.hour);

  out.sunIntensity = lerp(a.sun, b.sun, t);
  out.skyIntensity = lerp(a.sky, b.sky, t);
  out.exposure = lerp(a.exposure, b.exposure, t);
  out.envIntensity = lerp(a.env, b.env, t);
  lerpHex(a.sunColor, b.sunColor, t, out.sunColor);
  lerpHex(a.skyColor, b.skyColor, t, out.skyColor);
  lerpHex(a.groundColor, b.groundColor, t, out.groundColor);
  lerpHex(a.clear, b.clear, t, out.clearColor);
  lerpHex(a.zenith, b.zenith, t, out.zenithColor);

  // Sun arcs east -> west during the day; at night a fixed high "moon" keeps soft shadows.
  if (hour >= SUNRISE && hour <= SUNSET) {
    const arc = ((hour - SUNRISE) / (SUNSET - SUNRISE)) * Math.PI;
    out.sunDirection.set(-Math.cos(arc), -(0.25 + Math.sin(arc) * 0.9), 0.45).normalize();
  } else {
    out.sunDirection.set(0.35, -1, 0.25).normalize();
  }
  return out;
}

export function createLighting(): Lighting {
  return {
    sunDirection: new Vector3(0, -1, 0),
    sunIntensity: 1,
    sunColor: new Color3(),
    skyIntensity: 1,
    skyColor: new Color3(),
    groundColor: new Color3(),
    clearColor: new Color3(),
    zenithColor: new Color3(),
    exposure: 1,
    envIntensity: 1,
  };
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

const hexCache = new Map<string, Color3>();
function hex(value: string): Color3 {
  let c = hexCache.get(value);
  if (!c) hexCache.set(value, (c = Color3.FromHexString(value)));
  return c;
}

function lerpHex(a: string, b: string, t: number, out: Color3): void {
  Color3.LerpToRef(hex(a), hex(b), t, out);
}
