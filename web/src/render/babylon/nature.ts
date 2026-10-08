/**
 * Landscape around the town: terrain with rolling hills, forests, lawn details and a sky
 * dome. Everything is static and instanced (one draw call per model type), generated
 * deterministically from the town's seed so a loaded game looks the same.
 *
 * Trees, bushes, hedges and lawn tufts are low-poly leaf-card glbs (`assets/nature/`, built by
 * tools/art/nature_models.py): ~1-1.5k triangles per tree near the town, `*.far` LODs (~150-300)
 * for the distant woods. `installNature` adds vertex-shader wind and per-instance tint variation
 * to their `nature.*` materials; `natureDecor` turns the house builder's garden dressing into
 * species (hedges or shrub borders, mixed lot trees kept clear of the street and paths).
 */

import {
  Color3,
  MaterialPluginBase,
  Matrix,
  Mesh,
  MeshBuilder,
  PBRMaterial,
  Quaternion,
  ShaderLanguage,
  StandardMaterial,
  Texture,
  Vector3,
  VertexBuffer,
  VertexData,
  type AbstractEngine,
  type Material,
  type MaterialDefines,
  type Nullable,
  type Scene,
  type SubMesh,
  type UniformBuffer,
} from '@babylonjs/core';
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
  /** Lawn tufts and flowers: each instance's original matrix and town tile (-1 outside the town). */
  private lawn: { meshes: Mesh[]; base: Float32Array; shown: Float32Array; tiles: Int32Array; hidden: Uint8Array }[] = [];

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
    // Lush, slightly yellow-green lawn (the classic life-sim look); greener on the hills.
    const grass = Color3.FromHexString('#86A84A');
    const lush = Color3.FromHexString('#6F9A3E');
    const meadow = Color3.FromHexString('#A2AE5A');
    const hill = Color3.FromHexString('#638A3E');
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

  /**
   * Woods outside the town: mixed deciduous / birch / conifer stands with bushes and rocks. Trees
   * near the town are full leaf-card models that cast shadows; further ones use the `*.far` models
   * (a few hundred triangles each), which don't.
   */
  private async forests(scene: Scene, assets: AssetRegistry): Promise<{ meshes: Mesh[]; casts: boolean }[]> {
    const rand = mulberry32(this.seed ^ 0x5eed);
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
        // Species: conifers in the dense cores, birches in groves at the edges, broadleaves elsewhere.
        const grove = fbm(x * 0.06 + 40, z * 0.06 - 15, this.seed + 3, 2);
        const roll = rand();
        let kind: string;
        if (roll < 0.08) kind = 'model.rock';
        else if (roll < 0.2) kind = 'model.bush';
        else if (roll < 0.26) kind = 'model.bush.small';
        else if (forest > 0.56 && rand() < 0.62) kind = 'model.pine';
        else if (grove > 0.55 && rand() < 0.7) kind = 'model.tree.birch';
        else kind = 'model.tree';
        const tree = kind.startsWith('model.tree') || kind === 'model.pine';
        const scale = kind === 'model.rock' ? 0.6 + rand() * 0.7 : tree ? 0.75 + rand() * 0.6 : 0.8 + rand() * 0.6;
        const m = Matrix.Compose(
          new Vector3(scale, scale * (0.9 + rand() * 0.25), scale),
          Quaternion.RotationAxis(Vector3.Up(), rand() * Math.PI * 2),
          new Vector3(x, this.heightAt(x, z) - 0.05, z),
        );
        const close = dist < SHADOW_RANGE && kind !== 'model.rock';
        const key = !close && assets.has(`${kind}.far`, 'model') ? `${kind}.far` : kind;
        const bucket = close ? near : far;
        bucket.set(key, [...(bucket.get(key) ?? []), m]);
      }
    }
    const out: { meshes: Mesh[]; casts: boolean }[] = [];
    for (const [bucket, casts] of [
      [near, true],
      [far, false],
    ] as const) {
      for (const [key, list] of bucket) {
        out.push({ meshes: await instanced(scene, assets, key, list, casts ? 0 : 1), casts });
      }
    }
    return out;
  }

  /**
   * Grass tufts and wildflowers on the town's tiles. Every unpaved tile gets some; the ones
   * indoors or under furniture are hidden by `refreshLawn` (rooms and furniture change in build mode).
   */
  private async lawns(scene: Scene, assets: AssetRegistry, world: WorldStructure): Promise<Mesh[]> {
    const rand = mulberry32(this.seed ^ 0x1a3d);
    const covered = [...(world.meta?.streets ?? []), ...(world.meta?.paths ?? [])];
    const onPavement = (x: number, z: number) => covered.some((r) => x >= r.x && x < r.x + r.w && z >= r.z && z < r.z + r.d);
    const tufts: Matrix[] = [];
    const flowers: Matrix[] = [];
    const tuftTiles: number[] = [];
    const flowerTiles: number[] = [];
    for (let z = 0; z < world.depth; z++) {
      for (let x = 0; x < world.width; x++) {
        const i = z * world.width + x;
        if (onPavement(x + 0.5, z + 0.5)) continue;
        // Leaf-card tufts are a few triangles each: a denser, softer lawn than before.
        const n = rand() < 0.5 ? 2 : 1;
        for (let k = 0; k < n; k++) {
          tufts.push(scatter(x, z, rand, 0.7 + rand() * 0.6));
          tuftTiles.push(i);
        }
        if (rand() < 0.06) {
          flowers.push(scatter(x, z, rand, 0.8 + rand() * 0.5));
          flowerTiles.push(i);
        }
      }
    }
    // Lawn detail around the town too, thinning out with distance.
    for (let n = 0; n < 5000; n++) {
      const x = -APRON - 30 + rand() * (world.width + APRON * 2 + 60);
      const z = -APRON - 30 + rand() * (world.depth + APRON * 2 + 60);
      const dist = this.distanceToTown(x, z);
      if (dist === 0 || rand() < dist / 40) continue;
      const m = scatter(x - 0.5, z - 0.5, rand, 0.8 + rand() * 0.7, this.heightAt(x, z));
      if (rand() < 0.1) {
        flowers.push(m);
        flowerTiles.push(-1);
      } else {
        tufts.push(m);
        tuftTiles.push(-1);
      }
    }
    this.lawn = [];
    for (const [key, matrices, tiles] of [
      ['model.grassTuft', tufts, tuftTiles],
      ['model.flowers', flowers, flowerTiles],
    ] as const) {
      const meshes = await instanced(scene, assets, key, matrices, 0, false);
      if (!meshes.length) continue;
      const base = new Float32Array(matrices.length * 16);
      matrices.forEach((m, i) => m.copyToArray(base, i * 16));
      this.lawn.push({ meshes, base, shown: new Float32Array(base), tiles: Int32Array.from(tiles), hidden: new Uint8Array(tiles.length) });
    }
    this.refreshLawn(world);
    return this.lawn.flatMap((l) => l.meshes);
  }

  /** Hides the lawn on tiles that are now indoors or under furniture, and shows it again elsewhere. */
  refreshLawn(world: WorldStructure): void {
    const hidden = new Uint8Array(world.width * world.depth);
    for (let i = 0; i < hidden.length; i++) if (world.rooms[i] !== 0) hidden[i] = 1;
    for (const o of world.objects) {
      for (let z = o.z; z < o.z + o.d; z++) for (let x = o.x; x < o.x + o.w; x++) hidden[z * world.width + x] = 1;
    }
    for (const layer of this.lawn) {
      let changed = false;
      for (let k = 0; k < layer.tiles.length; k++) {
        const t = layer.tiles[k];
        const hide = t >= 0 ? hidden[t] : 0;
        if (layer.hidden[k] === hide) continue;
        layer.hidden[k] = hide;
        changed = true;
        // An all-zero matrix hides an instance; `base` brings it back once the tile is outdoors again.
        if (hide) layer.shown.fill(0, k * 16, k * 16 + 16);
        else layer.shown.set(layer.base.subarray(k * 16, k * 16 + 16), k * 16);
      }
      if (!changed) continue;
      for (const mesh of layer.meshes) mesh.thinInstanceSetBuffer('matrix', layer.shown, 16, false);
    }
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
async function instanced(scene: Scene, assets: AssetRegistry, key: string, matrices: Matrix[], lod: 0 | 1 = 0, fixed = true): Promise<Mesh[]> {
  if (matrices.length === 0) return [];
  const template = await buildModel(scene, key, assets.get(key, 'model'), [1, 1], { lod });
  const buffer = new Float32Array(matrices.length * 16);
  matrices.forEach((m, i) => m.copyToArray(buffer, i * 16));
  for (const mesh of template.meshes) {
    mesh.thinInstanceSetBuffer('matrix', buffer, 16, fixed);
    mesh.thinInstanceRefreshBoundingInfo(false);
    mesh.receiveShadows = true;
    mesh.freezeWorldMatrix();
  }
  return template.meshes;
}

// ---- Garden dressing ------------------------------------------------------------------

type Decor = [number, number, number, number][];

/** Clear distances for lot trees (trunk to edge, metres). */
const TREE_CLEAR = { street: 3.0, path: 1.3, house: 2.2, object: 1.0 };

/**
 * Moves a lot tree (by up to 2.5 m, staying on the viewed lot) until its trunk is clear of the
 * street (road, sidewalk, kerb furniture and streetlights all stand inside the street rects, see
 * street.ts), garden paths and driveways, the house and placed objects; null when no spot is.
 */
function clearTreeSpot(x: number, z: number, world: WorldStructure, view: { x: number; z: number; w: number; d: number } | null): [number, number] | null {
  const streets = world.meta?.streets ?? [];
  const paths = world.meta?.paths ?? [];
  const gap = (r: { x: number; z: number; w: number; d: number }, px: number, pz: number) =>
    Math.hypot(Math.max(r.x - px, 0, px - (r.x + r.w)), Math.max(r.z - pz, 0, pz - (r.z + r.d)));
  const indoorNear = (px: number, pz: number, r: number) => {
    for (let tz = Math.floor(pz - r); tz <= Math.floor(pz + r); tz++) {
      for (let tx = Math.floor(px - r); tx <= Math.floor(px + r); tx++) {
        if (tx < 0 || tz < 0 || tx >= world.width || tz >= world.depth || world.rooms[tz * world.width + tx] === 0) continue;
        if (gap({ x: tx, z: tz, w: 1, d: 1 }, px, pz) < r) return true;
      }
    }
    return false;
  };
  const ok = (px: number, pz: number) =>
    (!view || (px > view.x + 0.8 && px < view.x + view.w - 0.8 && pz > view.z + 0.8 && pz < view.z + view.d - 0.8)) &&
    streets.every((r) => gap(r, px, pz) >= TREE_CLEAR.street) &&
    paths.every((r) => gap(r, px, pz) >= TREE_CLEAR.path) &&
    world.objects.every((o) => gap(o, px, pz) >= TREE_CLEAR.object) &&
    !indoorNear(px, pz, TREE_CLEAR.house);
  for (let r = 0; r <= 2.5; r += 0.5) {
    const steps = r === 0 ? 1 : 12;
    for (let k = 0; k < steps; k++) {
      const a = (k / steps) * Math.PI * 2;
      const px = x + Math.cos(a) * r;
      const pz = z + Math.sin(a) * r;
      if (ok(px, pz)) return [px, pz];
    }
  }
  return null;
}

/**
 * Splits the house builder's garden dressing (`model.tree` lot trees, `model.bush` foundation
 * shrubs; items are [x, z, scale, yaw]) into species. Lot trees mix shade, blossom, fruit and birch
 * trees; each house gets either a clipped hedge along its walls or a mixed border of round and
 * flowering shrubs. Deterministic per position.
 */
export function natureDecor(key: string, items: Decor, world?: WorldStructure, view?: { x: number; z: number; w: number; d: number } | null): [string, Decor][] {
  const out = new Map<string, Decor>();
  const put = (k: string, item: [number, number, number, number]) => out.set(k, [...(out.get(k) ?? []), item]);
  if (key === 'model.tree') {
    for (const item of items) {
      const h = hash(Math.floor(item[0] * 7), Math.floor(item[1] * 7), 91);
      // Crowns are ~2 m in radius: keep trunks well off the sidewalk, its streetlights and props.
      const spot = world ? clearTreeSpot(item[0], item[1], world, view ?? null) : [item[0], item[1]];
      if (!spot) continue;
      put(h < 0.36 ? 'model.tree' : h < 0.58 ? 'model.tree.blossom' : h < 0.78 ? 'model.tree.fruit' : 'model.tree.birch', [spot[0], spot[1], item[2], item[3]]);
    }
  } else if (key === 'model.bush' && items.length) {
    // One border style per house (the first shrub's position stands in for the lot).
    const style = hash(Math.floor(items[0][0] / 8), Math.floor(items[0][1] / 8), 92);
    for (const item of items) {
      const [x, z, s] = item;
      const h = hash(Math.floor(x * 5), Math.floor(z * 5), 93);
      if (style < 0.4) {
        // Hedge segments run along the wall: shrubs sit at x + 0.5 (wall along x) or z + 0.5.
        const alongX = Math.abs(x - Math.floor(x) - 0.5) < 0.05;
        put('model.hedge', [x, z, 0.95 + (s - 0.55) * 0.2, alongX ? 0 : Math.PI / 2]);
      } else {
        put(h < 0.45 ? 'model.bush' : h < 0.75 ? 'model.bush.flowering' : 'model.bush.small', [x, z, s * 1.1, item[3]]);
      }
    }
  } else if (items.length) {
    out.set(key, items);
  }
  return [...out];
}

// ---- Wind and foliage shading -----------------------------------------------------------

/** Wind shared by every foliage material of a scene; `time` advances per frame. */
const windState = new WeakMap<Scene, { time: number; strength: number }>();

/** Per material kind: x bend (per m^2 of height), y flutter amplitude (m), z flutter speed, w flutter ramp (1/m). */
const WIND_KIND: Record<string, [number, number, number, number]> = {
  'nature.bark': [0.0022, 0, 0, 0],
  'nature.leaves': [0.0022, 0.014, 3.1, 1.5],
  'nature.grass': [0.5, 0.004, 4.0, 6],
};

/**
 * Vertex-shader wind for the nature models (materials named `nature.*` in the glbs): a slow
 * height-weighted bend with gusts plus leaf flutter, phased per instance; and a small per-instance
 * colour variation so repeated trees don't look stamped. Leaf normals are pre-bent towards the
 * canopy, so both faces of a card shade the same (no two-sided normal flip).
 */
class NatureWindPlugin extends MaterialPluginBase {
  constructor(
    material: Material,
    private readonly kind: [number, number, number, number],
    private readonly state: { time: number; strength: number },
    private readonly foliage: boolean,
  ) {
    super(material, 'NatureWind', 230, { NATUREWIND: false, NATURETINT: false }, true, false);
    this.registerForExtraEvents = true;
    this._enable(true);
  }

  override getClassName(): string {
    return 'NatureWindPlugin';
  }

  override isCompatible(): boolean {
    return true;
  }

  override prepareDefines(defines: MaterialDefines): void {
    defines.NATUREWIND = true;
    defines.NATURETINT = this.foliage;
    if (this.foliage) defines.TWOSIDEDLIGHTING = false;
  }

  override getUniforms(): { externalUniforms: string[] } {
    return { externalUniforms: ['natureWind', 'natureWindKind'] };
  }

  override hardBindForSubMesh(_ubo: UniformBuffer, _scene: Scene, _engine: AbstractEngine, subMesh: SubMesh): void {
    const effect = subMesh.effect;
    if (!effect) return;
    const k = this.kind;
    effect.setFloat4('natureWind', this.state.time, this.state.strength, 0.8, 0.6);
    effect.setFloat4('natureWindKind', k[0], k[1], k[2], k[3]);
  }

  override getCustomCode(shaderType: string, shaderLanguage?: ShaderLanguage): Nullable<{ [pointName: string]: string }> {
    if (shaderType !== 'vertex') return null;
    const wgsl = shaderLanguage === ShaderLanguage.WGSL;
    const definitions = wgsl
      ? '#ifdef NATUREWIND\nuniform natureWind: vec4f;\nuniform natureWindKind: vec4f;\n#endif\n'
      : '#ifdef NATUREWIND\nuniform vec4 natureWind;\nuniform vec4 natureWindKind;\n#endif\n';
    const u = (n: string) => (wgsl ? `uniforms.${n}` : n);
    const v = (n: string) => (wgsl ? `vertexInputs.${n}` : n);
    const f3 = wgsl ? 'vec3f' : 'vec3';
    const f2 = wgsl ? 'vec2f' : 'vec2';
    const decl = (name: string, type: string) => (wgsl ? `var ${name}: ${type === 'float' ? 'f32' : type === 'vec3' ? 'vec3f' : type}` : `${type} ${name}`);
    const body = `
#ifdef NATUREWIND
{
  ${decl('inst', 'vec3')} = ${f3}(0.0);
  ${decl('lw', 'vec3')} = ${f3}(${u('natureWind')}.z, 0.0, ${u('natureWind')}.w);
#ifdef INSTANCES
  inst = ${v('world3')}.xyz;
  ${decl('s2', 'float')} = max(dot(${v('world0')}.xyz, ${v('world0')}.xyz), 0.0001);
  lw = ${f3}(dot(lw, ${v('world0')}.xyz), 0.0, dot(lw, ${v('world2')}.xyz)) / s2;
#endif
  ${decl('t', 'float')} = ${u('natureWind')}.x;
  ${decl('ph', 'float')} = dot(inst.xz, ${f2}(0.21, 0.17));
  ${decl('h', 'float')} = max(positionUpdated.y, 0.0);
  ${decl('gust', 'float')} = (0.6 + 0.4 * sin(t * 0.37 + ph * 0.5)) * ${u('natureWind')}.y;
  ${decl('sway', 'float')} = (sin(t * 1.1 + ph) * 0.7 + sin(t * 2.3 + ph * 1.7) * 0.3) * gust;
  ${decl('kind', 'vec4f')} = ${u('natureWindKind')};
  ${decl('fp', 'float')} = dot(positionUpdated, ${f3}(3.1, 1.7, 2.3)) + ph * 3.0;
  ${decl('fl', 'float')} = kind.y * min(h * kind.w, 1.0) * gust;
  positionUpdated = positionUpdated + lw * (sway * kind.x * h * h) + ${f3}(sin(t * kind.z + fp), 0.6 * sin(t * kind.z * 1.3 + fp * 1.3), cos(t * kind.z * 0.9 + fp)) * fl;
#if defined(NATURETINT) && defined(VERTEXCOLOR)
  ${decl('rnd', 'float')} = fract(sin(dot(inst.xz, ${f2}(12.9898, 78.233))) * 43758.5453);
  colorUpdated = ${wgsl ? 'vec4f' : 'vec4'}(colorUpdated.rgb * mix(${f3}(1.07, 1.02, 0.84), ${f3}(0.9, 0.98, 1.04), rnd) * (0.92 + 0.14 * fract(rnd * 7.31)), colorUpdated.a);
#endif
}
#endif
`;
    return { CUSTOM_VERTEX_DEFINITIONS: definitions, CUSTOM_VERTEX_UPDATE_POSITION: wgsl ? body.replace(/vec4f/g, 'vec4f') : body.replace(/vec4f/g, 'vec4') };
  }
}

/**
 * Hooks foliage materials as they are created (glTF `nature.*` materials, whoever loads them):
 * wind sway and the per-instance tint. Also advances the wind clock. Call once per scene, before
 * any nature model loads.
 */
export function installNature(scene: Scene): void {
  if (windState.has(scene)) return;
  const state = { time: 0, strength: 1 };
  windState.set(scene, state);
  scene.onBeforeRenderObservable.add(() => {
    state.time += Math.min(0.1, scene.getEngine().getDeltaTime() / 1000);
  });
  scene.onNewMaterialAddedObservable.add((material) => {
    const kind = WIND_KIND[material.name];
    if (!kind || !(material instanceof PBRMaterial)) return;
    new NatureWindPlugin(material, kind, state, material.name !== 'nature.bark');
  });
}


// ---- Sky ------------------------------------------------------------------------------

/**
 * Gradient sky dome with a glow around the sun (colours follow the time of day via vertex
 * colours, no custom shader) and a band of drifting clouds (`image.clouds`).
 */
export class Sky {
  private readonly dome: Mesh;
  private readonly dirs: Float32Array;
  private readonly colors: Float32Array;
  private readonly clouds: Mesh | null = null;
  private readonly cloudMaterial: StandardMaterial | null = null;
  private readonly zenith = new Color3();
  private readonly tmp = new Color3();
  private readonly glow = new Color3();

  constructor(scene: Scene, radius: number, cloudsUrl?: string) {
    this.dome = MeshBuilder.CreateSphere('sky', { diameter: radius * 2, segments: 32, sideOrientation: Mesh.BACKSIDE }, scene);
    const positions = this.dome.getVerticesData(VertexBuffer.PositionKind)!;
    this.dirs = new Float32Array(positions.length);
    for (let i = 0; i < positions.length; i++) this.dirs[i] = positions[i] / radius;
    this.colors = new Float32Array((positions.length / 3) * 4);
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

    if (cloudsUrl) {
      // A slightly tapered open cylinder spanning ~3..32 degrees above the horizon.
      const r = radius * 0.94;
      const band = (this.clouds = MeshBuilder.CreateCylinder(
        'clouds',
        { diameterBottom: r * 2, diameterTop: r * 1.7, height: r * 0.55, tessellation: 48, cap: Mesh.NO_CAP, sideOrientation: Mesh.DOUBLESIDE },
        scene,
      ));
      band.position.y = r * 0.31;
      band.infiniteDistance = true;
      band.isPickable = false;
      band.applyFog = false;
      const cm = (this.cloudMaterial = new StandardMaterial('clouds', scene));
      const tex = new Texture(cloudsUrl, scene, { invertY: true });
      tex.hasAlpha = true;
      tex.uScale = 2;
      tex.wrapU = Texture.WRAP_ADDRESSMODE;
      tex.wrapV = Texture.CLAMP_ADDRESSMODE;
      cm.diffuseTexture = tex;
      cm.useAlphaFromDiffuseTexture = true;
      cm.disableLighting = true;
      cm.diffuseColor = Color3.Black();
      cm.specularColor = Color3.Black();
      cm.fogEnabled = false;
      cm.backFaceCulling = false;
      cm.disableDepthWrite = true;
      band.material = cm;
    }
  }

  get mesh(): Mesh {
    return this.dome;
  }

  /** Camera layers the sky is drawn on (see layers.ts). */
  setLayerMask(mask: number): void {
    this.dome.layerMask = mask;
    if (this.clouds) this.clouds.layerMask = mask;
  }

  /** Slow cloud drift; call per frame (moves a mesh, no re-recording needed). */
  drift(dt: number): void {
    if (this.clouds) this.clouds.rotation.y += dt * 0.000004;
  }

  /** Horizon = fog/clear colour, zenith = deeper sky colour, plus a glow around the sun. */
  update(l: Lighting): void {
    this.zenith.copyFrom(l.zenithColor);
    const sx = -l.sunDirection.x;
    const sy = -l.sunDirection.y;
    const sz = -l.sunDirection.z;
    // Strongest at golden hour, faint at noon, a dim halo around the moon at night.
    const strength = Math.min(1, l.sunIntensity / 2.5) * (0.35 + 0.65 * (1 - l.sunUp));
    const n = this.dirs.length / 3;
    for (let i = 0; i < n; i++) {
      const dx = this.dirs[i * 3];
      const dy = this.dirs[i * 3 + 1];
      const dz = this.dirs[i * 3 + 2];
      const t = smoothstep(0.02, 0.75, dy);
      Color3.LerpToRef(l.clearColor, this.zenith, t, this.tmp);
      const d = Math.max(0, dx * sx + dy * sy + dz * sz);
      const g = (Math.pow(d, 6) * 0.55 + Math.pow(d, 48) * 0.6) * strength * (dy > -0.05 ? 1 : 0);
      this.glow.copyFrom(l.sunColor).scaleInPlace(g);
      this.tmp.addInPlace(this.glow);
      // Rendering is linear (sRGB conversion happens in image processing).
      this.tmp.toLinearSpaceToRef(this.tmp);
      this.colors[i * 4] = this.tmp.r;
      this.colors[i * 4 + 1] = this.tmp.g;
      this.colors[i * 4 + 2] = this.tmp.b;
      this.colors[i * 4 + 3] = 1;
    }
    this.dome.updateVerticesData(VertexBuffer.ColorKind, this.colors);
    if (this.cloudMaterial) {
      // Lit side of the clouds: sky-bright by day, sunset-tinted at golden hour, dim at night.
      Color3.LerpToRef(l.clearColor, l.sunColor, 0.35 + 0.25 * (1 - l.sunUp), this.tmp);
      this.tmp.scaleInPlace(Math.min(1.15, 0.25 + l.sunIntensity * 0.28));
      this.tmp.toLinearSpaceToRef(this.cloudMaterial.emissiveColor);
    }
  }
}
