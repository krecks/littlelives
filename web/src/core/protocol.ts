/** Messages between the main thread and the sim worker. */

import type { Appearance, SimSpawn } from '../game/household';
import type { SnapshotLayout } from './snapshot';

/** Mirrors `sim-core/src/command.rs`. */
export type Command =
  | { type: 'setSpeed'; speed: number }
  /** Free will for a household (default: the player's). */
  | { type: 'setAutonomy'; enabled: boolean; household?: number }
  | { type: 'setLifespan'; lifespan: Lifespan }
  | { type: 'setPlayerMoves'; enabled: boolean }
  | { type: 'adopt'; household: number; child: boolean }
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
  /** Build and buy are addressed to a household: its home may have nobody living in it yet. */
  /** `turn`: degrees past the facing, for objects that turn freely (0..89). */
  | { type: 'buy'; household: number; object: string; at?: [number, number, number]; style?: number; turn?: number }
  | { type: 'sell'; household: number; object: number }
  /** The paid quick fix for something worn or broken. */
  | { type: 'repair'; household: number; object: number }
  | { type: 'moveObject'; household: number; object: number; x: number; z: number; rot: number; turn?: number }
  | { type: 'restyle'; household: number; object: number; style: number }
  | { type: 'setStyle'; household: number; style: number }
  | { type: 'upgrade'; household: number; object: number }
  | { type: 'build'; household: number; edits: EdgeEdit[] }
  | { type: 'paint'; household: number; faces: FacePaint[] }
  | { type: 'paintFloor'; household: number; tiles: FloorPaint[] }
  | { type: 'undo'; household: number }
  | { type: 'redo'; household: number }
  /** The roof over the home: a roof style and colour (free). */
  | { type: 'setRoof'; household: number; style: number; color: number }
  /** A saved house (`blueprint` as `World::blueprint` wrote it), built on the household's empty lot. */
  | { type: 'buildBlueprint'; household: number; blueprint: unknown }
  /** Moves the room around tile (x, z) by (dx, dz) tiles, with what stands in it. */
  | { type: 'moveRoom'; household: number; x: number; z: number; dx: number; dz: number }
  /** New residents move into the household's home (`bonds` index into `sims`); `name` renames the household. */
  | { type: 'moveIn'; household: number; name?: string; sims: SimSpawn[]; bonds: { a: number; b: number; preset: string }[] }
  /** The resident's own routine blocks (the whole list). */
  | { type: 'setRoutines'; sim: number; routines: RoutineIn[] }
  /** The routine template of the resident's household. */
  | { type: 'setHouseholdRoutines'; sim: number; routines: RoutineIn[] }
  | { type: 'skipHouseholdRoutine'; sim: number; routine: number; skip: boolean }
  | { type: 'addGoal'; sim: number; goal: GoalIn }
  | { type: 'removeGoal'; sim: number; index: number }
  /** Higher on the list steers more. */
  | { type: 'moveGoal'; sim: number; index: number; to: number }
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
  /** Minutes spent on it, in steps of 10. */
  done: number;
}

export type GoalKind = 'hasJob' | 'jobLevel' | 'promoted' | 'skill' | 'friends' | 'partner' | 'funds';

/** A goal; its text comes from the content's goal template (see `goalText`), so it can be translated. */
export interface GoalView {
  def: string;
  kind: GoalKind;
  icon: string;
  /** 0..1 in 1 % steps. */
  progress: number;
  /** Change over the last days (positive: getting there), in 0.01 steps rounded away from zero. */
  trend: number;
  skill: string | null;
  category: string | null;
  target: number;
  sinceDay: number;
}

export interface HomeWish {
  room?: string;
  factor?: string;
  fix?: string;
  another?: string;
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
  /** What they'd like for the home: a better room (`room`: kind id, "garden", or none for a room
   * nothing marks; `factor`: size, light, decor, clean, function), a fix (`fix`: object id) or
   * another room of a kind (`another`). */
  homeWishes: HomeWish[];
  /** How well they stick to plans (1 = average), in 0.05 steps rounded down. */
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
  kind: 'wall' | 'door' | 'window' | 'open' | 'fence' | 'gate';
  /** New walls: covering of both faces. */
  cover?: number;
  /** Walls: 0 full height, 1 half wall. */
  form?: number;
  /** Doors and windows: style index; fences and gates: fence style index. */
  style?: number;
}

/** A fence or gate on a grid edge (as `WallEdge`); not a wall: it makes no rooms. */
export interface FenceEdge {
  axis: 'h' | 'v';
  x: number;
  z: number;
  kind: 'fence' | 'gate';
  /** Index into the content's fence styles. */
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
  /** Degrees past `rot`, for objects that turn freely (0..89). */
  turn?: number;
  /** Rotated footprint in tiles. */
  w: number;
  d: number;
  /** Upgrade level (0 = as bought). */
  quality: number;
  /** Index into the content's styles. */
  style: number;
  /** What selling returns; null if it can't be sold. */
  sellValue: number | null;
  /** Wear 0..1 (broken at 1). */
  wear?: number;
  /** What the quick fix costs (worn things). */
  repairCost?: number;
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
  /** Died or moved away: the slot (and its snapshot row) stays, but they're not listed or drawn. */
  gone?: { why: 'died' | 'movedAway'; day: number };
  /** Bumped when someone new takes the slot. */
  generation?: number;
  /** Life stage id (how they look: elders' hair greys). */
  stage?: string;
}

/** Someone whose slot a newcomer took; story events name them with `FORMER | index`. */
export interface FormerResident {
  name: string;
  household: string;
}

/** Event references with this bit name a former resident (sim-core `social::FORMER`). */
export const FORMER = 2 ** 31;

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
  /** The roof the player chose: `[style, colour]` (indices into the content's roof styles and colours). */
  roof?: [number, number];
  /** Storeys the house on it has (absent: one). */
  storeys?: number;
}

/** Sent when walls or objects change (rare). */
/** Living: the residents earn the money for building. Creative: building is free. */
export type GameKind = 'living' | 'creative';

/** The parts of `WorldStructure` that are the lot itself: sent only when `lotVersion` changes. */
export type LotPart = 'rooms' | 'walls' | 'openings' | 'diagonals' | 'fences' | 'floors' | 'meshes';
export type LeanWorld = Omit<WorldStructure, LotPart>;

export interface WorldStructure {
  version: number;
  /** Changes whenever the lot (walls, floors, fences, coverings) does; not with furniture. */
  lotVersion: number;
  mode: GameKind;
  width: number;
  /** Rows of the lot, every storey included (see `storeyDepth`). */
  depth: number;
  /**
   * Storeys (sim-core `storeys.rs`): storey `k` is rows `k * storeyDepth ..` of the lot, laid out
   * like the ground. Absent in older structures: one storey.
   */
  storeys?: number;
  storeyDepth?: number;
  objects: ObjectPlacement[];
  /** Every slot, gone residents included (ids index this list); `roster` in the UI leaves them out. */
  sims: SimInfo[];
  former?: FormerResident[];
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
  /** Fences and gates (absent from older structures). */
  fences?: FenceEdge[];
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

/** How fast residents age: off, or 1, 2 or 4 game days a year (short, normal, long). */
export type Lifespan = 'off' | 'short' | 'normal' | 'long';

/**
 * A resident as the HUD sees them. Everyone gets the summary (who, where, which job); the
 * details (from `grade` on: needs, feelings, actions, skills, plan) are kept up to date only
 * while `detail` is set: for the player's household and the resident being inspected. Others
 * have empty details.
 */
export interface SimView {
  id: number;
  detail: boolean;
  name: string;
  household: number;
  traits: string[];
  perks: string[];
  /** Age in whole years and the life stage id (absent from older workers). */
  age?: number;
  stage?: string | null;
  /** Retired: the weekly pension. */
  pension?: number;
  /** Plot the Sim is on (null on the street or at work). */
  plot: number | null;
  /** Minute of day they come back from work, if away. */
  awayUntil: number | null;
  visiting: number | null;
  job: JobView | null;
  /** A pupil's school grade (0..100, in tenths). */
  grade?: number;
  /** 0..1 in 1 % steps (the bars' resolution), as is `mood`. */
  needs: number[];
  mood: number;
  emotion: string | null;
  /** `minutesLeft` in whole minutes. */
  feelings: { id: string; label: string; mood: number; minutesLeft: number }[];
  /** `progress` in 1 % steps. */
  actions: ActionView[];
  /** Skill levels in content order (whole number = level; in 1 % steps, rounded down). */
  skills: number[];
  /** Routines, goals and wishes (the player's household only). */
  plan?: PlanView;
}

/**
 * A resident's `id` and the fields that changed. New residents come with every field; optional
 * fields that went away are `null`; `plan` carries only its parts that changed. `detail: false`
 * drops the details.
 */
export type SimPatch = { id: number } & { [K in Exclude<keyof SimView, 'id' | 'plan'>]?: SimView[K] | null } & { plan?: Partial<PlanView> | null };

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
  build: { wall: number; door: number; window: number; remove: number; diagonalWall?: number; fence?: number; gate?: number };
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

/** A room (or the garden) of the player's home, with its scores (sim-core `rooms.rs`). */
export interface RoomView {
  /** Lot room id (0 for the garden); changes when walls do. */
  id: number;
  garden: boolean;
  /** Index into the content's room kinds; absent: nothing tells what it's for. */
  kind?: number;
  /** Things of two exclusive kinds stand in it (a bed in the kitchen). */
  mixed: boolean;
  /** The essential of its kind nothing in it offers (index into the kind's `essentials`). */
  missing?: number;
  tiles: number;
  windows: number;
  doors: number;
  lamps: number;
  /** Mean dirt, 0..1 in 1 % steps (as are the scores). */
  dirt: number;
  centre: [number, number];
  /** Size, light, decor, cleanliness, function, overall (0..1). */
  scores: [number, number, number, number, number, number];
}

/** A household's money and home. `undo`: build and buy edits the household can take back. */
export interface FundsView {
  id: number;
  funds: number;
  rent: number | null;
  bills: number | null;
  style: number;
  undo?: number;
  redo?: number;
  /** The routine template (the player's household only). */
  routines?: Routine[];
  /** A baby on the way: the parents and the game day it's due. */
  expecting?: { parents: [number, number]; due: number };
}

/**
 * The HUD's view of the game, ~10 times a second, as changes (sim-core `view::UiSync`): each
 * update carries only what changed since the one before. Residents, households, relationship
 * pairs and rooms are keyed by id and come whole when changed (residents: their changed fields);
 * story events by id. Values that drift every tick are rounded to what the HUD shows, so changed
 * means visibly changed. A `full` update carries everything and replaces what the main thread
 * had: the first one, and the next one after a `resync` request. Lists are absent when nothing
 * in them changed.
 */
export interface UiUpdate {
  full: boolean;
  day: number;
  /** 0 = Monday. */
  weekday: number;
  minute: number;
  speed: number;
  autonomy: boolean;
  /** How fast residents age. */
  lifespan: Lifespan;
  /** Whether the player's residents move in with partners and out of home on their own. */
  playerMoves: boolean;
  /** Every resident in town (summary), with details for some (see `SimView`). */
  sims?: SimPatch[];
  /** Residents no longer listed (died, moved away). */
  simsGone?: number[];
  households?: FundsView[];
  /** Pairs with a resident whose details are sent (`SimView.detail`), both ways: nobody else's are shown. */
  relationships?: RelationshipView[];
  /** `[a, b]` pairs no longer sent (forgotten, or neither of them is followed in detail any more). */
  relationshipsGone?: [number, number][];
  /** New story events, oldest first (a full update: the recent ones). The whole log: `events` request. */
  events?: SocialEvent[];
  /** The rooms and garden of the player's home. */
  rooms?: RoomView[];
  roomsGone?: number[];
}

/** Directional: how `a` feels about `b`. Only pairs that have met. */
export interface RelationshipView {
  a: number;
  b: number;
  friendship: number;
  romance: number;
  partners: boolean;
  chemistry: number;
  /** Family: what b is to a. */
  kin?: Kin;
}

/** A family link: what one resident is to another. */
export type Kin = 'parent' | 'child' | 'sibling';

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
  /** The household's home as a blueprint. */
  | { type: 'blueprint'; requestId: number; household: number }
  /** The resident whose panel is open (their details and relationships are sent too); null: none. */
  | { type: 'inspect'; sim: number | null }
  /** The next UI update sends everything. */
  | { type: 'resync' }
  /** Which part of the town to build geometry for (tile rectangle); null = everything. */
  | { type: 'view'; region: [number, number, number, number] | null };

/** How the sim worker kept up over the last second (for the debug overlay). */
export interface SimThreadStats {
  /** Steps run in the last second, and the rate the sim aims for. */
  stepsPerSecond: number;
  targetPerSecond: number;
  /** Time per step (advance, snapshot, UI view), average and worst, ms. */
  stepMs: number;
  stepMaxMs: number;
  /** Share of the second the worker spent working, 0..1. */
  busy: number;
  /** Size of the simulation's WASM memory, bytes. */
  memoryBytes: number;
}

export type FromWorker =
  | { type: 'ready'; layout: SnapshotLayout; shared: SharedArrayBuffer | null; catalog: Catalog }
  /** `full`: with the lot; otherwise a `LeanWorld` (the lot is as last sent). */
  | { type: 'world'; world: WorldStructure | LeanWorld; full: boolean }
  | { type: 'ui'; ui: UiUpdate }
  | { type: 'saved'; requestId: number; data: string }
  | { type: 'socialOptions'; requestId: number; options: SocialOption[] }
  | { type: 'events'; requestId: number; events: SocialEvent[] }
  /** JSON, or null with `error`. */
  | { type: 'blueprint'; requestId: number; data: string | null; error?: string }
  /** Fallback transport when SharedArrayBuffer is unavailable. */
  | { type: 'snapshot'; data: Float32Array }
  /** About once a second. */
  | { type: 'stats'; stats: SimThreadStats }
  | { type: 'error'; message: string; fatal: boolean };

/** Rows of the town itself (the ground storey; see `WorldStructure.storeyDepth`). */
export function groundDepth(world: { depth: number; storeyDepth?: number }): number {
  return world.storeyDepth ?? world.depth;
}

/** The storey a lot row is on (0: the ground). */
export function storeyOfRow(world: { depth: number; storeyDepth?: number; storeys?: number }, z: number): number {
  return (world.storeys ?? 1) > 1 ? Math.max(0, Math.floor(z / groundDepth(world))) : 0;
}
