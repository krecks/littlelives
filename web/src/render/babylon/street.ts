/**
 * The neighbourhood around the viewed lot, as a lived-in street: the neighbour houses
 * (`HouseBuilder.silhouettes`, with porches, chimneys and garages), sidewalks with kerbs and
 * a dashed centre line, streetlights that light up at night (with pools of light on the
 * ground), mailboxes, hydrants and bins along the kerb, cars parked on neighbours' driveways,
 * picket fences or hedges around neighbours' back gardens, and flower beds along their house
 * fronts.
 *
 * Rules:
 * - Visual only, and kept off where Sims walk: front lawns (Sims cut across them on their way
 *   out of town), garden paths, driveway mouths, the road and the middle of the sidewalk. Kerb
 *   furniture stands on the road side of the sidewalk, fences only run from the house front line
 *   backwards, cars park beside the houses.
 * - Nothing on the viewed lot: the player builds there (the mailbox stands on the sidewalk).
 * - Static: generated once per town layout and kept across structure versions of the viewed
 *   lot (build-mode edits don't rebuild it), merged into a handful of meshes (one per material)
 *   plus thin-instanced foliage, about a dozen draw calls for the whole street.
 * - Primitive builds only (no downloads), plus a CC0 concrete texture for the sidewalks.
 */

import { Color3, Constants, DynamicTexture, Matrix, Quaternion, StandardMaterial, Vector3, type Material, type Mesh, type Scene } from '@babylonjs/core';
import type { AssetRegistry } from '../../assets/registry';
import type { ModelEntry } from '../../assets/types';
import type { PlotInfo, WorldStructure } from '../../core/protocol';
import type { ViewRect } from '../types';
import { Geo, type V3 } from './geometry';
import type { HouseBuilder, SilhouetteSpec } from './house';
import { encodeFinish, MaterialLibrary } from './materials';
import { buildModel, type ModelTemplate } from './models';

interface Rect {
  x: number;
  z: number;
  w: number;
  d: number;
}

/** Sidewalk width (including the kerb) on each side of the road, and its levels. */
const SIDEWALK = 1.35;
const KERB = 0.14;
const WALK_Y = 0.03;
const KERB_Y = 0.045;
const ROAD_Y = 0.012;
/** Paths at least this wide are driveways (garden paths are 1 m; see `game/town.ts`). */
const DRIVEWAY_MIN_WIDTH = 1.8;
const GARAGE_DEPTH = 5.4;
/** Half wall thickness (as in house.ts). */
const T = 0.07;

const CAR_PAINT = ['#C9CDD2', '#F0F0EC', '#1E2328', '#2B4A7A', '#9E2A2B', '#56684C', '#7C8288', '#C8B48E', '#6E8FB0', '#5B2333'];
const MAILBOX = ['#22262A', '#2F4A3A', '#E8E6E0', '#8C2A26', '#2E4568'];
const BIN = ['#3C6B3A', '#55595E', '#2E5C8A'];
const FENCE_WHITE = '#F2F0EA';

/** Model keys of the thin-instanced foliage (street pack, see `assets/street/manifest.json`). */
const FOLIAGE = { bush: 'model.bush', flowers: 'model.street.flowers', hedge: 'model.hedge' } as const;
type FoliageKind = keyof typeof FOLIAGE;

function hash(x: number, z: number, salt: number): number {
  let h = (Math.imul(Math.round(x * 10) | 0, 374761393) + Math.imul(Math.round(z * 10) | 0, 668265263) + Math.imul(salt, 2147483647)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function pick<T>(list: readonly T[], x: number, z: number, salt: number): T {
  return list[Math.floor(hash(x, z, salt) * list.length) % list.length];
}

const overlaps = (a: Rect, b: Rect, m = 0) => a.x - m < b.x + b.w && a.x + a.w + m > b.x && a.z - m < b.z + b.d && a.z + a.d + m > b.z;

/**
 * Writes posed primitives into a `Geo`: a local frame (origin on the ground, +z forward)
 * placed at x/z with a yaw, and a plain finish (colour + roughness/metalness in the vertex
 * alpha, see `encodeFinish`).
 */
export class Painter {
  private ox = 0;
  private oy = 0;
  private oz = 0;
  private c = 1;
  private s = 0;
  constructor(readonly geo: Geo) {}

  at(x: number, z: number, yaw = 0, y = 0): this {
    this.ox = x;
    this.oy = y;
    this.oz = z;
    this.c = Math.cos(yaw);
    this.s = Math.sin(yaw);
    return this;
  }

  paint(hex: string, rough = 0.7, metal = 0): this {
    this.geo.color(hex, encodeFinish(rough, metal));
    return this;
  }

  p(x: number, y: number, z: number): V3 {
    return [this.ox + x * this.c + z * this.s, this.oy + y, this.oz - x * this.s + z * this.c];
  }

  n(x: number, y: number, z: number): V3 {
    return [x * this.c + z * this.s, y, -x * this.s + z * this.c];
  }

  poly(pts: readonly V3[], n: V3): this {
    this.geo.poly(
      pts.map((q) => this.p(q[0], q[1], q[2])),
      this.n(n[0], n[1], n[2]),
    );
    return this;
  }

  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, skip = ''): this {
    if (!skip.includes('py')) this.poly([[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]], [0, 1, 0]);
    if (!skip.includes('ny')) this.poly([[x0, y0, z0], [x0, y0, z1], [x1, y0, z1], [x1, y0, z0]], [0, -1, 0]);
    if (!skip.includes('nz')) this.poly([[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0]], [0, 0, -1]);
    if (!skip.includes('pz')) this.poly([[x0, y0, z1], [x0, y1, z1], [x1, y1, z1], [x1, y0, z1]], [0, 0, 1]);
    if (!skip.includes('nx')) this.poly([[x0, y0, z0], [x0, y1, z0], [x0, y1, z1], [x0, y0, z1]], [-1, 0, 0]);
    if (!skip.includes('px')) this.poly([[x1, y0, z0], [x1, y0, z1], [x1, y1, z1], [x1, y1, z0]], [1, 0, 0]);
    return this;
  }

  /**
   * A tube (frustum) along `axis` from a0 (radius r0) to a1 (radius r1), centred on (cu, cv):
   * the other two axes in x, y, z order. `from`/`to` limit the sweep (radians, from the first
   * of the other axes towards the second); caps close the ends.
   */
  tube(axis: 'x' | 'y' | 'z', a0: number, a1: number, cu: number, cv: number, r0: number, r1: number, seg: number, caps = true, from = 0, to = Math.PI * 2): this {
    const P = (a: number, u: number, v: number): V3 => (axis === 'x' ? [a, u, v] : axis === 'y' ? [u, a, v] : [u, v, a]);
    const full = to - from >= Math.PI * 2 - 1e-6;
    const slope = (r0 - r1) / Math.max(1e-6, Math.abs(a1 - a0)) * Math.sign(a1 - a0);
    for (let i = 0; i < seg; i++) {
      const t0 = from + ((to - from) * i) / seg;
      const t1 = from + ((to - from) * (i + 1)) / seg;
      const tm = (t0 + t1) / 2;
      const [cu0, cv0, cu1, cv1] = [Math.cos(t0), Math.sin(t0), Math.cos(t1), Math.sin(t1)];
      const len = Math.hypot(1, slope);
      const n = P(slope / len, Math.cos(tm) / len, Math.sin(tm) / len);
      this.poly([P(a0, cu + cu0 * r0, cv + cv0 * r0), P(a0, cu + cu1 * r0, cv + cv1 * r0), P(a1, cu + cu1 * r1, cv + cv1 * r1), P(a1, cu + cu0 * r1, cv + cv0 * r1)], n);
    }
    if (caps) {
      for (const [a, r, sgn] of [[a0, r0, -Math.sign(a1 - a0)], [a1, r1, Math.sign(a1 - a0)]] as const) {
        if (r <= 0.001) continue;
        const pts: V3[] = [];
        if (!full) pts.push(P(a, cu, cv));
        for (let i = 0; i <= seg; i++) {
          if (full && i === seg) break;
          const t = from + ((to - from) * i) / seg;
          pts.push(P(a, cu + Math.cos(t) * r, cv + Math.sin(t) * r));
        }
        this.poly(pts, P(sgn, 0, 0));
      }
    }
    return this;
  }
}

// ---- cars ------------------------------------------------------------------------------

interface CarBody {
  len: number;
  wid: number;
  wheelR: number;
  wheelBase: number;
  /** Side profile of the lower body (z forward, y up), convex, counter-clockwise. */
  low: [number, number][];
  /** Greenhouse: base rear z, base front z, roof rear z, roof front z, belt y, roof y. */
  cabin: [number, number, number, number, number, number];
}

const CARS: CarBody[] = [
  // Saloon.
  { len: 4.4, wid: 1.78, wheelR: 0.32, wheelBase: 2.65, low: [[-2.2, 0.3], [2.2, 0.3], [2.24, 0.52], [2.14, 0.74], [0.95, 0.88], [-1.35, 0.93], [-2.12, 0.88], [-2.24, 0.58]], cabin: [-1.4, 0.95, -0.8, 0.16, 0.9, 1.42] },
  // Hatchback.
  { len: 4.0, wid: 1.74, wheelR: 0.31, wheelBase: 2.5, low: [[-1.98, 0.3], [2.0, 0.3], [2.04, 0.52], [1.96, 0.72], [0.85, 0.87], [-1.9, 0.93], [-2.02, 0.6]], cabin: [-1.9, 0.88, -1.72, 0.08, 0.9, 1.46] },
  // SUV.
  { len: 4.6, wid: 1.88, wheelR: 0.37, wheelBase: 2.75, low: [[-2.3, 0.4], [2.3, 0.4], [2.34, 0.66], [2.24, 0.92], [1.25, 1.02], [-2.25, 1.06], [-2.34, 0.7]], cabin: [-2.24, 1.28, -2.14, 0.48, 1.02, 1.76] },
  // Estate.
  { len: 4.6, wid: 1.8, wheelR: 0.32, wheelBase: 2.7, low: [[-2.3, 0.3], [2.3, 0.3], [2.34, 0.52], [2.24, 0.74], [1.05, 0.88], [-2.25, 0.93], [-2.33, 0.6]], cabin: [-2.24, 1.05, -2.1, 0.25, 0.9, 1.45] },
];

/** A parked car in `p`'s frame (front towards +z), sitting on the ground at `y`. */
function car(p: Painter, body: CarBody, paint: string): void {
  const { wid, low } = body;
  const hw = wid / 2;
  const inner = hw - 0.045;
  const [cz, cy] = [low.reduce((a, q) => a + q[0], 0) / low.length, low.reduce((a, q) => a + q[1], 0) / low.length];
  const shrunk = low.map(([z, y]): [number, number] => {
    const [dz, dy] = [cz - z, cy - y];
    const l = Math.hypot(dz, dy) || 1;
    return [z + (dz / l) * 0.035, y + (dy / l) * 0.035];
  });
  p.paint(paint, 0.2, 0);
  // Sides, chamfers and the perimeter.
  for (const side of [-1, 1]) {
    p.poly(shrunk.map(([z, y]): V3 => [side * hw, y, z]), [side, 0, 0]);
  }
  for (let i = 0; i < low.length; i++) {
    const [z0, y0] = low[i];
    const [z1, y1] = low[(i + 1) % low.length];
    const l = Math.hypot(z1 - z0, y1 - y0) || 1;
    const [ny, nz] = [-(z1 - z0) / l, (y1 - y0) / l];
    if (ny < -0.9) p.paint('#202224', 0.8, 0);
    p.poly([[-inner, y0, z0], [inner, y0, z0], [inner, y1, z1], [-inner, y1, z1]], [0, ny, nz]);
    for (const side of [-1, 1]) {
      const [s0, s1] = [shrunk[i], shrunk[(i + 1) % low.length]];
      const n: V3 = [side * 0.7, ny * 0.7, nz * 0.7];
      p.poly([[side * hw, s0[1], s0[0]], [side * hw, s1[1], s1[0]], [side * inner, y1, z1], [side * inner, y0, z0]], n);
    }
    if (ny < -0.9) p.paint(paint, 0.2, 0);
  }
  // Greenhouse: painted frame and roof, glass inset into it.
  const [br, bf, rr, rf, yb, yr] = body.cabin;
  const hb = hw - 0.07;
  const hr = hw - 0.25;
  const B = (x: number, z: number): V3 => [x, yb, z];
  const R = (x: number, z: number): V3 => [x, yr, z];
  const quad = (q: V3[], out: V3, glass: [number, number, number, number] | null, pillar = false) => {
    p.paint(paint, 0.2, 0).poly(q, out);
    if (!glass) return;
    const [u0, u1, v0, v1] = glass;
    // Bilinear sub-rectangle of the quad (q0..q1 along the bottom, q3..q2 along the top).
    const at = (u: number, v: number): V3 => {
      const b = [0, 1, 2].map((k) => q[0][k] + (q[1][k] - q[0][k]) * u);
      const t = [0, 1, 2].map((k) => q[3][k] + (q[2][k] - q[3][k]) * u);
      const len = Math.hypot(...out) || 1;
      return [0, 1, 2].map((k) => b[k] + (t[k] - b[k]) * v + (out[k] / len) * 0.006) as unknown as V3;
    };
    p.paint('#1C252D', 0.06, 0).poly([at(u0, v0), at(u1, v0), at(u1, v1), at(u0, v1)], out);
    if (pillar) {
      const mid = 0.52;
      const lift = (v: V3): V3 => {
        const len = Math.hypot(...out) || 1;
        return [v[0] + (out[0] / len) * 0.004, v[1] + (out[1] / len) * 0.004, v[2] + (out[2] / len) * 0.004];
      };
      p.paint(paint, 0.2, 0).poly([lift(at(mid - 0.025, 0)), lift(at(mid + 0.025, 0)), lift(at(mid + 0.025, 1)), lift(at(mid - 0.025, 1))], out);
    }
  };
  const ws = facingOut([B(-hb, bf), B(hb, bf), R(hr, rf)], [0, 0.6, 1]);
  quad([B(-hb, bf), B(hb, bf), R(hr, rf), R(-hr, rf)], ws, [0.05, 0.95, 0.06, 0.9]);
  const rw = facingOut([B(hb, br), B(-hb, br), R(-hr, rr)], [0, 0.6, -1]);
  quad([B(hb, br), B(-hb, br), R(-hr, rr), R(hr, rr)], rw, [0.06, 0.94, 0.1, 0.88]);
  for (const side of [-1, 1]) {
    const q: V3[] = side > 0 ? [B(hb, bf), B(hb, br), R(hr, rr), R(hr, rf)] : [B(-hb, br), B(-hb, bf), R(-hr, rf), R(-hr, rr)];
    quad(q, facingOut(q, [side, 0.3, 0]), [0.05, 0.95, 0.1, 0.86], true);
  }
  p.paint(paint, 0.2, 0).poly([R(-hr, rr), R(hr, rr), R(hr, rf), R(-hr, rf)], [0, 1, 0]);
  // Wheels in dark arches, hubcaps.
  const r = body.wheelR;
  for (const wz of [body.wheelBase / 2, -body.wheelBase / 2]) {
    for (const side of [-1, 1]) {
      p.paint('#141517', 0.9, 0).tube('x', side * (hw + 0.002), side * (hw + 0.003), r, wz, r + 0.07, r + 0.07, 8, true, 0, Math.PI);
      p.paint('#1A1A1C', 0.85, 0).tube('x', side * (hw - 0.22), side * (hw + 0.012), r, wz, r, r, 12);
      p.paint('#B4B8BC', 0.3, 1).tube('x', side * (hw + 0.012), side * (hw + 0.02), r, wz, r * 0.6, r * 0.5, 10);
    }
  }
  // Bumpers, lights, grille, plates, mirrors.
  const zf = Math.max(...low.map((q) => q[0]));
  const zb = Math.min(...low.map((q) => q[0]));
  const yl = low[0][1];
  p.paint('#2A2C2E', 0.6, 0);
  p.box(-hw + 0.04, yl - 0.02, zf - 0.12, hw - 0.04, yl + 0.16, zf + 0.04);
  p.box(-hw + 0.04, yl - 0.02, zb - 0.04, hw - 0.04, yl + 0.16, zb + 0.12);
  p.box(-0.42, yl + 0.26, zf - 0.08, 0.42, yl + 0.36, zf + 0.0);
  p.paint('#F5F3EA', 0.1, 0);
  for (const s of [-1, 1]) p.box(s * (hw - 0.34), yl + 0.24, zf - 0.1, s * (hw - 0.08), yl + 0.36, zf - 0.02);
  p.paint('#A3161E', 0.2, 0);
  for (const s of [-1, 1]) p.box(s * (hw - 0.36), yl + 0.28, zb + 0.02, s * (hw - 0.06), yl + 0.42, zb + 0.1);
  p.paint('#E9E6D8', 0.4, 0);
  p.box(-0.26, yl + 0.02, zf + 0.04, 0.26, yl + 0.13, zf + 0.06);
  p.box(-0.26, yl + 0.2, zb - 0.02, 0.26, yl + 0.31, zb);
  p.paint(paint, 0.2, 0);
  for (const s of [-1, 1]) p.box(Math.min(s * hw, s * (hw + 0.12)), yb + 0.04, bf - 0.32, Math.max(s * hw, s * (hw + 0.12)), yb + 0.14, bf - 0.2);
}

function facingOut(q: V3[], towards: V3): V3 {
  const [a, b, c] = q;
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  let n: [number, number, number] = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const l = Math.hypot(...n) || 1;
  n = [n[0] / l, n[1] / l, n[2] / l];
  return n[0] * towards[0] + n[1] * towards[1] + n[2] * towards[2] >= 0 ? n : [-n[0], -n[1], -n[2]];
}

// ---- street furniture -------------------------------------------------------------------

/** Cast-iron lantern post; the glass goes into `glow`. */
function streetlight(p: Painter, glow: Painter): void {
  p.paint('#2B302E', 0.45, 0);
  p.tube('y', 0, 0.12, 0, 0, 0.17, 0.16, 8);
  p.tube('y', 0.12, 0.55, 0, 0, 0.12, 0.075, 8);
  p.tube('y', 0.55, 3.3, 0, 0, 0.05, 0.045, 8, false);
  p.tube('y', 3.3, 3.4, 0, 0, 0.075, 0.075, 8);
  p.tube('y', 3.4, 3.5, 0, 0, 0.08, 0.13, 6);
  glow.tube('y', 3.5, 3.86, 0, 0, 0.13, 0.19, 6);
  for (let i = 0; i < 6; i++) {
    const t = (i / 6) * Math.PI * 2;
    const [x, z] = [Math.cos(t), Math.sin(t)];
    p.poly([[x * 0.135, 3.5, z * 0.135], [x * 0.195, 3.86, z * 0.195], [x * 0.205, 3.86, z * 0.205], [x * 0.145, 3.5, z * 0.145]], [Math.cos(t + Math.PI / 2), 0, Math.sin(t + Math.PI / 2)]);
  }
  p.tube('y', 3.86, 4.06, 0, 0, 0.26, 0.05, 6);
  p.tube('y', 4.06, 4.16, 0, 0, 0.03, 0.01, 6);
}

/** Kerbside mailbox on a post, its door towards +z (the road). */
function mailbox(p: Painter, colour: string): void {
  p.paint('#6E5A44', 0.8, 0).box(-0.04, 0, -0.04, 0.04, 1.0, 0.04);
  p.box(-0.07, 0.95, -0.2, 0.07, 1.0, 0.2);
  p.paint(colour, 0.35, 0).box(-0.1, 1.0, -0.24, 0.1, 1.12, 0.24, 'py');
  p.tube('z', -0.24, 0.24, 0, 1.12, 0.1, 0.1, 8, true, 0, Math.PI);
  p.paint('#C0302A', 0.4, 0).box(0.1, 1.06, 0.02, 0.115, 1.3, 0.05);
  p.box(0.1, 1.22, 0.05, 0.115, 1.3, 0.18);
}

function hydrant(p: Painter, colour: string): void {
  p.paint(colour, 0.35, 0);
  p.tube('y', 0, 0.06, 0, 0, 0.14, 0.13, 10);
  p.tube('y', 0.06, 0.52, 0, 0, 0.1, 0.095, 10, false);
  p.tube('y', 0.52, 0.56, 0, 0, 0.12, 0.12, 10);
  p.tube('y', 0.56, 0.66, 0, 0, 0.1, 0.04, 10);
  p.tube('y', 0.66, 0.71, 0, 0, 0.025, 0.025, 6);
  p.tube('x', 0.09, 0.19, 0.38, 0, 0.045, 0.045, 8);
  p.tube('x', -0.09, -0.19, 0.38, 0, 0.045, 0.045, 8);
  p.paint('#D9D6CE', 0.3, 1).tube('z', 0.08, 0.18, 0, 0.33, 0.06, 0.06, 8);
}

/** Wheelie bin, lid hinge at the back (-z). */
function bin(p: Painter, colour: string): void {
  p.paint(colour, 0.55, 0);
  p.box(-0.27, 0.06, -0.31, 0.27, 0.98, 0.31);
  p.box(-0.29, 0.98, -0.35, 0.29, 1.03, 0.34);
  p.box(-0.2, 0.86, 0.31, 0.2, 0.94, 0.34);
  p.paint('#232426', 0.7, 0).box(-0.22, 0.92, -0.4, 0.22, 0.96, -0.36);
  for (const s of [-1, 1]) p.tube('x', s * 0.22, s * 0.3, 0.1, -0.26, 0.1, 0.1, 10);
}

/** A white picket fence along an axis-aligned line (posts every ~2 m). */
function pickets(p: Painter, x0: number, z0: number, x1: number, z1: number): void {
  const alongX = Math.abs(x1 - x0) >= Math.abs(z1 - z0);
  const len = alongX ? Math.abs(x1 - x0) : Math.abs(z1 - z0);
  if (len < 0.5) return;
  // Local frame: +x along the fence.
  p.at(x0, z0, alongX ? (x1 > x0 ? 0 : Math.PI) : z1 > z0 ? -Math.PI / 2 : Math.PI / 2);
  p.paint(FENCE_WHITE, 0.6, 0);
  const posts = Math.max(1, Math.round(len / 2));
  for (let i = 0; i <= posts; i++) {
    const x = (len * i) / posts;
    p.box(x - 0.045, 0, -0.045, x + 0.045, 0.98, 0.045, 'ny');
    p.box(x - 0.06, 0.98, -0.06, x + 0.06, 1.02, 0.06, 'ny');
  }
  for (const y of [0.25, 0.7]) p.box(0, y, -0.035, len, y + 0.06, -0.012, 'ny');
  for (let x = 0.09; x < len - 0.05; x += 0.15) {
    if (Math.abs(((x + 1) % (len / posts)) - 1) < 0.07) continue;
    for (const [z, n] of [[0.009, 1], [-0.009, -1]] as const) {
      p.poly([[x - 0.036, 0.05, z], [x + 0.036, 0.05, z], [x + 0.036, 0.84, z], [x, 0.92, z], [x - 0.036, 0.84, z]], [0, 0, n]);
    }
  }
}

/** Soft elliptical contact shadow (alpha falls off to the rim). */
function blob(g: Geo, x: number, z: number, rx: number, rz: number, yaw: number, alpha: number, y = 0.02): void {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const seg = 14;
  const P = (t: number): V3 => {
    const [lx, lz] = [Math.cos(t) * rx, Math.sin(t) * rz];
    return [x + lx * c + lz * s, y, z - lx * s + lz * c];
  };
  for (let i = 0; i < seg; i++) {
    g.poly([[x, y, z], P(((i + 1) / seg) * Math.PI * 2), P((i / seg) * Math.PI * 2)], [0, 1, 0], undefined, [alpha, 0, 0]);
  }
}

// ---- layout ---------------------------------------------------------------------------

interface PlotLayout {
  plot: PlotInfo;
  kind: 'home' | 'house' | 'park' | 'empty';
  /** +1: the street is on the plot's max-z side; -1: on its min-z side. */
  front: 1 | -1;
  /** z of the plot edge on the street. */
  edge: number;
  /** Wall bounding box. */
  house: { x0: number; z0: number; x1: number; z1: number } | null;
  /** Centre x of the garden path to the front door. */
  door: number | null;
  drive: Rect | null;
}

export class Street {
  private readonly lib: MaterialLibrary;
  private key = '';
  private meshes: Mesh[] = [];
  private casters: Mesh[] = [];
  private readonly foliage = new Map<FoliageKind, Promise<ModelTemplate>>();
  private readonly glowMat: StandardMaterial;
  private readonly poolMat: StandardMaterial;
  private lamps = -1;
  private readonly tmpQ = new Quaternion();
  private readonly tmpM = new Matrix();
  private readonly tmpS = new Vector3();
  private readonly tmpT = new Vector3();

  constructor(
    private readonly scene: Scene,
    private readonly assets: AssetRegistry,
    private readonly house: HouseBuilder,
    /** Camera layer of everything this street draws (see layers.ts); default: the game world. */
    private readonly layerMask?: number,
  ) {
    this.lib = MaterialLibrary.for(scene);
    const glow = (this.glowMat = new StandardMaterial('streetLampGlass', scene));
    glow.disableLighting = true;
    glow.diffuseColor = Color3.Black();
    glow.specularColor = Color3.Black();
    glow.emissiveColor = new Color3(0.6, 0.6, 0.56);
    // Pools of lamplight on the ground: additive, unlit, no fog (fog would add up to boxes).
    const tex = new DynamicTexture('streetLightPool', 128, scene, true);
    const ctx = tex.getContext();
    const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, 'rgb(255,255,255)');
    g.addColorStop(0.35, 'rgb(150,150,150)');
    g.addColorStop(0.7, 'rgb(40,40,40)');
    g.addColorStop(1, 'rgb(0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
    tex.update();
    const pool = (this.poolMat = new StandardMaterial('streetLightPools', scene));
    pool.disableLighting = true;
    pool.diffuseColor = Color3.Black();
    pool.specularColor = Color3.Black();
    // Additive: colour x the gradient's falloff (as opacity), so black by day adds nothing.
    tex.getAlphaFromRGB = true;
    pool.opacityTexture = tex;
    pool.emissiveColor = Color3.Black();
    pool.alphaMode = Constants.ALPHA_ADD;
    pool.disableDepthWrite = true;
    pool.fogEnabled = false;
    pool.zOffset = -4;
  }

  /**
   * Builds (or keeps) the street for this world and view; returns the shadow casters. Only a
   * change of the town layout outside the viewed lot rebuilds it.
   */
  async build(world: WorldStructure, view: ViewRect | null): Promise<Mesh[]> {
    const outside = world.objects.filter((o) => !view || o.x < view.x || o.z < view.z || o.x >= view.x + view.w || o.z >= view.z + view.d);
    const key = [
      world.meta?.seed ?? 0,
      world.width,
      world.depth,
      view ? `${view.x},${view.z},${view.w},${view.d}` : '-',
      world.plots.map((p) => `${p.house?.join(',') ?? ''}${p.roof ? `/${p.roof.join(',')}` : ''}`).join(';'),
      (world.meta?.paths ?? []).length,
      outside.length,
      outside.reduce((a, o) => a + o.x * 31 + o.z, 0),
    ].join('|');
    if (key === this.key) return this.casters;
    for (const mesh of this.meshes) mesh.dispose(false, false);
    this.meshes = [];
    this.casters = [];
    this.key = key;

    const streets = (world.meta?.streets ?? []).filter((s) => s.w >= s.d);
    const paths = world.meta?.paths ?? [];
    const plots = this.layout(world, view, streets, paths);

    const props = new Painter(new Geo());
    const glow = new Painter(new Geo());
    const pools = new Geo();
    const shadows = new Geo().color('#000000');
    const walk = new Geo();
    const plants: Record<FoliageKind, [number, number, number, number, number][]> = { bush: [], flowers: [], hedge: [] };

    // Footprints Sims and props must not share: objects, paths, the viewed lot.
    const blocked: Rect[] = outside.map((o) => ({ x: o.x, z: o.z, w: o.w, d: o.d }));
    const free = (r: Rect, m = 0) => !blocked.some((b) => overlaps(r, b, m)) && !(view && overlaps(r, view));

    // ---- neighbour houses -------------------------------------------------------------
    const specs: SilhouetteSpec[] = [];
    for (const L of plots) {
      if (L.kind !== 'house' || !L.house) continue;
      specs.push({ ...L.house, front: L.front, door: L.door, garage: this.garage(L, blocked), roof: L.plot.roof });
    }
    const sil = this.house.silhouettes(specs, world.openings ?? []);
    if (this.layerMask !== undefined) for (const mesh of sil.meshes) mesh.layerMask = this.layerMask;
    this.meshes.push(...sil.meshes);
    this.casters.push(...sil.casters);
    for (const s of specs) if (s.garage) blocked.push({ x: s.garage.x0 - T, z: s.garage.z0 - T, w: s.garage.x1 - s.garage.x0 + 2 * T, d: s.garage.z1 - s.garage.z0 + 2 * T });
    for (const [x, y, z, nx, nz] of sil.lamps) {
      glow.at(x, z).box(-0.06 + nx * 0.02, y - 0.12, -0.06 + nz * 0.02, 0.06 + nx * 0.02, y + 0.08, 0.06 + nz * 0.02);
      props.at(x, z).paint('#26282A', 0.5, 0).box(-0.08, y + 0.08, -0.08, 0.08, y + 0.12, 0.08);
      this.pool(pools, x + nx * 0.9, z + nz * 0.9, 1.7);
    }

    // ---- sidewalks, kerbs, centre line, kerbside furniture ------------------------------
    for (const st of streets) {
      for (const side of [-1, 1] as const) {
        // side -1: the sidewalk along the street's min-z edge; +1: along its max-z edge.
        const edge = side < 0 ? st.z : st.z + st.d;
        const into = -side; // from the edge into the street
        const zAt = (d: number) => edge + into * d;
        const span = (d0: number, d1: number) => [Math.min(zAt(d0), zAt(d1)), Math.max(zAt(d0), zAt(d1))];
        const [w0, w1] = span(0, SIDEWALK - KERB);
        const [k0, k1] = span(SIDEWALK - KERB, SIDEWALK);
        const [xa, xb] = [st.x, st.x + st.w];
        walk.color('#E6E6E6').poly([[xa, WALK_Y, w0], [xb, WALK_Y, w0], [xb, WALK_Y, w1], [xa, WALK_Y, w1]], [0, 1, 0]);
        walk.color('#FFFFFF').poly([[xa, KERB_Y, k0], [xb, KERB_Y, k0], [xb, KERB_Y, k1], [xa, KERB_Y, k1]], [0, 1, 0]);
        // Kerb faces: the step up from the walk and the drop to the road.
        const kIn = zAt(SIDEWALK - KERB);
        const kOut = zAt(SIDEWALK);
        walk.poly([[xa, WALK_Y, kIn], [xb, WALK_Y, kIn], [xb, KERB_Y, kIn], [xa, KERB_Y, kIn]], [0, 0, -into]);
        walk.poly([[xa, ROAD_Y, kOut], [xb, ROAD_Y, kOut], [xb, KERB_Y, kOut], [xa, KERB_Y, kOut]], [0, 0, into]);
        walk.color('#E6E6E6').poly([[xa, 0, edge], [xb, 0, edge], [xb, WALK_Y, edge], [xa, WALK_Y, edge]], [0, 0, side]);
        // Gutter: the road darkens along the kerb.
        const g0 = zAt(SIDEWALK);
        const g1 = zAt(SIDEWALK + 0.4);
        shadows.poly([[xa, ROAD_Y + 0.003, g0], [xb, ROAD_Y + 0.003, g0], [xb, ROAD_Y + 0.003, g1], [xa, ROAD_Y + 0.003, g1]], [0, 1, 0], undefined, [0.3, 0.3, 0, 0]);

        // Mouths of garden paths and driveways on this side: keep them clear.
        const mouths = paths.filter((r) => Math.abs((side < 0 ? r.z + r.d : r.z) - edge) < 0.05);
        const clear = (x: number, m: number) => x > xa + 1 && x < xb - 1 && !mouths.some((r) => x > r.x - m && x < r.x + r.w + m);
        const used: number[] = [];
        const near = (x: number, m: number) => used.some((u) => Math.abs(u - x) < m);
        const kerbZ = zAt(SIDEWALK - KERB - 0.3);
        const yaw = side < 0 ? 0 : Math.PI; // props' +z faces the road
        const row = plots.filter((L) => Math.abs(L.edge - edge) < 0.05).sort((a, b) => a.plot.x - b.plot.x);

        // Streetlights, one per plot width, staggered between the two sides.
        const lights = row.map((L) => L.plot.x + (side < 0 ? 1.2 : L.plot.w / 2));
        if (row.length) lights.push(row[row.length - 1].plot.x + row[row.length - 1].plot.w + (side < 0 ? 1.2 : -1.2));
        for (const x0 of lights) {
          const x = [0, 1.5, -1.5, 3, -3].map((d) => x0 + d).find((x) => clear(x, 1.2) && !near(x, 1.5));
          if (x === undefined) continue;
          used.push(x);
          streetlight(props.at(x, kerbZ, yaw, WALK_Y), glow.at(x, kerbZ, yaw, WALK_Y));
          blob(shadows, x, kerbZ, 0.32, 0.32, 0, 0.45, WALK_Y + 0.004);
          this.pool(pools, x, kerbZ + into * 0.5, 4.2);
        }
        // Mailboxes in front of every house (beside the path, away from the driveway).
        for (const L of row) {
          if (L.door === null || (L.kind !== 'house' && L.kind !== 'home')) continue;
          const away = L.drive && L.drive.x > L.door ? -1 : 1;
          const x = [0.95 * away, -0.95 * away, 1.6 * away].map((d) => L.door! + d).find((x) => clear(x, 0.25) && !near(x, 0.6));
          if (x === undefined) continue;
          used.push(x);
          mailbox(props.at(x, kerbZ, yaw, WALK_Y), pick(MAILBOX, L.plot.x, L.plot.z, 3));
          blob(shadows, x, kerbZ, 0.2, 0.3, yaw, 0.35, WALK_Y + 0.004);
        }
        // A hydrant every other plot.
        row.forEach((L, i) => {
          if ((i + (side < 0 ? 0 : 1)) % 2) return;
          const x = [6, 8, 4, 10].map((d) => L.plot.x + d).find((x) => clear(x, 0.8) && !near(x, 1.2));
          if (x === undefined) return;
          used.push(x);
          hydrant(props.at(x, kerbZ, yaw + hash(x, edge, 5) * 0.6, WALK_Y), hash(x, edge, 4) < 0.75 ? '#B32B24' : '#D9A520');
          blob(shadows, x, kerbZ, 0.22, 0.22, 0, 0.4, WALK_Y + 0.004);
        });
        // Bins out by some driveways, on the garden side of the sidewalk.
        for (const L of row) {
          if (L.kind !== 'house' || !L.drive || hash(L.plot.x, L.plot.z, 12) > 0.6) continue;
          const outer = L.drive.x + L.drive.w / 2 > L.plot.x + L.plot.w / 2 ? 1 : -1;
          const binZ = zAt(0.4);
          for (let k = 0; k < (hash(L.plot.x, L.plot.z, 13) < 0.5 ? 2 : 1); k++) {
            const x = (outer > 0 ? L.drive.x + L.drive.w + 0.45 : L.drive.x - 0.45) + outer * k * 0.7;
            if (!clear(x, 0.35) || near(x, 0.5) || x > L.plot.x + L.plot.w - 0.3 || x < L.plot.x + 0.3) continue;
            used.push(x);
            bin(props.at(x, binZ, yaw + Math.PI + (hash(x, binZ, 6) - 0.5) * 0.3, WALK_Y), BIN[(k + Math.floor(hash(L.plot.x, 1, 14) * 3)) % BIN.length]);
            blob(shadows, x, binZ, 0.36, 0.4, 0, 0.4, WALK_Y + 0.004);
          }
        }
      }
      // Dashed centre line.
      props.at(0, 0).paint('#E8E2CC', 0.6, 0);
      const zc = st.z + st.d / 2;
      for (let x = st.x + 1; x + 2.4 < st.x + st.w - 1; x += 5) props.poly([[x, ROAD_Y + 0.005, zc - 0.06], [x + 2.4, ROAD_Y + 0.005, zc - 0.06], [x + 2.4, ROAD_Y + 0.005, zc + 0.06], [x, ROAD_Y + 0.005, zc + 0.06]], [0, 1, 0]);
    }

    // ---- gardens: cars, fences / hedges, flower beds -------------------------------------
    const neighbour = (L: PlotLayout | undefined) => !!L && L.kind === 'house';
    for (const L of plots) {
      if (L.kind !== 'house' || !L.house) continue;
      const { plot, front } = L;
      const h = L.house;
      const vz = (v: number) => L.edge - front * v; // depth into the plot -> z
      const frontWall = front > 0 ? h.z1 + T : h.z0 - T;
      const backEdge = front > 0 ? plot.z : plot.z + plot.d;

      // Car on the driveway, beside the house (not in the front yard Sims cross).
      if (L.drive && hash(plot.x, plot.z, 20) < 0.8) {
        const body = pick(CARS, plot.x, plot.z, 21);
        const dEnd = front > 0 ? L.drive.z : L.drive.z + L.drive.d; // inner end
        const cz = dEnd + front * (0.45 + body.len / 2);
        const cx = L.drive.x + L.drive.w / 2;
        const yaw = (hash(plot.x, plot.z, 22) < 0.65 ? (front > 0 ? Math.PI : 0) : front > 0 ? 0 : Math.PI) + (hash(plot.x, plot.z, 23) - 0.5) * 0.06;
        car(props.at(cx, cz, yaw, 0.015), body, pick(CAR_PAINT, plot.x, plot.z, 24));
        blob(shadows, cx, cz, body.wid * 0.62, body.len * 0.56, yaw, 0.55, 0.03);
      }

      // Fences or hedges: sides from the house front line back, and the back edge. A side
      // shared with another neighbour is drawn once, on the boundary, by the plot on its left.
      const style = hash(plot.x, plot.z, 30) < 0.5 ? 'picket' : hash(plot.x, plot.z, 31) < 0.75 ? 'hedge' : 'none';
      if (style !== 'none') {
        const row = plots.filter((o) => o.edge === L.edge).sort((a, b) => a.plot.x - b.plot.x);
        const i = row.indexOf(L);
        const left = row[i - 1] && Math.abs(row[i - 1].plot.x + row[i - 1].plot.w - plot.x) < 0.01 ? row[i - 1] : undefined;
        const right = row[i + 1] && Math.abs(plot.x + plot.w - row[i + 1].plot.x) < 0.01 ? row[i + 1] : undefined;
        const inset = style === 'hedge' ? 0.45 : 0.15;
        const vStart = Math.max(L.edge * front - frontWall * front, ...[left, right].filter(neighbour).map((o) => (o!.house ? o!.edge * front - (front > 0 ? o!.house.z1 + T : o!.house.z0 - T) * front : 0))) + 0.4;
        const vEnd = plot.d - inset;
        const lines: [number, number, number, number][] = [];
        if (!neighbour(left)) lines.push([plot.x + inset, vz(vStart), plot.x + inset, vz(vEnd)]);
        lines.push(neighbour(right) ? [plot.x + plot.w, vz(vStart), plot.x + plot.w, vz(vEnd)] : [plot.x + plot.w - inset, vz(vStart), plot.x + plot.w - inset, vz(vEnd)]);
        lines.push([plot.x + inset, backEdge + front * inset, plot.x + plot.w - inset, backEdge + front * inset]);
        for (const [x0, z0, x1, z1] of lines) this.edgeRun(style, props, plants.hedge, x0, z0, x1, z1, blocked);
      }

      // Flower beds along the house front, either side of the porch.
      const door = L.door ?? -1e9;
      const depth = 0.85;
      const bedRect = (a: number, b: number): Rect => ({ x: a, z: Math.min(frontWall, frontWall + front * depth), w: b - a, d: depth });
      const runs: [number, number][] = [
        [h.x0 + 0.1, door - 1.3],
        [door + 1.3, h.x1 - 0.1],
      ];
      for (const [a0, a1] of runs) {
        if (a1 - a0 < 1.2) continue;
        const r = bedRect(a0, a1);
        if (!free(r, 0.1)) continue;
        const [z0, z1] = [r.z, r.z + r.d];
        props.at(0, 0).paint('#3E2C20', 0.95, 0).box(a0, 0, z0, a1, 0.045, z1, 'ny');
        const ez = front > 0 ? z1 : z0;
        props.at(0, 0).paint('#B5AEA2', 0.85, 0).box(a0 - 0.04, 0, Math.min(ez, ez + front * 0.08), a1 + 0.04, 0.08, Math.max(ez, ez + front * 0.08), 'ny');
        for (let x = a0 + 0.35; x < a1 - 0.2; x += 0.62) {
          const k = hash(x, plot.z, 40);
          const back = frontWall + front * 0.3;
          const fore = frontWall + front * 0.62;
          if (k < 0.45) plants.bush.push([x, back, 0.42 + hash(x, 1, 41) * 0.18, 0.4 + hash(x, 2, 41) * 0.25, hash(x, 3, 42) * 6.28]);
          plants.flowers.push([x + 0.15, k < 0.45 ? fore : (back + fore) / 2, 0.85 + hash(x, 4, 43) * 0.35, 0.8 + hash(x, 5, 43) * 0.4, hash(x, 6, 44) * 6.28]);
        }
      }
      // A shrub at each front corner of the house.
      for (const cx of [h.x0 - 0.55, h.x1 + 0.55]) {
        const cz = frontWall + front * 0.2;
        const r = { x: cx - 0.5, z: cz - 0.5, w: 1, d: 1 };
        if (free(r) && !(L.drive && overlaps(r, L.drive, 0.2))) plants.bush.push([cx, cz, 0.7, 0.75, hash(cx, cz, 45) * 6.28]);
      }
    }

    // ---- meshes ---------------------------------------------------------------------------
    const add = (geo: Geo, name: string, material: Material, opts: { cast?: boolean; plain?: boolean; colors?: boolean } = {}) => {
      const mesh = geo.toMesh(name, this.scene, { colors: opts.colors ?? true, cut: false });
      if (!mesh) return;
      if (opts.plain) mesh.hasVertexAlpha = false;
      mesh.material = material;
      mesh.receiveShadows = true;
      mesh.isPickable = false;
      if (this.layerMask !== undefined) mesh.layerMask = this.layerMask;
      this.meshes.push(mesh);
      if (opts.cast) this.casters.push(mesh);
    };
    add(walk, 'streetSidewalks', this.lib.surface('material.sidewalk', { vertexColors: true }));
    add(props.geo, 'streetProps', this.lib.plainFinish(), { cast: true, plain: true });
    add(glow.geo, 'streetLamps', this.glowMat, { colors: false });
    const poolMesh = pools.toMesh('streetLightPools', this.scene, { colors: false });
    if (poolMesh) {
      poolMesh.material = this.poolMat;
      poolMesh.isPickable = false;
      poolMesh.alphaIndex = 5;
      if (this.layerMask !== undefined) poolMesh.layerMask = this.layerMask;
      this.meshes.push(poolMesh);
    }
    add(shadows, 'streetShadows', this.lib.contactShadow());
    const foliage: Mesh[] = [];
    for (const kind of Object.keys(FOLIAGE) as FoliageKind[]) {
      const meshes = await this.instances(kind, plants[kind]);
      foliage.push(...meshes);
      if (kind === 'hedge') this.casters.push(...meshes);
    }
    for (const mesh of this.meshes) mesh.freezeWorldMatrix();
    this.drawn = [...this.meshes, ...foliage];
    // Interior lamps of the viewed house never reach the street (keeps its shaders simple).
    const mine = new Set([...this.meshes, ...foliage]);
    for (const light of this.scene.lights) {
      if (!light.name.startsWith('room')) continue;
      light.excludedMeshes = [...light.excludedMeshes.filter((m) => !m.isDisposed() && !mine.has(m as Mesh)), ...mine];
    }
    const lamps = this.lamps;
    this.lamps = -1;
    if (lamps >= 0) this.setNight(lamps, this.glow);
    return this.casters;
  }

  private glow = new Color3(1, 0.8, 0.5);

  /** Every mesh currently drawn (including the foliage templates in use). */
  get all(): readonly Mesh[] {
    return this.drawn;
  }
  private drawn: Mesh[] = [];

  /** Removes what was built (the foliage templates are kept, hidden, for the next build). */
  clear(): void {
    for (const mesh of this.meshes) mesh.dispose(false, false);
    this.meshes = [];
    this.casters = [];
    this.drawn = [];
    this.key = '';
    for (const template of this.foliage.values()) {
      void template.then((t) => {
        if (this.key === '') for (const mesh of t.meshes) mesh.setEnabled(false);
      });
    }
  }

  /** Streetlights, porch lamps and window glass follow the lighting key's lamp level. */
  setNight(lamps: number, glow: Color3): void {
    this.house.setNight(lamps, glow);
    this.glow.copyFrom(glow);
    if (Math.abs(lamps - this.lamps) < 1e-3) return;
    this.lamps = lamps;
    const g = Math.min(1, Math.max(0, (lamps - 0.3) / 0.45));
    // Pale glass by day, a warm glow strong enough to bloom at night.
    this.glowMat.emissiveColor.set(0.62 + g * 1.7, 0.62 + g * 0.95, 0.58 + g * 0.2);
    this.poolMat.emissiveColor.set(0.62 * g, 0.46 * g, 0.26 * g);
  }

  // ---- helpers ----------------------------------------------------------------------------

  private layout(world: WorldStructure, view: ViewRect | null, streets: Rect[], paths: Rect[]): PlotLayout[] {
    const out: PlotLayout[] = [];
    for (const plot of world.plots) {
      // The street this plot faces: one of its z edges lies on a street edge.
      let edge: number | null = null;
      let front: 1 | -1 = 1;
      for (const st of streets) {
        if (plot.x + plot.w <= st.x || plot.x >= st.x + st.w) continue;
        if (Math.abs(plot.z + plot.d - st.z) < 0.05) [edge, front] = [plot.z + plot.d, 1];
        else if (Math.abs(plot.z - (st.z + st.d)) < 0.05) [edge, front] = [plot.z, -1];
      }
      if (edge === null) continue;
      const home = !!view && overlaps({ x: plot.x, z: plot.z, w: plot.w, d: plot.d }, view, -0.01);
      const inside = (r: Rect) => r.x >= plot.x - 0.01 && r.x + r.w <= plot.x + plot.w + 0.01 && r.z >= plot.z - 0.01 && r.z + r.d <= plot.z + plot.d + 0.01;
      const own = paths.filter(inside);
      const path = own.find((r) => r.w < DRIVEWAY_MIN_WIDTH);
      const drive = own.find((r) => r.w >= DRIVEWAY_MIN_WIDTH) ?? null;
      const [x0, z0, x1, z1] = plot.house ?? [0, 0, 0, 0];
      out.push({
        plot,
        kind: home ? 'home' : plot.public ? 'park' : plot.house ? 'house' : 'empty',
        front,
        edge,
        house: plot.house ? { x0, z0, x1, z1 } : null,
        door: path ? path.x + path.w / 2 : null,
        drive,
      });
    }
    return out;
  }

  /** A garage at the inner end of the driveway, beside the house, when it fits. */
  private garage(L: PlotLayout, blocked: Rect[]): SilhouetteSpec['garage'] {
    const d = L.drive;
    const h = L.house;
    if (!d || !h || hash(L.plot.x, L.plot.z, 50) > 0.7) return null;
    const { plot, front } = L;
    const toRight = d.x >= h.x1;
    let x0 = d.x - 0.15;
    let x1 = d.x + d.w + 0.15;
    if (toRight) {
      x0 = Math.max(x0, h.x1 + 0.35);
      x1 = Math.min(x1, plot.x + plot.w - 0.45);
    } else {
      x0 = Math.max(x0, plot.x + 0.45);
      x1 = Math.min(x1, h.x0 - 0.35);
    }
    if (x1 - x0 < 2.7) return null;
    const inner = front > 0 ? d.z : d.z + d.d;
    const [z0, z1] = front > 0 ? [inner - GARAGE_DEPTH, inner] : [inner, inner + GARAGE_DEPTH];
    if (z0 < plot.z + 0.8 || z1 > plot.z + plot.d - 0.8) return null;
    const r = { x: x0 - T, z: z0 - T, w: x1 - x0 + 2 * T, d: z1 - z0 + 2 * T };
    if (blocked.some((b) => overlaps(r, b, 0.1))) return null;
    return { x0, z0, x1, z1 };
  }

  /** A fence or hedge along a line, skipping stretches that would run through objects. */
  private edgeRun(style: 'picket' | 'hedge', props: Painter, hedges: [number, number, number, number, number][], x0: number, z0: number, x1: number, z1: number, blocked: Rect[]): void {
    const len = Math.hypot(x1 - x0, z1 - z0);
    if (len < 1) return;
    const step = 2;
    const n = Math.max(1, Math.round(len / step));
    let runStart: number | null = null;
    const flush = (end: number) => {
      if (runStart === null) return;
      const [a, b] = [runStart / n, end / n];
      const [ax, az, bx, bz] = [x0 + (x1 - x0) * a, z0 + (z1 - z0) * a, x0 + (x1 - x0) * b, z0 + (z1 - z0) * b];
      if (style === 'picket') pickets(props, ax, az, bx, bz);
      else {
        const l = Math.hypot(bx - ax, bz - az);
        const k = Math.max(1, Math.round(l / 1.05));
        const yaw = Math.abs(bx - ax) >= Math.abs(bz - az) ? 0 : Math.PI / 2;
        for (let i = 0; i < k; i++) {
          const t = (i + 0.5) / k;
          const [x, z] = [ax + (bx - ax) * t, az + (bz - az) * t];
          hedges.push([x, z, (l / k) / 1.05 * (1 + hash(x, z, 60) * 0.06), 0.85 + hash(x, z, 61) * 0.2, yaw + (hash(x, z, 62) < 0.5 ? 0 : Math.PI)]);
        }
      }
      runStart = null;
    };
    for (let i = 0; i < n; i++) {
      const [a, b] = [i / n, (i + 1) / n];
      const xs = [x0 + (x1 - x0) * a, x0 + (x1 - x0) * b];
      const zs = [z0 + (z1 - z0) * a, z0 + (z1 - z0) * b];
      const r = { x: Math.min(...xs) - 0.1, z: Math.min(...zs) - 0.1, w: Math.abs(xs[1] - xs[0]) + 0.2, d: Math.abs(zs[1] - zs[0]) + 0.2 };
      if (blocked.some((o) => overlaps(r, o))) flush(i);
      else runStart ??= i;
    }
    flush(n);
  }

  /** A soft pool of lamplight on the ground. */
  private pool(g: Geo, x: number, z: number, r: number): void {
    const y = 0.055;
    g.poly([[x - r, y, z - r], [x + r, y, z - r], [x + r, y, z + r], [x - r, y, z + r]], [0, 1, 0], [[0, 0], [1, 0], [1, 1], [0, 1]]);
  }

  /** Thin instances of a foliage model: [x, z, scale xz, scale y, yaw]. */
  private async instances(kind: FoliageKind, items: [number, number, number, number, number][]): Promise<Mesh[]> {
    let template = this.foliage.get(kind);
    if (!template) {
      const key = FOLIAGE[kind];
      template = buildModel(this.scene, `street:${kind}`, this.assets.has(key, 'model') ? (this.assets.get(key, 'model') as ModelEntry) : undefined, [1, 1]);
      this.foliage.set(kind, template);
    }
    const t = await template;
    const buf = new Float32Array(Math.max(1, items.length) * 16);
    items.forEach(([x, z, s, sy, yaw], i) => {
      Matrix.ComposeToRef(this.tmpS.set(s, sy, kind === 'hedge' ? 1 : s), Quaternion.RotationYawPitchRollToRef(yaw, 0, 0, this.tmpQ), this.tmpT.set(x, 0, z), this.tmpM);
      this.tmpM.copyToArray(buf, i * 16);
    });
    for (const mesh of t.meshes) {
      mesh.isPickable = false;
      mesh.receiveShadows = true;
      if (this.layerMask !== undefined) mesh.layerMask = this.layerMask;
      mesh.thinInstanceSetBuffer('matrix', buf, 16, true);
      mesh.thinInstanceCount = items.length;
      if (items.length) mesh.thinInstanceRefreshBoundingInfo(false);
      mesh.setEnabled(items.length > 0);
      mesh.freezeWorldMatrix();
    }
    return items.length ? t.meshes : [];
  }
}

