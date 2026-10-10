/**
 * Babylon.js implementation of the Renderer contract.
 *
 * Performance model:
 * - WebGPU first (WebGL2 fallback). With WebGPU, snapshot rendering records the frame's
 *   draw commands once and replays them; it is re-recorded only on structural changes.
 * - Every object type is one mesh drawn with thin instances (one draw call per type).
 * - Sims are skinned characters (characters.ts): thin instances per body part, GPU skinning
 *   from one pose texture that is rewritten each frame (no new draw commands).
 * - The viewed house is generated into one mesh per material (house.ts); the cutaway is done
 *   in the vertex shader from a per-vertex attribute.
 * - No allocations in `update()`.
 *
 * Look: a visual style (styles.ts) drives lighting keys, sky, fog, post-processing, colour
 * grading and filtering; it can change live.
 */

import {
  ArcRotateCamera,
  type ArcRotateCameraPointersInput,
  Color3,
  Color4,
  ColorCurves,
  Constants,
  DefaultRenderingPipeline,
  DirectionalLight,
  DynamicTexture,
  Engine,
  HemisphericLight,
  ImageProcessingConfiguration,
  Light,
  Material,
  Matrix,
  Mesh,
  MeshBuilder,
  PBRMaterial,
  PointLight,
  ClusteredLightContainer,
  Quaternion,
  Scene,
  SceneInstrumentation,
  CreateScreenshotAsync,
  ShadowGenerator,
  SSAO2RenderingPipeline,
  StandardMaterial,
  TransformNode,
  Vector3,
  VertexBuffer,
  VertexData,
  Viewport,
  WebGPUEngine,
  type AbstractEngine,
} from '@babylonjs/core';
import type { FrameState } from '../../core/bridge';
import { groundDepth, type MeshArrays, type ObjectPlacement, type WorldStructure } from '../../core/protocol';
import type { QualitySettings } from '../quality';
import { stylePreset, type StylePreset, type VisualStyle } from '../styles';
import type {
  BuildEffect,
  CameraPose,
  EdgePreview,
  GameShot,
  LiveRenderOptions,
  PaintPreviewFace,
  RoomOverlayTile,
  LotHighlight,
  PickResult,
  PlacementGhost,
  Renderer,
  RendererDeps,
  RenderStats,
  TownShot,
  ViewRect,
  WallMode,
} from '../types';
import { createLighting, lightingAt } from './environment';
import { buildFences } from './fences';
import { applyShaderFixes } from './shaderFixes';
import { HALF_WALL_HEIGHT, HouseBuilder, houseObjectKey, placeLights, WALL_HEIGHT, WALL_STUB, type HouseSurfaces, type RoomLight, type RoomTiles } from './house';
import { Street } from './street';
import { MaterialLibrary } from './materials';
import { buildModel, placementVariation, type ModelTemplate } from './models';
import { Characters, MAX_CHARACTERS } from './characters';
import { installNature, Landscape, natureDecor, Sky } from './nature';
import { LAYER_ALL, LAYER_TOWN, LAYER_WORLD } from './layers';
import { NightGrade } from './nightGrade';
import { BuildEffects, type PopTarget } from './buildFx';
import { TownOverview } from './overview';
import { GameCameraRig } from './cameraRig';

const ACCENT = Color3.FromHexString('#5B7CFA');
/** Helpers are parked below the ground instead of toggling visibility (keeps snapshots valid). */
const HIDDEN_Y = -100;
/** Height of the fence and gate preview while drawing. */
const FENCE_PREVIEW_HEIGHT = 1.0;
/** Game minutes between lighting updates (with / without snapshot rendering). */
const LIGHT_STEP = 0.5;
const LIGHT_STEP_SNAPSHOT = 5;
/**
 * Interior lights: the household's lamps first, then dim fills for rooms without one. With
 * clustered lighting (WebGPU, and WebGL2 with float blending) they live in one
 * `ClusteredLightContainer` (one light to the materials) and many lamps light at once
 * (quality `clusteredLamps`); otherwise each is a forward light and only a few fit.
 * `?lights=forward|clustered` forces one for testing.
 */
const ROOM_LIGHTS = 4;
const CLUSTERED_LIGHTS = 32;
/** Brightness of a lamp at night (times its content `intensity`). */
const LAMP_POWER = 7;
/** A room without a lamp gets this share of the light it had before lamps gave light. */
const FILL_POWER = 0.35;
/** Camera distance below which the viewed lot's roof is hidden even with walls up. */
const ROOF_MIN_DISTANCE = 15;
/** Capacity of the wall-tool preview buffers (grown on demand). */
const PREVIEW_CAPACITY = 128;

interface PlacedObject {
  id: number;
  /** Where it stands, on the storey it's on (`y0`: that storey's floor). */
  y0: number;
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
  height: number;
  /** Its instance in the template's matrix buffer (for the placement pop). */
  pop: PopTarget;
  /** Its contact shadow's instance. */
  shadow?: PopTarget;
}

const MAX_SIMS = MAX_CHARACTERS;
/** How far the road (and garden paths) is drawn beyond the viewed lot: the whole street. */
const STREET_MARGIN = 500;
/** Sims are drawn this far outside the lot (e.g. walking up the garden path). */
const SIM_VIEW_MARGIN = 2;
/** Selection marker colour slot (0 = great .. 4 = bad) per emotion id; no emotion = slot 1. */
const EMOTION_MOOD: Record<string, number> = { happy: 0, flirty: 0, confident: 0, focused: 0, inspired: 0, energized: 0, relaxed: 0, embarrassed: 3, sad: 3, tense: 3, angry: 4 };
/** Game camera zoom limits (the overview lifts them while it drives the camera). */
const RADIUS_LIMITS = [6, 95] as const;
/** Frames in which a game world built behind the overview is also drawn (hidden), so its shaders and pipelines are ready when it is shown. */
const WARM_WORLD_FRAMES = 4;

/** A landscape, shared by the game world and the overview when they are the same town. */
interface NatureSet {
  /** Kept to refresh the lawn when rooms or objects change (build mode). */
  landscape: Landscape;
  meshes: Mesh[];
  casters: Mesh[];
  ready: Promise<void>;
  users: Set<'world' | 'town'>;
  pending: number;
}

export class BabylonRenderer implements Renderer {
  private engine!: AbstractEngine;
  private webgpu: WebGPUEngine | null = null;
  private scene!: Scene;
  private camera!: ArcRotateCamera;
  private sun!: DirectionalLight;
  private sky!: HemisphericLight;
  private shadows!: ShadowGenerator;
  private post: DefaultRenderingPipeline | null = null;
  private nightGrade: NightGrade | null = null;
  private instrumentation!: SceneInstrumentation;
  /** Main-thread ms per frame, smoothed (see `stats`). */
  private cpuMs = 0;
  private canvas!: HTMLCanvasElement;
  private lib!: MaterialLibrary;
  private house!: HouseBuilder;
  /** Neighbour houses, sidewalks, streetlights, gardens and cars (street.ts). */
  private street!: Street;

  private worldMeshes: Mesh[] = [];
  /**
   * The viewed lot's streets, house and fences: rebuilt only when what they depend on changes
   * (see `lotKey`), so buying, selling and moving furniture rebuild just the objects.
   */
  private lotMeshes: Mesh[] = [];
  private lotKey = '';
  /** Shadow casters of the cached house, and the garden templates its build uses. */
  private lotCasters: Mesh[] = [];
  private lotTemplates = new Set<string>();
  /** Rooms of the cached house (where its lamps' and fills' lights go). */
  private lotRooms: RoomTiles | null = null;
  /** Where coverings lie in the viewed house (null: plain fallback meshes). */
  private lotSurfaces: HouseSurfaces | null = null;
  /** The Paint and Floor tools' previews in the real look: what they show, and the mesh. */
  private laid = {
    faces: { keys: [] as string[], cover: null as number | null, shown: '', mesh: null as Mesh | null },
    floors: { keys: [] as string[], cover: null as number | null, shown: '', mesh: null as Mesh | null },
  };
  /** Meshes the room lights were last told to leave out (the landscape and sky). */
  private lightExcluded = new Set<Mesh>();
  private onFrame: ((now: number) => void) | null = null;
  private active = false;
  private idleOrbit = false;
  /** The watching director's hold on the game camera (see `setGameShot`). */
  private gameRig!: GameCameraRig;
  /** Resident the camera keeps centred while the player turns and zooms (`followSim`). */
  private followIndex: number | null = null;
  private readonly followHead = { x: 0, y: 0, z: 0 };
  private frameWaiters: { left: number; resolve: () => void }[] = [];
  /**
   * Built model templates by key, kept across lot switches and sessions (building them
   * is expensive). Templates not used by the current world are disabled, not disposed.
   */
  private readonly templates = new Map<string, Promise<ModelTemplate>>();
  private readonly templatesInUse = new Set<string>();
  /** Landscape shadow casters (the landscape survives lot switches; rebuilt only for a different town). */
  private natureCasters: Mesh[] = [];
  /** Landscapes by town (seed and size), and which one each layer shows. */
  private readonly natures = new Map<string, NatureSet>();
  private readonly natureIn: Record<'world' | 'town', NatureSet | null> = { world: null, town: null };
  private readonly natureTicket = { world: 0, town: 0 };

  // Town overview (menus), on its own camera layer; see `showTown`.
  private overview: TownOverview | null = null;
  private townMode = false;
  /** Overview lighting: the minute shown and the one it eases towards. */
  private townMinute = 18 * 60;
  private townMinuteGoal = 18 * 60;
  private townShot: TownShot | null = null;
  private townHighlight: LotHighlight | null = null;
  private townListener: (() => void) | null = null;
  private townTicket = 0;
  private townQueue: Promise<void> = Promise.resolve();
  /** Holds the game camera's pose while the overview drives the real camera. */
  private parked!: ArcRotateCamera;
  private warmFrames = 0;
  private worldBuilding = false;
  /** World/overview builds in progress; snapshot recording waits until there are none. */
  private builds = 0;
  private snapshotGeneration = 0;
  private readonly warmPose = { alpha: 0, beta: 0, radius: 0, x: 0, y: 0, z: 0, ox: 0, oy: 0 };
  /** Lot being shown; null = everything. */
  private view: ViewRect | null = null;
  /** Fallback walls (simulation meshes) when the house builder can't read the layout. */
  private walls: Mesh | null = null;
  private wallsLow: Mesh | null = null;
  private roofs: Mesh[] = [];
  private roofShown = false;
  /** Shadow casters without the house walls, and the walls (they cast only with walls up). */
  private baseCasters: Mesh[] = [];
  private wallCasters: Mesh[] = [];
  private wallMode: WallMode = 'down';
  /** Camera look bits for the cutaway (+x, -x, +z, -z). */
  private cutLook = -1;
  private placed: PlacedObject[] = [];
  private characters!: Characters;
  private cursor!: Mesh;
  private selectedSim: number | null = null;
  private cameraPlaced = false;
  /** Lot the camera was last turned towards (see `buildSims`). */
  private framedView = '';

  private style: StylePreset;
  private options: LiveRenderOptions = { resolutionScale: 1, cameraSensitivity: 1 };
  private skyDome!: Sky;
  private readonly lighting = createLighting();
  private lastLightMinute = -1;
  /** Storeys (sim-core `storeys.rs`): how many, rows per storey, and the one in view (higher ones are hidden). */
  private storeys = { count: 1, depth: 0 };
  private storey = 0;
  /** Build helpers (cursor, ghost, grid, previews) work in lot rows; this lifts them to the storey in view. */
  private storeyLayer!: TransformNode;
  /** The world last built (built again when the storey in view changes). */
  private lastWorld: WorldStructure | null = null;
  private lastMinute = 12 * 60;
  private readonly lotCentre = new Vector3();
  /** `?debug`: expose the scene/renderer on `window` and log build timings. */
  private readonly debug = new URLSearchParams(location.search).has('debug');
  /** `?hour=21` freezes the lighting at that hour (for screenshots and look development). */
  private readonly fixedHour: number | null;
  private readonly roomLights: PointLight[] = [];
  /** Holds the room lights when lighting is clustered (null: forward lights). */
  private lampCluster: ClusteredLightContainer | null = null;
  /** What each interior light is lighting (null: unused). */
  private roomLightUse: (RoomLight | null)[] = [];
  private readonly lampColor = new Color3();
  private readonly glowColor = new Color3();

  // Selection marker (sparkle star, outline, glow halo) and contact shadows (thin instances
  // updated per frame).
  private marker: Mesh[] = [];
  private markerHalo!: Mesh;
  private readonly markerMatrix = new Float32Array(16);
  private readonly markerColor = new Float32Array(4);
  private readonly markerOutlineColor = new Float32Array(4);
  private readonly markerHaloMatrix = new Float32Array(16);
  private readonly markerHaloColor = new Float32Array(4);
  private markerPalette: number[][] = [];
  private emotionMood: number[] = [];
  private simShadow!: Mesh;
  private readonly simShadowMatrices = new Float32Array(MAX_SIMS * 16);
  private objectShadow!: Mesh;

  // Build mode helpers.
  private ghostRoot!: TransformNode;
  private ghostKey = '';
  private ghostMeshes: Mesh[] = [];
  private readonly ghostColor = new Float32Array(4);
  private ghostMaterial!: StandardMaterial;
  /** Flat arrow on the tile the ghost is used from, pointing out of it. */
  private ghostArrow!: Mesh;
  private ghostArrowMaterial!: StandardMaterial;
  private ghostValid = true;
  /** The ghost glides to its tile and turns smoothly; it floats a little, as if held. */
  private ghostShown = false;
  private readonly ghostGoal = new Vector3();
  private ghostYawGoal = 0;
  private ghostAge = 0;
  private ghostSpawn = 0;
  /** The placed object in hand, hidden (its instances shrunk to nothing; their matrices kept to restore). */
  private heldId: number | null = null;
  private held: { id: number; saved: { target: PopTarget; matrix: Float32Array }[] } | null = null;
  private heldRelease: ReturnType<typeof setTimeout> | null = null;
  private fx!: BuildEffects;
  private previewMeshes!: Record<'wall' | 'door' | 'window' | 'open', Mesh>;
  private previewBuffers!: Record<'wall' | 'door' | 'window' | 'open', Float32Array>;
  private previewValid = true;
  private grid!: Mesh;
  private gridOn = false;
  private paintPreview!: Mesh;
  private paintBuffer = new Float32Array(64 * 16);
  private floorPreview!: Mesh;
  private floorBuffer = new Float32Array(64 * 16);
  private roomOverlay: Mesh | null = null;
  private roomMatrices = new Float32Array(0);
  private roomColors = new Float32Array(0);

  // Scratch objects for allocation-free updates.
  private readonly mOut = new Matrix();
  private simCount = 0;
  private readonly simInView = (x: number, z: number) => this.inView(x, z, SIM_VIEW_MARGIN);
  private readonly vTmp = new Vector3();
  private readonly vScale = new Vector3();
  private readonly qTmp = new Quaternion();
  private readonly vProj = new Vector3();
  private readonly viewport = new Viewport(0, 0, 1, 1);
  /** Camera alpha, beta, radius, target x/y/z and screen offset x/y at the last frame. */
  private readonly lastView = new Float64Array(8);

  constructor(
    private readonly deps: RendererDeps,
    private readonly quality: QualitySettings,
  ) {
    this.style = stylePreset(quality.visualStyle);
    const hour = Number(new URLSearchParams(location.search).get('hour'));
    this.fixedHour = Number.isFinite(hour) && new URLSearchParams(location.search).has('hour') ? hour : null;
  }

  async init(canvas: HTMLCanvasElement): Promise<void> {
    this.canvas = canvas;
    const forceWebGL = this.deps.backend === 'webgl' || new URLSearchParams(location.search).get('renderer') === 'webgl';
    if (!forceWebGL && (await WebGPUEngine.IsSupportedAsync)) {
      const engine = new WebGPUEngine(canvas, { antialias: true, adaptToDeviceRatio: true, powerPreference: 'high-performance' });
      await engine.initAsync();
      this.engine = this.webgpu = engine;
    } else {
      this.engine = new Engine(canvas, true, { adaptToDeviceRatio: true, powerPreference: 'high-performance' });
    }

    const scene = (this.scene = new Scene(this.engine));
    // Picking is analytic (see `pick`); never let Babylon raycast the scene on pointer moves.
    scene.skipPointerMovePicking = true;
    scene.constantlyUpdateMeshUnderPointer = false;
    this.instrumentation = new SceneInstrumentation(scene);
    // `?debug`: expose the scene for inspection from the console / test harness.
    if (this.debug) Object.assign(window, { __scene: scene, __renderer: this });
    // PBR materials and image-based lighting; the environment must exist before materials compile.
    this.lib = MaterialLibrary.for(scene).setAssets(this.deps.assets);
    // Frozen and thawed materials bind differently; a recording made while some were thawed
    // (lighting changes) goes stale once they refreeze, so record again.
    this.lib.onRefrozen = () => this.resetSnapshot();
    this.house = new HouseBuilder(scene);
    const c = this.deps.content;
    this.house.setLooks({
      coverings: c.wallCoverings,
      floors: c.floorCoverings,
      doors: c.doorStyles,
      windows: c.windowStyles,
      roofs: c.roofStyles,
      roofColors: c.roofColors,
    });
    this.street = new Street(scene, this.deps.assets, this.house);
    // Wind sway and tint variation for foliage materials (hooks them as the models load).
    installNature(scene);
    await this.setupEnvironment();

    this.setupCamera();
    this.setupLights();
    this.skyDome = new Sky(scene, 700, this.deps.assets.has('image.clouds', 'image') ? this.deps.assets.get('image.clouds', 'image')!.url : undefined);
    this.skyDome.setLayerMask(LAYER_ALL);
    // Distance fog in the horizon colour makes the hills fade into the sky (aerial haze).
    scene.fogMode = Scene.FOGMODE_EXP2;
    this.setupPostProcessing();
    this.setupHelpers();
    await this.setupMarker();
    this.characters = new Characters(scene, this.deps.assets, this.lib);
    void this.characters.init();
    this.applyStyle();
    window.addEventListener('resize', this.onResize);
  }

  async setWorld(world: WorldStructure, view: ViewRect | null): Promise<void> {
    this.lastWorld = world;
    this.storeys = { count: world.storeys ?? 1, depth: groundDepth(world) };
    if (this.storey >= this.storeys.count) this.setStorey(this.storeys.count - 1);
    this.beginBuild();
    this.worldBuilding = true;
    try {
      await this.buildWorld(world, view);
    } finally {
      this.worldBuilding = false;
      this.endBuild();
    }
    // Built behind the overview (prepared in a menu): draw it hidden a few times so it shows without a hitch.
    if (this.townMode) this.warmFrames = WARM_WORLD_FRAMES;
  }

  /** The lot arrays the last key was made from, and that key (they arrive unchanged when only furniture moved). */
  private lotParts: { refs: unknown[]; key: string } | null = null;

  /** Everything the lot layer (streets, house, fences) is built from. */
  private lotKeyOf(world: WorldStructure, view: ViewRect | null): string {
    const refs = [world.meta, world.walls, world.openings, world.diagonals, world.floors, world.fences];
    if (!this.lotParts || this.lotParts.refs.some((r, i) => r !== refs[i])) {
      const m = world.meta;
      this.lotParts = { refs, key: JSON.stringify([m?.seed, m?.streets, m?.paths, world.walls, world.openings, world.diagonals, world.floors, world.fences]) };
    }
    return JSON.stringify([
      view,
      world.width,
      world.depth,
      this.lotParts.key,
      world.plots.map((p) => [p.house, p.roof]),
      world.households.find((h) => h.player)?.plot,
      houseObjectKey(world, view),
    ]);
  }

  private async buildWorld(world: WorldStructure, view: ViewRect | null): Promise<void> {
    const started = performance.now();
    for (const mesh of this.worldMeshes) mesh.dispose(false, false);
    this.worldMeshes = [];
    this.placed = [];
    this.fx.clearPops();
    // The held object's buffers go with the old world; a moved one now shows in its new place.
    this.held = null;
    if (this.heldRelease) clearTimeout(this.heldRelease);
    this.heldRelease = null;
    this.view = view;

    const { width, depth } = world;
    this.lotCentre.set(view ? view.x + view.w / 2 : width / 2, 0, view ? view.z + view.d / 2 : depth / 2);
    if (!this.cameraPlaced) {
      // (Re-aims from the camera's current position; a parked camera computes it first.)
      this.gameCamera.getViewMatrix(true);
      this.gameCamera.setTarget(this.lotCentre.clone());
      this.cameraPlaced = true;
    }

    // The landscape depends only on the town, not on which lot is viewed (and may be the overview's).
    const nature = await this.useNature('world', world);
    // No grass through floors of rooms built (or furniture bought) since the lawn was scattered.
    nature.landscape.refreshLawn(world);
    this.natureCasters = nature.casters;
    this.templatesInUse.clear();
    const lotKey = this.lotKeyOf(world, view);
    const lotBuilt = lotKey !== this.lotKey;
    if (lotBuilt) {
      for (const mesh of this.lotMeshes) mesh.dispose(false, false);
      this.lotKey = lotKey;
      this.roofs = [];
      this.walls = this.wallsLow = null;
      const before = new Set(this.templatesInUse);
      this.buildStreets(world);
      this.lotCasters = this.buildLot(world);
      const fences = buildFences(this.scene, world.fences ?? [], this.deps.content.fenceStyles);
      if (fences) this.worldMeshes.push(fences);
      // What was just built belongs to the lot layer; objects follow in `worldMeshes`.
      this.lotMeshes = this.worldMeshes;
      this.worldMeshes = [];
      this.lotTemplates = new Set([...this.templatesInUse].filter((k) => !before.has(k)));
      for (const mesh of this.lotMeshes) mesh.freezeWorldMatrix();
    } else {
      for (const key of this.lotTemplates) this.templatesInUse.add(key);
    }
    const houseCasters = this.lotCasters;
    this.placeRoomLights(world, view);
    const streetCasters = await this.street.build(world, this.view);
    await this.buildObjects(world);
    this.hideHeld();
    await this.buildSims(world);
    this.retireTemplates(new Set(this.templatesInUse));
    const templates = await this.templateMeshes();

    const notCasting = new Set(['floors', 'floorsTiled', 'floorsCarpet', 'floorsStone', 'streets', 'paths', 'contactShadows', 'objectShadows', 'windows', 'windowsInner', 'plinth', 'wallsTiled']);
    this.baseCasters = [
      ...new Set([
        ...[...this.lotMeshes, ...this.worldMeshes].filter((m) => !notCasting.has(m.name) && !m.name.startsWith('silhouette') && !houseCasters.includes(m)),
        ...templates,
        // Sims' small details (eyes, brows) don't cast sun shadows.
        ...this.characters.casters(),
        ...this.natureCasters,
        ...streetCasters,
      ]),
    ];
    this.wallCasters = houseCasters;
    for (const mesh of [...this.worldMeshes, ...templates]) mesh.freezeWorldMatrix();
    this.applyWallMode();
    this.applyStoreys();
    this.lastLightMinute = -1;
    if (this.debug) console.info(`[render] setWorld ${(performance.now() - started).toFixed(1)} ms${lotBuilt ? '' : ' (lot kept)'}`);
  }

  update(frame: FrameState): void {
    const { curr, layout, now } = frame;
    // Snapshot rendering bakes light uniforms and the clear colour into the recording, so
    // lighting changes force a re-record; throttle them to keep most frames replayed.
    const minute = this.fixedHour !== null ? this.fixedHour * 60 : curr[layout.header.minute];
    this.lastMinute = minute;
    // Behind the overview the game world waits (nothing of it is drawn).
    if (this.townMode) return;
    const snapshot = this.webgpu?.snapshotRendering ?? false;
    if (Math.abs(minute - this.lastLightMinute) >= (snapshot ? LIGHT_STEP_SNAPSHOT : LIGHT_STEP)) {
      this.applyLighting(minute);
      this.lastLightMinute = minute;
      this.resetSnapshot();
    }
    this.steerCamera(this.engine.getDeltaTime() / 1000);
    this.updateCutaway();
    this.followCamera();
    this.skyDome.drift(this.engine.getDeltaTime());
    this.fx.update(this.engine.getDeltaTime());
    if (this.ghostShown) this.updateGhost(this.engine.getDeltaTime());
    if (this.roofs.length && this.roofVisible() !== this.roofShown) {
      this.roofShown = !this.roofShown;
      this.showRoofs();
      this.resetSnapshot();
    }

    const count = Math.min(curr[layout.header.simCount], MAX_SIMS);
    this.simCount = count;
    this.markerMatrix.fill(0);
    this.markerHaloMatrix.fill(0);
    // Sims: pose every visible Sim into the shared pose texture (characters.ts).
    this.characters.update(frame, this.simInView, this.simShadowMatrices, this.storey);
    const sel = this.selectedSim;
    if (sel !== null && sel < count && this.characters.visible[sel]) {
      const h = this.characters.heads;
      const emotion = curr[layout.headerLen + sel * layout.simStride + layout.sim.emotion];
      this.writeMarker(h[sel * 3], h[sel * 3 + 1], h[sel * 3 + 2], emotion, now);
    }
    this.simShadow.thinInstanceBufferUpdated('matrix');
    for (const mesh of this.marker) {
      mesh.thinInstanceBufferUpdated('matrix');
      mesh.thinInstanceBufferUpdated('color');
    }
    this.markerHalo.thinInstanceBufferUpdated('matrix');
    this.markerHalo.thinInstanceBufferUpdated('color');
  }

  pick(x: number, y: number): PickResult {
    const ray = this.scene.createPickingRay(x, y, null, this.camera);
    const o = ray.origin;
    const d = ray.direction;
    let ground: PickResult['ground'] = null;
    // The floor of the storey in view, answered in its rows of the lot.
    const floor = this.storey * WALL_HEIGHT;
    if (d.y < -1e-6 && o.y > floor) {
      const t = (floor - o.y) / d.y;
      ground = { x: o.x + d.x * t, z: o.z + d.z * t + this.storey * this.storeys.depth };
    }
    let objectId: number | null = null;
    let nearest = Infinity;
    for (const p of this.placed) {
      const t = rayBox(o, d, p.minX, p.y0, p.minZ, p.maxX, p.y0 + p.height, p.maxZ);
      if (t < nearest) {
        nearest = t;
        objectId = p.id;
      }
    }
    return { ground, objectId };
  }

  project(x: number, y: number, z: number, out: { x: number; y: number }): boolean {
    this.viewport.width = this.canvas.clientWidth;
    this.viewport.height = this.canvas.clientHeight;
    this.vTmp.set(x, y, z);
    // The overview moves the camera just before drawing: project with its current matrices.
    const transform = this.townMode ? this.camera.getTransformationMatrix() : this.scene.getTransformMatrix();
    Vector3.ProjectToRef(this.vTmp, Matrix.IdentityReadOnly, transform, this.viewport, this.vProj);
    if (this.vProj.z < 0 || this.vProj.z > 1) return false;
    out.x = this.vProj.x;
    out.y = this.vProj.y;
    return true;
  }

  simHead(index: number, out: { x: number; y: number; z: number }): boolean {
    return index < this.simCount && this.characters.head(index, out);
  }

  focus(x: number, z: number): void {
    // Keep the viewing angle; move the camera with its target (setTarget's default
    // would keep the camera's position and swing the angles instead).
    const cam = this.gameCamera;
    cam.setTarget(new Vector3(x, 0, z), false, false, true);
    cam.radius = Math.min(cam.radius, 32);
    this.cameraPlaced = true;
  }

  setHoverTile(tile: { x: number; z: number } | null): void {
    if (tile) this.cursor.position.set(tile.x + 0.5, 0.025, tile.z + 0.5);
    else this.cursor.position.y = HIDDEN_Y;
  }

  setSelectedSim(id: number | null): void {
    this.selectedSim = id;
    this.characters?.select(id);
  }

  setWallMode(mode: WallMode): void {
    this.wallMode = mode;
    this.applyWallMode();
    this.resetSnapshot();
  }

  setVisualStyle(style: VisualStyle): void {
    if (style === this.style.id) return;
    this.style = stylePreset(style);
    this.applyStyle();
  }

  configure(options: LiveRenderOptions): void {
    this.options = { ...this.options, ...options };
    if (options.visualStyle && options.visualStyle !== this.style.id) this.style = stylePreset(options.visualStyle);
    const s = Math.max(0.25, options.cameraSensitivity);
    this.camera.angularSensibilityX = this.camera.angularSensibilityY = 1000 / s;
    this.camera.panningSensibility = 90 / s;
    this.camera.wheelDeltaPercentage = 0.012 * s;
    this.applyStyle();
  }

  // --- build mode ----------------------------------------------------------------------

  setPlacementGhost(ghost: PlacementGhost | null): void {
    if (!ghost) {
      this.ghostShown = false;
      if (this.ghostRoot.position.y !== HIDDEN_Y) {
        this.ghostRoot.position.y = HIDDEN_Y;
        this.ghostRoot.computeWorldMatrix(true);
      }
      return;
    }
    const fresh = !this.ghostShown || ghost.model !== this.ghostKey;
    if (ghost.model !== this.ghostKey) this.loadGhost(ghost.model);
    // Rotate about the footprint centre, like placed objects. The turn takes the short way round.
    this.ghostGoal.set(ghost.x + ghost.w / 2, 0, ghost.z + ghost.d / 2);
    const yaw = (ghost.rot * Math.PI) / 2 + ((ghost.turn ?? 0) * Math.PI) / 180;
    const turn = Math.atan2(Math.sin(yaw - this.ghostYawGoal), Math.cos(yaw - this.ghostYawGoal));
    this.ghostYawGoal += turn;
    if (!this.ghostShown) {
      this.ghostRoot.position.copyFrom(this.ghostGoal);
      this.ghostRoot.rotation.y = this.ghostYawGoal = yaw;
    }
    if (fresh) this.ghostSpawn = 0;
    this.ghostShown = true;
    // The arrow rides with the ghost but ignores its free turn: the use tile goes by quarter turns.
    const arrow = this.ghostArrow;
    if (arrow.isEnabled() !== !!ghost.front) {
      arrow.setEnabled(!!ghost.front);
      this.resetSnapshot();
    }
    if (ghost.front) {
      const dx = ghost.front.x + 0.5 - this.ghostGoal.x;
      const dz = ghost.front.z + 0.5 - this.ghostGoal.z;
      const c = Math.cos(yaw);
      const s = Math.sin(yaw);
      // World offset into the ghost's turned frame; just above the floor below the floating ghost.
      arrow.position.set(dx * c - dz * s, -0.04, dx * s + dz * c);
      arrow.rotation.y = (-(ghost.turn ?? 0) * Math.PI) / 180;
    }
    if (ghost.valid !== this.ghostValid) {
      this.ghostValid = ghost.valid;
      this.setGhostTint();
    }
  }

  setHeldObject(id: number | null, moved = false): void {
    if (id === this.heldId) return;
    if (this.heldRelease) clearTimeout(this.heldRelease);
    this.heldRelease = null;
    this.heldId = id;
    if (id === null && moved) {
      // Put down elsewhere: the next world shows it there; a refused move shows it here again.
      this.heldRelease = setTimeout(() => ((this.heldRelease = null), this.showHeld()), 1500);
      return;
    }
    this.hideHeld();
  }

  private hideHeld(): void {
    if (this.held?.id === this.heldId) return;
    this.showHeld();
    const p = this.heldId === null ? undefined : this.placed.find((o) => o.id === this.heldId);
    if (!p) return;
    const targets = p.shadow ? [p.pop, p.shadow] : [p.pop];
    this.held = { id: p.id, saved: targets.map((target) => ({ target, matrix: target.matrices.slice(target.index * 16, target.index * 16 + 16) })) };
    // Scaled to nothing where it stands (an all-zero matrix would put w = 0).
    for (const { target, matrix } of this.held.saved) {
      const m = matrix.slice();
      m.fill(0, 0, 12);
      this.writeInstance(target, m);
    }
  }

  private showHeld(): void {
    if (!this.held) return;
    for (const { target, matrix } of this.held.saved) this.writeInstance(target, matrix);
    this.held = null;
  }

  private writeInstance(target: PopTarget, matrix: Float32Array): void {
    target.matrices.set(matrix, target.index * 16);
    for (const mesh of target.meshes) {
      if (mesh.isDisposed()) continue;
      mesh.thinInstanceAllowAutomaticStaticBufferRecreation = true;
      mesh.thinInstanceBufferUpdated('matrix');
    }
    this.resetSnapshot();
  }

  private updateGhost(dtMs: number): void {
    const dt = Math.min(dtMs, 50) / 1000;
    this.ghostAge += dt;
    this.ghostSpawn += dt;
    const root = this.ghostRoot;
    const glide = 1 - Math.exp(-dt * 22);
    root.position.x += (this.ghostGoal.x - root.position.x) * glide;
    root.position.z += (this.ghostGoal.z - root.position.z) * glide;
    root.rotation.y += (this.ghostYawGoal - root.rotation.y) * (1 - Math.exp(-dt * 16));
    // Held a hand's breadth above the floor, bobbing gently; picked up with a springy pop.
    root.position.y = 0.07 + 0.035 * Math.sin(this.ghostAge * 3.4);
    const t = this.ghostSpawn;
    const s = t > 0.6 ? 1 : 1 - Math.exp(-8 * t) * Math.cos(14 * t);
    root.scaling.set(s, s, s);
    // Where it can't go, it pulses.
    this.ghostMaterial.alpha = this.ghostValid ? 0.5 : 0.36 + 0.14 * Math.sin(this.ghostAge * 9);
    this.ghostArrowMaterial.alpha = this.ghostMaterial.alpha + 0.25;
  }

  buildEffect(fx: BuildEffect): void {
    if (this.townMode) return;
    const k = this.storeyOf(fx.z);
    this.fx.play({ ...fx, z: fx.z - k * this.storeys.depth, y: k * WALL_HEIGHT });
    const placed = fx.objectId === undefined ? undefined : this.placed.find((p) => p.id === fx.objectId);
    if (placed && placed.id !== this.heldId) this.fx.pop(placed.pop);
  }

  setEdgePreview(edges: readonly EdgePreview[], valid: boolean): void {
    const counts = { wall: 0, door: 0, window: 0, open: 0 };
    for (const e of edges) {
      // Fences show as low walls, gates as low doors.
      const kind = e.kind === 'fence' ? 'wall' : e.kind === 'gate' ? 'door' : e.kind;
      let buf = this.previewBuffers[kind];
      const n = counts[kind]++;
      if ((n + 1) * 16 > buf.length) {
        const grown = new Float32Array(buf.length * 2);
        grown.set(buf);
        buf = this.previewBuffers[kind] = grown;
        this.previewMeshes[kind].thinInstanceSetBuffer('matrix', buf, 16, false);
      }
      // Unit slab (1 x 1 x 1 centred box) scaled to the edge: walls full height, doors a
      // door-sized slab, windows a glassy pane between sill and head, removals a red sleeve
      // just around the existing wall.
      const h =
        e.kind === 'fence' || e.kind === 'gate'
          ? FENCE_PREVIEW_HEIGHT
          : e.kind === 'door'
            ? 2.1
            : e.kind === 'window'
              ? 1.2
              : e.kind === 'open'
                ? WALL_HEIGHT + 0.06
                : e.form
                  ? HALF_WALL_HEIGHT
                  : WALL_HEIGHT;
      const y0 = e.kind === 'window' ? 0.9 : 0;
      const t = e.kind === 'open' ? 0.22 : e.kind === 'window' ? 0.2 : e.kind === 'fence' || e.kind === 'gate' ? 0.08 : 0.16;
      const o = n * 16;
      buf.fill(0, o, o + 16);
      if (e.axis === 'dp' || e.axis === 'dn') {
        // Diagonal across the tile: a √2-long slab turned ±45° about its centre (scale, then yaw).
        const c = Math.SQRT1_2;
        const sn = e.axis === 'dp' ? -c : c;
        buf[o] = Math.SQRT2 * c;
        buf[o + 2] = -Math.SQRT2 * sn;
        buf[o + 8] = t * sn;
        buf[o + 10] = t * c;
      } else {
        buf[o] = e.axis === 'h' ? 1 : t;
        buf[o + 10] = e.axis === 'h' ? t : 1;
      }
      const diagonal = e.axis === 'dp' || e.axis === 'dn';
      const cx = diagonal || e.axis === 'h' ? e.x + 0.5 : e.x;
      const cz = diagonal ? e.z + 0.5 : e.axis === 'h' ? e.z : e.z + 0.5;
      buf[o + 5] = h;
      buf[o + 12] = cx;
      buf[o + 13] = y0 + h / 2;
      buf[o + 14] = cz;
      buf[o + 15] = 1;
    }
    for (const kind of ['wall', 'door', 'window', 'open'] as const) {
      const mesh = this.previewMeshes[kind];
      mesh.thinInstanceCount = counts[kind];
      mesh.thinInstanceBufferUpdated('matrix');
      // Empty previews are disabled so they cost no draw call.
      if (mesh.isEnabled(false) !== counts[kind] > 0) {
        mesh.setEnabled(counts[kind] > 0);
        this.resetSnapshot();
      }
    }
    if (valid !== this.previewValid) {
      this.previewValid = valid;
      const tint = valid ? null : Color3.FromHexString('#E5484D');
      const colors = { wall: '#9FC4FF', door: '#B07A4A', window: '#7FE0F2' };
      for (const kind of ['wall', 'door', 'window'] as const) {
        const mat = this.previewMeshes[kind].material as StandardMaterial;
        mat.emissiveColor.copyFrom(tint ?? Color3.FromHexString(colors[kind]));
      }
      this.resetSnapshot();
    }
  }

  setPaintPreview(faces: readonly PaintPreviewFace[], cover: number | null): void {
    const real = this.showLaid('faces', faces.length ? cover : null, faces.map((f) => `${f.axis}:${f.x}:${f.z}:${f.side}`));
    // The automatic look (0) depends on the room, so a white film stands in for it.
    const color = real || cover === null ? null : ((cover ? this.deps.content.wallCoverings[cover - 1]?.color : undefined) ?? '#FFFFFF');
    this.paintFilm(faces, color);
  }

  setFloorPreview(tiles: readonly { x: number; z: number }[], floor: number | null): void {
    const real = this.showLaid('floors', tiles.length ? floor : null, tiles.map((t) => `${t.x}:${t.z}`));
    const color = real || floor === null ? null : ((floor ? this.deps.content.floorCoverings[floor - 1]?.color : undefined) ?? '#FFFFFF');
    this.floorFilm(tiles, color);
  }

  /**
   * Shows `keys` (wall faces or floor tiles in `lotSurfaces`) as covering `cover` lays them, in its
   * real material. False where it can't (no covering, the automatic look, no house surfaces).
   */
  private showLaid(which: 'faces' | 'floors', cover: number | null, keys: string[]): boolean {
    const slot = this.laid[which];
    slot.keys = keys;
    slot.cover = cover;
    const surfaces = this.lotSurfaces?.[which];
    const shown = cover && surfaces ? `${cover}|${keys.join(',')}` : '';
    if (shown !== slot.shown) {
      slot.shown = shown;
      slot.mesh?.dispose();
      slot.mesh = null;
      if (cover && surfaces) {
        const parts = keys.flatMap((k) => surfaces.get(k) ?? []);
        slot.mesh = which === 'faces' ? this.house.coverPreview(parts, cover) : this.house.floorPreview(parts, cover);
        if (slot.mesh) slot.mesh.parent = this.storeyLayer;
      }
      this.resetSnapshot();
    }
    return shown !== '';
  }

  /** The house was rebuilt: lay the shown previews on its new surfaces. */
  private refreshLaid(): void {
    for (const which of ['faces', 'floors'] as const) {
      const slot = this.laid[which];
      if (!slot.shown) continue;
      slot.shown = '';
      this.showLaid(which, slot.cover, slot.keys);
    }
  }

  /** The Paint tool's stand-in: a film of `color` over each face (null: none). */
  private paintFilm(faces: readonly PaintPreviewFace[], color: string | null): void {
    const mesh = this.paintPreview;
    const n = color ? faces.length : 0;
    if (n * 16 > this.paintBuffer.length) {
      this.paintBuffer = new Float32Array(Math.max(n, this.paintBuffer.length / 8) * 32);
      mesh.thinInstanceSetBuffer('matrix', this.paintBuffer, 16, false);
    }
    const buf = this.paintBuffer;
    // A thin film just off each face (walls are 0.14 m thick), as tall as the wall.
    const off = 0.078;
    const t = 0.012;
    faces.slice(0, n).forEach((f, i) => {
      const o = i * 16;
      const h = f.half ? HALF_WALL_HEIGHT : WALL_HEIGHT;
      const s = f.side ? 1 : -1;
      buf.fill(0, o, o + 16);
      let cx: number;
      let cz: number;
      if (f.axis === 'h' || f.axis === 'v') {
        buf[o] = f.axis === 'h' ? 1 : t;
        buf[o + 10] = f.axis === 'h' ? t : 1;
        cx = f.axis === 'h' ? f.x + 0.5 : f.x + s * off;
        cz = f.axis === 'h' ? f.z + s * off : f.z + 0.5;
      } else {
        // As in `setEdgePreview`: a √2-long film turned ±45°, offset towards half 1 (`s` > 0).
        const c = Math.SQRT1_2;
        const sn = f.axis === 'dp' ? -c : c;
        buf[o] = Math.SQRT2 * c;
        buf[o + 2] = -Math.SQRT2 * sn;
        buf[o + 8] = t * sn;
        buf[o + 10] = t * c;
        cx = f.x + 0.5 + s * off * sn;
        cz = f.z + 0.5 + s * off * c;
      }
      buf[o + 5] = h;
      buf[o + 12] = cx;
      buf[o + 13] = h / 2;
      buf[o + 14] = cz;
      buf[o + 15] = 1;
    });
    mesh.thinInstanceCount = n;
    mesh.thinInstanceBufferUpdated('matrix');
    if (color) (mesh.material as StandardMaterial).emissiveColor.copyFrom(Color3.FromHexString(color));
    if (mesh.isEnabled(false) !== n > 0) {
      mesh.setEnabled(n > 0);
      this.resetSnapshot();
    }
  }

  /** The Floor tool's stand-in: a film of `color` over each tile (null: none). */
  private floorFilm(tiles: readonly { x: number; z: number }[], color: string | null): void {
    const mesh = this.floorPreview;
    const n = color ? tiles.length : 0;
    if (n * 16 > this.floorBuffer.length) {
      this.floorBuffer = new Float32Array(Math.max(n, this.floorBuffer.length / 8) * 32);
      mesh.thinInstanceSetBuffer('matrix', this.floorBuffer, 16, false);
    }
    const buf = this.floorBuffer;
    // A film just above the floor (floors lie at 0.01 m), a hair inside each tile so tiles read.
    tiles.slice(0, n).forEach((t, i) => {
      const o = i * 16;
      buf.fill(0, o, o + 16);
      buf[o] = 0.96;
      buf[o + 5] = 1;
      buf[o + 10] = 0.96;
      buf[o + 12] = t.x + 0.5;
      buf[o + 13] = 0.03;
      buf[o + 14] = t.z + 0.5;
      buf[o + 15] = 1;
    });
    mesh.thinInstanceCount = n;
    mesh.thinInstanceBufferUpdated('matrix');
    if (color) (mesh.material as StandardMaterial).emissiveColor.copyFrom(Color3.FromHexString(color));
    if (mesh.isEnabled(false) !== n > 0) {
      mesh.setEnabled(n > 0);
      this.resetSnapshot();
    }
  }

  setRoomOverlay(tiles: readonly RoomOverlayTile[]): void {
    const n = tiles.length;
    if (!this.roomOverlay && n === 0) return;
    let mesh = this.roomOverlay;
    if (!mesh) {
      // One film per tile, tinted per instance; just under the floor tool's film.
      mesh = MeshBuilder.CreateGround('room-overlay', { width: 1, height: 1 }, this.scene);
      const mat = new StandardMaterial('room-overlay', this.scene);
      mat.disableLighting = true;
      mat.emissiveColor = Color3.White();
      mat.alpha = 0.45;
      mesh.material = mat;
      mesh.isPickable = false;
      mesh.alwaysSelectAsActiveMesh = true;
      mesh.parent = this.storeyLayer;
      this.roomOverlay = mesh;
    }
    if (n * 16 > this.roomMatrices.length) {
      const cap = Math.max(n, 64) * 2;
      this.roomMatrices = new Float32Array(cap * 16);
      this.roomColors = new Float32Array(cap * 4);
      mesh.thinInstanceSetBuffer('matrix', this.roomMatrices, 16, false);
      mesh.thinInstanceSetBuffer('color', this.roomColors, 4, false);
    }
    const m = this.roomMatrices;
    const c = this.roomColors;
    tiles.forEach((t, i) => {
      const o = i * 16;
      m.fill(0, o, o + 16);
      m[o] = 1;
      m[o + 5] = 1;
      m[o + 10] = 1;
      m[o + 12] = t.x + 0.5;
      m[o + 13] = 0.025;
      m[o + 14] = t.z + 0.5;
      m[o + 15] = 1;
      c.set([t.rgb[0], t.rgb[1], t.rgb[2], 1], i * 4);
    });
    mesh.thinInstanceCount = n;
    mesh.thinInstanceBufferUpdated('matrix');
    mesh.thinInstanceBufferUpdated('color');
    if (mesh.isEnabled(false) !== n > 0) mesh.setEnabled(n > 0);
    this.resetSnapshot();
  }

  /** Build tools: whether a left-drag turns the camera (off while a wall is being drawn). */
  setLeftDragCamera(on: boolean): void {
    const pointers = this.camera.inputs.attached.pointers as ArcRotateCameraPointersInput | undefined;
    if (pointers) pointers.buttons = on ? [0, 1, 2] : [1, 2];
  }

  setStorey(storey: number): void {
    const k = Math.max(0, Math.min(this.storeys.count - 1, Math.round(storey)));
    if (k === this.storey && this.storeyLayer) return;
    this.storey = k;
    this.storeyLayer?.position.set(0, k * WALL_HEIGHT, -k * this.storeys.depth);
    this.applyStoreys();
    // Furniture and residents above it hide; the lot (every storey) is kept.
    if (this.lastWorld && !this.worldBuilding) void this.setWorld(this.lastWorld, this.view);
  }

  /** The storey a lot row is on. */
  private storeyOf(z: number): number {
    return this.storeys.count > 1 && this.storeys.depth > 0 ? Math.max(0, Math.min(this.storeys.count - 1, Math.floor(z / this.storeys.depth))) : 0;
  }

  /** Roofs show with walls up, over the storeys in view. */
  private showRoofs(): void {
    for (const roof of this.roofs) roof.setEnabled(this.roofShown && ((roof.metadata as { storey?: number } | null)?.storey ?? 0) <= this.storey);
  }

  /** Storeys above the one in view are hidden (walls, floors, roofs). */
  private applyStoreys(): void {
    for (const mesh of [...this.lotMeshes, ...this.worldMeshes]) {
      const k = (mesh.metadata as { storey?: number } | null)?.storey;
      if (k === undefined) continue;
      const roof = this.roofs.includes(mesh);
      mesh.setEnabled(k <= this.storey && (!roof || this.roofShown));
    }
    this.resetSnapshot();
  }

  setBuildGrid(rect: ViewRect | null): void {
    const on = rect !== null;
    if (rect) {
      this.grid.scaling.set(rect.w, 1, rect.d);
      this.grid.position.set(rect.x + rect.w / 2, 0.03, rect.z + rect.d / 2);
      const tex = (this.grid.material as StandardMaterial).diffuseTexture as DynamicTexture;
      tex.uScale = rect.w;
      tex.vScale = rect.d;
    }
    if (on !== this.gridOn) {
      this.gridOn = on;
      this.grid.setEnabled(on);
      this.resetSnapshot();
    }
  }

  async captureThumbnail(width: number, height: number): Promise<string | null> {
    try {
      return await CreateScreenshotAsync(this.engine, this.camera, { width, height }, 'image/jpeg', 0.8);
    } catch (err) {
      console.warn('[render] thumbnail capture failed', err);
      return null;
    }
  }

  cameraPose(): CameraPose {
    const cam = this.gameCamera;
    return { alpha: cam.alpha, beta: cam.beta, radius: cam.radius, target: [cam.target.x, cam.target.y, cam.target.z] };
  }

  setCameraPose(pose: CameraPose): void {
    const cam = this.gameCamera;
    cam.setTarget(new Vector3(...pose.target), false, false, true);
    cam.alpha = pose.alpha;
    cam.beta = pose.beta;
    cam.radius = pose.radius;
    this.cameraPlaced = true;
  }

  stats(): RenderStats {
    return {
      backend: `${this.webgpu ? 'WebGPU' : 'WebGL2'}${this.lampCluster ? ' · clustered lamps' : ''}`,
      fps: this.engine.getFps(),
      frameMs: this.engine.getDeltaTime(),
      cpuMs: this.cpuMs,
      drawCalls: this.instrumentation.drawCallsCounter.current,
      snapshotRendering: this.webgpu?.snapshotRendering ?? false,
    };
  }

  run(onFrame: (now: number) => void): void {
    this.onFrame = onFrame;
    this.setActive(true);
  }

  setActive(active: boolean): void {
    if (active === this.active) return;
    this.active = active;
    if (active) this.engine.runRenderLoop(this.renderFrame);
    else this.engine.stopRenderLoop(this.renderFrame);
  }

  framesRendered(frames: number): Promise<void> {
    return new Promise((resolve) => this.frameWaiters.push({ left: frames, resolve }));
  }

  setIdleOrbit(on: boolean): void {
    this.idleOrbit = on;
  }

  setGameShot(shot: GameShot | null, cut = false): void {
    if (!shot) return this.gameRig.release();
    this.followIndex = null;
    this.idleOrbit = false;
    this.gameRig.setShot(shot, cut || this.townMode);
    this.cameraPlaced = true;
  }

  followSim(index: number | null): void {
    this.followIndex = index;
  }

  /** The director's shot, or keeping a followed resident centred (game world only). */
  private steerCamera(dt: number): void {
    if (this.gameRig.active) return this.gameRig.frame(dt);
    if (this.followIndex === null || !this.simHead(this.followIndex, this.followHead)) return;
    const t = this.camera.target;
    const k = 1 - Math.exp(-dt / 0.5);
    t.x += (this.followHead.x - t.x) * k;
    t.z += (this.followHead.z - t.z) * k;
  }

  clear(): void {
    this.pauseSnapshot();
    for (const mesh of [...this.worldMeshes, ...this.lotMeshes]) mesh.dispose(false, false);
    this.worldMeshes = [];
    this.lotMeshes = [];
    this.lotKey = '';
    this.lotCasters = [];
    this.lotTemplates.clear();
    this.lotRooms = null;
    this.lotParts = null;
    this.roofs = [];
    this.baseCasters = [];
    this.wallCasters = [];
    this.walls = this.wallsLow = null;
    this.retireTemplates(new Set());
    this.placed = [];
    this.held = null;
    this.characters?.clear();
    this.simCount = 0;
    this.selectedSim = null;
    this.onFrame = null;
    this.cursor.position.y = HIDDEN_Y;
    this.markerMatrix.fill(0);
    this.markerHaloMatrix.fill(0);
    this.simShadowMatrices.fill(0);
    this.setPlacementGhost(null);
    this.setEdgePreview([], true);
    this.setPaintPreview([], null);
    this.setFloorPreview([], null);
    this.setRoomOverlay([]);
    this.setBuildGrid(null);
    this.cameraPlaced = false;
    this.framedView = '';
    this.warmFrames = 0;
  }

  dispose(): void {
    window.removeEventListener('resize', this.onResize);
    this.overview?.dispose();
    this.engine.dispose();
  }

  // --- town overview (menus) ---------------------------------------------------------

  get townShown(): boolean {
    return this.townMode;
  }

  showTown(world: WorldStructure, minute: number): Promise<void> {
    const ticket = ++this.townTicket;
    const run = this.townQueue.then(async () => {
      // Requests queue up while one builds; only the newest is built.
      if (ticket !== this.townTicket) return;
      const overview = (this.overview ??= new TownOverview(this.scene, this.deps.assets, this.deps.content, this.house, this.lib, this.camera));
      this.beginBuild();
      try {
        // Same seed and size can still be a new layout ("New neighbours"): re-fit the lawn to its houses.
        (await this.useNature('town', world)).landscape.refreshLawn(world);
        await overview.build(world);
        if (this.townHighlight) overview.setHighlight(this.townHighlight);
        // Interior lamps of the game's house never reach the overview.
        const own = new Set<Mesh>(overview.meshes);
        for (const light of [...this.roomLights, ...(this.lampCluster ? [this.lampCluster] : [])]) {
          light.excludedMeshes = [...light.excludedMeshes.filter((m) => !m.isDisposed() && !own.has(m as Mesh)), ...own];
        }
      } finally {
        this.endBuild();
      }
      if (ticket !== this.townTicket) return;
      if (!this.townMode) {
        // Entering from the game (or at start-up): the shot's hour at once.
        this.townMinute = this.townMinuteGoal = this.townShot?.minute ?? minute;
        this.enterTown();
      }
      else {
        this.updateShadowList();
        this.resetSnapshot();
      }
    });
    this.townQueue = run.catch(() => {});
    return run;
  }

  async hideTown(glide = 0): Promise<void> {
    // Let a pending overview build finish first, so it can't switch back to the overview later.
    this.townTicket++;
    await this.townQueue;
    if (!this.townMode) return;
    const rig = this.overview?.rig;
    if (glide > 0 && rig && this.active) {
      const p = this.parked;
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, glide * 1000 + 600);
        rig.glideTo({ alpha: p.alpha, beta: p.beta, radius: p.radius, x: p.target.x, z: p.target.z }, glide, () => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
    if (this.townMode) this.leaveTown();
  }

  setTownShot(shot: TownShot, cut = false): void {
    this.townShot = shot;
    this.overview?.rig.setShot(shot, cut || !this.townMode);
    if (shot.minute !== undefined) {
      this.townMinuteGoal = shot.minute;
      if (cut || !this.townMode) this.townMinute = shot.minute;
    }
  }

  nudgeTown(dAlpha: number, zoom: number): void {
    if (this.townMode) this.overview?.rig.nudge(dAlpha, zoom);
  }

  setLotHighlight(highlight: LotHighlight): void {
    this.townHighlight = highlight;
    this.overview?.setHighlight(highlight);
  }

  onTownFrame(fn: (() => void) | null): void {
    this.townListener = fn;
  }

  /** The camera the game world uses: the real one, or the parked pose while the overview drives it. */
  private get gameCamera(): ArcRotateCamera {
    return this.townMode ? this.parked : this.camera;
  }

  private enterTown(): void {
    const cam = this.camera;
    this.townMode = true;
    copyPose(cam, this.parked);
    cam.detachControl();
    cam.inertialAlphaOffset = cam.inertialBetaOffset = cam.inertialRadiusOffset = 0;
    cam.inertialPanningX = cam.inertialPanningY = 0;
    cam.lowerRadiusLimit = 2;
    cam.upperRadiusLimit = 1200;
    cam.lowerBetaLimit = 0.05;
    cam.upperBetaLimit = 1.45;
    cam.layerMask = LAYER_TOWN;
    const rig = this.overview!.rig;
    rig.syncFromCamera();
    if (this.townShot) rig.setShot(this.townShot, true);
    this.cursor.position.y = HIDDEN_Y;
    this.lastLightMinute = -1;
    this.updateShadowList();
    this.pauseSnapshot();
  }

  private leaveTown(): void {
    const cam = this.camera;
    this.townMode = false;
    this.warmFrames = 0;
    cam.layerMask = LAYER_WORLD;
    copyPose(this.parked, cam);
    cam.targetScreenOffset.set(0, 0);
    [cam.lowerRadiusLimit, cam.upperRadiusLimit] = RADIUS_LIMITS;
    cam.lowerBetaLimit = 0.3;
    cam.upperBetaLimit = 1.35;
    cam.inertialAlphaOffset = cam.inertialBetaOffset = cam.inertialRadiusOffset = 0;
    cam.attachControl(true);
    this.updateShadowList();
    this.scene.fogDensity = this.style.fog;
    this.applyLighting(this.lastMinute);
    this.lastLightMinute = this.lastMinute;
    this.cutLook = -1;
    this.updateCutaway();
    // The game draws live (see `scheduleSnapshot`).
    this.snapshotGeneration++;
    if (this.webgpu) this.webgpu.snapshotRendering = false;
  }

  /** Overview per frame: camera rig, highlights, lighting at the menu's hour. Allocation-free. */
  private townFrame(dt: number): void {
    const overview = this.overview!;
    const w = this.canvas.clientWidth || 1;
    const h = this.canvas.clientHeight || 1;
    overview.rig.setViewport(w, h);
    overview.frame(Math.min(0.1, dt / 1000), w / h);
    // The light eases between the screens' hours (about two seconds).
    const goal = this.townMinuteGoal;
    if (this.townMinute !== goal) {
      const step = Math.max(0.5, Math.abs(goal - this.townMinute) * Math.min(1, dt / 600));
      this.townMinute = Math.abs(goal - this.townMinute) <= step ? goal : this.townMinute + Math.sign(goal - this.townMinute) * step;
    }
    if (this.lastLightMinute !== this.townMinute) {
      this.applyLighting(this.townMinute);
      this.lastLightMinute = this.townMinute;
      this.resetSnapshot();
    }
    // Haze is tuned for the game's close camera; from high above it would wash the town out.
    const fog = this.style.fog * Math.min(1, Math.max(0.3, 55 / this.camera.radius));
    if (Math.abs(fog - this.scene.fogDensity) > this.style.fog * 0.02) this.scene.fogDensity = fog;
    this.followCamera();
    this.skyDome.drift(dt);
    this.townListener?.();
  }

  /**
   * Draws the game world once more in this frame, from its own (parked) view, before the overview
   * is drawn over it: compiles its shaders and pipelines while it is still hidden.
   */
  private warmWorld(): void {
    this.warmFrames--;
    const cam = this.camera;
    const p = this.parked;
    const w = this.warmPose;
    [w.alpha, w.beta, w.radius, w.x, w.y, w.z, w.ox, w.oy] = [cam.alpha, cam.beta, cam.radius, cam.target.x, cam.target.y, cam.target.z, cam.targetScreenOffset.x, cam.targetScreenOffset.y];
    const webgpu = this.webgpu;
    const snapshot = webgpu?.snapshotRendering ?? false;
    if (webgpu && snapshot) webgpu.snapshotRendering = false;
    cam.layerMask = LAYER_WORLD;
    copyPose(p, cam);
    cam.targetScreenOffset.set(0, 0);
    const map = this.shadows.getShadowMap()!;
    map.renderList = this.wallMode === 'up' ? [...this.baseCasters, ...this.wallCasters] : this.baseCasters;
    this.scene.render();
    cam.layerMask = LAYER_TOWN;
    cam.alpha = w.alpha;
    cam.beta = w.beta;
    cam.radius = w.radius;
    cam.target.copyFromFloats(w.x, w.y, w.z);
    cam.targetScreenOffset.copyFromFloats(w.ox, w.oy);
    this.updateShadowList();
    if (webgpu && snapshot) webgpu.snapshotRendering = true;
  }

  /** Shadow casters of what is on screen: the overview, or the game world (its walls only with walls up). */
  private updateShadowList(): void {
    const map = this.shadows.getShadowMap()!;
    if (this.townMode) map.renderList = [...(this.overview?.casters ?? []), ...(this.natureIn.town?.casters ?? [])];
    else map.renderList = this.wallMode === 'up' ? [...this.baseCasters, ...this.wallCasters] : this.baseCasters;
  }

  /**
   * The landscape of `world` for a layer: shared with the other layer when it is the same town
   * (seed and size), otherwise built; one no layer shows any more is disposed.
   */
  private async useNature(layer: 'world' | 'town', world: WorldStructure): Promise<NatureSet> {
    // The town's own size (the game's lot also holds the storeys above it).
    const key = `${world.meta?.seed ?? 1}:${world.width}x${groundDepth(world)}`;
    const ticket = ++this.natureTicket[layer];
    let set = this.natures.get(key);
    if (!set) {
      const landscape = new Landscape(world);
      const created: NatureSet = { landscape, meshes: [], casters: [], users: new Set(), pending: 0, ready: Promise.resolve() };
      created.ready = landscape.build(this.scene, this.deps.assets, world).then((nature) => {
        created.meshes = nature.meshes;
        created.casters = nature.casters;
        for (const mesh of nature.meshes) {
          mesh.freezeWorldMatrix();
          mesh.layerMask = 0;
        }
      });
      this.natures.set(key, (set = created));
    }
    set.pending++;
    try {
      await set.ready;
    } finally {
      set.pending--;
    }
    if (ticket === this.natureTicket[layer]) {
      const old = this.natureIn[layer];
      if (old !== set) old?.users.delete(layer);
      set.users.add(layer);
      this.natureIn[layer] = set;
    }
    // Drop landscapes nobody shows; draw each on the layers that use it.
    const all: Mesh[] = [];
    for (const [k, n] of this.natures) {
      if (!n.users.size && !n.pending) {
        for (const mesh of n.meshes) mesh.dispose(false, false);
        this.natures.delete(k);
        continue;
      }
      const mask = (n.users.has('world') ? LAYER_WORLD : 0) | (n.users.has('town') ? LAYER_TOWN : 0);
      for (const mesh of n.meshes) mesh.layerMask = mask;
      all.push(...n.meshes);
    }
    // Interior lamps never light the landscape (keeps its shaders simple). Only when that
    // changes: setting the lists marks every material dirty.
    const landscape = new Set([...all, this.skyDome.mesh]);
    if (landscape.size !== this.lightExcluded.size || [...landscape].some((m) => !this.lightExcluded.has(m))) {
      this.lightExcluded = landscape;
      for (const light of [...this.roomLights, ...(this.lampCluster ? [this.lampCluster] : [])]) {
        light.excludedMeshes = [...new Set([...light.excludedMeshes.filter((m) => !m.isDisposed()), ...landscape])];
      }
    }
    return set;
  }

  private readonly renderFrame = () => {
    const start = performance.now();
    const dt = this.engine.getDeltaTime();
    if (this.idleOrbit && !this.townMode) this.camera.alpha += dt * 0.00003;
    this.onFrame?.(performance.now());
    if (this.townMode && this.overview) {
      this.townFrame(dt);
      if (this.warmFrames > 0 && !this.worldBuilding) this.warmWorld();
    }
    this.scene.render();
    this.cpuMs += (performance.now() - start - this.cpuMs) * 0.1;
    for (let i = this.frameWaiters.length - 1; i >= 0; i--) {
      const w = this.frameWaiters[i];
      if (--w.left <= 0) {
        this.frameWaiters.splice(i, 1);
        w.resolve();
      }
    }
  };

  // --- setup -------------------------------------------------------------------------

  private setupCamera(): void {
    const cam = (this.camera = new ArcRotateCamera('camera', -Math.PI * 0.62, 0.86, 24, Vector3.Zero(), this.scene));
    cam.lowerRadiusLimit = 6;
    cam.upperRadiusLimit = 95;
    cam.lowerBetaLimit = 0.3;
    cam.upperBetaLimit = 1.35;
    cam.wheelDeltaPercentage = 0.012;
    cam.panningSensibility = 90;
    cam.mapPanning = true;
    cam.inertia = 0.82;
    cam.panningInertia = 0.82;
    cam.minZ = 0.3;
    cam.maxZ = 1600;
    // A slightly longer lens than the default flattens perspective a little: the dollhouse look.
    cam.fov = 0.7;
    cam.attachControl(true);
    this.gameRig = new GameCameraRig(cam, { radius: RADIUS_LIMITS, beta: [0.3, 1.35] }, (i, out) => this.simHead(i, out));
    // Holds the game view while the town overview drives the camera (never drawn).
    this.parked = new ArcRotateCamera('parkedCamera', cam.alpha, cam.beta, cam.radius, Vector3.Zero(), this.scene);
    this.parked.fov = cam.fov;
  }

  private setupLights(): void {
    applyShaderFixes();
    // Sky ambient and reflections come from the environment map (image-based lighting); the
    // hemispheric light only adds a time-of-day tint (golden hour, blue hour, moonlight).
    this.sky = new HemisphericLight('sky', new Vector3(0.2, 1, -0.3), this.scene);
    this.sky.specular = Color3.Black();
    this.sun = new DirectionalLight('sun', new Vector3(-0.5, -1, 0.4), this.scene);
    this.sun.autoCalcShadowZBounds = true;

    const shadows = (this.shadows = new ShadowGenerator(this.quality.shadowMapSize, this.sun));
    shadows.usePercentageCloserFiltering = true;
    shadows.filteringQuality = ShadowGenerator.QUALITY_MEDIUM;
    shadows.bias = 0.0015;
    shadows.normalBias = 0.02;
    // Physically, shadows block all direct sunlight; the environment fills them in.
    shadows.setDarkness(0);
    // Note: with WebGPU snapshot rendering Babylon renders every render target each frame (to
    // keep the recorded passes aligned), so a render-once shadow map would not save anything.

    // Warm interior lamps; always enabled (so shaders never recompile) and dimmed to zero by
    // day. Clustered where the engine supports it: then dozens light at once.
    const wanted = new URLSearchParams(location.search).get('lights');
    const make = (i: number) => {
      const light = new PointLight(`room${i}`, new Vector3(0, HIDDEN_Y, 0), this.scene);
      light.falloffType = Light.FALLOFF_GLTF;
      light.range = 7;
      light.intensity = 0;
      light.specular = new Color3(0.4, 0.35, 0.3);
      return light;
    };
    const first = make(0);
    // Clusters take only the default (inverse-square) falloff.
    first.falloffType = Light.FALLOFF_DEFAULT;
    const clustered = (wanted === 'clustered' || (wanted !== 'forward' && this.quality.clusteredLamps)) && ClusteredLightContainer.IsLightSupported(first);
    if (!clustered) first.falloffType = Light.FALLOFF_GLTF;
    this.roomLights.push(first);
    for (let i = 1; i < (clustered ? CLUSTERED_LIGHTS : ROOM_LIGHTS); i++) {
      const light = make(i);
      if (clustered) light.falloffType = Light.FALLOFF_DEFAULT;
      this.roomLights.push(light);
    }
    if (clustered) this.lampCluster = new ClusteredLightContainer('lamps', this.roomLights, this.scene);
  }

  private setupPostProcessing(): void {
    const q = this.quality;
    if (q.ambientOcclusion) {
      try {
        const ssao = new SSAO2RenderingPipeline('ssao', this.scene, { ssaoRatio: 0.5, blurRatio: 1 }, [this.camera], true);
        ssao.radius = 1.0;
        ssao.totalStrength = 0.7;
        ssao.samples = 16;
        ssao.maxZ = 120;
        ssao.expensiveBlur = true;
      } catch (err) {
        console.warn('[render] ambient occlusion unavailable', err);
      }
    }

    const post = (this.post = new DefaultRenderingPipeline('post', true, this.scene, [this.camera]));
    post.samples = q.msaaSamples;
    post.fxaaEnabled = q.msaaSamples <= 1;
    post.imageProcessingEnabled = true;
    const ip = post.imageProcessing;
    ip.toneMappingEnabled = true;
    ip.vignetteEnabled = true;
    ip.vignetteStretch = 0.5;
    ip.vignetteColor = new Color4(0.02, 0.02, 0.04, 0);
    ip.colorCurvesEnabled = true;
    ip.colorCurves = new ColorCurves();
    post.bloomEnabled = false;
    post.depthOfFieldEnabled = false;
    this.nightGrade = new NightGrade(this.camera, this.engine, this.webgpu !== null);
  }

  private setupHelpers(): void {
    const cursorMat = new StandardMaterial('cursor', this.scene);
    cursorMat.disableLighting = true;
    cursorMat.emissiveColor = ACCENT;
    cursorMat.alpha = 0.35;
    this.cursor = MeshBuilder.CreateGround('cursor', { width: 0.92, height: 0.92 }, this.scene);
    this.cursor.material = cursorMat;
    this.cursor.position.y = HIDDEN_Y;

    // Soft round contact shadows (Sims: per frame; objects: per world) from one radial texture.
    const blob = new DynamicTexture('blob', 64, this.scene, true);
    const ctx = blob.getContext();
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(0,0,0,0.55)');
    g.addColorStop(0.55, 'rgba(0,0,0,0.3)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
    blob.update();
    blob.hasAlpha = true;
    const blobMat = new StandardMaterial('blobShadow', this.scene);
    blobMat.disableLighting = true;
    blobMat.diffuseColor = Color3.Black();
    blobMat.emissiveColor = Color3.Black();
    blobMat.specularColor = Color3.Black();
    blobMat.opacityTexture = blob;
    blobMat.disableDepthWrite = true;
    blobMat.zOffset = -3;
    const makeBlob = (name: string) => {
      const mesh = MeshBuilder.CreateGround(name, { width: 1, height: 1 }, this.scene);
      mesh.material = blobMat;
      mesh.isPickable = false;
      return mesh;
    };
    this.simShadow = makeBlob('simShadows');
    this.simShadow.thinInstanceSetBuffer('matrix', this.simShadowMatrices, 16, false);
    this.simShadow.alwaysSelectAsActiveMesh = true;
    this.objectShadow = makeBlob('objectShadowTemplate');
    this.objectShadow.thinInstanceSetBuffer('matrix', new Float32Array(16), 16, true);
    this.objectShadow.thinInstanceCount = 0;
    this.objectShadow.setEnabled(false);

    // Build mode: placement ghost, wall-tool previews and the tile grid.
    this.ghostRoot = new TransformNode('ghost', this.scene);
    this.ghostRoot.position.y = HIDDEN_Y;
    const ghostMat = (this.ghostMaterial = new StandardMaterial('ghost', this.scene));
    ghostMat.alpha = 0.5;
    ghostMat.specularColor = Color3.Black();
    ghostMat.emissiveColor = new Color3(0.25, 0.25, 0.25);
    ghostMat.backFaceCulling = false;
    const arrowMat = (this.ghostArrowMaterial = new StandardMaterial('ghostArrow', this.scene));
    arrowMat.disableLighting = true;
    arrowMat.backFaceCulling = false;
    arrowMat.emissiveColor = new Color3(0.55, 1.0, 0.6);
    // A stem and a head lying flat, pointing +z (out of the object's front), within one tile.
    const arrow = (this.ghostArrow = new Mesh('ghostArrow', this.scene));
    const arrowData = new VertexData();
    arrowData.positions = [-0.09, 0, -0.36, 0.09, 0, -0.36, 0.09, 0, 0.04, -0.09, 0, 0.04, -0.26, 0, 0.04, 0.26, 0, 0.04, 0, 0, 0.38];
    arrowData.normals = Array.from({ length: 7 }, () => [0, 1, 0]).flat();
    arrowData.indices = [0, 2, 1, 0, 3, 2, 4, 6, 5];
    arrowData.applyToMesh(arrow, false);
    arrow.material = arrowMat;
    arrow.parent = this.ghostRoot;
    arrow.isPickable = false;
    arrow.renderingGroupId = 1;
    arrow.alwaysSelectAsActiveMesh = true;
    arrow.setEnabled(false);
    this.fx = new BuildEffects(this.scene);

    const preview = (kind: EdgePreview['kind'], color: string, alpha: number) => {
      const mat = new StandardMaterial(`preview-${kind}`, this.scene);
      mat.disableLighting = true;
      mat.emissiveColor = Color3.FromHexString(color);
      mat.alpha = alpha;
      mat.backFaceCulling = false;
      const mesh = MeshBuilder.CreateBox(`preview-${kind}`, { size: 1 }, this.scene);
      mesh.material = mat;
      mesh.isPickable = false;
      mesh.alwaysSelectAsActiveMesh = true;
      const buffer = new Float32Array(PREVIEW_CAPACITY * 16);
      mesh.thinInstanceSetBuffer('matrix', buffer, 16, false);
      mesh.thinInstanceCount = 0;
      mesh.setEnabled(false);
      return [mesh, buffer] as const;
    };
    const [wall, wallBuf] = preview('wall', '#9FC4FF', 0.45);
    const [door, doorBuf] = preview('door', '#B07A4A', 0.6);
    const [pane, paneBuf] = preview('window', '#7FE0F2', 0.55);
    const [open, openBuf] = preview('open', '#E5484D', 0.5);
    // Paint tool: one film per face, tinted with the covering.
    const paint = MeshBuilder.CreateBox('preview-paint', { size: 1 }, this.scene);
    const paintMat = new StandardMaterial('preview-paint', this.scene);
    paintMat.disableLighting = true;
    paintMat.alpha = 0.6;
    paint.material = paintMat;
    paint.isPickable = false;
    paint.alwaysSelectAsActiveMesh = true;
    paint.thinInstanceSetBuffer('matrix', this.paintBuffer, 16, false);
    paint.thinInstanceCount = 0;
    paint.setEnabled(false);
    this.paintPreview = paint;
    // Floor tool: one film per tile, tinted with the covering.
    const floor = MeshBuilder.CreateGround('preview-floor', { width: 1, height: 1 }, this.scene);
    const floorMat = new StandardMaterial('preview-floor', this.scene);
    floorMat.disableLighting = true;
    floorMat.alpha = 0.6;
    floor.material = floorMat;
    floor.isPickable = false;
    floor.alwaysSelectAsActiveMesh = true;
    floor.thinInstanceSetBuffer('matrix', this.floorBuffer, 16, false);
    floor.thinInstanceCount = 0;
    floor.setEnabled(false);
    this.floorPreview = floor;
    this.previewMeshes = { wall, door, window: pane, open };
    this.previewBuffers = { wall: wallBuf, door: doorBuf, window: paneBuf, open: openBuf };

    // Tile grid: white lines on a transparent texture, repeated once per tile.
    const gridTex = new DynamicTexture('grid', 128, this.scene, true);
    const gctx = gridTex.getContext();
    gctx.clearRect(0, 0, 128, 128);
    gctx.fillStyle = 'rgba(255,255,255,1)';
    gctx.fillRect(0, 0, 128, 3);
    gctx.fillRect(0, 0, 3, 128);
    gridTex.update();
    gridTex.hasAlpha = true;
    gridTex.wrapU = gridTex.wrapV = DynamicTexture.WRAP_ADDRESSMODE;
    const gridMat = new StandardMaterial('grid', this.scene);
    gridMat.disableLighting = true;
    gridMat.diffuseTexture = gridTex;
    gridMat.useAlphaFromDiffuseTexture = true;
    gridMat.emissiveColor = new Color3(0.9, 0.95, 1);
    gridMat.alpha = 0.45;
    gridMat.disableDepthWrite = true;
    gridMat.zOffset = -4;
    this.grid = MeshBuilder.CreateGround('buildGrid', { width: 1, height: 1 }, this.scene);
    this.grid.material = gridMat;
    this.grid.isPickable = false;
    this.grid.setEnabled(false);

    // Build helpers work in lot rows; this node lifts them to the storey in view.
    this.storeyLayer = new TransformNode('storeyLayer', this.scene);
    for (const node of [this.cursor, this.ghostRoot, this.grid, this.paintPreview, this.floorPreview, ...Object.values(this.previewMeshes)]) node.parent = this.storeyLayer;
  }

  /**
   * The selection marker over the selected Sim (`model.marker`): a small soft four-point
   * sparkle star, unlit, with a thin deeper-toned outline (so it reads on light floors and
   * bright sky) and a faint additive glow disc behind it. All face the camera.
   */
  private async setupMarker(): Promise<void> {
    const template = await buildModel(this.scene, 'model.marker', this.deps.assets.get('model.marker', 'model'), [1, 1]);
    const mat = new PBRMaterial('marker', this.scene);
    mat.unlit = true;
    mat.albedoColor = Color3.White();
    // Outline: the star's back faces pushed out along their normals (inverted hull).
    const outlineMat = new PBRMaterial('markerOutline', this.scene);
    outlineMat.unlit = true;
    outlineMat.albedoColor = Color3.White();
    outlineMat.cullBackFaces = false;
    const meshes: Mesh[] = [];
    for (const mesh of template.meshes) {
      const positions = mesh.getVerticesData(VertexBuffer.PositionKind)!;
      const normals = mesh.getVerticesData(VertexBuffer.NormalKind)!;
      const n = normals.length / 3;
      const outline = new Mesh('markerOutline', this.scene);
      const data = new VertexData();
      data.positions = positions.map((p, i) => p + normals[i] * 0.009);
      data.normals = normals.slice();
      data.indices = mesh.getIndices()!.slice();
      data.colors = new Float32Array(n * 4).fill(1);
      data.applyToMesh(outline, false);
      outline.material = outlineMat;
      // Smooth, pillowy shading: a hot core that blooms, brightest on the faces turned to the
      // viewer, softly deeper towards the ray tips.
      const colors = new Float32Array(n * 4);
      for (let i = 0; i < n; i++) {
        const r = Math.hypot(positions[i * 3], positions[i * 3 + 1]);
        const face = Math.abs(normals[i * 3 + 2]) * 0.75 + Math.max(0, normals[i * 3 + 1]) * 0.25;
        const k = (0.7 + 0.3 * face) * (1.45 - 0.6 * Math.min(1, r / 0.16));
        colors.set([k, k, k, 1], i * 4);
      }
      mesh.setVerticesData(VertexBuffer.ColorKind, colors);
      mesh.material = mat;
      for (const [m, color] of [[mesh, this.markerColor], [outline, this.markerOutlineColor]] as const) {
        m.isPickable = false;
        m.applyFog = false;
        m.alwaysSelectAsActiveMesh = true;
        m.thinInstanceSetBuffer('matrix', this.markerMatrix, 16, false);
        m.thinInstanceSetBuffer('color', color, 4, false);
        meshes.push(m);
      }
    }
    this.marker = meshes;

    // Glow: a radial gradient disc, added on top of the scene (reads at night, subtle by day).
    const glow = new DynamicTexture('markerGlow', 64, this.scene, true);
    const ctx = glow.getContext();
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,0.9)');
    g.addColorStop(0.25, 'rgba(255,255,255,0.45)');
    g.addColorStop(0.6, 'rgba(255,255,255,0.12)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
    glow.update();
    glow.hasAlpha = true;
    const haloMat = new StandardMaterial('markerHalo', this.scene);
    haloMat.disableLighting = true;
    haloMat.diffuseColor = Color3.Black();
    haloMat.specularColor = Color3.Black();
    haloMat.emissiveColor = Color3.White();
    haloMat.opacityTexture = glow;
    haloMat.alphaMode = Constants.ALPHA_ADD;
    haloMat.disableDepthWrite = true;
    haloMat.backFaceCulling = false;
    const halo = MeshBuilder.CreatePlane('markerHalo', { size: 1 }, this.scene);
    halo.material = haloMat;
    halo.isPickable = false;
    halo.applyFog = false;
    halo.alwaysSelectAsActiveMesh = true;
    halo.thinInstanceSetBuffer('matrix', this.markerHaloMatrix, 16, false);
    halo.thinInstanceSetBuffer('color', this.markerHaloColor, 4, false);
    this.markerHalo = halo;
  }

  // --- style -------------------------------------------------------------------------

  /** Applies the visual style and the live options (post-processing, fog, filtering, ...). */
  private applyStyle(): void {
    const st = this.style;
    const o = this.options;
    const post = this.post;
    if (post) {
      const ip = post.imageProcessing;
      ip.toneMappingType = st.toneMapping === 'neutral' ? ImageProcessingConfiguration.TONEMAPPING_KHR_PBR_NEUTRAL : ImageProcessingConfiguration.TONEMAPPING_ACES;
      ip.contrast = st.contrast;
      ip.vignetteWeight = st.vignette;
      const curves = ip.colorCurves!;
      curves.globalSaturation = st.saturation;
      curves.highlightsHue = st.highlightsHue;
      curves.highlightsDensity = st.highlightsDensity;
      curves.shadowsHue = st.shadowsHue;
      curves.shadowsDensity = st.shadowsDensity;
      post.sharpenEnabled = st.sharpen > 0;
      if (st.sharpen > 0) post.sharpen.edgeAmount = st.sharpen;
      post.grainEnabled = st.grain > 0;
      if (st.grain > 0) {
        post.grain.intensity = st.grain;
        post.grain.animated = false;
      }
    }
    this.scene.fogDensity = st.fog;
    this.shadows.usePercentageCloserFiltering = st.softShadows;
    this.shadows.filteringQuality = st.softShadows ? ShadowGenerator.QUALITY_MEDIUM : ShadowGenerator.QUALITY_LOW;
    this.lib.setNearest(st.nearestTextures);
    const scale = Math.min(1, Math.max(0.5, o.resolutionScale));
    this.engine.setHardwareScalingLevel(st.pixelScale / (window.devicePixelRatio * scale));
    this.canvas.style.imageRendering = st.pixelScale > 1 ? 'pixelated' : '';
    this.markerPalette = st.marker.map((hex) => {
      const c = Color3.FromHexString(hex).toLinearSpace();
      return [c.r * 1.2, c.g * 1.2, c.b * 1.2, 1];
    });
    this.lampColor.copyFrom(Color3.FromHexString(st.lampColor).toLinearSpace());
    this.glowColor.copyFrom(Color3.FromHexString(st.windowGlow).toLinearSpace());
    const minute = this.townMode ? this.townMinute : this.lastMinute;
    this.applyLighting(minute);
    this.lastLightMinute = minute;
    this.resetSnapshot();
  }

  // --- world building ----------------------------------------------------------------

  /** Roads and garden paths from the town metadata, each merged into one flat mesh. */
  private buildStreets(world: WorldStructure): void {
    const layers: [string, { x: number; z: number; w: number; d: number }[] | undefined, string, number][] = [
      ['streets', world.meta?.streets, 'material.road', 0.012],
      ['paths', world.meta?.paths, 'material.path', 0.014],
    ];
    for (const [name, all, material, y] of layers) {
      // Only the stretch of road in front of the viewed lot.
      const rects = all?.map((r) => this.clipToView(r, STREET_MARGIN)).filter((r) => r !== null);
      if (!rects?.length) continue;
      const parts = rects.map((r) => {
        const m = MeshBuilder.CreateGround(name, { width: r.w, height: r.d }, this.scene);
        m.position.set(r.x + r.w / 2, y, r.z + r.d / 2);
        m.bakeCurrentTransformIntoVertices();
        return m;
      });
      const merged = Mesh.MergeMeshes(parts, true, true);
      if (!merged) continue;
      merged.name = name;
      merged.material = this.lotMaterial(material);
      merged.receiveShadows = true;
      this.worldMeshes.push(merged);
    }
  }

  /** Whether a world point is inside the viewed lot (expanded by `margin`). */
  private inView(x: number, z: number, margin: number): boolean {
    const v = this.view;
    return !v || (x >= v.x - margin && z >= v.z - margin && x <= v.x + v.w + margin && z <= v.z + v.d + margin);
  }

  private clipToView(r: { x: number; z: number; w: number; d: number }, margin: number) {
    const v = this.view;
    if (!v) return r;
    const x0 = Math.max(r.x, v.x - margin);
    const z0 = Math.max(r.z, v.z - margin);
    const x1 = Math.min(r.x + r.w, v.x + v.w + margin);
    const z1 = Math.min(r.z + r.d, v.z + v.d + margin);
    return x1 > x0 && z1 > z0 ? { x: x0, z: z0, w: x1 - x0, d: z1 - z0 } : null;
  }

  /** The viewed house (walls, trims, windows, floors, roof, room lights); returns shadow casters. */
  private buildLot(world: WorldStructure): Mesh[] {
    const { count, depth } = this.storeys;
    const W = world.width;
    const rooms = world.rooms;
    // Stairwells: the tiles above each flight of stairs are open to the storey below.
    const holes = new Set<number>();
    const landings = new Set<number>();
    for (const o of world.objects) {
      if (!this.deps.content.object(o.def)?.stairs) continue;
      for (let z = o.z; z < o.z + o.d; z++) for (let x = o.x; x < o.x + o.w; x++) holes.add((z + depth) * W + x);
      // The tile past the top step, on the storey above (as sim-core `storeys::stair_of`).
      const [lx, lz] = [
        [o.x + Math.floor((o.w - 1) / 2), o.z - 1],
        [o.x - 1, o.z + Math.floor((o.d - 1) / 2)],
        [o.x + Math.floor((o.w - 1) / 2), o.z + o.d],
        [o.x + o.w, o.z + Math.floor((o.d - 1) / 2)],
      ][o.rot % 4];
      landings.add((lz + depth) * W + lx);
    }
    const builds = [];
    for (let k = 0; k < count; k++) {
      const shift = k * depth;
      const view = this.view ? { ...this.view, z: this.view.z + shift } : null;
      // Nothing up there yet: no storey to build.
      if (k > 0 && view && !(world.walls ?? []).some((e) => e.z >= view.z && e.z <= view.z + view.d && e.x >= view.x && e.x <= view.x + view.w)) break;
      const covered = (x: number, z: number) => k + 1 < count && (rooms[(z + depth) * W + x] ?? 0) !== 0;
      const built = this.house.build(world, view, k === 0 ? { covered } : { upper: true, covered, holes, landings });
      if (!built) {
        if (k === 0) break;
        continue;
      }
      // Lifted to its height, back over the ground rows.
      for (const mesh of built.meshes) {
        mesh.position.set(0, k * WALL_HEIGHT, -shift);
        mesh.metadata = { storey: k };
      }
      builds.push(built);
    }
    const built = builds.length
      ? {
          meshes: builds.flatMap((b) => b.meshes),
          roofs: builds.flatMap((b) => b.roofs),
          casters: builds.flatMap((b) => b.casters),
          shrubs: builds[0].shrubs,
          trees: builds[0].trees,
          rooms: new Map(builds.flatMap((b) => [...b.rooms])),
          surfaces: { faces: new Map(builds.flatMap((b) => [...b.surfaces.faces])), floors: new Map(builds.flatMap((b) => [...b.surfaces.floors])) },
        }
      : null;
    if (!built) {
      // Unknown wall layout: fall back to the simulation's plain meshes.
      this.meshFromArrays('floors', world.meshes.floors, this.lotMaterial('material.floor'));
      const wallMat = this.lotMaterial('material.wall');
      this.walls = this.meshFromArrays('walls', world.meshes.walls, wallMat);
      this.wallsLow = this.meshFromArrays('wallsLow', world.meshes.wallsLow, wallMat);
      this.lotRooms = null;
      this.lotSurfaces = null;
      this.refreshLaid();
      return [];
    }
    this.worldMeshes.push(...built.meshes);
    this.roofs = built.roofs;
    // Roofs start hidden (walls down / cutaway); compile them now so walls-up doesn't hitch.
    for (const roof of built.roofs) void roof.material?.forceCompilationAsync(roof).catch(() => {});
    // Garden dressing split into species (hedges or mixed shrub borders, varied lot trees).
    for (const [key, items] of [...natureDecor('model.bush', built.shrubs), ...natureDecor('model.tree', built.trees, world, this.view)]) void this.placeDecor(key, items);
    this.lotRooms = built.rooms;
    this.lotSurfaces = built.surfaces;
    this.refreshLaid();
    return built.casters;
  }

  /** The household's lamps (then dim fills for rooms without one) on the interior lights. */
  private placeRoomLights(world: WorldStructure, view: ViewRect | null): void {
    // Rooms and lamps on every storey shown (in lot rows: lifted to their height here).
    const shown = (z: number) => this.storeyOf(z) <= this.storey;
    const views = Array.from({ length: this.storeys.count }, (_, k) => (view ? { ...view, z: view.z + k * this.storeys.depth } : null));
    const lights = this.lotRooms
      ? views.flatMap((v) => placeLights(world, v, this.lotRooms!, (def) => this.deps.content.object(def)?.light)).filter((l) => shown(l.z))
      : [];
    lights.sort((a, b) => this.storeyOf(a.z) - this.storeyOf(b.z));
    this.roomLightUse = this.roomLights.map((light, i) => {
      const l = lights[i];
      if (l) light.position.set(l.x, l.y + this.storeyOf(l.z) * WALL_HEIGHT, l.z - this.storeyOf(l.z) * this.storeys.depth);
      else light.position.y = HIDDEN_Y;
      return l ?? null;
    });
  }

  /** Garden dressing as thin instances of a cached template (`deco:` keys). */
  private async placeDecor(key: string, items: [number, number, number, number][]): Promise<void> {
    if (!items.length) return;
    const template = await this.template(`deco:${key}`, () => buildModel(this.scene, key, this.deps.assets.get(key, 'model'), [1, 1]));
    const matrices = new Float32Array(items.length * 16);
    items.forEach(([x, z, s, yaw], i) => {
      Matrix.ComposeToRef(this.vScale.setAll(s), Quaternion.RotationYawPitchRollToRef(yaw, 0, 0, this.qTmp), this.vTmp.set(x, 0, z), this.mOut);
      this.mOut.copyToArray(matrices, i * 16);
    });
    for (const mesh of template.meshes) {
      mesh.thinInstanceSetBuffer('matrix', matrices, 16, true);
      mesh.thinInstanceRefreshBoundingInfo(false);
      mesh.receiveShadows = true;
    }
    this.resetSnapshot();
  }

  private applyWallMode(): void {
    const mode = this.wallMode;
    this.walls?.setEnabled(mode === 'up');
    this.wallsLow?.setEnabled(mode !== 'up');
    this.roofShown = this.roofVisible();
    this.showRoofs();
    // Cut walls would still cast full-height shadows (the shadow pass has no cutaway), so the
    // house only casts with walls up; stubs and open rooms are then sunlit, as in the classics.
    this.updateShadowList();
    this.lib.wallCut.params.x = mode === 'down' ? 1 : 0;
    this.lib.wallCut.params.y = WALL_STUB;
    this.cutLook = -1;
    this.updateCutaway();
  }

  /** The viewed lot's roof: only with walls up, and not when zoomed in (it would fill the view). */
  private roofVisible(): boolean {
    return this.wallMode === 'up' && this.gameCamera.radius > ROOF_MIN_DISTANCE;
  }

  /**
   * Snapshot replays were observed to keep the camera of their recording, so a moving camera
   * re-records each frame (normal rendering cost) and replay resumes once it is still.
   */
  private followCamera(): void {
    const c = this.camera;
    const v = this.lastView;
    const t = c.target;
    const o = c.targetScreenOffset;
    if (v[0] === c.alpha && v[1] === c.beta && v[2] === c.radius && v[3] === t.x && v[4] === t.y && v[5] === t.z && v[6] === o.x && v[7] === o.y) return;
    v[0] = c.alpha;
    v[1] = c.beta;
    v[2] = c.radius;
    v[3] = t.x;
    v[4] = t.y;
    v[5] = t.z;
    v[6] = o.x;
    v[7] = o.y;
    this.resetSnapshot();
  }

  /** Cutaway: walls facing the camera drop when the view direction crosses a quadrant. */
  private updateCutaway(): void {
    let bits = 0;
    if (this.wallMode === 'cutaway') {
      // Camera looks from its position towards the target: direction -(cos a, sin a) in xz.
      const dx = -Math.cos(this.gameCamera.alpha);
      const dz = -Math.sin(this.gameCamera.alpha);
      if (dx > 0.3) bits |= 1;
      if (dx < -0.3) bits |= 2;
      if (dz > 0.3) bits |= 4;
      if (dz < -0.3) bits |= 8;
    }
    if (bits === this.cutLook) return;
    this.cutLook = bits;
    this.lib.wallCut.look.set(bits & 1 ? 1 : 0, bits & 2 ? 1 : 0, bits & 4 ? 1 : 0, bits & 8 ? 1 : 0);
    this.resetSnapshot();
  }

  /** Model key for an object, preferring its style variant (`model.sofa@modern`) when one exists. */
  private objectModel(o: ObjectPlacement): string {
    const def = this.deps.content.object(o.def);
    const base = def?.model ?? `model.${o.def}`;
    // `style` and `styles` arrive with build/buy mode; read them defensively.
    const style = (o as ObjectPlacement & { style?: number }).style;
    const styles: readonly { id: string }[] = (this.deps.content as unknown as { styles?: { id: string }[] }).styles ?? [];
    const id = typeof style === 'number' ? styles[style]?.id : undefined;
    return id && this.deps.assets.has(`${base}@${id}`, 'model') ? `${base}@${id}` : base;
  }

  private async buildObjects(world: WorldStructure): Promise<void> {
    // Things on the storeys up to the one in view, each lifted to its storey (from its lot rows).
    const D = this.storeys.depth;
    const shown = world.objects.filter((o) => this.storeyOf(o.z) <= this.storey && this.inView(o.x + o.w / 2, o.z - this.storeyOf(o.z) * D + o.d / 2, 0));
    const byModel = Map.groupBy(shown, (o) => `${o.def}|${this.objectModel(o)}`);
    const templates = await Promise.all(
      [...byModel.entries()].map(([group, list]) => {
        const key = group.slice(group.indexOf('|') + 1);
        const def = this.deps.content.object(list[0].def);
        return this.template(`object:${key}`, () => buildModel(this.scene, key, this.deps.assets.get(key, 'model'), def?.footprint ?? [1, 1]));
      }),
    );
    // Soft contact shadows under every object, sized to its footprint.
    const blobs = new Float32Array(Math.max(1, shown.length) * 16);
    [...byModel.entries()].forEach(([group, list], n) => {
      const template = templates[n];
      const matrices = new Float32Array(list.length * 16);
      const vary = this.deps.assets.get(group.slice(group.indexOf('|') + 1), 'model')?.vary ?? 0;
      list.forEach((o, i) => {
        const { turn, size } = placementVariation(vary, o.x, o.z);
        const k = this.storeyOf(o.z);
        const [y0, z] = [k * WALL_HEIGHT, o.z - k * D];
        Quaternion.RotationYawPitchRollToRef((o.rot * Math.PI) / 2 + ((o.turn ?? 0) * Math.PI) / 180 + turn, 0, 0, this.qTmp);
        Matrix.ComposeToRef(this.vScale.setAll(size), this.qTmp, this.vTmp.set(o.x + o.w / 2, y0, z + o.d / 2), this.mOut);
        this.mOut.copyToArray(matrices, i * 16);
        this.placed.push({ id: o.id, y0, minX: o.x, minZ: z, maxX: o.x + o.w, maxZ: z + o.d, height: template.height, pop: { meshes: template.meshes, matrices, index: i } });
      });
      for (const mesh of template.meshes) {
        mesh.thinInstanceSetBuffer('matrix', matrices, 16, true);
        mesh.thinInstanceRefreshBoundingInfo(false);
        mesh.receiveShadows = true;
      }
    });
    shown.forEach((o, i) => {
      const k = i * 16;
      const s = this.storeyOf(o.z);
      blobs[k] = o.w * 1.15;
      blobs[k + 5] = 1;
      blobs[k + 10] = o.d * 1.15;
      blobs[k + 12] = o.x + o.w / 2;
      blobs[k + 13] = 0.018 + s * WALL_HEIGHT;
      blobs[k + 14] = o.z - s * D + o.d / 2;
      blobs[k + 15] = 1;
    });
    if (!shown.length) return;
    const shadows = this.objectShadow.clone('objectShadows', null, true, false) as Mesh;
    shadows.setEnabled(true);
    shadows.thinInstanceSetBuffer('matrix', blobs, 16, true);
    const blobIndex = new Map(shown.map((o, i) => [o.id, i]));
    for (const p of this.placed) {
      const index = blobIndex.get(p.id);
      if (index !== undefined) p.shadow = { meshes: [shadows], matrices: blobs, index };
    }
    shadows.thinInstanceCount = shown.length;
    shadows.thinInstanceRefreshBoundingInfo(false);
    this.worldMeshes.push(shadows);
  }

  /** Cached template by key; marks it as used by the world being built. */
  private template(key: string, build: () => Promise<ModelTemplate>): Promise<ModelTemplate> {
    let t = this.templates.get(key);
    if (!t) {
      t = build();
      this.templates.set(key, t);
    }
    this.templatesInUse.add(key);
    return t.then((template) => {
      for (const mesh of template.meshes) mesh.setEnabled(true);
      return template;
    });
  }

  /** Disables cached templates the current world doesn't use. */
  private retireTemplates(keep: Set<string>): void {
    for (const [key, t] of this.templates) {
      if (keep.has(key)) continue;
      void t.then((template) => {
        if (!this.templatesInUse.has(key)) for (const mesh of template.meshes) mesh.setEnabled(false);
      });
    }
    for (const key of [...this.templatesInUse]) if (!keep.has(key)) this.templatesInUse.delete(key);
  }

  /** Meshes of the templates in use (for shadows and freezing). */
  private async templateMeshes(): Promise<Mesh[]> {
    const lists = await Promise.all([...this.templatesInUse].map((k) => this.templates.get(k)!));
    return lists.flatMap((t) => t.meshes);
  }

  private async buildSims(world: WorldStructure): Promise<void> {
    await this.characters.build(world);
    // Sims arrive at the lot's entry, in front of the door. The first time a lot is shown, view it
    // from that side (three-quarter angle) so the cutaway opens the front wall instead of the
    // full-height back wall hiding the arriving household.
    const v = this.view;
    const key = v ? `${v.x},${v.z},${v.w},${v.d}` : '';
    if (v && key !== this.framedView) {
      this.framedView = key;
      const entry = world.plots.find((p) => p.x === v.x && p.z === v.z)?.entry;
      const dx = entry ? entry[0] - (v.x + v.w / 2) : 0;
      const dz = entry ? entry[1] - (v.z + v.d / 2) : 0;
      if (Math.hypot(dx, dz) > 1) this.gameCamera.alpha = Math.atan2(dz, dx) - Math.PI * 0.12;
    }
    // Selection marker colour per emotion code (index + 1; 0 = none).
    this.emotionMood = [1, ...this.deps.content.emotions.map((e) => EMOTION_MOOD[e.id] ?? 1)];
    this.characters.setEmotions(this.deps.content.emotions.map((e) => e.id));
  }

  private meshFromArrays(name: string, arrays: MeshArrays, material: Material): Mesh | null {
    if (arrays.positions.length === 0) return null;
    const mesh = new Mesh(name, this.scene);
    const data = new VertexData();
    data.positions = arrays.positions;
    data.normals = arrays.normals;
    data.uvs = arrays.uvs;
    data.indices = arrays.indices;
    data.applyToMesh(mesh, false);
    mesh.material = material;
    mesh.receiveShadows = true;
    this.worldMeshes.push(mesh);
    return mesh;
  }

  private lotMaterial(key: string): Material {
    // Textured PBR surface from the shared library (cached per key, frozen once loaded).
    // Generated geometry has explicit normals; don't depend on triangle winding.
    return this.lib.surface(key, { doubleSided: true });
  }

  /** Builds (once per model key) the translucent preview meshes for buy mode. */
  private loadGhost(model: string): void {
    this.ghostKey = model;
    for (const mesh of this.ghostMeshes) mesh.dispose(false, false);
    this.ghostMeshes = [];
    const key = model;
    void buildModel(this.scene, `ghost:${key}`, this.deps.assets.get(key, 'model'), [1, 1]).then((template) => {
      if (this.ghostKey !== key) {
        for (const mesh of template.meshes) mesh.dispose(false, false);
        return;
      }
      for (const mesh of template.meshes) {
        mesh.material = this.ghostMaterial;
        mesh.parent = this.ghostRoot;
        mesh.isPickable = false;
        mesh.renderingGroupId = 1;
        mesh.thinInstanceSetBuffer('matrix', Matrix.Identity().asArray() as unknown as Float32Array, 16, true);
        mesh.thinInstanceSetBuffer('color', this.ghostColor, 4, false);
        mesh.alwaysSelectAsActiveMesh = true;
      }
      this.ghostMeshes = template.meshes;
      this.setGhostTint();
    });
  }

  private setGhostTint(): void {
    this.ghostColor.set(this.ghostValid ? [0.55, 1.0, 0.6, 1] : [1.0, 0.45, 0.42, 1]);
    this.ghostArrowMaterial.emissiveColor.set(this.ghostColor[0], this.ghostColor[1], this.ghostColor[2]);
    for (const mesh of this.ghostMeshes) mesh.thinInstanceBufferUpdated('color');
    this.resetSnapshot();
  }

  // --- per frame ---------------------------------------------------------------------

  /**
   * The selection marker floats above the selected Sim facing the camera: a slow bob, a soft
   * breathing pulse in size and brightness, and no spin. It grows a little with camera distance
   * so it stays readable when zoomed out. Its colour follows their mood. Allocation-free.
   */
  private writeMarker(x: number, headY: number, z: number, emotion: number, now: number): void {
    const t = now * 0.001;
    const breath = Math.sin(t * 2.4);
    const cam = this.camera.globalPosition;
    const dist = Math.hypot(cam.x - x, cam.y - headY, cam.z - z);
    const grow = 1 + Math.min(2.2, Math.max(0, dist - 5) * 0.06);
    const s = grow * (1 + breath * 0.05);
    // Float clear of the head: the lower ray's tip stays ~8 cm above it at any size.
    const by = headY + 0.07 + 0.19 * grow + Math.sin(t * 1.5) * 0.03;
    // Camera right / up / forward in world space: the columns of the view matrix's rotation.
    const v = this.camera.getViewMatrix().m;
    // The halo: same orientation, larger, nudged just behind the star (away from the camera).
    const hs = 0.62 * s * (1 + breath * 0.06);
    const out = this.markerMatrix;
    const halo = this.markerHaloMatrix;
    for (let r = 0; r < 3; r++) {
      for (let k = 0; k < 3; k++) {
        out[r * 4 + k] = v[r + k * 4] * s;
        halo[r * 4 + k] = v[r + k * 4] * hs;
      }
      out[r * 4 + 3] = halo[r * 4 + 3] = 0;
    }
    out[12] = x;
    out[13] = by;
    out[14] = z;
    out[15] = halo[15] = 1;
    for (let k = 0; k < 3; k++) halo[12 + k] = out[12 + k] + v[2 + k * 4] * 0.04;

    const slot = this.emotionMood[emotion | 0] ?? 1;
    const c = this.markerPalette[slot] ?? this.markerPalette[0];
    if (!c) return;
    const glow = 1 + breath * 0.12;
    this.markerColor[0] = c[0] * glow;
    this.markerColor[1] = c[1] * glow;
    this.markerColor[2] = c[2] * glow;
    this.markerColor[3] = 1;
    // Outline: the mood colour, much deeper (amber -> warm brown, periwinkle -> ink blue).
    this.markerOutlineColor[0] = c[0] * 0.16;
    this.markerOutlineColor[1] = c[1] * 0.13;
    this.markerOutlineColor[2] = c[2] * 0.12;
    this.markerOutlineColor[3] = 1;
    const h = 0.22 * (1 + breath * 0.25);
    this.markerHaloColor[0] = c[0] * h;
    this.markerHaloColor[1] = c[1] * h;
    this.markerHaloColor[2] = c[2] * h;
    this.markerHaloColor[3] = 1;
  }

  private applyLighting(minute: number): void {
    const l = lightingAt(minute, this.style, this.lighting);
    this.sun.direction.copyFrom(l.sunDirection);
    l.sunDirection.scaleToRef(-40, this.vTmp);
    this.sun.position.copyFrom(this.townMode && this.overview ? this.overview.centre : this.lotCentre).addInPlace(this.vTmp);
    this.sun.intensity = l.sunIntensity;
    this.sun.diffuse.copyFrom(l.sunColor);
    this.sun.specular.copyFrom(l.sunColor);
    this.sky.intensity = l.skyIntensity;
    this.sky.diffuse.copyFrom(l.skyColor);
    this.sky.groundColor.copyFrom(l.groundColor);
    // Shading is linear (image processing converts to sRGB at the end), so key colours are too.
    l.clearColor.toLinearSpaceToRef(this.scene.fogColor);
    this.scene.clearColor.set(this.scene.fogColor.r, this.scene.fogColor.g, this.scene.fogColor.b, 1);
    this.skyDome.update(l);
    this.lib.setEnvironmentIntensity(l.envIntensity);
    if (this.post) {
      this.post.imageProcessing.exposure = l.exposure * this.style.exposure;
      // Moonlit nights: blue-grey dark tones, warm lamps and windows (see nightGrade.ts).
      if (this.nightGrade) {
        this.nightGrade.amount = l.night * this.style.nightGrade;
        this.nightGrade.update();
      }
    }

    // Warm lamps inside, glowing windows outside at night; cool daylight in the panes by day.
    this.roomLights.forEach((light, i) => {
      // The overview has no interiors: the game house's lamps stay off behind it.
      const use = this.townMode ? null : (this.roomLightUse[i] ?? null);
      if (!use) {
        light.intensity = 0;
      } else if (use.kind === 'lamp') {
        // A lamp the household bought: a warm pool around it.
        light.intensity = l.lamps * LAMP_POWER * (use.power ?? 1);
        light.range = use.range ?? 4.5;
      } else {
        // A room without a lamp: only a dim glow from the ceiling.
        light.intensity = l.lamps * FILL_POWER * (4 + Math.min(use.area, 30) * 0.35);
        light.range = 4 + Math.sqrt(use.area) * 1.4;
      }
      light.diffuse.copyFrom(this.lampColor);
    });
    const glass = this.lib.surface('material.window', { vertexColors: true, cutaway: true }) as PBRMaterial;
    // Windows light up only once it is getting dark outside.
    const glow = Math.min(1, Math.max(0, (l.lamps - 0.35) / 0.5));
    this.glowColor.scaleToRef(glow * glow * 1.6, glass.emissiveColor);
    this.lib.touch(glass);
    const inner = this.lib.surface('material.window.inner', { vertexColors: true, cutaway: true }) as PBRMaterial;
    l.clearColor.toLinearSpaceToRef(inner.emissiveColor);
    inner.emissiveColor.scaleInPlace((1 - l.lamps) * 0.9 + 0.05);
    this.lib.touch(inner);
    this.street?.setNight(l.lamps, this.glowColor);
    this.overview?.setNight(l.lamps, this.glowColor);
  }

  private resetSnapshot(): void {
    if (this.webgpu?.snapshotRendering) this.webgpu.snapshotRenderingReset();
  }

  /** A world or overview build starts: no snapshot recording until every build is done. */
  private beginBuild(): void {
    this.builds++;
    this.snapshotGeneration++;
    if (this.webgpu) this.webgpu.snapshotRendering = false;
  }

  private endBuild(): void {
    this.builds = Math.max(0, this.builds - 1);
    if (this.builds === 0) this.scheduleSnapshot();
  }

  /** Stops replaying (the scene changed a lot) and records again once it has settled. */
  private pauseSnapshot(): void {
    this.snapshotGeneration++;
    if (this.webgpu) this.webgpu.snapshotRendering = false;
    if (this.builds === 0) this.scheduleSnapshot();
  }

  /**
   * Starts snapshot recording once the scene and its post-process effects have settled: only for
   * the town overview behind the menus. In play, replays don't pick up the Sims' pose texture
   * updates (Sims froze between re-recordings) and each re-record cost a 50-70 ms hitch, while
   * drawing live costs only ~0.2 ms more per frame.
   */
  private scheduleSnapshot(): void {
    const engine = this.webgpu;
    const generation = ++this.snapshotGeneration;
    if (!engine || !this.quality.snapshotRendering || !this.townMode) return;
    // A newer build (or pause) may have started by the time this runs; it records once it is done.
    const current = () => generation === this.snapshotGeneration && this.builds === 0 && this.townMode;
    this.scene.executeWhenReady(() => {
      let left = 10;
      const observer = this.scene.onAfterRenderObservable.add(() => {
        if (--left > 0) return;
        this.scene.onAfterRenderObservable.remove(observer);
        if (!current()) return;
        engine.snapshotRenderingMode = Constants.SNAPSHOTRENDERING_STANDARD;
        engine.snapshotRendering = true;
        // Record once more after the first replays: the first recording can capture one-off
        // start-up state (late material freezes) and then stop following the camera.
        let again = 15;
        const second = this.scene.onAfterRenderObservable.add(() => {
          if (--again > 0) return;
          this.scene.onAfterRenderObservable.remove(second);
          if (current()) this.resetSnapshot();
        });
      });
    });
  }

  private readonly onResize = () => this.engine.resize();

  /** Image-based lighting from a prefiltered environment (manifest key `environment.sky`). */
  private async setupEnvironment(): Promise<void> {
    const entry = this.deps.assets.get('environment.sky', 'image');
    if (entry) await this.lib.loadEnvironment(entry.url);
  }
}

/** Copies an orbit camera's angles, radius and target. */
function copyPose(from: ArcRotateCamera, to: ArcRotateCamera): void {
  to.alpha = from.alpha;
  to.beta = from.beta;
  to.radius = from.radius;
  to.target.copyFrom(from.target);
}

/** Ray vs axis-aligned box (slab test). Returns distance or Infinity. */
function rayBox(o: Vector3, d: Vector3, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): number {
  let tMin = 0;
  let tMax = Infinity;
  const axes: [number, number, number, number][] = [
    [o.x, d.x, x0, x1],
    [o.y, d.y, y0, y1],
    [o.z, d.z, z0, z1],
  ];
  for (const [origin, dir, lo, hi] of axes) {
    if (Math.abs(dir) < 1e-9) {
      if (origin < lo || origin > hi) return Infinity;
      continue;
    }
    let t0 = (lo - origin) / dir;
    let t1 = (hi - origin) / dir;
    if (t0 > t1) [t0, t1] = [t1, t0];
    tMin = Math.max(tMin, t0);
    tMax = Math.min(tMax, t1);
    if (tMin > tMax) return Infinity;
  }
  return tMin;
}
