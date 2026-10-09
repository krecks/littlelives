/**
 * The preview studio: one small Babylon engine and scene running the game's own character
 * pipeline (`Characters`: the same meshes, materials, clips and face rig as in play) under soft
 * studio lights, on a transparent canvas.
 *
 * Sims are driven like in the game, by a snapshot: a synthetic one in which every Sim stands
 * idle, plus stage directions (gestures, expressions, eye contact). Row 0 is the household
 * creator's stage; rows 1.. hold a batch of portraits, standing far off to the side.
 */

import {
  Color3,
  Color4,
  DirectionalLight,
  DynamicTexture,
  Engine,
  HemisphericLight,
  ImageProcessingConfiguration,
  MeshBuilder,
  Scene,
  StandardMaterial,
  TransformNode,
  Vector3,
  WebGPUEngine,
  type AbstractEngine,
  type Mesh,
} from '../babylon/core';
import type { AssetRegistry } from '../../assets/registry';
import type { FrameState } from '../../core/bridge';
import type { SimInfo } from '../../core/protocol';
import type { SnapshotLayout } from '../../core/snapshot';
import { Characters, MAX_CHARACTERS } from '../babylon/characters';
import { MaterialLibrary } from '../babylon/materials';
import type { SimLook } from '../types';

export interface StudioDeps {
  assets: AssetRegistry;
  /** Emotion ids in content order (snapshot emotion codes). */
  emotions: readonly string[];
  /** `webgl` forces WebGL2 (as the game's renderer setting does). */
  backend: () => 'auto' | 'webgl';
}

/** A Sim in the studio. `yaw` 0 faces the camera (+z). */
export interface Row {
  look: SimLook;
  x: number;
  z: number;
  yaw: number;
  /** Emotion code (content emotion index + 1; 0 = none) and mood 0..1, as the game sends them. */
  emotion?: number;
  mood?: number;
}

const FIELDS = ['id', 'x', 'z', 'yaw', 'pose', 'moving', 'social', 'outcome', 'partner', 'anim', 'emotion', 'role', 'away', 'object', 'action', 'mood'] as const;
const HEADER_LEN = 6;
const STRIDE = FIELDS.length;
const LAYOUT: SnapshotLayout = {
  capacity: HEADER_LEN + STRIDE * MAX_CHARACTERS,
  headerLen: HEADER_LEN,
  simStride: STRIDE,
  maxSims: MAX_CHARACTERS,
  ticksPerSecond: 20,
  header: { tick: 0, day: 1, minute: 2, speed: 3, simCount: 4, structureVersion: 5 },
  sim: Object.fromEntries(FIELDS.map((f, i) => [f, i])) as unknown as SnapshotLayout['sim'],
  actions: [],
};

export class Studio {
  readonly rows: (Row | null)[] = [];
  /** The floor under the stage Sim: a pool of light and a soft shade (shown with the stage). */
  readonly pool: TransformNode;
  private readonly snap = new Float32Array(LAYOUT.capacity);
  private readonly frame: FrameState;
  private readonly shadows = new Float32Array(MAX_CHARACTERS * 16);
  private readonly blob: Mesh;
  private builtKey = '';
  private building = false;
  private disposed = false;

  private constructor(
    readonly engine: AbstractEngine,
    readonly scene: Scene,
    readonly characters: Characters,
    readonly canvas: HTMLCanvasElement,
    readonly webgpu: boolean,
  ) {
    this.frame = { prev: this.snap, curr: this.snap, alpha: 0, layout: LAYOUT, now: 0 };
    const [blob, pool] = this.makeShadows();
    this.blob = blob;
    this.pool = pool;
  }

  /** Creates the engine, scene and lights and loads the characters; throws when unavailable. */
  static async create(deps: StudioDeps): Promise<Studio> {
    const canvas = document.createElement('canvas');
    canvas.className = 'sim-studio';
    let engine: AbstractEngine;
    let webgpu = false;
    const forceWebGL = deps.backend() === 'webgl' || new URLSearchParams(location.search).get('renderer') === 'webgl';
    if (!forceWebGL && (await WebGPUEngine.IsSupportedAsync)) {
      const gpu = new WebGPUEngine(canvas, { antialias: true, adaptToDeviceRatio: true, premultipliedAlpha: true });
      await gpu.initAsync();
      engine = gpu;
      webgpu = true;
    } else {
      engine = new Engine(canvas, true, { adaptToDeviceRatio: true, premultipliedAlpha: true, alpha: true, stencil: false });
    }
    engine.setHardwareScalingLevel(1 / Math.min(2, window.devicePixelRatio || 1));
    try {
      const scene = new Scene(engine);
      scene.clearColor = new Color4(0, 0, 0, 0);
      scene.skipPointerMovePicking = true;
      scene.constantlyUpdateMeshUnderPointer = false;
      const ip = scene.imageProcessingConfiguration;
      ip.toneMappingEnabled = true;
      ip.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES;
      ip.exposure = 1.15;
      ip.contrast = 1.08;
      const lib = MaterialLibrary.for(scene).setAssets(deps.assets);
      const env = deps.assets.get('environment.sky', 'image');
      if (env) await lib.loadEnvironment(env.url);
      lib.setEnvironmentIntensity(0.7);
      lights(scene);
      const characters = new Characters(scene, deps.assets, lib);
      if (!(await characters.init())) throw new Error('characters unavailable');
      characters.setEmotions(deps.emotions);
      return new Studio(engine, scene, characters, canvas, webgpu);
    } catch (err) {
      engine.dispose();
      throw err;
    }
  }

  /** Puts a Sim into row `i` (null empties it). New looks are rebuilt before the next pose. */
  setRow(i: number, row: Row | null): void {
    if (row) this.rows[i] = row;
    else if (i < this.rows.length) this.rows[i] = null;
    while (this.rows.length && !this.rows[this.rows.length - 1]) this.rows.length--;
    this.sync();
  }

  /** Whether every row's current look is built (meshes exist; materials may still compile). */
  get synced(): boolean {
    return !this.building && this.builtKey === this.structureKey();
  }

  /** Whether every character mesh in use can be drawn (shaders compiled, textures loaded). */
  ready(): boolean {
    if (!this.synced) return false;
    for (const m of this.scene.meshes) if (m.name.startsWith('sim:') && m.isEnabled() && !m.isReady(true)) return false;
    return true;
  }

  /** Poses every Sim for this frame (same code path as the game). */
  pose(now: number): void {
    const s = this.snap;
    const h = LAYOUT.header;
    const k = LAYOUT.sim;
    s[h.speed] = 1;
    s[h.simCount] = this.rows.length;
    for (let i = 0; i < this.rows.length; i++) {
      const row = this.rows[i];
      const o = HEADER_LEN + i * STRIDE;
      s[o + k.id] = i;
      s[o + k.x] = row ? row.x : 0;
      s[o + k.z] = row ? row.z : 0;
      s[o + k.yaw] = row ? row.yaw : 0;
      s[o + k.pose] = 0;
      s[o + k.moving] = 0;
      s[o + k.social] = 0;
      s[o + k.outcome] = 0;
      s[o + k.partner] = -1;
      s[o + k.anim] = 0;
      s[o + k.emotion] = row?.emotion ?? 0;
      s[o + k.role] = 0;
      s[o + k.away] = row ? 0 : 1;
      s[o + k.object] = -1;
      s[o + k.action] = -1;
      s[o + k.mood!] = row?.mood ?? 0.8;
    }
    this.frame.now = now;
    this.characters.update(this.frame, always, this.shadows);
    this.blob.thinInstanceBufferUpdated('matrix');
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.engine.stopRenderLoop();
    this.scene.dispose();
    this.engine.dispose();
    this.canvas.remove();
  }

  private structureKey(): string {
    return JSON.stringify(this.rows.map((r) => (r ? [r.look.gender, r.look.appearance, r.look.id ?? null] : null)));
  }

  private sync(): void {
    const key = this.structureKey();
    if (this.building || key === this.builtKey || this.disposed) return;
    this.building = true;
    const sims = this.rows.flatMap((r, i) => (r ? [simInfo(i, r.look)] : []));
    void this.characters
      .build({ sims, objects: [] }, true)
      .catch((err: unknown) => console.warn('[preview] build failed', err))
      .finally(() => {
        this.builtKey = key;
        this.building = false;
        // Rows may have changed meanwhile.
        this.sync();
      });
  }

  /**
   * Contact shadows (the game's soft blob, per Sim) and, for the stage, a round frosted platform
   * with a soft shade falling away from the key light, so the Sim stands on something over
   * whatever the menus show behind the canvas.
   */
  private makeShadows(): [Mesh, TransformNode] {
    const scene = this.scene;
    const decal = (name: string, size: number, draw: (ctx: CanvasRenderingContext2D, n: number) => void, color: Color3, order: number) => {
      const n = 256;
      const tex = new DynamicTexture(name, n, scene, true);
      const ctx = tex.getContext() as CanvasRenderingContext2D;
      ctx.clearRect(0, 0, n, n);
      draw(ctx, n);
      tex.update();
      tex.hasAlpha = true;
      const mat = new StandardMaterial(name, scene);
      mat.disableLighting = true;
      mat.diffuseColor = Color3.Black();
      mat.specularColor = Color3.Black();
      mat.emissiveColor = color;
      mat.opacityTexture = tex;
      mat.disableDepthWrite = true;
      const mesh = MeshBuilder.CreateGround(name, { width: size, height: size }, scene);
      mesh.material = mat;
      mesh.isPickable = false;
      mesh.alphaIndex = order;
      return mesh;
    };
    const radial = (stops: [number, number][]) => (ctx: CanvasRenderingContext2D, n: number) => {
      const g = ctx.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2);
      for (const [at, a] of stops) g.addColorStop(at, `rgba(0,0,0,${a})`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, n, n);
    };
    const blob = decal(
      'studioBlob',
      1,
      radial([
        [0, 0.6],
        [0.5, 0.32],
        [1, 0],
      ]),
      Color3.Black(),
      3,
    );
    blob.thinInstanceSetBuffer('matrix', this.shadows, 16, false);
    blob.alwaysSelectAsActiveMesh = true;

    const floor = new TransformNode('studioFloor', scene);
    // The platform: a frosted disc, brighter towards its rim, with a thin highlight edge.
    const disc = decal(
      'studioDisc',
      1.5,
      (ctx, n) => {
        const r = n / 2 - 3;
        const g = ctx.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, r);
        g.addColorStop(0, 'rgba(0,0,0,0.42)');
        g.addColorStop(0.82, 'rgba(0,0,0,0.5)');
        g.addColorStop(1, 'rgba(0,0,0,0.62)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(n / 2, n / 2, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(0,0,0,0.95)';
        ctx.stroke();
      },
      new Color3(0.97, 0.96, 0.94),
      0,
    );
    disc.parent = floor;
    disc.position.y = 0.002;
    // The Sim's shade on the platform, falling away from the key light (behind, to the right).
    const shade = decal(
      'studioShade',
      1,
      radial([
        [0, 0.24],
        [0.5, 0.12],
        [1, 0],
      ]),
      Color3.Black(),
      1,
    );
    shade.parent = floor;
    shade.scaling.set(0.95, 1, 1.5);
    shade.rotation.y = -0.65;
    shade.position.set(-0.22, 0.004, -0.3);
    floor.setEnabled(false);
    return [blob, floor];
  }
}

const always = () => true;

function simInfo(id: number, look: SimLook): SimInfo & { outfitId: number } {
  return {
    id,
    name: '',
    household: 0,
    gender: look.gender,
    attractedTo: [],
    appearance: look.appearance,
    traits: [],
    perks: [],
    outfitId: look.id ?? 0,
  };
}

/**
 * Soft studio lighting, fixed in the world (the stage turns the Sim, not the camera, so portraits
 * and the stage share it): a warm key from the upper left of the view, a cool fill from the right,
 * two rims from behind, and the game's sky environment for ambient and reflections.
 * (The camera looks down -z, so the view's left is +x.)
 */
function lights(scene: Scene): void {
  const key = new DirectionalLight('studioKey', new Vector3(-0.5, -0.58, -0.64), scene);
  key.intensity = 2.9;
  key.diffuse = new Color3(1, 0.95, 0.88);
  key.specular = new Color3(1, 0.96, 0.9);
  const fill = new DirectionalLight('studioFill', new Vector3(0.78, -0.2, -0.6), scene);
  fill.intensity = 0.95;
  fill.diffuse = new Color3(0.84, 0.9, 1);
  fill.specular = new Color3(0.15, 0.15, 0.18);
  const rim = new DirectionalLight('studioRim', new Vector3(0.45, -0.4, 0.8), scene);
  rim.intensity = 2.8;
  rim.diffuse = new Color3(1, 0.96, 0.92);
  const rim2 = new DirectionalLight('studioRim2', new Vector3(-0.6, -0.3, 0.75), scene);
  rim2.intensity = 1.5;
  rim2.diffuse = new Color3(0.86, 0.92, 1);
  const sky = new HemisphericLight('studioSky', new Vector3(0, 1, 0), scene);
  sky.intensity = 0.35;
  sky.diffuse = new Color3(0.95, 0.97, 1);
  sky.groundColor = new Color3(0.45, 0.4, 0.38);
  sky.specular = Color3.Black();
}
