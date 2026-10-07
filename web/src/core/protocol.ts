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
  | { type: 'joinCareer'; sim: number; career: number }
  | { type: 'quitCareer'; sim: number }
  | { type: 'visit'; sim: number; plot: number }
  | { type: 'goHome'; sim: number }
  | { type: 'cancel'; sim: number; index: number };

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
  moodlets: { id: string; label: string; mood: number; minutesLeft: number }[];
  /** Plot the Sim is on (null on the street or at work). */
  plot: number | null;
  /** Minute of day they come back from work, if away. */
  awayUntil: number | null;
  visiting: number | null;
  job: JobView | null;
  actions: ActionView[];
}

/** Low-frequency (~10 Hz) state for the UI. */
export interface JobView {
  career: string;
  careerLabel: string;
  title: string;
  level: number;
  levels: number;
  performance: number;
  pay: number;
  startHour: number;
  hours: number;
  /** 0 = Monday. */
  days: number[];
  nextTitle: string | null;
}

export interface UiSnapshot {
  day: number;
  /** 0 = Monday. */
  weekday: number;
  minute: number;
  speed: number;
  autonomy: boolean;
  sims: SimView[];
  households: { id: number; funds: number }[];
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
  | { type: 'ready'; layout: SnapshotLayout; shared: SharedArrayBuffer | null }
  | { type: 'world'; world: WorldStructure }
  | { type: 'ui'; ui: UiSnapshot }
  | { type: 'saved'; requestId: number; data: string }
  | { type: 'socialOptions'; requestId: number; options: SocialOption[] }
  /** Fallback transport when SharedArrayBuffer is unavailable. */
  | { type: 'snapshot'; data: Float32Array }
  | { type: 'error'; message: string; fatal: boolean };
