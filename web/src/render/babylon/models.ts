/**
 * Builds renderable templates from asset entries: glTF files when provided,
 * otherwise placeholder primitives from the manifest. Each template is drawn
 * with thin instances (one draw call per mesh, however many copies exist).
 *
 * Placeholder parts are merged per (tint slot, finish) so a model costs one draw call per
 * distinct finish. Boxes get rounded edges so they catch highlights; every part gets
 * metre-scale UVs so textured finishes (fabric, wood, bark) tile at a realistic density.
 */

import {
  Color3,
  ImportMeshAsync,
  Matrix,
  Mesh,
  MeshBuilder,
  Quaternion,
  Vector3,
  VertexBuffer,
  VertexData,
  type Scene,
} from '@babylonjs/core';
import '@babylonjs/loaders/glTF';
import type { ModelEntry, PlaceholderPart } from '../../assets/types';
import { DEFAULT_FINISH, MaterialLibrary } from './materials';

export type TintSlot = NonNullable<PlaceholderPart['tint']>;

export interface ModelTemplate {
  /** Meshes in model space; each receives the same instance matrices. */
  meshes: Mesh[];
  /** Per mesh: which `look` colour tints it, or null for none. */
  tints: (TintSlot | null)[];
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
  const lib = MaterialLibrary.for(scene);
  const groups = new Map<string, { tint: TintSlot | null; finish: string; meshes: Mesh[] }>();
  let height = 0;
  parts.forEach((part, index) => {
    const mesh = partMesh(scene, part, lod, index);
    height = Math.max(height, part.at[1] + part.size[1] / 2);
    const tint = part.tint ?? null;
    const finish = part.material ?? DEFAULT_FINISH;
    const key = `${tint ?? ''}|${finish}`;
    const group = groups.get(key) ?? { tint, finish, meshes: [] };
    group.meshes.push(mesh);
    groups.set(key, group);
  });
  const meshes: Mesh[] = [];
  const tints: (TintSlot | null)[] = [];
  for (const { tint, finish, meshes: group } of groups.values()) {
    const merged = group.length === 1 ? group[0] : Mesh.MergeMeshes(group, true, true);
    if (!merged) continue;
    const suffix = finish === DEFAULT_FINISH ? '' : `@${finish.replace('material.finish.', '')}`;
    merged.name = `${name}${tint ? `:${tint}` : ''}${suffix}`;
    merged.material = lib.finish(finish);
    meshes.push(merged);
    tints.push(tint);
  }
  return { meshes, tints, height };
}

function partMesh(scene: Scene, p: PlaceholderPart, lod: 0 | 1, index: number): Mesh {
  const [sx, sy, sz] = p.size;
  const lo = lod === 1;
  let mesh: Mesh;
  let shade: ((nx: number, ny: number, nz: number) => number) | null = null;
  switch (p.shape) {
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
  const normals = shade ? mesh.getVerticesData(VertexBuffer.NormalKind) : null;
  const positions = shade ? mesh.getVerticesData(VertexBuffer.PositionKind) : null;
  for (let i = 0; i < count; i++) {
    let k = 1;
    if (shade && normals && positions) {
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
    colors[i * 4 + 3] = 1;
  }
  mesh.setVerticesData(VertexBuffer.ColorKind, colors);
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

async function loadGltf(scene: Scene, name: string, entry: ModelEntry): Promise<ModelTemplate> {
  const result = await ImportMeshAsync(entry.url!, scene);
  const s = entry.scale ?? 1;
  const [ox, oy, oz] = entry.offset ?? [0, 0, 0];
  const extra = Matrix.Compose(
    new Vector3(s, s, s),
    Quaternion.RotationAxis(Vector3.Up(), ((entry.rotationY ?? 0) * Math.PI) / 180),
    new Vector3(ox, oy, oz),
  );

  const lib = MaterialLibrary.for(scene);
  const meshes: Mesh[] = [];
  let height = 0;
  for (const node of result.meshes) {
    if (!(node instanceof Mesh) || node.getTotalVertices() === 0) continue;
    // Bake the full hierarchy transform so thin-instance matrices place the model directly.
    const world = node.computeWorldMatrix(true).multiply(extra);
    node.setParent(null);
    node.position.setAll(0);
    node.rotationQuaternion = null;
    node.rotation.setAll(0);
    node.scaling.setAll(1);
    node.bakeTransformIntoVertices(world);
    node.refreshBoundingInfo();
    node.name = name;
    lib.adopt(node.material);
    height = Math.max(height, node.getBoundingInfo().boundingBox.maximum.y);
    meshes.push(node);
  }
  for (const node of [...result.transformNodes, ...result.meshes]) {
    if (!meshes.includes(node as Mesh)) node.dispose(true);
  }
  for (const group of result.animationGroups) group.dispose();
  const merged = mergeByMaterial(meshes, name);
  return { meshes: merged, tints: merged.map(() => null), height };
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
