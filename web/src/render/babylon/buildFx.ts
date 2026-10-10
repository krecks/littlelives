/**
 * Buy-mode feedback in the world: a ring that spreads over the footprint, sparkles for new and
 * upgraded furniture, dust for walls going up or coming down and a puff for things sold; and
 * the "pop" that springs newly placed furniture into place (its instance matrix is scaled for a
 * moment, see `PopTarget`). Everything is pooled and costs nothing when idle.
 */

import { Color3, Color4, DynamicTexture, Matrix, MeshBuilder, StandardMaterial, Vector3, type Mesh, type ParticleSystem, type Scene } from './core';
import type { BuildEffect } from '../types';

/** Babylon's particles are only needed once something is built: loaded with the first effect. */
type Particles = typeof import('@babylonjs/core/Particles/particleSystem');
let particles: Promise<Particles> | null = null;
const loadParticles = () => (particles ??= import('@babylonjs/core/Particles/particleSystem'));

/** Seconds a ring takes to spread and fade. */
const RING_TIME = 0.65;
const RING_POOL = 8;
/** Seconds the pop takes to settle. */
const POP_TIME = 0.6;

/** One placed object's instance: where its matrix lives in the template's buffer. */
export interface PopTarget {
  meshes: Mesh[];
  matrices: Float32Array;
  index: number;
}

interface Ring {
  mesh: Mesh;
  age: number;
  size: number;
}

/** Particles still to emit inside a box (world space). */
interface Burst {
  x0: number;
  y0: number;
  z0: number;
  x1: number;
  y1: number;
  z1: number;
  left: number;
}

interface Pop {
  target: PopTarget;
  base: Matrix;
  age: number;
}

const RING_COLORS: Record<BuildEffect['kind'], string> = {
  place: '#FFC94D',
  upgrade: '#FFB020',
  sell: '#D9DEE8',
  build: '#F1E3C8',
  remove: '#E8D9D3',
};

export class BuildEffects {
  private readonly rings: Ring[] = [];
  private readonly ringMaterials = new Map<string, StandardMaterial>();
  private readonly ringTexture: DynamicTexture;
  private sparkles: ParticleSystem | null = null;
  private dust: ParticleSystem | null = null;
  private readonly bursts = new Map<ParticleSystem, Burst[]>();
  private readonly pops: Pop[] = [];
  private readonly mScale = new Matrix();
  private readonly mOut = new Matrix();
  private disposed = false;

  constructor(private readonly scene: Scene) {
    this.ringTexture = ringTexture(scene);
  }

  play(fx: BuildEffect): void {
    const cx = fx.x + fx.w / 2;
    const cz = fx.z + fx.d / 2;
    const size = Math.max(fx.w, fx.d);
    switch (fx.kind) {
      case 'place':
      case 'upgrade':
        this.ring(fx.kind, cx, cz, size, fx.y ?? 0);
        this.emit('sparkle', fx, fx.kind === 'upgrade' ? 56 : 40, 0.15, fx.kind === 'upgrade' ? 1.2 : 0.7);
        break;
      case 'sell':
        this.ring(fx.kind, cx, cz, size, fx.y ?? 0);
        this.emit('dust', fx, 22, 0.05, 0.4);
        // A little glitter: the money comes back.
        this.emit('sparkle', fx, 12, 0.3, 0.8);
        break;
      default:
        // Walls going up or coming down: dust all along their height.
        this.emit('dust', fx, 7, 0.05, 2.2);
    }
  }

  /** Springs a just-placed object into place: it grows from nothing, overshoots and settles. */
  pop(target: PopTarget): void {
    const o = target.index * 16;
    if (o + 16 > target.matrices.length) return;
    const base = Matrix.FromArray(target.matrices, o);
    for (const mesh of target.meshes) mesh.thinInstanceAllowAutomaticStaticBufferRecreation = true;
    this.pops.push({ target, base, age: 0 });
    this.writePop(this.pops[this.pops.length - 1], 0);
  }

  /** Forgets pops of a world that was rebuilt (its buffers are gone). */
  clearPops(): void {
    this.pops.length = 0;
  }

  get busy(): boolean {
    return this.rings.some((r) => r.age < RING_TIME) || this.pops.length > 0;
  }

  update(dtMs: number): void {
    const dt = Math.min(dtMs, 50) / 1000;
    for (const r of this.rings) {
      if (r.age >= RING_TIME) continue;
      r.age += dt;
      const t = Math.min(1, r.age / RING_TIME);
      const ease = 1 - (1 - t) ** 3;
      const s = r.size * (0.55 + 0.95 * ease) + 0.4;
      r.mesh.scaling.set(s, 1, s);
      r.mesh.visibility = (1 - t) ** 1.6;
      if (t >= 1) r.mesh.setEnabled(false);
    }
    for (let i = this.pops.length - 1; i >= 0; i--) {
      const p = this.pops[i];
      p.age += dt;
      const done = p.age >= POP_TIME;
      this.writePop(p, done ? POP_TIME : p.age);
      if (done) this.pops.splice(i, 1);
    }
  }

  dispose(): void {
    this.disposed = true;
    for (const r of this.rings) r.mesh.dispose();
    this.sparkles?.dispose();
    this.dust?.dispose();
  }

  private ring(kind: BuildEffect['kind'], cx: number, cz: number, size: number, y: number): void {
    let ring = this.rings.find((r) => r.age >= RING_TIME);
    if (!ring) {
      if (this.rings.length >= RING_POOL) ring = this.rings.reduce((a, b) => (a.age > b.age ? a : b));
      else {
        const mesh = MeshBuilder.CreateGround('buildRing', { width: 1, height: 1 }, this.scene);
        mesh.isPickable = false;
        mesh.alwaysSelectAsActiveMesh = true;
        ring = { mesh, age: RING_TIME, size: 1 };
        this.rings.push(ring);
      }
    }
    ring.mesh.material = this.ringMaterial(RING_COLORS[kind]);
    ring.mesh.position.set(cx, y + 0.045, cz);
    ring.mesh.setEnabled(true);
    ring.age = 0;
    ring.size = size;
  }

  private ringMaterial(color: string): StandardMaterial {
    let mat = this.ringMaterials.get(color);
    if (!mat) {
      mat = new StandardMaterial(`buildRing${color}`, this.scene);
      mat.disableLighting = true;
      mat.diffuseColor = Color3.Black();
      mat.specularColor = Color3.Black();
      mat.emissiveColor = Color3.FromHexString(color);
      mat.opacityTexture = this.ringTexture;
      mat.disableDepthWrite = true;
      mat.zOffset = -6;
      this.ringMaterials.set(color, mat);
    }
    return mat;
  }

  /** A burst on the sparkle or dust system; the very first one waits for the particle module. */
  private emit(kind: 'sparkle' | 'dust', fx: BuildEffect, count: number, y0: number, y1: number): void {
    const ready = kind === 'sparkle' ? this.sparkles : this.dust;
    if (ready) return this.burst(ready, fx, count, y0, y1);
    void loadParticles().then(({ ParticleSystem }) => {
      if (this.disposed) return;
      const ps = kind === 'sparkle' ? (this.sparkles ??= this.system(ParticleSystem, kind)) : (this.dust ??= this.system(ParticleSystem, kind));
      this.burst(ps, fx, count, y0, y1);
    });
  }

  /** Queues `count` particles inside the effect's footprint, between heights `y0` and `y1`. */
  private burst(ps: ParticleSystem, fx: BuildEffect, count: number, y0: number, y1: number): void {
    const queue = this.bursts.get(ps)!;
    const base = fx.y ?? 0;
    queue.push({ x0: fx.x, y0: base + y0, z0: fx.z, x1: fx.x + fx.w, y1: base + y1, z1: fx.z + fx.d, left: count });
    ps.manualEmitCount = Math.max(0, ps.manualEmitCount) + count;
    if (!ps.isStarted()) ps.start();
  }

  /** A particle system whose particles start in the queued bursts' boxes (in order). */
  private system(PS: Particles['ParticleSystem'], kind: 'sparkle' | 'dust'): ParticleSystem {
    const ps = kind === 'sparkle' ? sparkleSystem(this.scene, PS) : dustSystem(this.scene, PS);
    const queue: Burst[] = [];
    this.bursts.set(ps, queue);
    ps.emitter = Vector3.Zero();
    ps.startPositionFunction = (_world, position) => {
      while (queue.length && queue[0].left <= 0) queue.shift();
      const b = queue[0];
      if (!b) return position.set(0, -50, 0);
      b.left--;
      position.set(b.x0 + Math.random() * (b.x1 - b.x0), b.y0 + Math.random() * (b.y1 - b.y0), b.z0 + Math.random() * (b.z1 - b.z0));
    };
    return ps;
  }

  /** Damped spring from 0 to 1: grows in, overshoots by ~20% and settles. Squash and stretch on y. */
  private writePop(p: Pop, age: number): void {
    const t = age;
    const spring = (s: number) => (s <= 0 ? 0 : 1 - Math.exp(-7 * s) * Math.cos(13 * s));
    const done = t >= POP_TIME;
    const xz = done ? 1 : Math.max(0.001, spring(t));
    const y = done ? 1 : Math.max(0.001, spring(t - 0.035));
    Matrix.ScalingToRef(xz, y, xz, this.mScale);
    this.mScale.multiplyToRef(p.base, this.mOut);
    const { meshes, matrices, index } = p.target;
    this.mOut.copyToArray(matrices, index * 16);
    for (const mesh of meshes) {
      if (mesh.isDisposed()) continue;
      mesh.thinInstanceBufferUpdated('matrix');
    }
  }
}

function ringTexture(scene: Scene): DynamicTexture {
  const n = 256;
  const tex = new DynamicTexture('buildRing', n, scene, true);
  const ctx = tex.getContext() as CanvasRenderingContext2D;
  const g = ctx.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2);
  g.addColorStop(0, 'rgba(255,255,255,0)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.12)');
  g.addColorStop(0.76, 'rgba(255,255,255,1)');
  g.addColorStop(0.9, 'rgba(255,255,255,0.85)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, n, n);
  tex.update();
  tex.hasAlpha = true;
  return tex;
}

/** A soft four-pointed twinkle. */
function sparkleTexture(scene: Scene): DynamicTexture {
  const n = 64;
  const tex = new DynamicTexture('buildSparkle', n, scene, true);
  const ctx = tex.getContext() as CanvasRenderingContext2D;
  ctx.clearRect(0, 0, n, n);
  const glow = ctx.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2);
  glow.addColorStop(0, 'rgba(255,255,255,1)');
  glow.addColorStop(0.25, 'rgba(255,255,255,0.5)');
  glow.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, n, n);
  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  ctx.beginPath();
  const c = n / 2;
  ctx.moveTo(c, 2);
  ctx.quadraticCurveTo(c + 3, c - 3, n - 2, c);
  ctx.quadraticCurveTo(c + 3, c + 3, c, n - 2);
  ctx.quadraticCurveTo(c - 3, c + 3, 2, c);
  ctx.quadraticCurveTo(c - 3, c - 3, c, 2);
  ctx.fill();
  tex.update();
  tex.hasAlpha = true;
  return tex;
}

function puffTexture(scene: Scene): DynamicTexture {
  const n = 64;
  const tex = new DynamicTexture('buildPuff', n, scene, true);
  const ctx = tex.getContext() as CanvasRenderingContext2D;
  ctx.clearRect(0, 0, n, n);
  const g = ctx.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2);
  g.addColorStop(0, 'rgba(255,255,255,0.9)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.45)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, n, n);
  tex.update();
  tex.hasAlpha = true;
  return tex;
}

function sparkleSystem(scene: Scene, PS: Particles['ParticleSystem']): ParticleSystem {
  const ps = new PS('buildSparkles', 256, scene);
  ps.particleTexture = sparkleTexture(scene);
  ps.blendMode = PS.BLENDMODE_ADD;
  ps.color1 = new Color4(1, 0.88, 0.45, 1);
  ps.color2 = new Color4(1, 0.98, 0.85, 1);
  ps.colorDead = new Color4(1, 1, 1, 0);
  ps.minSize = 0.1;
  ps.maxSize = 0.28;
  ps.minLifeTime = 0.5;
  ps.maxLifeTime = 1.05;
  ps.emitRate = 0;
  ps.direction1 = new Vector3(-0.6, 2.6, -0.6);
  ps.direction2 = new Vector3(0.6, 4.2, 0.6);
  ps.minEmitPower = 0.5;
  ps.maxEmitPower = 0.9;
  ps.gravity = new Vector3(0, -3.2, 0);
  ps.minAngularSpeed = -2;
  ps.maxAngularSpeed = 2;
  ps.updateSpeed = 1 / 60;
  ps.isLocal = false;
  return ps;
}

function dustSystem(scene: Scene, PS: Particles['ParticleSystem']): ParticleSystem {
  const ps = new PS('buildDust', 256, scene);
  ps.particleTexture = puffTexture(scene);
  ps.blendMode = PS.BLENDMODE_STANDARD;
  ps.color1 = new Color4(0.88, 0.84, 0.76, 0.55);
  ps.color2 = new Color4(0.8, 0.8, 0.82, 0.45);
  ps.colorDead = new Color4(0.85, 0.85, 0.85, 0);
  ps.minSize = 0.25;
  ps.maxSize = 0.55;
  ps.addSizeGradient(0, 0.5);
  ps.addSizeGradient(1, 1.6);
  ps.minLifeTime = 0.55;
  ps.maxLifeTime = 1.0;
  ps.emitRate = 0;
  ps.direction1 = new Vector3(-1, 0.6, -1);
  ps.direction2 = new Vector3(1, 1.4, 1);
  ps.minEmitPower = 0.3;
  ps.maxEmitPower = 0.8;
  ps.gravity = new Vector3(0, 0.2, 0);
  ps.minAngularSpeed = -1;
  ps.maxAngularSpeed = 1;
  ps.updateSpeed = 1 / 60;
  ps.isLocal = false;
  return ps;
}
