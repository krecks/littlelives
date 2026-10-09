/**
 * Renderer contract. The game talks to rendering only through this interface,
 * so the engine (Babylon.js today) can be swapped without touching sim, UI or input.
 */

import type { AssetRegistry } from '../assets/registry';
import type { Content } from '../content/content';
import type { FrameState } from '../core/bridge';
import type { WorldStructure } from '../core/protocol';
import type { Appearance } from '../game/household';
import type { VisualStyle } from './styles';

export type { VisualStyle } from './styles';

/**
 * `up`: full walls and roofs. `cutaway`: walls between the camera and the rooms behind them
 * drop to stubs (done in the vertex shader, follows the camera). `down`: all walls are stubs.
 * Roofs are only drawn with walls up.
 */
export type WallMode = 'up' | 'cutaway' | 'down';

/** Tile rectangle of the lot being shown. */
export interface ViewRect {
  x: number;
  z: number;
  w: number;
  d: number;
}

/** An orbit camera pose: angles in radians, distance and target in metres. */
export interface CameraPose {
  alpha: number;
  beta: number;
  radius: number;
  target: [number, number, number];
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
  /** Look of the world (lighting, sky, post-processing); omitted = unchanged. */
  visualStyle?: VisualStyle;
}

/** Translucent preview of an object being placed in buy mode. */
/** Buy-mode feedback played in the world (see `render/babylon/buildFx.ts`). */
export interface BuildEffect {
  kind: 'place' | 'upgrade' | 'sell' | 'build' | 'remove';
  /** Tile rectangle it covers. */
  x: number;
  z: number;
  w: number;
  d: number;
  /** A placed object to spring into place (new or moved furniture). */
  objectId?: number;
}

export interface PlacementGhost {
  /** Asset key of the model (style variant already resolved by the caller, or a base key). */
  model: string;
  /** Min corner (tiles) of the rotated footprint `w`×`d`. */
  x: number;
  z: number;
  /** Quarter turns 0..3, same convention as placed objects. */
  rot: number;
  w: number;
  d: number;
  valid: boolean;
}

/**
 * Wall-tool preview segment. An `h` edge at (x, z) runs from (x, z) to (x + 1, z) in world
 * metres; a `v` edge from (x, z) to (x, z + 1); diagonals cross tile (x, z): `dp` from (x, z)
 * to (x + 1, z + 1), `dn` from (x, z + 1) to (x + 1, z). `open` marks an existing wall for removal.
 */
export interface EdgePreview {
  axis: 'h' | 'v' | 'dp' | 'dn';
  x: number;
  z: number;
  kind: 'wall' | 'door' | 'window' | 'open';
  /** Walls: 1 previews a half wall. */
  form?: number;
}

/** A wall face the Paint tool would cover (`side` 0 looks towards -z / -x / half 0). */
export interface PaintPreviewFace {
  axis: 'h' | 'v' | 'dp' | 'dn';
  x: number;
  z: number;
  side: 0 | 1;
  half: boolean;
}

/** A camera shot of the town overview (menus). */
export interface TownShot {
  /** World rectangle (metres) to keep in view. */
  focus: ViewRect;
  /** Screen area (canvas CSS pixels) to frame the focus into; default: the whole canvas. */
  frame?: { left: number; top: number; right: number; bottom: number };
  /** Orbit angle around the focus (as the game camera's alpha); omitted keeps the current one. */
  alpha?: number;
  /** Tilt from straight down (radians). */
  beta?: number;
  /** Above 1 frames tighter than a fit (the focus may overflow the frame). */
  zoom?: number;
  /** Slow orbit, radians per second. */
  drift?: number;
  /** Gentle back-and-forth around `alpha` (radians either way, about a minute per swing). */
  sway?: number;
  /** Glide time in seconds; 0 cuts. Default 1.2. */
  duration?: number;
  /** Time of day for the light (minute of the day), eased in over the glide; omitted keeps it. */
  minute?: number;
}

/** A shot of the game world for the watching director (`Renderer.setGameShot`). */
export interface GameShot {
  /** Point to look at (metres). */
  target?: { x: number; z: number };
  /** Residents (snapshot indices) to keep in the middle while they move; falls back to `target`. */
  follow?: number[];
  /** Orbit angle (as the camera's alpha); omitted keeps the current one. */
  alpha?: number;
  /** Tilt from straight down (radians). */
  beta?: number;
  /** Distance from the target (metres). */
  radius?: number;
  /** Slow orbit, radians per second. */
  drift?: number;
  /** Glide time in seconds; 0 cuts. */
  duration?: number;
}

/** Which lots of the overview glow (plot ids). */
export interface LotHighlight {
  hover: number | null;
  selected: number | null;
  /** Lots drawn as available (e.g. for sale). */
  marked: readonly number[];
  /** Faint outlines around every lot. */
  outlines: boolean;
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
  /** Switches the visual style live (also possible through `configure`). */
  setVisualStyle(style: VisualStyle): void;
  /** Build/buy mode: object placement preview (null hides it). Cheap; call on every pointer move. */
  setPlacementGhost(ghost: PlacementGhost | null): void;
  /** Build mode: wall/door/removal preview segments; `valid` tints them. Cheap; call on every pointer move. */
  setEdgePreview(edges: readonly EdgePreview[], valid: boolean): void;
  /** Build mode's Paint tool: a film of `color` over the faces it would cover (null: none). */
  setPaintPreview(faces: readonly PaintPreviewFace[], color: string | null): void;
  /** Build mode's Floor tool: a film of `color` over the floor tiles it would cover (null: none). */
  setFloorPreview(tiles: readonly { x: number; z: number }[], color: string | null): void;
  /** Build/buy mode: subtle tile grid over a tile rectangle (null hides it). */
  setBuildGrid(rect: ViewRect | null): void;
  /** Build/buy mode: plays a placement, upgrade, sale or construction effect (after `setWorld` showed the change). */
  buildEffect(fx: BuildEffect): void;
  stats(): RenderStats;
  configure(options: LiveRenderOptions): void;
  /** Small JPEG data URL of the current view, or null if capture isn't possible. */
  captureThumbnail(width: number, height: number): Promise<string | null>;
  /** The game camera's pose (debug reports), and putting it back. */
  cameraPose(): CameraPose;
  setCameraPose(pose: CameraPose): void;
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
  /**
   * Watching: the director takes the game camera and glides to `shot` (or with `cut`, jumps);
   * null hands it straight back to the player where it is.
   */
  setGameShot(shot: GameShot | null, cut?: boolean): void;
  /** Keeps resident `index` (snapshot index) in the middle while the player turns and zooms; null stops. */
  followSim(index: number | null): void;
  /** Removes the current world (end of a session); cached meshes and the landscape are kept. */
  clear(): void;
  /**
   * Menus: draws an overview of `world` (every lot as a dressed shell, no interiors or Sims) in
   * place of the game world, which stays loaded, hidden, and can keep building meanwhile.
   * Lighting is fixed at `minute` of the day. Resolves once the overview is built.
   */
  showTown(world: WorldStructure, minute: number): Promise<void>;
  /**
   * Back to the game world (the overview is kept for the next menu). With `glide` > 0 the camera
   * first flies from the overview into the game's view (seconds); resolves when it is shown.
   */
  hideTown(glide?: number): Promise<void>;
  /** Whether the overview is on screen. */
  readonly townShown: boolean;
  /** Overview camera: glides to (or with `cut`, jumps to) a shot. */
  setTownShot(shot: TownShot, cut?: boolean): void;
  /** Overview camera: user orbit (radians) and zoom factor on top of the shot. */
  nudgeTown(dAlpha: number, zoom: number): void;
  setLotHighlight(highlight: LotHighlight): void;
  /** Runs each overview frame after the camera moved, before drawing (to pin labels); null removes it. */
  onTownFrame(fn: (() => void) | null): void;
  dispose(): void;
}

// --- Sim previews (household-creator stage and portraits; `render/preview`) --------------------

/** What a Sim looks like: everything a preview or portrait is drawn from. */
export interface SimLook {
  gender: string;
  appearance: Appearance;
  /**
   * The Sim's id in a running game. Sims from older saves have no garments in their appearance;
   * the game then derives them from the id, and so do portraits.
   */
  id?: number;
}

/**
 * Short reactions on the household-creator stage: `hello` (a wave), `cheer` (randomized: a wave and a
 * big smile), `admire` (a look at the new look), or `trait:<id>` (a trait's typical expression or
 * gesture; unknown traits get a friendly nod).
 */
export type StageReaction = 'hello' | 'cheer' | 'admire' | `trait:${string}`;

/** The live 3D household-creator stage (a transparent canvas filling its host element). */
export interface SimStage {
  /** Shows a Sim; appearance changes restyle it without restarting its animation. */
  show(look: SimLook): void;
  react(reaction: StageReaction): void;
  /** Framing: 0 = full body .. 1 = face (animated). */
  zoomTo(zoom: number): void;
  /** Called when the framing target changes (wheel, double-click, `zoomTo`). */
  onZoom: ((zoom: number) => void) | null;
  /** Removes the canvas; the preview engine is released when nothing else needs it. */
  detach(): void;
}

/** Garments a body can wear (character part names), for the creator's choices. */
export interface Wardrobe {
  tops: string[];
  bottoms: string[];
  shoes: string[];
  /** Whether the body has facial hair. */
  beard: boolean;
}

/**
 * 3D Sim previews from the in-game character pipeline: the household-creator stage and cached
 * head-and-shoulders portraits. One small engine serves both; it exists only while a stage is
 * attached or portraits are being rendered.
 */
/** Catalog pictures of furniture models (see `render/preview/items.ts`). */
export interface ItemPreviews {
  /**
   * Picture of a model (asset key, style variant resolved), cached for the page and between
   * visits. `now` requests (on screen) come first, `idle` ones are drawn ahead of time; aborting
   * withdraws a request. Null when 3D is unavailable (or aborted).
   */
  thumbnail(model: string, footprint: [number, number], priority?: 'now' | 'idle', signal?: AbortSignal): Promise<string | null>;
  /** Draws pictures ahead of time, in idle moments (opening the catalog is then instant). */
  prefetch(models: readonly { model: string; footprint: [number, number] }[]): void;
  /** The cached picture, if it has been drawn. */
  cachedThumbnail(model: string): string | null;
  /** The model seen from `frames` angles, turning once around (the catalog's drag-to-turn preview). */
  turntable(model: string, footprint: [number, number], frames: number): Promise<string[] | null>;
}

export interface SimPreviews {
  /** Attaches the stage to `host`; null when 3D characters are unavailable. */
  stage(host: HTMLElement): Promise<SimStage | null>;
  /** Portrait image URL (cached by look; batched). Null when 3D characters are unavailable. */
  portrait(look: SimLook): Promise<string | null>;
  /** The cached portrait URL, if there is one already. */
  cachedPortrait(look: SimLook): string | null;
  /** Renders portraits ahead of time (e.g. everyone in a game being prepared). */
  prefetch(looks: readonly SimLook[]): void;
  wardrobe(gender: string): Promise<Wardrobe | null>;
}
