/**
 * Builds renderable templates from asset entries: glTF files when provided,
 * otherwise placeholder primitives from the manifest. Each template is drawn
 * with thin instances (one draw call per mesh, however many copies exist).
 *
 * Placeholder parts are merged per (tint slot, finish) so a model costs one draw call per
 * distinct finish. Boxes get rounded edges so they catch highlights; every part gets
 * metre-scale UVs so textured finishes (fabric, wood, bark) tile at a realistic density.
 *
 * glTF entries may also carry (see `ModelExtras`):
 * - `fit`: scale the model (non-uniformly if needed) into an exact W x H x D box, bottom on the
 *   floor and centred on the footprint, so files from any source line up with the gameplay
 *   footprint and seat/bed heights.
 * - `materials`: restyle the file's materials by name: tint them, or replace them with one of the
 *   game's finishes (`material.finish.*`, vertex-coloured, box-projected UVs in metres). Replaced
 *   parts merge with placeholder parts of the same finish, so a flat-coloured kit model costs a few
 *   draw calls and matches the rest of the furniture. Style variants reuse one file this way.
 * - `parts`: extra placeholder primitives drawn with the file (books on a shelf, pillows, a lamp).
 */

import {
  Color3,
  ImportMeshAsync,
  PBRMaterial,
  Matrix,
  Mesh,
  MeshBuilder,
  Quaternion,
  Vector3,
  VertexBuffer,
  VertexData,
  type Scene,
} from './core';
import './loaders';
import type { Material } from './core';
import type { ModelEntry, PlaceholderPart, Vec3 } from '../../assets/types';
import { bakeFoliageCards } from './foliageCards';
import { DEFAULT_FINISH, encodeFinish, MaterialLibrary } from './materials';

export type TintSlot = NonNullable<PlaceholderPart['tint']>;
export type BoneName = NonNullable<PlaceholderPart['bone']>;

export interface ModelTemplate {
  /** Meshes in model space; each receives the same instance matrices. */
  meshes: Mesh[];
  /** Per mesh: which `look` colour tints it, or null for none. */
  tints: (TintSlot | null)[];
  /** Per mesh: the limb it belongs to (characters), or null for the body. */
  bones: (BoneName | null)[];
  /** Height of the model's bounding box, for picking. */
  height: number;
}

export interface BuildOptions {
  /** 0 = full detail, 1 = reduced tessellation for distant instances. */
  lod?: 0 | 1;
}

export async function buildModel(
  scene: Scene,
  name: string,
  entry: ModelEntry | undefined,
  footprint: [number, number],
  options: BuildOptions = {},
): Promise<ModelTemplate> {
  if (entry?.url) {
    try {
      return await loadGltf(scene, name, entry);
    } catch (err) {
      console.warn(`[render] failed to load ${entry.url}, using placeholder`, err);
    }
  }
  return buildPlaceholder(scene, name, entry?.placeholder ?? fallbackParts(footprint), options.lod ?? 0);
}

function buildPlaceholder(scene: Scene, name: string, parts: PlaceholderPart[], lod: 0 | 1): ModelTemplate {
  const groups = new PartGroups(scene);
  parts.forEach((part, index) => groups.addPart(part, lod, index));
  const { meshes, tints, bones } = groups.build(name);
  return { meshes, tints, bones, height: groups.height };
}

/**
 * Meshes grouped per (tint slot, finish, bone) and merged into one draw call each. Untextured
 * opaque finishes share one material: roughness/metalness go into the vertex alpha.
 */
class PartGroups {
  private readonly lib: MaterialLibrary;
  private readonly groups = new Map<string, { tint: TintSlot | null; finish: string; bone: BoneName | null; meshes: Mesh[] }>();
  height = 0;

  constructor(private readonly scene: Scene) {
    this.lib = MaterialLibrary.for(scene);
  }

  /** Vertex alpha and group finish for a finish key. */
  finish(key: string): { alpha: number; group: string } {
    const info = this.lib.finishInfo(key);
    return info.plain ? { alpha: encodeFinish(info.roughness, info.metallic), group: PLAIN } : { alpha: 1, group: key };
  }

  addPart(part: PlaceholderPart, lod: 0 | 1, index: number): void {
    const { alpha, group } = this.finish(part.material ?? DEFAULT_FINISH);
    const mesh = partMesh(this.scene, part, lod, index, alpha);
    this.height = Math.max(this.height, part.at[1] + part.size[1] / 2);
    this.add(mesh, part.tint ?? null, group, part.bone ?? null);
  }

  add(mesh: Mesh, tint: TintSlot | null, finish: string, bone: BoneName | null): void {
    const key = `${tint ?? ''}|${finish}|${bone ?? ''}`;
    const group = this.groups.get(key) ?? { tint, finish, bone, meshes: [] };
    group.meshes.push(mesh);
    this.groups.set(key, group);
  }

  build(name: string): { meshes: Mesh[]; tints: (TintSlot | null)[]; bones: (BoneName | null)[] } {
    const meshes: Mesh[] = [];
    const tints: (TintSlot | null)[] = [];
    const bones: (BoneName | null)[] = [];
    for (const { tint, finish, bone, meshes: group } of this.groups.values()) {
      const merged = group.length === 1 ? group[0] : Mesh.MergeMeshes(group, true, true);
      if (!merged) continue;
      const suffix = finish === PLAIN ? '' : `@${finish.replace('material.finish.', '')}`;
      merged.name = `${name}${tint ? `:${tint}` : ''}${bone ? `#${bone}` : ''}${suffix}`;
      merged.material = finish === PLAIN ? this.lib.plainFinish() : this.lib.finish(finish);
      meshes.push(merged);
      tints.push(tint);
      bones.push(bone);
    }
    return { meshes, tints, bones };
  }
}

/** Group key for parts drawn with the shared plain finish. */
const PLAIN = 'plain';

function partMesh(scene: Scene, p: PlaceholderPart, lod: 0 | 1, index: number, alpha: number): Mesh {
  const [sx, sy, sz] = p.size;
  const lo = lod === 1;
  let mesh: Mesh;
  let shade: ((nx: number, ny: number, nz: number) => number) | null = null;
  // `torus` and `lathe` extend the manifest schema (see `ExtraShapes`).
  const ext = p as PlaceholderPart & ExtraShapes;
  switch (p.shape as PlaceholderPart['shape'] | 'torus' | 'lathe') {
    case 'torus':
      // size: [outer diameter x, tube thickness, outer diameter z].
      mesh = MeshBuilder.CreateTorus('part', { diameter: Math.max(sx - sy, 1e-3), thickness: sy, tessellation: p.segments ?? (lo ? 12 : 24) }, scene);
      mesh.scaling.set(1, 1, sz / sx);
      break;
    case 'lathe':
      mesh = latheMesh(scene, ext.profile ?? [[0, -0.5], [0.5, -0.5], [0.5, 0.5], [0, 0.5]], p.segments ?? (lo ? 12 : 24));
      mesh.scaling.set(sx, sy, sz);
      break;
    case 'cylinder':
    case 'cone': {
      const top = p.shape === 'cone' ? (p.taper ?? 0) : (p.taper ?? 1);
      mesh = MeshBuilder.CreateCylinder(
        'part',
        { height: sy, diameterTop: top, diameterBottom: 1, tessellation: p.segments ?? (lo ? 8 : p.shape === 'cone' ? 16 : 20) },
        scene,
      );
      mesh.scaling.set(sx, 1, sz);
      break;
    }
    case 'sphere':
      mesh = MeshBuilder.CreateSphere('part', { diameterX: sx, diameterY: sy, diameterZ: sz, segments: p.segments ?? (lo ? 6 : 12) }, scene);
      break;
    case 'capsule':
      mesh = MeshBuilder.CreateCapsule('part', { height: sy, radius: sx / 2, tessellation: 16, capSubdivisions: 6 }, scene);
      mesh.scaling.set(1, 1, sz / sx);
      break;
    case 'blob':
      mesh = blobMesh(scene, sx, sy, sz, p.noise ?? 0.18, lo ? 1 : 2, index * 7.31 + sx * 3.7);
      // Fake ambient occlusion: undersides and the inner canopy are darker.
      shade = (_nx, ny) => 0.55 + 0.45 * smoothstep(-0.7, 0.75, ny);
      break;
    default: {
      const r = p.radius ?? Math.min(0.012, Math.min(sx, sy, sz) * 0.25);
      mesh = roundedBox(scene, sx, sy, sz, lo ? 0 : r);
    }
  }
  if (p.rotate) {
    const [rx, ry, rz] = p.rotate.map((d) => (d * Math.PI) / 180);
    mesh.rotationQuaternion = Quaternion.FromEulerAngles(rx, ry, rz);
  }
  mesh.position.set(p.at[0], p.at[1], p.at[2]);
  mesh.bakeCurrentTransformIntoVertices();
  boxProjectUVs(mesh);

  const c = Color3.FromHexString(p.color);
  const count = mesh.getTotalVertices();
  const colors = new Float32Array(count * 4);
  const positions = shade ? mesh.getVerticesData(VertexBuffer.PositionKind) : null;
  for (let i = 0; i < count; i++) {
    let k = 1;
    if (shade && positions) {
      // Use the direction from the part centre (not the bumpy normal) for smooth occlusion.
      const dx = (positions[i * 3] - p.at[0]) / (sx / 2);
      const dy = (positions[i * 3 + 1] - p.at[1]) / (sy / 2);
      const dz = (positions[i * 3 + 2] - p.at[2]) / (sz / 2);
      const len = Math.hypot(dx, dy, dz) || 1;
      k = shade(dx / len, dy / len, dz / len);
    }
    colors[i * 4] = c.r * k;
    colors[i * 4 + 1] = c.g * k;
    colors[i * 4 + 2] = c.b * k;
    colors[i * 4 + 3] = alpha;
  }
  mesh.setVerticesData(VertexBuffer.ColorKind, colors);
  return mesh;
}

/** Placeholder shapes beyond the base schema. */
interface ExtraShapes {
  /**
   * `lathe`: profile [radius, y] points in unit space (radius 0..0.5, y -0.5..0.5), revolved
   * around the vertical axis and scaled by `size`. Walk the outer surface upwards and any inner
   * surface downwards (the surface faces the right-hand side of the walk); bends sharper than
   * 40 degrees get a hard edge.
   */
  profile?: [number, number][];
}

/** Surface of revolution from a profile (see `ExtraShapes.profile`), centred on the origin. */
function latheMesh(scene: Scene, profile: [number, number][], segments: number): Mesh {
  // Per profile point: one vertex ring (smooth) or two (hard edge), each with its 2D normal.
  const rings: { r: number; y: number; nr: number; ny: number }[][] = [];
  const segNormal = (a: [number, number], b: [number, number]): [number, number] => {
    const dr = b[0] - a[0];
    const dy = b[1] - a[1];
    const l = Math.hypot(dr, dy) || 1;
    return [dy / l, -dr / l];
  };
  for (let i = 0; i < profile.length; i++) {
    const [r, y] = profile[i];
    const prev = i > 0 ? segNormal(profile[i - 1], profile[i]) : null;
    const next = i < profile.length - 1 ? segNormal(profile[i], profile[i + 1]) : null;
    if (prev && next && prev[0] * next[0] + prev[1] * next[1] > Math.cos((40 * Math.PI) / 180)) {
      const nr = prev[0] + next[0];
      const ny = prev[1] + next[1];
      const l = Math.hypot(nr, ny) || 1;
      rings.push([{ r, y, nr: nr / l, ny: ny / l }]);
    } else {
      const a = prev ?? next!;
      const b = next ?? prev!;
      rings.push([{ r, y, nr: a[0], ny: a[1] }, { r, y, nr: b[0], ny: b[1] }]);
    }
  }
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  // Vertex rows: the incoming vertex of point i ends segment i-1, the outgoing one starts segment i.
  const rowStart: { in: number; out: number }[] = [];
  for (const ring of rings) {
    const starts: number[] = [];
    for (const v of ring) {
      starts.push(positions.length / 3);
      for (let k = 0; k <= segments; k++) {
        const a = (k / segments) * Math.PI * 2;
        const c = Math.cos(a);
        const s = Math.sin(a);
        positions.push(v.r * c, v.y, v.r * s);
        normals.push(v.nr * c, v.ny, v.nr * s);
      }
    }
    rowStart.push({ in: starts[0], out: starts[starts.length - 1] });
  }
  for (let i = 0; i < rings.length - 1; i++) {
    const a0 = rowStart[i].out;
    const b0 = rowStart[i + 1].in;
    for (let k = 0; k < segments; k++) {
      pushTri(positions, normals, indices, a0 + k, a0 + k + 1, b0 + k);
      pushTri(positions, normals, indices, a0 + k + 1, b0 + k + 1, b0 + k);
    }
  }
  const mesh = new Mesh('part', scene);
  const data = new VertexData();
  data.positions = positions;
  data.normals = normals;
  data.indices = indices;
  data.uvs = new Array((positions.length / 3) * 2).fill(0);
  data.applyToMesh(mesh, true);
  return mesh;
}

/** World-aligned planar UVs (metres) by dominant normal axis, so textures keep their scale. */
function boxProjectUVs(mesh: Mesh): void {
  const pos = mesh.getVerticesData(VertexBuffer.PositionKind);
  const nor = mesh.getVerticesData(VertexBuffer.NormalKind);
  if (!pos || !nor) return;
  const uvs = new Float32Array((pos.length / 3) * 2);
  for (let i = 0, j = 0; i < pos.length; i += 3, j += 2) {
    const ax = Math.abs(nor[i]);
    const ay = Math.abs(nor[i + 1]);
    const az = Math.abs(nor[i + 2]);
    if (ax >= ay && ax >= az) {
      uvs[j] = pos[i + 2];
      uvs[j + 1] = pos[i + 1];
    } else if (ay >= az) {
      uvs[j] = pos[i];
      uvs[j + 1] = pos[i + 2];
    } else {
      uvs[j] = pos[i];
      uvs[j + 1] = pos[i + 1];
    }
  }
  mesh.setVerticesData(VertexBuffer.UVKind, uvs);
}

/**
 * Box with rounded edges and corners (radius `r`), centred on the origin. Each face is a grid
 * whose outer rows are bent around the edge, so normals are smooth across the bevel.
 */
function roundedBox(scene: Scene, sx: number, sy: number, sz: number, r: number): Mesh {
  const half = [sx / 2, sy / 2, sz / 2];
  const radius = Math.max(0, Math.min(r, ...half.map((h) => h * 0.98)));
  const steps = radius > 0 ? 3 : 0;
  // Grid coordinates along one axis: the bevel band is subdivided, the flat middle is one span.
  const axis = (h: number): number[] => {
    if (steps === 0) return [-h, h];
    const inner = h - radius;
    const out: number[] = [];
    for (let i = 0; i <= steps; i++) out.push(-h + (radius * i) / steps);
    for (let i = 0; i <= steps; i++) out.push(inner + (radius * i) / steps);
    return out;
  };
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  const p = new Vector3();
  const inner = new Vector3();
  // Faces: [normal axis, sign, u axis, v axis]
  const faces: [number, number, number, number][] = [
    [0, 1, 2, 1],
    [0, -1, 2, 1],
    [1, 1, 0, 2],
    [1, -1, 0, 2],
    [2, 1, 0, 1],
    [2, -1, 0, 1],
  ];
  for (const [n, sign, ua, va] of faces) {
    const us = axis(half[ua]);
    const vs = axis(half[va]);
    const base = positions.length / 3;
    for (const v of vs) {
      for (const u of us) {
        const q = [0, 0, 0];
        q[n] = sign * half[n];
        q[ua] = u;
        q[va] = v;
        p.set(q[0], q[1], q[2]);
        const lim = half.map((h) => h - radius);
        inner.set(clamp(p.x, -lim[0], lim[0]), clamp(p.y, -lim[1], lim[1]), clamp(p.z, -lim[2], lim[2]));
        const d = p.subtract(inner);
        const len = d.length();
        if (radius > 0 && len > 1e-6) {
          d.scaleInPlace(1 / len);
          positions.push(inner.x + d.x * radius, inner.y + d.y * radius, inner.z + d.z * radius);
          normals.push(d.x, d.y, d.z);
        } else {
          const nn = [0, 0, 0];
          nn[n] = sign;
          positions.push(p.x, p.y, p.z);
          normals.push(nn[0], nn[1], nn[2]);
        }
      }
    }
    const w = us.length;
    for (let j = 0; j < vs.length - 1; j++) {
      for (let i = 0; i < w - 1; i++) {
        const a = base + j * w + i;
        const b = a + 1;
        const c = a + w;
        const e = c + 1;
        pushTri(positions, normals, indices, a, b, c);
        pushTri(positions, normals, indices, b, e, c);
      }
    }
  }
  const mesh = new Mesh('part', scene);
  const data = new VertexData();
  data.positions = positions;
  data.normals = normals;
  data.indices = indices;
  data.uvs = new Array((positions.length / 3) * 2).fill(0);
  data.applyToMesh(mesh, true);
  return mesh;
}

/**
 * Adds a triangle wound the way Babylon expects front faces: the same orientation that
 * `VertexData.ComputeNormals` derives, i.e. (a - b) x (c - b) points along the vertex normal.
 */
function pushTri(pos: number[], nor: number[], out: number[], a: number, b: number, c: number): void {
  const ax = pos[a * 3] - pos[b * 3];
  const ay = pos[a * 3 + 1] - pos[b * 3 + 1];
  const az = pos[a * 3 + 2] - pos[b * 3 + 2];
  const cx = pos[c * 3] - pos[b * 3];
  const cy = pos[c * 3 + 1] - pos[b * 3 + 1];
  const cz = pos[c * 3 + 2] - pos[b * 3 + 2];
  const fx = ay * cz - az * cy;
  const fy = az * cx - ax * cz;
  const fz = ax * cy - ay * cx;
  const nx = nor[a * 3] + nor[b * 3] + nor[c * 3];
  const ny = nor[a * 3 + 1] + nor[b * 3 + 1] + nor[c * 3 + 1];
  const nz = nor[a * 3 + 2] + nor[b * 3 + 2] + nor[c * 3 + 2];
  if (fx * nx + fy * ny + fz * nz >= 0) out.push(a, b, c);
  else out.push(a, c, b);
}

/** Lumpy sphere (foliage clumps, rocks): an icosphere displaced by smooth 3D noise. */
function blobMesh(scene: Scene, sx: number, sy: number, sz: number, amount: number, subdivisions: number, seed: number): Mesh {
  const mesh = MeshBuilder.CreateIcoSphere('part', { radius: 0.5, subdivisions, flat: false, updatable: true }, scene);
  const pos = mesh.getVerticesData(VertexBuffer.PositionKind)!;
  for (let i = 0; i < pos.length; i += 3) {
    const x = pos[i] * 2;
    const y = pos[i + 1] * 2;
    const z = pos[i + 2] * 2;
    const n = noise3(x * 1.7 + seed, y * 1.7, z * 1.7) * 0.7 + noise3(x * 3.9, y * 3.9 + seed, z * 3.9) * 0.3;
    const k = 1 + (n - 0.5) * 2 * amount;
    pos[i] = pos[i] * k * sx;
    pos[i + 1] = pos[i + 1] * k * sy;
    pos[i + 2] = pos[i + 2] * k * sz;
  }
  const normals: number[] = [];
  VertexData.ComputeNormals(pos, mesh.getIndices()!, normals);
  mesh.setVerticesData(VertexBuffer.PositionKind, pos);
  mesh.setVerticesData(VertexBuffer.NormalKind, normals);
  return mesh;
}

/** A neutral box when a model key is missing entirely. */
function fallbackParts([w, d]: [number, number]): PlaceholderPart[] {
  return [{ shape: 'box', size: [w * 0.8, 0.8, d * 0.8], at: [0, 0.4, 0], color: '#B8B2AA' }];
}

/** Optional model entry fields beyond the base schema (read defensively; see the file header). */
interface ModelExtras {
  /** Exact size [width x, height y, depth z] in metres after `rotationY`; replaces `scale`. */
  fit?: Vec3;
  /** With `fit`: `back` puts the back (-Z) of the model on the footprint's back edge instead of centring it. */
  align?: 'centre' | 'back';
  /** Restyles materials by glTF material name; `*` applies to every material not listed. */
  materials?: Record<string, MaterialOverride>;
  /** Extra placeholder primitives drawn with the model (in the final, fitted space). */
  parts?: PlaceholderPart[];
}

interface MaterialOverride {
  /** Replace with a game finish (`material.finish.*`) coloured by `color` (default: the file's colour). */
  finish?: string;
  /** sRGB hex: the finish colour, or (without `finish`) a multiplier on the file's base colour. */
  color?: string;
  roughness?: number;
  metallic?: number;
  /** Drop the meshes that use this material. */
  hide?: boolean;
}

async function loadGltf(scene: Scene, name: string, entry: ModelEntry): Promise<ModelTemplate> {
  const extras = entry as ModelEntry & ModelExtras;
  const result = await ImportMeshAsync(entry.url!, scene);
  const fit = extras.fit;
  const s = fit ? 1 : (entry.scale ?? 1);
  const [ox, oy, oz] = entry.offset ?? [0, 0, 0];
  const extra = Matrix.Compose(
    new Vector3(s, s, s),
    Quaternion.RotationAxis(Vector3.Up(), ((entry.rotationY ?? 0) * Math.PI) / 180),
    fit ? Vector3.Zero() : new Vector3(ox, oy, oz),
  );
  const overrides = extras.materials ?? {};
  const overrideFor = (m: Material | null): MaterialOverride | undefined => (m && overrides[m.name]) ?? overrides['*'];

  const lib = MaterialLibrary.for(scene);
  const baked: Mesh[] = [];
  for (const node of result.meshes) {
    if (!(node instanceof Mesh) || node.getTotalVertices() === 0) continue;
    if (overrideFor(node.material)?.hide) continue;
    // Bake the full hierarchy transform so thin-instance matrices place the model directly.
    const world = node.computeWorldMatrix(true).multiply(extra);
    node.setParent(null);
    node.position.setAll(0);
    node.rotationQuaternion = null;
    node.rotation.setAll(0);
    node.scaling.setAll(1);
    bakeFoliageCards(node, world);
    node.bakeTransformIntoVertices(world);
    node.refreshBoundingInfo();
    node.name = name;
    baked.push(node);
  }
  if (fit && baked.length) fitInto(baked, fit, extras.align ?? 'centre', [ox, oy, oz]);

  const groups = new PartGroups(scene);
  const kept: Mesh[] = [];
  const tinted = new Set<Material>();
  let height = 0;
  for (const node of baked) {
    height = Math.max(height, node.getBoundingInfo().boundingBox.maximum.y);
    const ov = overrideFor(node.material);
    if (ov?.finish) {
      groups.add(restyledMesh(scene, node, ov, groups.finish(ov.finish).alpha), null, groups.finish(ov.finish).group, null);
      continue;
    }
    const mat = node.material;
    if (ov && mat instanceof PBRMaterial && !tinted.has(mat)) {
      tinted.add(mat);
      if (ov.color) mat.albedoColor = mat.albedoColor.multiply(Color3.FromHexString(ov.color).toLinearSpace());
      if (ov.roughness !== undefined) mat.roughness = ov.roughness;
      if (ov.metallic !== undefined) mat.metallic = ov.metallic;
    }
    lib.adopt(mat);
    kept.push(node);
  }
  extras.parts?.forEach((part, i) => groups.addPart(part, 0, i));
  height = Math.max(height, groups.height);

  // Everything not kept (hierarchy nodes, hidden or restyled meshes, their unused materials) goes.
  const used = new Set(kept.map((m) => m.material));
  const unusedMaterials = new Set<Material>();
  for (const node of result.meshes) if (node.material && !used.has(node.material)) unusedMaterials.add(node.material);
  for (const node of [...result.transformNodes, ...result.meshes]) {
    if (!kept.includes(node as Mesh)) node.dispose(true);
  }
  for (const m of unusedMaterials) m.dispose(false, true);
  for (const group of result.animationGroups) group.dispose();

  const merged = mergeByMaterial(kept, name);
  const restyled = groups.build(name);
  return {
    meshes: [...merged, ...restyled.meshes],
    tints: [...merged.map(() => null), ...restyled.tints],
    bones: [...merged.map(() => null), ...restyled.bones],
    height,
  };
}

/** Scales and moves baked meshes so their joint bounds fill `size`, bottom on y = 0. */
function fitInto(meshes: Mesh[], [w, h, d]: Vec3, align: 'centre' | 'back', [ox, oy, oz]: Vec3): void {
  const min = new Vector3(Infinity, Infinity, Infinity);
  const max = new Vector3(-Infinity, -Infinity, -Infinity);
  for (const m of meshes) {
    const b = m.getBoundingInfo().boundingBox;
    min.minimizeInPlace(b.minimum);
    max.maximizeInPlace(b.maximum);
  }
  const ext = max.subtract(min);
  const sx = w / Math.max(ext.x, 1e-6);
  const sy = h / Math.max(ext.y, 1e-6);
  const sz = d / Math.max(ext.z, 1e-6);
  const cx = (min.x + max.x) / 2;
  const cz = align === 'back' ? min.z : (min.z + max.z) / 2;
  const tz = align === 'back' ? -0.5 + oz : oz;
  const m = Matrix.Scaling(sx, sy, sz).multiply(Matrix.Translation(ox - cx * sx, oy - min.y * sy, tz - cz * sz));
  for (const mesh of meshes) {
    bakeFoliageCards(mesh, m);
    mesh.bakeTransformIntoVertices(m);
    mesh.refreshBoundingInfo();
  }
}

/**
 * A copy of a baked glTF mesh in placeholder form (positions, normals, metre UVs, vertex colour
 * carrying the finish), so it merges with placeholder parts of the same finish.
 */
function restyledMesh(scene: Scene, node: Mesh, ov: MaterialOverride, alpha: number): Mesh {
  const positions = node.getVerticesData(VertexBuffer.PositionKind)!;
  const indices = node.getIndices() ?? Array.from({ length: positions.length / 3 }, (_, i) => i);
  let normals = node.getVerticesData(VertexBuffer.NormalKind);
  if (!normals) {
    normals = new Float32Array(positions.length);
    VertexData.ComputeNormals(positions, indices, normals);
  }
  // The source winding depends on the file's handedness and the baked transform; re-wind every
  // triangle to match its vertex normals the way the finish materials expect (see `pushTri`).
  const pos = Array.from(positions);
  const nor = Array.from(normals);
  const wound: number[] = [];
  for (let i = 0; i + 2 < indices.length; i += 3) pushTri(pos, nor, wound, indices[i], indices[i + 1], indices[i + 2]);
  const mesh = new Mesh('part', scene);
  const data = new VertexData();
  data.positions = Float32Array.from(positions);
  data.normals = Float32Array.from(normals);
  data.indices = Uint32Array.from(wound);
  data.uvs = new Float32Array((positions.length / 3) * 2);
  data.applyToMesh(mesh, true);
  boxProjectUVs(mesh);
  const mat = node.material;
  const c = ov.color ? Color3.FromHexString(ov.color) : mat instanceof PBRMaterial ? mat.albedoColor.toGammaSpace() : Color3.White();
  const count = positions.length / 3;
  const colors = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) colors.set([c.r, c.g, c.b, alpha], i * 4);
  mesh.setVerticesData(VertexBuffer.ColorKind, colors);
  mesh.refreshBoundingInfo();
  return mesh;
}

/** One mesh (draw call) per material: glTF files often split a model into several nodes. */
function mergeByMaterial(meshes: Mesh[], name: string): Mesh[] {
  const byMaterial = Map.groupBy(meshes, (m) => m.material);
  const out: Mesh[] = [];
  for (const group of byMaterial.values()) {
    if (group.length === 1) {
      out.push(group[0]);
      continue;
    }
    try {
      const merged = Mesh.MergeMeshes(group, true, true);
      if (merged) {
        merged.name = name;
        out.push(merged);
        continue;
      }
    } catch (err) {
      console.warn(`[render] could not merge parts of ${name}`, err);
    }
    out.push(...group.filter((m) => !m.isDisposed()));
  }
  return out;
}

/**
 * The natural variation of a placed plant (manifest `vary`): its own turn (radians) and size,
 * fixed by the tile it stands on so it looks the same after a reload. None when `vary` is 0.
 */
export function placementVariation(vary: number, x: number, z: number): { turn: number; size: number } {
  if (!vary) return { turn: 0, size: 1 };
  return { turn: hash3(x, z, 101) * Math.PI * 2, size: 1 + (hash3(x, z, 102) * 2 - 1) * vary };
}

// ---- small math helpers -------------------------------------------------------------

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function smoothstep(a: number, b: number, x: number): number {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

function hash3(x: number, y: number, z: number): number {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(z, 1440662683)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Smooth value noise in [0, 1]. */
function noise3(x: number, y: number, z: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const fx = x - xi;
  const fy = y - yi;
  const fz = z - zi;
  const u = fx * fx * (3 - 2 * fx);
  const v = fy * fy * (3 - 2 * fy);
  const w = fz * fz * (3 - 2 * fz);
  const l = (a: number, b: number, t: number) => a + (b - a) * t;
  const c = (dx: number, dy: number, dz: number) => hash3(xi + dx, yi + dy, zi + dz);
  return l(
    l(l(c(0, 0, 0), c(1, 0, 0), u), l(c(0, 1, 0), c(1, 1, 0), u), v),
    l(l(c(0, 0, 1), c(1, 0, 1), u), l(c(0, 1, 1), c(1, 1, 1), u), v),
    w,
  );
}
