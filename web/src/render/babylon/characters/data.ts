/**
 * Loads a character set (`rig.json` + binaries, built by `tools/characters/build.py`):
 * one shared skeleton, per-body meshes / rest pose / retarget constants, and animation clips.
 *
 * Space: Babylon's left-handed world, y up, characters face +z (the build mirrors glTF in x).
 * Quaternions are (x, y, z, w); matrices are column-major (Babylon's array layout).
 */

import { optimizedUrl } from '../../../assets/registry';

export interface MeshPart {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  indices: Uint16Array;
  /** Bone indices / weights (4 per vertex) as floats, as Babylon's skinning attributes expect. */
  joints: Float32Array;
  weights: Float32Array;
  /**
   * Per-vertex shader fields (4 per vertex): body = sleeve parameter, height, crew / scoop neckline
   * distances (clothes coverage); garments = hem distance, part flag, category; hair = distance
   * from the strand tips' edge. See tools/characters/garments.py.
   */
  fields: Float32Array;
  min: [number, number, number];
  max: [number, number, number];
}

export interface BodyData {
  name: string;
  /** Height of the mesh in metres (top of the head). */
  height: number;
  restT: Float32Array;
  restQ: Float32Array;
  inverseBind: Float32Array;
  /** Retarget: target local = pre * source local * post (per bone). */
  pre: Float32Array;
  post: Float32Array;
  /** Pelvis translation scale from the animation skeleton to this body. */
  pelvisScale: number;
  /** Median skin albedo (linear RGB) of the texture; Sim skin colours tint relative to it. */
  skinRef: [number, number, number];
  parts: Map<string, MeshPart>;
  textures: { albedo: string; normal: string; folds: string };
  /** Clothing variants (part name -> body coverage cuts, see garments.py `variants`). */
  garments: Record<string, GarmentCut>;
}

/** Coverage cuts of a garment variant (metres; sleeve is the arm parameter). */
export interface GarmentCut {
  sleeve?: number;
  hem?: number;
  crew?: number;
  scoop?: number;
  waist?: number;
  leg?: number;
  shoe?: number;
  skirt?: boolean;
}

export interface Clip {
  name: string;
  frames: number;
  loop: boolean;
  /** frames * clipBones * 4, int16-normalised quaternions (source skeleton local rotations). */
  q: Int16Array;
  /** frames * 3 pelvis translations (source skeleton). */
  pelvis: Float32Array;
  /** Ground speed of the planted foot (m/s, source scale) for locomotion clips. */
  speed: number;
  /** Duration in seconds (loops: frames / fps). */
  duration: number;
}

export interface CharacterSet {
  url: string;
  bones: string[];
  /** Bones stored in clips (the rest, the face bones, stay at rest and are animated procedurally). */
  clipBones: number;
  /** Face bones (eyes, lids, jaw, lips, brows) and the lids' rest margins (degrees). */
  face: { bones: string[]; upperOpen: number; lowerOpen: number };
  parents: Int32Array;
  bone: Record<string, number>;
  head: number;
  /** 1 for the head bone and every bone under it (the face), else 0. */
  inHead: Uint8Array;
  fps: number;
  sourcePelvis: [number, number, number];
  /** Rest pose (local rotations) of the animation skeleton. */
  sourceRestQ: Float32Array;
  bodies: Map<string, BodyData>;
  clips: Map<string, Clip>;
  /** Texture base name per hairstyle (`hair1`, `hair2`). */
  hairTextures: Record<string, string>;
  /** Resolves a file name of the set to a URL. */
  file(name: string): string;
}

interface RigJson {
  bones: string[];
  clipBones?: number;
  fieldScale?: number;
  face?: { bones: string[]; upperOpen: number; lowerOpen: number };
  parents: number[];
  head: number;
  fps: number;
  sourcePelvis: [number, number, number];
  sourceRestQ: number[];
  anims: string;
  hairTextures: Record<string, string>;
  clips: Record<
    string,
    {
      frames: number;
      loop: boolean;
      offset: number;
      pelvisOffset: number;
      speed?: number;
    }
  >;
  bodies: Record<
    string,
    {
      mesh: string;
      height: number;
      restT: number[];
      restQ: number[];
      inverseBind: number[];
      pre: number[];
      post: number[];
      pelvisScale: number;
      skinRef: [number, number, number];
      textures: { albedo: string; normal: string; folds: string };
      garments?: Record<string, GarmentCut>;
      parts: Record<
        string,
        {
          vertices: number;
          indices: number;
          positions: number;
          normals: number;
          uvs: number;
          joints: number;
          weights: number;
          fields?: number;
          index: number;
          min: [number, number, number];
          max: [number, number, number];
        }
      >;
    }
  >;
}

const cache = new Map<string, Promise<CharacterSet>>();

/** Loads (once per URL) a character set. */
export function loadCharacterSet(url: string): Promise<CharacterSet> {
  let p = cache.get(url);
  if (!p) {
    p = load(url);
    cache.set(url, p);
    p.catch(() => cache.delete(url));
  }
  return p;
}

async function fetchOk(url: string): Promise<Response> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res;
}

/**
 * A binary of the set: the build's gzipped copy when there is one (hosts rarely compress .bin;
 * the browser inflates it), else the file itself.
 */
async function fetchBinary(url: string): Promise<ArrayBuffer> {
  const copy = optimizedUrl(url);
  if (copy !== url) {
    try {
      const bytes = await (await fetchOk(copy)).arrayBuffer();
      // A server may have unpacked it already (Content-Encoding): only inflate real gzip data.
      const head = new Uint8Array(bytes, 0, 2);
      if (head[0] !== 0x1f || head[1] !== 0x8b) return bytes;
      return await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
    } catch (err) {
      console.warn(`[render] compressed ${copy} failed, loading ${url}`, err);
    }
  }
  return (await fetchOk(url)).arrayBuffer();
}

async function load(url: string): Promise<CharacterSet> {
  const base = new URL(url, location.href);
  const file = (name: string) => new URL(name, base).href;
  const rig = (await (await fetchOk(base.href)).json()) as RigJson;
  const NB = rig.bones.length;
  const CB = rig.clipBones ?? NB;
  const fieldScale = 1 / (rig.fieldScale ?? 4000);
  const [animBuf, ...meshBufs] = await Promise.all([fetchBinary(file(rig.anims)), ...Object.values(rig.bodies).map((b) => fetchBinary(file(b.mesh)))]);

  const clips = new Map<string, Clip>();
  for (const [name, c] of Object.entries(rig.clips)) {
    clips.set(name, {
      name,
      frames: c.frames,
      loop: c.loop,
      q: new Int16Array(animBuf, c.offset, c.frames * CB * 4),
      pelvis: new Float32Array(animBuf, c.pelvisOffset, c.frames * 3),
      speed: c.speed ?? 0,
      duration: (c.loop ? c.frames : c.frames - 1) / rig.fps,
    });
  }

  const bodies = new Map<string, BodyData>();
  Object.entries(rig.bodies).forEach(([name, b], i) => {
    const buf = meshBufs[i];
    const parts = new Map<string, MeshPart>();
    for (const [partName, p] of Object.entries(b.parts)) {
      const n = p.vertices;
      const nrm16 = new Int16Array(buf, p.normals, n * 4);
      const normals = new Float32Array(n * 3);
      for (let v = 0; v < n; v++) {
        normals[v * 3] = nrm16[v * 4] / 32767;
        normals[v * 3 + 1] = nrm16[v * 4 + 1] / 32767;
        normals[v * 3 + 2] = nrm16[v * 4 + 2] / 32767;
      }
      const j8 = new Uint8Array(buf, p.joints, n * 4);
      const w8 = new Uint8Array(buf, p.weights, n * 4);
      const joints = new Float32Array(n * 4);
      const weights = new Float32Array(n * 4);
      for (let k = 0; k < n * 4; k++) {
        joints[k] = j8[k];
        weights[k] = w8[k] / 255;
      }
      const fields = new Float32Array(n * 4);
      if (p.fields !== undefined) {
        const f16 = new Int16Array(buf, p.fields, n * 4);
        for (let k = 0; k < n * 4; k++) fields[k] = f16[k] * fieldScale;
      }
      parts.set(partName, {
        positions: new Float32Array(buf, p.positions, n * 3),
        normals,
        uvs: new Float32Array(buf, p.uvs, n * 2),
        indices: new Uint16Array(buf, p.index, p.indices),
        joints,
        weights,
        fields,
        min: p.min,
        max: p.max,
      });
    }
    bodies.set(name, {
      name,
      height: b.height,
      restT: Float32Array.from(b.restT),
      restQ: Float32Array.from(b.restQ),
      inverseBind: Float32Array.from(b.inverseBind),
      pre: Float32Array.from(b.pre),
      post: Float32Array.from(b.post),
      pelvisScale: b.pelvisScale,
      skinRef: b.skinRef,
      parts,
      textures: b.textures,
      garments: b.garments ?? {},
    });
  });

  const bone: Record<string, number> = {};
  rig.bones.forEach((n, i) => (bone[n] = i));
  return {
    url: base.href,
    bones: rig.bones,
    clipBones: CB,
    face: rig.face ?? { bones: [], upperOpen: 17, lowerOpen: -27 },
    parents: Int32Array.from(rig.parents),
    bone,
    head: rig.head,
    inHead: headBones(rig.parents, rig.head),
    fps: rig.fps,
    sourcePelvis: rig.sourcePelvis,
    sourceRestQ: Float32Array.from(rig.sourceRestQ),
    bodies,
    clips,
    hairTextures: rig.hairTextures,
    file,
  };
}

/** Marks the head bone and its descendants (parents come before children in the rig). */
function headBones(parents: readonly number[], head: number): Uint8Array {
  const out = new Uint8Array(parents.length);
  for (let b = 0; b < parents.length; b++) out[b] = b === head || (parents[b] >= 0 && out[parents[b]] === 1) ? 1 : 0;
  return out;
}
