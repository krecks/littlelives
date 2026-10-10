/**
 * Time-of-day lighting: interpolates sun, sky and exposure between the look's keyframes
 * (`render/look.ts`). Pure math; the renderer applies the result.
 *
 * Rough physical ratios behind the keys: on a clear day direct sun is ~4-5x the sky's diffuse
 * light on the ground; at golden hour they are about equal; at night the "camera" compensates
 * the faint moonlight with a higher exposure and a blue tint.
 */

import { Color3, Vector3 } from './core';
import type { Look } from '../look';

const SUNRISE = 6;
const SUNSET = 20;
/** Hours around sunrise/sunset over which the direct light fades out and back in (sun <-> moon). */
const HANDOVER = 0.4;

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
  /** Interior lamps and lit windows, 0..1. */
  lamps: number;
  /** 0 by day .. 1 at night (dusk and dawn in between): drives the moonlight colour grade. */
  night: number;
  /** Sun elevation factor 0 (horizon or night) .. 1 (noon), for sky effects. */
  sunUp: number;
}

/** Writes lighting for `minuteOfDay` into `out` (no allocations after the first call). */
export function lightingAt(minuteOfDay: number, look: Look, out: Lighting): Lighting {
  const keys = look.keys;
  const hour = (minuteOfDay / 60) % 24;
  let i = 0;
  while (i < keys.length - 2 && keys[i + 1].hour <= hour) i++;
  const a = keys[i];
  const b = keys[i + 1];
  const t = (hour - a.hour) / (b.hour - a.hour);

  out.sunIntensity = lerp(a.sun, b.sun, t);
  out.skyIntensity = lerp(a.sky, b.sky, t);
  out.exposure = lerp(a.exposure, b.exposure, t);
  out.envIntensity = lerp(a.env, b.env, t);
  out.lamps = lerp(a.lamps, b.lamps, t);
  const n = Math.min(1, Math.max(0, (out.lamps - 0.3) / 0.7));
  out.night = n * n * (3 - 2 * n);
  lerpHex(a.sunColor, b.sunColor, t, out.sunColor);
  lerpHex(a.skyColor, b.skyColor, t, out.skyColor);
  lerpHex(a.groundColor, b.groundColor, t, out.groundColor);
  lerpHex(a.clear, b.clear, t, out.clearColor);
  lerpHex(a.zenith, b.zenith, t, out.zenithColor);

  // Sun arcs east -> west during the day (low and long-shadowed); at night a fixed high "moon"
  // keeps soft shadows.
  if (hour >= SUNRISE && hour <= SUNSET) {
    const arc = ((hour - SUNRISE) / (SUNSET - SUNRISE)) * Math.PI;
    out.sunUp = Math.sin(arc);
    out.sunDirection.set(-Math.cos(arc), -(0.22 + out.sunUp * 0.9) * look.sunHeight, 0.45).normalize();
  } else {
    out.sunUp = 0;
    out.sunDirection.set(0.35, -1, 0.25).normalize();
  }
  // The light switches between the sun's arc and the fixed moon at sunrise/sunset: fade it to
  // nothing across the switch so shadows never jump (the sky fill carries the scene meanwhile).
  const edge = Math.min(Math.abs(hour - SUNRISE), Math.abs(hour - SUNSET));
  if (edge < HANDOVER) {
    const t = edge / HANDOVER;
    out.sunIntensity *= t * t * (3 - 2 * t);
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
    lamps: 0,
    night: 0,
    sunUp: 0,
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
