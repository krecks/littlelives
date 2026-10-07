/**
 * Babylon.js implementation of the Renderer contract.
 *
 * Performance model:
 * - WebGPU first (WebGL2 fallback). With WebGPU, snapshot rendering records the frame's
 *   draw commands once and replays them; it is re-recorded only on structural changes.
 * - Every object type is one mesh drawn with thin instances (one draw call per type).
 * - Sims are thin instances too; per frame we update one matrix buffer per mesh.
 * - No allocations in `update()`.
 */

import {
  ArcRotateCamera,
  Color3,
  Color4,
  Constants,
  DefaultRenderingPipeline,
  DepthOfFieldEffectBlurLevel,
  DirectionalLight,
  Engine,
  HemisphericLight,
  ImageProcessingConfiguration,
  Material,
  Matrix,
  Mesh,
  MeshBuilder,
  Scene,
  SceneInstrumentation,
  CreateScreenshotAsync,
  ShadowGenerator,
  SSAO2RenderingPipeline,
  StandardMaterial,
  Vector3,
  VertexBuffer,
  VertexData,
  Viewport,
  WebGPUEngine,
  type AbstractEngine,
} from '@babylonjs/core';
import type { FrameState } from '../../core/bridge';
import type { MeshArrays, WorldStructure } from '../../core/protocol';
import { Pose } from '../../core/snapshot';
import type { QualitySettings } from '../quality';
import type { Appearance } from '../../game/household';
import type { LiveRenderOptions, PickResult, Renderer, RendererDeps, RenderStats, ViewRect, WallMode } from '../types';
import { createLighting, lightingAt } from './environment';
import { MaterialLibrary } from './materials';
import { buildModel, type ModelTemplate } from './models';
import { Landscape, Sky } from './nature';

const ACCENT = Color3.FromHexString('#5B7CFA');
/** Helpers are parked below the ground instead of toggling visibility (keeps snapshots valid). */
const HIDDEN_Y = -100;
/** Larger jumps between snapshots (e.g. getting out of bed) snap instead of sliding. */
const TELEPORT_DISTANCE = 1.5;
/** Game minutes between lighting updates (with / without snapshot rendering). */
const LIGHT_STEP = 0.5;
const LIGHT_STEP_SNAPSHOT = 5;

interface PlacedObject {
  id: number;
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
  height: number;
}

/** One mesh set (a body or a hairstyle) instanced for the Sims that use it. */
interface SimGroup {
  meshes: Mesh[];
  /** Sim index (snapshot order) for each instance. */
  slots: number[];
  matrices: Float32Array;
}

const MAX_SIMS = 64;
/** How far the road is drawn beyond the viewed lot. */
const STREET_MARGIN = 10;
/** Sims are drawn this far outside the lot (e.g. walking up the garden path). */
const SIM_VIEW_MARGIN = 2;
/** Snapshot animation codes (see `social::ANIMATIONS` in sim-core). */
const Anim = { None: 0, Talk: 1, Laugh: 2, Flirt: 3, Argue: 4, Fight: 5, Hug: 6, Kiss: 7 } as const;

export class BabylonRenderer implements Renderer {
  private engine!: AbstractEngine;
  private webgpu: WebGPUEngine | null = null;
  private scene!: Scene;
  private camera!: ArcRotateCamera;
  private sun!: DirectionalLight;
  private sky!: HemisphericLight;
  private shadows!: ShadowGenerator;
  private post: DefaultRenderingPipeline | null = null;
  private instrumentation!: SceneInstrumentation;
  private canvas!: HTMLCanvasElement;

  private worldMeshes: Mesh[] = [];
  private onFrame: ((now: number) => void) | null = null;
  private active = false;
  private idleOrbit = false;
  private frameWaiters: { left: number; resolve: () => void }[] = [];
  /**
   * Built model templates by key, kept across lot switches and sessions (building them
   * is expensive). Templates not used by the current world are disabled, not disposed.
   */
  private readonly templates = new Map<string, Promise<ModelTemplate>>();
  private readonly templatesInUse = new Set<string>();
  /** Landscape meshes survive lot switches; rebuilt only for a different town. */
  private natureMeshes: Mesh[] = [];
  private natureCasters: Mesh[] = [];
  private natureKey = '';
  /** Lot being shown; null = everything. */
  private view: ViewRect | null = null;
  private walls: Mesh | null = null;
  private wallsLow: Mesh | null = null;
  private wallMode: WallMode = 'down';
  private placed: PlacedObject[] = [];
  private simGroups: SimGroup[] = [];
  private cursor!: Mesh;
  private ring!: Mesh;
  private selectedSim: number | null = null;
  private cameraPlaced = false;
  private vertexColorMaterial!: StandardMaterial;

  private skyDome!: Sky;
  private readonly lighting = createLighting();
  private lastLightMinute = -1;
  private readonly lotCentre = new Vector3();

  // Scratch objects for allocation-free updates.
  private readonly mRot = new Matrix();
  private readonly mLocal = new Matrix();
  private readonly mPos = new Matrix();
  private readonly mTmp = new Matrix();
  private readonly mOut = new Matrix();
  private readonly mScale = new Matrix();
  private readonly mA = new Matrix();
  private readonly mB = new Matrix();
  /** Per-Sim world matrices, computed once per frame and shared by body and hair groups. */
  private readonly simMatrices = new Float32Array(MAX_SIMS * 16);
  private readonly simHeads = new Float32Array(MAX_SIMS * 3);
  private simHeights = new Float32Array(MAX_SIMS).fill(1);
  private simCount = 0;
  private readonly simVisible = new Uint8Array(MAX_SIMS);
  private readonly lieLocal = Matrix.RotationX(-Math.PI / 2).multiply(Matrix.Translation(0, 0.77, 0.83));
  private readonly sitLocal = Matrix.Translation(0, 0.35, 0.08);
  private readonly vTmp = new Vector3();
  private readonly vProj = new Vector3();
  private readonly viewport = new Viewport(0, 0, 1, 1);

  constructor(
    private readonly deps: RendererDeps,
    private readonly quality: QualitySettings,
  ) {}

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
    // PBR materials and image-based lighting; the environment must exist before materials compile.
    MaterialLibrary.for(scene).setAssets(this.deps.assets);
    await this.setupEnvironment();

    this.vertexColorMaterial = new StandardMaterial('vertexColor', scene);
    this.vertexColorMaterial.specularColor = Color3.Black();
    this.vertexColorMaterial.freeze();

    this.setupCamera();
    this.setupLights();
    this.skyDome = new Sky(scene, 700);
    // Distance fog in the horizon colour makes the hills fade into the sky.
    scene.fogMode = Scene.FOGMODE_EXP2;
    scene.fogDensity = 0.0024;
    this.setupPostProcessing();
    this.setupHelpers();
    window.addEventListener('resize', this.onResize);
  }

  async setWorld(world: WorldStructure, view: ViewRect | null): Promise<void> {
    this.suspendSnapshot();
    for (const mesh of this.worldMeshes) mesh.dispose(false, false);
    this.worldMeshes = [];
    this.placed = [];
    this.simGroups = [];
    this.view = view;

    const { width, depth } = world;
    this.lotCentre.set(width / 2, 0, depth / 2);
    if (!this.cameraPlaced) {
      this.camera.setTarget(this.lotCentre.clone());
      this.cameraPlaced = true;
    }

    // The landscape depends only on the town, not on which lot is viewed: build it once.
    const natureKey = `${world.meta?.seed ?? 1}:${width}x${depth}`;
    if (natureKey !== this.natureKey) {
      for (const mesh of this.natureMeshes) mesh.dispose(false, false);
      const nature = await new Landscape(world).build(this.scene, this.deps.assets, world);
      this.natureMeshes = nature.meshes;
      this.natureCasters = nature.casters;
      this.natureKey = natureKey;
      for (const mesh of this.natureMeshes) mesh.freezeWorldMatrix();
    }
    this.templatesInUse.clear();
    this.buildStreets(world);
    this.buildLot(world);
    this.buildSilhouettes(world);
    await this.buildObjects(world);
    await this.buildSims(world);
    this.retireTemplates(new Set(this.templatesInUse));
    const templates = await this.templateMeshes();

    const flat = new Set(['floors', 'streets', 'paths']);
    const casters = [...this.worldMeshes.filter((m) => !flat.has(m.name)), ...templates, ...this.natureCasters];
    this.shadows.getShadowMap()!.renderList = casters;
    for (const mesh of [...this.worldMeshes, ...templates]) mesh.freezeWorldMatrix();
    this.lastLightMinute = -1;
    this.finishSetup();
  }

  update(frame: FrameState): void {
    const { prev, curr, alpha, layout, now } = frame;
    // Snapshot rendering bakes light uniforms and the clear colour into the recording, so
    // lighting changes force a re-record; throttle them to keep most frames replayed.
    const minute = curr[layout.header.minute];
    const snapshot = this.webgpu?.snapshotRendering ?? false;
    if (Math.abs(minute - this.lastLightMinute) >= (snapshot ? LIGHT_STEP_SNAPSHOT : LIGHT_STEP)) {
      this.applyLighting(minute);
      this.lastLightMinute = minute;
      if (snapshot) this.webgpu!.snapshotRenderingReset();
    }

    const count = Math.min(curr[layout.header.simCount], MAX_SIMS);
    const H = layout.headerLen;
    const S = layout.simStride;
    const k = layout.sim;
    this.simCount = count;
    for (let i = 0; i < count; i++) {
      const o = H + i * S;
      const cx = curr[o + k.x];
      const cz = curr[o + k.z];
      let x = cx;
      let z = cz;
      let yaw = curr[o + k.yaw];
      if (Math.abs(cx - prev[o + k.x]) + Math.abs(cz - prev[o + k.z]) < TELEPORT_DISTANCE) {
        x = lerp(prev[o + k.x], cx, alpha);
        z = lerp(prev[o + k.z], cz, alpha);
        yaw = lerpAngle(prev[o + k.yaw], yaw, alpha);
      }
      const pose = curr[o + k.pose];
      const height = this.simHeights[i];
      // Sims at work or on other lots aren't drawn (a zero matrix collapses the instance).
      this.simVisible[i] = curr[o + k.away] === 0 && this.inView(x, z, SIM_VIEW_MARGIN) ? 1 : 0;
      if (!this.simVisible[i]) {
        this.simMatrices.fill(0, i * 16, i * 16 + 16);
        if (i === this.selectedSim) this.ring.position.y = HIDDEN_Y;
        continue;
      }
      this.writeSimMatrix(i, x, z, yaw, pose, curr[o + k.moving] > 0, curr[o + k.anim], now, height, this.simMatrices, i * 16);
      this.simHeads[i * 3] = x;
      this.simHeads[i * 3 + 1] = (pose === Pose.Lie ? 1.1 : pose === Pose.Sit ? 1.55 : 1.95) * height;
      this.simHeads[i * 3 + 2] = z;
      if (i === this.selectedSim) this.ring.position.set(x, 0.04, z);
    }
    for (const group of this.simGroups) {
      const m = group.matrices;
      for (let j = 0; j < group.slots.length; j++) {
        const src = group.slots[j] * 16;
        for (let e = 0; e < 16; e++) m[j * 16 + e] = this.simMatrices[src + e];
      }
      for (const mesh of group.meshes) mesh.thinInstanceBufferUpdated('matrix');
    }
    if (this.selectedSim === null || this.selectedSim >= count) this.ring.position.y = HIDDEN_Y;

    if (this.post?.depthOfFieldEnabled) this.post.depthOfField.focusDistance = this.camera.radius * 1000;
  }

  pick(x: number, y: number): PickResult {
    const ray = this.scene.createPickingRay(x, y, null, this.camera);
    const o = ray.origin;
    const d = ray.direction;
    let ground: PickResult['ground'] = null;
    if (d.y < -1e-6) {
      const t = -o.y / d.y;
      ground = { x: o.x + d.x * t, z: o.z + d.z * t };
    }
    let objectId: number | null = null;
    let nearest = Infinity;
    for (const p of this.placed) {
      const t = rayBox(o, d, p.minX, 0, p.minZ, p.maxX, p.height, p.maxZ);
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
    Vector3.ProjectToRef(this.vTmp, Matrix.IdentityReadOnly, this.scene.getTransformMatrix(), this.viewport, this.vProj);
    if (this.vProj.z < 0 || this.vProj.z > 1) return false;
    out.x = this.vProj.x;
    out.y = this.vProj.y;
    return true;
  }

  simHead(index: number, out: { x: number; y: number; z: number }): boolean {
    if (index >= this.simCount || !this.simVisible[index]) return false;
    out.x = this.simHeads[index * 3];
    out.y = this.simHeads[index * 3 + 1];
    out.z = this.simHeads[index * 3 + 2];
    return true;
  }

  focus(x: number, z: number): void {
    // Keep the viewing angle; move the camera with its target (setTarget's default
    // would keep the camera's position and swing the angles instead).
    this.camera.setTarget(new Vector3(x, 0, z), false, false, true);
    this.camera.radius = Math.min(this.camera.radius, 32);
    this.cameraPlaced = true;
  }

  setHoverTile(tile: { x: number; z: number } | null): void {
    if (tile) this.cursor.position.set(tile.x + 0.5, 0.025, tile.z + 0.5);
    else this.cursor.position.y = HIDDEN_Y;
  }

  setSelectedSim(id: number | null): void {
    this.selectedSim = id;
  }

  setWallMode(mode: WallMode): void {
    this.wallMode = mode;
    this.walls?.setEnabled(mode === 'up');
    this.wallsLow?.setEnabled(mode === 'down');
    if (this.webgpu?.snapshotRendering) this.webgpu.snapshotRenderingReset();
  }

  configure(options: LiveRenderOptions): void {
    if (this.post) {
      this.post.bloomEnabled = options.bloom;
      this.post.depthOfFieldEnabled = options.tiltShift;
    }
    const scale = Math.min(1, Math.max(0.5, options.resolutionScale));
    this.engine.setHardwareScalingLevel(1 / (window.devicePixelRatio * scale));
    const s = Math.max(0.25, options.cameraSensitivity);
    this.camera.angularSensibilityX = this.camera.angularSensibilityY = 1000 / s;
    this.camera.panningSensibility = 90 / s;
    this.camera.wheelDeltaPercentage = 0.012 * s;
    if (this.webgpu?.snapshotRendering) this.webgpu.snapshotRenderingReset();
  }

  async captureThumbnail(width: number, height: number): Promise<string | null> {
    try {
      return await CreateScreenshotAsync(this.engine, this.camera, { width, height }, 'image/jpeg', 0.8);
    } catch (err) {
      console.warn('[render] thumbnail capture failed', err);
      return null;
    }
  }

  stats(): RenderStats {
    return {
      backend: this.webgpu ? 'WebGPU' : 'WebGL2',
      fps: this.engine.getFps(),
      frameMs: this.engine.getDeltaTime(),
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

  clear(): void {
    this.suspendSnapshot();
    for (const mesh of this.worldMeshes) mesh.dispose(false, false);
    this.worldMeshes = [];
    this.retireTemplates(new Set());
    this.placed = [];
    this.simGroups = [];
    this.simCount = 0;
    this.selectedSim = null;
    this.onFrame = null;
    this.ring.position.y = HIDDEN_Y;
    this.cursor.position.y = HIDDEN_Y;
    this.cameraPlaced = false;
  }

  dispose(): void {
    window.removeEventListener('resize', this.onResize);
    this.engine.dispose();
  }

  private readonly renderFrame = () => {
    if (this.idleOrbit) this.camera.alpha += this.engine.getDeltaTime() * 0.00003;
    this.onFrame?.(performance.now());
    this.scene.render();
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
    const cam = (this.camera = new ArcRotateCamera('camera', -Math.PI * 0.62, 0.78, 24, Vector3.Zero(), this.scene));
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
    cam.attachControl(true);
  }

  private setupLights(): void {
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
    // Filmic (ACES) tonemapping: natural highlight roll-off for physically based lighting.
    ip.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES;
    ip.contrast = 1.08;
    ip.vignetteEnabled = true;
    ip.vignetteWeight = 0.9;
    ip.vignetteStretch = 0.5;
    ip.vignetteColor = new Color4(0.02, 0.02, 0.04, 0);

    post.bloomEnabled = q.bloom;
    post.bloomThreshold = 1.0;
    post.bloomWeight = 0.12;
    post.bloomKernel = 48;
    post.bloomScale = 0.5;

    post.depthOfFieldEnabled = q.tiltShift;
    if (q.tiltShift) {
      post.depthOfFieldBlurLevel = DepthOfFieldEffectBlurLevel.Low;
      post.depthOfField.fStop = 2.8;
      post.depthOfField.focalLength = 50;
      post.depthOfField.lensSize = 50;
    }
  }

  private setupHelpers(): void {
    const cursorMat = new StandardMaterial('cursor', this.scene);
    cursorMat.disableLighting = true;
    cursorMat.emissiveColor = ACCENT;
    cursorMat.alpha = 0.35;
    this.cursor = MeshBuilder.CreateGround('cursor', { width: 0.92, height: 0.92 }, this.scene);
    this.cursor.material = cursorMat;
    this.cursor.position.y = HIDDEN_Y;

    const ringMat = new StandardMaterial('selection', this.scene);
    ringMat.disableLighting = true;
    ringMat.emissiveColor = ACCENT;
    this.ring = MeshBuilder.CreateTorus('selection', { diameter: 0.75, thickness: 0.06, tessellation: 40 }, this.scene);
    this.ring.material = ringMat;
    this.ring.position.y = HIDDEN_Y;
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

  /** Neighbouring houses as simple massing blocks with a roof, so the street isn't empty. */
  private buildSilhouettes(world: WorldStructure): void {
    if (!this.view) return;
    const parts: Mesh[] = [];
    for (const plot of world.plots) {
      if (!plot.house || this.inView(plot.x + plot.w / 2, plot.z + plot.d / 2, 0)) continue;
      const [x0, z0, x1, z1] = plot.house;
      const [w, d] = [x1 - x0, z1 - z0];
      const body = MeshBuilder.CreateBox('silhouette', { width: w, depth: d, height: 2.8 }, this.scene);
      body.position.set(x0 + w / 2, 1.4, z0 + d / 2);
      body.bakeCurrentTransformIntoVertices();
      paint(body, SILHOUETTE_WALL);
      // Gable roof: two slabs pitched at 30° meeting along a ridge parallel to x.
      const pitch = Math.PI / 6;
      const run = d / 2 + 0.3;
      const rise = Math.tan(pitch) * (d / 2);
      parts.push(body);
      for (const side of [-1, 1]) {
        const slab = MeshBuilder.CreateBox('silhouette', { width: w + 0.6, height: 0.16, depth: run / Math.cos(pitch) }, this.scene);
        slab.rotation.set(side * pitch, 0, 0);
        slab.position.set(x0 + w / 2, 2.8 + rise / 2, z0 + d / 2 - (side * run) / 2);
        slab.bakeCurrentTransformIntoVertices();
        paint(slab, SILHOUETTE_ROOF);
        parts.push(slab);
      }
    }
    if (!parts.length) return;
    const merged = Mesh.MergeMeshes(parts, true, true);
    if (!merged) return;
    merged.name = 'silhouettes';
    // Untextured: plaster stretched over whole house faces looks wrong; colour comes from vertices.
    merged.material = MaterialLibrary.for(this.scene).finish();
    merged.receiveShadows = true;
    this.worldMeshes.push(merged);
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

  private buildLot(world: WorldStructure): void {
    this.meshFromArrays('floors', world.meshes.floors, this.lotMaterial('material.floor'));
    const wallMat = this.lotMaterial('material.wall');
    this.walls = this.meshFromArrays('walls', world.meshes.walls, wallMat);
    this.wallsLow = this.meshFromArrays('wallsLow', world.meshes.wallsLow, wallMat);
    this.walls?.setEnabled(this.wallMode === 'up');
    this.wallsLow?.setEnabled(this.wallMode === 'down');
  }

  private async buildObjects(world: WorldStructure): Promise<void> {
    const shown = world.objects.filter((o) => this.inView(o.x + o.w / 2, o.z + o.d / 2, 0));
    const byDef = Map.groupBy(shown, (o) => o.def);
    const templates = await Promise.all(
      [...byDef.keys()].map((defId) => {
        const def = this.deps.content.object(defId);
        const key = def?.model ?? `model.${defId}`;
        return this.template(`object:${defId}`, () => buildModel(this.scene, defId, this.deps.assets.get(key, 'model'), def?.footprint ?? [1, 1]));
      }),
    );
    [...byDef.values()].forEach((list, n) => {
      const template = templates[n];
      const matrices = new Float32Array(list.length * 16);
      list.forEach((o, i) => {
        Matrix.RotationYToRef((o.rot * Math.PI) / 2, this.mRot);
        Matrix.TranslationToRef(o.x + o.w / 2, 0, o.z + o.d / 2, this.mPos);
        this.mRot.multiplyToRef(this.mPos, this.mOut);
        this.mOut.copyToArray(matrices, i * 16);
        this.placed.push({ id: o.id, minX: o.x, minZ: o.z, maxX: o.x + o.w, maxZ: o.z + o.d, height: template.height });
      });
      for (const mesh of template.meshes) {
        mesh.thinInstanceSetBuffer('matrix', matrices, 16, true);
        mesh.thinInstanceRefreshBoundingInfo(false);
        mesh.receiveShadows = true;
      }
    });
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
    const { assets } = this.deps;
    this.simHeights = new Float32Array(MAX_SIMS).fill(1);
    for (const s of world.sims) if (s.id < MAX_SIMS) this.simHeights[s.id] = clampHeight(s.appearance?.height);
    // Each Sim is a body plus a hairstyle; both are separate, swappable models.
    const parts = world.sims.flatMap((s) => [
      { key: s.appearance?.model ?? 'model.sim', sim: s },
      { key: `model.hair.${s.appearance?.hairStyle ?? 'short'}`, sim: s },
    ]);
    const byModel = Map.groupBy(parts, (p) => p.key);
    for (const [modelKey, entries] of byModel) {
      const sims = entries.map((e) => e.sim);
      const template: ModelTemplate = await this.template(`sim:${modelKey}`, () =>
        buildModel(this.scene, modelKey, assets.get(modelKey, 'model'), [1, 1]),
      );
      if (template.meshes.length === 0) continue;
      const matrices = new Float32Array(sims.length * 16);
      template.meshes.forEach((mesh, m) => {
        mesh.thinInstanceSetBuffer('matrix', matrices, 16, false);
        const tint = template.tints[m];
        if (tint) {
          const colors = new Float32Array(sims.length * 4);
          sims.forEach((s, i) => {
            const c = Color3.FromHexString(appearanceColor(s.appearance, tint));
            colors.set([c.r, c.g, c.b, 1], i * 4);
          });
          mesh.thinInstanceSetBuffer('color', colors, 4, true);
        }
        // Sims move every frame; skip per-frame bounding/culling work.
        mesh.alwaysSelectAsActiveMesh = true;
        // (template meshes are cached; not disposed with the world)
      });
      this.simGroups.push({ meshes: template.meshes, slots: sims.map((s) => s.id), matrices });
    }
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
    return MaterialLibrary.for(this.scene).surface(key, { doubleSided: true });
  }

  // --- per frame ---------------------------------------------------------------------

  private writeSimMatrix(
    i: number,
    x: number,
    z: number,
    yaw: number,
    pose: number,
    moving: boolean,
    anim: number,
    now: number,
    height: number,
    out: Float32Array,
    offset: number,
  ): void {
    Matrix.ScalingToRef(height, height, height, this.mScale);
    Matrix.RotationYToRef(yaw, this.mRot);
    this.mScale.multiplyToRef(this.mRot, this.mRot);
    if (pose === Pose.Lie) {
      this.lieLocal.multiplyToRef(this.mRot, this.mTmp);
    } else if (pose === Pose.Sit) {
      this.sitLocal.multiplyToRef(this.mRot, this.mTmp);
    } else {
      this.socialLocal(i, anim, moving, now, this.mLocal);
      this.mLocal.multiplyToRef(this.mRot, this.mTmp);
    }
    Matrix.TranslationToRef(x, 0, z, this.mPos);
    this.mTmp.multiplyToRef(this.mPos, this.mOut);
    this.mOut.copyToArray(out, offset);
  }

  /**
   * Procedural body language for conversations: lean, sway, bounce, lunge.
   * Writes a local transform (applied before the Sim's own rotation) into `out`.
   */
  private socialLocal(i: number, anim: number, moving: boolean, now: number, out: Matrix): void {
    const t = now * 0.001 + i * 1.7;
    let lean = 0;
    let sway = 0;
    let lift = moving ? Math.abs(Math.sin(t * 12.5)) * 0.05 : 0;
    let lunge = 0;
    let twist = 0;
    switch (anim) {
      case Anim.Talk:
        sway = Math.sin(t * 3) * 0.035;
        lift = Math.abs(Math.sin(t * 6)) * 0.012;
        break;
      case Anim.Laugh:
        lift = Math.abs(Math.sin(t * 14)) * 0.06;
        lean = -0.08;
        break;
      case Anim.Flirt:
        sway = Math.sin(t * 2) * 0.08;
        lean = 0.06;
        break;
      case Anim.Argue:
        lean = 0.14;
        twist = Math.sin(t * 16) * 0.05;
        break;
      case Anim.Fight:
        lunge = Math.sin(t * 11) * 0.18;
        lean = 0.18;
        twist = Math.sin(t * 23) * 0.12;
        break;
      case Anim.Hug:
        lean = 0.22;
        break;
      case Anim.Kiss:
        lean = 0.3;
        break;
    }
    Matrix.RotationYawPitchRollToRef(twist, lean, sway, this.mA);
    Matrix.TranslationToRef(0, lift, lunge, this.mB);
    this.mA.multiplyToRef(this.mB, out);
  }

  private applyLighting(minute: number): void {
    const l = lightingAt(minute, this.lighting);
    this.sun.direction.copyFrom(l.sunDirection);
    l.sunDirection.scaleToRef(-40, this.vTmp);
    this.sun.position.copyFrom(this.lotCentre).addInPlace(this.vTmp);
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
    MaterialLibrary.for(this.scene).setEnvironmentIntensity(l.envIntensity);
    if (this.post) this.post.imageProcessing.exposure = l.exposure;
  }

  private suspendSnapshot(): void {
    if (this.webgpu) this.webgpu.snapshotRendering = false;
  }

  /** Starts snapshot recording once the scene and its post-process effects have settled. */
  private finishSetup(): void {
    const engine = this.webgpu;
    if (!engine || !this.quality.snapshotRendering) return;
    this.scene.executeWhenReady(() =>
      this.afterFrames(10, () => {
        engine.snapshotRenderingMode = Constants.SNAPSHOTRENDERING_STANDARD;
        engine.snapshotRendering = true;
      }),
    );
  }

  private afterFrames(frames: number, fn: () => void): void {
    let left = frames;
    const observer = this.scene.onAfterRenderObservable.add(() => {
      if (--left > 0) return;
      this.scene.onAfterRenderObservable.remove(observer);
      fn();
    });
  }

  private readonly onResize = () => this.engine.resize();

  /** Image-based lighting from a prefiltered environment (manifest key `environment.sky`). */
  private async setupEnvironment(): Promise<void> {
    const entry = this.deps.assets.get('environment.sky', 'image');
    if (entry) await MaterialLibrary.for(this.scene).loadEnvironment(entry.url);
  }
}

const FALLBACK_TINT = { body: '#8FA89A', skin: '#D9A882', hair: '#5A3B2A' } as const;

function appearanceColor(appearance: Appearance | null | undefined, slot: keyof typeof FALLBACK_TINT): string {
  const value = appearance?.[slot];
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value : FALLBACK_TINT[slot];
}

function clampHeight(h: number | undefined): number {
  return typeof h === 'number' && Number.isFinite(h) ? Math.min(1.15, Math.max(0.85, h)) : 1;
}

const SILHOUETTE_WALL = Color3.FromHexString('#E6E0D6');
const SILHOUETTE_ROOF = Color3.FromHexString('#8C6B58');

function paint(mesh: Mesh, color: Color3): void {
  const colors = new Float32Array(mesh.getTotalVertices() * 4);
  for (let i = 0; i < colors.length; i += 4) colors.set([color.r, color.g, color.b, 1], i);
  mesh.setVerticesData(VertexBuffer.ColorKind, colors);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpAngle(a: number, b: number, t: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
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
