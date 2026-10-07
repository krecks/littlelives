/**
 * Renderer contract. The game talks to rendering only through this interface,
 * so the engine (Babylon.js today) can be swapped without touching sim, UI or input.
 */

import type { AssetRegistry } from '../assets/registry';
import type { Content } from '../content/content';
import type { FrameState } from '../core/bridge';
import type { WorldStructure } from '../core/protocol';

export type WallMode = 'up' | 'down';

/** Tile rectangle of the lot being shown. */
export interface ViewRect {
  x: number;
  z: number;
  w: number;
  d: number;
}

export interface RenderStats {
  backend: string;
  fps: number;
  frameMs: number;
  drawCalls: number;
  snapshotRendering: boolean;
}

export interface PickResult {
  /** Ground-plane hit (y = 0) in world metres. */
  ground: { x: number; z: number } | null;
  /** Object id under the cursor, if any. */
  objectId: number | null;
}

export interface RendererDeps {
  assets: AssetRegistry;
  content: Content;
  /** `webgl` forces the WebGL2 backend even when WebGPU is available. */
  backend: 'auto' | 'webgl';
}

/** Settings that can change while a game is running. */
export interface LiveRenderOptions {
  bloom: boolean;
  tiltShift: boolean;
  /** Fraction of native resolution, 0.5..1. */
  resolutionScale: number;
  cameraSensitivity: number;
}

export interface Renderer {
  init(canvas: HTMLCanvasElement): Promise<void>;
  /**
   * Rebuilds static geometry for the lot being viewed (`view`, a tile rectangle) — or the
   * whole world when null. Sims outside the view are not drawn. Called on load, on lot
   * switches and on build-mode edits.
   */
  setWorld(world: WorldStructure, view: ViewRect | null): Promise<void>;
  /** Called every frame before drawing; must not allocate. */
  update(frame: FrameState): void;
  /** Canvas-relative CSS pixel coordinates. */
  pick(x: number, y: number): PickResult;
  /** Projects a world point to canvas CSS pixels into `out`; false if behind the camera. */
  project(x: number, y: number, z: number, out: { x: number; y: number }): boolean;
  /** Interpolated world position above Sim `index`'s head from the last update; false if unknown. */
  simHead(index: number, out: { x: number; y: number; z: number }): boolean;
  /** Centres the camera on a world point. */
  focus(x: number, z: number): void;
  setHoverTile(tile: { x: number; z: number } | null): void;
  setSelectedSim(id: number | null): void;
  setWallMode(mode: WallMode): void;
  stats(): RenderStats;
  configure(options: LiveRenderOptions): void;
  /** Small JPEG data URL of the current view, or null if capture isn't possible. */
  captureThumbnail(width: number, height: number): Promise<string | null>;
  /**
   * Sets the per-frame callback (runs before each frame is drawn) and starts drawing.
   * The renderer outlives game sessions: its engine and compiled shaders are reused.
   */
  run(onFrame: (now: number) => void): void;
  /** Pauses or resumes drawing (e.g. nothing to show behind a menu). */
  setActive(active: boolean): void;
  /** Resolves once `frames` more frames have been drawn (shaders compiled, textures uploaded). */
  framesRendered(frames: number): Promise<void>;
  /** Slowly circles the camera (for the live menu backdrop). */
  setIdleOrbit(on: boolean): void;
  /** Removes the current world (end of a session); cached meshes and the landscape are kept. */
  clear(): void;
  dispose(): void;
}
