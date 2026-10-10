/**
 * Sounds of the world, synthesised like the interface sounds (no sound files):
 * - ambience by the game clock: a soft outdoor bed, birds by day (a dawn chorus), crickets at night;
 * - things in use on the lot being looked at: a sizzling pan, running water, a TV, music. One loop
 *   per kind of sound, louder the more residents make it, placed left or right like voices;
 * - a visitor's knock at the front door.
 *
 * Presentation only. Reads the snapshot about ten times a second; residents the renderer doesn't
 * draw (other lots, at work) make no sound.
 */

import type { FrameState } from '../core/bridge';
import type { Renderer } from '../render/types';
import { game } from '../ui/state.svelte';
import { audioContext, bus, updateVolumes } from './mixer';

const TICK_MS = 100;
/** Seconds for a loop to fade in or out. */
const FADE = 0.4;

type LoopKind = 'sizzle' | 'water' | 'tv' | 'music';

/** What each action sounds like (content animation tags; unknown tags are silent). */
const ACTION_SOUNDS: Record<string, LoopKind> = {
  cook: 'sizzle',
  shower: 'water',
  bath: 'water',
  wash: 'water',
  watch: 'tv',
  music: 'music',
  listen: 'music',
  dance: 'music',
};

interface LoopDef {
  make: (ac: AudioContext) => AudioBuffer;
  /** A filter on the way out (shapes the raw buffer into the sound). */
  filter?: { type: BiquadFilterType; frequency: number; q: number };
  level: number;
}

const LOOPS: Record<LoopKind, LoopDef> = {
  sizzle: { make: sizzleBuffer, filter: { type: 'highpass', frequency: 1800, q: 0.5 }, level: 0.22 },
  water: { make: waterBuffer, filter: { type: 'bandpass', frequency: 1800, q: 0.45 }, level: 0.3 },
  tv: { make: murmurBuffer, filter: { type: 'bandpass', frequency: 700, q: 1.1 }, level: 0.35 },
  music: { make: musicBuffer, filter: { type: 'lowpass', frequency: 2600, q: 0.7 }, level: 0.16 },
};

interface Loop {
  source: AudioBufferSourceNode;
  gain: GainNode;
  panner: StereoPannerNode;
}

export class WorldSound {
  private lastTick = 0;
  private readonly loops = new Map<LoopKind, Loop>();
  private bed: Loop | null = null;
  private crickets: Loop | null = null;
  private nextBird = 0;
  /** Residents knocking last tick (by id), and when each knocks again (ms). */
  private readonly knocking = new Map<number, number>();
  private readonly head = { x: 0, y: 0, z: 0 };
  private readonly screen = { x: 0, y: 0 };
  private disposed = false;

  constructor(private readonly renderer: Renderer) {}

  update(frame: FrameState): void {
    const now = frame.now;
    if (now - this.lastTick < TICK_MS || this.disposed) return;
    this.lastTick = now;
    updateVolumes();
    const ac = audioContext();
    const out = bus('world');
    if (!ac || !out || out.gain.value === 0) return;
    const quiet = document.hidden;
    const t = ac.currentTime;

    // Ambience by the time of day.
    const { curr, layout } = frame;
    const minute = curr[layout.header.minute];
    const hour = (minute / 60) % 24;
    const day = daylight(hour);
    const night = 1 - smooth(4.5, 6, hour) * (1 - smooth(19.5, 21, hour));
    this.bed ??= this.loop(ac, out, brownBuffer, { type: 'lowpass', frequency: 650, q: 0.5 });
    this.crickets ??= this.loop(ac, out, cricketBuffer);
    fadeTo(this.bed.gain, quiet ? 0 : 0.05 + 0.03 * day, t);
    fadeTo(this.crickets.gain, quiet ? 0 : 0.1 * night, t);
    if (!quiet && day > 0.05 && now >= this.nextBird) {
      const chorus = 1 + 2 * (smooth(4.5, 5.5, hour) * (1 - smooth(7, 8.5, hour)));
      chirp(ac, out, (Math.random() * 2 - 1) * 0.8, 0.05 * day);
      this.nextBird = now + (700 + Math.random() * 3500) / (day * chorus);
    }

    // Things in use on the lot in view, and knocks at the door.
    const k = layout.sim;
    const count = curr[layout.header.simCount];
    const paused = game.speed === 0;
    const users = new Map<LoopKind, { n: number; pan: number }>();
    const seen = new Set<number>();
    for (let i = 0; i < count; i++) {
      const o = layout.headerLen + i * layout.simStride;
      const action = curr[o + k.action];
      const tag = action >= 0 ? layout.actions[action] : undefined;
      if (!tag || !this.renderer.simHead(i, this.head)) continue;
      const pan = this.panAt();
      if (tag === 'knock') {
        const id = curr[o + k.id];
        seen.add(id);
        const next = this.knocking.get(id) ?? 0;
        if (!quiet && !paused && now >= next) knock(ac, out, pan);
        if (now >= next) this.knocking.set(id, now + 2600 + Math.random() * 1200);
        continue;
      }
      const kind = ACTION_SOUNDS[tag];
      if (!kind) continue;
      const u = users.get(kind) ?? { n: 0, pan: 0 };
      u.pan = (u.pan * u.n + pan) / (u.n + 1);
      u.n++;
      users.set(kind, u);
    }
    for (const id of this.knocking.keys()) if (!seen.has(id)) this.knocking.delete(id);
    for (const kind of Object.keys(LOOPS) as LoopKind[]) {
      const u = users.get(kind);
      const target = u && !quiet && !paused ? LOOPS[kind].level * Math.min(1.6, Math.sqrt(u.n)) : 0;
      let loop = this.loops.get(kind);
      if (!loop && target === 0) continue;
      if (!loop) {
        const def = LOOPS[kind];
        loop = this.loop(ac, out, def.make, def.filter);
        this.loops.set(kind, loop);
      }
      fadeTo(loop.gain, target, t);
      if (u) loop.panner.pan.setTargetAtTime(u.pan, t, 0.1);
    }
  }

  dispose(): void {
    this.disposed = true;
    for (const loop of [...this.loops.values(), this.bed, this.crickets]) {
      if (!loop) continue;
      try {
        loop.source.stop();
      } catch {
        // Never started.
      }
      loop.panner.disconnect();
    }
    this.loops.clear();
  }

  /** Stereo position from where the resident is on screen; off screen counts as far to the side. */
  private panAt(): number {
    if (!this.renderer.project(this.head.x, this.head.y, this.head.z, this.screen)) return 0;
    const width = window.innerWidth || 1;
    return Math.max(-1, Math.min(1, (this.screen.x / width) * 2 - 1)) * 0.7;
  }

  /** A looping buffer, silent until faded in. */
  private loop(ac: AudioContext, out: AudioNode, make: (ac: AudioContext) => AudioBuffer, filter?: LoopDef['filter']): Loop {
    const source = ac.createBufferSource();
    source.buffer = cached(ac, make);
    source.loop = true;
    const gain = ac.createGain();
    gain.gain.value = 0;
    const panner = ac.createStereoPanner();
    let node: AudioNode = source;
    if (filter) {
      const f = ac.createBiquadFilter();
      f.type = filter.type;
      f.frequency.value = filter.frequency;
      f.Q.value = filter.q;
      node = node.connect(f);
    }
    node.connect(gain).connect(panner).connect(out);
    source.start();
    return { source, gain, panner };
  }
}

function fadeTo(param: GainNode, value: number, t: number): void {
  param.gain.setTargetAtTime(value, t, FADE / 3);
}

/** 0 before `a`, 1 after `b`, a smooth step between. */
function smooth(a: number, b: number, x: number): number {
  const u = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return u * u * (3 - 2 * u);
}

/** How much of a bird day it is: up at dawn, gone after dusk. */
function daylight(hour: number): number {
  return smooth(4.5, 6, hour) * (1 - smooth(19, 20.5, hour));
}

/** A bird: a few quick whistles gliding up or down. */
function chirp(ac: AudioContext, out: AudioNode, pan: number, level: number): void {
  const panner = ac.createStereoPanner();
  panner.pan.value = pan;
  panner.connect(out);
  const base = 2600 + Math.random() * 2400;
  const notes = 2 + Math.floor(Math.random() * 4);
  const up = Math.random() < 0.5;
  let at = ac.currentTime + 0.02;
  for (let n = 0; n < notes; n++) {
    const length = 0.05 + Math.random() * 0.07;
    const osc = ac.createOscillator();
    const env = ac.createGain();
    const f0 = base * (1 + (Math.random() - 0.5) * 0.15);
    osc.frequency.setValueAtTime(f0, at);
    osc.frequency.exponentialRampToValueAtTime(f0 * (up ? 1.35 : 0.72), at + length);
    env.gain.setValueAtTime(0.0001, at);
    env.gain.exponentialRampToValueAtTime(level, at + 0.01);
    env.gain.exponentialRampToValueAtTime(0.0001, at + length);
    osc.connect(env).connect(panner);
    osc.start(at);
    osc.stop(at + length + 0.02);
    at += length + 0.03 + Math.random() * 0.05;
  }
  setTimeout(() => panner.disconnect(), (at - ac.currentTime + 0.2) * 1000);
}

/** Three knocks on a wooden door. */
function knock(ac: AudioContext, out: AudioNode, pan: number): void {
  const panner = ac.createStereoPanner();
  panner.pan.value = pan;
  panner.connect(out);
  const t = ac.currentTime + 0.02;
  for (let n = 0; n < 3; n++) {
    const at = t + n * 0.17 + (n === 2 ? 0.02 : 0);
    const osc = ac.createOscillator();
    const env = ac.createGain();
    osc.frequency.setValueAtTime(220, at);
    osc.frequency.exponentialRampToValueAtTime(95, at + 0.08);
    env.gain.setValueAtTime(0.0001, at);
    env.gain.exponentialRampToValueAtTime(0.5, at + 0.004);
    env.gain.exponentialRampToValueAtTime(0.0001, at + 0.11);
    osc.connect(env).connect(panner);
    osc.start(at);
    osc.stop(at + 0.13);
    const click = ac.createBufferSource();
    click.buffer = cached(ac, whiteBuffer);
    const band = ac.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 1400;
    band.Q.value = 1.2;
    const clickEnv = ac.createGain();
    clickEnv.gain.setValueAtTime(0.25, at);
    clickEnv.gain.exponentialRampToValueAtTime(0.0001, at + 0.03);
    click.connect(band).connect(clickEnv).connect(panner);
    click.start(at, Math.random());
    click.stop(at + 0.04);
  }
  setTimeout(() => panner.disconnect(), 1000);
}

// Buffers, made once per audio context.

const buffers = new Map<(ac: AudioContext) => AudioBuffer, AudioBuffer>();

function cached(ac: AudioContext, make: (ac: AudioContext) => AudioBuffer): AudioBuffer {
  let b = buffers.get(make);
  if (!b || b.sampleRate !== ac.sampleRate) {
    b = make(ac);
    buffers.set(make, b);
  }
  return b;
}

/** A small seeded generator, so the sounds are the same every time. */
function random(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

function buffer(ac: AudioContext, seconds: number, fill: (data: Float32Array, rate: number) => void): AudioBuffer {
  const b = ac.createBuffer(1, Math.round(ac.sampleRate * seconds), ac.sampleRate);
  const data = b.getChannelData(0);
  fill(data, ac.sampleRate);
  let peak = 0;
  for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i]));
  if (peak > 0) for (let i = 0; i < data.length; i++) data[i] /= peak;
  return b;
}

function whiteBuffer(ac: AudioContext): AudioBuffer {
  const r = random(1);
  return buffer(ac, 1, (d) => {
    for (let i = 0; i < d.length; i++) d[i] = r() * 2 - 1;
  });
}

/** Soft, low noise: wind and a distant street. */
function brownBuffer(ac: AudioContext): AudioBuffer {
  const r = random(2);
  return buffer(ac, 4, (d) => {
    let b = 0;
    for (let i = 0; i < d.length; i++) {
      b = (b + 0.02 * (r() * 2 - 1)) / 1.02;
      d[i] = b;
    }
    // Ease the loop's seam.
    const n = Math.min(2000, d.length >> 2);
    for (let i = 0; i < n; i++) d[d.length - n + i] = d[d.length - n + i] * (1 - i / n) + d[i] * (i / n);
  });
}

/** Two crickets, each chirping in short trills. */
function cricketBuffer(ac: AudioContext): AudioBuffer {
  const r = random(3);
  return buffer(ac, 3, (d, rate) => {
    for (const [freq, level, offset] of [
      [4600, 1, 0],
      [4250, 0.6, 0.21],
    ]) {
      for (let start = offset; start < 2.8; start += 0.42 + r() * 0.12) {
        for (let p = 0; p < 3; p++) {
          const s = Math.round((start + p * 0.032) * rate);
          const len = Math.round(0.014 * rate);
          for (let j = 0; j < len && s + j < d.length; j++) {
            const env = Math.sin((Math.PI * j) / len);
            d[s + j] += level * env * Math.sin((2 * Math.PI * freq * j) / rate);
          }
        }
      }
    }
  });
}

/** A hot pan: hiss with crackles. */
function sizzleBuffer(ac: AudioContext): AudioBuffer {
  const r = random(4);
  return buffer(ac, 2, (d, rate) => {
    let pop = 0;
    let popLevel = 0;
    for (let i = 0; i < d.length; i++) {
      if (pop <= 0 && r() < 60 / rate) {
        pop = Math.round((0.002 + r() * 0.006) * rate);
        popLevel = 0.3 + r() * 0.7;
      }
      const crackle = pop > 0 ? (r() * 2 - 1) * popLevel * (pop-- / (0.008 * rate)) : 0;
      d[i] = (r() * 2 - 1) * 0.18 + crackle;
    }
  });
}

/** Running water: rushing noise with a little flutter. */
function waterBuffer(ac: AudioContext): AudioBuffer {
  const r = random(5);
  return buffer(ac, 2, (d, rate) => {
    let lp = 0;
    for (let i = 0; i < d.length; i++) {
      const w = r() * 2 - 1;
      lp += (w - lp) * 0.35;
      const flutter = 0.85 + 0.15 * Math.sin((2 * Math.PI * 7 * i) / rate) * Math.sin((2 * Math.PI * 0.5 * i) / rate);
      d[i] = (lp * 0.8 + w * 0.2) * flutter;
    }
  });
}

/** Voices through a wall: noise shaped into syllables, phrases and pauses (the TV). */
function murmurBuffer(ac: AudioContext): AudioBuffer {
  const r = random(6);
  return buffer(ac, 5, (d, rate) => {
    let i = 0;
    while (i < d.length) {
      // A phrase of a few syllables, then a pause.
      const syllables = 3 + Math.floor(r() * 7);
      for (let s = 0; s < syllables && i < d.length; s++) {
        const len = Math.round((0.09 + r() * 0.14) * rate);
        const level = 0.5 + r() * 0.5;
        for (let j = 0; j < len && i < d.length; j++, i++) d[i] = (r() * 2 - 1) * level * Math.sin((Math.PI * j) / len);
      }
      i += Math.round((0.15 + r() * 0.5) * rate);
    }
  });
}

/** A little tune on a loop (a radio, a record). */
function musicBuffer(ac: AudioContext): AudioBuffer {
  const r = random(7);
  const scale = [0, 2, 4, 7, 9, 12, 14, 16];
  const root = 261.63;
  return buffer(ac, 4, (d, rate) => {
    const pluck = (at: number, freq: number, level: number, decay: number) => {
      const s = Math.round(at * rate);
      const len = Math.min(d.length - s, Math.round(decay * 4 * rate));
      for (let j = 0; j < len; j++) {
        const t = j / rate;
        d[s + j] += level * Math.exp(-t / decay) * (Math.sin(2 * Math.PI * freq * t) + 0.3 * Math.sin(4 * Math.PI * freq * t));
      }
    };
    for (let n = 0; n < 16; n++) {
      const note = scale[Math.floor(r() * scale.length)];
      if (r() < 0.85) pluck(n * 0.25, root * 2 ** (note / 12), 0.5, 0.18);
    }
    for (let n = 0; n < 4; n++) pluck(n, (root / 2) * 2 ** ([0, 9, 5, 7][n] / 12), 0.6, 0.5);
  });
}
