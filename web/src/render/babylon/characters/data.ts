/**
 * Loads a character set (`rig.json` + binaries, built by `tools/characters/build_mpfb.py`):
 * one shared skeleton, per-body meshes / rest pose / retarget constants, animation clips and the
 * face morphs (see `MorphSet`).
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
   * distances (clothes coverage; on the head, crew = -1 - scalp weight); garments = 1, 0, category
   * (top, bottom, shoes); hair = distance from the strand tips' edge. See tools/characters/garments.py
   * and clothes.py.
   */
  fields: Float32Array;
  /**
   * Face morphs (4 per vertex, null if no morph moves this part): x = the part's block in the
   * morph texture (texel index; -1 for vertices no morph moves), y = the vertex's slot in the block,
   * z = slots in the block.
   */
  morph: Float32Array | null;
  min: [number, number, number];
  max: [number, number, number];
}

/**
 * Face morphs of the whole set in one half-float RGBA texture (`width` texels per row). Each part's
 * block starts with `headerTexels` texels holding, per channel, its index among the channels that
 * move the part (-1: none); then per such channel and slot two texels: position delta, normal delta.
 */
export interface MorphSet {
  /** Channel names: the 15 visemes (voice engine order), then ARKit face units. */
  channels: string[];
  channel: Record<string, number>;
  headerTexels: number;
  width: number;
  height: number;
  /** Half floats (RGBA). */
  data: Uint16Array;
}

export interface BodyData {
  /** `female`, `male`, or a life stage of one (`female.child`). */
  name: string;
  /** The base body this one shares materials, skeleton and clothes cuts with (its own name for a base). */
  family: string;
  /** Life stage this body is shaped for (content `life.stages` id). */
  stage: string;
  /** Height of the mesh in metres (top of the head). */
  height: number;
  /** Top of the head above the head joint (m, bind pose). */
  headAbove: number;
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
  textures: { albedo: string; normal?: string; brows?: string };
  /** Clothing variants (part name -> body coverage cuts, see garments.py `variants`). */
  garments: Record<string, GarmentCut>;
  /** Other life stages of a base body, loaded on demand (`loadStage`). */
  stages: Record<string, StageJson>;
  /**
   * The body's skin in chunks (part name -> the garments that hide it completely; `body` is never
   * hidden): a Sim draws the chunks its clothes leave visible.
   */
  bodyChunks: Record<string, string[]>;
  /** Parts loaded on demand (`loadPart`): their binary and layout, and their face morph slots. */
  lazy: Record<string, Omit<PartJson, 'morph'> & { mesh: string; slots: Float32Array | null }>;
  /** A life stage's binary (position deltas and normals of every part, for parts loaded later). */
  stageData: ArrayBuffer | null;
}

/** A life stage's shape of a base body: per part position deltas and normals, and its skeleton. */
export interface StageJson {
  mesh: string;
  height: number;
  restT: number[];
  restQ: number[];
  inverseBind: number[];
  pre: number[];
  post: number[];
  pelvisScale: number;
  parts: Record<string, { positions: number; normals: number }>;
  /** The stage's own skin texture (MakeHuman's middle-aged and old skins) and its median colour. */
  textures?: { albedo: string };
  skinRef?: [number, number, number];
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
  /** Face bones (the eyes; the rest of the face is morphs). */
  face: { bones: string[] };
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
  /** Shared face textures (eyes, lashes, teeth, tongue). */
  textures: Record<string, string>;
  /** Hairstyles drawn as alpha-tested cards (MakeHuman's), with their texture. */
  hairCards: Record<string, string>;
  /** The clothes' texture atlas: greyscale detail (tops, bottoms) and colour (shoes), normals. */
  cloth: { albedo: string; normal: string };
  /** Stage position deltas: int16 per metre. */
  stageScale: number;
  /** Field values: int16 per unit. */
  fieldScale: number;
  morphs: MorphSet | null;
  /** Resolves a file name of the set to a URL. */
  file(name: string): string;
}

interface RigJson {
  bones: string[];
  clipBones?: number;
  fieldScale?: number;
  face?: { bones: string[] };
  parents: number[];
  head: number;
  fps: number;
  sourcePelvis: [number, number, number];
  sourceRestQ: number[];
  anims: string;
  hairTextures: Record<string, string>;
  textures?: Record<string, string>;
  hairCards?: Record<string, string>;
  cloth: { albedo: string; normal: string };
  stageScale?: number;
  morphs?: { channels: string[]; scale: number; normalScale: number };
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
      textures: { albedo: string; normal?: string; brows?: string };
      garments?: Record<string, GarmentCut>;
      stage?: string;
      stages?: Record<string, StageJson>;
      bodyChunks?: Record<string, string[]>;
      parts: Record<string, PartJson>;
      lazyParts?: Record<string, PartJson & { mesh: string }>;
    }
  >;
}

/** A mesh part in a binary (byte offsets; geometry missing for parts that load on demand). */
interface PartJson {
  vertices: number;
  indices: number;
  positions?: number;
  normals?: number;
  uvs?: number;
  joints?: number;
  weights?: number;
  fields?: number;
  index?: number;
  morph?: PartMorph;
  min: [number, number, number];
  max: [number, number, number];
}

/** A part's face morphs in the mesh binary (see `write_parts` in tools/characters/common.py). */
interface PartMorph {
  count: number;
  /** Entries of channel c: ranges[c] .. ranges[c + 1]. */
  ranges: number[];
  morphVerts: number;
  morphSlots: number;
  morphPositions: number;
  morphNormals: number;
}

const MORPH_WIDTH = 2048;

/** Height of bone `b`'s joint in the bind pose, from its inverse bind matrix (column-major, rigid). */
function jointY(inverseBind: ArrayLike<number>, b: number): number {
  const m = b * 16;
  const i = (k: number) => inverseBind[m + k];
  return -(i(4) * i(12) + i(5) * i(13) + i(6) * i(14));
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

  // Face morphs: lay out every part's block first, then fill the texture.
  const channels = rig.morphs?.channels ?? [];
  const C = channels.length;
  const headerTexels = Math.ceil(C / 4);
  const blocks: { buf: ArrayBuffer; m: PartMorph; base: number; local: Int32Array }[] = [];
  let texels = 0;

  const bodies = new Map<string, BodyData>();
  Object.entries(rig.bodies).forEach(([name, b], i) => {
    const buf = meshBufs[i];
    const parts = new Map<string, MeshPart>();
    const pending = new Map<string, Float32Array>();
    for (const [partName, p] of Object.entries(b.parts)) {
      const n = p.vertices;
      // Parts whose geometry loads on demand (hair) list only their morphs here.
      const part = p.positions !== undefined ? readPart(buf, p, fieldScale) : null;
      const m = p.morph;
      if (m && C > 0) {
        // Channels that move this part get consecutive block indices.
        const local = new Int32Array(C).fill(-1);
        let used = 0;
        for (let c = 0; c < C; c++) if (m.ranges[c + 1] > m.ranges[c]) local[c] = used++;
        const base = texels;
        texels += headerTexels + used * m.count * 2;
        const verts = new Uint16Array(buf, m.morphVerts, m.count);
        const attr = new Float32Array(n * 4);
        for (let v = 0; v < n; v++) attr[v * 4] = -1;
        for (let s = 0; s < m.count; s++) {
          const o = verts[s] * 4;
          attr[o] = base;
          attr[o + 1] = s;
          attr[o + 2] = m.count;
        }
        if (part) part.morph = attr;
        else pending.set(partName, attr);
        blocks.push({ buf, m, base, local });
      }
      if (part) parts.set(partName, part);
    }
    bodies.set(name, {
      name,
      family: name,
      stage: b.stage ?? '',
      height: b.height,
      headAbove: b.height - jointY(b.inverseBind, rig.head),
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
      stages: b.stages ?? {},
      bodyChunks: b.bodyChunks ?? { body: [] },
      lazy: Object.fromEntries(Object.entries(b.lazyParts ?? {}).map(([k, e]) => [k, { ...e, slots: pending.get(k) ?? null }])),
      stageData: null,
    });
  });

  let morphs: MorphSet | null = null;
  if (blocks.length) {
    const height = Math.ceil(texels / MORPH_WIDTH);
    const data = new Uint16Array(MORPH_WIDTH * height * 4);
    const ps = 1 / rig.morphs!.scale;
    const ns = 1 / rig.morphs!.normalScale;
    for (const { buf, m, base, local } of blocks) {
      for (let c = 0; c < C; c++) data[(base + (c >> 2)) * 4 + (c & 3)] = toHalf(local[c]);
      const slots = new Uint16Array(buf, m.morphSlots, m.ranges[C]);
      const dp = new Int16Array(buf, m.morphPositions, m.ranges[C] * 4);
      const dn = new Int8Array(buf, m.morphNormals, m.ranges[C] * 4);
      for (let c = 0; c < C; c++) {
        if (local[c] < 0) continue;
        const start = base + headerTexels + local[c] * m.count * 2;
        for (let e = m.ranges[c]; e < m.ranges[c + 1]; e++) {
          const t = (start + slots[e] * 2) * 4;
          data[t] = toHalf(dp[e * 4] * ps);
          data[t + 1] = toHalf(dp[e * 4 + 1] * ps);
          data[t + 2] = toHalf(dp[e * 4 + 2] * ps);
          data[t + 4] = toHalf(dn[e * 4] * ns);
          data[t + 5] = toHalf(dn[e * 4 + 1] * ns);
          data[t + 6] = toHalf(dn[e * 4 + 2] * ns);
        }
      }
    }
    const channel: Record<string, number> = {};
    channels.forEach((c, i) => (channel[c] = i));
    morphs = { channels, channel, headerTexels, width: MORPH_WIDTH, height, data };
  }

  const bone: Record<string, number> = {};
  rig.bones.forEach((n, i) => (bone[n] = i));
  return {
    url: base.href,
    bones: rig.bones,
    clipBones: CB,
    face: rig.face ?? { bones: [] },
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
    textures: rig.textures ?? {},
    hairCards: rig.hairCards ?? {},
    cloth: rig.cloth,
    stageScale: rig.stageScale ?? 5000,
    fieldScale: rig.fieldScale ?? 4000,
    morphs,
    file,
  };
}

/** A mesh part's geometry from a binary (see `write_parts` in tools/characters/common.py). */
function readPart(buf: ArrayBuffer, p: Omit<PartJson, 'morph'>, fieldScale: number): MeshPart {
  const n = p.vertices;
  const nrm16 = new Int16Array(buf, p.normals!, n * 4);
  const normals = new Float32Array(n * 3);
  for (let v = 0; v < n; v++) {
    normals[v * 3] = nrm16[v * 4] / 32767;
    normals[v * 3 + 1] = nrm16[v * 4 + 1] / 32767;
    normals[v * 3 + 2] = nrm16[v * 4 + 2] / 32767;
  }
  const j8 = new Uint8Array(buf, p.joints!, n * 4);
  const w8 = new Uint8Array(buf, p.weights!, n * 4);
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
  return {
    positions: new Float32Array(buf, p.positions!, n * 3),
    normals,
    uvs: new Float32Array(buf, p.uvs!, n * 2),
    indices: new Uint16Array(buf, p.index!, p.indices),
    joints,
    weights,
    fields,
    morph: null,
    min: p.min,
    max: p.max,
  };
}

/** A base part reshaped for a life stage from the stage's binary (position deltas, normals). */
function stagePart(set: CharacterSet, part: MeshPart, buf: ArrayBuffer, e: { positions: number; normals: number }): MeshPart {
  const inv = 1 / set.stageScale;
  const n = part.positions.length / 3;
  const d = new Int16Array(buf, e.positions, n * 4);
  const nr = new Int8Array(buf, e.normals, n * 4);
  const positions = new Float32Array(n * 3);
  const normals = new Float32Array(n * 3);
  for (let v = 0; v < n; v++) {
    for (let k = 0; k < 3; k++) {
      positions[v * 3 + k] = part.positions[v * 3 + k] + d[v * 4 + k] * inv;
      normals[v * 3 + k] = nr[v * 4 + k] / 127;
    }
  }
  return { ...part, positions, normals };
}

const partLoads = new Map<string, Promise<MeshPart | null>>();

/**
 * Part `name` of `body`, loading it first if it loads on demand (hairstyles): from its own binary
 * for a base body, reshaped from the stage's binary for a life stage. Null if the body has no such part.
 */
export function loadPart(set: CharacterSet, body: BodyData, name: string): Promise<MeshPart | null> {
  const have = body.parts.get(name);
  if (have) return Promise.resolve(have);
  const key = `${set.url}#${body.name}:${name}`;
  let p = partLoads.get(key);
  if (!p) {
    const base = set.bodies.get(body.family) ?? body;
    if (body !== base) {
      p = loadPart(set, base, name).then((part) => {
        const e = base.stages[body.stage]?.parts[name];
        if (!part || !e || !body.stageData) return part;
        const shaped = stagePart(set, part, body.stageData, e);
        body.parts.set(name, shaped);
        return shaped;
      });
    } else {
      const lazy = base.lazy[name];
      if (!lazy) return Promise.resolve(null);
      p = fetchBinary(set.file(lazy.mesh)).then((buf) => {
        const part = readPart(buf, lazy, 1 / set.fieldScale);
        part.morph = lazy.slots;
        base.parts.set(name, part);
        return part;
      });
    }
    p.catch(() => partLoads.delete(key));
    partLoads.set(key, p);
  }
  return p;
}

const stageLoads = new Map<string, Promise<BodyData | null>>();

/**
 * A base body at another life stage (`female` as a `child`): the same parts (indices, UVs,
 * weights, fields, face morphs) reshaped, with the stage's own skeleton. Loaded once, then kept in
 * `set.bodies` as `female.child`. Null when the set has no such stage.
 */
export function loadStage(set: CharacterSet, base: BodyData, stage: string): Promise<BodyData | null> {
  const name = `${base.name}.${stage}`;
  const have = set.bodies.get(name);
  if (have) return Promise.resolve(have);
  const info = base.stages[stage];
  if (!info) return Promise.resolve(null);
  const key = `${set.url}#${name}`;
  let p = stageLoads.get(key);
  if (!p) {
    p = fetchBinary(set.file(info.mesh)).then((buf) => {
      const parts = new Map<string, MeshPart>();
      for (const [partName, part] of base.parts) {
        const e = info.parts[partName];
        if (e) parts.set(partName, stagePart(set, part, buf, e));
      }
      const body: BodyData = {
        ...base,
        name,
        stage,
        height: info.height,
        headAbove: info.height - jointY(info.inverseBind, set.head),
        restT: Float32Array.from(info.restT),
        restQ: Float32Array.from(info.restQ),
        inverseBind: Float32Array.from(info.inverseBind),
        pre: Float32Array.from(info.pre),
        post: Float32Array.from(info.post),
        pelvisScale: info.pelvisScale,
        skinRef: info.skinRef ?? base.skinRef,
        textures: info.textures ? { ...base.textures, ...info.textures } : base.textures,
        parts,
        stages: {},
        stageData: buf,
      };
      set.bodies.set(name, body);
      return body;
    });
    p.catch(() => stageLoads.delete(key));
    stageLoads.set(key, p);
  }
  return p;
}

const f32 = new Float32Array(1);
const u32 = new Uint32Array(f32.buffer);

/** IEEE half float bits of `v` (round to nearest; no NaN / infinity inputs). */
function toHalf(v: number): number {
  f32[0] = v;
  const x = u32[0];
  const sign = (x >>> 16) & 0x8000;
  const e = ((x >>> 23) & 0xff) - 127 + 15;
  const m = x & 0x7fffff;
  if (e <= 0) {
    if (e < -10) return sign;
    // Subnormal.
    const mm = m | 0x800000;
    return sign | ((mm >> (14 - e)) + ((mm >> (13 - e)) & 1));
  }
  if (e >= 31) return sign | 0x7bff;
  return (sign | (e << 10) | (m >> 13)) + ((m >> 12) & 1);
}

/** Marks the head bone and its descendants (parents come before children in the rig). */
function headBones(parents: readonly number[], head: number): Uint8Array {
  const out = new Uint8Array(parents.length);
  for (let b = 0; b < parents.length; b++) out[b] = b === head || (parents[b] >= 0 && out[parents[b]] === 1) ? 1 : 0;
  return out;
}
