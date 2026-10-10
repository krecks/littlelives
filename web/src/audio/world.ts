/**
 * Sounds of the world, synthesised like the interface sounds (no sound files):
 * - ambience by the game clock: a soft outdoor bed, crickets at night, and by day a few neighbourhood
 *   birds of different species, each with its own song, singing in bouts (most in the dawn chorus);
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
  private readonly birds = new Birds();
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
    this.birds.update(ac, out, now, hour, quiet);

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
    this.birds.dispose();
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

// Birds: a few neighbourhood birds, each of a species with its own song, singing in bouts by day.

/** One note of a song. */
interface Note {
  /** Seconds, and seconds of silence after it. */
  len: number;
  gap: number;
  /** Pitch through the note in multiples of the bird's own pitch, spread evenly over the note and joined in a smooth curve. */
  pitch: number[];
  level?: number;
}

interface Species {
  name: string;
  /** Range of an individual's own pitch (Hz). */
  pitch: [number, number];
  /** A fast warble on every note: rate (Hz) and depth (part of the pitch); the level dips with it by `flutter`. */
  vibrato: [number, number];
  flutter: number;
  /** Level of the 2nd harmonic (a third of it for the 3rd). */
  overtone: number;
  /** Seconds to fade each note in and out (less on short notes). */
  fade: number;
  /** Highest frequencies kept (Hz), before distance takes more off. */
  bright: number;
  level: number;
  /** Songs in a bout, seconds between them and seconds of rest after the bout, when birds are busiest. */
  bout: [number, number];
  pause: [number, number];
  rest: [number, number];
  /** Whether it takes turns with the other birds (waits for a quiet moment, sometimes answers one). */
  turns: boolean;
  /** One song; `r` varies it a little, so each bird has a few versions of its own. */
  song: (r: () => number) => Note[];
}

const SPECIES: Species[] = [
  {
    // "Tee-cher tee-cher tee-cher", like a great tit.
    name: 'tit',
    pitch: [3700, 4300],
    vibrato: [34, 0.004],
    flutter: 0.06,
    overtone: 0.05,
    fade: 0.018,
    bright: 7000,
    level: 0.8,
    bout: [3, 6],
    pause: [2, 4],
    rest: [25, 60],
    turns: true,
    song: (r) => {
      const notes: Note[] = [];
      const pairs = 3 + Math.floor(r() * 3);
      for (let i = 0; i < pairs; i++) {
        const level = i === pairs - 1 ? 0.85 : 1;
        notes.push({ len: 0.11, gap: 0.04, pitch: [1.04, 1.01, 0.98], level });
        notes.push({ len: 0.13, gap: 0.09, pitch: [0.8, 0.74, 0.7, 0.68], level: 0.8 * level });
      }
      return notes;
    },
  },
  {
    // A run of quick notes falling in steps, then a flourish, like a chaffinch.
    name: 'finch',
    pitch: [3300, 3800],
    vibrato: [26, 0.006],
    flutter: 0.1,
    overtone: 0.09,
    fade: 0.008,
    bright: 8000,
    level: 0.75,
    bout: [4, 8],
    pause: [5, 9],
    rest: [30, 80],
    turns: true,
    song: (r) => {
      const notes: Note[] = [];
      const steps = [
        { count: 5 + Math.floor(r() * 3), pitch: 1.3, len: 0.042, gap: 0.032 },
        { count: 4 + Math.floor(r() * 2), pitch: 1.1, len: 0.05, gap: 0.03 },
        { count: 3 + Math.floor(r() * 2), pitch: 0.94, len: 0.06, gap: 0.032 },
      ];
      for (const [s, step] of steps.entries()) {
        for (let i = 0; i < step.count; i++) {
          const p = step.pitch * (1 - 0.01 * i);
          notes.push({ len: step.len, gap: step.gap, pitch: [p * 1.12, p, p * 0.9], level: 0.65 + 0.12 * s });
        }
      }
      notes.push({ len: 0.09, gap: 0.03, pitch: [1, 0.86, 0.8], level: 0.9 });
      notes.push({ len: 0.26, gap: 0, pitch: [0.9, 1.2, 1.3, 1.1, 0.78], level: 1 });
      return notes;
    },
  },
  {
    // A soft cascade of liquid notes running down the scale, like a willow warbler.
    name: 'warbler',
    pitch: [2900, 3300],
    vibrato: [21, 0.02],
    flutter: 0.3,
    overtone: 0.12,
    fade: 0.014,
    bright: 6500,
    level: 0.75,
    bout: [3, 6],
    pause: [6, 12],
    rest: [30, 80],
    turns: true,
    song: (r) => {
      const count = 11 + Math.floor(r() * 4);
      return Array.from({ length: count }, (_, i) => {
        const x = i / (count - 1);
        const p = 1.5 - 0.6 * x;
        const last = i >= count - 2;
        const level = Math.min(1, 0.45 + 1.2 * x) * (last ? 0.9 : 1);
        return last ? { len: 0.12, gap: 0.04, pitch: [p, p * 1.08, p * 0.92], level } : { len: 0.075, gap: 0.035, pitch: [p * 0.97, p * 1.04, p * 0.98], level };
      });
    },
  },
  {
    // "Coo-COOO-coo", low and soft, like a collared dove; now and then.
    name: 'dove',
    pitch: [470, 560],
    vibrato: [7, 0.005],
    flutter: 0.15,
    overtone: 0.15,
    fade: 0.06,
    bright: 1600,
    level: 1.6,
    bout: [3, 6],
    pause: [1.4, 2.2],
    rest: [90, 200],
    turns: false,
    song: () => [
      { len: 0.2, gap: 0.08, pitch: [0.96, 1, 0.97], level: 0.8 },
      { len: 0.55, gap: 0.12, pitch: [0.98, 1.06, 1.06, 1.02, 0.94], level: 1 },
      { len: 0.3, gap: 0, pitch: [0.95, 0.97, 0.88], level: 0.75 },
    ],
  },
];

/** The neighbourhood's birds: their species, where they sit left to right, and the two further off that only join the dawn chorus. */
const FLOCK: { species: string; pan: number; dawn?: boolean }[] = [
  { species: 'tit', pan: -0.55 },
  { species: 'finch', pan: 0.5 },
  { species: 'warbler', pan: -0.15 },
  { species: 'dove', pan: 0.3 },
  { species: 'tit', pan: 0.8, dawn: true },
  { species: 'warbler', pan: -0.8, dawn: true },
];
/** Versions of its song each bird has. */
const VERSIONS = 3;
/** Overall level of the birds. */
const BIRD_LEVEL = 0.05;

/** One of the neighbourhood's birds. */
interface Bird {
  species: Species;
  seed: number;
  /** Only sings in the dawn chorus. */
  dawn: boolean;
  /** Its own pitch (Hz), pace (1 = as written), place left to right and nearness (1 = nearest). */
  pitch: number;
  pace: number;
  pan: number;
  near: number;
  /** Songs left in its bout, when it sings next and when its song ends (ms, 0 = not yet set). */
  left: number;
  next: number;
  until: number;
  /** Its level and place, made on its first song. */
  out: { gain: GainNode; panner: StereoPannerNode } | null;
  /** Versions of its song, made on first use. */
  songs: (AudioBuffer | undefined)[];
}

/**
 * The neighbourhood's birds: the same few every time, of different species. Each sings its song a few
 * times with pauses, then rests; when one sings, another sometimes answers. Busiest in the dawn
 * chorus, quieter around midday, some evening song, none at night.
 */
class Birds {
  private readonly flock: Bird[];

  constructor() {
    const r = random(0x5eed1e55);
    this.flock = FLOCK.map(({ species: name, pan, dawn = false }, i) => {
      const species = SPECIES.find((sp) => sp.name === name) ?? SPECIES[0];
      return {
        species,
        seed: i,
        dawn,
        pitch: between(r, species.pitch),
        pace: 0.92 + r() * 0.16,
        pan: pan + (r() - 0.5) * 0.15,
        near: dawn ? 0.35 + r() * 0.15 : 0.6 + r() * 0.4,
        left: 0,
        next: 0,
        until: 0,
        out: null,
        songs: [],
      };
    });
  }

  update(ac: AudioContext, out: AudioNode, now: number, hour: number, quiet: boolean): void {
    const day = daylight(hour);
    const chorus = smooth(4.5, 5.5, hour) * (1 - smooth(7, 8.5, hour));
    const midday = smooth(10.5, 12, hour) * (1 - smooth(14.5, 16.5, hour));
    // How busy the birds are: most in the dawn chorus, least around midday, a little less in the evening.
    const busy = day * Math.min(1, 0.5 - 0.25 * midday - 0.1 * smooth(14, 16, hour) + 0.5 * chorus);
    const t = ac.currentTime;
    // Birds mostly take turns; in the dawn chorus up to three sing at once.
    const crowd = 1 + Math.round(2 * chorus);
    let singing = 0;
    for (const b of this.flock) if (b.species.turns && b.until > now) singing++;
    for (const b of this.flock) {
      const sp = b.species;
      const active = b.dawn ? day * chorus : busy;
      if (quiet && b.out) fadeTo(b.out.gain, 0, t);
      if (now < b.next) continue;
      if (quiet || active < 0.05 || b.next === 0) {
        // Silent for now; when it may sing again, it starts after a while.
        b.left = 0;
        b.next = now + Math.random() * sp.rest[0] * 300;
        continue;
      }
      if (sp.turns && singing >= crowd) {
        b.next = now + 300 + Math.random() * 1200;
        continue;
      }
      if (b.left <= 0) b.left = Math.round(between(Math.random, sp.bout) * (1 + 0.5 * chorus));
      const seconds = this.sing(ac, out, b, t + 0.03 + Math.random() * 0.05, BIRD_LEVEL * sp.level * b.near * (0.5 + 0.5 * day));
      b.until = now + seconds * 1000;
      if (sp.turns) singing++;
      b.left--;
      if (b.left > 0) b.next = b.until + between(Math.random, sp.pause) * b.pace * (1.4 - 0.4 * active) * 1000;
      else b.next = b.until + (between(Math.random, sp.rest) * 1000) / active;
      // Sometimes another bird answers.
      const other = this.flock[Math.floor(Math.random() * this.flock.length)];
      if (sp.turns && other !== b && other.species.turns && other.left <= 0 && Math.random() < 0.15 + 0.25 * active) {
        other.next = Math.min(other.next, b.until + 500 + Math.random() * 1500);
      }
    }
  }

  dispose(): void {
    for (const b of this.flock) b.out?.panner.disconnect();
  }

  /** Plays one version of the bird's song; returns its length in seconds. */
  private sing(ac: AudioContext, out: AudioNode, b: Bird, at: number, level: number): number {
    if (!b.out) {
      const gain = ac.createGain();
      const panner = ac.createStereoPanner();
      panner.pan.value = b.pan;
      gain.connect(panner).connect(out);
      b.out = { gain, panner };
    }
    const v = Math.floor(Math.random() * VERSIONS);
    let song = b.songs[v];
    if (!song || song.sampleRate !== ac.sampleRate) song = b.songs[v] = songBuffer(ac, b, v);
    const source = ac.createBufferSource();
    source.buffer = song;
    source.connect(b.out.gain);
    b.out.gain.gain.setValueAtTime(level, at);
    source.onended = () => source.disconnect();
    source.start(at);
    return song.duration;
  }
}

/**
 * One version of a bird's song: each note a sine following its pitch curve with a fast warble and a
 * quiet overtone, faded in and out, then softened and given a faint echo as if from a garden away.
 */
function songBuffer(ac: BaseAudioContext, bird: Bird, version: number): AudioBuffer {
  const sp = bird.species;
  const r = random(Math.imul(bird.seed * VERSIONS + version + 1, 0x9e3779b1));
  const notes = sp.song(r);
  const rate = ac.sampleRate;
  const shift = 1 + (r() - 0.5) * 0.03;
  let seconds = 0.3;
  for (const n of notes) seconds += (n.len * 1.04 + n.gap) * bird.pace;
  const b = ac.createBuffer(1, Math.ceil(seconds * rate), rate);
  const d = b.getChannelData(0);
  const [wobble, depth] = sp.vibrato;
  let at = 0;
  for (const n of notes) {
    const len = n.len * bird.pace * (1 + (r() - 0.5) * 0.08);
    const count = Math.round(len * rate);
    const fade = Math.min(sp.fade, len / 3);
    const tune = bird.pitch * shift * (1 + (r() - 0.5) * 0.02);
    const speed = (2 * Math.PI * wobble * (0.9 + r() * 0.2)) / rate;
    const start = Math.round(at * rate);
    let phase = 0;
    let vib = r() * 2 * Math.PI;
    for (let j = 0; j < count && start + j < d.length; j++) {
      const time = j / rate;
      const w = Math.sin(vib);
      phase += (2 * Math.PI * tune * curve(n.pitch, j / count) * (1 + depth * w)) / rate;
      vib += speed;
      const edge = Math.min(1, time / fade, (len - time) / fade);
      const amp = (0.5 - 0.5 * Math.cos(Math.PI * edge)) * (n.level ?? 1) * (1 - sp.flutter * (0.5 + 0.5 * w));
      d[start + j] += amp * (Math.sin(phase) + sp.overtone * (Math.sin(2 * phase) + Math.sin(3 * phase) / 3));
    }
    at += len + n.gap * bird.pace;
  }
  distance(d, rate, sp.bright * (0.7 + 0.3 * bird.near), 1 - bird.near);
  return b;
}

/** A smooth curve through evenly spaced points, at `x` from 0 to 1. */
function curve(points: number[], x: number): number {
  if (points.length === 1) return points[0];
  const u = x * (points.length - 1);
  const i = Math.min(points.length - 2, Math.floor(u));
  const f = u - i;
  const p0 = points[Math.max(0, i - 1)];
  const p1 = points[i];
  const p2 = points[i + 1];
  const p3 = points[Math.min(points.length - 1, i + 2)];
  return p1 + 0.5 * f * (p2 - p0 + f * (2 * p0 - 5 * p1 + 4 * p2 - p3 + f * (3 * (p1 - p2) + p3 - p0)));
}

/** Softens a sound as if from across the gardens: highs rolled off, and faint echoes off nearby walls. */
function distance(d: Float32Array, rate: number, cutoff: number, far: number): void {
  const a = 1 - Math.exp((-2 * Math.PI * cutoff) / rate);
  let lp = 0;
  for (let i = 0; i < d.length; i++) d[i] = lp += (d[i] - lp) * a;
  const taps = [0.023, 0.037, 0.053, 0.071, 0.097, 0.127, 0.163, 0.211].map((delay, i) => [Math.round(delay * rate), (i % 2 ? -0.07 : 0.08) * Math.exp(-delay / 0.09) * (0.6 + far)]);
  // From the end back, so echoes don't echo again.
  for (let i = d.length - 1; i >= 0; i--) for (const [k, level] of taps) if (i >= k) d[i] += d[i - k] * level;
}

function between(r: () => number, [a, b]: [number, number]): number {
  return a + r() * (b - a);
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
