/** Messages between the main thread and the sim worker. */

import type { Appearance } from '../game/household';
import type { SnapshotLayout } from './snapshot';

/** Mirrors `sim-core/src/command.rs`. */
export type Command =
  | { type: 'setSpeed'; speed: number }
  | { type: 'setAutonomy'; enabled: boolean }
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
  | { type: 'build'; sim: number; edits: EdgeEdit[] };

/** One wall edge: `h` runs from (x, z) to (x + 1, z); `v` from (x, z) to (x, z + 1). */
export interface WallEdge {
  axis: 'h' | 'v';
  x: number;
  z: number;
}

/** A wall edge to set: a plain wall, a door or window in a wall, or nothing (`open`). */
export interface EdgeEdit extends WallEdge {
  kind: 'wall' | 'door' | 'window' | 'open';
}

/** A door or window in a wall (its edge is also listed in `WorldStructure.walls`). */
export interface Opening extends WallEdge {
  kind: 'door' | 'window';
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
  build: { wall: number; door: number; window: number; remove: number };
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
  households: { id: number; funds: number; rent: number | null; bills: number | null; style: number }[];
  relationships: RelationshipView[];
  /** Recent social events, oldest first; ids increase monotonically. */
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
  /** Which part of the town to build geometry for (tile rectangle); null = everything. */
  | { type: 'view'; region: [number, number, number, number] | null };

export type FromWorker =
  | { type: 'ready'; layout: SnapshotLayout; shared: SharedArrayBuffer | null; catalog: Catalog }
  | { type: 'world'; world: WorldStructure }
  | { type: 'ui'; ui: UiSnapshot }
  | { type: 'saved'; requestId: number; data: string }
  | { type: 'socialOptions'; requestId: number; options: SocialOption[] }
  /** Fallback transport when SharedArrayBuffer is unavailable. */
  | { type: 'snapshot'; data: Float32Array }
  | { type: 'error'; message: string; fatal: boolean };
