/**
 * Sims as skinned, animated characters (CC0 bodies, hair and clips by Quaternius; see
 * `tools/characters/build.py` and `assets/characters/`).
 *
 * GPU / performance model:
 * - One mesh per (body, part) — body, eyes, eyelids, brows, each hairstyle and each garment
 *   (`top.*`, `bottom.*`, `shoes.*`) — drawn with thin instances (one per Sim wearing it).
 * - Skinning runs on the GPU through Babylon's baked-vertex-animation path: a float texture holds
 *   one row per Sim (all bone matrices, plus appearance texels), and each instance reads "its"
 *   row (start frame = end frame = row, speed 0). The CPU poses every visible Sim once per frame
 *   (clip sampling, crossfades, retargeting, look-at, face) and uploads the texture in one write.
 *   Only buffer contents change per frame (bone texture, contact-shadow / ring / blanket instance
 *   matrices), never meshes. (WebGPU snapshot replays don't pick up the texture writes, so the game
 *   draws live; see `scheduleSnapshot` in BabylonRenderer.)
 * - No allocations per frame.
 *
 * Animation: a small state machine per Sim, driven by the snapshot: pose, moving, conversation
 * fields, and what the Sim is doing (`object` + `action` tag, mapped to clips, upper-body layers and
 * hand poses in `ACTIONS`; older layouts fall back to guessing from the object the Sim stands at).
 * Idle with variations, walk (playback matched to the ground speed, so feet don't slide), sit (seat
 * height per object), lie (under a blanket in beds), talk / listen / laugh / argue / fight / hug /
 * kiss, and object use. States crossfade over ~0.25 s; turns are smoothed.
 *
 * Face: bones under the head (eyes, eyelids, jaw, lip corners, brows) rotated in the head's frame:
 * irregular blinks, eyes on the conversation partner or now and then the camera, expressions from
 * the snapshot `emotion`, and the mouth moving while the Sim speaks (`animateFace`).
 */

import {
  Bone,
  Color3,
  Constants,
  DynamicTexture,
  MeshBuilder,
  StandardMaterial,
  Mesh,
  PBRMaterial,
  RawTexture,
  Skeleton,
  Texture,
  Matrix,
  VertexData,
  type Scene,
} from '@babylonjs/core';
import { BakedVertexAnimationManager } from '@babylonjs/core/BakedVertexAnimation/bakedVertexAnimationManager';
import type { AssetRegistry } from '../../assets/registry';
import type { FrameState } from '../../core/bridge';
import type { ObjectPlacement, SimInfo, WorldStructure } from '../../core/protocol';
import { Pose } from '../../core/snapshot';
import { loadCharacterSet, type BodyData, type CharacterSet, type Clip } from './characters/data';
import { APPEARANCE_TEXELS, CharacterPlugin, type CharacterSurface } from './characters/material';
import { outfitFor, writeOutfit, type OutfitParams } from './characters/outfit';
import { BLANKET_WIDTH, blanketMaterial, buildBlanket, type BlanketShape } from './characters/blanket';
import { addLocal, addRotation, blendInto, makeAdditive, PoseScratch, resetAdditive, sampleClip, skin, type Additive, type Placement } from './characters/pose';
import type { MaterialLibrary } from './materials';

/** Rows in the pose texture (= Sim capacity). */
export const MAX_CHARACTERS = 64;
/** Standing heights (metres) before a Sim's own height factor. */
const BASE_HEIGHT: Record<string, number> = { male: 1.77, female: 1.67 };
/** Snapshot animation codes (see `social::ANIMATIONS` in sim-core). */
const Anim = {
  None: 0,
  Talk: 1,
  Laugh: 2,
  Flirt: 3,
  Argue: 4,
  Fight: 5,
  Hug: 6,
  Kiss: 7,
} as const;
/** Sim ticks per frame step at each game speed (`clock::TICKS_PER_STEP`). */
const GAME_RATE = [0, 1, 3, 10, 30, 60];
/** Speed while time skips through quiet hours (`clock::AUTO_FAST_SPEED`). */
const QUIET_SPEED = 4;
/** Larger jumps between frames snap instead of sliding. */
const SNAP_DISTANCE = 1.6;
const DEFAULT_FADE = 0.25;

/** Seat surface height (m) and forward offset of the hips from the object's centre, per object def. */
const SEATS: Record<string, { h: number; fwd: number }> = {
  sofa: { h: 0.44, fwd: 0.1 },
  armchair: { h: 0.42, fwd: 0.08 },
  bench: { h: 0.45, fwd: 0.0 },
  toilet: { h: 0.43, fwd: -0.05 },
  // Chairs at desks and tables sit in the back half of the footprint, facing the work surface.
  chessTable: { h: 0.46, fwd: -0.2 },
  computerDesk: { h: 0.44, fwd: -0.17 },
  piano: { h: 0.47, fwd: -0.2 },
  diningTable: { h: 0.46, fwd: -0.19 },
  // Content packs.
  'gloomy.soakingTub': { h: 0.25, fwd: 0 },
  'romantic.heartTub': { h: 0.35, fwd: 0 },
  'hotHeaded.coldPlunge': { h: 0.35, fwd: 0 },
  'hotHeaded.coolDownCushion': { h: 0.4, fwd: 0 },
};
const DEFAULT_SEAT = { h: 0.45, fwd: 0 };
/** Mattress / bench top height (m) for lying. */
const BEDS: Record<string, { h: number }> = {
  bed: { h: 0.58 },
  weightBench: { h: 0.5 },
  'gloomy.soakingTub': { h: 0.25 },
  'romantic.heartTub': { h: 0.35 },
  'hotHeaded.coldPlunge': { h: 0.35 },
  'hotHeaded.coolDownCushion': { h: 0.2 },
};
const DEFAULT_BED = { h: 0.5 };
/** Beds whose sleepers get a blanket (pack hammocks, sofas and nap pods don't). */
const BLANKET_BEDS = new Set(['bed', 'lazy.snoozecloudBed']);
/** Lying: height of the back above the feet line, and how far the feet reach past the slot centre (body scale 1). */
const LIE_BACK = 0.1;
const LIE_CENTRE = 0.86;
/** Standing surface heights (m) of exercise equipment Sims stand on. */
const TRAMPOLINE_MAT = 0.5;
const VIBE_PLATE = 0.12;
/** Getting into bed: where the hips sit down, forward of the slot centre (body scale 1). */
const LIE_ENTRY = 0.55;
/** States that play another state's clip. */
const CLIP_OF: Record<string, string> = { lie: 'idle' };

/** Seated objects whose activity uses the hands on a desk / keys. */
const SIT_HANDS = new Set(['computerDesk', 'piano']);
/** Standing object use: clip sequence (looped). */
const USE: Record<string, readonly string[]> = {
  fridge: ['interact', 'eat', 'eat'],
  sink: ['interact'],
  shower: ['interact', 'idle'],
  tv: ['foldArms'],
  bookshelf: ['interact', 'phone', 'phone'],
  plant: ['water'],
  flowerbed: ['kneel'],
  treadmill: ['jog'],
  easel: ['interact'],
  mirror: ['talk'],
  workbench: ['interact', 'pickUp'],
  telescope: ['rail'],
  tree: ['idle'],
};

/** Finger pose: 0 = the clip's grip, 1 = open hand (rest pose). */
const HANDS = {
  grip: 0.1,
  hold: 0.35,
  relaxed: 0.6,
  /** Standing at rest: fingers loosely open along the thighs. */
  rest: 0.78,
  keys: 0.75,
  open: 0.85,
} as const;

/**
 * Animation per action tag (`layout.actions`, from the content's `animations`):
 * - `stand`: clip sequence while standing at the object (looped; looping clips play ~4 s per step);
 *   a function picks one by object def;
 * - `sit`: seated clip (default `sit`), or a function of the object def;
 * - `upper`: upper-body layer while seated (`eat` plays now and then);
 * - `hands`: finger pose.
 * Procedural layers on top (reclining, instruments, gazes, ...) are in `activityPose`.
 */
interface ActionAnim {
  stand?: readonly string[] | ((def: string) => readonly string[]);
  sit?: string | ((def: string) => string);
  upper?: string;
  hands?: number;
}
const ACTIONS: Record<string, ActionAnim> = {
  eat: { stand: ['eat', 'idle'], upper: 'eat', hands: HANDS.hold },
  // Sips: the same hand-to-mouth clip, spaced out.
  drink: { stand: ['eat', 'idle', 'idle'], upper: 'eat', hands: HANDS.hold },
  cook: {
    stand: ['spell', 'interact', 'spell', 'pickUp'],
    sit: 'sitHands',
    hands: HANDS.hold,
  },
  wash: { stand: ['spell', 'interact'], hands: HANDS.relaxed },
  shower: { stand: ['spell', 'interact', 'idle'], hands: HANDS.open },
  bath: { hands: HANDS.open },
  toilet: { hands: HANDS.relaxed },
  sleep: { hands: HANDS.open },
  nap: { hands: HANDS.open },
  sit: { hands: HANDS.open },
  relax: { stand: ['idle', 'foldArms'], hands: HANDS.open },
  type: { stand: ['spell'], sit: 'sitHands', hands: HANDS.keys },
  write: { stand: ['interact', 'spell'], sit: 'sitHands', hands: HANDS.hold },
  read: { stand: ['lantern'], upper: 'lantern', hands: HANDS.hold },
  watch: { stand: ['foldArms', 'idle'], hands: HANDS.open },
  play: { stand: ['spell'], sit: 'sitHands', hands: HANDS.keys },
  // Keys and drums on the desk-hands clip; a cello is held upright between the knees.
  music: { stand: ['spell'], sit: (def) => (def.includes('cello') ? 'sit' : 'sitHands'), hands: HANDS.keys },
  paint: { stand: ['spell', 'interact', 'spell'], hands: HANDS.hold },
  exercise: {
    stand: (def) =>
      def.includes('Bag') || def.includes('smash')
        ? ['punchJab', 'punchCross']
        : def.includes('fitnessGame')
          ? ['dance', 'punchJab', 'punchCross']
          : def.includes('streetball')
            ? ['pickUp', 'interact']
            : // Climbing, bouncing, vibrating and stretching: the idle with `activityPose` on top.
              def.includes('boulder') || def.includes('trampoline') || def.includes('vibe') || def.includes('sunrise')
              ? ['idle']
              : ['jog'],
    sit: 'sitHands',
    hands: HANDS.grip,
  },
  run: { stand: ['jog'], hands: HANDS.grip },
  lift: { stand: ['pickUp'], hands: HANDS.grip },
  dance: { stand: ['dance'], hands: HANDS.relaxed },
  talk: { stand: ['talk'], hands: HANDS.relaxed },
  // The phone clip's hand at the mouth reads as a microphone.
  sing: { stand: ['talk'], upper: 'phone', hands: HANDS.hold },
  clean: {
    stand: (def) => (def.includes('Mop') || def.includes('Vacuum') ? ['push'] : def.includes('laundry') ? ['spell', 'interact', 'pickUp'] : ['interact', 'spell']),
    hands: HANDS.hold,
  },
  // Gardening, by task (older content and packs: `garden`).
  water: { stand: ['water'], hands: HANDS.hold },
  tend: { stand: ['kneel'], hands: HANDS.relaxed },
  harvest: { stand: ['harvest', 'plant'], hands: HANDS.hold },
  prune: { stand: ['interact', 'spell', 'interact'], hands: HANDS.grip },
  garden: {
    stand: (def) => (def === 'plant' || def.includes('Terrarium') || def.includes('bonsai') ? ['water'] : ['harvest', 'plant']),
    hands: HANDS.hold,
  },
  tinker: {
    stand: ['interact', 'spell', 'pickUp'],
    sit: 'sitHands',
    hands: HANDS.grip,
  },
  look: {
    stand: (def) => (def === 'telescope' ? ['rail'] : ['idle', 'foldArms']),
    hands: HANDS.relaxed,
  },
  // Down to low flowers / up into a tree's crown (`activityPose` turns the head).
  smell: { stand: ['crouch'], hands: HANDS.relaxed },
  admire: { stand: ['idle', 'foldArms'], hands: HANDS.relaxed },
  phone: { stand: ['phone'], upper: 'phone', hands: HANDS.hold },
  listen: { stand: ['idle', 'foldArms'], hands: HANDS.open },
  meditate: { stand: ['idle'], hands: HANDS.open },
  idle: { stand: ['idle'], hands: HANDS.relaxed },
};
/** Clips that may be missing from older asset builds, and their stand-ins. */
const CLIP_FALLBACK: Record<string, string> = {
  spell: 'interact',
  push: 'interact',
  plant: 'harvest',
  lantern: 'phone',
  kneel: 'harvest',
  crouch: 'harvest',
};
/** Looping clips in a use sequence play this long (s) per step. */
const LOOP_STEP = 4;

/**
 * Facial expression (all roughly 0..1): smile / frown (lip corners up / down), wide (corners
 * apart, negative = pucker), jaw (mouth open), browUp, browIn (inner ends up: worry, sadness),
 * browDown (frown, anger), lidU (upper lids: + droop, - wide open), lidL (lower lids raised: squint,
 * the eyes of a real smile), gazeDown.
 */
export interface Face {
  smile: number;
  frown: number;
  wide: number;
  jaw: number;
  browUp: number;
  browIn: number;
  browDown: number;
  lidU: number;
  lidL: number;
  gazeDown: number;
}
const NEUTRAL: Face = {
  smile: 0,
  frown: 0,
  wide: 0,
  jaw: 0,
  browUp: 0,
  browIn: 0,
  browDown: 0,
  lidU: 0,
  lidL: 0,
  gazeDown: 0,
};
/** Expression per emotion id (content `emotions`, packs included); unknown ids stay neutral. */
export const EXPRESSIONS: Record<string, Partial<Face>> = {
  happy: { smile: 1, wide: 0.5, lidL: 0.55, browUp: 0.25 },
  flirty: { smile: 0.65, wide: 0.2, lidU: 0.3, lidL: 0.3, browUp: 0.45 },
  confident: { smile: 0.45, lidU: 0.12, browDown: 0.15 },
  focused: {
    browDown: 0.45,
    lidU: 0.15,
    lidL: 0.25,
    frown: 0.1,
    gazeDown: 0.15,
  },
  inspired: { smile: 0.55, wide: 0.3, browUp: 0.7, lidU: -0.25 },
  energized: { smile: 0.7, wide: 0.4, browUp: 0.4, lidU: -0.3 },
  playful: { smile: 0.8, wide: 0.4, lidL: 0.4, browUp: 0.35 },
  relaxed: { smile: 0.35, lidU: 0.3 },
  embarrassed: {
    smile: 0.25,
    wide: -0.2,
    browIn: 0.6,
    lidU: 0.2,
    gazeDown: 0.6,
  },
  sad: { frown: 0.8, wide: -0.2, browIn: 1, lidU: 0.4, gazeDown: 0.45 },
  tense: { frown: 0.35, wide: -0.35, browIn: 0.55, browDown: 0.3, lidU: -0.15 },
  uncomfortable: { frown: 0.45, browIn: 0.5, lidU: 0.1 },
  bored: { frown: 0.15, lidU: 0.45, gazeDown: 0.2 },
  angry: { frown: 0.75, wide: 0.15, browDown: 1, lidU: -0.1, lidL: 0.35 },
  dazed: { jaw: 0.15, lidU: 0.35, browUp: 0.3 },
};
const FACE_KEYS = Object.keys(NEUTRAL) as (keyof Face)[];
/**
 * The resting face every expression starts from: a soft closed-lip smile (corners up, held
 * together so the lips stay closed), relaxed brows lifted a touch with soft inner ends, eyes a
 * little more open with the lower lids raised as in a real smile. Scaled by mood (gone
 * when a Sim is very unhappy) and left out under emotions that frown or knit the brows, which
 * define the face themselves; the face returns to it when they pass.
 */
export const FRIENDLY: Partial<Face> = { smile: 0.45, wide: -0.25, lidU: -0.03, lidL: 0.25, browUp: 0.2, browIn: 0.12 };

const COLD = new Set(
  Object.entries(EXPRESSIONS)
    .filter(([, e]) => (e.frown ?? 0) > 0.05 || (e.browDown ?? 0) > 0.3 || (e.browIn ?? 0) > 0.3)
    .map(([id]) => id),
);
/** Mood (0..1) below which the resting smile fades out, and where it is full. */
const MOOD_COLD = 0.2;
const MOOD_WARM = 0.55;

/**
 * Relaxed standing stance, layered over the idle-based clips (radians, model space; scaled by how
 * relaxed the Sim stands, see `stanceWeight`): feet under the hips, the weight on one leg with the
 * hips shifted (`hip`, alternating now and then), the other knee soft, arms hanging closer and a
 * little forward with soft elbows (so the hands clear the hips), shoulders down.
 */
export const STANCE = {
  feet: 0.075,
  stagger: 0.27,
  hip: 0.05,
  knee: 0.16,
  /** Arms in (+) or out (-) per body (the clip retargets to each differently), more out over a skirt. */
  arms: { male: 0.02, female: -0.1 } as Record<string, number>,
  skirt: -0.1,
  /** The clip holds the right hand further back and closer in than the left: even them out. */
  even: 0.08,
  right: -0.1,
  forward: 0.03,
  elbows: -0.25,
  twist: 0.1,
  shoulders: 0.08,
};
/** Clips standing on the idle base: legs relaxed in all; arms also in the first ones. */
const RELAX_ARMS = new Set(['idle', 'talk', 'yes', 'no']);
const RELAX_LEGS = new Set(['idle', 'talk', 'yes', 'no', 'foldArms', 'phone', 'lantern', 'rail']);
const ASLEEP: Partial<Face> = { jaw: 0.06, smile: 0 };
const LAUGH: Partial<Face> = { smile: 1, wide: 0.6, lidL: 0.75, browUp: 0.35, frown: 0, browDown: 0 };
const KISS: Partial<Face> = { smile: 0.2, wide: -1, frown: 0, browDown: 0 };
const HUG: Partial<Face> = { smile: 0.7, wide: 0.3, frown: 0, browDown: 0 };
const NONE: Partial<Face> = {};

/**
 * Stage directions for one Sim row (character creator and portraits; never set in game): a clip to
 * play instead of the activity's, an expression on top of the emotion, a point to look at, an
 * extra procedural layer, and `still` (portraits: the clip held at `time`, no blinks or glances,
 * no smoothing). A directed Sim turns to the snapshot's yaw at once (the director smooths it).
 */
export interface StageDirection {
  clip?: string | null;
  /** With `still`: the clip time (s) to hold. */
  time?: number;
  /** Finger pose (0 = the clip's grip, 1 = open). */
  hands?: number;
  face?: Partial<Face> | null;
  /** World point the eyes (and partly the head) turn to. */
  lookAt?: { x: number; y: number; z: number } | null;
  /** Extra model-space rotations after the built-in layers (gestures). */
  pose?: ((add: Additive, bone: Record<string, number>, time: number) => void) | null;
  still?: boolean;
}

interface Player {
  clip: Clip | null;
  key: string;
  time: number;
  rate: number;
  /** Play non-looping clips in a loop (object use). */
  repeat: boolean;
  /** Root placement relative to the Sim: height, forward offset, pitch (lying). */
  rootY: number;
  rootFwd: number;
  rootPitch: number;
}

function player(): Player {
  return {
    clip: null,
    key: '',
    time: 0,
    rate: 1,
    repeat: false,
    rootY: 0,
    rootFwd: 0,
    rootPitch: 0,
  };
}

function copyPlayer(from: Player, to: Player): void {
  to.clip = from.clip;
  to.key = from.key;
  to.time = from.time;
  to.rate = from.rate;
  to.repeat = from.repeat;
  to.rootY = from.rootY;
  to.rootFwd = from.rootFwd;
  to.rootPitch = from.rootPitch;
}

interface SimRig {
  id: number;
  body: BodyData;
  scale: number;
  seed: number;
  visible: boolean;
  /** Displayed position / yaw (smoothed). */
  x: number;
  z: number;
  yaw: number;
  speed: number;
  lastPose: number;
  /** Seconds in the current activity (for idle variations / sequences). */
  actTime: number;
  seq: number;
  useKey: string;
  useSeq: readonly string[] | null;
  /** Current action tag ('' = none / unknown) and whether it came from the snapshot. */
  tag: string;
  /** Def of the object in use ('' = none), for activity layers that depend on it. */
  useDef: string;
  tagKnown: boolean;
  cur: Player;
  prev: Player;
  /** Weight of `cur` (1 = fully faded in). */
  w: number;
  fadeRate: number;
  /** Upper-body layer (eating while seated, hugging). */
  upper: Player;
  upperW: number;
  upperTarget: number;
  lookYaw: number;
  lookPitch: number;
  /** Extra forward step towards a partner (hugs, kisses). */
  approach: number;
  /** Day clothes and pyjamas (switched when the Sim lies down in bed). */
  day: OutfitParams | null;
  night: OutfitParams | null;
  asleep: boolean;
  /** Finger openness (see HANDS), smoothed. */
  hands: number;
  /** Seconds in the current step of a use sequence. */
  stepTime: number;
  /** Emotion code (index + 1 into the content's emotions; 0 = none). */
  emotion: number;
  /** Bed while lying (for the blanket) and how far the blanket is pulled up (0..1). */
  bed: PlacedObject | null;
  bedH: number;
  /**
   * Getting out of bed: sim-core puts the Sim on the tile in front at once; the lying body
   * (fading out) and the blanket stay where it lay (`lieX`, `lieZ`: its slot, kept while lying)
   * and the Sim stands up from the foot of the bed.
   */
  fromBed: boolean;
  lieX: number;
  lieZ: number;
  cover: number;
  /** Current (smoothed) facial expression. */
  face: Face;
  /** Blink: start time of the current blink and when the next one starts (s). */
  blinkAt: number;
  nextBlink: number;
  /** Eye gaze (rad, head-relative, smoothed) and the current gaze target (0 none, 1 partner, 2 camera, 3 glance). */
  eyeYaw: number;
  eyePitch: number;
  gazeMode: number;
  gazeUntil: number;
  glanceYaw: number;
  glancePitch: number;
  /** Stage directions for this frame (null in game). */
  dir: StageDirection | null;
  /** Resting-face warmth from mood (0..1). */
  warmth: number;
  /** Relaxed stance weights (smoothed 0..1) for the legs and the arms, and the weight shift (-1..1). */
  relaxLegs: number;
  relaxArms: number;
  shift: number;
  /** Wears a skirt (the hands hang clear of it). */
  skirt: boolean;
}

/** Pelvis offset of the seated clip for one body (scale 1). */
interface SeatFit {
  y: number;
  z: number;
}

interface PlacedObject {
  def: string;
  cx: number;
  cz: number;
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

interface PartMesh {
  mesh: Mesh;
  settings: Float32Array;
}

export class Characters {
  private set: CharacterSet | null = null;
  private failed = false;
  private texture!: RawTexture;
  private data!: Float32Array;
  private width = 0;
  private vat!: BakedVertexAnimationManager;
  private readonly meshes = new Map<string, PartMesh>();
  private readonly materials = new Map<string, PBRMaterial>();
  private readonly skeletons = new Map<string, Skeleton>();
  private sims: (SimRig | null)[] = [];
  private objects: PlacedObject[] = [];
  private readonly objectById = new Map<number, PlacedObject>();
  /** Action tag per `sim.action` index (from the snapshot layout). */
  private actionTags: readonly string[] = [];
  private scratch!: PoseScratch;
  private qA!: Float32Array;
  private pA!: Float32Array;
  private qB!: Float32Array;
  private pB!: Float32Array;
  private add!: Additive;
  private upperMask!: Float32Array;
  private fingerMask!: Float32Array;
  private legMask!: Float32Array;
  private readonly place: Placement = {
    x: 0,
    y: 0,
    z: 0,
    qx: 0,
    qy: 0,
    qz: 0,
    qw: 1,
    scale: 1,
  };
  private readonly headTmp = new Float32Array(3);
  private readonly faceTmp: Face = { ...NEUTRAL };
  /** Gaze yaw / pitch (head-relative) from `gazeAt`. */
  private readonly gaze = new Float32Array(2);
  /** Blankets: one quilt mesh per body, one thin instance (matrix) per Sim row. */
  private readonly blankets = new Map<string, BlanketShape & { matrices: Float32Array; ext: Float32Array }>();
  /** Per Sim row: head top (x, y, z) for speech bubbles and the selection marker. */
  readonly heads = new Float32Array(MAX_CHARACTERS * 3);
  readonly visible = new Uint8Array(MAX_CHARACTERS);
  private lastNow = 0;
  /** Seconds of animation played: stands still while the game is paused (Sims hold their pose). */
  private clock = 0;
  /** Sit / lie pelvis offsets per body (computed once from the clips). */
  private readonly sitPelvis = new Map<string, SeatFit>();
  /** `?debug`: force a clip on every Sim (`__characters.force = 'sit'`). */
  force: string | null = null;
  /** `?debug`: expression override (`__characters.faceDebug = { smile: 1, jaw: 0.5, closed: 1 }`). */
  faceDebug: (Partial<Face> & { closed?: number; talk?: boolean }) | null = null;
  /** `?debug`: animation speed override (e.g. to keep animating while the game is paused). */
  debugRate: number | null = null;
  /** CPU time of the last `update` (ms, smoothed), for profiling. */
  updateMs = 0;
  /** Emotion id per snapshot emotion code - 1 (content `emotions`). */
  private emotionIds: readonly string[] = [];
  /** Stage directions per Sim row (character creator / portraits only; empty in game). */
  readonly directions: (StageDirection | null)[] = [];
  /** Selected Sim (selection ring), or null. */
  private selected: number | null = null;
  private ring: Mesh | null = null;
  private readonly ringMatrix = new Float32Array(16);

  constructor(
    private readonly scene: Scene,
    private readonly assets: AssetRegistry,
    private readonly lib: MaterialLibrary,
  ) {}

  /** Loads the character set and creates the pose texture; false if unavailable. */
  async init(): Promise<boolean> {
    if (this.set) return true;
    if (this.failed) return false;
    const entry = this.assets.get('model.sim', 'character');
    if (!entry) {
      this.failed = true;
      return false;
    }
    try {
      this.set = await loadCharacterSet(entry.url);
    } catch (err) {
      console.warn('[render] characters unavailable', err);
      this.failed = true;
      return false;
    }
    const set = this.set;
    const NB = set.bones.length;
    this.width = NB * 4 + APPEARANCE_TEXELS;
    this.data = new Float32Array(this.width * MAX_CHARACTERS * 4);
    this.texture = new RawTexture(
      this.data,
      this.width,
      MAX_CHARACTERS,
      Constants.TEXTUREFORMAT_RGBA,
      this.scene,
      false,
      false,
      Constants.TEXTURE_NEAREST_SAMPLINGMODE,
      Constants.TEXTURETYPE_FLOAT,
    );
    this.texture.name = 'simPoses';
    this.vat = new BakedVertexAnimationManager(this.scene);
    this.vat.texture = this.texture;
    this.vat.isEnabled = true;
    this.scratch = new PoseScratch(NB);
    this.qA = new Float32Array(NB * 4);
    this.qB = new Float32Array(NB * 4);
    this.pA = new Float32Array(3);
    this.pB = new Float32Array(3);
    this.add = makeAdditive(NB);
    // Upper body: spine_02 and everything above it (arms, neck, head); spine_01 half.
    this.upperMask = new Float32Array(NB);
    for (let b = 0; b < NB; b++) {
      let p = b;
      let w = 0;
      while (p >= 0) {
        const n = set.bones[p];
        if (n === 'spine_02') {
          w = 1;
          break;
        }
        if (n === 'spine_01' && p === b) w = 0.5;
        p = set.parents[p];
      }
      this.upperMask[b] = w;
    }
    this.fingerMask = new Float32Array(NB);
    set.bones.forEach((n, b) => (this.fingerMask[b] = /^(index|middle|ring|pinky|thumb)_/.test(n) ? 1 : 0));
    this.legMask = new Float32Array(NB);
    set.bones.forEach((n, b) => (this.legMask[b] = /^(thigh|calf|foot|ball)_/.test(n) ? 1 : 0));
    for (const body of set.bodies.values()) this.sitPelvis.set(body.name, this.measureSit(body));
    const lying = [...set.bodies.values()].map((body) => ({
      body,
      ...this.lyingPose(body),
    }));
    // One stretch range for both quilts (their toes are within a centimetre).
    const toeZ = Math.max(...lying.map((l) => l.feetZ)) + 0.03;
    const quilt = blanketMaterial(this.scene, toeZ, toeZ + 0.29);
    this.lib.adopt(quilt);
    for (const l of lying) {
      const shape = buildBlanket(this.scene, `simBlanket:${l.body.name}`, l.positions, l.chestZ, l.feetZ, quilt);
      const matrices = new Float32Array(MAX_CHARACTERS * 16);
      const ext = new Float32Array(MAX_CHARACTERS);
      shape.mesh.thinInstanceSetBuffer('matrix', matrices, 16, false);
      shape.mesh.thinInstanceSetBuffer('blanketExt', ext, 1, false);
      shape.mesh.setEnabled(false);
      this.blankets.set(l.body.name, { ...shape, matrices, ext });
    }
    this.ring = this.makeRing();
    if (new URLSearchParams(location.search).has('debug')) Object.assign(window, { __characters: this, __stance: STANCE, __friendly: FRIENDLY });
    return true;
  }

  /** Emotion ids in snapshot order (`emotion` field = index + 1), for facial expressions. */
  setEmotions(ids: readonly string[]): void {
    this.emotionIds = ids;
  }

  /** Shows the selection ring under Sim `id` (null hides it). */
  select(id: number | null): void {
    this.selected = id;
  }

  /** A soft glowing ring on the floor around the selected Sim (one thin instance, moved per frame). */
  private makeRing(): Mesh {
    const size = 256;
    const tex = new DynamicTexture('simRing', size, this.scene, true);
    const ctx = tex.getContext() as CanvasRenderingContext2D;
    const g = ctx.createRadialGradient(size / 2, size / 2, size * 0.3, size / 2, size / 2, size / 2);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.55, 'rgba(255,255,255,0.0)');
    g.addColorStop(0.72, 'rgba(255,255,255,0.85)');
    g.addColorStop(0.8, 'rgba(255,255,255,0.55)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    tex.update();
    tex.hasAlpha = true;
    const mat = new StandardMaterial('simRing', this.scene);
    mat.disableLighting = true;
    mat.diffuseColor = Color3.Black();
    mat.specularColor = Color3.Black();
    mat.emissiveColor = Color3.FromHexString('#7BE38A');
    mat.opacityTexture = tex;
    mat.disableDepthWrite = true;
    mat.zOffset = -4;
    const ring = MeshBuilder.CreateGround('simRing', { width: 1, height: 1 }, this.scene);
    ring.material = mat;
    ring.isPickable = false;
    ring.alwaysSelectAsActiveMesh = true;
    ring.thinInstanceSetBuffer('matrix', this.ringMatrix, 16, false);
    return ring;
  }

  private writeRing(time: number): void {
    const m = this.ringMatrix;
    m.fill(0);
    const id = this.selected;
    const rig = id !== null ? this.sims[id] : null;
    if (rig && rig.visible && rig.cur.key !== 'lie') {
      const r = 0.95 * rig.scale * (1 + Math.sin(time * 2.4) * 0.03);
      const a = time * 0.5;
      m[0] = Math.cos(a) * r;
      m[2] = -Math.sin(a) * r;
      m[5] = 1;
      m[8] = Math.sin(a) * r;
      m[10] = Math.cos(a) * r;
      m[12] = rig.x;
      m[13] = 0.03;
      m[14] = rig.z;
      m[15] = 1;
    }
    this.ring?.thinInstanceBufferUpdated('matrix');
  }

  /** Character meshes in use (shadow casters; small details excluded). */
  casters(): Mesh[] {
    const out: Mesh[] = [];
    for (const [key, p] of this.meshes) if (p.mesh.isEnabled() && !/:(eyes|brows|lids|shoes\.)/.test(key)) out.push(p.mesh);
    return out;
  }

  /**
   * Builds instances for the world's Sims (meshes and materials are cached). `keep` keeps the
   * animation state of Sims whose row stays (previews restyling a Sim without restarting it).
   * A Sim may carry `outfitId`, the id its outfit is derived from when it differs from its row.
   */
  async build(world: Pick<WorldStructure, 'sims' | 'objects'>, keep = false): Promise<void> {
    if (!(await this.init())) return;
    const set = this.set!;
    const kept = keep ? this.sims : [];
    this.sims = [];
    this.ghosts = [];
    this.data.fill(0);
    this.visible.fill(0);
    const groups = new Map<string, SimInfo[]>();
    const push = (key: string, s: SimInfo) => {
      const list = groups.get(key) ?? [];
      list.push(s);
      groups.set(key, list);
    };
    for (const s of world.sims) {
      if (s.id >= MAX_CHARACTERS || s.gone) continue;
      const bodyName = s.gender === 'female' ? 'female' : 'male';
      const body = set.bodies.get(bodyName) ?? set.bodies.values().next().value!;
      const style = s.appearance?.hairStyle ?? 'short';
      const hairKey = this.assets.has(`model.hair.${style}`, 'character')
        ? (this.assets.get(`model.hair.${style}`, 'character')!.part ?? `hair.${style}`)
        : `hair.${style}`;
      const outfitId = (s as SimInfo & { outfitId?: number }).outfitId ?? s.id;
      push(`${body.name}:body`, s);
      push(`${body.name}:eyes`, s);
      push(`${body.name}:brows`, s);
      if (body.parts.has('lids')) push(`${body.name}:lids`, s);
      if (body.parts.has(hairKey)) push(`${body.name}:${hairKey}`, s);
      if (s.appearance?.beard && body.parts.has('hair.beard')) push(`${body.name}:hair.beard`, s);
      const day = outfitFor(outfitId, s.gender, s.appearance, body);
      for (const part of day.parts) if (body.parts.has(part)) push(`${body.name}:${part}`, s);
      const height = clampHeight(s.appearance?.height);
      const scale = ((BASE_HEIGHT[body.name] ?? 1.72) / body.height) * height;
      const rig: SimRig = {
        id: s.id,
        body,
        scale,
        seed: hash(s.id + 17),
        visible: false,
        x: 0,
        z: 0,
        yaw: 0,
        speed: 0,
        lastPose: -1,
        actTime: 0,
        seq: 0,
        useKey: '',
        useSeq: null,
        tag: '',
        useDef: '',
        tagKnown: false,
        cur: player(),
        prev: player(),
        w: 1,
        fadeRate: 4,
        upper: player(),
        upperW: 0,
        upperTarget: 0,
        lookYaw: 0,
        lookPitch: 0,
        approach: 0,
        day: null,
        night: null,
        asleep: false,
        hands: HANDS.relaxed,
        stepTime: 0,
        emotion: 0,
        bed: null,
        bedH: 0,
        fromBed: false,
        lieX: 0,
        lieZ: 0,
        cover: 0,
        face: { ...NEUTRAL },
        blinkAt: -1,
        nextBlink: 0,
        eyeYaw: 0,
        eyePitch: 0,
        gazeMode: 0,
        gazeUntil: 0,
        glanceYaw: 0,
        glancePitch: 0,
        dir: null,
        warmth: 1,
        relaxLegs: 0,
        relaxArms: 0,
        shift: 0,
        skirt: false,
      };
      const old = kept[s.id];
      if (old) Object.assign(rig, old, { body, scale, asleep: false });
      this.sims[s.id] = rig;
      rig.day = outfitFor(outfitId, s.gender, s.appearance, body);
      rig.night = outfitFor(outfitId, s.gender, s.appearance, body, true);
      rig.skirt = rig.day.parts.includes('bottom.skirt');
      writeOutfit(rig.day, this.data, this.row(s.id) + set.bones.length * 16);
    }
    for (const p of this.meshes.values()) p.mesh.setEnabled(false);
    for (const [key, sims] of groups) {
      const [bodyName, part] = splitKey(key);
      const body = set.bodies.get(bodyName)!;
      const pm = this.partMesh(body, part);
      if (!pm) continue;
      const n = sims.length;
      const identity = new Float32Array(n * 16);
      const settings = new Float32Array(n * 4);
      for (let j = 0; j < n; j++) {
        identity[j * 16] = identity[j * 16 + 5] = identity[j * 16 + 10] = identity[j * 16 + 15] = 1;
        settings[j * 4] = settings[j * 4 + 1] = sims[j].id;
      }
      pm.mesh.thinInstanceSetBuffer('matrix', identity, 16, true);
      pm.mesh.thinInstanceSetBuffer('bakedVertexAnimationSettingsInstanced', settings, 4, true);
      pm.settings = settings;
      pm.mesh.setEnabled(true);
    }
    // Objects Sims sit, lie or stand at (for seat heights and object-use animations).
    this.objectById.clear();
    this.objects = world.objects.map((o: ObjectPlacement) => ({
      def: o.def,
      cx: o.x + o.w / 2,
      cz: o.z + o.d / 2,
      minX: o.x,
      minZ: o.z,
      maxX: o.x + o.w,
      maxZ: o.z + o.d,
    }));
    world.objects.forEach((o, j) => this.objectById.set(o.id, this.objects[j]));
    for (const b of this.blankets.values()) {
      b.matrices.fill(0);
      b.mesh.thinInstanceBufferUpdated('matrix');
      b.mesh.setEnabled(world.objects.some((o) => BLANKET_BEDS.has(o.def)));
    }
    this.texture.update(this.data);
  }

  /** `?debug` stress test: `n` extra animated Sims in a grid around (x, z), cloned from Sim 0. */
  private ghosts: { x: number; z: number; clip: string }[] = [];
  stress(n: number, x: number, z: number): void {
    const set = this.set;
    const base = this.sims.find(Boolean);
    if (!set || !base) return;
    const count = this.sims.length;
    const clips = ['idle', 'walk', 'talk', 'foldArms', 'idle', 'walk'];
    this.ghosts = [];
    for (let k = 0; k < n && count + k < MAX_CHARACTERS; k++) {
      const id = count + k;
      this.ghosts.push({
        x: x + (k % 5) * 1.1,
        z: z + Math.floor(k / 5) * 1.1,
        clip: clips[k % clips.length],
      });
      const body = [...set.bodies.values()][k % 2];
      const rig: SimRig = {
        ...base,
        id,
        body,
        cur: player(),
        prev: player(),
        upper: player(),
        visible: true,
        x: 0,
        z: 0,
        yaw: k,
        seed: hash(id),
        face: { ...NEUTRAL },
      };
      this.sims[id] = rig;
      writeOutfit(
        outfitFor(
          id,
          body.name,
          {
            body: '#5F86C9',
            skin: '#C08A64',
            hair: '#2B2320',
            hairStyle: 'short',
            height: 1,
          },
          body,
        ),
        this.data,
        this.row(id) + set.bones.length * 16,
      );
    }
    for (const [key, pm] of this.meshes) {
      if (!pm.mesh.isEnabled()) continue;
      const [bodyName, part] = splitKey(key);
      const ids = [...pm.settings.filter((_, j) => j % 4 === 0)];
      this.ghosts.forEach((_, k) => {
        const body = [...set.bodies.values()][k % 2];
        if (
          body.name === bodyName &&
          (part === 'body' ||
            part === 'eyes' ||
            part === 'brows' ||
            part === 'lids' ||
            part === 'hair.short' ||
            part === 'top.tee' ||
            part === 'bottom.trousers' ||
            part === 'shoes.sneakers')
        )
          ids.push(count + k);
      });
      const identity = new Float32Array(ids.length * 16);
      const settings = new Float32Array(ids.length * 4);
      ids.forEach((id, j) => {
        identity[j * 16] = identity[j * 16 + 5] = identity[j * 16 + 10] = identity[j * 16 + 15] = 1;
        settings[j * 4] = settings[j * 4 + 1] = id;
      });
      pm.mesh.thinInstanceSetBuffer('matrix', identity, 16, true);
      pm.mesh.thinInstanceSetBuffer('bakedVertexAnimationSettingsInstanced', settings, 4, true);
    }
  }

  private poseGhosts(count: number, dt: number, time: number): void {
    const set = this.set!;
    this.ghosts.forEach((g, k) => {
      const i = count + k;
      const rig = this.sims[i]!;
      if (rig.cur.key !== g.clip) this.start(rig, g.clip, 0.2, 1, true, 0, 0, 0);
      advance(rig.cur, dt);
      rig.w = 1;
      sampleClip(set, rig.cur.clip!, rig.cur.time, this.qA, this.pA);
      blendInto(this.qA, this.pA, set.sourceRestQ, this.pA, 0.6, this.fingerMask);
      resetAdditive(this.add);
      this.procedural(rig, i, 0, 0, null, Pose.Stand, false, time, dt);
      const pl = this.place;
      pl.qx = 0;
      pl.qy = Math.sin(rig.yaw / 2);
      pl.qz = 0;
      pl.qw = Math.cos(rig.yaw / 2);
      pl.x = g.x;
      pl.y = 0;
      pl.z = g.z;
      pl.scale = rig.scale;
      skin(set, rig.body, this.qA, this.pA, this.add, pl, this.scratch, this.data, this.row(i), this.headTmp);
      this.visible[i] = 1;
    });
  }

  /** Removes the Sims (end of a session); meshes stay cached. */
  clear(): void {
    this.sims = [];
    this.ghosts = [];
    this.objects = [];
    this.objectById.clear();
    this.visible.fill(0);
    for (const p of this.meshes.values()) p.mesh.setEnabled(false);
    for (const b of this.blankets.values()) b.mesh.setEnabled(false);
  }

  /** Head-top position of Sim `i` (false if not drawn). */
  head(i: number, out: { x: number; y: number; z: number }): boolean {
    if (i < 0 || i >= MAX_CHARACTERS || !this.visible[i]) return false;
    out.x = this.heads[i * 3];
    out.y = this.heads[i * 3 + 1];
    out.z = this.heads[i * 3 + 2];
    return true;
  }

  /**
   * Poses every Sim for this frame. `inView(x, z)` decides visibility; contact-shadow matrices
   * (one 4x4 per Sim row) are written into `shadows`.
   */
  update(frame: FrameState, inView: (x: number, z: number) => boolean, shadows: Float32Array): void {
    const set = this.set;
    if (!set) return;
    const started = performance.now();
    const { prev, curr, alpha, layout, now } = frame;
    let dt = this.lastNow ? (now - this.lastNow) / 1000 : 0;
    this.lastNow = now;
    if (dt > 0.1) dt = 0.1;
    if (dt < 0) dt = 0;
    const speed = curr[layout.header.speed] | 0;
    const quiet = layout.header.calm !== undefined && curr[layout.header.calm] > 0;
    const gameSpeed = quiet ? Math.max(speed, QUIET_SPEED) : speed;
    const gameRate = GAME_RATE[gameSpeed] ?? 1;
    const animRate = this.debugRate ?? Math.min(gameRate, 2.5);
    // Paused (the pause button, Buy and Build mode, menus): everyone freezes mid-motion, walk
    // cycles, breathing, blinks and glances included.
    if (gameSpeed === 0 && this.debugRate === null) dt = 0;
    this.clock += dt;
    const time = this.clock;
    const count = Math.min(curr[layout.header.simCount], MAX_CHARACTERS);
    const H = layout.headerLen;
    const S = layout.simStride;
    const k = layout.sim;
    const NB = set.bones.length;
    if (layout.actions && layout.actions !== this.actionTags) this.actionTags = layout.actions;
    const hasAction = k.action !== undefined && k.object !== undefined;

    for (let i = 0; i < count; i++) {
      const rig = this.sims[i];
      const o = H + i * S;
      const cx = curr[o + k.x];
      const cz = curr[o + k.z];
      let tx = cx;
      let tz = cz;
      let tyaw = curr[o + k.yaw];
      if (Math.abs(cx - prev[o + k.x]) + Math.abs(cz - prev[o + k.z]) < SNAP_DISTANCE) {
        tx = prev[o + k.x] + (cx - prev[o + k.x]) * alpha;
        tz = prev[o + k.z] + (cz - prev[o + k.z]) * alpha;
        tyaw = lerpAngle(prev[o + k.yaw], tyaw, alpha);
      }
      const show = !!rig && curr[o + k.away] === 0 && inView(tx, tz);
      if (!rig || !show) {
        if (this.visible[i]) {
          this.data.fill(0, this.row(i), this.row(i) + NB * 16);
          shadows.fill(0, i * 16, i * 16 + 16);
          for (const b of this.blankets.values()) b.matrices.fill(0, i * 16, i * 16 + 16);
        }
        if (rig) rig.cover = 0;
        this.visible[i] = 0;
        if (rig) rig.visible = false;
        continue;
      }
      const dir = (rig.dir = this.directions[i] ?? null);
      const pose = curr[o + k.pose];
      const moving = curr[o + k.moving] > 0;
      const social = curr[o + k.anim] | 0;
      const role = curr[o + k.role] | 0;
      const partner = curr[o + k.partner] | 0;
      const outcome = curr[o + k.outcome] | 0;
      rig.emotion = curr[o + k.emotion] | 0;
      const mood = k.mood !== undefined ? curr[o + k.mood] : 1;
      rig.warmth = clamp((mood - MOOD_COLD) / (MOOD_WARM - MOOD_COLD), 0, 1);
      // What the Sim is doing (sim-core's `object` / `action` fields; older layouts: guessed from position).
      let useObj: PlacedObject | null | undefined;
      let tag = '';
      if (hasAction) {
        const objId = curr[o + k.object];
        const act = curr[o + k.action];
        useObj = objId >= 0 ? (this.objectById.get(objId) ?? null) : null;
        tag = act >= 0 ? (this.actionTags[act | 0] ?? '') : '';
      }

      // Position / speed / facing.
      if (!rig.visible) {
        rig.x = tx;
        rig.z = tz;
        rig.yaw = tyaw;
        rig.speed = 0;
        rig.lastPose = pose;
      }
      const dx = tx - rig.x;
      const dz = tz - rig.z;
      const dist = Math.hypot(dx, dz);
      if (dt > 0) {
        const inst = dist / dt;
        rig.speed += (Math.min(inst, 20) - rig.speed) * (1 - Math.exp(-dt * 10));
      }
      if (moving || dist > SNAP_DISTANCE || !rig.visible) {
        rig.x = tx;
        rig.z = tz;
      } else {
        // Settle into seats / beds / next to objects instead of popping.
        const f = 1 - Math.exp(-dt * 9);
        rig.x += dx * f;
        rig.z += dz * f;
      }
      let faceYaw = tyaw;
      const partnerRig = partner >= 0 && partner < count ? this.sims[partner] : null;
      if (social && partnerRig && partnerRig.visible && !moving && pose === Pose.Stand) {
        faceYaw = Math.atan2(partnerRig.x - rig.x, partnerRig.z - rig.z);
      }
      const dyaw = wrapAngle(faceYaw - rig.yaw);
      const maxTurn = (moving ? 9 : 6) * dt;
      rig.yaw = dir ? wrapAngle(faceYaw) : wrapAngle(rig.yaw + clamp(dyaw * (1 - Math.exp(-dt * 12)), -maxTurn, maxTurn));
      rig.visible = true;
      this.visible[i] = 1;

      // Activity → clip.
      this.choose(rig, i, pose, moving, social, role, outcome, partnerRig, time, dt * animRate, useObj, tag);
      rig.lastPose = pose;

      // Advance and blend.
      const step = dt * animRate;
      advance(rig.cur, rig.cur.key === 'walk' || rig.cur.key === 'jog' ? dt : step);
      advance(rig.prev, rig.prev.key === 'walk' || rig.prev.key === 'jog' ? dt : step);
      advance(rig.upper, step);
      rig.w = Math.min(1, rig.w + dt * rig.fadeRate * Math.max(1, animRate));
      rig.upperW += clamp(rig.upperTarget - rig.upperW, -dt * 4, dt * 4);
      if (dir?.still) {
        rig.cur.time = dir.time ?? rig.cur.time;
        rig.w = 1;
        rig.upperW = 0;
      }

      sampleClip(set, rig.cur.clip!, rig.cur.time, this.qA, this.pA);
      const w = smooth(rig.w);
      if (w < 1 && rig.prev.clip) {
        sampleClip(set, rig.prev.clip, rig.prev.time, this.qB, this.pB);
        blendInto(this.qB, this.pB, this.qA, this.pA, w, null);
        this.qA.set(this.qB);
        this.pA.set(this.pB);
      }
      if (rig.upperW > 0.001 && rig.upper.clip) {
        sampleClip(set, rig.upper.clip, rig.upper.time, this.qB, this.pB);
        blendInto(this.qA, this.pA, this.qB, this.pB, smooth(rig.upperW), this.upperMask);
      }

      if (this.force === 'rest') {
        this.qA.set(set.sourceRestQ);
        this.pA.set(set.sourcePelvis);
      }
      // Lying: straight legs (the clip is the standing idle turned flat).
      const lieW = (rig.cur.key === 'lie' ? w : 0) + (rig.prev.key === 'lie' ? 1 - w : 0);
      if (lieW > 0) blendInto(this.qA, this.pA, set.sourceRestQ, this.pA, lieW * 0.9, this.legMask);
      // Pyjamas in bed.
      const asleep = pose === Pose.Lie && rig.cur.key === 'lie' && w > 0.5 && (!rig.tagKnown || rig.tag === 'sleep' || rig.tag === 'nap');
      if (asleep !== rig.asleep && rig.day && rig.night) {
        rig.asleep = asleep;
        writeOutfit(asleep ? rig.night : rig.day, this.data, this.row(i) + NB * 16);
      }
      // Hand pose: the clips clench fists; open them according to the activity.
      blendInto(this.qA, this.pA, set.sourceRestQ, this.pA, rig.hands, this.fingerMask);

      // Procedural layers.
      resetAdditive(this.add);
      this.procedural(rig, i, social, role, partnerRig, pose, moving, time, dt);

      // Placement (root offsets blend with the clips).
      const rootY = lerp(rig.prev.rootY, rig.cur.rootY, w);
      const rootFwd = lerp(rig.prev.rootFwd, rig.cur.rootFwd, w) + rig.approach;
      const pitch = lerp(rig.prev.rootPitch, rig.cur.rootPitch, w);
      const sy = Math.sin(rig.yaw / 2);
      const cyw = Math.cos(rig.yaw / 2);
      const sp = Math.sin(pitch / 2);
      const cp = Math.cos(pitch / 2);
      // q = yaw(Y) * pitch(X)
      const pl = this.place;
      pl.qx = cyw * sp;
      pl.qy = sy * cp;
      pl.qz = -sy * sp;
      pl.qw = cyw * cp;
      pl.x = rig.x + Math.sin(rig.yaw) * rootFwd;
      pl.y = rootY;
      pl.z = rig.z + Math.cos(rig.yaw) * rootFwd;
      pl.scale = rig.scale;
      skin(set, rig.body, this.qA, this.pA, this.add, pl, this.scratch, this.data, this.row(i), this.headTmp);
      this.writeBlanket(rig, i, pose, dt);

      // Head top (speech bubbles, selection marker): a little above the head joint.
      const hs = rig.scale;
      this.heads[i * 3] = this.headTmp[0];
      this.heads[i * 3 + 1] = this.headTmp[1] + 0.26 * hs;
      this.heads[i * 3 + 2] = this.headTmp[2];

      // Contact shadow under standing / sitting Sims.
      const r = pose === Pose.Lie ? 0 : 0.62 * hs;
      const m = i * 16;
      shadows.fill(0, m, m + 16);
      shadows[m] = r;
      shadows[m + 5] = 1;
      shadows[m + 10] = r;
      shadows[m + 12] = rig.x;
      shadows[m + 13] = 0.02;
      shadows[m + 14] = rig.z;
      shadows[m + 15] = 1;
    }
    if (this.ghosts.length) this.poseGhosts(count, dt, time);
    this.writeRing(now * 0.001);
    for (let i = count + this.ghosts.length; i < MAX_CHARACTERS; i++) {
      if (!this.visible[i]) continue;
      this.visible[i] = 0;
      this.data.fill(0, this.row(i), this.row(i) + NB * 16);
      shadows.fill(0, i * 16, i * 16 + 16);
    }
    for (const b of this.blankets.values()) {
      b.mesh.thinInstanceBufferUpdated('matrix');
      b.mesh.thinInstanceBufferUpdated('blanketExt');
    }
    this.texture.update(this.data);
    this.updateMs += (performance.now() - started - this.updateMs) * 0.1;
  }

  // --- activity ------------------------------------------------------------------------

  /**
   * Picks the clip for this frame and starts a crossfade when it changes. `useObj` / `tag` come
   * from the snapshot (`undefined` with older layouts: the object is guessed from the position).
   */
  private choose(
    rig: SimRig,
    i: number,
    pose: number,
    moving: boolean,
    social: number,
    role: number,
    outcome: number,
    partner: SimRig | null,
    time: number,
    step: number,
    useObj: PlacedObject | null | undefined,
    tag: string,
  ): void {
    const pair = partner ? Math.min(i, partner.id) : i;
    const set = this.set!;
    const known = useObj !== undefined;
    const act = ACTIONS[tag];
    rig.tag = tag;
    rig.tagKnown = known;
    rig.actTime += step;
    rig.stepTime += step;
    let key = 'idle';
    let rootY = 0;
    let rootFwd = 0;
    let pitch = 0;
    let repeat = false;
    let fade = DEFAULT_FADE;
    let upper = '';
    let rate = 1;
    let hands: number = act?.hands ?? HANDS.relaxed;
    // Step towards a partner (hugs, kisses, fights): eased towards `reach` at `reachRate`.
    let reach = 0;
    let reachRate = 4;

    if (this.force) {
      key = this.force;
    } else if (pose === Pose.Lie) {
      const obj = (known ? useObj : null) ?? this.objectAt(rig.x, rig.z);
      const bed = (obj && BEDS[obj.def]) || DEFAULT_BED;
      rig.bed = obj;
      rig.bedH = bed.h;
      rig.useDef = obj?.def ?? '';
      if ((rig.lastPose === Pose.Stand && rig.cur.key !== 'sitDown') || (rig.cur.key === 'sitDown' && rig.cur.time < rig.cur.clip!.duration - 0.35)) {
        // Getting in: sit down on the edge first; the crossfade to lying then leans the Sim back
        // (the root pitch blends with the clips).
        const sp = this.sitPelvis.get(rig.body.name)!;
        key = 'sitDown';
        rootY = bed.h - sp.y * rig.scale;
        rootFwd = LIE_ENTRY * rig.scale - sp.z * rig.scale;
        fade = 0.35;
        if (rig.cur.key !== 'sitDown') rig.actTime = 0;
      } else {
        // On the back, head towards the head of the bed (local -z), centred on the slot: the
        // relaxed standing idle rotated flat, slowed down, with breathing on top.
        key = 'lie';
        rootY = bed.h + LIE_BACK * rig.scale;
        rootFwd = LIE_CENTRE * rig.scale;
        pitch = -Math.PI / 2;
        rate = 0.3;
        fade = rig.cur.key === 'sitDown' ? 0.9 : 0.45;
        // (Where it lies, for getting up: by then the Sim has already moved off the bed.)
        rig.lieX = rig.x;
        rig.lieZ = rig.z;
      }
      hands = tag === 'lift' ? HANDS.grip : HANDS.open;
    } else if (pose === Pose.Sit) {
      const obj = (known ? useObj : null) ?? this.objectAt(rig.x, rig.z);
      const seat = (obj && SEATS[obj.def]) || DEFAULT_SEAT;
      const sp = this.sitPelvis.get(rig.body.name)!;
      rootY = seat.h - sp.y * rig.scale;
      rootFwd = seat.fwd - sp.z * rig.scale;
      fade = 0.35;
      rig.useDef = obj?.def ?? '';
      if (social) key = speaking(pair, role, time) ? 'sitTalk' : 'sit';
      else if (act?.sit) key = typeof act.sit === 'function' ? act.sit(rig.useDef) : act.sit;
      else if (!known && obj && SIT_HANDS.has(obj.def)) key = 'sitHands';
      else key = 'sit';
      if (rig.lastPose === Pose.Stand && rig.cur.key !== 'sitDown') {
        key = 'sitDown';
        rig.actTime = 0;
      } else if (rig.cur.key === 'sitDown' && rig.cur.time < rig.cur.clip!.duration - 0.3) {
        key = 'sitDown';
      }
      if (!social) {
        const up = known ? act?.upper : obj?.def === 'diningTable' ? 'eat' : undefined;
        // Eating / drinking now and then; holding a book or phone throughout.
        if (up === 'eat') upper = Math.floor((rig.actTime + rig.seed * 9) / 4) % 3 === 0 ? 'eat' : '';
        else if (up) upper = up;
      }
    } else if (moving) {
      key = 'walk';
      const clip = set.clips.get('walk')!;
      rate = clamp(rig.speed / (clip.speed * rig.body.pelvisScale * rig.scale), 0.35, 3);
      fade = 0.2;
      hands = HANDS.relaxed;
    } else if (social) {
      const me = speaking(pair, role, time);
      hands = HANDS.relaxed;
      switch (social) {
        case Anim.Talk:
          key = me
            ? 'talk'
            : outcome === 1 && hash(Math.floor(time / 3) + i) < 0.4
              ? 'yes'
              : outcome === 2 && hash(Math.floor(time / 3) + i) < 0.4
                ? 'no'
                : 'idle';
          break;
        case Anim.Laugh:
          key = 'talk';
          break;
        case Anim.Flirt:
          key = me ? 'talk' : 'idle';
          break;
        case Anim.Argue:
          key = me ? 'talk' : 'no';
          rate = 1.25;
          break;
        case Anim.Fight: {
          // The attacker steps in with each punch, the defender gives ground as it lands
          // (eased like the hug's approach).
          const beat = (time * 1.1) % 1;
          const lunge = Math.sin(beat * Math.PI);
          reach = role === 1 ? 0.04 + 0.1 * lunge : -0.03 - 0.09 * lunge;
          reachRate = 8;
          key = role === 1 ? (Math.floor(time * 1.1) % 2 ? 'punchCross' : 'punchJab') : 'hit';
          repeat = true;
          hands = HANDS.grip;
          break;
        }
        case Anim.Hug:
          // Arms around each other: `procedural`.
          key = 'idle';
          reach = 0.33;
          reachRate = 6;
          break;
        case Anim.Kiss:
          key = 'idle';
          reach = 0.22;
          reachRate = 6;
          break;
        default:
          key = me ? 'talk' : 'idle';
      }
      if (social !== Anim.Talk && social !== Anim.Fight) rig.actTime = 0;
    } else {
      // Standing object use: the action's clip sequence (or, without action data, the object in front).
      const obj = known ? useObj : this.objectInFront(rig);
      rig.useDef = obj?.def ?? '';
      const seq = known
        ? act?.stand
          ? typeof act.stand === 'function'
            ? act.stand(useObj?.def ?? '')
            : act.stand
          : undefined
        : obj
          ? USE[obj.def]
          : undefined;
      const useKey = seq ? `${tag}:${obj?.def ?? ''}` : '';
      if (seq && seq.length) {
        if (rig.useKey !== useKey) {
          rig.useKey = useKey;
          rig.useSeq = seq;
          rig.seq = 0;
          rig.actTime = 0;
          rig.stepTime = 0;
        }
        key = seq[rig.seq % seq.length];
        repeat = true;
        if (tag === 'exercise' && obj && (rig.useDef.includes('trampoline') || rig.useDef.includes('vibe'))) {
          // Up on the equipment (Sims use it from the tile in front): forward to its centre.
          rootFwd = Math.hypot(obj.cx - rig.x, obj.cz - rig.z);
          if (rig.useDef.includes('trampoline')) {
            // Bouncing on the mat: the feet leave it for a little under half of each bounce.
            const b = Math.sin(((rig.actTime * 1.6) % 1) * Math.PI);
            rootY = TRAMPOLINE_MAT + Math.max(0, b * 0.75 - 0.3) * 0.55;
          } else {
            // On the vibration plate: a fine buzz.
            rootY = VIBE_PLATE + Math.sin(rig.actTime * 90) * 0.004;
          }
        }
      } else {
        rig.useKey = '';
        rig.useSeq = null;
        // Idle with occasional variations.
        const phase = Math.floor((rig.actTime + rig.seed * 20) / 9);
        const r = hash(phase * 7 + i);
        key = rig.actTime < 6 ? 'idle' : r < 0.18 ? 'foldArms' : 'idle';
        if (!tag || tag === 'idle') hands = HANDS.rest;
      }
    }
    rig.approach += (reach - rig.approach) * Math.min(1, step * reachRate);
    const dir = rig.dir;
    if (dir?.clip) {
      key = dir.clip;
      repeat = false;
      fade = 0.3;
      rate = 1;
      upper = '';
    }
    if (dir?.hands !== undefined) hands = dir.hands;
    if (!moving && pose === Pose.Stand && (rig.lastPose === Pose.Sit || rig.lastPose === Pose.Lie) && rig.cur.key !== 'standUp' && !this.force) {
      // Rising from a seat (or sitting up out of bed: the crossfade from lying leans the Sim up).
      key = 'standUp';
      rig.fromBed = rig.lastPose === Pose.Lie && !!rig.bed;
      if (rig.fromBed) fade = 0.9;
    } else if (rig.cur.key === 'standUp' && !moving && pose === Pose.Stand && rig.cur.time < rig.cur.clip!.duration - 0.25) {
      key = 'standUp';
    }
    if (key !== 'standUp') rig.fromBed = false;
    const fx = Math.sin(rig.yaw);
    const fz = Math.cos(rig.yaw);
    if (rig.fromBed && rig.bed) {
      // Sitting on the foot of the bed, then stepping forward onto the Sim's tile while rising.
      const bed = rig.bed;
      const half = (Math.abs(fx) * (bed.maxX - bed.minX) + Math.abs(fz) * (bed.maxZ - bed.minZ)) / 2;
      const edge = (bed.cx - rig.x) * fx + (bed.cz - rig.z) * fz + half - 0.22 * rig.scale;
      const t = rig.cur.key === 'standUp' ? rig.cur.time / rig.cur.clip!.duration : 0;
      rootFwd = edge * (1 - smooth(clamp((t - 0.3) / 0.6, 0, 1)));
    }
    rig.hands += (hands - rig.hands) * Math.min(1, step * 5 + 0.02);

    // Sequenced object use: the next clip when a one-shot ends, or after LOOP_STEP for loops.
    const cur = rig.cur;
    const seq = rig.useSeq;
    const done = cur.clip && (cur.clip.loop ? rig.stepTime >= Math.max(LOOP_STEP, cur.clip.duration) : cur.time >= cur.clip.duration - 0.2);
    if (cur.key === key && repeat && seq && done) {
      rig.seq++;
      rig.stepTime = 0;
      key = seq[rig.seq % seq.length];
      // The same one-shot again restarts it (crossfaded); a loop simply continues.
      if (key !== cur.key || !cur.clip!.loop) this.start(rig, key, 0.3, rate, repeat, rootY, rootFwd, pitch);
    } else if (cur.key === key && repeat && done && !cur.clip!.loop) {
      // Repeated one-shots (fights).
      this.start(rig, key, 0.3, rate, repeat, rootY, rootFwd, pitch);
    } else if (cur.key !== key) {
      rig.stepTime = 0;
      this.start(rig, key, fade, rate, repeat, rootY, rootFwd, pitch);
    } else {
      cur.rate = rate;
      cur.rootY = rootY;
      cur.rootFwd = rootFwd;
      cur.rootPitch = pitch;
    }

    if (rig.fromBed && rig.prev.key === 'lie') rig.prev.rootFwd = (rig.lieX - rig.x) * fx + (rig.lieZ - rig.z) * fz + LIE_CENTRE * rig.scale;

    // Upper-body layer.
    if (upper) {
      if (rig.upper.key !== upper) {
        rig.upper.key = upper;
        rig.upper.clip = this.clip(upper);
        rig.upper.time = 0;
        rig.upper.rate = 1;
      }
      rig.upperTarget = 1;
    } else {
      rig.upperTarget = 0;
    }
  }

  private clip(key: string): Clip {
    const set = this.set!;
    const name = CLIP_OF[key] ?? key;
    return set.clips.get(name) ?? set.clips.get(CLIP_FALLBACK[name] ?? 'idle') ?? set.clips.get('idle')!;
  }

  /** Length (s) of the clip played for `key` (0 before the set has loaded). */
  clipDuration(key: string): number {
    return this.set ? this.clip(key).duration : 0;
  }

  private start(rig: SimRig, key: string, fade: number, rate: number, repeat: boolean, rootY: number, rootFwd: number, pitch: number): void {
    const clip = this.clip(key);
    // The fading-out player continues from the current blend.
    if (rig.w < 0.5 && rig.prev.clip) {
      // Mostly still the old one: keep it, replace the incoming.
    } else {
      copyPlayer(rig.cur, rig.prev);
    }
    const c = rig.cur;
    const sameLoop = c.key === key && clip.loop;
    c.clip = clip;
    c.key = key;
    // Walk cycles of the previous walk keep their phase.
    c.time = sameLoop ? c.time : key === 'idle' || key === 'sit' ? (rig.seed * 7) % clip.duration : 0;
    c.rate = rate;
    c.repeat = repeat;
    c.rootY = rootY;
    c.rootFwd = rootFwd;
    c.rootPitch = pitch;
    if (!rig.prev.clip) copyPlayer(c, rig.prev);
    rig.w = 0;
    rig.fadeRate = 1 / Math.max(0.05, fade);
  }

  /** Look-at, laughing, flirting and kissing on top of the clips. */
  private procedural(
    rig: SimRig,
    i: number,
    social: number,
    role: number,
    partner: SimRig | null,
    pose: number,
    moving: boolean,
    time: number,
    dt: number,
  ): void {
    const set = this.set!;
    const B = set.bone;
    const add = this.add;
    // Look at the conversation partner (head and neck turn, limited).
    let wantYaw = 0;
    let wantPitch = 0;
    const dir = rig.dir;
    if (dir?.lookAt) {
      // Directed: the head turns partway towards the point (the eyes do the rest).
      const dx = dir.lookAt.x - this.heads[i * 3];
      const dz = dir.lookAt.z - this.heads[i * 3 + 2];
      const dy = dir.lookAt.y - this.heads[i * 3 + 1];
      wantYaw = clamp(wrapAngle(Math.atan2(dx, dz) - rig.yaw), -1.1, 1.1) * 0.45;
      wantPitch = clamp(-Math.atan2(dy, Math.hypot(dx, dz)), -0.4, 0.4) * 0.45;
    } else if (dir?.still) {
      // Portraits: straight ahead.
    } else if (social && partner && partner.visible && pose !== Pose.Lie) {
      const ph = partner.id * 3;
      const dx = this.heads[ph] - this.heads[i * 3];
      const dz = this.heads[ph + 2] - this.heads[i * 3 + 2];
      const dy = this.heads[ph + 1] - this.heads[i * 3 + 1];
      wantYaw = clamp(wrapAngle(Math.atan2(dx, dz) - rig.yaw), -1.1, 1.1);
      wantPitch = clamp(-Math.atan2(dy, Math.hypot(dx, dz)), -0.4, 0.4);
    } else if (!moving && pose !== Pose.Lie && !this.force) {
      // Idle glances.
      const g = Math.floor(time / 3.7 + rig.seed * 5);
      wantYaw = (hash(g * 13 + i) - 0.5) * 0.9 * (hash(g * 5 + i) < 0.5 ? 1 : 0);
    }
    const f = dir?.still ? 1 : 1 - Math.exp(-dt * 5);
    rig.lookYaw += (wantYaw - rig.lookYaw) * f;
    rig.lookPitch += (wantPitch - rig.lookPitch) * f;
    if (Math.abs(rig.lookYaw) > 1e-3) {
      addRotation(add, B.neck_01, 0, 1, 0, rig.lookYaw * 0.4);
      addRotation(add, B.Head, 0, 1, 0, rig.lookYaw * 0.6);
    }
    if (Math.abs(rig.lookPitch) > 1e-3) addRotation(add, B.Head, 1, 0, 0, rig.lookPitch * 0.7);

    // Posture: the clips stand slightly hunched; Sims stand tall (and lean back when seated).
    if (pose !== Pose.Lie && this.force !== 'rest') {
      addRotation(add, B.spine_03, 1, 0, 0, -0.09);
      addRotation(add, B.neck_01, 1, 0, 0, -0.07);
      addRotation(add, B.Head, 1, 0, 0, -0.07);
      // Arms closer to the body and a narrower stance than the clips' athletic ones.
      addRotation(add, B.upperarm_l, 0, 0, 1, 0.13);
      addRotation(add, B.upperarm_r, 0, 0, 1, -0.13);
      if (pose === Pose.Stand && !moving) {
        addRotation(add, B.thigh_l, 0, 0, 1, 0.04);
        addRotation(add, B.thigh_r, 0, 0, 1, -0.04);
      }
      this.stance(rig, i, pose, moving, time, dt);
      if (rig.cur.key === 'sitHands') {
        // Hands down onto the desk / keys (the clip holds them high).
        addRotation(add, B.upperarm_l, 1, 0, 0, 0.22);
        addRotation(add, B.upperarm_r, 1, 0, 0, 0.22);
      }
      if (pose === Pose.Sit && rig.cur.key === 'sit') {
        addRotation(add, B.spine_01, 1, 0, 0, -0.16);
        addRotation(add, B.Head, 1, 0, 0, -0.08);
      }
    }
    switch (social) {
      case Anim.Laugh: {
        // Natural laughter: body bounces, head tilts, shoulders shake.
        const bounce = Math.sin(time * 8 + rig.seed * 5) * 0.04;
        addRotation(add, B.spine_02, 1, 0, 0, -0.15 + bounce);
        addRotation(add, B.spine_01, 1, 0, 0, -0.08 + bounce * 0.5);
        addRotation(add, B.Head, 1, 0, 0, -0.2 + bounce * 0.7);
        // Shoulder shake.
        addRotation(add, B.upperarm_l, 1, 0, 0, Math.sin(time * 10 + rig.seed * 3) * 0.05);
        addRotation(add, B.upperarm_r, 1, 0, 0, -Math.sin(time * 10 + rig.seed * 3) * 0.05);
        break;
      }
      case Anim.Flirt:
        addRotation(add, B.Head, 0, 0, 1, 0.16 + Math.sin(time * 1.7) * 0.04);
        addRotation(add, B.pelvis, 0, 0, 1, Math.sin(time * 1.3) * 0.04);
        break;
      case Anim.Kiss:
        addRotation(add, B.spine_02, 1, 0, 0, 0.12);
        addRotation(add, B.Head, 0, 0, 1, role === 1 ? 0.22 : -0.22);
        addRotation(add, B.Head, 1, 0, 0, 0.1);
        break;
      case Anim.Hug: {
        addRotation(add, B.spine_02, 1, 0, 0, 0.1);
        addRotation(add, B.Head, 0, 1, 0, role === 1 ? 0.5 : -0.5);
        // Arms around the other: raised forward (one Sim over the shoulders, the other a little
        // lower, around the back), elbows wrapping in; a slow squeeze.
        // (Model space: +z forward, the left arm on -x; x rotations raise / bend both sides alike.)
        // (Spread first, then raise: the other order would only roll the raised arm.)
        const squeeze = Math.sin(time * 1.5 + role) * 0.05;
        const raise = role === 1 ? 1.3 : 1.05;
        addRotation(add, B.upperarm_l, 0, 0, 1, -0.35);
        addRotation(add, B.upperarm_r, 0, 0, 1, 0.35);
        addRotation(add, B.upperarm_l, 1, 0, 0, -raise);
        addRotation(add, B.upperarm_r, 1, 0, 0, -raise);
        addRotation(add, B.lowerarm_l, 0, 1, 0, 0.95 + squeeze);
        addRotation(add, B.lowerarm_r, 0, 1, 0, -0.95 - squeeze);
        break;
      }
      case Anim.Argue:
        addRotation(add, B.spine_03, 1, 0, 0, 0.08);
        break;
      case Anim.Fight: {
        const isAttacker = role === 1;
        if (isAttacker) {
          // Attacker: body leans forward into punches.
          addRotation(add, B.spine_02, 1, 0, 0, 0.15);
          addRotation(add, B.spine_01, 1, 0, 0, 0.1);
        } else {
          // Defender: flinch back, forearms up to guard the face.
          addRotation(add, B.spine_02, 1, 0, 0, -0.12);
          addRotation(add, B.upperarm_l, 1, 0, 0, -0.45);
          addRotation(add, B.upperarm_r, 1, 0, 0, -0.45);
          addRotation(add, B.lowerarm_l, 1, 0, 0, -1.5);
          addRotation(add, B.lowerarm_r, 1, 0, 0, -1.5);
        }
        break;
      }
    }
    if (!social && !this.force && !dir?.clip) this.activityPose(rig, pose, time);
    // Sleeping: slow breathing, hands resting on the belly, head turned a little to one side.
    if (pose === Pose.Lie && rig.cur.key === 'lie' && rig.tag === 'lift') {
      // Bench press: arms push the bar up and lower it to the chest.
      const press = 0.5 - 0.5 * Math.cos(time * 2.2 + rig.seed * 6);
      for (const [ua, la, sgn] of [
        [B.upperarm_l, B.lowerarm_l, 1],
        [B.upperarm_r, B.lowerarm_r, -1],
      ] as const) {
        addRotation(add, ua, 0, 0, 1, sgn * 0.55);
        addRotation(add, ua, 1, 0, 0, -1.2 - press * 0.35);
        addRotation(add, la, 1, 0, 0, -1.4 + press * 1.3);
      }
    } else if (pose === Pose.Lie && rig.cur.key === 'lie') {
      const asleep = rig.tag === 'sleep' || rig.tag === 'nap';
      const breathe = Math.sin(time * 1.2 + rig.seed * 6) * 0.035;
      // Chest and belly expansion (breathing).
      addRotation(add, B.spine_02, 1, 0, 0, breathe);
      addRotation(add, B.spine_01, 1, 0, 0, breathe * 0.6);
      // Arms: rest at sides with slight bend, occasional shift.
      const armShift = Math.sin(time * 0.3 + rig.seed * 10) * 0.04;
      addRotation(add, B.upperarm_l, 0, 0, 1, 0.35 + armShift);
      addRotation(add, B.upperarm_r, 0, 0, 1, -0.35 - armShift);
      addRotation(add, B.lowerarm_l, 1, 0, 0, 0.4 + Math.sin(time * 0.5 + rig.seed * 3) * 0.05);
      addRotation(add, B.lowerarm_r, 1, 0, 0, 0.4 + Math.sin(time * 0.5 + rig.seed * 3 + 1) * 0.05);
      // Head turns slowly to one side (asleep = deeper, less movement).
      const headTurn = (rig.seed - 0.5) * 0.7 * (asleep ? 1 : 1.5);
      addRotation(add, B.Head, 0, 1, 0, headTurn + Math.sin(time * 0.2 + rig.seed * 8) * 0.02);
      // Subtle leg adjustment for more natural lying.
      if (!asleep) {
        const legShift = Math.sin(time * 0.25 + rig.seed * 7) * 0.03;
        addRotation(add, B.thigh_l, 1, 0, 0, legShift);
        addRotation(add, B.thigh_r, 1, 0, 0, -legShift);
      }
    }
    dir?.pose?.(add, B, time);
    this.animateFace(rig, i, social, role, partner, pose, moving, time, dt);
  }

  /**
   * Procedural layers for activities the clips only approximate: reclining, instruments,
   * meditation, gazes at plants and trees, and exercise equipment. Model space: +z is forward,
   * the left limbs are on -x; a negative x rotation raises an arm forward (or bends an elbow /
   * knee forward), on both sides alike.
   */
  private activityPose(rig: SimRig, pose: number, time: number): void {
    const B = this.set!.bone;
    const add = this.add;
    const def = rig.useDef;
    const key = rig.cur.key;
    const seed = rig.seed * 6;
    if (pose === Pose.Sit && key !== 'sitDown') {
      switch (rig.tag) {
        case 'relax':
        case 'nap':
        case 'watch':
          // Sinking back into the seat, legs stretched out a little, arms on the armrests.
          addRotation(add, B.spine_01, 1, 0, 0, -0.14);
          addRotation(add, B.Head, 1, 0, 0, 0.1);
          addRotation(add, B.calf_l, 1, 0, 0, -0.35);
          addRotation(add, B.calf_r, 1, 0, 0, -0.3);
          addRotation(add, B.upperarm_l, 0, 0, 1, -0.18);
          addRotation(add, B.upperarm_r, 0, 0, 1, 0.18);
          break;
        case 'bath': {
          // Leaning back against the end of the tub, arms along the rim.
          addRotation(add, B.spine_01, 1, 0, 0, -0.3);
          addRotation(add, B.Head, 1, 0, 0, 0.2);
          addRotation(add, B.upperarm_l, 0, 0, 1, -0.95);
          addRotation(add, B.upperarm_r, 0, 0, 1, 0.95);
          addRotation(add, B.lowerarm_l, 1, 0, 0, -0.15);
          addRotation(add, B.lowerarm_r, 1, 0, 0, -0.15);
          break;
        }
        case 'toilet':
          // Leaning forward, forearms on the thighs.
          addRotation(add, B.spine_01, 1, 0, 0, 0.3);
          addRotation(add, B.Head, 1, 0, 0, -0.15);
          addRotation(add, B.upperarm_l, 1, 0, 0, -0.35);
          addRotation(add, B.upperarm_r, 1, 0, 0, -0.35);
          addRotation(add, B.lowerarm_l, 1, 0, 0, -0.8);
          addRotation(add, B.lowerarm_r, 1, 0, 0, -0.8);
          break;
        case 'meditate': {
          // Cross-legged and upright, hands resting on the knees, slow deep breaths.
          const breath = Math.sin(time * 0.8 + seed) * 0.025;
          addRotation(add, B.spine_01, 1, 0, 0, 0.18 + breath);
          addRotation(add, B.spine_02, 1, 0, 0, -breath);
          addRotation(add, B.Head, 1, 0, 0, 0.06);
          addRotation(add, B.thigh_l, 0, 1, 0, -0.75);
          addRotation(add, B.thigh_r, 0, 1, 0, 0.75);
          addRotation(add, B.calf_l, 0, 0, 1, 1.25);
          addRotation(add, B.calf_r, 0, 0, 1, -1.25);
          addRotation(add, B.upperarm_l, 0, 0, 1, -0.4);
          addRotation(add, B.upperarm_r, 0, 0, 1, 0.4);
          addRotation(add, B.upperarm_l, 1, 0, 0, -0.3);
          addRotation(add, B.upperarm_r, 1, 0, 0, -0.3);
          addRotation(add, B.lowerarm_l, 1, 0, 0, -0.1);
          addRotation(add, B.lowerarm_r, 1, 0, 0, -0.1);
          break;
        }
        case 'read':
          addRotation(add, B.Head, 1, 0, 0, 0.18);
          break;
        case 'music':
          if (def.includes('cello')) {
            // Knees apart around the body of the cello, the left hand up on its neck, the right
            // drawing the bow back and forth.
            const bow = Math.sin(time * 2.2 + seed);
            addRotation(add, B.thigh_l, 0, 1, 0, -0.35);
            addRotation(add, B.thigh_r, 0, 1, 0, 0.35);
            addRotation(add, B.upperarm_l, 1, 0, 0, -0.95);
            addRotation(add, B.upperarm_l, 0, 0, 1, -0.25);
            addRotation(add, B.lowerarm_l, 1, 0, 0, -1.3);
            addRotation(add, B.lowerarm_l, 0, 1, 0, 0.6);
            addRotation(add, B.upperarm_r, 1, 0, 0, -0.55);
            addRotation(add, B.upperarm_r, 0, 0, 1, 0.45 + bow * 0.12);
            addRotation(add, B.lowerarm_r, 1, 0, 0, -0.9);
            addRotation(add, B.lowerarm_r, 0, 1, 0, -0.7 - bow * 0.45);
            addRotation(add, B.Head, 0, 0, 1, 0.12);
          } else if (def.includes('drum')) {
            // Sticks: the forearms strike in turn.
            const l = Math.max(0, Math.sin(time * 9 + seed));
            const r = Math.max(0, Math.sin(time * 9 + seed + Math.PI));
            addRotation(add, B.lowerarm_l, 1, 0, 0, -0.55 * l);
            addRotation(add, B.lowerarm_r, 1, 0, 0, -0.55 * r);
            addRotation(add, B.Head, 1, 0, 0, Math.sin(time * 4.5) * 0.05);
          } else {
            // Keys: swaying with the music.
            addRotation(add, B.spine_02, 0, 0, 1, Math.sin(time * 1.1 + seed) * 0.04);
          }
          break;
      }
      return;
    }
    if (pose !== Pose.Stand) return;
    switch (rig.tag) {
      case 'smell':
        // Nose down to the flowers.
        addRotation(add, B.spine_03, 1, 0, 0, 0.12);
        addRotation(add, B.Head, 1, 0, 0, 0.3);
        break;
      case 'admire':
        // Looking up into the crown.
        addRotation(add, B.spine_03, 1, 0, 0, -0.08);
        addRotation(add, B.neck_01, 1, 0, 0, -0.25);
        addRotation(add, B.Head, 1, 0, 0, -0.4 + Math.sin(time * 0.4 + seed) * 0.05);
        break;
      case 'talk':
      case 'look':
      case 'listen':
        // Talking to a plant, looking at a bird bath: eyes down to the object.
        if (def && def !== 'telescope' && key !== 'rail') addRotation(add, B.Head, 1, 0, 0, 0.2);
        break;
      case 'exercise':
        if (def.includes('boulder')) {
          // Climbing in place: the hands reach for holds overhead in turn, a knee comes up.
          const c = time * 1.4 + seed;
          const l = 0.5 + 0.5 * Math.sin(c);
          const r = 1 - l;
          addRotation(add, B.upperarm_l, 1, 0, 0, -2.2 - 0.5 * l);
          addRotation(add, B.upperarm_r, 1, 0, 0, -2.2 - 0.5 * r);
          addRotation(add, B.lowerarm_l, 1, 0, 0, -0.9 * r);
          addRotation(add, B.lowerarm_r, 1, 0, 0, -0.9 * l);
          addRotation(add, B.thigh_l, 1, 0, 0, -0.7 * r);
          addRotation(add, B.calf_l, 1, 0, 0, 1.0 * r);
          addRotation(add, B.thigh_r, 1, 0, 0, -0.7 * l);
          addRotation(add, B.calf_r, 1, 0, 0, 1.0 * l);
        } else if (def.includes('trampoline')) {
          // Arms swing up in the air, knees give on landing.
          const b = Math.sin(((rig.actTime * 1.6) % 1) * Math.PI);
          addRotation(add, B.upperarm_l, 0, 0, 1, -1.3 * b);
          addRotation(add, B.upperarm_r, 0, 0, 1, 1.3 * b);
          const land = Math.max(0, 0.45 - b);
          addRotation(add, B.thigh_l, 1, 0, 0, -0.8 * land);
          addRotation(add, B.thigh_r, 1, 0, 0, -0.8 * land);
          addRotation(add, B.calf_l, 1, 0, 0, 1.6 * land);
          addRotation(add, B.calf_r, 1, 0, 0, 1.6 * land);
          addRotation(add, B.foot_l, 1, 0, 0, -0.8 * land);
          addRotation(add, B.foot_r, 1, 0, 0, -0.8 * land);
        } else if (def.includes('vibe')) {
          // Knees soft on the vibrating plate, a little buzz through the body.
          const buzz = Math.sin(time * 70) * 0.012;
          addRotation(add, B.thigh_l, 1, 0, 0, -0.3);
          addRotation(add, B.thigh_r, 1, 0, 0, -0.3);
          addRotation(add, B.calf_l, 1, 0, 0, 0.6);
          addRotation(add, B.calf_r, 1, 0, 0, 0.6);
          addRotation(add, B.foot_l, 1, 0, 0, -0.3);
          addRotation(add, B.foot_r, 1, 0, 0, -0.3);
          addRotation(add, B.Head, 1, 0, 0, buzz);
        } else if (def.includes('sunrise')) {
          // A slow morning stretch: arms up overhead and down again.
          const up = smooth(0.5 - 0.5 * Math.cos(time * 0.9 + seed));
          addRotation(add, B.upperarm_l, 1, 0, 0, -2.7 * up);
          addRotation(add, B.upperarm_r, 1, 0, 0, -2.7 * up);
          addRotation(add, B.spine_02, 1, 0, 0, -0.12 * up);
          addRotation(add, B.Head, 1, 0, 0, -0.2 * up);
        }
        break;
    }
  }

  /**
   * Relaxed standing (see `STANCE`), faded in over a few tenths of a second on idle-based clips
   * and out again for walking, sitting, lying and object use, so it blends with every clip.
   */
  private stance(rig: SimRig, i: number, pose: number, moving: boolean, time: number, dt: number): void {
    const B = this.set!.bone;
    const add = this.add;
    const standing = pose === Pose.Stand && !moving && !this.force;
    const legs = standing && RELAX_LEGS.has(rig.cur.key) ? 1 : 0;
    const arms = standing && RELAX_ARMS.has(rig.cur.key) && !(rig.upperW > 0.05) ? 1 : 0;
    const f = rig.dir?.still ? 1 : Math.min(1, dt * 5);
    rig.relaxLegs += (legs - rig.relaxLegs) * f;
    rig.relaxArms += (arms - rig.relaxArms) * f;
    // Weight on one leg, switching now and then (each Sim on its own rhythm).
    const phase = Math.floor((time + rig.seed * 40) / (7 + rig.seed * 5));
    const side = hash(phase * 31 + i) < 0.5 ? -1 : 1;
    rig.shift += (side - rig.shift) * (rig.dir?.still ? 1 : Math.min(1, dt * 1.6));
    const S = STANCE;
    const l = smooth(clamp(rig.relaxLegs, 0, 1));
    if (l > 1e-3) {
      const w = rig.shift * l;
      // Hips tilt over the standing leg; the chest stays upright.
      addRotation(add, B.pelvis, 0, 0, 1, S.hip * w);
      addRotation(add, B.spine_01, 0, 0, 1, -S.hip * w * 0.6);
      addRotation(add, B.spine_02, 0, 0, 1, -S.hip * w * 0.4);
      // Feet in under the hips (legs back to vertical after the tilt), soles flat.
      addRotation(add, B.thigh_l, 0, 0, 1, S.feet * l - S.hip * w);
      addRotation(add, B.thigh_r, 0, 0, 1, -S.feet * l - S.hip * w);
      addRotation(add, B.foot_l, 0, 0, 1, -S.feet * l);
      addRotation(add, B.foot_r, 0, 0, 1, S.feet * l);
      // The clip stands with the left foot well ahead of the right: bring them level.
      addRotation(add, B.thigh_l, 1, 0, 0, S.stagger * l);
      addRotation(add, B.thigh_r, 1, 0, 0, -S.stagger * l);
      addRotation(add, B.foot_l, 1, 0, 0, -S.stagger * l);
      addRotation(add, B.foot_r, 1, 0, 0, S.stagger * l);
      // The free leg's knee softens.
      // (Barely under a skirt: a knee pushed forward would show through it.)
      const knee = rig.skirt ? 0.25 : 1;
      const freeL = Math.max(0, -rig.shift) * l * knee;
      const freeR = Math.max(0, rig.shift) * l * knee;
      addRotation(add, B.thigh_l, 1, 0, 0, -S.knee * 0.5 * freeL);
      addRotation(add, B.calf_l, 1, 0, 0, S.knee * freeL);
      addRotation(add, B.foot_l, 1, 0, 0, -S.knee * 0.5 * freeL);
      addRotation(add, B.thigh_r, 1, 0, 0, -S.knee * 0.5 * freeR);
      addRotation(add, B.calf_r, 1, 0, 0, S.knee * freeR);
      addRotation(add, B.foot_r, 1, 0, 0, -S.knee * 0.5 * freeR);
    }
    const a = smooth(clamp(rig.relaxArms, 0, 1));
    if (a > 1e-3) {
      // Shoulders down, arms in and a little forward, palms turned to the thighs, elbows soft.
      addRotation(add, B.clavicle_l, 0, 0, 1, S.shoulders * a);
      addRotation(add, B.clavicle_r, 0, 0, 1, -S.shoulders * a);
      addRotation(add, B.upperarm_l, 1, 0, 0, (-S.forward + S.even * 0.5) * a);
      addRotation(add, B.upperarm_r, 1, 0, 0, (-S.forward - S.even) * a);
      const arms = (S.arms[rig.body.name] ?? 0) + (rig.skirt ? S.skirt : 0);
      addRotation(add, B.upperarm_l, 0, 0, 1, arms * a);
      addRotation(add, B.upperarm_r, 0, 0, 1, -(arms + S.right) * a);
      addRotation(add, B.upperarm_l, 0, 1, 0, S.twist * a);
      addRotation(add, B.upperarm_r, 0, 1, 0, -S.twist * a);
      addRotation(add, B.lowerarm_l, 1, 0, 0, -S.elbows * a);
      addRotation(add, B.lowerarm_r, 1, 0, 0, -S.elbows * a);
    }
  }

  /**
   * Face: blinks at irregular intervals, eyes that look at the conversation partner (or now and
   * then at the camera / around), an expression from the Sim's emotion and conversation, and the
   * mouth moving while it speaks. Written as local rotations of the face bones (head frame), so it
   * follows the head and skins on the GPU like everything else.
   */
  private animateFace(
    rig: SimRig,
    i: number,
    social: number,
    role: number,
    partner: SimRig | null,
    pose: number,
    moving: boolean,
    time: number,
    dt: number,
  ): void {
    const B = this.set!.bone;
    if (B.jaw === undefined) return;
    const add = this.add;
    const pair = partner ? Math.min(i, partner.id) : i;
    const asleep = pose === Pose.Lie && rig.cur.key === 'lie' && (!rig.tagKnown || rig.tag === 'sleep' || rig.tag === 'nap');

    // Target expression: the emotion, then the conversation / activity on top.
    const tgt = this.faceTmp;
    // The friendly resting face, then the emotion on top.
    const emotion = this.emotionIds[rig.emotion - 1] ?? '';
    Object.assign(tgt, NEUTRAL);
    const warmth = COLD.has(emotion) ? 0 : rig.warmth;
    if (warmth > 0) for (const key of FACE_KEYS) tgt[key] += (FRIENDLY[key] ?? 0) * warmth;
    Object.assign(tgt, EXPRESSIONS[emotion] ?? NONE);
    let eyesClosed = 0;
    let talking = false;
    if (social) {
      const me = speaking(pair, role, time);
      switch (social) {
        case Anim.Laugh:
          Object.assign(tgt, LAUGH);
          tgt.jaw = 0.45 + 0.25 * Math.abs(Math.sin(time * 11 + i));
          break;
        case Anim.Flirt:
          Object.assign(tgt, EXPRESSIONS.flirty);
          talking = me;
          break;
        case Anim.Argue:
        case Anim.Fight:
          Object.assign(tgt, EXPRESSIONS.angry);
          talking = me || social === Anim.Fight;
          break;
        case Anim.Kiss:
          Object.assign(tgt, KISS);
          eyesClosed = 1;
          break;
        case Anim.Hug:
          Object.assign(tgt, HUG);
          eyesClosed = 0.85;
          break;
        default:
          talking = me;
          // Listening: a friendly face (outcome 1 = going well, 2 = badly).
          if (!me) tgt.smile = Math.max(tgt.smile, 0.35);
      }
    } else if (rig.tag === 'sing' || (rig.tag === 'talk' && rig.cur.key === 'talk')) {
      talking = true;
      tgt.smile = Math.max(tgt.smile, 0.4);
    }
    if (rig.tag === 'meditate') eyesClosed = 1;
    if (rig.tag === 'read' || rig.tag === 'type' || rig.tag === 'write' || rig.tag === 'paint' || rig.tag === 'cook' || rig.tag === 'wash')
      tgt.gazeDown = Math.max(tgt.gazeDown, 0.55);
    if (asleep) {
      eyesClosed = 1;
      Object.assign(tgt, NEUTRAL, ASLEEP);
    }
    const dir = rig.dir;
    if (dir?.face) Object.assign(tgt, dir.face);
    const dbg = this.faceDebug;
    if (dbg) {
      Object.assign(tgt, NEUTRAL, dbg);
      eyesClosed = dbg.closed ?? 0;
      talking = !!dbg.talk;
    }
    const f = dir?.still ? 1 : 1 - Math.exp(-dt * 6);
    const face = rig.face;
    for (const k of FACE_KEYS) face[k] += (tgt[k] - face[k]) * f;

    // Speech: syllable-like jaw motion while it's this Sim's turn.
    let jaw = face.jaw;
    if (talking) {
      const syl = Math.max(0, Math.sin(time * 12.5 + rig.seed * 40 + Math.sin(time * 3.7 + i) * 2.2));
      const phrase = 0.55 + 0.45 * Math.sin(time * 1.9 + rig.seed * 9);
      jaw = Math.max(jaw, 0.12 + 0.75 * Math.pow(syl, 0.8) * phrase);
    }

    // Blinks: every 1.5 - 6 s (sometimes twice), ~0.17 s each.
    if (time >= rig.nextBlink) {
      rig.blinkAt = time;
      const r = hash(Math.floor(time * 10) + i * 7919);
      rig.nextBlink = time + (r < 0.15 ? 0.32 : 1.5 + 4.5 * hash(Math.floor(time * 13) + i * 31));
    }
    const bt = (time - rig.blinkAt) / 0.17;
    const blink = !dir?.still && bt >= 0 && bt < 1 ? (bt < 0.4 ? bt / 0.4 : 1 - (bt - 0.4) / 0.6) : 0;
    const closed = Math.max(eyesClosed, smooth(Math.min(1, blink)));

    // Gaze: the partner's eyes; otherwise, now and then, the camera or a glance around.
    let gy = 0;
    let gp = 0.35 * face.gazeDown;
    const ex = this.heads[i * 3];
    const eyeY = this.heads[i * 3 + 1] - 0.17 * rig.scale;
    const ez = this.heads[i * 3 + 2];
    if (time >= rig.gazeUntil) {
      const r = hash(Math.floor(time * 7) + i * 131);
      rig.gazeMode = social && partner ? (r < 0.82 ? 1 : 3) : moving ? 0 : r < 0.3 ? 2 : r < 0.65 ? 3 : 0;
      rig.gazeUntil = time + 1.2 + 2.8 * hash(Math.floor(time * 5) + i * 17);
      rig.glanceYaw = (hash(Math.floor(time * 3) + i) - 0.5) * 0.7;
      rig.glancePitch = (hash(Math.floor(time * 3) + i + 5) - 0.6) * 0.3;
    }
    if (!asleep && closed < 0.99) {
      if (rig.gazeMode === 1 && partner?.visible) {
        this.gazeAt(rig, ex, eyeY, ez, this.heads[partner.id * 3], this.heads[partner.id * 3 + 1] - 0.17 * partner.scale, this.heads[partner.id * 3 + 2]);
        gy = this.gaze[0];
        gp = this.gaze[1];
      } else if (rig.gazeMode === 2) {
        const cam = this.scene.activeCamera;
        if (cam && this.gazeAt(rig, ex, eyeY, ez, cam.globalPosition.x, cam.globalPosition.y, cam.globalPosition.z)) {
          gy = this.gaze[0];
          gp = this.gaze[1];
        } else {
          gy = rig.glanceYaw;
          gp = rig.glancePitch;
        }
      } else if (rig.gazeMode === 3) {
        gy = rig.glanceYaw;
        gp = rig.glancePitch + 0.3 * face.gazeDown;
      }
    }
    if (dir?.lookAt && !asleep && closed < 0.99 && this.gazeAt(rig, ex, eyeY, ez, dir.lookAt.x, dir.lookAt.y, dir.lookAt.z)) {
      gy = this.gaze[0];
      gp = this.gaze[1];
    } else if (dir?.still) {
      gy = 0;
      gp = 0.35 * face.gazeDown;
    }
    gy = clamp(gy, -0.42, 0.42);
    gp = clamp(gp, -0.28, 0.32);
    // Saccades: quick, not smoothed over seconds.
    const fe = dir?.still ? 1 : 1 - Math.exp(-dt * 22);
    rig.eyeYaw += (gy - rig.eyeYaw) * fe;
    rig.eyePitch += (gp - rig.eyePitch) * fe;

    // Bones (local axes = the head's: x right, y up, z forward; +x rotation turns the front down).
    addLocal(add, B.eye_l, 0, 1, 0, rig.eyeYaw);
    addLocal(add, B.eye_l, 1, 0, 0, rig.eyePitch);
    addLocal(add, B.eye_r, 0, 1, 0, rig.eyeYaw);
    addLocal(add, B.eye_r, 1, 0, 0, rig.eyePitch);
    const upper = clamp(face.lidU * 0.26 + rig.eyePitch * 0.45 + face.lidL * 0.05, -0.2, 0.7);
    const lidU = upper + (0.8 - upper) * closed;
    const lidL = -(face.lidL * 0.32 + closed * 0.25) + Math.max(0, rig.eyePitch) * 0.15;
    addLocal(add, B.lidU_l, 1, 0, 0, lidU);
    addLocal(add, B.lidU_r, 1, 0, 0, lidU);
    addLocal(add, B.lidL_l, 1, 0, 0, lidL);
    addLocal(add, B.lidL_r, 1, 0, 0, lidL);
    addLocal(add, B.jaw, 1, 0, 0, jaw * 0.2);
    // Lip corners: up for smiles, down for frowns; apart for smiles, together for a pucker.
    const corner = -0.17 * face.smile + 0.2 * face.frown;
    const wide = 0.09 * face.wide;
    addLocal(add, B.lip_l, 1, 0, 0, corner - jaw * 0.04);
    addLocal(add, B.lip_r, 1, 0, 0, corner - jaw * 0.04);
    addLocal(add, B.lip_l, 0, 1, 0, -wide);
    addLocal(add, B.lip_r, 0, 1, 0, wide);
    const brow = -0.11 * face.browUp + 0.09 * face.browDown;
    const tilt = 0.18 * face.browIn - 0.16 * face.browDown;
    addLocal(add, B.brow_l, 1, 0, 0, brow);
    addLocal(add, B.brow_r, 1, 0, 0, brow);
    addLocal(add, B.brow_l, 0, 0, 1, tilt);
    addLocal(add, B.brow_r, 0, 0, 1, -tilt);
  }

  // --- helpers --------------------------------------------------------------------------

  private row(i: number): number {
    return i * this.width * 4;
  }

  private objectAt(x: number, z: number): PlacedObject | null {
    let best: PlacedObject | null = null;
    let bestD = Infinity;
    for (const o of this.objects) {
      if (x < o.minX - 0.05 || x > o.maxX + 0.05 || z < o.minZ - 0.05 || z > o.maxZ + 0.05) continue;
      const d = Math.abs(x - o.cx) + Math.abs(z - o.cz);
      if ((SEATS[o.def] || BEDS[o.def]) && d < bestD) {
        best = o;
        bestD = d;
      }
    }
    return best;
  }

  /** The object a standing Sim faces (within reach), if any. */
  private objectInFront(rig: SimRig): PlacedObject | null {
    const fx = rig.x + Math.sin(rig.yaw) * 0.55;
    const fz = rig.z + Math.cos(rig.yaw) * 0.55;
    let best: PlacedObject | null = null;
    let bestD = 0.6;
    for (const o of this.objects) {
      if (!USE[o.def]) continue;
      const qx = clamp(fx, o.minX, o.maxX);
      const qz = clamp(fz, o.minZ, o.maxZ);
      const d = Math.hypot(fx - qx, fz - qz);
      if (d < bestD) {
        best = o;
        bestD = d;
      }
    }
    return best;
  }

  /** Head-relative eye yaw / pitch towards a point (into `gaze`); false if it's behind the Sim. */
  private gazeAt(rig: SimRig, ex: number, ey: number, ez: number, tx: number, ty: number, tz: number): boolean {
    const dx = tx - ex;
    const dz = tz - ez;
    this.gaze[0] = wrapAngle(Math.atan2(dx, dz) - rig.yaw - rig.lookYaw);
    this.gaze[1] = -Math.atan2(ty - ey, Math.hypot(dx, dz)) - rig.lookPitch * 0.7;
    return Math.abs(this.gaze[0]) < 1.4;
  }

  /**
   * Blanket over a Sim asleep in a bed: fitted to the slot (half of a double bed, or a single bed)
   * and to the bed's foot end, pulled up over ~0.5 s when the Sim lies down; zero-scaled otherwise.
   */
  private writeBlanket(rig: SimRig, i: number, pose: number, dt: number): void {
    const blanket = this.blankets.get(rig.body.name);
    if (!blanket) return;
    const bed = rig.bed;
    const under = pose === Pose.Lie && rig.cur.key === 'lie' && !!bed && BLANKET_BEDS.has(bed.def) && (rig.tagKnown ? rig.tag === 'sleep' || rig.tag === 'nap' : true);
    rig.cover = clamp(rig.cover + (under ? dt * 2 : -dt * 3), 0, 1);
    const m = blanket.matrices;
    const o = i * 16;
    if (rig.cover <= 0 || !bed) {
      m.fill(0, o, o + 16);
      return;
    }
    const s = rig.scale;
    const fx = Math.sin(rig.yaw);
    const fz = Math.cos(rig.yaw);
    // Getting up: the Sim is already off the bed; the quilt stays on its slot as it slides off.
    const x = rig.fromBed ? rig.lieX : rig.x;
    const z = rig.fromBed ? rig.lieZ : rig.z;
    // Bed extent across the Sim (slot width) and the distance to its foot end.
    const across = Math.abs(fz) * (bed.maxX - bed.minX) + Math.abs(fx) * (bed.maxZ - bed.minZ);
    const slot = across >= 1.8 ? 0.86 : Math.min(across - 0.08, 1.0);
    const tx = fx > 1e-3 ? (bed.maxX - x) / fx : fx < -1e-3 ? (bed.minX - x) / fx : Infinity;
    const tz = fz > 1e-3 ? (bed.maxZ - z) / fz : fz < -1e-3 ? (bed.minZ - z) / fz : Infinity;
    const foot = Math.min(tx, tz) - 0.05;
    // The quilt past the toes reaches the bed's foot end (local units, at the Sim's scale).
    blanket.ext[i] = clamp(foot / s - blanket.footZ, -0.22, 1.2);
    const sz = 1;
    const c = smooth(rig.cover);
    const sx = (slot / BLANKET_WIDTH) * (0.9 + 0.1 * c);
    // Two Sims in one bed: offset the quilts a hair so their tops don't z-fight where they meet.
    const lift = (i % 2) * 0.004;
    // Rows: x axis, y axis, z axis, translation (Babylon row-vector layout). z scaling keeps the chest line.
    const zs = s * sz;
    const z0 = blanket.topZ * s * (1 - sz);
    m[o] = fz * sx;
    m[o + 1] = 0;
    m[o + 2] = -fx * sx;
    m[o + 3] = 0;
    m[o + 4] = 0;
    m[o + 5] = s * c;
    m[o + 6] = 0;
    m[o + 7] = 0;
    m[o + 8] = fx * zs;
    m[o + 9] = 0;
    m[o + 10] = fz * zs;
    m[o + 11] = 0;
    m[o + 12] = x + fx * z0;
    m[o + 13] = rig.bedH + lift;
    m[o + 14] = z + fz * z0;
    m[o + 15] = 1;
  }

  /**
   * The lying pose of a body (scale 1, slot frame: x across, y above the mattress, z towards the
   * feet), skinned on the CPU once for the blanket: the same clip, straight legs and resting arms as
   * `procedural` uses for sleeping Sims. Also returns the chest line and the toes' z.
   */
  private lyingPose(body: BodyData): {
    positions: Float32Array;
    chestZ: number;
    feetZ: number;
  } {
    const set = this.set!;
    const B = set.bone;
    const NB = set.bones.length;
    const mats = new Float32Array(NB * 16);
    const head = new Float32Array(3);
    sampleClip(set, set.clips.get('idle')!, 0, this.qA, this.pA);
    blendInto(this.qA, this.pA, set.sourceRestQ, this.pA, 0.9, this.legMask);
    resetAdditive(this.add);
    addRotation(this.add, B.upperarm_l, 0, 0, 1, 0.3);
    addRotation(this.add, B.upperarm_r, 0, 0, 1, -0.3);
    addRotation(this.add, B.lowerarm_l, 1, 0, 0, 0.35);
    addRotation(this.add, B.lowerarm_r, 1, 0, 0, 0.35);
    const sp = Math.sin(-Math.PI / 4);
    const cp = Math.cos(-Math.PI / 4);
    skin(
      set,
      body,
      this.qA,
      this.pA,
      this.add,
      {
        x: 0,
        y: LIE_BACK,
        z: LIE_CENTRE,
        qx: sp,
        qy: 0,
        qz: 0,
        qw: cp,
        scale: 1,
      },
      this.scratch,
      mats,
      0,
      head,
    );
    const chestZ = Math.max(this.scratch.worldT[B.upperarm_l * 3 + 2], this.scratch.worldT[B.upperarm_r * 3 + 2]) + 0.07;
    resetAdditive(this.add);
    // The body plus the clothes that stand off it most (skirts, boots).
    const parts = ['body', 'bottom.skirt', 'shoes.boots'].map((k) => body.parts.get(k)).filter((p): p is NonNullable<typeof p> => !!p);
    const total = parts.reduce((n, p) => n + p.positions.length / 3, 0);
    const out = new Float32Array(total * 3);
    let feetZ = -Infinity;
    let base = 0;
    for (const part of parts) {
      const n = part.positions.length / 3;
      for (let v = 0; v < n; v++) {
        const px = part.positions[v * 3];
        const py = part.positions[v * 3 + 1];
        const pz = part.positions[v * 3 + 2];
        let x = 0;
        let y = 0;
        let z = 0;
        for (let k = 0; k < 4; k++) {
          const w = part.weights[v * 4 + k];
          if (w <= 0) continue;
          const m = part.joints[v * 4 + k] * 16;
          x += w * (mats[m] * px + mats[m + 4] * py + mats[m + 8] * pz + mats[m + 12]);
          y += w * (mats[m + 1] * px + mats[m + 5] * py + mats[m + 9] * pz + mats[m + 13]);
          z += w * (mats[m + 2] * px + mats[m + 6] * py + mats[m + 10] * pz + mats[m + 14]);
        }
        out[(base + v) * 3] = x;
        out[(base + v) * 3 + 1] = y;
        out[(base + v) * 3 + 2] = z;
        if (part === parts[0] && z > feetZ) feetZ = z;
      }
      base += n;
    }
    return { positions: out, chestZ, feetZ };
  }

  /** Pelvis height / forward offset of the seated and lying poses (body space, scale 1). */
  private measureSit(body: BodyData): SeatFit {
    const set = this.set!;
    const tmp = new Float32Array(set.bones.length * 16);
    const head = new Float32Array(3);
    const pose = (key: string, t: number) => {
      const clip = set.clips.get(key)!;
      sampleClip(set, clip, t, this.qA, this.pA);
      resetAdditive(this.add);
      skin(set, body, this.qA, this.pA, this.add, { x: 0, y: 0, z: 0, qx: 0, qy: 0, qz: 0, qw: 1, scale: 1 }, this.scratch, tmp, 0, head);
      const p = set.bone.pelvis * 3;
      return { y: this.scratch.worldT[p + 1], z: this.scratch.worldT[p + 2] };
    };
    const sit = pose('sit', 0);
    // Hips rest ~11 cm above the seat surface.
    return { y: sit.y - 0.11, z: sit.z };
  }

  private partMesh(body: BodyData, part: string): PartMesh | null {
    const key = `${body.name}:${part}`;
    const cached = this.meshes.get(key);
    if (cached) return cached;
    const data = body.parts.get(part);
    if (!data) return null;
    const mesh = new Mesh(`sim:${key}`, this.scene);
    const vd = new VertexData();
    vd.positions = data.positions;
    vd.normals = data.normals;
    vd.uvs = data.uvs;
    vd.indices = data.indices;
    vd.matricesIndices = data.joints;
    vd.matricesWeights = data.weights;
    vd.applyToMesh(mesh, false);
    mesh.setVerticesData('simField', data.fields, false, 4);
    mesh.skeleton = this.skeleton(body);
    mesh.numBoneInfluencers = 4;
    mesh.bakedVertexAnimationManager = this.vat;
    mesh.material = this.material(body, part);
    mesh.isPickable = false;
    mesh.receiveShadows = true;
    // Sims move every frame (bones carry the placement): skip culling and bounds work.
    mesh.alwaysSelectAsActiveMesh = true;
    mesh.doNotSyncBoundingInfo = true;
    mesh.freezeWorldMatrix();
    const pm = { mesh, settings: new Float32Array(0) };
    this.meshes.set(key, pm);
    return pm;
  }

  /** A skeleton only declares the bone count to the shaders; poses come from the texture. */
  private skeleton(body: BodyData): Skeleton {
    let sk = this.skeletons.get(body.name);
    if (sk) return sk;
    const set = this.set!;
    sk = new Skeleton(`sim:${body.name}`, `sim:${body.name}`, this.scene);
    const bones: Bone[] = [];
    set.bones.forEach((name, b) => {
      const p = set.parents[b];
      bones.push(new Bone(name, sk!, p >= 0 ? bones[p] : null, Matrix.Identity()));
    });
    this.skeletons.set(body.name, sk);
    return sk;
  }

  private material(body: BodyData, part: string): PBRMaterial {
    const set = this.set!;
    const kind: CharacterSurface =
      part === 'body' ? 'body' : part === 'eyes' ? 'plain' : part === 'lids' ? 'lid' : /^(top|bottom|shoes)\./.test(part) ? 'cloth' : 'hair';
    const hairTex = part === 'brows' ? (body.name === 'female' ? 'hair2' : 'hair1') : (set.hairTextures[part.replace('hair.', '')] ?? 'hair1');
    const key = kind === 'body' || kind === 'cloth' ? `${kind}:${body.name}` : kind === 'hair' ? `hair:${hairTex}` : kind;
    const cached = this.materials.get(key);
    if (cached) return cached;
    const mat = new PBRMaterial(`sim:${key}`, this.scene);
    const tex = (file: string, srgb: boolean) => {
      const t = new Texture(set.file(file), this.scene, {
        invertY: false,
        samplingMode: Texture.TRILINEAR_SAMPLINGMODE,
        gammaSpace: srgb,
      });
      t.gammaSpace = srgb;
      t.anisotropicFilteringLevel = 4;
      return t;
    };
    mat.metallic = 0;
    mat.maxSimultaneousLights = 6;
    let fabric: Texture | null = null;
    if (kind === 'body') {
      mat.albedoTexture = tex(body.textures.albedo, true);
      mat.bumpTexture = tex(body.textures.normal, false);
      mat.bumpTexture.level = 0.8;
      mat.roughness = 0.5;
    } else if (kind === 'cloth') {
      mat.albedoColor = Color3.White();
      mat.bumpTexture = tex(body.textures.folds ?? body.textures.normal, false);
      mat.bumpTexture.level = 1;
      fabric = tex('fabric.jpg', false);
      mat.roughness = 0.82;
      mat.sheen.isEnabled = true;
      mat.sheen.intensity = 0.35;
      mat.sheen.linkSheenWithAlbedo = true;
      // Inside of collars and cuffs.
      mat.backFaceCulling = false;
      mat.twoSidedLighting = true;
    } else if (kind === 'hair') {
      mat.albedoTexture = tex(`${hairTex}_albedo.jpg`, true);
      mat.bumpTexture = tex(`${hairTex}_normal.jpg`, false);
      mat.roughness = 0.42;
      mat.backFaceCulling = false;
      mat.twoSidedLighting = true;
      // Strand highlight: anisotropic along the strands (UV v).
      mat.anisotropy.isEnabled = true;
      mat.anisotropy.intensity = 0.75;
      mat.anisotropy.direction.set(0, 1);
    } else if (kind === 'lid') {
      mat.albedoColor = Color3.White();
      mat.roughness = 0.55;
    } else {
      mat.albedoTexture = tex('eye_albedo.jpg', true);
      mat.roughness = 0.12;
    }
    if (mat.bumpTexture) {
      // OpenGL-style maps on geometry mirrored from glTF (same as Babylon's glTF loader).
      mat.invertNormalMapX = true;
      mat.invertNormalMapY = false;
    }
    new CharacterPlugin(mat, kind, set.bones.length * 4, this.texture, fabric);
    this.lib.adopt(mat);
    this.materials.set(key, mat);
    return mat;
  }
}

function advance(p: Player, dt: number): void {
  if (!p.clip) return;
  p.time += dt * p.rate;
  if (p.clip.loop && p.time > p.clip.duration * 64) p.time %= p.clip.duration;
}

/** Whose turn it is in a conversation: the starter (role 1) and the other Sim alternate. */
function speaking(pair: number, role: number, time: number): boolean {
  if (role === 0) return false;
  const turn = Math.floor((time + (pair % 5) * 0.53) / 2.8);
  return (turn % 2 === 0) === (role === 1);
}

function splitKey(key: string): [string, string] {
  const at = key.indexOf(':');
  return [key.slice(0, at), key.slice(at + 1)];
}

function hash(n: number): number {
  let h = Math.imul((n | 0) ^ 0x9e3779b9, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

function wrapAngle(a: number): number {
  a %= Math.PI * 2;
  if (a > Math.PI) a -= Math.PI * 2;
  if (a < -Math.PI) a += Math.PI * 2;
  return a;
}

function lerpAngle(a: number, b: number, t: number): number {
  return a + wrapAngle(b - a) * t;
}

function clampHeight(h: number | undefined): number {
  return typeof h === 'number' && Number.isFinite(h) ? Math.min(1.15, Math.max(0.85, h)) : 1;
}
