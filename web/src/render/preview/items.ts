/**
 * Catalog pictures of furniture: a small WebGL engine of its own that builds each model with the
 * game's own pipeline (`buildModel`: the same files, finishes and placeholder parts as in play),
 * lights it like a product shot and reads the picture back into a cached image URL.
 *
 * Requests are queued and drawn one model at a time: what's on screen first, in order (cards ask
 * when they scroll into view and withdraw when they leave), then pictures drawn ahead of time in
 * idle moments. Encoding a picture overlaps building the next model. Pictures are kept for the
 * page and, in Cache Storage, between visits (keyed by app version and the model's manifest
 * entry). Turntables (a model seen from `frames` angles around it) feed the detail pane's
 * preview. The engine is released a few seconds after the queue empties.
 */

import {
  Camera,
  Color3,
  Color4,
  DirectionalLight,
  DynamicTexture,
  Engine,
  FreeCamera,
  HemisphericLight,
  ImageProcessingConfiguration,
  Matrix,
  MeshBuilder,
  Scene,
  StandardMaterial,
  TransformNode,
  Vector3,
  type Mesh,
} from '@babylonjs/core';
import type { AssetRegistry } from '../../assets/registry';
import { MaterialLibrary } from '../babylon/materials';
import { buildModel } from '../babylon/models';
import type { ItemPreviews } from '../types';

/** Picture sizes in pixels (cards show ~80 CSS px; the detail's turntable ~200). */
const THUMB_PX = 192;
const TURN_PX = 320;
/** Idle time (ms) before the engine is released. */
const RELEASE_AFTER = 5000;
/** Give up waiting for a model's materials (ms). */
const READY_TIMEOUT = 8000;
const TURNTABLE_CACHE = 24;
/** Three-quarter view from the front, a little to the side and above (radians). */
const YAW = -0.62;
const PITCH = 0.5;
/** Smallest half-height of the view (m), so a pot plant doesn't fill the frame like a bed. */
const MIN_HALF = 0.55;

/** `now`: on screen (drawn first, in request order); `idle`: drawn ahead of time when nothing else waits. */
export type Priority = 'now' | 'idle';

interface Job {
  key: string;
  model: string;
  footprint: [number, number];
  frames: number;
  size: number;
  priority: Priority;
  waiters: ((urls: string[] | null) => void)[];
}

const thumbs = new Map<string, string>();
const turntables = new Map<string, string[]>();
/** Pictures kept between visits (Cache Storage); bump to drop old pictures after a look change. */
const STORE = 'littlelives-item-pictures-v1';

export function createItemPreviews(assets: AssetRegistry): ItemPreviews {
  return new ItemThumbnails(assets);
}

class ItemThumbnails implements ItemPreviews {
  private studio: Promise<ItemStudio | null> | null = null;
  private live: ItemStudio | null = null;
  private unavailable = false;
  private readonly queue: Job[] = [];
  private running = false;
  private releaseTimer = 0;
  private store: Promise<Cache | null> | null = null;

  constructor(private readonly assets: AssetRegistry) {}

  cachedThumbnail(model: string): string | null {
    return thumbs.get(model) ?? null;
  }

  thumbnail(model: string, footprint: [number, number], priority: Priority = 'now', signal?: AbortSignal): Promise<string | null> {
    const hit = thumbs.get(model);
    if (hit) return Promise.resolve(hit);
    return this.stored(model).then((url) => {
      if (url) {
        thumbs.set(model, url);
        return url;
      }
      if (signal?.aborted) return null;
      return this.request(model, model, footprint, 1, THUMB_PX, priority, signal).then((urls) => urls?.[0] ?? null);
    });
  }

  prefetch(models: readonly { model: string; footprint: [number, number] }[]): void {
    for (const m of models) void this.thumbnail(m.model, m.footprint, 'idle');
  }

  turntable(model: string, footprint: [number, number], frames: number): Promise<string[] | null> {
    const key = `${model}|${frames}`;
    const hit = turntables.get(key);
    if (hit) {
      turntables.delete(key);
      turntables.set(key, hit);
      return Promise.resolve(hit);
    }
    return this.request(key, model, footprint, frames, TURN_PX, 'now');
  }

  /** Keeps what was drawn, even if whoever asked has gone meanwhile. */
  private remember(job: Job, urls: string[]): void {
    if (job.frames === 1) {
      if (thumbs.has(job.model)) return;
      thumbs.set(job.model, urls[0]);
      void this.keep(job.model, urls[0]);
      return;
    }
    turntables.set(job.key, urls);
    while (turntables.size > TURNTABLE_CACHE) {
      const [old, oldUrls] = turntables.entries().next().value!;
      turntables.delete(old);
      for (const u of oldUrls) URL.revokeObjectURL(u);
    }
  }

  private request(
    key: string,
    model: string,
    footprint: [number, number],
    frames: number,
    size: number,
    priority: Priority,
    signal?: AbortSignal,
  ): Promise<string[] | null> {
    if (this.unavailable) return Promise.resolve(null);
    return new Promise((resolve) => {
      let job = this.queue.find((j) => j.key === key);
      if (!job) {
        job = { key, model, footprint, frames, size, priority, waiters: [] };
        this.queue.push(job);
      } else if (priority === 'now' && job.priority === 'idle') {
        // Wanted on screen now: ahead of everything drawn ahead of time.
        job.priority = 'now';
        this.queue.splice(this.queue.indexOf(job), 1);
        this.queue.push(job);
      }
      const waiter = (urls: string[] | null) => resolve(urls);
      job.waiters.push(waiter);
      signal?.addEventListener('abort', () => {
        const j = job!;
        j.waiters = j.waiters.filter((w) => w !== waiter);
        resolve(null);
        // Nobody wants it any more (scrolled away, another category): don't draw it.
        const i = this.queue.indexOf(j);
        if (!j.waiters.length && j.priority === 'now' && i >= 0) this.queue.splice(i, 1);
      });
      void this.pump();
    });
  }

  /** The next job: on-screen requests in order, then (when the page is idle) the rest. */
  private next(): Job | undefined {
    const i = this.queue.findIndex((j) => j.priority === 'now');
    return i >= 0 ? this.queue.splice(i, 1)[0] : this.queue.shift();
  }

  private async pump(): Promise<void> {
    if (this.running) return;
    this.running = true;
    clearTimeout(this.releaseTimer);
    try {
      const studio = await this.open();
      while (this.queue.length) {
        // Drawing ahead of time yields to the game: one model per idle moment.
        if (!this.queue.some((j) => j.priority === 'now')) await idle();
        const job = this.next();
        if (!job) continue;
        let encoded: Promise<string[] | null> = Promise.resolve(null);
        if (studio) {
          try {
            // The images are encoded while the next model is built.
            encoded = (await studio.draw(job.model, this.assets, job.footprint, job.frames, job.size))?.encoded ?? encoded;
          } catch (err) {
            console.warn(`[preview] thumbnail of ${job.model} failed`, err);
          }
        }
        void encoded.then(
          (urls) => {
            if (urls) this.remember(job, urls);
            for (const w of job.waiters) w(urls);
          },
          () => job.waiters.forEach((w) => w(null)),
        );
      }
    } finally {
      this.running = false;
      this.idleCheck();
    }
  }

  // ---- pictures kept between visits ----------------------------------------------------

  private cache(): Promise<Cache | null> {
    this.store ??= (typeof caches === 'undefined' ? Promise.resolve(null) : caches.open(STORE)).catch(() => null);
    return this.store;
  }

  /** Cache key: changes with the app version and the model's manifest entry (its file, fit, finishes). */
  private storeKey(model: string): string {
    const entry = this.assets.has(model, 'model') ? JSON.stringify(this.assets.get(model, 'model')) : '';
    return `${location.origin}/__item-pictures/${__APP_VERSION__}/${THUMB_PX}/${hash(model + entry)}.webp`;
  }

  private async stored(model: string): Promise<string | null> {
    try {
      const res = await (await this.cache())?.match(this.storeKey(model));
      return res ? URL.createObjectURL(await res.blob()) : null;
    } catch {
      return null;
    }
  }

  private async keep(model: string, url: string): Promise<void> {
    try {
      const store = await this.cache();
      if (!store) return;
      const blob = await (await fetch(url)).blob();
      await store.put(this.storeKey(model), new Response(blob, { headers: { 'Content-Type': 'image/webp' } }));
    } catch {
      // Storage full or unavailable: pictures are drawn again next time.
    }
  }

  private open(): Promise<ItemStudio | null> {
    this.studio ??= ItemStudio.create(this.assets).then(
      (studio) => (this.live = studio),
      (err: unknown) => {
        console.warn('[preview] 3D item pictures unavailable', err);
        this.unavailable = true;
        this.studio = null;
        return null;
      },
    );
    return this.studio;
  }

  private idleCheck(): void {
    clearTimeout(this.releaseTimer);
    this.releaseTimer = window.setTimeout(() => {
      const studio = this.live;
      if (!studio || this.running || this.queue.length) return;
      this.live = null;
      this.studio = null;
      studio.dispose();
    }, RELEASE_AFTER);
  }
}

/** Resolves when the browser has a quiet moment (or after a short while regardless). */
function idle(): Promise<void> {
  return new Promise((resolve) => {
    if ('requestIdleCallback' in window) requestIdleCallback(() => resolve(), { timeout: 400 });
    else setTimeout(resolve, 30);
  });
}

/** FNV-1a, as hex. */
function hash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(16);
}

class ItemStudio {
  private readonly root: TransformNode;
  private readonly camera: FreeCamera;
  private readonly shadow: Mesh;

  private constructor(
    private readonly engine: Engine,
    private readonly scene: Scene,
    private readonly canvas: HTMLCanvasElement,
  ) {
    this.root = new TransformNode('itemRoot', scene);
    const cam = (this.camera = new FreeCamera('itemCamera', new Vector3(0, 2, 5), scene, false));
    cam.mode = Camera.ORTHOGRAPHIC_CAMERA;
    cam.minZ = 0.05;
    cam.maxZ = 40;
    cam.inputs.clear();
    scene.activeCamera = cam;
    this.shadow = contactShadow(scene);
  }

  static async create(assets: AssetRegistry): Promise<ItemStudio> {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = TURN_PX;
    const engine = new Engine(canvas, true, { preserveDrawingBuffer: true, premultipliedAlpha: true, alpha: true, stencil: false, adaptToDeviceRatio: false });
    try {
      const scene = new Scene(engine);
      scene.clearColor = new Color4(0, 0, 0, 0);
      scene.skipPointerMovePicking = true;
      const ip = scene.imageProcessingConfiguration;
      ip.toneMappingEnabled = true;
      ip.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES;
      ip.exposure = 1.2;
      ip.contrast = 1.1;
      const lib = MaterialLibrary.for(scene).setAssets(assets);
      const env = assets.get('environment.sky', 'image');
      if (env) await lib.loadEnvironment(env.url);
      lib.setEnvironmentIntensity(0.75);
      lights(scene);
      return new ItemStudio(engine, scene, canvas);
    } catch (err) {
      engine.dispose();
      throw err;
    }
  }

  /**
   * Builds `model` and draws it from `frames` angles around it. Resolves once drawn; `encoded`
   * (the image URLs, one per angle) settles later, so the next model can be built meanwhile.
   */
  async draw(model: string, assets: AssetRegistry, footprint: [number, number], frames: number, size: number): Promise<{ encoded: Promise<string[]> } | null> {
    const entry = assets.has(model, 'model') ? assets.get(model, 'model') : undefined;
    const template = await buildModel(this.scene, `thumb:${model}`, entry, footprint);
    const meshes = template.meshes;
    try {
      const identity = Matrix.Identity().asArray() as unknown as Float32Array;
      for (const mesh of meshes) {
        mesh.parent = this.root;
        mesh.isPickable = false;
        mesh.thinInstanceSetBuffer('matrix', identity, 16, true);
        mesh.alwaysSelectAsActiveMesh = true;
      }
      this.root.rotation.y = 0;
      const corners = boxCorners(meshes);
      if (!corners.length || !(await this.whenReady(meshes))) return null;

      // The contact shadow follows the footprint (it turns with the model).
      const [fw, fd] = footprint;
      this.shadow.scaling.set(fw * 1.25 + 0.2, 1, fd * 1.25 + 0.2);

      const angles = Array.from({ length: frames }, (_, i) => (i * Math.PI * 2) / frames);
      this.frame(corners, angles);
      this.engine.setSize(size, size);
      const urls: Promise<string>[] = [];
      for (const angle of angles) {
        this.root.rotation.y = angle;
        this.shadow.rotation.y = angle;
        this.scene.render();
        urls.push(this.capture(size));
      }
      return { encoded: Promise.all(urls) };
    } finally {
      for (const mesh of meshes) mesh.dispose(false, false);
    }
  }

  dispose(): void {
    this.scene.dispose();
    this.engine.dispose();
  }

  /** Points the camera so the model fills the picture at every angle drawn. */
  private frame(corners: Vector3[], angles: number[]): void {
    const dir = new Vector3(Math.sin(YAW) * Math.cos(PITCH), Math.sin(PITCH), Math.cos(YAW) * Math.cos(PITCH));
    const forward = dir.scale(-1);
    const right = Vector3.Cross(Vector3.Up(), forward).normalize();
    const up = Vector3.Cross(forward, right).normalize();
    let minR = Infinity;
    let maxR = -Infinity;
    let minU = Infinity;
    let maxU = -Infinity;
    const p = new Vector3();
    for (const a of angles) {
      const c = Math.cos(a);
      const s = Math.sin(a);
      for (const v of corners) {
        // Babylon's rotation.y turns +x towards -z.
        p.set(v.x * c + v.z * s, v.y, -v.x * s + v.z * c);
        const r = Vector3.Dot(p, right);
        const u = Vector3.Dot(p, up);
        minR = Math.min(minR, r);
        maxR = Math.max(maxR, r);
        minU = Math.min(minU, u);
        maxU = Math.max(maxU, u);
      }
    }
    const half = Math.max(MIN_HALF, ((maxR - minR) / 2) * 1.14, ((maxU - minU) / 2) * 1.14);
    const centre = right.scale((minR + maxR) / 2).add(up.scale((minU + maxU) / 2));
    const cam = this.camera;
    cam.position.copyFrom(centre.add(dir.scale(12)));
    cam.setTarget(centre);
    cam.orthoLeft = -half;
    cam.orthoRight = half;
    cam.orthoBottom = -half;
    cam.orthoTop = half;
  }

  /** Waits until every mesh can be drawn (shaders compiled, textures loaded). */
  private async whenReady(meshes: Mesh[]): Promise<boolean> {
    const started = performance.now();
    while (performance.now() - started < READY_TIMEOUT) {
      if (meshes.every((m) => m.isReady(true)) && this.shadow.isReady(true)) return true;
      await new Promise((r) => setTimeout(r, 16));
    }
    return false;
  }

  /** Copies the frame just drawn (synchronously) and encodes it in the background. */
  private async capture(size: number): Promise<string> {
    const out = document.createElement('canvas');
    out.width = out.height = size;
    out.getContext('2d')!.drawImage(this.canvas, 0, 0, size, size, 0, 0, size, size);
    const blob = await new Promise<Blob>((resolve, reject) => out.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/webp', 0.9));
    return URL.createObjectURL(blob);
  }
}

/** The 8 corners of the meshes' combined bounding box (model space). */
function boxCorners(meshes: Mesh[]): Vector3[] {
  const min = new Vector3(Infinity, Infinity, Infinity);
  const max = new Vector3(-Infinity, -Infinity, -Infinity);
  for (const mesh of meshes) {
    if (!mesh.getTotalVertices()) continue;
    mesh.computeWorldMatrix(true);
    const box = mesh.getBoundingInfo().boundingBox;
    min.minimizeInPlace(box.minimumWorld);
    max.maximizeInPlace(box.maximumWorld);
  }
  if (!Number.isFinite(min.x)) return [];
  const out: Vector3[] = [];
  for (const x of [min.x, max.x]) for (const y of [min.y, max.y]) for (const z of [min.z, max.z]) out.push(new Vector3(x, y, z));
  return out;
}

/** A soft round shade under the model, so it stands on something. */
function contactShadow(scene: Scene): Mesh {
  const n = 128;
  const tex = new DynamicTexture('itemShadow', n, scene, true);
  const ctx = tex.getContext() as CanvasRenderingContext2D;
  const g = ctx.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2);
  g.addColorStop(0, 'rgba(0,0,0,0.42)');
  g.addColorStop(0.55, 'rgba(0,0,0,0.2)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, n, n);
  tex.update();
  tex.hasAlpha = true;
  const mat = new StandardMaterial('itemShadow', scene);
  mat.disableLighting = true;
  mat.diffuseColor = Color3.Black();
  mat.specularColor = Color3.Black();
  mat.emissiveColor = Color3.Black();
  mat.opacityTexture = tex;
  mat.disableDepthWrite = true;
  const mesh = MeshBuilder.CreateGround('itemShadow', { width: 1, height: 1 }, scene);
  mesh.material = mat;
  mesh.position.y = 0.004;
  mesh.isPickable = false;
  return mesh;
}

/** Product-shot lighting: a warm key from the upper front, a cool fill, a rim and the sky. */
function lights(scene: Scene): void {
  const key = new DirectionalLight('itemKey', new Vector3(0.45, -0.75, -0.5), scene);
  key.intensity = 2.6;
  key.diffuse = new Color3(1, 0.96, 0.9);
  const fill = new DirectionalLight('itemFill', new Vector3(-0.8, -0.3, -0.4), scene);
  fill.intensity = 0.9;
  fill.diffuse = new Color3(0.86, 0.91, 1);
  fill.specular = new Color3(0.1, 0.1, 0.12);
  const rim = new DirectionalLight('itemRim', new Vector3(-0.2, -0.4, 0.9), scene);
  rim.intensity = 1.6;
  const sky = new HemisphericLight('itemSky', new Vector3(0, 1, 0), scene);
  sky.intensity = 0.45;
  sky.groundColor = new Color3(0.5, 0.46, 0.42);
  sky.specular = Color3.Black();
}
