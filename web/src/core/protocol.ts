/** Messages between the main thread and the sim worker. */

import type { Appearance } from '../game/household';
import type { SnapshotLayout } from './snapshot';

/** Mirrors `sim-core/src/command.rs`. */
export type Command =
  | { type: 'setSpeed'; speed: number }
  /** Free will for a household (default: the player's). */
  | { type: 'setAutonomy'; enabled: boolean; household?: number }
  /** "Skip quiet hours": time-lapse while the player's household sleeps or is at work. */
  | { type: 'setAutoFast'; enabled: boolean }
  | { type: 'use'; sim: number; object: number; interaction: number }
  | { type: 'moveTo'; sim: number; x: number; z: number }
  | { type: 'social'; sim: number; target: number; social: number }
  | { type: 'joinCareer'; sim: number; career: number; level: number }
  | { type: 'quitCareer'; sim: number }
  | { type: 'visit'; sim: number; plot: number }
  | { type: 'goHome'; sim: number }
  | { type: 'cancel'; sim: number; index: number }
  | { type: 'buy'; sim: number; object: string; at?: [number, number, number]; style?: number }
  | { type: 'sell'; sim: number; object: number }
  | { type: 'moveObject'; sim: number; object: number; x: number; z: number; rot: number }
  | { type: 'restyle'; sim: number; object: number; style: number }
  | { type: 'setStyle'; sim: number; style: number }
  | { type: 'upgrade'; sim: number; object: number }
  | { type: 'build'; sim: number; edits: EdgeEdit[] }
  | { type: 'paint'; sim: number; faces: FacePaint[] }
  | { type: 'paintFloor'; sim: number; tiles: FloorPaint[] }
  | { type: 'undo'; sim: number }
  /** The resident's own routine blocks (the whole list). */
  | { type: 'setRoutines'; sim: number; routines: RoutineIn[] }
  /** The routine template of the resident's household. */
  | { type: 'setHouseholdRoutines'; sim: number; routines: RoutineIn[] }
  | { type: 'skipHouseholdRoutine'; sim: number; routine: number; skip: boolean }
  | { type: 'addGoal'; sim: number; goal: GoalIn }
  | { type: 'removeGoal'; sim: number; index: number }
  | { type: 'acceptSuggestion'; sim: number; index: number }
  | { type: 'dismissSuggestion'; sim: number; index: number };

/** A routine block: an activity (content `activities` id) on weekdays (bit 0 = Monday) from `start` (minute of the day) for `minutes`. */
export interface RoutineIn {
  id?: number;
  activity: string;
  skill?: string;
  days: number;
  start: number;
  minutes: number;
}

export interface Routine extends RoutineIn {
  id: number;
}

export interface GoalIn {
  def: string;
  skill?: string;
  category?: string;
  target?: number;
}

/** Why a block wasn't kept. */
export interface ReasonView {
  code: 'trait' | 'need' | 'mood' | 'away' | 'noPlace';
  trait?: string;
  need?: string;
}

/** A running or past block. */
export interface BlockView {
  routine: number;
  household: boolean;
  activity: string;
  skill: string | null;
  /** Day it started (from 1). */
  day: number;
  start: number;
  minutes: number;
  status: 'active' | 'kept' | 'cut' | 'skipped' | 'noPlace';
  reason: ReasonView | null;
  /** Minutes spent on it. */
  done: number;
}

export type GoalKind = 'hasJob' | 'jobLevel' | 'promoted' | 'skill' | 'friends' | 'partner' | 'funds';

export interface GoalView {
  def: string;
  kind: GoalKind;
  label: string;
  icon: string;
  /** 0..1 */
  progress: number;
  /** Change over the last days (positive: getting there). */
  trend: number;
  skill: string | null;
  category: string | null;
  target: number;
  sinceDay: number;
}

/** A resident's planner (the player's household only). */
export interface PlanView {
  routines: Routine[];
  /** Household template blocks this resident doesn't follow. */
  skipHousehold: number[];
  current: BlockView | null;
  /** The last week's blocks, oldest first. */
  history: BlockView[];
  goals: GoalView[];
  suggestions: GoalView[];
  /** `[activity, skill]`: places they'd like (from blocks with nowhere to do them). */
  wishes: [string, string | null][];
  /** How well they stick to plans (1 = average). */
  adherence: number;
}

/** A floor tile to cover: `covering` 0 for the automatic floor, else a floor covering + 1. */
export interface FloorPaint {
  x: number;
  z: number;
  covering: number;
}

/** One wall edge: `h` runs from (x, z) to (x + 1, z); `v` from (x, z) to (x, z + 1). */
export interface WallEdge {
  axis: 'h' | 'v';
  x: number;
  z: number;
  /** Covering of each face (0: automatic, else `wallCoverings` index + 1); face 0 looks towards -z (h) or -x (v). Absent: both automatic. */
  faces?: [number, number];
  /** 1: half wall. */
  form?: number;
}

/**
 * Diagonal wall directions across tile (x, z): `dp` ("/") from (x, z) to (x + 1, z + 1),
 * `dn` ("\") from (x, z + 1) to (x + 1, z).
 */
export type DiagonalAxis = 'dp' | 'dn';

/** A wall edge (or a diagonal across a tile) to set: a plain wall, a door or window in a wall, or nothing (`open`). */
export interface EdgeEdit {
  axis: WallEdge['axis'] | DiagonalAxis;
  x: number;
  z: number;
  kind: 'wall' | 'door' | 'window' | 'open';
  /** New walls: covering of both faces. */
  cover?: number;
  /** Walls: 0 full height, 1 half wall. */
  form?: number;
  /** Doors and windows: style index. */
  style?: number;
}

/** One wall face to cover (`side` 0 looks towards -z / -x / the tile's half 0). */
export interface FacePaint {
  axis: EdgeEdit['axis'];
  x: number;
  z: number;
  side: 0 | 1;
  covering: number;
}

/** A diagonal wall across tile (x, z). `rooms`: rooms of the tile's halves (0 touches its -z side, 1 its +z side). */
export interface DiagonalWall {
  axis: DiagonalAxis;
  x: number;
  z: number;
  kind: 'wall' | 'door' | 'window';
  rooms: [number, number];
  /** Covering of each face (face 0 towards half 0), half wall (`form` 1), door or window style. */
  faces?: [number, number];
  form?: number;
  style?: number;
}

/** A door or window in a wall (its edge is also listed in `WorldStructure.walls`). */
export interface Opening extends WallEdge {
  kind: 'door' | 'window';
  /** Door or window style index. */
  style?: number;
}

export interface MeshArrays {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  indices: Uint32Array;
}

export interface ObjectPlacement {
  id: number;
  def: string;
  x: number;
  z: number;
  rot: number;
  /** Rotated footprint in tiles. */
  w: number;
  d: number;
  /** Upgrade level (0 = as bought). */
  quality: number;
  /** Index into the content's styles. */
  style: number;
  /** What selling returns; null if it can't be sold. */
  sellValue: number | null;
}

export interface SimInfo {
  id: number;
  name: string;
  household: number;
  gender: string;
  attractedTo: string[];
  appearance: Appearance;
  traits: string[];
  perks: string[];
}

export interface WorldMeta {
  kind?: string;
  name?: string;
  streets?: { x: number; z: number; w: number; d: number }[];
  paths?: { x: number; z: number; w: number; d: number }[];
  seed?: number;
}

export interface HouseholdInfo {
  id: number;
  name: string;
  plot: number | null;
  player: boolean;
}

export interface PlotInfo {
  id: number;
  name: string;
  x: number;
  z: number;
  w: number;
  d: number;
  public: boolean;
  entry: [number, number] | null;
  /** Wall bounding box `[x0, z0, x1, z1]`, for house silhouettes. */
  house: [number, number, number, number] | null;
}

/** Sent when walls or objects change (rare). */
export interface WorldStructure {
  version: number;
  width: number;
  depth: number;
  objects: ObjectPlacement[];
  sims: SimInfo[];
  households: HouseholdInfo[];
  plots: PlotInfo[];
  exits: [number, number][];
  rooms: number[];
  /** Every edge with a wall on it (plain, or with a door or window), in grid order. */
  walls: WallEdge[];
  /** Doors and windows. */
  openings: Opening[];
  /** Diagonal walls (absent from older structures). */
  diagonals?: DiagonalWall[];
  /** Floor coverings: `[x, z, covering]` per tile that has one (absent: automatic floors). */
  floors?: [number, number, number][];
  /** Presentation data carried by the simulation unchanged (see `game/town.ts`). */
  meta: WorldMeta | null;
  meshes: { walls: MeshArrays; wallsLow: MeshArrays; floors: MeshArrays };
}

export interface ActionView {
  label: string;
  object: number | null;
  /** The other Sim, for social actions. */
  target: number | null;
  progress: number;
  directed: boolean;
  active: boolean;
}

export interface SimView {
  id: number;
  name: string;
  household: number;
  traits: string[];
  perks: string[];
  needs: number[];
  mood: number;
  emotion: string | null;
  feelings: { id: string; label: string; mood: number; minutesLeft: number }[];
  /** Plot the Sim is on (null on the street or at work). */
  plot: number | null;
  /** Minute of day they come back from work, if away. */
  awayUntil: number | null;
  visiting: number | null;
  job: JobView | null;
  actions: ActionView[];
  /** Skill levels in content order (whole number = level). */
  skills: number[];
  /** Routines, goals and wishes (the player's household only). */
  plan?: PlanView;
}

export interface Requirement {
  skill: string;
  level: number;
  /** The Sim's current whole level. */
  have: number;
}

export interface JobView {
  /** Index into the career catalog. */
  index: number;
  career: string;
  careerLabel: string;
  category: string | null;
  title: string;
  level: number;
  levels: number;
  grade: string | null;
  gradeLabel: string | null;
  performance: number;
  /** Per shift on this Sim's schedule. */
  pay: number;
  payPerHour: number;
  weeklyPay: number;
  startHour: number;
  hours: number;
  /** This Sim's workdays (0 = Monday). */
  days: number[];
  standardDays: number[];
  workweek: string | null;
  /** Skill levels above (+) or below (-) the requirements. */
  fit: number;
  requires: Requirement[];
  next: { title: string; grade: string | null; payPerHour: number; requires: Requirement[] } | null;
  nextTitle: string | null;
}

/** Every career level and the build/buy rules, sent once per game. */
export interface Catalog {
  grades: { id: string; label: string; payPerHour: number }[];
  categories: string[];
  careers: CareerEntry[];
  workweek: { fit: number; days: number; label: string }[];
  probationLevels: number;
  maxSkill: number;
  objectRules: {
    maxQuality: number;
    qualityBonus: number;
    upgradeCost: number;
    upgradeMinutes: number;
    upgradeSkill: string | null;
    upgradeSkillPerLevel: number;
    resale: number;
  };
  build: { wall: number; door: number; window: number; remove: number; diagonalWall?: number };
}

export interface CareerEntry {
  id: string;
  label: string;
  category: string | null;
  skills: string[];
  levels: {
    title: string;
    grade: string | null;
    /** Per shift on the standard week. */
    pay: number;
    start: number;
    hours: number;
    days: number[];
    /** `[skill id, level]`. */
    requires: [string, number][];
  }[];
}

export interface UiSnapshot {
  day: number;
  /** 0 = Monday. */
  weekday: number;
  minute: number;
  speed: number;
  autonomy: boolean;
  sims: SimView[];
  /** `undo`: build and buy edits the household can take back (absent from older workers). */
  households: { id: number; funds: number; rent: number | null; bills: number | null; style: number; undo?: number; routines?: Routine[] }[];
  relationships: RelationshipView[];
  /** Recent story events, oldest first; ids increase monotonically (the whole log: `events` request). */
  events: SocialEvent[];
}

/** Directional: how `a` feels about `b`. Only pairs that have met. */
export interface RelationshipView {
  a: number;
  b: number;
  friendship: number;
  romance: number;
  partners: boolean;
  chemistry: number;
}

export interface SocialEvent {
  id: number;
  tick: number;
  kind: string;
  a: number;
  b: number;
  c?: number;
  /** A level or an amount of money. */
  n?: number;
  /** Skill index. */
  skill?: number;
  /** Career index (catalog `careers`), for job events; `n` is then the level. Goal events: career category index. */
  career?: number;
  /** Goal definition index (content `goals`), for goal events (`n` the target, `skill`). */
  goal?: number;
  /** 0 everyday, 1 notable, 2 a milestone. */
  importance: number;
}

export interface SocialOption {
  index: number;
  id: string;
  label: string;
  category: string;
  chance: number;
}

/** How a session starts: a fresh lot (with the household placed) or a save file. */
export type GameSource = { lot: string; seed: number } | { save: string };

export type ToWorker =
  | { type: 'init'; content: string; source: GameSource }
  | { type: 'command'; command: Command }
  | { type: 'save'; requestId: number }
  | { type: 'socialOptions'; requestId: number; actor: number; target: number }
  /** The whole story log. */
  | { type: 'events'; requestId: number }
  /** Which part of the town to build geometry for (tile rectangle); null = everything. */
  | { type: 'view'; region: [number, number, number, number] | null };

export type FromWorker =
  | { type: 'ready'; layout: SnapshotLayout; shared: SharedArrayBuffer | null; catalog: Catalog }
  | { type: 'world'; world: WorldStructure }
  | { type: 'ui'; ui: UiSnapshot }
  | { type: 'saved'; requestId: number; data: string }
  | { type: 'socialOptions'; requestId: number; options: SocialOption[] }
  | { type: 'events'; requestId: number; events: SocialEvent[] }
  /** Fallback transport when SharedArrayBuffer is unavailable. */
  | { type: 'snapshot'; data: Float32Array }
  | { type: 'error'; message: string; fatal: boolean };
