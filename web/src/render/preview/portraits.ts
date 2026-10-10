/**
 * Head-and-shoulders portraits from the studio, cached by look.
 *
 * Requests are collected and drawn in batches: up to `BATCH` Sims stand in a row far off to the
 * side of the stage (rows 1..), held still with a friendly face and eye contact. Once their
 * materials are ready, a few portraits are drawn per frame into render targets, read back after
 * the frame, un-premultiplied and encoded (WebP, PNG where unsupported) into object URLs. The
 * cache outlives the engine, so the game asks for each look once per page.
 */

import { Color4, FreeCamera, RenderTargetTexture, Vector3 } from '../babylon/core';
import type { StageDirection } from '../babylon/characters';
import type { SimLook } from '../types';
import type { Studio } from './studio';

/** Portrait size in pixels (displayed at up to ~64 CSS px, so 2-3x for sharp HiDPI avatars). */
export const PORTRAIT_PX = 160;
const BATCH = 16;
const PER_FRAME = 6;
const FIRST_ROW = 1;
const ROW_X = 40;
const ROW_SPACING = 3;
/** Frames posed before drawing (heads settle; the camera and eye contact use them). */
const SETTLE_FRAMES = 3;
/** Give up on a batch whose materials never become ready (ms). */
const READY_TIMEOUT = 20_000;
const CACHE_MAX = 400;
const FOV = 0.3;
/** Render-target rows come back bottom-up (both backends). */
const FLIP_Y = true;
/** Camera a little to the side (towards the key light) and above the eyes. */
const ANGLE = 0.28;
/**
 * Framing for a Sim whose head top is at `REF_TOP` (m): half the height in view and how far below
 * the crown its centre is. Both scale with the Sim, so height doesn't change the picture.
 */
const FRAME_HALF = 0.25;
const FRAME_DROP = 0.2;
const REF_TOP = 1.78;

/** A friendly portrait face. */
const PORTRAIT_FACE = { smile: 0.6, wide: 0.3, lidL: 0.35, browUp: 0.15 };

interface Job {
  key: string;
  look: SimLook;
  waiters: ((url: string | null) => void)[];
  /** Draws that came back empty (a shader still compiling for the render target). */
  misses: number;
}
/** Retries for a portrait that came back empty. */
const MAX_MISSES = 3;

interface Batch {
  jobs: Job[];
  started: number;
  frames: number;
  next: number;
  pending: number;
  cams: { x: number; y: number; z: number }[];
}

/** Cache key: everything that changes the picture (not the height: framing follows the head). */
export function lookKey(look: SimLook): string {
  const a = look.appearance as unknown as Record<string, unknown>;
  const sorted = Object.keys(a)
    .filter((k) => k !== 'height')
    .sort()
    .map((k) => [k, a[k]]);
  // Without garments the outfit comes from the Sim's id (older saves).
  const legacy = !a.top;
  return JSON.stringify([look.gender, sorted, legacy ? (look.id ?? 0) : null]);
}

/** Portrait URLs by look key, least recently used first (survives engine restarts). */
const cache = new Map<string, string>();

export function cached(key: string): string | null {
  const url = cache.get(key);
  if (url === undefined) return null;
  cache.delete(key);
  cache.set(key, url);
  return url;
}

function remember(key: string, url: string): void {
  cache.set(key, url);
  while (cache.size > CACHE_MAX) {
    const [old, oldUrl] = cache.entries().next().value!;
    cache.delete(old);
    URL.revokeObjectURL(oldUrl);
  }
}

export class Portraits {
  private readonly queue = new Map<string, Job>();
  private batch: Batch | null = null;
  private targets: RenderTargetTexture[] = [];
  private camera: FreeCamera | null = null;
  private readonly target = new Vector3();

  request(key: string, look: SimLook): Promise<string | null> {
    return new Promise((resolve) => {
      const inBatch = this.batch?.jobs.find((j) => j.key === key);
      const job = inBatch ?? this.queue.get(key);
      if (job) job.waiters.push(resolve);
      else this.queue.set(key, { key, look: { gender: look.gender, appearance: JSON.parse(JSON.stringify(look.appearance)), id: look.id }, waiters: [resolve], misses: 0 });
    });
  }

  get busy(): boolean {
    return this.queue.size > 0 || this.batch !== null;
  }

  /** Fails every request (the studio is unavailable). */
  failAll(): void {
    for (const job of [...this.queue.values(), ...(this.batch?.jobs ?? [])]) for (const w of job.waiters) w(null);
    this.queue.clear();
    this.batch = null;
  }

  /** Before posing: starts the next batch, and points the portrait Sims' eyes at their cameras. */
  direct(studio: Studio, now: number): void {
    if (!this.batch && this.queue.size) this.startBatch(studio, now);
    const b = this.batch;
    if (!b) return;
    const heads = studio.characters.heads;
    b.jobs.forEach((_, j) => {
      const row = FIRST_ROW + j;
      const cam = b.cams[j];
      const top = studio.characters.visible[row] ? heads[row * 3 + 1] : 1.75;
      const x = ROW_X + j * ROW_SPACING;
      // Frame: from the collarbones to just above the crown.
      const k = top / REF_TOP;
      const ty = top - FRAME_DROP * k;
      const dist = (FRAME_HALF * k) / Math.tan(FOV / 2);
      cam.x = x + Math.sin(ANGLE) * dist;
      cam.y = ty + 0.06;
      cam.z = Math.cos(ANGLE) * dist;
    });
  }

  /** After posing: draws ready portraits into render targets (read back after the frame). */
  render(studio: Studio, now: number): void {
    const b = this.batch;
    if (!b || b.pending > 0 || b.next >= b.jobs.length) return;
    if (!studio.ready()) {
      if (now - b.started > READY_TIMEOUT) this.finish(studio, true);
      return;
    }
    if (++b.frames < SETTLE_FRAMES) return;
    const scene = studio.scene;
    const engine = studio.engine;
    const cam = this.ensureCamera(studio);
    const prevCam = scene.activeCamera;
    const drawn: { job: Job; rtt: RenderTargetTexture }[] = [];
    while (b.next < b.jobs.length && drawn.length < PER_FRAME) {
      const j = b.next++;
      const c = b.cams[j];
      const rtt = this.renderTarget(studio, drawn.length);
      const top = studio.characters.heads[(FIRST_ROW + j) * 3 + 1];
      cam.position.set(c.x, c.y, c.z);
      this.target.set(ROW_X + j * ROW_SPACING, top - FRAME_DROP * (top / REF_TOP), 0);
      cam.setTarget(this.target);
      cam.outputRenderTarget = rtt;
      scene.activeCamera = cam;
      try {
        scene.render();
      } finally {
        cam.outputRenderTarget = null;
        scene.activeCamera = prevCam;
      }
      drawn.push({ job: b.jobs[j], rtt });
    }
    b.pending = drawn.length;
    const flipY = FLIP_Y;
    engine.onEndFrameObservable.addOnce(() => {
      for (const { job, rtt } of drawn) {
        void (async () => {
          let url: string | null = null;
          let empty = false;
          try {
            const pixels = (await rtt.readPixels(0, 0, null, true, false)) as Uint8Array | null;
            if (pixels && coverage(pixels) > 0.02) url = await encode(pixels, PORTRAIT_PX, PORTRAIT_PX, flipY);
            else empty = true;
          } catch (err) {
            console.warn('[preview] portrait failed', err);
          }
          if (empty && ++job.misses < MAX_MISSES && !this.queue.has(job.key)) {
            // Drawn before its shader variant for render targets was ready: draw it again.
            this.queue.set(job.key, job);
          } else {
            if (url) remember(job.key, url);
            for (const w of job.waiters) w(url);
            job.waiters = [];
          }
          if (this.batch === b && --b.pending === 0 && b.next >= b.jobs.length) this.finish(studio, false);
        })();
      }
    });
  }

  dispose(): void {
    for (const t of this.targets) t.dispose();
    this.targets = [];
    this.camera?.dispose();
    this.camera = null;
    this.failAll();
  }

  private startBatch(studio: Studio, now: number): void {
    const jobs = [...this.queue.values()].slice(0, BATCH);
    for (const job of jobs) this.queue.delete(job.key);
    const cams = jobs.map(() => ({ x: 0, y: 0, z: 0 }));
    this.batch = { jobs, started: now, frames: 0, next: 0, pending: 0, cams };
    jobs.forEach((job, j) => {
      const row = FIRST_ROW + j;
      studio.setRow(row, { look: job.look, x: ROW_X + j * ROW_SPACING, z: 0, yaw: 0 });
      const dir: StageDirection = { still: true, time: 0.6, face: PORTRAIT_FACE, lookAt: cams[j], hands: 0.6 };
      studio.characters.directions[row] = dir;
    });
  }

  /** Ends the batch and empties its rows; on failure, unanswered requests get null. */
  private finish(studio: Studio, failed: boolean): void {
    const b = this.batch;
    if (!b) return;
    if (failed) for (const job of b.jobs) for (const w of job.waiters.splice(0)) w(null);
    b.jobs.forEach((_, j) => {
      studio.characters.directions[FIRST_ROW + j] = null;
      studio.setRow(FIRST_ROW + j, null);
    });
    this.batch = null;
  }

  private ensureCamera(studio: Studio): FreeCamera {
    if (!this.camera) {
      const cam = new FreeCamera('portraitCamera', new Vector3(0, 1.6, 2), studio.scene, false);
      cam.fov = FOV;
      cam.minZ = 0.2;
      cam.maxZ = 4;
      cam.inputs.clear();
      this.camera = cam;
    }
    return this.camera;
  }

  private renderTarget(studio: Studio, i: number): RenderTargetTexture {
    let rtt = this.targets[i];
    if (!rtt) {
      rtt = new RenderTargetTexture(`portrait${i}`, { width: PORTRAIT_PX, height: PORTRAIT_PX }, studio.scene, {
        generateMipMaps: false,
        samples: 4,
        doNotChangeAspectRatio: true,
      });
      rtt.clearColor = new Color4(0, 0, 0, 0);
      this.targets[i] = rtt;
    }
    return rtt;
  }
}

/** Fraction of opaque pixels. */
function coverage(data: Uint8Array): number {
  let n = 0;
  for (let k = 3; k < data.length; k += 16) if (data[k] > 128) n++;
  return (n * 4) / (data.length / 4);
}

/** RGBA (premultiplied by the MSAA resolve over a transparent clear) to an image URL. */
async function encode(data: Uint8Array, w: number, h: number, flipY: boolean): Promise<string> {
  const img = new ImageData(w, h);
  const out = img.data;
  for (let y = 0; y < h; y++) {
    const src = (flipY ? h - 1 - y : y) * w * 4;
    const dst = y * w * 4;
    for (let x = 0; x < w * 4; x += 4) {
      const a = data[src + x + 3];
      if (a === 0) continue;
      const k = a === 255 ? 1 : 255 / a;
      out[dst + x] = Math.min(255, data[src + x] * k);
      out[dst + x + 1] = Math.min(255, data[src + x + 1] * k);
      out[dst + x + 2] = Math.min(255, data[src + x + 2] * k);
      out[dst + x + 3] = a;
    }
  }
  let blob: Blob;
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(w, h);
    canvas.getContext('2d')!.putImageData(img, 0, 0);
    blob = await canvas.convertToBlob({ type: 'image/webp', quality: 0.92 });
  } else {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d')!.putImageData(img, 0, 0);
    blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/webp', 0.92));
  }
  return URL.createObjectURL(blob);
}
