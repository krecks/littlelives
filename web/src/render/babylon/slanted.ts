/**
 * Geometry helpers for walls that aren't axis-aligned (diagonal walls, see `house.ts`):
 * a local wall frame, oriented boards, post outlines where walls of any direction meet, and a
 * hip roof over any convex outline (rooms with diagonal sides).
 *
 * Coordinates are world metres; 2D points are `[x, z]`. "Counter-clockwise" means with x to the
 * right and z up (ascending `atan2(z, x)`).
 */

import { type Geo, type V3 } from './geometry';

export type P2 = readonly [number, number];

/** Which half of a tile split by a diagonal a point lies in (0 touches the tile's -z side). */
export function halfAt(axis: 'dp' | 'dn', fx: number, fz: number): 0 | 1 {
  return axis === 'dp' ? (fz < fx ? 0 : 1) : fx + fz < 1 ? 0 : 1;
}

/** Corners (tile-local, 0..1) of half `h` of a tile split by a diagonal, counter-clockwise. */
export function halfTriangle(axis: 'dp' | 'dn', h: 0 | 1): P2[] {
  if (axis === 'dp')
    return h === 0
      ? [
          [0, 0],
          [1, 0],
          [1, 1],
        ]
      : [
          [0, 0],
          [1, 1],
          [0, 1],
        ];
  return h === 0
    ? [
        [0, 0],
        [1, 0],
        [0, 1],
      ]
    : [
        [1, 0],
        [1, 1],
        [0, 1],
      ];
}

/** Centre (tile-local) of half `h` of a split tile. */
export function halfCentroid(axis: 'dp' | 'dn', h: 0 | 1): P2 {
  const t = halfTriangle(axis, h);
  return [(t[0][0] + t[1][0] + t[2][0]) / 3, (t[0][1] + t[1][1] + t[2][1]) / 3];
}

/** End points of the diagonal across tile (x, z): `dp` from (x, z), `dn` from (x, z + 1). */
export function diagonalEnds(axis: 'dp' | 'dn', x: number, z: number): [P2, P2] {
  return axis === 'dp'
    ? [
        [x, z],
        [x + 1, z + 1],
      ]
    : [
        [x, z + 1],
        [x + 1, z],
      ];
}

/**
 * A wall's local frame: `a` metres along it from `origin`, `d` metres across (towards `n`, the
 * left-hand normal of the direction `u`), `y` up.
 */
export class WallFrame {
  readonly ux: number;
  readonly uz: number;
  readonly nx: number;
  readonly nz: number;
  readonly length: number;

  constructor(
    readonly ox: number,
    readonly oz: number,
    toX: number,
    toZ: number,
  ) {
    const dx = toX - ox;
    const dz = toZ - oz;
    this.length = Math.hypot(dx, dz);
    this.ux = dx / this.length;
    this.uz = dz / this.length;
    this.nx = -this.uz;
    this.nz = this.ux;
  }

  at(a: number, y: number, d: number): V3 {
    return [this.ox + this.ux * a + this.nx * d, y, this.oz + this.uz * a + this.nz * d];
  }

  /** Unit normal of the side `sign` (+1: towards `n`, -1: away from it). */
  normal(sign: number): V3 {
    return [this.nx * sign, 0, this.nz * sign];
  }

  /** Texture coordinate along the wall that lines up across a straight run of segments. */
  u(p: V3): number {
    return p[0] * this.ux + p[2] * this.uz;
  }

  /**
   * An oriented box: `a0..a1` along, `y0..y1` up, `d0..d1` across. `skip` lists faces to omit:
   * 'pa'/'na' (ends), 'pd'/'nd' (sides), 'py'/'ny' (top/bottom).
   */
  box(g: Geo, a0: number, a1: number, y0: number, y1: number, d0: number, d1: number, skip = ''): void {
    const P = (a: number, y: number, d: number) => this.at(a, y, d);
    const uv = (pts: V3[], along: boolean) => pts.map((p) => [along ? this.u(p) : p[0] * this.nx + p[2] * this.nz, p[1]] as [number, number]);
    if (!skip.includes('py')) g.poly([P(a0, y1, d0), P(a1, y1, d0), P(a1, y1, d1), P(a0, y1, d1)], [0, 1, 0]);
    if (!skip.includes('ny')) g.poly([P(a0, y0, d0), P(a1, y0, d0), P(a1, y0, d1), P(a0, y0, d1)], [0, -1, 0]);
    const side = (d: number, sign: number) => {
      const pts = [P(a0, y0, d), P(a1, y0, d), P(a1, y1, d), P(a0, y1, d)];
      g.poly(pts, this.normal(sign), uv(pts, true));
    };
    if (!skip.includes('pd')) side(d1, 1);
    if (!skip.includes('nd')) side(d0, -1);
    const end = (a: number, sign: number) => {
      const pts = [P(a, y0, d0), P(a, y0, d1), P(a, y1, d1), P(a, y1, d0)];
      g.poly(pts, [this.ux * sign, 0, this.uz * sign], uv(pts, false));
    };
    if (!skip.includes('pa')) end(a1, 1);
    if (!skip.includes('na')) end(a0, -1);
  }

  /** A rectangle on the wall plane at offset `d` (facing side `sign`), with UVs along the wall. */
  face(g: Geo, a0: number, a1: number, y0: number, y1: number, d: number, sign: number, alphas?: number[]): void {
    const pts = [this.at(a0, y0, d), this.at(a1, y0, d), this.at(a1, y1, d), this.at(a0, y1, d)];
    g.poly(
      pts,
      this.normal(sign),
      pts.map((p) => [this.u(p), p[1]] as [number, number]),
      alphas,
    );
  }
}

/**
 * Outline of the post where walls meet at grid corner `p`: each wall (unit direction, ascending
 * angle) is `t` thick and starts `t` from the corner. Neighbouring walls are joined by mitres; a
 * free end (or a gap of more than 270°) is closed square. Returns the outline counter-clockwise.
 */
export function postOutline(p: P2, dirs: readonly P2[], t: number): P2[] {
  const out: P2[] = [];
  const n = dirs.length;
  const ang = dirs.map(([x, z]) => Math.atan2(z, x));
  for (let i = 0; i < n; i++) {
    const [ux, uz] = dirs[i];
    const [lx, lz] = [-uz, ux];
    out.push([p[0] + ux * t - lx * t, p[1] + uz * t - lz * t]);
    out.push([p[0] + ux * t + lx * t, p[1] + uz * t + lz * t]);
    const j = (i + 1) % n;
    let gap = ang[j] - ang[i];
    if (gap <= 1e-6) gap += Math.PI * 2;
    const [vx, vz] = dirs[j];
    const [mx, mz] = [-vz, vx];
    if (Math.abs(gap - Math.PI) < 1e-3) continue;
    if (gap < Math.PI * 1.5 + 1e-3) {
      // Mitre: the left face of wall i meets the right face of wall j.
      const ax = p[0] + lx * t;
      const az = p[1] + lz * t;
      const bx = p[0] - mx * t;
      const bz = p[1] - mz * t;
      const den = ux * vz - uz * vx;
      if (Math.abs(den) < 1e-9) continue;
      const k = ((bx - ax) * vz - (bz - az) * vx) / den;
      out.push([ax + ux * k, az + uz * k]);
    } else {
      // Square back: wall i's left face and wall j's right face carried behind the corner.
      out.push([p[0] - ux * t + lx * t, p[1] - uz * t + lz * t]);
      out.push([p[0] - vx * t - mx * t, p[1] - vz * t - mz * t]);
    }
  }
  return out;
}

/** Signed area (positive counter-clockwise). */
export function area(poly: readonly P2[]): number {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x0, z0] = poly[i];
    const [x1, z1] = poly[(i + 1) % poly.length];
    s += x0 * z1 - x1 * z0;
  }
  return s / 2;
}

/** Convex hull, counter-clockwise, without collinear points (monotone chain). */
export function convexHull(points: readonly P2[]): P2[] {
  const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length < 3) return pts;
  const cross = (o: P2, a: P2, b: P2) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: P2[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 1e-9) lower.pop();
    lower.push(p);
  }
  const upper: P2[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 1e-9) upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

/** Keeps the part of a convex polygon where `a·x + b·z + c <= 0` (Sutherland–Hodgman, one plane). */
function clip(poly: P2[], a: number, b: number, c: number): P2[] {
  const out: P2[] = [];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    const fp = a * p[0] + b * p[1] + c;
    const fq = a * q[0] + b * q[1] + c;
    if (fp <= 0) out.push(p);
    if ((fp < 0 && fq > 0) || (fp > 0 && fq < 0)) {
      const t = fp / (fp - fq);
      out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
    }
  }
  return out;
}

/** Offsets a convex counter-clockwise polygon outwards by `d` (mitred corners). */
export function offsetConvex(poly: readonly P2[], d: number): P2[] {
  const n = poly.length;
  const lines = poly.map((p, i) => {
    const q = poly[(i + 1) % n];
    const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
    const ox = (q[1] - p[1]) / len; // outward normal (right-hand side of a CCW edge)
    const oz = -(q[0] - p[0]) / len;
    return { px: p[0] + ox * d, pz: p[1] + oz * d, dx: (q[0] - p[0]) / len, dz: (q[1] - p[1]) / len };
  });
  return lines.map((l, i) => {
    const m = lines[(i + n - 1) % n];
    // Intersection of the previous edge's line with this one's.
    const den = m.dx * l.dz - m.dz * l.dx;
    if (Math.abs(den) < 1e-9) return [l.px, l.pz] as P2;
    const k = ((l.px - m.px) * l.dz - (l.pz - m.pz) * l.dx) / den;
    return [m.px + m.dx * k, m.pz + m.dz * k] as P2;
  });
}

/**
 * Hip roof over a convex counter-clockwise outline of wall centre lines: every eave slopes up
 * at `pitch` and the facets meet in hips and ridges (the roof height is the eave height plus
 * `pitch` × the distance to the nearest eave, which for a convex outline is exactly a hip roof).
 * Like `addRoof`, the underside passes through the outer top edge of the walls (`t` = half wall
 * thickness) and overhangs by `overhang`. Shingles go into `roof`, soffits and fascias into `trim`.
 */
export function addHipPolygon(outline: readonly P2[], roof: Geo, trim: Geo, base: number, t: number, overhang: number, pitch: number, thickness: number): void {
  const eaves = offsetConvex(outline, t + overhang);
  const n = eaves.length;
  if (n < 3) return;
  const ye = base - overhang * pitch;
  const slope = Math.sqrt(1 + pitch * pitch);
  // Edge i: inward unit normal (ix, iz) and offset so that dist_i(p) = ix*x + iz*z + c_i.
  const edges = eaves.map((p, i) => {
    const q = eaves[(i + 1) % n];
    const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
    const dx = (q[0] - p[0]) / len;
    const dz = (q[1] - p[1]) / len;
    const ix = -dz;
    const iz = dx;
    return { p, q, dx, dz, ix, iz, c: -(ix * p[0] + iz * p[1]) };
  });
  for (let i = 0; i < n; i++) {
    const e = edges[i];
    // The facet of edge i: where its distance is the smallest of all edges.
    let facet: P2[] = [...eaves];
    for (let j = 0; j < n && facet.length >= 3; j++) {
      if (j === i) continue;
      const f = edges[j];
      facet = clip(facet, e.ix - f.ix, e.iz - f.iz, e.c - f.c);
    }
    if (facet.length < 3 || Math.abs(area(facet)) < 1e-4) continue;
    const dist = (p: P2) => Math.max(0, e.ix * p[0] + e.iz * p[1] + e.c);
    const bottom = facet.map((p) => [p[0], ye + pitch * dist(p), p[1]] as V3);
    const top = bottom.map((p) => [p[0], p[1] + thickness, p[2]] as V3);
    const len = Math.hypot(pitch, 1);
    const up: V3 = [(-e.ix * pitch) / len, 1 / len, (-e.iz * pitch) / len];
    roof.poly(
      top,
      up,
      facet.map((p) => [p[0] * e.dx + p[1] * e.dz, dist(p) * slope] as [number, number]),
    );
    trim.poly(bottom, [-up[0], -up[1], -up[2]]);
    // Fascia board along the eave.
    const out: V3 = [-e.ix, 0, -e.iz];
    trim.poly(
      [
        [e.p[0], ye, e.p[1]],
        [e.q[0], ye, e.q[1]],
        [e.q[0], ye + thickness, e.q[1]],
        [e.p[0], ye + thickness, e.p[1]],
      ],
      out,
    );
  }
}
