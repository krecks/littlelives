/**
 * Little interface sounds, synthesised with Web Audio (no sound files): picking things up,
 * putting them down, money changing hands, walls going up. Quiet by design, and off with the
 * "Sound effects" setting. The audio context starts on the first sound after a user gesture.
 */

import { settings } from '../settings/settings.svelte';

export type Sound = 'pick' | 'place' | 'sell' | 'rotate' | 'error' | 'build' | 'remove' | 'paint' | 'upgrade' | 'tab' | 'open' | 'close';

const MASTER = 0.5;
/** The same sound again within this many ms is skipped (a burst of hover moves, a held key). */
const DEBOUNCE_MS = 45;

let ctx: AudioContext | null = null;
let out: GainNode | null = null;
let noise: AudioBuffer | null = null;
const last = new Map<Sound, number>();

function audio(): AudioContext | null {
  if (!ctx) {
    try {
      ctx = new AudioContext();
      out = ctx.createGain();
      out.gain.value = MASTER;
      out.connect(ctx.destination);
    } catch {
      return null;
    }
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

export function play(sound: Sound): void {
  if (!settings.sound) return;
  const now = performance.now();
  if (now - (last.get(sound) ?? -Infinity) < DEBOUNCE_MS) return;
  last.set(sound, now);
  const ac = audio();
  if (!ac || !out) return;
  const t = ac.currentTime + 0.005;
  switch (sound) {
    case 'pick':
      tone(ac, 'triangle', 660, 990, t, 0.09, 0.16);
      tone(ac, 'sine', 1320, 1320, t + 0.03, 0.06, 0.05);
      break;
    case 'place':
      // A soft thump, then a bright "ting-ting".
      tone(ac, 'sine', 170, 55, t, 0.16, 0.45);
      hiss(ac, 900, t, 0.06, 0.12);
      tone(ac, 'sine', 1568, 1568, t + 0.06, 0.12, 0.07);
      tone(ac, 'sine', 2093, 2093, t + 0.11, 0.18, 0.06);
      break;
    case 'sell':
      tone(ac, 'triangle', 880, 330, t, 0.16, 0.14);
      tone(ac, 'sine', 2637, 2637, t + 0.1, 0.16, 0.06);
      tone(ac, 'sine', 3136, 3136, t + 0.15, 0.2, 0.05);
      break;
    case 'rotate':
      tone(ac, 'square', 1400, 1100, t, 0.025, 0.035);
      hiss(ac, 3000, t, 0.03, 0.05);
      break;
    case 'error':
      tone(ac, 'square', 220, 210, t, 0.08, 0.05);
      tone(ac, 'square', 175, 165, t + 0.09, 0.12, 0.05);
      break;
    case 'build':
      // Wood knock.
      tone(ac, 'sine', 240, 110, t, 0.09, 0.4);
      hiss(ac, 500, t, 0.08, 0.2);
      break;
    case 'remove':
      hiss(ac, 280, t, 0.28, 0.3);
      tone(ac, 'sine', 130, 50, t, 0.18, 0.3);
      break;
    case 'paint':
      // A brush stroke: a soft swish, rising.
      hiss(ac, 1800, t, 0.16, 0.12);
      tone(ac, 'sine', 520, 780, t + 0.04, 0.12, 0.05);
      break;
    case 'upgrade':
      [1047, 1319, 1568, 2093].forEach((f, i) => tone(ac, 'triangle', f, f, t + i * 0.065, 0.14, 0.09));
      break;
    case 'tab':
      tone(ac, 'sine', 1800, 1500, t, 0.03, 0.04);
      break;
    case 'open':
      tone(ac, 'triangle', 523, 523, t, 0.1, 0.08);
      tone(ac, 'triangle', 784, 784, t + 0.07, 0.14, 0.08);
      break;
    case 'close':
      tone(ac, 'triangle', 784, 784, t, 0.1, 0.07);
      tone(ac, 'triangle', 523, 523, t + 0.07, 0.14, 0.07);
      break;
  }
}

/** A pitched blip gliding from `f0` to `f1` Hz, with a fast attack and an exponential tail. */
function tone(ac: AudioContext, type: OscillatorType, f0: number, f1: number, at: number, length: number, gain: number): void {
  const osc = ac.createOscillator();
  const env = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(f0, at);
  if (f1 !== f0) osc.frequency.exponentialRampToValueAtTime(f1, at + length);
  env.gain.setValueAtTime(0.0001, at);
  env.gain.exponentialRampToValueAtTime(gain, at + 0.006);
  env.gain.exponentialRampToValueAtTime(0.0001, at + length);
  osc.connect(env).connect(out!);
  osc.start(at);
  osc.stop(at + length + 0.02);
}

/** Filtered noise (dust, scrapes, the click of a knob). */
function hiss(ac: AudioContext, cutoff: number, at: number, length: number, gain: number): void {
  if (!noise) {
    noise = ac.createBuffer(1, Math.round(ac.sampleRate * 0.5), ac.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }
  const src = ac.createBufferSource();
  src.buffer = noise;
  const filter = ac.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = cutoff;
  const env = ac.createGain();
  env.gain.setValueAtTime(gain, at);
  env.gain.exponentialRampToValueAtTime(0.0001, at + length);
  src.connect(filter).connect(env).connect(out!);
  src.start(at);
  src.stop(at + length + 0.02);
}
