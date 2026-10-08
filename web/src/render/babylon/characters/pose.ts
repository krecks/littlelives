/**
 * Allocation-free pose maths for the character rig: clip sampling, blending, retargeting onto a
 * body, procedural additive rotations and skinning matrices.
 *
 * Quaternions are (x, y, z, w) in flat Float32Arrays; skinning matrices are written column-major
 * (Babylon's matrix array layout), one 4x4 per bone.
 */

import type { BodyData, CharacterSet, Clip } from './data';

const INV = 1 / 32767;

/** Samples `clip` at `time` (seconds) into `outQ` (bones * 4) and `outPelvis` (3). */
export function sampleClip(set: CharacterSet, clip: Clip, time: number, outQ: Float32Array, outPelvis: Float32Array): void {
  const NB = set.clipBones;
  // Bones the clips don't store (the face) stay at rest (identity local rotation).
  for (let k = NB * 4; k < outQ.length; k += 4) {
    outQ[k] = outQ[k + 1] = outQ[k + 2] = 0;
    outQ[k + 3] = 1;
  }
  const n = clip.frames;
  let f = time * set.fps;
  if (clip.loop) {
    f %= n;
    if (f < 0) f += n;
  } else {
    f = Math.min(Math.max(f, 0), n - 1);
  }
  const i0 = Math.floor(f);
  const i1 = clip.loop ? (i0 + 1) % n : Math.min(i0 + 1, n - 1);
  const t = f - i0;
  const q = clip.q;
  const a = i0 * NB * 4;
  const b = i1 * NB * 4;
  for (let k = 0; k < NB; k++) {
    const o = k * 4;
    let x = q[a + o] * INV;
    let y = q[a + o + 1] * INV;
    let z = q[a + o + 2] * INV;
    let w = q[a + o + 3] * INV;
    if (t > 0) {
      let x1 = q[b + o] * INV;
      let y1 = q[b + o + 1] * INV;
      let z1 = q[b + o + 2] * INV;
      let w1 = q[b + o + 3] * INV;
      if (x * x1 + y * y1 + z * z1 + w * w1 < 0) {
        x1 = -x1;
        y1 = -y1;
        z1 = -z1;
        w1 = -w1;
      }
      x += (x1 - x) * t;
      y += (y1 - y) * t;
      z += (z1 - z) * t;
      w += (w1 - w) * t;
    }
    const l = 1 / Math.sqrt(x * x + y * y + z * z + w * w);
    outQ[o] = x * l;
    outQ[o + 1] = y * l;
    outQ[o + 2] = z * l;
    outQ[o + 3] = w * l;
  }
  const p = clip.pelvis;
  outPelvis[0] = p[i0 * 3] + (p[i1 * 3] - p[i0 * 3]) * t;
  outPelvis[1] = p[i0 * 3 + 1] + (p[i1 * 3 + 1] - p[i0 * 3 + 1]) * t;
  outPelvis[2] = p[i0 * 3 + 2] + (p[i1 * 3 + 2] - p[i0 * 3 + 2]) * t;
}

/**
 * Blends `b` into `a` in place: a = nlerp(a, b, w * mask[bone]) (mask optional), pelvis by `w`.
 */
export function blendInto(a: Float32Array, aPelvis: Float32Array, b: Float32Array, bPelvis: Float32Array, w: number, mask: Float32Array | null): void {
  if (w <= 0) return;
  const NB = a.length / 4;
  for (let k = 0; k < NB; k++) {
    const t = mask ? w * mask[k] : w;
    if (t <= 0) continue;
    const o = k * 4;
    let x1 = b[o];
    let y1 = b[o + 1];
    let z1 = b[o + 2];
    let w1 = b[o + 3];
    if (a[o] * x1 + a[o + 1] * y1 + a[o + 2] * z1 + a[o + 3] * w1 < 0) {
      x1 = -x1;
      y1 = -y1;
      z1 = -z1;
      w1 = -w1;
    }
    const x = a[o] + (x1 - a[o]) * t;
    const y = a[o + 1] + (y1 - a[o + 1]) * t;
    const z = a[o + 2] + (z1 - a[o + 2]) * t;
    const ww = a[o + 3] + (w1 - a[o + 3]) * t;
    const l = 1 / Math.sqrt(x * x + y * y + z * z + ww * ww);
    a[o] = x * l;
    a[o + 1] = y * l;
    a[o + 2] = z * l;
    a[o + 3] = ww * l;
  }
  if (!mask) {
    aPelvis[0] += (bPelvis[0] - aPelvis[0]) * w;
    aPelvis[1] += (bPelvis[1] - aPelvis[1]) * w;
    aPelvis[2] += (bPelvis[2] - aPelvis[2]) * w;
  }
}

/** Hamilton product a * b written into out[o..o+3] (out may alias neither input's slot). */
export function qmul(ax: number, ay: number, az: number, aw: number, bx: number, by: number, bz: number, bw: number, out: Float32Array, o: number): void {
  out[o] = aw * bx + ax * bw + ay * bz - az * by;
  out[o + 1] = aw * by - ax * bz + ay * bw + az * bx;
  out[o + 2] = aw * bz + ax * by - ay * bx + az * bw;
  out[o + 3] = aw * bw - ax * bx - ay * by - az * bz;
}

/**
 * Additive model-space rotations applied while walking the hierarchy: for bone `b`, rotate its
 * world orientation by the quaternion `add[b]` (identity = no change), about the bone's own joint.
 */
export interface Additive {
  /** bones * 4, identity where unused. */
  q: Float32Array;
  /** Whether any bone has a non-identity entry (fast path). */
  active: boolean;
  /**
   * Local rotations (bones * 4) applied after the clip's local rotation, in the bone's own frame:
   * the face bones (whose rest frame is the head's), so expressions follow the head.
   */
  local: Float32Array;
  localActive: boolean;
}

export function makeAdditive(bones: number): Additive {
  const q = new Float32Array(bones * 4);
  for (let i = 0; i < bones; i++) q[i * 4 + 3] = 1;
  return { q, active: false, local: q.slice(), localActive: false };
}

export function resetAdditive(a: Additive): void {
  if (a.active) {
    const q = a.q;
    for (let i = 0; i < q.length; i += 4) {
      q[i] = q[i + 1] = q[i + 2] = 0;
      q[i + 3] = 1;
    }
    a.active = false;
  }
  if (a.localActive) {
    const q = a.local;
    for (let i = 0; i < q.length; i += 4) {
      q[i] = q[i + 1] = q[i + 2] = 0;
      q[i + 3] = 1;
    }
    a.localActive = false;
  }
}

/** Composes a local rotation (axis-angle in the bone's frame) onto `add.local` for bone `b`. */
export function addLocal(a: Additive, b: number, ax: number, ay: number, az: number, angle: number): void {
  if (angle === 0 || b === undefined) return;
  const s = Math.sin(angle / 2);
  const c = Math.cos(angle / 2);
  const o = b * 4;
  const q = a.local;
  qmul(q[o], q[o + 1], q[o + 2], q[o + 3], ax * s, ay * s, az * s, c, q, o);
  a.localActive = true;
}

/** Composes a model-space rotation (axis-angle, unit axis) onto `add` for bone `b`. */
export function addRotation(a: Additive, b: number, ax: number, ay: number, az: number, angle: number): void {
  if (angle === 0) return;
  const s = Math.sin(angle / 2);
  const c = Math.cos(angle / 2);
  const o = b * 4;
  const q = a.q;
  const x = q[o];
  const y = q[o + 1];
  const z = q[o + 2];
  const w = q[o + 3];
  qmul(ax * s, ay * s, az * s, c, x, y, z, w, q, o);
  a.active = true;
}

/** Scratch buffers for `skin` (one set shared by every Sim; Sims are posed one after another). */
export class PoseScratch {
  readonly worldQ: Float32Array;
  readonly worldT: Float32Array;
  readonly localQ: Float32Array;
  constructor(bones: number) {
    this.worldQ = new Float32Array(bones * 4);
    this.worldT = new Float32Array(bones * 3);
    this.localQ = new Float32Array(4);
  }
}

/** Placement of a Sim: position, orientation and uniform scale. */
export interface Placement {
  x: number;
  y: number;
  z: number;
  /** Orientation quaternion. */
  qx: number;
  qy: number;
  qz: number;
  qw: number;
  scale: number;
}

/**
 * Retargets the source-space local rotations `srcQ` / pelvis `srcPelvis` onto `body`, applies the
 * additive rotations and the placement, and writes one skinning matrix per bone into `out` at
 * `offset` (floats). Also returns the head joint's world position in `head` (x, y, z).
 */
export function skin(
  set: CharacterSet,
  body: BodyData,
  srcQ: Float32Array,
  srcPelvis: Float32Array,
  add: Additive,
  place: Placement,
  scratch: PoseScratch,
  out: Float32Array,
  offset: number,
  head: Float32Array,
): void {
  const NB = set.bones.length;
  const parents = set.parents;
  const { pre, post, restT, inverseBind: ibm } = body;
  const wq = scratch.worldQ;
  const wt = scratch.worldT;
  const lq = scratch.localQ;
  const pelvis = set.bone.pelvis;
  const sp = set.sourcePelvis;
  const ps = body.pelvisScale;
  const s = place.scale;
  // Placement rotation (applied to every bone).
  const px = place.qx;
  const py = place.qy;
  const pz = place.qz;
  const pw = place.qw;

  for (let b = 0; b < NB; b++) {
    const o = b * 4;
    // local = pre * src * post
    qmul(pre[o], pre[o + 1], pre[o + 2], pre[o + 3], srcQ[o], srcQ[o + 1], srcQ[o + 2], srcQ[o + 3], lq, 0);
    const ax = lq[0];
    const ay = lq[1];
    const az = lq[2];
    const aw = lq[3];
    qmul(ax, ay, az, aw, post[o], post[o + 1], post[o + 2], post[o + 3], lq, 0);
    if (add.localActive && add.local[o + 3] !== 1) {
      const l = add.local;
      const bx = lq[0];
      const by = lq[1];
      const bz = lq[2];
      const bw = lq[3];
      qmul(bx, by, bz, bw, l[o], l[o + 1], l[o + 2], l[o + 3], lq, 0);
    }
    let tx = restT[b * 3];
    let ty = restT[b * 3 + 1];
    let tz = restT[b * 3 + 2];
    if (b === pelvis) {
      tx += (srcPelvis[0] - sp[0]) * ps;
      ty += (srcPelvis[1] - sp[1]) * ps;
      tz += (srcPelvis[2] - sp[2]) * ps;
    }
    const p = parents[b];
    // Parent world (placement for the root).
    let qx: number, qy: number, qz: number, qw: number, ox: number, oy: number, oz: number, sc: number;
    if (p < 0) {
      qx = px;
      qy = py;
      qz = pz;
      qw = pw;
      ox = place.x;
      oy = place.y;
      oz = place.z;
      sc = s;
    } else {
      qx = wq[p * 4];
      qy = wq[p * 4 + 1];
      qz = wq[p * 4 + 2];
      qw = wq[p * 4 + 3];
      ox = wt[p * 3];
      oy = wt[p * 3 + 1];
      oz = wt[p * 3 + 2];
      sc = s;
    }
    // World translation = parent.t + rotate(parent.q, scale * local.t)
    rotate(qx, qy, qz, qw, tx * sc, ty * sc, tz * sc, wt, b * 3);
    wt[b * 3] += ox;
    wt[b * 3 + 1] += oy;
    wt[b * 3 + 2] += oz;
    // World rotation = parent.q * local.q
    qmul(qx, qy, qz, qw, lq[0], lq[1], lq[2], lq[3], wq, o);
    if (add.active) {
      const a = add.q;
      if (a[o + 3] !== 1) {
        // Model-space additive: q' = P * add * P^-1 * q, with P the placement rotation.
        // (add is expressed in the character's own space, before placement)
        qmul(px, py, pz, pw, a[o], a[o + 1], a[o + 2], a[o + 3], lq, 0);
        const bx = lq[0];
        const by = lq[1];
        const bz = lq[2];
        const bw = lq[3];
        qmul(bx, by, bz, bw, -px, -py, -pz, pw, lq, 0);
        const cx = lq[0];
        const cy = lq[1];
        const cz = lq[2];
        const cw = lq[3];
        qmul(cx, cy, cz, cw, wq[o], wq[o + 1], wq[o + 2], wq[o + 3], wq, o);
      }
    }
  }

  // Skinning matrices: K = [s * R(wq) | wt] * inverseBind (column-major).
  for (let b = 0; b < NB; b++) {
    const o = b * 4;
    const x = wq[o];
    const y = wq[o + 1];
    const z = wq[o + 2];
    const w = wq[o + 3];
    const r00 = (1 - 2 * (y * y + z * z)) * s;
    const r01 = 2 * (x * y - z * w) * s;
    const r02 = 2 * (x * z + y * w) * s;
    const r10 = 2 * (x * y + z * w) * s;
    const r11 = (1 - 2 * (x * x + z * z)) * s;
    const r12 = 2 * (y * z - x * w) * s;
    const r20 = 2 * (x * z - y * w) * s;
    const r21 = 2 * (y * z + x * w) * s;
    const r22 = (1 - 2 * (x * x + y * y)) * s;
    const t0 = wt[b * 3];
    const t1 = wt[b * 3 + 1];
    const t2 = wt[b * 3 + 2];
    const m = b * 16;
    const d = offset + m;
    for (let c = 0; c < 4; c++) {
      const i0 = ibm[m + c * 4];
      const i1 = ibm[m + c * 4 + 1];
      const i2 = ibm[m + c * 4 + 2];
      const i3 = ibm[m + c * 4 + 3];
      out[d + c * 4] = r00 * i0 + r01 * i1 + r02 * i2 + t0 * i3;
      out[d + c * 4 + 1] = r10 * i0 + r11 * i1 + r12 * i2 + t1 * i3;
      out[d + c * 4 + 2] = r20 * i0 + r21 * i1 + r22 * i2 + t2 * i3;
      out[d + c * 4 + 3] = i3;
    }
  }
  const h = set.head * 3;
  head[0] = wt[h];
  head[1] = wt[h + 1];
  head[2] = wt[h + 2];
}

/** out[o..o+2] = rotate(q, v). */
function rotate(qx: number, qy: number, qz: number, qw: number, vx: number, vy: number, vz: number, out: Float32Array, o: number): void {
  // t = 2 * cross(q.xyz, v); v' = v + w * t + cross(q.xyz, t)
  const tx = 2 * (qy * vz - qz * vy);
  const ty = 2 * (qz * vx - qx * vz);
  const tz = 2 * (qx * vy - qy * vx);
  out[o] = vx + qw * tx + (qy * tz - qz * ty);
  out[o + 1] = vy + qw * ty + (qz * tx - qx * tz);
  out[o + 2] = vz + qw * tz + (qx * ty - qy * tx);
}

/** World position of bone `b` from the last `skin` call. */
export function bonePosition(scratch: PoseScratch, b: number, out: Float32Array, o: number): void {
  out[o] = scratch.worldT[b * 3];
  out[o + 1] = scratch.worldT[b * 3 + 1];
  out[o + 2] = scratch.worldT[b * 3 + 2];
}
