/**
 * Dresses the viewed lot's structure like a family home: walls with exterior siding or brick
 * and interior wallpaper (tinted per room), corner posts, stone plinth, trims, baseboards,
 * windows with frames and shutters, door casings, per-room floors (wood, tile, carpet), fake
 * contact shadows along walls, and pitched roofs (gable or hip) whose eaves rest on the walls.
 * The viewed house's windows are clear, alpha-blended glass, so its rooms show from outside.
 * Neighbouring houses are dressed boxes (`silhouettes`): their own doors and windows (with
 * curtains, glowing at night), porches, chimneys and garages; `street.ts` lays out the rest.
 *
 * Wall layout comes from the simulation's structure (`WorldStructure.walls`: every wall edge;
 * `openings`: doors and windows placed in them), so build-mode edits arrive as new structures.
 * Every wall vertex carries cutaway data (`geometry.ts`); the vertex shader lowers walls
 * between the camera and the rooms behind them, so the cutaway costs no CPU.
 *
 * Everything is generated in a few milliseconds per structure and merged into one mesh per
 * material (about 15 draw calls for a whole house).
 */

import { Color3, type Material, type Mesh, type PBRMaterial, type Scene } from '@babylonjs/core';
import type { Opening, WorldStructure } from '../../core/protocol';
import type { ViewRect } from '../types';
import { Cut, facing, Geo, LOOK, type V3 } from './geometry';
import { MaterialLibrary } from './materials';

export const WALL_HEIGHT = 2.8;
export const WALL_STUB = 0.35;
const T = 0.07; // half wall thickness (sim-core WALL_THICKNESS / 2)
const DOOR_HEIGHT = 2.1;
const PLINTH = 0.32;
// Window opening (matches sim-core `WINDOW_SILL` / `WINDOW_HEAD`); the glazed part is narrower
// than the edge, with wall piers either side.
const SILL = 0.9;
const HEAD = 2.1;
const WIN_INSET = 0.12;
const PITCH = Math.tan((34 * Math.PI) / 180);
const OVERHANG = 0.4;
const ROOF_THICKNESS = 0.14;

/** Asset keys of the surfaces used; all are swappable through the manifest. */
export const HOUSE_MATERIALS = {
  siding: 'material.wall.siding',
  brick: 'material.wall.brick',
  interior: 'material.wall.interior',
  stone: 'material.wall.stone',
  trim: 'material.trim',
  roof: 'material.roof',
  glass: 'material.window',
  glassInner: 'material.window.inner',
  /** See-through glazing of the viewed house (alpha-blended, fresnel reflections). */
  clearGlass: 'material.window.clear',
  floorWood: 'material.floor.wood',
  floorTile: 'material.floor.tile',
  floorCarpet: 'material.floor.carpet',
  door: 'material.door',
} as const;

// Colour schemes (sRGB) chosen per house from its position, so a house always looks the same.
const SIDING = ['#ECE6D8', '#C9D8C4', '#BCD0E0', '#EADBA8', '#D9C6B2', '#F4F2EC', '#A9BBA8', '#E6C9B8'];
const BRICK = ['#FFFFFF', '#E8D8CC', '#D6C2B4'];
const ACCENT = ['#3E5A4A', '#2F4058', '#7A3B34', '#4A4A4A', '#5B6E86', '#6E5A3E'];
const ROOF = ['#5C626A', '#6B4A3A', '#8C4E3C', '#4F5A4C', '#3E4148', '#7A6A5A'];
const TRIM = '#F7F5F0';
const ROOM_WALLS: Record<RoomKind, string[]> = {
  living: ['#EFE3D3', '#E6DECF', '#EAE2D8', '#DCE3E6'],
  bedroom: ['#D8E2D0', '#DCD6E6', '#E6D4C8', '#D2DDE8'],
  bath: ['#DCE8EC', '#E6EEF0', '#E8E4F0'],
  kitchen: ['#F2E6CF', '#EFE8D6', '#E8EDDE'],
};
const CARPET = ['#B8AE9C', '#9FAAB8', '#B49C8C', '#A8B29A', '#C4B4A8'];
/** Curtain colours seen through neighbours' windows. */
const CURTAINS = ['#F2EDE0', '#E8D9B8', '#C9D6E2', '#E2C4BE', '#F4F1EA', '#E6E0C8'];
/** Wall height of a garage (lower than the house). */
const GARAGE_HEIGHT = 2.5;

type RoomKind = 'living' | 'bedroom' | 'bath' | 'kitchen';

const BATH = ['toilet', 'shower', 'bathtub'];
const KITCHEN = ['fridge', 'sink', 'stove', 'counter', 'diningTable'];
const BEDROOM = ['bed'];
const LIVING = ['sofa', 'tv', 'armchair', 'bookshelf', 'computerDesk', 'piano'];

export interface RoomLight {
  x: number;
  y: number;
  z: number;
  /** Indoor area in tiles (bigger rooms get a brighter, wider light). */
  area: number;
}

export interface HouseBuild {
  meshes: Mesh[];
  /** Shadow casters. */
  casters: Mesh[];
  /** Roofs and gables: drawn only with walls up. */
  roofs: Mesh[];
  /** One light per room (largest rooms first), at a lamp if the room has one. */
  lights: RoomLight[];
  /** Garden dressing: shrubs along the foundation and trees on open lawn (x, z, scale, yaw). */
  shrubs: [number, number, number, number][];
  trees: [number, number, number, number][];
}

type EdgeKind = 'wall' | 'door' | 'window';

/** A neighbouring house drawn as a dressed box (see `HouseBuilder.silhouettes`). */
export interface SilhouetteSpec {
  /** Wall bounding box (grid lines). */
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  /** Street side: 1 = the wall at z1 faces the street, -1 = the wall at z0. */
  front: 1 | -1;
  /** Centre x of the front door (where the garden path meets the house), if known. */
  door: number | null;
  /** Garage beside the house (wall centre lines), its door facing the street. */
  garage: { x0: number; z0: number; x1: number; z1: number } | null;
}

export interface SilhouetteBuild {
  meshes: Mesh[];
  casters: Mesh[];
  /** Porch and garage lamps: x, y, z and the wall's outward normal (nx, nz). */
  lamps: [number, number, number, number, number][];
}

/** Wall edges of the lot: `h` edges run along x at a grid line z, `v` edges along z. */
class Edges {
  private readonly h = new Map<number, EdgeKind>();
  private readonly v = new Map<number, EdgeKind>();
  constructor(private readonly stride: number) {}
  private key(x: number, z: number): number {
    return (z + 2) * this.stride + x + 2;
  }
  set(axis: 'h' | 'v', x: number, z: number, kind: EdgeKind): void {
    (axis === 'h' ? this.h : this.v).set(this.key(x, z), kind);
  }
  get(axis: 'h' | 'v', x: number, z: number): EdgeKind | undefined {
    return (axis === 'h' ? this.h : this.v).get(this.key(x, z));
  }
  *all(axis: 'h' | 'v'): Generator<[number, number, EdgeKind]> {
    for (const [k, kind] of axis === 'h' ? this.h : this.v) {
      yield [(k % this.stride) - 2, Math.floor(k / this.stride) - 2, kind];
    }
  }
}

function hash(x: number, z: number, salt: number): number {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(z | 0, 668265263) + Math.imul(salt, 2147483647)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function pick<T>(list: readonly T[], x: number, z: number, salt: number): T {
  return list[Math.floor(hash(x, z, salt) * list.length) % list.length];
}

/** Look of one house, chosen deterministically from its position. */
export interface HouseScheme {
  brick: boolean;
  wall: string;
  accent: string;
  roof: string;
  hip: boolean;
  shutters: boolean;
  seedX: number;
  seedZ: number;
}

export function houseScheme(x: number, z: number): HouseScheme {
  const brick = hash(x, z, 1) < 0.3;
  return {
    brick,
    wall: brick ? pick(BRICK, x, z, 2) : pick(SIDING, x, z, 2),
    accent: pick(ACCENT, x, z, 3),
    roof: pick(ROOF, x, z, 4),
    hip: hash(x, z, 5) < 0.45,
    shutters: hash(x, z, 6) < 0.6,
    seedX: x,
    seedZ: z,
  };
}

export class HouseBuilder {
  private readonly lib: MaterialLibrary;

  constructor(private readonly scene: Scene) {
    this.lib = MaterialLibrary.for(scene);
  }

  /** Materials (cached by the library) so the renderer can update window glow etc. */
  material(key: string, cut = true): Material {
    return this.lib.surface(key, { vertexColors: true, cutaway: cut });
  }

  /**
   * Night look of the viewed house's clear glass: a faint warm sheen once the lamps are on
   * (the lit rooms themselves show through it). `lamps` is the lighting key's lamp level.
   */
  setNight(lamps: number, glow: Color3): void {
    const mat = this.material(HOUSE_MATERIALS.clearGlass) as PBRMaterial;
    const g = Math.min(1, Math.max(0, (lamps - 0.35) / 0.5));
    glow.scaleToRef(g * g * 0.35, this.glassGlow);
    if (mat.emissiveColor.equals(this.glassGlow)) return;
    mat.emissiveColor.copyFrom(this.glassGlow);
    this.lib.touch(mat);
  }
  private readonly glassGlow = new Color3();

  build(world: WorldStructure, view: ViewRect | null): HouseBuild | null {
    if (!world.walls || !world.openings) return null;
    const W = world.width;
    const D = world.depth;
    const room = (x: number, z: number) => (x >= 0 && z >= 0 && x < W && z < D ? world.rooms[z * W + x] : 0);
    const inView = (x: number, z: number) => !view || (x >= view.x && z >= view.z && x < view.x + view.w && z < view.z + view.d);

    // ---- wall edges in view (inclusive of the view's boundary lines) ------------------
    const edges = new Edges(W + 8);
    const edgeInView = (e: { axis: 'h' | 'v'; x: number; z: number }) =>
      !view ||
      (e.axis === 'h'
        ? e.x >= view.x && e.x < view.x + view.w && e.z >= view.z && e.z <= view.z + view.d
        : e.x >= view.x && e.x <= view.x + view.w && e.z >= view.z && e.z < view.z + view.d);
    for (const e of world.walls) if (edgeInView(e)) edges.set(e.axis, e.x, e.z, 'wall');
    for (const o of world.openings) if (edgeInView(o)) edges.set(o.axis, o.x, o.z, o.kind);

    // ---- rooms: kind (from the objects in them), colours, lights --------------------
    const shown = world.objects.filter((o) => inView(o.x, o.z));
    const occupied = new Set<number>();
    const roomDefs = new Map<number, Set<string>>();
    const lamps = new Map<number, { x: number; z: number }>();
    for (const o of shown) {
      for (let z = o.z; z < o.z + o.d; z++) {
        for (let x = o.x; x < o.x + o.w; x++) {
          occupied.add(z * W + x);
          const r = room(x, z);
          if (r === 0) continue;
          if (!roomDefs.has(r)) roomDefs.set(r, new Set());
          roomDefs.get(r)!.add(o.def);
          if (o.def === 'lamp') lamps.set(r, { x: o.x + o.w / 2, z: o.z + o.d / 2 });
        }
      }
    }
    const scheme = houseScheme(view?.x ?? 0, view?.z ?? 0);
    // Open-plan rooms that mix kinds get the living-room look (wood floor).
    const kindOf = (r: number): RoomKind => {
      const defs = roomDefs.get(r);
      if (!defs) return 'living';
      const has = (ids: string[]) => ids.some((id) => defs.has(id));
      if (has(BATH)) return 'bath';
      if (has(LIVING)) return 'living';
      if (has(BEDROOM) && !has(KITCHEN)) return 'bedroom';
      if (has(KITCHEN) && !has(BEDROOM)) return 'kitchen';
      return 'living';
    };
    const kinds = new Map<number, RoomKind>();
    const roomTiles = new Map<number, { n: number; sx: number; sz: number }>();
    let minX = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxZ = -Infinity;
    for (let z = 0; z < D; z++) {
      for (let x = 0; x < W; x++) {
        const r = room(x, z);
        if (r === 0 || !inView(x, z)) continue;
        if (!kinds.has(r)) kinds.set(r, kindOf(r));
        const t = roomTiles.get(r) ?? { n: 0, sx: 0, sz: 0 };
        t.n++;
        t.sx += x + 0.5;
        t.sz += z + 0.5;
        roomTiles.set(r, t);
        minX = Math.min(minX, x);
        minZ = Math.min(minZ, z);
        maxX = Math.max(maxX, x + 1);
        maxZ = Math.max(maxZ, z + 1);
      }
    }
    const sx = scheme.seedX;
    const sz = scheme.seedZ;
    const roomWall = (r: number) => {
      const kind = kinds.get(r) ?? 'living';
      return pick(ROOM_WALLS[kind], sx + r, sz, 11 + r);
    };
    const lights: RoomLight[] = [...roomTiles.entries()]
      .sort((a, b) => b[1].n - a[1].n)
      .map(([r, t]) => {
        const lamp = lamps.get(r);
        return lamp ? { x: lamp.x, y: 1.6, z: lamp.z, area: t.n } : { x: t.sx / t.n, y: 2.45, z: t.sz / t.n, area: t.n };
      });

    // ---- geometry buckets (one draw call each) --------------------------------------
    const ext = new Geo().color(scheme.wall);
    const int = new Geo();
    const wainscot = new Geo();
    const stone = new Geo();
    const trim = new Geo().color(TRIM);
    const glass = new Geo();
    const ao = new Geo().color('#000000');

    const H = WALL_HEIGHT;
    /** Looking along which directions this edge hides the room behind it. */
    const edgeMask = (axis: 'h' | 'v', x: number, z: number): number => {
      if (axis === 'h') return (room(x, z) ? LOOK.PosZ : 0) | (room(x, z - 1) ? LOOK.NegZ : 0);
      return (room(x, z) ? LOOK.PosX : 0) | (room(x - 1, z) ? LOOK.NegX : 0);
    };

    /**
     * One wall face (a rectangle on the plane of a wall side) from `a0` to `a1` along the
     * wall, `y0` to `y1` high. `n` is the outward normal; `tile` the tile that face looks into.
     */
    const face = (axis: 'h' | 'v', plane: number, a0: number, a1: number, y0: number, y1: number, n: V3, tileX: number, tileZ: number) => {
      const r = room(tileX, tileZ);
      const P = (a: number, y: number): V3 => (axis === 'h' ? [a, y, plane] : [plane, y, a]);
      if (r === 0) {
        // Exterior: stone plinth below, siding/brick above, frieze board under the eaves.
        const Q = (a: number, y: number, d: number): V3 => (axis === 'h' ? [a, y, plane + n[2] * d] : [plane + n[0] * d, y, a]);
        if (y0 < PLINTH) {
          const out = 0.03;
          stone.poly([P(a0, y0), P(a1, y0), P(a1, Math.min(PLINTH, y1)), P(a0, Math.min(PLINTH, y1))], n);
          stone.poly([Q(a0, PLINTH, 0), Q(a1, PLINTH, 0), Q(a1, PLINTH, out), Q(a0, PLINTH, out)], [0, 1, 0]);
          stone.poly([Q(a0, y0, out), Q(a1, y0, out), Q(a1, PLINTH, out), Q(a0, PLINTH, out)], n);
        }
        const yb = Math.max(y0, PLINTH);
        if (y1 > yb) ext.poly([P(a0, yb), P(a1, yb), P(a1, y1), P(a0, y1)], n);
        if (y1 >= H - 0.01) {
          const k = trim.kind;
          trim.kind = Cut.Hide;
          trim.box(...span(axis, plane, n, a0, a1, H - 0.2, H, 0.025));
          trim.kind = k;
        }
        if (y0 < 0.01) ao.poly([Q(a0, 0.012, 0), Q(a1, 0.012, 0), Q(a1, 0.012, 0.45), Q(a0, 0.012, 0.45)], [0, 1, 0], undefined, [0.32, 0.32, 0, 0]);
        return;
      }
      const tint = roomWall(r);
      const bath = kinds.get(r) === 'bath';
      // Bathrooms are tiled up to 1.25 m (only the part of this face below that).
      const split = bath ? Math.min(Math.max(1.25, y0), y1) : y0;
      if (split > y0) wainscot.color('#F4F4F2').poly([P(a0, y0), P(a1, y0), P(a1, split), P(a0, split)], n);
      if (y1 > split) int.color(tint).poly([P(a0, split), P(a1, split), P(a1, y1), P(a0, y1)], n);
      if (y0 < 0.01) {
        trim.box(...span(axis, plane, n, a0, a1, 0, 0.1, 0.014));
        const Q = (a: number, d: number): V3 => (axis === 'h' ? [a, 0.013, plane + n[2] * d] : [plane + n[0] * d, 0.013, a]);
        ao.poly([Q(a0, 0.014), Q(a1, 0.014), Q(a1, 0.34), Q(a0, 0.34)], [0, 1, 0], undefined, [0.3, 0.3, 0, 0]);
      }
    };

    /**
     * Both faces, the cap and the cutaway data of one wall segment, from `s0` to `s1` along
     * the edge (default: the whole edge between the posts). `cap: false` skips the top.
     */
    const segment = (axis: 'h' | 'v', x: number, z: number, y0: number, y1: number, kind: number, s0?: number, s1?: number, cap = true) => {
      const mask = edgeMask(axis, x, z);
      for (const g of [ext, int, wainscot, stone, trim, ao]) g.cutting(kind, mask);
      const a0 = s0 ?? (axis === 'h' ? x : z) + T;
      const a1 = s1 ?? (axis === 'h' ? x : z) + 1 - T;
      if (axis === 'h') {
        face('h', z - T, a0, a1, y0, y1, [0, 0, -1], x, z - 1);
        face('h', z + T, a0, a1, y0, y1, [0, 0, 1], x, z);
        if (cap) trim.box(a0, y1 - 0.001, z - T, a1, y1, z + T, 'ny nx px nz pz');
      } else {
        face('v', x - T, a0, a1, y0, y1, [-1, 0, 0], x - 1, z);
        face('v', x + T, a0, a1, y0, y1, [1, 0, 0], x, z);
        if (cap) trim.box(x - T, y1 - 0.001, a0, x + T, y1, a1, 'ny nx px nz pz');
      }
    };

    /** A wall with a window: solid below the sill and above the head, piers either side. */
    const windowWall = (axis: 'h' | 'v', x: number, z: number) => {
      const base = axis === 'h' ? x : z;
      const g0 = base + WIN_INSET;
      const g1 = base + 1 - WIN_INSET;
      segment(axis, x, z, 0, SILL, Cut.Clamp);
      segment(axis, x, z, HEAD, H, Cut.Hide);
      segment(axis, x, z, SILL, HEAD, Cut.Hide, undefined, g0, false);
      segment(axis, x, z, SILL, HEAD, Cut.Hide, g1, undefined, false);
      // Reveals: the jambs and the head's underside, in trim.
      const P = (a: number, y: number, d: number): V3 => (axis === 'h' ? [a, y, z + d] : [x + d, y, a]);
      const na: V3 = axis === 'h' ? [1, 0, 0] : [0, 0, 1];
      trim.poly([P(g0, SILL, -T), P(g0, SILL, T), P(g0, HEAD, T), P(g0, HEAD, -T)], na);
      trim.poly([P(g1, SILL, -T), P(g1, HEAD, -T), P(g1, HEAD, T), P(g1, SILL, T)], [-na[0], 0, -na[2]]);
      trim.poly([P(g0, HEAD, -T), P(g0, HEAD, T), P(g1, HEAD, T), P(g1, HEAD, -T)], [0, -1, 0]);
    };

    /**
     * Whether the wall continues plainly past one end of an edge (`end` 0: the start, 1: the
     * far end): the next edge on the line is a plain wall and no wall meets at that corner.
     * Shutters only go where there is room for them.
     */
    const plainEnd = (axis: 'h' | 'v', x: number, z: number, end: 0 | 1): boolean => {
      const step = end ? 1 : -1;
      const next = axis === 'h' ? edges.get('h', x + step, z) : edges.get('v', x, z + step);
      const nx = axis === 'h' ? x + end : x;
      const nz = axis === 'h' ? z : z + end;
      const cross = axis === 'h' ? edges.get('v', nx, nz) ?? edges.get('v', nx, nz - 1) : edges.get('h', nx, nz) ?? edges.get('h', nx - 1, nz);
      return next === 'wall' && cross === undefined;
    };

    // Wall segments, lintels, door casings, windows.
    const bounds = view ?? { x: 0, z: 0, w: W, d: D };
    for (const axis of ['h', 'v'] as const) {
      for (const [x, z, kind] of edges.all(axis)) {
        if (kind === 'wall') {
          segment(axis, x, z, 0, H, Cut.Clamp);
        } else if (kind === 'window') {
          windowWall(axis, x, z);
          this.window(axis, x, z, edgeMask(axis, x, z), room, scheme, trim, glass, [plainEnd(axis, x, z, 0), plainEnd(axis, x, z, 1)]);
        } else {
          segment(axis, x, z, DOOR_HEIGHT, H, Cut.Hide);
          this.doorway(axis, x, z, edgeMask(axis, x, z), trim, room, scheme);
        }
      }
    }

    // Posts at grid nodes where walls meet or end; they fill corners and show the wall ends.
    for (let z = bounds.z; z <= bounds.z + bounds.d; z++) {
      for (let x = bounds.x; x <= bounds.x + bounds.w; x++) {
        const hl = edges.get('h', x - 1, z);
        const hr = edges.get('h', x, z);
        const vd = edges.get('v', x, z - 1);
        const vu = edges.get('v', x, z);
        if (!hl && !hr && !vd && !vu) continue;
        let maskH: number = LOOK.All;
        let maskV: number = LOOK.All;
        if (hl) maskH &= edgeMask('h', x - 1, z);
        if (hr) maskH &= edgeMask('h', x, z);
        if (vd) maskV &= edgeMask('v', x, z - 1);
        if (vu) maskV &= edgeMask('v', x, z);
        for (const g of [ext, int, wainscot, stone, trim, ao]) g.cutting(Cut.Clamp, maskH, maskV);
        trim.box(x - T, H - 0.001, z - T, x + T, H, z + T, 'ny nx px nz pz');
        // Faces towards a door are jambs. Faces towards a wall sit inside it while it stands and
        // close its end when that wall is cut but the post is not.
        const side = (dir: 'px' | 'nx' | 'pz' | 'nz', e: EdgeKind | undefined, n: V3, tx: number, tz: number, tx2: number, tz2: number) => {
          const axis = dir[1] === 'x' ? 'v' : 'h';
          const plane = dir === 'px' ? x + T : dir === 'nx' ? x - T : dir === 'pz' ? z + T : z - T;
          const a0 = axis === 'v' ? z - T : x - T;
          const a1 = axis === 'v' ? z + T : x + T;
          if (e === 'door') {
            trim.poly(
              axis === 'v'
                ? [[plane, 0, a0], [plane, 0, a1], [plane, DOOR_HEIGHT, a1], [plane, DOOR_HEIGHT, a0]]
                : [[a0, 0, plane], [a1, 0, plane], [a1, DOOR_HEIGHT, plane], [a0, DOOR_HEIGHT, plane]],
              n,
            );
            return;
          }
          // Free end or outer corner: exterior if either tile on that side is outdoors.
          const outdoor = room(tx, tz) === 0 || room(tx2, tz2) === 0;
          const tile = outdoor ? (room(tx, tz) === 0 ? [tx, tz] : [tx2, tz2]) : [tx, tz];
          face(axis, plane, a0, a1, 0, H, n, tile[0], tile[1]);
        };
        side('px', hr, [1, 0, 0], x, z - 1, x, z);
        side('nx', hl, [-1, 0, 0], x - 1, z - 1, x - 1, z);
        side('pz', vu, [0, 0, 1], x - 1, z, x, z);
        side('nz', vd, [0, 0, -1], x - 1, z - 1, x, z - 1);
        // Corner boards where an outside corner turns.
        this.cornerBoards(x, z, { hl, hr, vd, vu }, room, trim);
      }
    }

    // ---- floors per room kind --------------------------------------------------------
    const wood = new Geo();
    const tile = new Geo();
    const carpet = new Geo();
    const carpetTint = pick(CARPET, sx, sz, 21);
    for (let z = bounds.z; z < bounds.z + bounds.d; z++) {
      for (let x = bounds.x; x < bounds.x + bounds.w; x++) {
        const r = room(x, z);
        if (r === 0) continue;
        const kind = kinds.get(r) ?? 'living';
        const g = kind === 'bath' || kind === 'kitchen' ? tile.color(kind === 'bath' ? '#F4F4F2' : '#E6DCCB') : kind === 'bedroom' ? carpet.color(carpetTint) : wood;
        g.poly([[x, 0.01, z], [x + 1, 0.01, z], [x + 1, 0.01, z + 1], [x, 0.01, z + 1]], [0, 1, 0]);
      }
    }

    // ---- roofs over the indoor area --------------------------------------------------
    const roof = new Geo().color(scheme.roof);
    const roofTrim = new Geo().color(TRIM);
    const gables = new Geo().color(scheme.wall);
    if (Number.isFinite(minX)) {
      for (const rect of indoorRects(room, minX, minZ, maxX, maxZ)) {
        addRoof(rect, scheme.hip, roof, roofTrim, gables);
      }
    }

    // ---- garden: foundation shrubs and a few lot trees --------------------------------
    const paths = [...(world.meta?.paths ?? []), ...(world.meta?.streets ?? [])];
    const paved = (x: number, z: number) => paths.some((r) => x >= r.x - 0.6 && x < r.x + r.w + 0.6 && z >= r.z - 0.6 && z < r.z + r.d + 0.6);
    const free = (x: number, z: number) => inView(Math.floor(x), Math.floor(z)) && room(Math.floor(x), Math.floor(z)) === 0 && !occupied.has(Math.floor(z) * W + Math.floor(x)) && !paved(x, z);
    const shrubs: [number, number, number, number][] = [];
    for (const axis of ['h', 'v'] as const) {
      for (const [x, z, kind] of edges.all(axis)) {
        if (kind === 'door') continue;
        const near = (dx: number, dz: number) => edges.get(axis, x + dx, z + dz) === 'door';
        if (axis === 'h' ? near(-1, 0) || near(1, 0) : near(0, -1) || near(0, 1)) continue;
        for (const side of [-1, 1]) {
          const px = axis === 'h' ? x + 0.5 : x + side * 0.55;
          const pz = axis === 'h' ? z + side * 0.55 : z + 0.5;
          // Only along a house's outside: a free-standing wall (drawn in build mode) stays bare.
          const indoorX = axis === 'h' ? x : side < 0 ? x : x - 1;
          const indoorZ = axis === 'h' ? (side < 0 ? z : z - 1) : z;
          if (room(indoorX, indoorZ) === 0) continue;
          if (!free(px, pz) || hash(x * 3 + side, z, 31) < 0.3) continue;
          shrubs.push([px, pz, 0.55 + hash(x, z, 32 + side) * 0.3, hash(x, z, 33) * 6.28]);
        }
      }
    }
    const trees: [number, number, number, number][] = [];
    if (view && Number.isFinite(minX)) {
      const spots = [
        [view.x + 1.6, view.z + 1.6],
        [view.x + view.w - 1.6, view.z + 1.6],
        [view.x + 1.6, view.z + view.d - 1.6],
        [view.x + view.w - 1.6, view.z + view.d - 1.6],
      ];
      for (const [tx, tz] of spots) {
        const clear = tx < minX - 2.5 || tx > maxX + 2.5 || tz < minZ - 2.5 || tz > maxZ + 2.5;
        if (clear && free(tx, tz) && hash(Math.floor(tx), Math.floor(tz), 41) < 0.65) trees.push([tx, tz, 0.65 + hash(Math.floor(tx), 3, 42) * 0.25, hash(Math.floor(tz), 5, 43) * 6.28]);
      }
    }

    // ---- meshes ----------------------------------------------------------------------
    const meshes: Mesh[] = [];
    const casters: Mesh[] = [];
    const roofs: Mesh[] = [];
    const add = (geo: Geo, name: string, key: string | Material, opts: { cut?: boolean; cast?: boolean; roof?: boolean } = {}) => {
      const mesh = geo.toMesh(name, this.scene, { colors: true, cut: opts.cut ?? true });
      if (!mesh) return;
      mesh.material = typeof key === 'string' ? this.material(key, opts.cut ?? true) : key;
      mesh.receiveShadows = true;
      mesh.isPickable = false;
      meshes.push(mesh);
      if (opts.cast) casters.push(mesh);
      if (opts.roof) roofs.push(mesh);
    };
    const M = HOUSE_MATERIALS;
    add(ext, 'wallsExterior', scheme.brick ? M.brick : M.siding, { cast: true });
    add(int, 'wallsInterior', M.interior, { cast: true });
    add(wainscot, 'wallsTiled', M.floorTile);
    add(stone, 'plinth', M.stone);
    add(trim, 'trim', M.trim, { cast: true });
    add(glass, 'windows', M.clearGlass);
    // Glass is see-through: draw it after the other blended surfaces (contact shadows) so
    // what lies behind it is complete when it is blended over.
    const panes = meshes.find((m) => m.name === 'windows');
    if (panes) panes.alphaIndex = 10;
    add(ao, 'contactShadows', this.lib.contactShadow(), { cut: true });
    add(wood, 'floors', M.floorWood, { cut: false });
    add(tile, 'floorsTiled', M.floorTile, { cut: false });
    add(carpet, 'floorsCarpet', M.floorCarpet, { cut: false });
    add(roof, 'roof', M.roof, { cut: false, cast: true, roof: true });
    add(roofTrim, 'roofTrim', M.trim, { cut: false, cast: true, roof: true });
    add(gables, 'gables', scheme.brick ? M.brick : M.siding, { cut: false, cast: true, roof: true });
    return { meshes, casters, roofs, lights, shrubs, trees };
  }

  /**
   * Neighbouring houses as dressed boxes: the house's own doors and windows where they lie on
   * the box outline (framed, with muntins, curtains and shutters), corner boards, a porch with a
   * gabled canopy over the front door, a chimney on some roofs, and a garage at the end of the
   * driveway. Returns the meshes (one per material for the whole street), the ones that cast
   * shadows, and the porch / garage lamps for the street's night lighting.
   */
  silhouettes(houses: readonly SilhouetteSpec[], openings: readonly Opening[]): SilhouetteBuild {
    const siding = new Geo();
    const brick = new Geo();
    const stone = new Geo().color('#D8D2C8');
    const roof = new Geo();
    const trim = new Geo().color(TRIM);
    const glass = new Geo();
    const lamps: SilhouetteBuild['lamps'] = [];
    const opened = new Set(openings.map((o) => `${o.axis}:${o.x}:${o.z}`));
    const H = WALL_HEIGHT;

    /** Plinth, siding/brick, frieze and corner boards of a box of wall centre lines. */
    const shell = (walls: Geo, x0: number, z0: number, x1: number, z1: number, h: number) => {
      const [a0, b0, a1, b1] = [x0 - T, z0 - T, x1 + T, z1 + T];
      walls.box(a0, PLINTH, b0, a1, h, b1, 'ny py');
      stone.box(a0 - 0.03, 0, b0 - 0.03, a1 + 0.03, PLINTH, b1 + 0.03, 'ny');
      trim.box(a0 - 0.02, h - 0.2, b0 - 0.02, a1 + 0.02, h, b1 + 0.02, 'ny');
      for (const [cx, cz, sx, sz] of [[a0, b0, -1, -1], [a1, b0, 1, -1], [a0, b1, -1, 1], [a1, b1, 1, 1]] as const) {
        trim.box(Math.min(cx, cx - sx * 0.13), PLINTH, Math.min(cz, cz + sz * 0.025), Math.max(cx, cx - sx * 0.13), h - 0.2, Math.max(cz, cz + sz * 0.025), 'ny');
        trim.box(Math.min(cx, cx + sx * 0.025), PLINTH, Math.min(cz, cz - sz * 0.13), Math.max(cx, cx + sx * 0.025), h - 0.2, Math.max(cz, cz - sz * 0.13), 'ny');
      }
    };

    for (const b of houses) {
      const s = houseScheme(b.x0, b.z0);
      const walls = s.brick ? brick : siding;
      const curtain = pick(CURTAINS, b.x0, b.z0, 7);
      walls.color(s.wall);
      shell(walls, b.x0, b.z0, b.x1, b.z1, H);
      const [x0, z0, x1, z1] = [b.x0 - T, b.z0 - T, b.x1 + T, b.z1 + T];
      for (const o of openings) {
        // Which face of the box the opening lies on (if any).
        const side =
          o.axis === 'h'
            ? o.x >= b.x0 && o.x < b.x1 && (o.z === b.z0 || o.z === b.z1)
              ? { plane: o.z === b.z0 ? z0 : z1, n: [0, 0, o.z === b.z0 ? -1 : 1] as V3, a: o.x }
              : null
            : o.z >= b.z0 && o.z < b.z1 && (o.x === b.x0 || o.x === b.x1)
              ? { plane: o.x === b.x0 ? x0 : x1, n: [o.x === b.x0 ? -1 : 1, 0, 0] as V3, a: o.z }
              : null;
        if (!side) continue;
        const { plane, n, a } = side;
        const P = (u: number, y: number, d: number): V3 => (o.axis === 'h' ? [u, y, plane + n[2] * d] : [plane + n[0] * d, y, u]);
        const board = (u0: number, u1: number, y0: number, y1: number, out: number) => trim.box(...span(o.axis, plane, n, u0, u1, y0, y1, out));
        if (o.kind === 'window') {
          const [g0, g1] = [a + WIN_INSET, a + 1 - WIN_INSET];
          const f = 0.07;
          glass.poly([P(g0, SILL, 0.006), P(g1, SILL, 0.006), P(g1, HEAD, 0.006), P(g0, HEAD, 0.006)], n);
          // Curtains drawn to the sides with a valance: dark against the glow at night.
          trim.color(curtain);
          board(g0, g0 + 0.17, SILL + 0.04, HEAD, 0.012);
          board(g1 - 0.17, g1, SILL + 0.04, HEAD, 0.012);
          board(g0, g1, HEAD - 0.16, HEAD, 0.014);
          trim.color(TRIM);
          board(g0 - f, g0, SILL, HEAD, 0.04);
          board(g1, g1 + f, SILL, HEAD, 0.04);
          board(g0 - f, g1 + f, HEAD, HEAD + f, 0.04);
          board(g0 - f - 0.04, g1 + f + 0.04, SILL - 0.06, SILL, 0.07);
          const mid = (g0 + g1) / 2;
          board(mid - 0.016, mid + 0.016, SILL, HEAD - 0.16, 0.024);
          board(g0, g1, (SILL + HEAD) / 2 + 0.1, (SILL + HEAD) / 2 + 0.13, 0.024);
          if (s.shutters) {
            const step = (d: number) => (o.axis === 'h' ? `h:${o.x + d}:${o.z}` : `v:${o.x}:${o.z + d}`);
            trim.color(s.accent);
            if (!opened.has(step(-1)) && a - 1 >= (o.axis === 'h' ? b.x0 : b.z0)) board(g0 - f - 0.36, g0 - f - 0.02, SILL - 0.02, HEAD + 0.04, 0.035);
            if (!opened.has(step(1)) && a + 1 < (o.axis === 'h' ? b.x1 : b.z1)) board(g1 + f + 0.02, g1 + f + 0.36, SILL - 0.02, HEAD + 0.04, 0.035);
            trim.color(TRIM);
          }
        } else {
          board(a + T - 0.06, a + T + 0.02, 0, DOOR_HEIGHT + 0.1, 0.05);
          board(a + 1 - T - 0.02, a + 1 - T + 0.06, 0, DOOR_HEIGHT + 0.1, 0.05);
          board(a + T - 0.08, a + 1 - T + 0.08, DOOR_HEIGHT, DOOR_HEIGHT + 0.14, 0.06);
          trim.color(s.accent);
          board(a + T + 0.02, a + 1 - T - 0.02, 0, DOOR_HEIGHT, 0.03);
          // Raised panels on the leaf.
          trim.color(shade(s.accent, 1.12));
          board(a + T + 0.1, a + 0.5 - 0.04, 1.15, 1.95, 0.04);
          board(a + 0.5 + 0.04, a + 1 - T - 0.1, 1.15, 1.95, 0.04);
          board(a + T + 0.1, a + 0.5 - 0.04, 0.15, 0.95, 0.04);
          board(a + 0.5 + 0.04, a + 1 - T - 0.1, 0.15, 0.95, 0.04);
          trim.color('#C8A64A').box(...span(o.axis, plane, n, a + 1 - T - 0.16, a + 1 - T - 0.1, 1.0, 1.06, 0.07));
          trim.color(TRIM);
          const front = b.door !== null && o.axis === 'h' && Math.abs(a + 0.5 - b.door) < 0.6 && n[2] === b.front;
          if (front) this.porch(o.axis, plane, n, a + 0.5, s, walls, roof, trim, lamps);
        }
      }
      roof.color(s.roof);
      addRoof({ x0: b.x0, z0: b.z0, x1: b.x1, z1: b.z1 }, s.hip, roof, trim, walls);
      if (hash(b.x0, b.z0, 8) < 0.6) this.chimney(b, s, brick, stone);
      const g = b.garage;
      if (g) {
        walls.color(s.wall);
        shell(walls, g.x0, g.z0, g.x1, g.z1, GARAGE_HEIGHT);
        roof.color(s.roof);
        addRoof(g, s.hip, roof, trim, walls, GARAGE_HEIGHT, 0.3);
        // Sectional door on the street side, with a coach lamp beside it.
        const plane = b.front > 0 ? g.z1 + T : g.z0 - T;
        const n: V3 = [0, 0, b.front];
        const [d0, d1] = [g.x0 + 0.35, g.x1 - 0.35];
        trim.color(TRIM).box(...span('h', plane, n, d0 - 0.1, d1 + 0.1, 0, 2.25, 0.03));
        const door = hash(b.x0, b.z0, 9) < 0.5 ? '#F2F0EA' : s.accent;
        trim.color(door).box(...span('h', plane, n, d0, d1, 0, 2.12, 0.045));
        trim.color(shade(door, 0.82));
        for (const y of [0.53, 1.06, 1.59]) trim.box(...span('h', plane, n, d0 + 0.04, d1 - 0.04, y - 0.015, y + 0.015, 0.05));
        trim.color(TRIM);
        const lx = b.door !== null && b.door < (g.x0 + g.x1) / 2 ? d0 - 0.3 : d1 + 0.3;
        lamps.push([lx, 1.9, plane + b.front * 0.08, 0, b.front]);
      }
    }
    const out: SilhouetteBuild = { meshes: [], casters: [], lamps };
    const M = HOUSE_MATERIALS;
    for (const [geo, name, key, cast] of [
      [siding, 'silhouetteWalls', M.siding, true],
      [brick, 'silhouetteBrick', M.brick, true],
      [stone, 'silhouettePlinth', M.stone, false],
      [roof, 'silhouetteRoofs', M.roof, true],
      [trim, 'silhouetteTrim', M.trim, true],
      [glass, 'silhouetteWindows', M.glass, false],
    ] as const) {
      const mesh = geo.toMesh(name, this.scene, { colors: true, cut: true });
      if (!mesh) continue;
      mesh.material = this.material(key);
      mesh.receiveShadows = true;
      mesh.isPickable = false;
      out.meshes.push(mesh);
      if (cast) out.casters.push(mesh);
    }
    return out;
  }

  /** Landing, posts and a small gabled canopy over a front door; a lamp beside the door. */
  private porch(axis: 'h' | 'v', plane: number, n: V3, mid: number, s: HouseScheme, walls: Geo, roof: Geo, trim: Geo, lamps: SilhouetteBuild['lamps']): void {
    if (axis !== 'h') return;
    const out = n[2];
    const depth = 1.3;
    const half = 0.95;
    const z0 = plane;
    const z1 = plane + out * depth;
    const [za, zb] = [Math.min(z0, z1), Math.max(z0, z1)];
    // Kept low: Sims walk up to the door at ground level.
    trim.color('#C9C4BA');
    trim.box(mid - half, 0, za, mid + half, 0.05, zb, 'ny');
    trim.box(mid - half + 0.15, 0, Math.min(z1, z1 + out * 0.3), mid + half - 0.15, 0.025, Math.max(z1, z1 + out * 0.3), 'ny');
    const top = 2.34;
    trim.color(TRIM);
    for (const x of [mid - half + 0.08, mid + half - 0.08]) {
      const zc = z1 - out * 0.08;
      trim.box(x - 0.055, 0.05, zc - 0.055, x + 0.055, top, zc + 0.055);
      trim.box(x - 0.08, 0.05, zc - 0.08, x + 0.08, 0.22, zc + 0.08);
    }
    // The canopy runs into the wall so its ridge meets the house at right angles.
    roof.color(s.roof);
    addRoof({ x0: mid - half + T, z0: Math.min(z1, z0 - out * 0.9) + T, x1: mid + half - T, z1: Math.max(z1, z0 - out * 0.9) - T }, false, roof, trim, walls, top, 0.12);
    lamps.push([mid + 0.72, 1.75, plane + out * 0.08, 0, out]);
    trim.color('#2E2E30').box(mid + 0.66, 1.62, Math.min(plane, plane + out * 0.05), mid + 0.78, 1.66, Math.max(plane, plane + out * 0.05));
    trim.color(TRIM);
  }

  /** A brick chimney through one roof slope near a gable end, with a stone cap. */
  private chimney(b: SilhouetteSpec, s: HouseScheme, brick: Geo, stone: Geo): void {
    const alongX = b.x1 - b.x0 >= b.z1 - b.z0;
    const [a0, a1] = alongX ? [b.x0, b.x1] : [b.z0, b.z1];
    const [c0, c1] = alongX ? [b.z0, b.z1] : [b.x0, b.x1];
    const half = (c1 - c0) / 2 + T + OVERHANG;
    const yr = WALL_HEIGHT - OVERHANG * PITCH + half * PITCH + ROOF_THICKNESS;
    const end = hash(b.x0, b.z0, 10) < 0.5;
    const ridge = s.hip ? Math.max(0, a1 - a0 - (c1 - c0)) / 2 : (a1 - a0) / 2;
    const a = (a0 + a1) / 2 + (end ? 1 : -1) * Math.max(0, ridge - 0.9);
    const c = (c0 + c1) / 2 + (hash(b.x0, b.z0, 11) < 0.5 ? 0.75 : -0.75);
    const P = (u0: number, y0: number, v0: number, u1: number, y1: number, v1: number) =>
      alongX ? ([u0, y0, v0, u1, y1, v1] as const) : ([v0, y0, u0, v1, y1, u1] as const);
    brick.color(s.brick ? s.wall : '#E2C8B8').box(...P(a - 0.3, WALL_HEIGHT, c - 0.38, a + 0.3, yr + 0.75, c + 0.38), 'ny');
    stone.box(...P(a - 0.36, yr + 0.75, c - 0.44, a + 0.36, yr + 0.85, c + 0.44));
  }

  private doorway(
    axis: 'h' | 'v',
    x: number,
    z: number,
    mask: number,
    trim: Geo,
    room: (x: number, z: number) => number,
    scheme: HouseScheme,
  ): void {
    // Casings on both faces: two side boards (clamped to stubs when cut) and a head (hidden).
    for (const n of axis === 'h' ? ([[0, 0, -1], [0, 0, 1]] as V3[]) : ([[-1, 0, 0], [1, 0, 0]] as V3[])) {
      const plane = axis === 'h' ? z + n[2] * T : x + n[0] * T;
      const a0 = (axis === 'h' ? x : z) + T;
      const a1 = (axis === 'h' ? x : z) + 1 - T;
      trim.cutting(Cut.Clamp, mask);
      trim.box(...span(axis, plane, n, a0 - 0.1, a0 + 0.01, 0, DOOR_HEIGHT + 0.1, 0.022));
      trim.box(...span(axis, plane, n, a1 - 0.01, a1 + 0.1, 0, DOOR_HEIGHT + 0.1, 0.022));
      trim.cutting(Cut.Hide, mask);
      trim.box(...span(axis, plane, n, a0 - 0.1, a1 + 0.1, DOOR_HEIGHT, DOOR_HEIGHT + 0.12, 0.024));
    }
    // An open door leaf hinged on one jamb, swung 90 degrees into the room (or the outdoor
    // side's opposite for front doors), standing against the opening's edge.
    const outdoorA = axis === 'h' ? room(x, z - 1) === 0 : room(x - 1, z) === 0;
    const outdoorB = axis === 'h' ? room(x, z) === 0 : room(x, z) === 0;
    const front = outdoorA !== outdoorB;
    const into = outdoorA ? 1 : -1; // swing towards the indoor side
    const leaf = 0.8;
    const thick = 0.045;
    // Painted leaf: the house accent colour for front doors, off-white inside.
    trim.color(front ? scheme.accent : '#EDEAE2').cutting(Cut.Hide, mask);
    if (axis === 'h') {
      const hx = x + T + 0.02;
      const z0 = z + into * (T + 0.01);
      const z1 = z0 + into * leaf;
      trim.box(hx, 0.01, Math.min(z0, z1), hx + thick, DOOR_HEIGHT - 0.03, Math.max(z0, z1));
    } else {
      const hz = z + T + 0.02;
      const x0 = x + into * (T + 0.01);
      const x1 = x0 + into * leaf;
      trim.box(Math.min(x0, x1), 0.01, hz, Math.max(x0, x1), DOOR_HEIGHT - 0.03, hz + thick);
    }
    trim.color(TRIM);
  }

  private window(
    axis: 'h' | 'v',
    x: number,
    z: number,
    mask: number,
    room: (x: number, z: number) => number,
    scheme: HouseScheme,
    trim: Geo,
    glass: Geo,
    shutters: [boolean, boolean],
  ): void {
    // Frames, sill and shutters on both faces around the opening (see `windowWall`); a pane
    // with muntins set a little into the opening from each side.
    const a0 = (axis === 'h' ? x : z) + WIN_INSET;
    const a1 = (axis === 'h' ? x : z) + 1 - WIN_INSET;
    const recess = 0.03;
    // Muntins: one cross of glazing bars through the opening, between the two panes (bars on
    // each pane would show twice through the clear glass).
    const mid = (a0 + a1) / 2;
    const n0: V3 = axis === 'h' ? [0, 0, 1] : [1, 0, 0];
    const back = (axis === 'h' ? z : x) - T + recess;
    trim.cutting(Cut.Hide, mask).color(TRIM);
    trim.box(...span(axis, back, n0, mid - 0.016, mid + 0.016, SILL, HEAD, 2 * (T - recess)));
    trim.box(...span(axis, back, n0, a0, a1, (SILL + HEAD) / 2 + 0.1, (SILL + HEAD) / 2 + 0.13, 2 * (T - recess)));
    for (const sign of [-1, 1]) {
      const n: V3 = axis === 'h' ? [0, 0, sign] : [sign, 0, 0];
      const plane = axis === 'h' ? z + sign * T : x + sign * T;
      const tileRoom = axis === 'h' ? room(x, sign < 0 ? z - 1 : z) : room(sign < 0 ? x - 1 : x, z);
      const outside = tileRoom === 0;
      const P = (a: number, y: number, d: number): V3 => (axis === 'h' ? [a, y, plane + n[2] * d] : [plane + n[0] * d, y, a]);
      // One clear pane per face, facing out of it (back faces are culled, so each side sees
      // through exactly one pane).
      glass.cutting(Cut.Hide, mask).poly([P(a0, SILL, -recess), P(a1, SILL, -recess), P(a1, HEAD, -recess), P(a0, HEAD, -recess)], n);
      trim.cutting(Cut.Hide, mask).color(TRIM);
      const f = 0.07;
      const out = 0.035;
      trim.box(...span(axis, plane, n, a0 - f, a0, SILL, HEAD, out));
      trim.box(...span(axis, plane, n, a1, a1 + f, SILL, HEAD, out));
      trim.box(...span(axis, plane, n, a0 - f, a1 + f, HEAD, HEAD + f, out));
      trim.box(...span(axis, plane, n, a0 - f - 0.04, a1 + f + 0.04, SILL - 0.05, SILL, outside ? 0.07 : 0.05));
      if (outside && scheme.shutters) {
        trim.color(scheme.accent);
        if (shutters[0]) trim.box(...span(axis, plane, n, a0 - f - 0.36, a0 - f - 0.02, SILL - 0.02, HEAD + 0.04, 0.03));
        if (shutters[1]) trim.box(...span(axis, plane, n, a1 + f + 0.02, a1 + f + 0.36, SILL - 0.02, HEAD + 0.04, 0.03));
        trim.color(TRIM);
      }
    }
  }

  private cornerBoards(
    x: number,
    z: number,
    e: { hl?: EdgeKind; hr?: EdgeKind; vd?: EdgeKind; vu?: EdgeKind },
    room: (x: number, z: number) => number,
    trim: Geo,
  ): void {
    // An outside corner: exactly one h and one v edge meet and the outer quadrant is outdoors.
    const h = e.hl ? -1 : e.hr ? 1 : 0;
    const v = e.vd ? -1 : e.vu ? 1 : 0;
    if (!h || !v || (e.hl && e.hr) || (e.vd && e.vu)) return;
    // The quadrant opposite both walls is the outer one.
    const qx = h < 0 ? x : x - 1;
    const qz = v < 0 ? z : z - 1;
    if (room(qx, qz) !== 0) return;
    const sx = -h; // outward along x
    const sz = -v;
    const w = 0.13;
    const d = 0.024;
    const xa = x + sx * T;
    const za = z + sz * T;
    trim.cutting(Cut.Clamp, LOOK.All, LOOK.All);
    trim.color(TRIM);
    // Board on the face whose normal is along x, and one on the face along z.
    trim.box(Math.min(xa, xa + sx * d), PLINTH, Math.min(za + sz * 0.001, za - sz * w), Math.max(xa, xa + sx * d), WALL_HEIGHT - 0.2, Math.max(za + sz * 0.001, za - sz * w));
    trim.box(Math.min(xa + sx * d, xa - sx * w), PLINTH, Math.min(za, za + sz * d), Math.max(xa + sx * d, xa - sx * w), WALL_HEIGHT - 0.2, Math.max(za, za + sz * d));
  }
}

/**
 * Box args for a board lying on a wall face: `a0..a1` along the wall, `y0..y1` high,
 * protruding `out` metres from the face at `plane` along normal `n`.
 */
/** A hex colour scaled in brightness (sRGB), for panel details. */
function shade(hex: string, k: number): string {
  const v = parseInt(hex.slice(1), 16);
  const c = [(v >> 16) & 255, (v >> 8) & 255, v & 255].map((x) => Math.max(0, Math.min(255, Math.round(x * k))));
  return `#${c.map((x) => x.toString(16).padStart(2, '0')).join('')}`;
}

function span(axis: 'h' | 'v', plane: number, n: V3, a0: number, a1: number, y0: number, y1: number, out: number): [number, number, number, number, number, number] {
  const d0 = plane;
  const d1 = plane + (axis === 'h' ? n[2] : n[0]) * out;
  const lo = Math.min(d0, d1);
  const hi = Math.max(d0, d1);
  return axis === 'h' ? [a0, y0, lo, a1, y1, hi] : [lo, y0, a0, hi, y1, a1];
}

/** Covers the indoor tiles of a bounding box with a few rectangles (greedy, row-major). */
function indoorRects(room: (x: number, z: number) => number, x0: number, z0: number, x1: number, z1: number): { x0: number; z0: number; x1: number; z1: number }[] {
  const w = x1 - x0;
  const covered = new Uint8Array(w * (z1 - z0));
  const indoor = (x: number, z: number) => room(x, z) !== 0;
  const out: { x0: number; z0: number; x1: number; z1: number }[] = [];
  for (let z = z0; z < z1; z++) {
    for (let x = x0; x < x1; x++) {
      if (!indoor(x, z) || covered[(z - z0) * w + x - x0]) continue;
      let xe = x;
      while (xe < x1 && indoor(xe, z)) xe++;
      let ze = z + 1;
      while (ze < z1) {
        let full = true;
        for (let k = x; k < xe; k++) if (!indoor(k, ze)) full = false;
        if (!full) break;
        ze++;
      }
      for (let zz = z; zz < ze; zz++) for (let k = x; k < xe; k++) covered[(zz - z0) * w + k - x0] = 1;
      // Tiny leftovers (e.g. a single-tile porch notch) don't get their own roof.
      if ((xe - x) * (ze - z) >= 4) out.push({ x0: x, z0: z, x1: xe, z1: ze });
    }
  }
  return out;
}

/**
 * Pitched roof over a rectangle of wall centre lines. The underside passes through the outer
 * top edge of the walls, so the eaves rest on them and overhang by `OVERHANG`; gable ends are
 * closed with wall cladding. The ridge runs along the longer side.
 */
export function addRoof(
  rect: { x0: number; z0: number; x1: number; z1: number },
  hip: boolean,
  roof: Geo,
  trim: Geo,
  gables: Geo,
  base = WALL_HEIGHT,
  overhang = OVERHANG,
): void {
  const alongX = rect.x1 - rect.x0 >= rect.z1 - rect.z0;
  // Local frame: a = along the ridge, b = across. `P` maps back to world space.
  const A0 = (alongX ? rect.x0 : rect.z0) - T;
  const A1 = (alongX ? rect.x1 : rect.z1) + T;
  const B0 = (alongX ? rect.z0 : rect.x0) - T;
  const B1 = (alongX ? rect.z1 : rect.x1) + T;
  const P = (a: number, y: number, b: number): V3 => (alongX ? [a, y, b] : [b, y, a]);
  const H = base;
  const o = overhang;
  const th = ROOF_THICKNESS;
  const ea0 = A0 - o;
  const ea1 = A1 + o;
  const eb0 = B0 - o;
  const eb1 = B1 + o;
  const bc = (B0 + B1) / 2;
  const half = bc - eb0;
  const ye = H - o * PITCH; // underside height at the eaves
  const yr = ye + half * PITCH; // underside height at the ridge
  const slope = Math.sqrt(1 + PITCH * PITCH);
  // Hip ends start `half` in from the eaves; a square plan becomes a pyramid.
  const ra0 = hip ? Math.min(ea0 + half, (ea0 + ea1) / 2) : ea0;
  const ra1 = hip ? Math.max(ea1 - half, (ea0 + ea1) / 2) : ea1;
  const up: V3 = [0, 1, 0];
  const down: V3 = [0, -1, 0];

  /** Adds a roof plane (top in shingles, underside as soffit), lifted by `dy`. */
  const plane = (pts: [number, number, number][], uvs: [number, number][], out: V3) => {
    const top = pts.map(([a, y, b]) => P(a, y + th, b));
    const bottom = pts.map(([a, y, b]) => P(a, y, b));
    // First, second and last corner: on a pyramid (square hip) the two ridge corners coincide.
    const nt = facing(top[0], top[1], top[top.length - 1], [out[0], 1, out[2]]);
    roof.poly(top, nt, uvs);
    trim.poly(bottom, [-nt[0], -nt[1], -nt[2]]);
  };
  const w = (a: number, b: number): V3 => (alongX ? [a, 0, b] : [b, 0, a]);
  const sideB0 = w(0, -1);
  const sideB1 = w(0, 1);
  const sideA0 = w(-1, 0);
  const sideA1 = w(1, 0);
  const vr = half * slope;
  // The two long slopes (quads; trapezoids for a hip roof). UV: u along the eave, v up-slope.
  plane([[ea0, ye, eb0], [ea1, ye, eb0], [ra1, yr, bc], [ra0, yr, bc]], [[ea0, 0], [ea1, 0], [ra1, vr], [ra0, vr]], sideB0);
  plane([[ea0, ye, eb1], [ra0, yr, bc], [ra1, yr, bc], [ea1, ye, eb1]], [[ea0, 0], [ra0, vr], [ra1, vr], [ea1, 0]], sideB1);
  // Fascia boards along the eaves.
  trim.poly([P(ea0, ye, eb0), P(ea1, ye, eb0), P(ea1, ye + th, eb0), P(ea0, ye + th, eb0)], sideB0);
  trim.poly([P(ea0, ye, eb1), P(ea0, ye + th, eb1), P(ea1, ye + th, eb1), P(ea1, ye, eb1)], sideB1);
  if (hip) {
    plane([[ea0, ye, eb0], [ra0, yr, bc], [ea0, ye, eb1]], [[eb0, 0], [bc, vr], [eb1, 0]], sideA0);
    plane([[ea1, ye, eb0], [ea1, ye, eb1], [ra1, yr, bc]], [[eb0, 0], [eb1, 0], [bc, vr]], sideA1);
    trim.poly([P(ea0, ye, eb0), P(ea0, ye, eb1), P(ea0, ye + th, eb1), P(ea0, ye + th, eb0)], sideA0);
    trim.poly([P(ea1, ye, eb0), P(ea1, ye + th, eb0), P(ea1, ye + th, eb1), P(ea1, ye, eb1)], sideA1);
  } else {
    // Rake boards along the sloped edges and closed gable triangles on the wall planes.
    for (const [a, side] of [[ea0, sideA0], [ea1, sideA1]] as const) {
      trim.poly([P(a, ye, eb0), P(a, yr, bc), P(a, yr + th, bc), P(a, ye + th, eb0)], side);
      trim.poly([P(a, ye, eb1), P(a, ye + th, eb1), P(a, yr + th, bc), P(a, yr, bc)], side);
    }
    for (const [a, side] of [[A0, sideA0], [A1, sideA1]] as const) {
      gables.poly([P(a, H, B0), P(a, H, B1), P(a, yr, bc)], side);
    }
  }
  // Ridge cap.
  if (ra1 > ra0 + 0.01) {
    const c0 = P(ra0 - (hip ? 0 : 0), yr + th, bc - 0.11);
    const c1 = P(ra1, yr + th + 0.07, bc + 0.11);
    const r = roof.r;
    const g = roof.g;
    const b = roof.b;
    roof.r *= 0.8;
    roof.g *= 0.8;
    roof.b *= 0.8;
    roof.box(Math.min(c0[0], c1[0]), c0[1] - 0.02, Math.min(c0[2], c1[2]), Math.max(c0[0], c1[0]), c1[1], Math.max(c0[2], c1[2]), 'ny');
    roof.r = r;
    roof.g = g;
    roof.b = b;
  }
  void up;
  void down;
}
