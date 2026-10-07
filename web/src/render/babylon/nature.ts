/**
 * Landscape around the town: terrain with rolling hills, forests, lawn details and a sky
 * dome. Everything is static and instanced (one draw call per model type), generated
 * deterministically from the town's seed so a loaded game looks the same.
 */

import { Color3, Matrix, Mesh, MeshBuilder, Quaternion, StandardMaterial, Vector3, VertexBuffer, VertexData, type Scene } from '@babylonjs/core';
import type { AssetRegistry } from '../../assets/registry';
import type { WorldStructure } from '../../core/protocol';
import type { Lighting } from './environment';
import { MaterialLibrary } from './materials';
import { buildModel } from './models';

/** How far the landscape extends beyond the town (metres). */
const RING = 150;
/** Flat apron around the town before the hills start. */
const APRON = 6;
const TERRAIN_STEP = 2.5;
/** Trees within this distance of the town cast shadows; further ones don't. */
const SHADOW_RANGE = 28;

export interface NatureResult {
  meshes: Mesh[];
  /** Meshes that should cast shadows. */
  casters: Mesh[];
}

// ---- Deterministic noise ------------------------------------------------------------

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(x: number, z: number, seed: number): number {
  let h = (Math.imul(x, 374761393) + Math.imul(z, 668265263) + Math.imul(seed, 2147483647)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function valueNoise(x: number, z: number, seed: number): number {
  const xi = Math.floor(x);
  const zi = Math.floor(z);
  const xf = x - xi;
  const zf = z - zi;
  const u = xf * xf * (3 - 2 * xf);
  const v = zf * zf * (3 - 2 * zf);
  const a = hash(xi, zi, seed);
  const b = hash(xi + 1, zi, seed);
  const c = hash(xi, zi + 1, seed);
  const d = hash(xi + 1, zi + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

function fbm(x: number, z: number, seed: number, octaves = 4): number {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  for (let i = 0; i < octaves; i++) {
    sum += amp * valueNoise(x * freq, z * freq, seed + i * 17);
    amp *= 0.5;
    freq *= 2;
  }
  return sum;
}

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// ---- Landscape ----------------------------------------------------------------------

export class Landscape {
  private readonly seed: number;
  private readonly w: number;
  private readonly d: number;

  constructor(world: WorldStructure) {
    this.seed = world.meta?.seed ?? 1;
    this.w = world.width;
    this.d = world.depth;
  }

  /** Distance from the town rectangle (0 inside). */
  distanceToTown(x: number, z: number): number {
    const dx = Math.max(0 - x, 0, x - this.w);
    const dz = Math.max(0 - z, 0, z - this.d);
    return Math.hypot(dx, dz);
  }

  heightAt(x: number, z: number): number {
    const dist = this.distanceToTown(x, z);
    if (dist <= APRON) return 0;
    const rise = smoothstep(APRON, APRON + 45, dist);
    const hills = fbm(x * 0.018, z * 0.018, this.seed) * 14 - 4;
    const rim = Math.pow(Math.max(0, dist - 60) / RING, 2) * 30;
    return Math.max(-0.4, rise * hills + rim);
  }

  async build(scene: Scene, assets: AssetRegistry, world: WorldStructure): Promise<NatureResult> {
    const meshes: Mesh[] = [];
    const casters: Mesh[] = [];
    meshes.push(this.terrain(scene));
    for (const forest of await this.forests(scene, assets)) {
      meshes.push(...forest.meshes);
      if (forest.casts) casters.push(...forest.meshes);
    }
    meshes.push(...(await this.lawns(scene, assets, world)));
    return { meshes, casters };
  }

  private terrain(scene: Scene): Mesh {
    const size = Math.max(this.w, this.d) + RING * 2;
    const segments = Math.round(size / TERRAIN_STEP);
    const ground = MeshBuilder.CreateGround('terrain', { width: size, height: size, subdivisions: segments, updatable: false }, scene);
    ground.position.set(this.w / 2, 0, this.d / 2);
    ground.bakeCurrentTransformIntoVertices();

    const positions = ground.getVerticesData(VertexBuffer.PositionKind)!;
    const colors = new Float32Array((positions.length / 3) * 4);
    // sRGB vertex colours (converted on the GPU) multiply the grass detail texture.
    const grass = Color3.FromHexString('#6F8C3E');
    const lush = Color3.FromHexString('#5B7C33');
    const meadow = Color3.FromHexString('#8F9550');
    const hill = Color3.FromHexString('#5A7538');
    const dirt = Color3.FromHexString('#7C6748');
    const tmp = new Color3();
    for (let i = 0, c = 0; i < positions.length; i += 3, c += 4) {
      const x = positions[i];
      const z = positions[i + 2];
      const h = this.heightAt(x, z);
      positions[i + 1] = h;
      const patch = fbm(x * 0.06, z * 0.06, this.seed + 99, 3);
      const fine = fbm(x * 0.21, z * 0.21, this.seed + 31, 2);
      Color3.LerpToRef(lush, grass, smoothstep(0.3, 0.55, fine), tmp);
      Color3.LerpToRef(tmp, meadow, smoothstep(0.5, 0.75, patch), tmp);
      Color3.LerpToRef(tmp, hill, smoothstep(1, 10, h), tmp);
      // Worn, earthy patches: sparse, and more common on the flat ground near the town.
      const bare = smoothstep(0.66, 0.8, fbm(x * 0.09 + 13, z * 0.09 - 7, this.seed + 5, 3)) * (1 - smoothstep(2, 8, h));
      Color3.LerpToRef(tmp, dirt, bare * 0.85, tmp);
      colors[c] = tmp.r;
      colors[c + 1] = tmp.g;
      colors[c + 2] = tmp.b;
      colors[c + 3] = 1;
    }
    const normals: number[] = [];
    VertexData.ComputeNormals(positions, ground.getIndices()!, normals);
    ground.setVerticesData(VertexBuffer.PositionKind, positions);
    ground.setVerticesData(VertexBuffer.NormalKind, normals);
    ground.setVerticesData(VertexBuffer.ColorKind, colors);
    ground.refreshBoundingInfo();

    ground.material = MaterialLibrary.for(scene).surface('material.ground', { vertexColors: true });
    ground.receiveShadows = true;
    return ground;
  }

  /** Clustered trees, pines, bushes and rocks outside the town. */
  private async forests(scene: Scene, assets: AssetRegistry): Promise<{ meshes: Mesh[]; casts: boolean }[]> {
    const rand = mulberry32(this.seed ^ 0x5eed);
    const kinds = ['model.tree', 'model.pine', 'model.bush', 'model.rock'] as const;
    const near = new Map<string, Matrix[]>();
    const far = new Map<string, Matrix[]>();
    const spacing = 4.2;
    const size = Math.max(this.w, this.d) + RING * 2;
    const x0 = this.w / 2 - size / 2;
    const z0 = this.d / 2 - size / 2;
    for (let gx = 0; gx * spacing < size; gx++) {
      for (let gz = 0; gz * spacing < size; gz++) {
        const x = x0 + (gx + rand()) * spacing;
        const z = z0 + (gz + rand()) * spacing;
        const dist = this.distanceToTown(x, z);
        if (dist < APRON + 2) continue;
        const forest = fbm(x * 0.025, z * 0.025, this.seed + 7, 3);
        const density = smoothstep(0.42, 0.62, forest) * 0.85 + 0.06 - (dist < 14 ? 0.05 : 0);
        if (rand() > density) continue;
        const roll = rand();
        const kind = roll < 0.12 ? 'model.rock' : roll < 0.28 ? 'model.bush' : forest > 0.55 && rand() < 0.6 ? 'model.pine' : 'model.tree';
        const scale = (kind === 'model.rock' ? 0.6 : 0.8) + rand() * 0.7;
        const m = Matrix.Compose(
          new Vector3(scale, scale * (0.9 + rand() * 0.25), scale),
          Quaternion.RotationAxis(Vector3.Up(), rand() * Math.PI * 2),
          new Vector3(x, this.heightAt(x, z) - 0.05, z),
        );
        const bucket = dist < SHADOW_RANGE && kind !== 'model.rock' ? near : far;
        bucket.set(kind, [...(bucket.get(kind) ?? []), m]);
      }
    }
    const out: { meshes: Mesh[]; casts: boolean }[] = [];
    for (const [bucket, casts] of [
      [near, true],
      [far, false],
    ] as const) {
      for (const kind of kinds) {
        const list = bucket.get(kind);
        if (!list?.length) continue;
        // Distant instances use a coarser tessellation of the same model.
        out.push({ meshes: await instanced(scene, assets, kind, list, casts ? 0 : 1), casts });
      }
    }
    return out;
  }

  /** Grass tufts and wildflowers on the town's outdoor tiles. */
  private async lawns(scene: Scene, assets: AssetRegistry, world: WorldStructure): Promise<Mesh[]> {
    const rand = mulberry32(this.seed ^ 0x1a3d);
    const blocked = new Uint8Array(world.width * world.depth);
    for (const o of world.objects) {
      for (let z = o.z; z < o.z + o.d; z++) for (let x = o.x; x < o.x + o.w; x++) blocked[z * world.width + x] = 1;
    }
    const covered = [...(world.meta?.streets ?? []), ...(world.meta?.paths ?? [])];
    const onPavement = (x: number, z: number) => covered.some((r) => x >= r.x && x < r.x + r.w && z >= r.z && z < r.z + r.d);
    const tufts: Matrix[] = [];
    const flowers: Matrix[] = [];
    for (let z = 0; z < world.depth; z++) {
      for (let x = 0; x < world.width; x++) {
        const i = z * world.width + x;
        if (world.rooms[i] !== 0 || blocked[i] || onPavement(x + 0.5, z + 0.5)) continue;
        if (rand() < 0.45) tufts.push(scatter(x, z, rand, 0.7 + rand() * 0.6));
        if (rand() < 0.05) flowers.push(scatter(x, z, rand, 0.8 + rand() * 0.5));
      }
    }
    // Lawn detail around the town too, thinning out with distance.
    for (let n = 0; n < 2500; n++) {
      const x = -APRON - 30 + rand() * (world.width + APRON * 2 + 60);
      const z = -APRON - 30 + rand() * (world.depth + APRON * 2 + 60);
      const dist = this.distanceToTown(x, z);
      if (dist === 0 || rand() < dist / 40) continue;
      const m = scatter(x - 0.5, z - 0.5, rand, 0.8 + rand() * 0.7, this.heightAt(x, z));
      (rand() < 0.12 ? flowers : tufts).push(m);
    }
    return [...(await instanced(scene, assets, 'model.grassTuft', tufts)), ...(await instanced(scene, assets, 'model.flowers', flowers))];
  }
}

function scatter(x: number, z: number, rand: () => number, scale: number, y = 0): Matrix {
  return Matrix.Compose(
    new Vector3(scale, scale, scale),
    Quaternion.RotationAxis(Vector3.Up(), rand() * Math.PI * 2),
    new Vector3(x + rand(), y, z + rand()),
  );
}

/** One template per model key, drawn with thin instances; static, so bounds are computed once. */
async function instanced(scene: Scene, assets: AssetRegistry, key: string, matrices: Matrix[], lod: 0 | 1 = 0): Promise<Mesh[]> {
  if (matrices.length === 0) return [];
  const template = await buildModel(scene, key, assets.get(key, 'model'), [1, 1], { lod });
  const buffer = new Float32Array(matrices.length * 16);
  matrices.forEach((m, i) => m.copyToArray(buffer, i * 16));
  for (const mesh of template.meshes) {
    mesh.thinInstanceSetBuffer('matrix', buffer, 16, true);
    mesh.thinInstanceRefreshBoundingInfo(false);
    mesh.receiveShadows = true;
    mesh.freezeWorldMatrix();
  }
  return template.meshes;
}

// ---- Sky ------------------------------------------------------------------------------

/** Gradient sky dome; colours follow the time of day via vertex colours (no custom shader). */
export class Sky {
  private readonly dome: Mesh;
  private readonly heights: Float32Array;
  private readonly colors: Float32Array;
  private readonly zenith = new Color3();
  private readonly tmp = new Color3();

  constructor(scene: Scene, radius: number) {
    this.dome = MeshBuilder.CreateSphere('sky', { diameter: radius * 2, segments: 24, sideOrientation: Mesh.BACKSIDE }, scene);
    const positions = this.dome.getVerticesData(VertexBuffer.PositionKind)!;
    this.heights = new Float32Array(positions.length / 3);
    for (let i = 0; i < this.heights.length; i++) this.heights[i] = positions[i * 3 + 1] / radius;
    this.colors = new Float32Array(this.heights.length * 4);
    this.dome.setVerticesData(VertexBuffer.ColorKind, this.colors, true);
    const mat = new StandardMaterial('sky', scene);
    mat.disableLighting = true;
    mat.emissiveColor = Color3.White();
    mat.fogEnabled = false;
    mat.backFaceCulling = false;
    this.dome.material = mat;
    this.dome.infiniteDistance = true;
    this.dome.isPickable = false;
    this.dome.applyFog = false;
  }

  get mesh(): Mesh {
    return this.dome;
  }

  /** Horizon = fog/clear colour, zenith = deeper sky colour. */
  update(l: Lighting): void {
    this.zenith.copyFrom(l.zenithColor);
    for (let i = 0; i < this.heights.length; i++) {
      const t = smoothstep(0.02, 0.75, this.heights[i]);
      Color3.LerpToRef(l.clearColor, this.zenith, t, this.tmp);
      // Rendering is linear (sRGB conversion happens in image processing).
      this.tmp.toLinearSpaceToRef(this.tmp);
      this.colors[i * 4] = this.tmp.r;
      this.colors[i * 4 + 1] = this.tmp.g;
      this.colors[i * 4 + 2] = this.tmp.b;
      this.colors[i * 4 + 3] = 1;
    }
    this.dome.updateVerticesData(VertexBuffer.ColorKind, this.colors);
  }
}
