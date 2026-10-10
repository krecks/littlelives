/**
 * Faces as morph weights (ARKit face units and Meta visemes from MakeHuman, see
 * tools/characters/build_mpfb.py).
 *
 * An expression is a mood (`MOODS`: whole-face recipes, one per emotion) plus a small `Face` of
 * adjustments (a resting smile, lids, gaze). Both mix into a target the face settles towards
 * channel by channel, so moods blend into each other. Blinks, the lids following the eyes and
 * speech go on top unsmoothed. Each frame the strongest `MORPH_PAIRS` channels go into the Sim's
 * row of the pose texture.
 */

import { VISEMES } from '../../../voice/visemes';
import type { MorphSet } from './data';
import { MORPH_PAIRS } from './material';

/**
 * Facial adjustments (all roughly 0..1): smile / frown (lip corners up / down), smirk (one-sided
 * smile, + left, - right), wide (corners apart, negative = pucker), jaw (mouth open), browUp,
 * browIn (inner ends up: worry, sadness), browDown (frown, anger), lidU (upper lids: + droop,
 * - wide open), lidL (lower lids raised: squint, the eyes of a real smile), gazeDown, sneer (nose
 * wrinkled: disgust), press (lips pressed together: tension, holding back). `mood` names a whole
 * face from `MOODS` the adjustments go on top of.
 */
export interface Face {
  smile: number;
  frown: number;
  smirk: number;
  wide: number;
  jaw: number;
  browUp: number;
  browIn: number;
  browDown: number;
  lidU: number;
  lidL: number;
  gazeDown: number;
  sneer: number;
  press: number;
  mood?: string;
}

export const NEUTRAL: Face = {
  smile: 0,
  frown: 0,
  smirk: 0,
  wide: 0,
  jaw: 0,
  browUp: 0,
  browIn: 0,
  browDown: 0,
  lidU: 0,
  lidL: 0,
  gazeDown: 0,
  sneer: 0,
  press: 0,
  mood: '',
};

/** The numeric keys of a `Face` (the ones that blend). */
export const FACE_KEYS = (Object.keys(NEUTRAL) as (keyof Face)[]).filter((k) => k !== 'mood') as Exclude<keyof Face, 'mood'>[];

/**
 * Whole-face moods as ARKit face-unit weights. Names without a side (`mouthSmile`) set both. Most
 * are adapted from the emoji expressions of TalkingHead by Mika Suominen (MIT,
 * https://github.com/met4citizen/TalkingHead), made for the same MakeHuman face units:
 * 😊 happy, 😄 playful, 😃 energized, 😀 inspired, 🥰 hug, 😳 embarrassed, 😔 sad, 😬 tense,
 * 😒 uncomfortable, 😠 angry, 😱 surprised, 😂 laugh, 😚 kiss, and its "love" and "disgust" moods
 * (flirty, disgusted). Its `mouthOpen` became `jawOpen`, its `eyesClosed` lid closing; head and eye
 * turns are left to the body and gaze layers.
 */
export const MOODS: Record<string, Record<string, number>> = {
  happy: { browInnerUp: 0.4, eyeSquint: 0.8, cheekSquint: 0.5, mouthSmile: 0.9, mouthDimple: 0.2, noseSneer: 0.25 },
  playful: {
    browInnerUp: 0.3,
    eyeSquint: 0.9,
    jawOpen: 0.2,
    mouthDimple: 0.2,
    mouthPress: 0.3,
    mouthRollLower: 0.3,
    mouthShrugUpper: 0.3,
    mouthSmile: 0.7,
    mouthUpperUp: 0.3,
    noseSneer: 0.3,
  },
  energized: {
    browInnerUp: 0.6,
    eyeWide: 0.6,
    jawOpen: 0.2,
    mouthDimple: 0.2,
    mouthPress: 0.3,
    mouthRollLower: 0.3,
    mouthShrugUpper: 0.3,
    mouthSmile: 0.7,
    mouthUpperUp: 0.3,
    noseSneer: 0.3,
  },
  inspired: {
    browInnerUp: 0.6,
    browOuterUp: 0.3,
    jawOpen: 0.15,
    mouthDimple: 0.2,
    mouthPress: 0.3,
    mouthShrugUpper: 0.3,
    mouthSmile: 0.6,
    mouthUpperUp: 0.2,
    noseSneer: 0.2,
  },
  flirty: {
    browInnerUp: 0.4,
    browOuterUp: 0.2,
    eyeBlink: 0.35,
    eyeSquint: 0.3,
    mouthSmile: 0.45,
    mouthSmileLeft: 0.2,
    mouthDimple: 0.1,
    mouthPressLeft: 0.2,
    mouthShrugUpper: 0.2,
    mouthUpperUp: 0.1,
  },
  confident: { mouthSmile: 0.4, mouthSmileLeft: 0.15, eyeSquint: 0.3, browDown: 0.1, mouthPress: 0.15 },
  relaxed: { mouthSmile: 0.35, eyeBlink: 0.25, browInnerUp: 0.1 },
  focused: { browDown: 0.4, eyeSquint: 0.4, mouthPress: 0.3, mouthRollLower: 0.2 },
  embarrassed: {
    browInnerUp: 0.9,
    eyeWide: 0.3,
    mouthClose: 0.2,
    mouthFunnel: 0.3,
    mouthPucker: 0.3,
    mouthRollLower: 0.4,
    mouthRollUpper: 0.4,
    mouthSmile: 0.15,
  },
  sad: {
    browInnerUp: 0.9,
    eyeSquint: 0.6,
    eyeBlink: 0.25,
    mouthClose: 0.15,
    mouthFrown: 0.8,
    mouthPress: 0.3,
    mouthPucker: 0.5,
    mouthRollLower: 0.5,
    mouthUpperUp: 0.4,
  },
  tense: {
    browDown: 0.6,
    browInnerUp: 0.7,
    mouthDimple: 0.3,
    mouthLowerDown: 0.5,
    mouthPress: 0.3,
    mouthStretch: 0.6,
    mouthUpperUp: 0.5,
  },
  uncomfortable: {
    browDownRight: 0.1,
    browInnerUp: 0.5,
    browOuterUpRight: 0.15,
    eyeSquintLeft: 0.7,
    eyeSquintRight: 0.55,
    mouthFrown: 0.6,
    mouthLeft: 0.15,
    mouthPucker: 0.35,
    mouthRollLower: 0.15,
    mouthStretchLeft: 0.35,
  },
  bored: { browInnerUp: 0.3, eyeBlink: 0.35, mouthPucker: 0.3, mouthRollLower: 0.4, mouthRollUpper: 0.3, mouthLeft: 0.2 },
  angry: { browDown: 1, eyeSquint: 0.3, jawForward: 0.3, mouthFrown: 0.8, mouthRollLower: 0.2, mouthShrugLower: 0.3 },
  dazed: { browInnerUp: 0.4, eyeWide: 0.3, eyeBlink: 0.2, jawOpen: 0.1 },
  surprised: { browInnerUp: 0.8, browOuterUp: 0.6, eyeWide: 0.6, jawOpen: 0.4, mouthFunnel: 0.4 },
  tired: { eyeBlink: 0.55, browInnerUp: 0.3, mouthShrugLower: 0.1, jawOpen: 0.04 },
  disgusted: {
    browDownLeft: 0.7,
    browDownRight: 0.1,
    browInnerUp: 0.3,
    eyeSquint: 0.8,
    mouthLeft: 0.3,
    mouthPressLeft: 0.3,
    mouthRollLower: 0.3,
    mouthShrugLower: 0.3,
    mouthShrugUpper: 0.6,
    mouthUpperUpLeft: 0.3,
    noseSneerLeft: 0.9,
    noseSneerRight: 0.6,
  },
  laugh: {
    browInnerUp: 0.3,
    eyeSquint: 1,
    eyeBlink: 0.35,
    jawOpen: 0.3,
    mouthDimple: 0.2,
    mouthPress: 0.4,
    mouthShrugUpper: 0.4,
    mouthSmile: 0.8,
    mouthUpperUp: 0.3,
    noseSneer: 0.4,
  },
  kiss: { browInnerUp: 0.6, eyeBlink: 1, eyeSquint: 1, mouthPucker: 0.6, noseSneer: 0.4, U: 0.8 },
  hug: { browInnerUp: 0.6, eyeSquint: 0.8, mouthSmile: 0.7, noseSneer: 0.4 },
  asleep: { eyeBlink: 1, jawOpen: 0.03 },
};

/** Idle micro-movements: face unit, period (s) and largest weight. */
const MICRO: readonly (readonly [Unit, number, number])[] = [
  ['mouthRollLower', 3.1, 0.25],
  ['mouthStretchLeft', 4.3, 0.2],
  ['mouthStretchRight', 3.7, 0.2],
  ['mouthPucker', 5.3, 0.2],
  ['browInnerUp', 4.1, 0.25],
  ['browOuterUpLeft', 6.7, 0.2],
  ['browOuterUpRight', 5.9, 0.2],
  ['eyeSquintLeft', 4.7, 0.15],
  ['eyeSquintRight', 4.7, 0.15],
];

function hash01(n: number): number {
  let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Share of a recipe's `eyeSquint` applied (see `FaceMixer.resolve`). */
const SQUINT = 0.3;

/** Visemes that close or nearly close the lips (kept at full strength in quiet speech). */
const CLOSED_VISEMES = new Set([1, 2]);

const UNITS = [
  'mouthSmileLeft',
  'mouthSmileRight',
  'cheekSquintLeft',
  'cheekSquintRight',
  'mouthDimpleLeft',
  'mouthDimpleRight',
  'mouthFrownLeft',
  'mouthFrownRight',
  'mouthShrugLower',
  'mouthStretchLeft',
  'mouthStretchRight',
  'mouthPucker',
  'mouthFunnel',
  'jawOpen',
  'browInnerUp',
  'browOuterUpLeft',
  'browOuterUpRight',
  'browDownLeft',
  'browDownRight',
  'eyeBlinkLeft',
  'eyeBlinkRight',
  'eyeWideLeft',
  'eyeWideRight',
  'eyeSquintLeft',
  'eyeSquintRight',
  'eyeLookDownLeft',
  'eyeLookDownRight',
  'eyeLookUpLeft',
  'eyeLookUpRight',
  'noseSneerLeft',
  'noseSneerRight',
  'mouthPressLeft',
  'mouthPressRight',
  'mouthClose',
  'mouthRollLower',
] as const;
type Unit = (typeof UNITS)[number];

/** Eye pitch (rad, + down) at which the lids fully follow the gaze (`eyeLookDown` / `eyeLookUp` at 1). */
const LOOK_PITCH = 0.5;

/** A mood resolved to channel indices: (channel, weight, side) with side -1 left, 1 right, 0 both. */
interface MoodEntry {
  c: Int32Array;
  v: Float32Array;
  side: Int8Array;
}

export class FaceMixer {
  /** Weight per channel written this frame. */
  readonly w: Float32Array;
  /** The expression's target (the face settles towards it). */
  private readonly t: Float32Array;
  /** Channel index per face unit (-1 when the set lacks it). */
  private readonly u: Record<Unit, number>;
  private readonly visemes: Int32Array;
  private readonly moods = new Map<string, MoodEntry>();
  private readonly pick = new Int32Array(MORPH_PAIRS);

  constructor(private readonly set: MorphSet) {
    this.w = new Float32Array(set.channels.length);
    this.t = new Float32Array(set.channels.length);
    const u = {} as Record<Unit, number>;
    for (const name of UNITS) u[name] = set.channel[name] ?? -1;
    this.u = u;
    this.visemes = Int32Array.from(VISEMES, (v) => set.channel[v] ?? -1);
    for (const [id, recipe] of Object.entries(MOODS)) this.moods.set(id, this.resolve(recipe));
  }

  /**
   * A recipe's names as channels; a name without a side applies to both. MakeHuman's `eyeSquint`
   * closes the lids much further than ARKit's (where it only narrows them), so it is scaled down.
   */
  private resolve(recipe: Record<string, number>): MoodEntry {
    const c: number[] = [];
    const v: number[] = [];
    const side: number[] = [];
    const ch = this.set.channel;
    for (const [name, raw] of Object.entries(recipe)) {
      const value = name.startsWith('eyeSquint') ? raw * SQUINT : raw;
      if (ch[name] !== undefined) {
        c.push(ch[name]);
        v.push(value);
        side.push(name.endsWith('Left') ? -1 : name.endsWith('Right') ? 1 : 0);
      } else if (ch[`${name}Left`] !== undefined && ch[`${name}Right`] !== undefined) {
        c.push(ch[`${name}Left`], ch[`${name}Right`]);
        v.push(value, value);
        side.push(-1, 1);
      }
    }
    return { c: Int32Array.from(c), v: Float32Array.from(v), side: Int8Array.from(side) };
  }

  /** Starts a frame's target. */
  begin(): void {
    this.t.fill(0);
  }

  private add(unit: Unit, v: number): void {
    const c = this.u[unit];
    if (c >= 0 && v !== 0) this.t[c] += v;
  }

  /** Adds mood `id` at `amount`, with a little asymmetry (`left` / `right` scale each side). */
  mood(id: string | undefined, amount: number, left: number, right: number): void {
    const m = id ? this.moods.get(id) : undefined;
    if (!m || amount <= 0) return;
    for (let k = 0; k < m.c.length; k++) {
      const s = m.side[k] < 0 ? left : m.side[k] > 0 ? right : 1;
      this.t[m.c[k]] += m.v[k] * amount * s;
    }
  }

  /**
   * Adds the adjustments of `f`, with a little asymmetry (`left` / `right` scale each side, ~0.9..1.1):
   * real faces are never quite symmetric.
   */
  expression(f: Face, left: number, right: number): void {
    const smile = Math.max(0, f.smile);
    const smileL = smile + Math.max(0, f.smirk);
    const smileR = smile + Math.max(0, -f.smirk);
    this.add('mouthSmileLeft', smileL * left);
    this.add('mouthSmileRight', smileR * right);
    // A real smile reaches the eyes (cheeks up, lower lids raised).
    this.add('cheekSquintLeft', 0.4 * smileL * left);
    this.add('cheekSquintRight', 0.4 * smileR * right);
    this.add('mouthDimpleLeft', 0.15 * smileL);
    this.add('mouthDimpleRight', 0.15 * smileR);
    const frown = Math.max(0, f.frown);
    this.add('mouthFrownLeft', frown * left);
    this.add('mouthFrownRight', frown * right);
    this.add('mouthShrugLower', 0.3 * frown);
    if (f.wide > 0) {
      this.add('mouthStretchLeft', 0.25 * f.wide);
      this.add('mouthStretchRight', 0.25 * f.wide);
    } else if (f.wide < 0) {
      this.add('mouthPucker', -f.wide);
      this.add('mouthFunnel', -0.2 * f.wide);
    }
    this.add('jawOpen', Math.max(0, f.jaw));
    const up = Math.max(0, f.browUp);
    this.add('browInnerUp', 0.5 * up + Math.max(0, f.browIn));
    this.add('browOuterUpLeft', up * left);
    this.add('browOuterUpRight', up * right);
    const down = Math.max(0, f.browDown);
    this.add('browDownLeft', down * left);
    this.add('browDownRight', down * right);
    const droop = Math.max(0, f.lidU) * 0.45;
    this.add('eyeBlinkLeft', droop);
    this.add('eyeBlinkRight', droop);
    const wide = Math.max(0, -f.lidU) * 1.5;
    this.add('eyeWideLeft', wide);
    this.add('eyeWideRight', wide);
    const squint = Math.max(0, f.lidL) * SQUINT * 2;
    this.add('eyeSquintLeft', squint * left);
    this.add('eyeSquintRight', squint * right);
    this.add('noseSneerLeft', Math.max(0, f.sneer));
    this.add('noseSneerRight', Math.max(0, f.sneer));
    this.add('mouthPressLeft', Math.max(0, f.press));
    this.add('mouthPressRight', Math.max(0, f.press));
  }

  /**
   * Small idle movements (after TalkingHead's idle "mouth" and "misc" animations): now and then a
   * lip rolls in, a corner stretches, the brows lift or the eyes narrow a little, each on its own
   * rhythm, so a face at rest is never frozen. `amount` 0..1 (0 while speaking or asleep).
   */
  micro(time: number, seed: number, amount: number): void {
    if (amount <= 0) return;
    for (let k = 0; k < MICRO.length; k++) {
      const [unit, period, max] = MICRO[k];
      const c = this.u[unit];
      if (c < 0) continue;
      const bucket = Math.floor(time / period + seed * 13 + k * 0.37);
      const r = hash01(bucket * 131 + k * 17 + Math.floor(seed * 1e4));
      // Mostly nothing; sometimes a small movement (the face settles into and out of it).
      if (r > 0.6) this.t[c] += ((r - 0.6) / 0.4) * max * amount;
    }
  }

  /**
   * Moves `state` (the Sim's face, one weight per channel) towards the target by `f` (0..1) and
   * starts this frame's weights from it.
   */
  settle(state: Float32Array, f: number): void {
    const t = this.t;
    for (let c = 0; c < t.length; c++) state[c] += (Math.min(1, t[c]) - state[c]) * f;
    this.w.set(state);
  }

  /** Blinks and closed eyes (`closed` 0..1) over the face, and the upper lids following the eyes' pitch (rad, + down). */
  eyes(closed: number, pitch: number): void {
    const w = this.w;
    const u = this.u;
    for (const [l, r] of [
      [u.eyeBlinkLeft, u.eyeBlinkRight],
      [u.eyeWideLeft, u.eyeWideRight],
      [u.eyeSquintLeft, u.eyeSquintRight],
    ] as const) {
      if (l < 0 || r < 0) continue;
      if (l === u.eyeBlinkLeft) {
        w[l] = Math.min(1, Math.max(w[l], closed));
        w[r] = Math.min(1, Math.max(w[r], closed));
      } else {
        w[l] *= 1 - closed;
        w[r] *= 1 - closed;
      }
    }
    const open = 1 - (u.eyeBlinkLeft >= 0 ? w[u.eyeBlinkLeft] : closed);
    const down = Math.min(1, Math.max(0, pitch) / LOOK_PITCH) * open;
    const upLook = Math.min(1, Math.max(0, -pitch) / LOOK_PITCH) * open;
    if (u.eyeLookDownLeft >= 0) w[u.eyeLookDownLeft] += down;
    if (u.eyeLookDownRight >= 0) w[u.eyeLookDownRight] += down;
    if (u.eyeLookUpLeft >= 0) w[u.eyeLookUpLeft] += upLook;
    if (u.eyeLookUpRight >= 0) w[u.eyeLookUpRight] += upLook;
  }

  /** Adds viseme `v` (voice engine index) at `weight`; quiet speech opens the mouth less. */
  viseme(v: number, weight: number, energy: number): void {
    if (v <= 0 || weight <= 0) return;
    const c = this.visemes[v];
    if (c < 0) return;
    const strength = CLOSED_VISEMES.has(v) ? 1 : 0.45 + 0.55 * energy;
    this.w[c] += weight * strength;
  }

  /** While speaking, the expression's open jaw and pursed lips give way to the visemes. */
  speaking(amount: number): void {
    const w = this.w;
    for (const c of [this.u.jawOpen, this.u.mouthPucker, this.u.mouthFunnel, this.u.mouthClose]) if (c >= 0) w[c] *= 1 - 0.7 * amount;
  }

  /** Adds raw channel weights (debugging: `{ jawOpen: 1 }`). */
  raw(weights: Record<string, number>): void {
    for (const [name, v] of Object.entries(weights)) {
      const c = this.set.channel[name];
      if (c !== undefined) this.w[c] += v;
    }
  }

  /** Marks a face as without morphs this frame (channel -1 first: the shader skips them all). */
  off(out: Float32Array, o: number): void {
    out.fill(0, o, o + MORPH_PAIRS * 2);
    out[o] = -1;
  }

  /**
   * Writes the strongest `MORPH_PAIRS` channels as (channel, weight) pairs at `out[o..]`
   * (`MORPH_PAIRS * 2` floats), unused pairs zero.
   */
  write(out: Float32Array, o: number): void {
    const w = this.w;
    const pick = this.pick;
    let n = 0;
    for (let c = 0; c < w.length; c++) {
      const v = w[c] > 1 ? (w[c] = 1) : w[c];
      if (v < 0.01) continue;
      if (n < MORPH_PAIRS) {
        pick[n++] = c;
        continue;
      }
      // Replace the weakest pick.
      let min = 0;
      for (let k = 1; k < n; k++) if (w[pick[k]] < w[pick[min]]) min = k;
      if (v > w[pick[min]]) pick[min] = c;
    }
    for (let k = 0; k < MORPH_PAIRS; k++) {
      out[o + k * 2] = k < n ? pick[k] : 0;
      out[o + k * 2 + 1] = k < n ? w[pick[k]] : 0;
    }
  }
}
