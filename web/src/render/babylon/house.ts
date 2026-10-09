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
 * `openings`: doors and windows placed in them; `diagonals`: walls corner to corner across a
 * tile, with doors and windows too), so build-mode edits arrive as new structures. A diagonal
 * splits its tile into two halves with their own rooms: floors, wall faces, lawn and shrubs follow
 * the half they are on. Where diagonals meet other walls, the corner post is a mitred outline
 * (`slanted.ts`). Houses with diagonal sides get a hip roof following their outline when it is
 * convex; otherwise the usual rectangles cover the split tiles whole (a deeper eave there).
 * Every wall vertex carries cutaway data (`geometry.ts`); the vertex shader lowers walls
 * between the camera and the rooms behind them, so the cutaway costs no CPU.
 *
 * Walls have looks chosen in Build mode (`WallEdge.faces` / `form`, `Opening.style`, the same on
 * diagonals; see `setLooks`): each face can be covered (paint, wallpaper, siding, brick, wood,
 * stone, tiles: a finish tinted per covering, else the automatic look above), a wall can be half
 * height (posts follow the tallest wall they join), and doors and windows come in styles (leaf
 * and paint; opening heights, glazing bars and shutters).
 *
 * Everything is generated in a few milliseconds per structure and merged into one mesh per
 * material (about 15 draw calls for a whole house).
 */

import { Color3, type Material, type Mesh, type PBRMaterial, type Scene } from '@babylonjs/core';
import type { DoorStyleDef, FloorCoveringDef, RoofColorDef, RoofStyleDef, WallCoveringDef, WindowStyleDef } from '../../content/content';
import type { DiagonalWall, Opening, WorldStructure } from '../../core/protocol';
import type { ViewRect } from '../types';
import { Cut, facing, Geo, LOOK, type V3 } from './geometry';
import { MaterialLibrary } from './materials';
import { addHipPolygon, area, convexHull, diagonalEnds, halfAt, halfCentroid, halfTriangle, postOutline, WallFrame, type P2 } from './slanted';

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
/** Height of a half wall (`form` 1). */
export const HALF_WALL_HEIGHT = 1.05;
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
  plaster: 'material.wall',
  panelling: 'material.finish.wood',
} as const;

/** The surface of each wall-covering finish. */
const FINISH_MATERIALS: Record<WallCoveringDef['finish'], string> = {
  plaster: HOUSE_MATERIALS.plaster,
  wallpaper: HOUSE_MATERIALS.interior,
  siding: HOUSE_MATERIALS.siding,
  brick: HOUSE_MATERIALS.brick,
  wood: HOUSE_MATERIALS.panelling,
  stone: HOUSE_MATERIALS.stone,
  tile: HOUSE_MATERIALS.floorTile,
};

/** Build-mode looks from content: wall coverings, door and window styles (indices as in the structure). */
export interface HouseLooks {
  coverings: readonly WallCoveringDef[];
  floors: readonly FloorCoveringDef[];
  doors: readonly DoorStyleDef[];
  windows: readonly WindowStyleDef[];
  roofs?: readonly RoofStyleDef[];
  roofColors?: readonly RoofColorDef[];
  /** The light an object type gives, if it's a lamp. */
  lightOf?: (def: string) => LampLight | undefined;
}

/** A roof's shape: gable, hip or flat, and the pitch (rise per run) of pitched ones. */
export interface RoofShape {
  shape: RoofStyleDef['shape'];
  pitch: number;
}

/** Pitch of a flat roof (just enough to draw it as a very low hip over diagonal outlines). */
const FLAT_PITCH = 0.03;

/** A window's opening and dressing (the classic window without styles in content). */
type WindowSpec = Pick<WindowStyleDef, 'panes' | 'sill' | 'head' | 'inset' | 'shutters'>;
const CLASSIC_WINDOW: WindowSpec = { panes: 'cross', sill: SILL, head: HEAD, inset: WIN_INSET, shutters: 'house' };
const PANEL_DOOR: Pick<DoorStyleDef, 'leaf' | 'color'> = { leaf: 'panel' };
/** Door leaf size (m): width and thickness; it stands from 0.01 m to just under the head. */
const LEAF_W = 0.8;
const LEAF_T = 0.045;

/** A wall's look as the structure sends it (absent fields: the default). */
interface Look {
  faces?: [number, number];
  form?: number;
  style?: number;
}

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
  /** Indoor area in tiles of the room it lights (0 outdoors). */
  area: number;
  /** A lamp the household bought, or the dim fill of a room without one. */
  kind: 'lamp' | 'fill';
  /** Lamps: reach in metres and relative brightness (content `light`). */
  range?: number;
  power?: number;
}

/** What a lamp object gives (content `light`). */
export interface LampLight {
  range?: number;
  intensity?: number;
  height?: number;
}

export interface HouseBuild {
  meshes: Mesh[];
  /** Shadow casters. */
  casters: Mesh[];
  /** Roofs and gables: drawn only with walls up. */
  roofs: Mesh[];
  /** Every lamp (largest rooms first, then the garden's), then a dim fill per room without one. */
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
  /** The roof the player chose (`PlotInfo.roof`); absent: the house's own look. */
  roof?: [number, number];
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
  private looks: HouseLooks = { coverings: [], floors: [], doors: [], windows: [] };

  constructor(private readonly scene: Scene) {
    this.lib = MaterialLibrary.for(scene);
  }

  /** The content's wall coverings, door and window styles (structures refer to them by index). */
  /** A house's scheme with the roof the player chose (if any) for its colour, shape and pitch. */
  private schemeWith(scheme: HouseScheme, roof: [number, number] | undefined): HouseScheme & RoofShape {
    const style = roof ? this.looks.roofs?.[roof[0]] : undefined;
    const colour = roof ? this.looks.roofColors?.[roof[1]]?.color : undefined;
    const shape: RoofStyleDef['shape'] = style?.shape ?? (scheme.hip ? 'hip' : 'gable');
    const pitch = shape === 'flat' ? FLAT_PITCH : style?.pitch !== undefined ? Math.tan((style.pitch * Math.PI) / 180) : PITCH;
    return { ...scheme, roof: colour ?? scheme.roof, hip: shape === 'hip', shape, pitch };
  }

  setLooks(looks: HouseLooks): void {
    this.looks = looks;
  }

  private windowSpec(style: number | undefined): WindowSpec {
    return this.looks.windows[style ?? 0] ?? CLASSIC_WINDOW;
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
    // Diagonal walls by tile; a tile they split has a room per half.
    const diagAt = new Map<number, DiagonalWall>();
    for (const d of world.diagonals ?? []) diagAt.set(d.z * W + d.x, d);
    const diagonal = (x: number, z: number) => (x >= 0 && z >= 0 && x < W && z < D ? diagAt.get(z * W + x) : undefined);
    /** Room at a world point (the half of a split tile it lies in). */
    const roomP = (px: number, pz: number): number => {
      const x = Math.floor(px);
      const z = Math.floor(pz);
      const d = diagonal(x, z);
      return d ? d.rooms[halfAt(d.axis, px - x, pz - z)] : room(x, z);
    };
    /** Diagonal walls ending at grid corner (x, z), with their unit direction away from it. */
    const diagonalsAt = (x: number, z: number): { d: DiagonalWall; dir: P2 }[] => {
      const out: { d: DiagonalWall; dir: P2 }[] = [];
      const add = (tx: number, tz: number, axis: 'dp' | 'dn', dx: number, dz: number) => {
        const d = diagonal(tx, tz);
        if (d && d.axis === axis) out.push({ d, dir: [dx * Math.SQRT1_2, dz * Math.SQRT1_2] });
      };
      add(x, z, 'dp', 1, 1);
      add(x - 1, z - 1, 'dp', -1, -1);
      add(x - 1, z, 'dn', -1, 1);
      add(x, z - 1, 'dn', 1, -1);
      return out;
    };
    const diagonalAtNode = (x: number, z: number) => diagonalsAt(x, z).length > 0;

    // ---- wall edges in view (inclusive of the view's boundary lines) ------------------
    const edges = new Edges(W + 8);
    const edgeInView = (e: { axis: 'h' | 'v'; x: number; z: number }) =>
      !view ||
      (e.axis === 'h'
        ? e.x >= view.x && e.x < view.x + view.w && e.z >= view.z && e.z <= view.z + view.d
        : e.x >= view.x && e.x <= view.x + view.w && e.z >= view.z && e.z < view.z + view.d);
    for (const e of world.walls) if (edgeInView(e)) edges.set(e.axis, e.x, e.z, 'wall');
    for (const o of world.openings) if (edgeInView(o)) edges.set(o.axis, o.x, o.z, o.kind);
    // Looks: face coverings and form from the wall list, the style from the opening.
    const looks = new Map<string, Look>();
    for (const e of world.walls) if (e.faces || e.form) looks.set(`${e.axis}:${e.x}:${e.z}`, { faces: e.faces, form: e.form });
    for (const o of world.openings) if (o.style) looks.set(`${o.axis}:${o.x}:${o.z}`, { ...looks.get(`${o.axis}:${o.x}:${o.z}`), style: o.style });
    const lookOf = (axis: 'h' | 'v', x: number, z: number): Look => looks.get(`${axis}:${x}:${z}`) ?? {};
    /** The covering of one face of the wall on an edge; undefined where there's no wall. */
    const faceAt = (axis: 'h' | 'v', x: number, z: number, side: 0 | 1): number | undefined => (edges.get(axis, x, z) ? (lookOf(axis, x, z).faces?.[side] ?? 0) : undefined);
    /** How tall the wall on an edge stands (0 where there's none). */
    const heightOf = (axis: 'h' | 'v', x: number, z: number): number => {
      const kind = edges.get(axis, x, z);
      return !kind ? 0 : kind === 'wall' && lookOf(axis, x, z).form ? HALF_WALL_HEIGHT : WALL_HEIGHT;
    };

    // ---- rooms: kind (from the objects in them), colours, lights --------------------
    const shown = world.objects.filter((o) => inView(o.x, o.z));
    const occupied = new Set<number>();
    const roomDefs = new Map<number, Set<string>>();
    const lamps: { x: number; z: number; room: number; light: LampLight }[] = [];
    for (const o of shown) {
      // Lamps indoors and out (a garden lantern's room is 0).
      const light = this.looks.lightOf?.(o.def);
      if (light) lamps.push({ x: o.x + o.w / 2, z: o.z + o.d / 2, room: room(o.x, o.z), light });
      for (let z = o.z; z < o.z + o.d; z++) {
        for (let x = o.x; x < o.x + o.w; x++) {
          occupied.add(z * W + x);
          const r = room(x, z);
          if (r === 0) continue;
          if (!roomDefs.has(r)) roomDefs.set(r, new Set());
          roomDefs.get(r)!.add(o.def);
        }
      }
    }
    const viewed = view ? world.plots?.find((p) => p.x === view.x && p.z === view.z) : undefined;
    const scheme = this.schemeWith(houseScheme(view?.x ?? 0, view?.z ?? 0), viewed?.roof);
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
    const addArea = (r: number, n: number, cx: number, cz: number) => {
      if (!kinds.has(r)) kinds.set(r, kindOf(r));
      const t = roomTiles.get(r) ?? { n: 0, sx: 0, sz: 0 };
      t.n += n;
      t.sx += cx * n;
      t.sz += cz * n;
      roomTiles.set(r, t);
    };
    for (let z = 0; z < D; z++) {
      for (let x = 0; x < W; x++) {
        const r = room(x, z);
        if (r === 0 || !inView(x, z)) continue;
        const d = diagonal(x, z);
        if (d) {
          // Half tiles: half the area, at the triangle's centroid.
          for (const h of [0, 1] as const) {
            if (d.rooms[h] === 0) continue;
            const [cx, cz] = halfCentroid(d.axis, h);
            addArea(d.rooms[h], 0.5, x + cx, z + cz);
          }
        } else addArea(r, 1, x + 0.5, z + 0.5);
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
    // Lamps light the house (the biggest rooms' first, the garden's last); rooms without one
    // get a dim fill from the ceiling if lights are left over.
    const areaOf = (r: number) => roomTiles.get(r)?.n ?? 0;
    const lights: RoomLight[] = [
      ...lamps
        .sort((a, b) => areaOf(b.room) - areaOf(a.room))
        .map((l): RoomLight => ({ x: l.x, y: l.light.height ?? 1.55, z: l.z, area: areaOf(l.room), kind: 'lamp', range: l.light.range, power: l.light.intensity })),
      ...[...roomTiles.entries()]
        .filter(([r]) => !lamps.some((l) => l.room === r))
        .sort((a, b) => b[1].n - a[1].n)
        .map(([, t]): RoomLight => ({ x: t.sx / t.n, y: 2.45, z: t.sz / t.n, area: t.n, kind: 'fill' })),
    ];

    // ---- geometry buckets (one draw call each) --------------------------------------
    const ext = new Geo().color(scheme.wall);
    const int = new Geo();
    const wainscot = new Geo();
    const stone = new Geo();
    const trim = new Geo().color(TRIM);
    const glass = new Geo();
    const ao = new Geo().color('#000000');
    // Covered faces: one bucket per finish (tinted per covering), and natural-wood door leaves.
    const covered = new Map<WallCoveringDef['finish'], Geo>((Object.keys(FINISH_MATERIALS) as WallCoveringDef['finish'][]).map((f) => [f, new Geo()]));
    const doorWood = new Geo();
    /** Every bucket a wall segment writes to (they share its cutaway data). */
    const wallGeos = [ext, int, wainscot, stone, trim, ao, doorWood, ...covered.values()];
    /** The bucket for a covering (0: none, the automatic look), tinted. */
    const coverGeo = (cover: number | undefined): Geo | null => {
      const c = cover ? this.looks.coverings[cover - 1] : undefined;
      return c ? covered.get(c.finish)!.color(c.color) : null;
    };

    const H = WALL_HEIGHT;
    /** Looking along which directions this edge hides the room behind it. */
    const edgeMask = (axis: 'h' | 'v', x: number, z: number): number => {
      if (axis === 'h') return (roomP(x + 0.5, z + 0.25) ? LOOK.PosZ : 0) | (roomP(x + 0.5, z - 0.25) ? LOOK.NegZ : 0);
      return (roomP(x + 0.25, z + 0.5) ? LOOK.PosX : 0) | (roomP(x - 0.25, z + 0.5) ? LOOK.NegX : 0);
    };

    /**
     * One wall face (a rectangle on the plane of a wall side) from `a0` to `a1` along the
     * wall, `y0` to `y1` high. `n` is the outward normal; `r` the room that face looks into.
     */
    const face = (axis: 'h' | 'v', plane: number, a0: number, a1: number, y0: number, y1: number, n: V3, r: number, cover = 0) => {
      const P = (a: number, y: number): V3 => (axis === 'h' ? [a, y, plane] : [plane, y, a]);
      const own = coverGeo(cover);
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
        if (y1 > yb) (own ?? ext).poly([P(a0, yb), P(a1, yb), P(a1, y1), P(a0, y1)], n);
        if (y1 >= H - 0.01) {
          const k = trim.kind;
          trim.kind = Cut.Hide;
          trim.box(...span(axis, plane, n, a0, a1, H - 0.2, H, 0.025));
          trim.kind = k;
        }
        if (y0 < 0.01) ao.poly([Q(a0, 0.012, 0), Q(a1, 0.012, 0), Q(a1, 0.012, 0.45), Q(a0, 0.012, 0.45)], [0, 1, 0], undefined, [0.32, 0.32, 0, 0]);
        return;
      }
      if (own) own.poly([P(a0, y0), P(a1, y0), P(a1, y1), P(a0, y1)], n);
      else {
        const tint = roomWall(r);
        const bath = kinds.get(r) === 'bath';
        // Bathrooms are tiled up to 1.25 m (only the part of this face below that).
        const split = bath ? Math.min(Math.max(1.25, y0), y1) : y0;
        if (split > y0) wainscot.color('#F4F4F2').poly([P(a0, y0), P(a1, y0), P(a1, split), P(a0, split)], n);
        if (y1 > split) int.color(tint).poly([P(a0, split), P(a1, split), P(a1, y1), P(a0, y1)], n);
      }
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
      for (const g of wallGeos) g.cutting(kind, mask);
      const a0 = s0 ?? (axis === 'h' ? x : z) + T;
      const a1 = s1 ?? (axis === 'h' ? x : z) + 1 - T;
      const [c0, c1] = lookOf(axis, x, z).faces ?? [0, 0];
      if (axis === 'h') {
        face('h', z - T, a0, a1, y0, y1, [0, 0, -1], roomP(x + 0.5, z - 0.25), c0);
        face('h', z + T, a0, a1, y0, y1, [0, 0, 1], roomP(x + 0.5, z + 0.25), c1);
        if (cap) trim.box(a0, y1 - 0.001, z - T, a1, y1, z + T, 'ny nx px nz pz');
      } else {
        face('v', x - T, a0, a1, y0, y1, [-1, 0, 0], roomP(x - 0.25, z + 0.5), c0);
        face('v', x + T, a0, a1, y0, y1, [1, 0, 0], roomP(x + 0.25, z + 0.5), c1);
        if (cap) trim.box(x - T, y1 - 0.001, a0, x + T, y1, a1, 'ny nx px nz pz');
      }
    };

    /** A wall with a window: solid below the sill and above the head, piers either side. */
    const windowWall = (axis: 'h' | 'v', x: number, z: number, win: WindowSpec) => {
      const { sill, head } = win;
      const base = axis === 'h' ? x : z;
      const g0 = base + win.inset;
      const g1 = base + 1 - win.inset;
      segment(axis, x, z, 0, sill, Cut.Clamp);
      segment(axis, x, z, head, H, Cut.Hide);
      segment(axis, x, z, sill, head, Cut.Hide, undefined, g0, false);
      segment(axis, x, z, sill, head, Cut.Hide, g1, undefined, false);
      // Reveals: the jambs and the head's underside, in trim.
      const P = (a: number, y: number, d: number): V3 => (axis === 'h' ? [a, y, z + d] : [x + d, y, a]);
      const na: V3 = axis === 'h' ? [1, 0, 0] : [0, 0, 1];
      trim.poly([P(g0, sill, -T), P(g0, sill, T), P(g0, head, T), P(g0, head, -T)], na);
      trim.poly([P(g1, sill, -T), P(g1, head, -T), P(g1, head, T), P(g1, sill, T)], [-na[0], 0, -na[2]]);
      trim.poly([P(g0, head, -T), P(g0, head, T), P(g1, head, T), P(g1, head, -T)], [0, -1, 0]);
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
      return next === 'wall' && cross === undefined && !diagonalAtNode(nx, nz);
    };

    // Wall segments, lintels, door casings, windows.
    const bounds = view ?? { x: 0, z: 0, w: W, d: D };
    for (const axis of ['h', 'v'] as const) {
      for (const [x, z, kind] of edges.all(axis)) {
        if (kind === 'wall') {
          segment(axis, x, z, 0, heightOf(axis, x, z), Cut.Clamp);
        } else if (kind === 'window') {
          const win = this.windowSpec(lookOf(axis, x, z).style);
          windowWall(axis, x, z, win);
          this.window(axis, x, z, edgeMask(axis, x, z), roomP, scheme, trim, glass, [plainEnd(axis, x, z, 0), plainEnd(axis, x, z, 1)], win);
        } else {
          segment(axis, x, z, DOOR_HEIGHT, H, Cut.Hide);
          this.doorway(axis, x, z, edgeMask(axis, x, z), trim, roomP, scheme, { wood: doorWood, glass }, lookOf(axis, x, z).style);
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
        // Corners where a diagonal meets get a mitred post (below).
        if (diagonalAtNode(x, z)) continue;
        let maskH: number = LOOK.All;
        let maskV: number = LOOK.All;
        if (hl) maskH &= edgeMask('h', x - 1, z);
        if (hr) maskH &= edgeMask('h', x, z);
        if (vd) maskV &= edgeMask('v', x, z - 1);
        if (vu) maskV &= edgeMask('v', x, z);
        for (const g of wallGeos) g.cutting(Cut.Clamp, maskH, maskV);
        // As tall as the tallest wall it joins (a run of half walls has half posts).
        const top = Math.max(heightOf('h', x - 1, z), heightOf('h', x, z), heightOf('v', x, z - 1), heightOf('v', x, z));
        trim.box(x - T, top - 0.001, z - T, x + T, top, z + T, 'ny nx px nz pz');
        // Faces towards a door are jambs. Faces towards a wall sit inside it while it stands and
        // close its end when that wall is cut but the post is not.
        // `ra`, `rb`: the rooms of the two quadrants on that side of the corner.
        const side = (dir: 'px' | 'nx' | 'pz' | 'nz', e: EdgeKind | undefined, n: V3, ra: number, rb: number) => {
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
          // Free end or outer corner: exterior if either quadrant on that side is outdoors. It
          // continues the faces of the walls in its plane (or closes the end of the one it ends).
          const cover =
            dir === 'px'
              ? (faceAt('v', x, z - 1, 1) ?? faceAt('v', x, z, 1) ?? faceAt('h', x - 1, z, 0))
              : dir === 'nx'
                ? (faceAt('v', x, z - 1, 0) ?? faceAt('v', x, z, 0) ?? faceAt('h', x, z, 0))
                : dir === 'pz'
                  ? (faceAt('h', x - 1, z, 1) ?? faceAt('h', x, z, 1) ?? faceAt('v', x, z - 1, 0))
                  : (faceAt('h', x - 1, z, 0) ?? faceAt('h', x, z, 0) ?? faceAt('v', x, z, 0));
          face(axis, plane, a0, a1, 0, top, n, ra === 0 || rb === 0 ? 0 : ra, cover ?? 0);
        };
        const q = (dx: number, dz: number) => roomP(x + dx * 0.25, z + dz * 0.25);
        side('px', hr, [1, 0, 0], q(1, -1), q(1, 1));
        side('nx', hl, [-1, 0, 0], q(-1, -1), q(-1, 1));
        side('pz', vu, [0, 0, 1], q(-1, 1), q(1, 1));
        side('nz', vd, [0, 0, -1], q(-1, -1), q(1, -1));
        // Corner boards where an outside corner turns.
        this.cornerBoards(x, z, { hl, hr, vd, vu }, roomP, trim);
      }
    }

    // ---- diagonal walls ----------------------------------------------------------------
    /** Look directions in which a wall hides the room on the side `(nx, nz)` of it. */
    const lookBits = (nx: number, nz: number) => (nx > 0 ? LOOK.PosX : nx < 0 ? LOOK.NegX : 0) | (nz > 0 ? LOOK.PosZ : nz < 0 ? LOOK.NegZ : 0);
    /** A diagonal's frame from its first to its second corner; `n` points into half 1. */
    const frameOf = (d: DiagonalWall) => {
      const [a, b] = diagonalEnds(d.axis, d.x, d.z);
      return new WallFrame(a[0], a[1], b[0], b[1]);
    };
    const diagMask = (d: DiagonalWall) => {
      const f = frameOf(d);
      return (d.rooms[1] ? lookBits(f.nx, f.nz) : 0) | (d.rooms[0] ? lookBits(-f.nx, -f.nz) : 0);
    };
    /**
     * `face` for walls of any direction: a rectangle on the plane `dOff` across frame `f`, facing
     * side `sign`, `a0..a1` along it, into room `r` (exterior cladding outdoors, wallpaper inside).
     */
    const faceG = (f: WallFrame, a0: number, a1: number, y0: number, y1: number, dOff: number, sign: number, r: number, cover = 0) => {
      const out = (o: number): [number, number] => (sign > 0 ? [dOff, dOff + o] : [dOff - o, dOff]);
      const own = coverGeo(cover);
      // Contact shadow on the floor along the face (fading out `o0..o1` from it).
      const ground = (y: number, o0: number, o1: number, alphas: number[]) => {
        ao.poly([f.at(a0, y, dOff + sign * o0), f.at(a1, y, dOff + sign * o0), f.at(a1, y, dOff + sign * o1), f.at(a0, y, dOff + sign * o1)], [0, 1, 0], undefined, alphas);
      };
      if (r === 0) {
        if (y0 < PLINTH) {
          const ledge = 0.03;
          f.face(stone, a0, a1, y0, Math.min(PLINTH, y1), dOff, sign);
          stone.poly([f.at(a0, PLINTH, dOff), f.at(a1, PLINTH, dOff), f.at(a1, PLINTH, dOff + sign * ledge), f.at(a0, PLINTH, dOff + sign * ledge)], [0, 1, 0]);
          f.face(stone, a0, a1, y0, PLINTH, dOff + sign * ledge, sign);
        }
        const yb = Math.max(y0, PLINTH);
        if (y1 > yb) f.face(own ?? ext, a0, a1, yb, y1, dOff, sign);
        if (y1 >= H - 0.01) {
          const k = trim.kind;
          trim.kind = Cut.Hide;
          f.box(trim, a0, a1, H - 0.2, H, ...out(0.025), sign > 0 ? 'nd' : 'pd');
          trim.kind = k;
        }
        if (y0 < 0.01) ground(0.012, 0, 0.45, [0.32, 0.32, 0, 0]);
        return;
      }
      if (own) f.face(own, a0, a1, y0, y1, dOff, sign);
      else {
        const tint = roomWall(r);
        const bath = kinds.get(r) === 'bath';
        const split = bath ? Math.min(Math.max(1.25, y0), y1) : y0;
        if (split > y0) f.face(wainscot.color('#F4F4F2'), a0, a1, y0, split, dOff, sign);
        if (y1 > split) f.face(int.color(tint), a0, a1, split, y1, dOff, sign);
      }
      if (y0 < 0.01) {
        f.box(trim, a0, a1, 0, 0.1, ...out(0.014), sign > 0 ? 'nd' : 'pd');
        ground(0.013, 0.014, 0.34, [0.3, 0.3, 0, 0]);
      }
    };
    /** Both faces, the cap and the cutaway data of part `a0..a1` of a diagonal wall. */
    const diagSegment = (f: WallFrame, d: DiagonalWall, y0: number, y1: number, kind: number, a0: number, a1: number, cap = true) => {
      const mask = diagMask(d);
      for (const g of wallGeos) g.cutting(kind, mask);
      faceG(f, a0, a1, y0, y1, -T, -1, d.rooms[0], d.faces?.[0]);
      faceG(f, a0, a1, y0, y1, T, 1, d.rooms[1], d.faces?.[1]);
      if (cap) trim.poly([f.at(a0, y1, -T), f.at(a1, y1, -T), f.at(a1, y1, T), f.at(a0, y1, T)], [0, 1, 0]);
    };
    /** Whether a diagonal run continues as a plain wall past one end (room for a shutter). */
    const plainDiagEnd = (d: DiagonalWall, end: 0 | 1) => {
      const [a, b] = diagonalEnds(d.axis, d.x, d.z);
      const [cx, cz] = end ? b : a;
      const step = end ? 1 : -1;
      const next = diagonal(d.x + step, d.z + (d.axis === 'dp' ? step : -step));
      const axisWalls = edges.get('h', cx - 1, cz) ?? edges.get('h', cx, cz) ?? edges.get('v', cx, cz - 1) ?? edges.get('v', cx, cz);
      return next?.axis === d.axis && next.kind === 'wall' && axisWalls === undefined && diagonalsAt(cx, cz).length === 2;
    };
    for (const d of world.diagonals ?? []) {
      if (!inView(d.x, d.z)) continue;
      const f = frameOf(d);
      const L = f.length;
      const [a0, a1] = [T, L - T];
      const mask = diagMask(d);
      if (d.kind === 'wall') {
        diagSegment(f, d, 0, d.form ? HALF_WALL_HEIGHT : H, Cut.Clamp, a0, a1);
      } else if (d.kind === 'window') {
        // The same glazing as a straight window, centred, with wider piers either side.
        const win = this.windowSpec(d.style);
        const { sill, head } = win;
        const [g0, g1] = [L / 2 - (0.5 - win.inset), L / 2 + (0.5 - win.inset)];
        diagSegment(f, d, 0, sill, Cut.Clamp, a0, a1);
        diagSegment(f, d, head, H, Cut.Hide, a0, a1);
        diagSegment(f, d, sill, head, Cut.Hide, a0, g0, false);
        diagSegment(f, d, sill, head, Cut.Hide, g1, a1, false);
        trim.poly([f.at(g0, sill, -T), f.at(g0, sill, T), f.at(g0, head, T), f.at(g0, head, -T)], [f.ux, 0, f.uz]);
        trim.poly([f.at(g1, sill, -T), f.at(g1, head, -T), f.at(g1, head, T), f.at(g1, sill, T)], [-f.ux, 0, -f.uz]);
        trim.poly([f.at(g0, head, -T), f.at(g0, head, T), f.at(g1, head, T), f.at(g1, head, -T)], [0, -1, 0]);
        // Glazing bars between the panes, then per face: a pane, frame, sill and (outside) shutters.
        const recess = 0.03;
        trim.cutting(Cut.Hide, mask).color(TRIM);
        muntins(win, g0, g1, (a0, a1, y0, y1) => f.box(trim, a0, a1, y0, y1, -T + recess, T - recess));
        for (const sign of [-1, 1]) {
          const plane = sign * T;
          const outside = d.rooms[sign > 0 ? 1 : 0] === 0;
          const out = (o: number): [number, number] => (sign > 0 ? [plane, plane + o] : [plane - o, plane]);
          glass.cutting(Cut.Hide, mask);
          f.face(glass, g0, g1, sill, head, plane - sign * recess, sign);
          trim.cutting(Cut.Hide, mask).color(TRIM);
          const fr = 0.07;
          f.box(trim, g0 - fr, g0, sill, head, ...out(0.035));
          f.box(trim, g1, g1 + fr, sill, head, ...out(0.035));
          f.box(trim, g0 - fr, g1 + fr, head, head + fr, ...out(0.035));
          f.box(trim, g0 - fr - 0.04, g1 + fr + 0.04, sill - 0.05, sill, ...out(outside ? 0.07 : 0.05));
          if (outside && (win.shutters === 'house' ? scheme.shutters : win.shutters)) {
            trim.color(scheme.accent);
            if (g0 - fr - 0.36 >= a0 || plainDiagEnd(d, 0)) f.box(trim, g0 - fr - 0.36, g0 - fr - 0.02, sill - 0.02, head + 0.04, ...out(0.03));
            if (g1 + fr + 0.36 <= a1 || plainDiagEnd(d, 1)) f.box(trim, g1 + fr + 0.02, g1 + fr + 0.36, sill - 0.02, head + 0.04, ...out(0.03));
            trim.color(TRIM);
          }
        }
      } else {
        // A door as wide as a straight one, centred, with wall either side and a lintel above.
        const [o0, o1] = [L / 2 - (0.5 - T), L / 2 + (0.5 - T)];
        diagSegment(f, d, 0, H, Cut.Clamp, a0, o0);
        diagSegment(f, d, 0, H, Cut.Clamp, o1, a1);
        diagSegment(f, d, DOOR_HEIGHT, H, Cut.Hide, o0, o1);
        trim.cutting(Cut.Clamp, mask).color(TRIM);
        trim.poly([f.at(o0, 0, -T), f.at(o0, 0, T), f.at(o0, DOOR_HEIGHT, T), f.at(o0, DOOR_HEIGHT, -T)], [f.ux, 0, f.uz]);
        trim.poly([f.at(o1, 0, -T), f.at(o1, DOOR_HEIGHT, -T), f.at(o1, DOOR_HEIGHT, T), f.at(o1, 0, T)], [-f.ux, 0, -f.uz]);
        trim.cutting(Cut.Hide, mask);
        trim.poly([f.at(o0, DOOR_HEIGHT, -T), f.at(o0, DOOR_HEIGHT, T), f.at(o1, DOOR_HEIGHT, T), f.at(o1, DOOR_HEIGHT, -T)], [0, -1, 0]);
        for (const sign of [-1, 1]) {
          const plane = sign * T;
          const out = (o: number): [number, number] => (sign > 0 ? [plane, plane + o] : [plane - o, plane]);
          trim.cutting(Cut.Clamp, mask);
          f.box(trim, o0 - 0.1, o0 + 0.01, 0, DOOR_HEIGHT + 0.1, ...out(0.022));
          f.box(trim, o1 - 0.01, o1 + 0.1, 0, DOOR_HEIGHT + 0.1, ...out(0.022));
          trim.cutting(Cut.Hide, mask);
          f.box(trim, o0 - 0.1, o1 + 0.1, DOOR_HEIGHT, DOOR_HEIGHT + 0.12, ...out(0.024));
        }
        // The leaf, open 90° towards the indoor side (accent colour on a painted front door).
        const out0 = d.rooms[0] === 0;
        const front = out0 !== (d.rooms[1] === 0);
        const into = out0 ? 1 : -1;
        const at = (l: number) => into * (T + 0.01 + l);
        const hinge = o0 + 0.02;
        this.leaf(d.style, front, scheme, mask, { trim, wood: doorWood, glass }, {
          box: (g, s0, s1, y0, y1, l0, l1) => f.box(g, hinge + s0, hinge + s1, y0, y1, Math.min(at(l0), at(l1)), Math.max(at(l0), at(l1))),
          pane: (y0, y1, l0, l1) => {
            const a = hinge + LEAF_T / 2;
            const pts: V3[] = [f.at(a, y0, at(l0)), f.at(a, y0, at(l1)), f.at(a, y1, at(l1)), f.at(a, y1, at(l0))];
            glass.poly(pts, [f.ux, 0, f.uz]);
            glass.poly([...pts].reverse(), [-f.ux, 0, -f.uz]);
          },
        });
      }
    }

    // Mitred posts where diagonals meet other walls (or end): the outline joins every wall's
    // faces, and each side of it is dressed like the wall face it continues.
    for (let z = bounds.z; z <= bounds.z + bounds.d; z++) {
      for (let x = bounds.x; x <= bounds.x + bounds.w; x++) {
        const diags = diagonalsAt(x, z).filter(({ d }) => inView(d.x, d.z));
        if (!diags.length) continue;
        const walls: { dir: P2; kind: EdgeKind; mask: number; group: 0 | 1; height: number }[] = diags.map(({ d, dir }) => ({
          dir,
          kind: d.kind === 'door' ? 'wall' : d.kind,
          mask: diagMask(d),
          group: d.axis === 'dp' ? 0 : 1,
          height: d.kind === 'wall' && d.form ? HALF_WALL_HEIGHT : H,
        }));
        const axisWall = (kind: EdgeKind | undefined, dir: P2, axis: 'h' | 'v', ex: number, ez: number) => {
          if (kind) walls.push({ dir, kind, mask: edgeMask(axis, ex, ez), group: axis === 'h' ? 0 : 1, height: heightOf(axis, ex, ez) });
        };
        axisWall(edges.get('h', x - 1, z), [-1, 0], 'h', x - 1, z);
        axisWall(edges.get('h', x, z), [1, 0], 'h', x, z);
        axisWall(edges.get('v', x, z - 1), [0, -1], 'v', x, z - 1);
        axisWall(edges.get('v', x, z), [0, 1], 'v', x, z);
        walls.sort((a, b) => Math.atan2(a.dir[1], a.dir[0]) - Math.atan2(b.dir[1], b.dir[0]));
        let maskA: number = LOOK.All;
        let maskB: number = LOOK.All;
        for (const w of walls) {
          if (w.group === 0) maskA &= w.mask;
          else maskB &= w.mask;
        }
        for (const g of wallGeos) g.cutting(Cut.Clamp, maskA, maskB);
        const outline: P2[] = [];
        for (const p of postOutline([x, z], walls.map((w) => w.dir), T)) {
          const last = outline[outline.length - 1];
          if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) > 1e-5) outline.push(p);
        }
        while (outline.length > 1 && Math.hypot(outline[0][0] - outline[outline.length - 1][0], outline[0][1] - outline[outline.length - 1][1]) < 1e-5) outline.pop();
        const top = Math.max(...walls.map((w) => w.height));
        for (let k = 0; k < outline.length; k++) {
          const p0 = outline[k];
          const p1 = outline[(k + 1) % outline.length];
          trim.poly([[x, top, z], [p0[0], top, p0[1]], [p1[0], top, p1[1]]], [0, 1, 0]);
          // Frames run along +x (or +z) so textures line up with the walls they continue.
          const flip = p1[0] < p0[0] - 1e-9 || (Math.abs(p1[0] - p0[0]) <= 1e-9 && p1[1] < p0[1]);
          const f = flip ? new WallFrame(p1[0], p1[1], p0[0], p0[1]) : new WallFrame(p0[0], p0[1], p1[0], p1[1]);
          // Outward: the right-hand side of a counter-clockwise outline.
          const ox = p1[1] - p0[1];
          const oz = -(p1[0] - p0[0]);
          const sign = f.nx * ox + f.nz * oz > 0 ? 1 : -1;
          const mx = (p0[0] + p1[0]) / 2;
          const mz = (p0[1] + p1[1]) / 2;
          // A side across a wall's end (hidden in it while it stands): a door jamb, or the wall's end.
          const end = walls.find((w) => Math.hypot(mx - x - w.dir[0] * T, mz - z - w.dir[1] * T) < 1e-4);
          if (end?.kind === 'door') {
            f.face(trim, 0, f.length, 0, DOOR_HEIGHT, 0, sign);
            continue;
          }
          const ol = Math.hypot(ox, oz) || 1;
          let r: number;
          if (end) {
            const [ux, uz] = end.dir;
            const ra = roomP(x + ux * (T + 0.15) - uz * 0.2, z + uz * (T + 0.15) + ux * 0.2);
            const rb = roomP(x + ux * (T + 0.15) + uz * 0.2, z + uz * (T + 0.15) - ux * 0.2);
            r = ra === 0 || rb === 0 ? 0 : ra;
          } else r = roomP(mx + (ox / ol) * 0.2, mz + (oz / ol) * 0.2);
          faceG(f, 0, f.length, 0, top, 0, sign, r);
        }
      }
    }

    // ---- floors: the covering laid in Build mode, else by room kind -----------------
    const wood = new Geo();
    const tile = new Geo();
    const carpet = new Geo();
    const stoneFloor = new Geo();
    const carpetTint = pick(CARPET, sx, sz, 21);
    const laid = new Map<number, number>();
    for (const [x, z, c] of world.floors ?? []) laid.set(z * W + x, c);
    const FINISH = { wood, tile, carpet, stone: stoneFloor };
    for (let z = bounds.z; z < bounds.z + bounds.d; z++) {
      for (let x = bounds.x; x < bounds.x + bounds.w; x++) {
        const r = room(x, z);
        if (r === 0) continue;
        const covering = laid.get(z * W + x);
        const def = covering ? this.looks.floors[covering - 1] : undefined;
        const floorOf = (r: number) => {
          if (def) return FINISH[def.finish].color(def.color);
          const kind = kinds.get(r) ?? 'living';
          return kind === 'bath' || kind === 'kitchen' ? tile.color(kind === 'bath' ? '#F4F4F2' : '#E6DCCB') : kind === 'bedroom' ? carpet.color(carpetTint) : wood.color('#FFFFFF');
        };
        const d = diagonal(x, z);
        if (d) {
          // A triangle per indoor half of a split tile.
          for (const h of [0, 1] as const) {
            if (d.rooms[h] === 0) continue;
            floorOf(d.rooms[h]).poly(
              halfTriangle(d.axis, h).map(([fx, fz]) => [x + fx, 0.01, z + fz] as V3),
              [0, 1, 0],
            );
          }
          continue;
        }
        floorOf(r).poly([[x, 0.01, z], [x + 1, 0.01, z], [x + 1, 0.01, z + 1], [x, 0.01, z + 1]], [0, 1, 0]);
      }
    }

    // ---- roofs over the indoor area --------------------------------------------------
    const roof = new Geo().color(scheme.roof);
    const roofTrim = new Geo().color(TRIM);
    const gables = new Geo().color(scheme.wall);
    const viewDiagonals = (world.diagonals ?? []).some((d) => inView(d.x, d.z) && (d.rooms[0] !== 0 || d.rooms[1] !== 0));
    if (Number.isFinite(minX) && !viewDiagonals) {
      for (const rect of indoorRects(room, minX, minZ, maxX, maxZ)) {
        addRoofShaped(rect, scheme, roof, roofTrim, gables);
      }
    } else if (Number.isFinite(minX)) {
      // With diagonal walls: per connected indoor area. A convex outline (a diamond, a box with
      // cut corners) gets a hip roof that follows it; any other shape gets the usual rectangles
      // over its tiles, split tiles included whole (their outdoor half under a deeper eave).
      const seen = new Set<number>();
      for (let z = minZ; z < maxZ; z++) {
        for (let x = minX; x < maxX; x++) {
          const start = z * W + x;
          if (room(x, z) === 0 || !inView(x, z) || seen.has(start)) continue;
          const tiles: number[] = [];
          const queue = [start];
          seen.add(start);
          while (queue.length) {
            const i = queue.pop()!;
            tiles.push(i);
            const tx = i % W;
            const tz = Math.floor(i / W);
            for (const [nx, nz] of [[tx + 1, tz], [tx - 1, tz], [tx, tz + 1], [tx, tz - 1]]) {
              const n = nz * W + nx;
              if (nx >= minX && nz >= minZ && nx < maxX && nz < maxZ && room(nx, nz) !== 0 && inView(nx, nz) && !seen.has(n)) {
                seen.add(n);
                queue.push(n);
              }
            }
          }
          const inArea = new Set(tiles);
          const corners: P2[] = [];
          let indoorArea = 0;
          let split = false;
          for (const i of tiles) {
            const tx = i % W;
            const tz = Math.floor(i / W);
            const d = diagonal(tx, tz);
            if (!d) {
              indoorArea += 1;
              corners.push([tx, tz], [tx + 1, tz], [tx + 1, tz + 1], [tx, tz + 1]);
              continue;
            }
            split = true;
            for (const h of [0, 1] as const) {
              if (d.rooms[h] === 0) continue;
              indoorArea += 0.5;
              for (const [fx, fz] of halfTriangle(d.axis, h)) corners.push([tx + fx, tz + fz]);
            }
          }
          const hull = convexHull(corners);
          if (split && indoorArea >= 2 && Math.abs(area(hull) - indoorArea) < 1e-3) {
            addHipPolygon(hull, roof, roofTrim, H, T, scheme.shape === 'flat' ? 0.12 : OVERHANG, scheme.pitch, ROOF_THICKNESS);
            continue;
          }
          // Here every leftover gets its own small roof too, so no part of the room stays open.
          const indoor = (tx: number, tz: number) => (inArea.has(tz * W + tx) ? 1 : 0);
          for (const rect of indoorRects(indoor, minX, minZ, maxX, maxZ, 1)) addRoofShaped(rect, scheme, roof, roofTrim, gables);
        }
      }
    }

    // ---- garden: foundation shrubs and a few lot trees --------------------------------
    // The player's own lot gets no automatic border: they plant their garden themselves, and
    // building a room there shouldn't make flowers appear around it.
    const homeId = world.households?.find((h) => h.player)?.plot;
    const home = homeId == null ? null : world.plots?.[homeId];
    const onHome = (x: number, z: number) => !!home && x >= home.x && z >= home.z && x < home.x + home.w && z < home.z + home.d;
    const paths = [...(world.meta?.paths ?? []), ...(world.meta?.streets ?? [])];
    const paved = (x: number, z: number) => paths.some((r) => x >= r.x - 0.6 && x < r.x + r.w + 0.6 && z >= r.z - 0.6 && z < r.z + r.d + 0.6);
    // Garden spots: outdoors, off furniture and paths, and not on a tile split by a diagonal.
    const free = (x: number, z: number) =>
      inView(Math.floor(x), Math.floor(z)) && roomP(x, z) === 0 && !diagonal(Math.floor(x), Math.floor(z)) && !occupied.has(Math.floor(z) * W + Math.floor(x)) && !paved(x, z);
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
          const indoor = axis === 'h' ? roomP(x + 0.5, z - side * 0.25) : roomP(x - side * 0.25, z + 0.5);
          if (indoor === 0) continue;
          if (!free(px, pz) || onHome(px, pz) || hash(x * 3 + side, z, 31) < 0.3) continue;
          shrubs.push([px, pz, 0.55 + hash(x, z, 32 + side) * 0.3, hash(x, z, 33) * 6.28]);
        }
      }
    }
    // Along diagonal walls with a room on one side: a shrub in the outdoor half (not by doors).
    for (const d of world.diagonals ?? []) {
      if (d.kind === 'door' || !inView(d.x, d.z) || (d.rooms[0] === 0) === (d.rooms[1] === 0)) continue;
      const step = d.axis === 'dp' ? 1 : -1;
      if (diagonal(d.x - 1, d.z - step)?.kind === 'door' || diagonal(d.x + 1, d.z + step)?.kind === 'door') continue;
      const f = frameOf(d);
      const sign = d.rooms[1] === 0 ? 1 : -1;
      // Out in the triangle's far corner (as far from the wall as shrubs along straight walls).
      const px = d.x + 0.5 + f.nx * sign * 0.62;
      const pz = d.z + 0.5 + f.nz * sign * 0.62;
      if (paved(px, pz) || onHome(px, pz) || hash(d.x * 3 + 7, d.z, 31) < 0.3) continue;
      shrubs.push([px, pz, 0.5 + hash(d.x, d.z, 34) * 0.2, hash(d.x, d.z, 33) * 6.28]);
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
    for (const [finish, geo] of covered) add(geo, `walls-${finish}`, FINISH_MATERIALS[finish], { cast: true });
    add(doorWood, 'doorLeaves', M.door, { cast: true });
    add(glass, 'windows', M.clearGlass);
    // Glass is see-through: draw it after the other blended surfaces (contact shadows) so
    // what lies behind it is complete when it is blended over.
    const panes = meshes.find((m) => m.name === 'windows');
    if (panes) panes.alphaIndex = 10;
    add(ao, 'contactShadows', this.lib.contactShadow(), { cut: true });
    add(wood, 'floors', M.floorWood, { cut: false });
    add(tile, 'floorsTiled', M.floorTile, { cut: false });
    add(carpet, 'floorsCarpet', M.floorCarpet, { cut: false });
    add(stoneFloor, 'floorsStone', M.stone, { cut: false });
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
      const s = this.schemeWith(houseScheme(b.x0, b.z0), b.roof);
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
      addRoofShaped({ x0: b.x0, z0: b.z0, x1: b.x1, z1: b.z1 }, s, roof, trim, walls);
      if (hash(b.x0, b.z0, 8) < 0.6 && s.shape !== 'flat' && !b.roof) this.chimney(b, s, brick, stone);
      const g = b.garage;
      if (g) {
        walls.color(s.wall);
        shell(walls, g.x0, g.z0, g.x1, g.z1, GARAGE_HEIGHT);
        roof.color(s.roof);
        addRoofShaped(g, s, roof, trim, walls, GARAGE_HEIGHT, 0.3);
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
    roomP: (px: number, pz: number) => number,
    scheme: HouseScheme,
    geos: { wood: Geo; glass: Geo },
    style: number | undefined,
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
    const outdoorA = axis === 'h' ? roomP(x + 0.5, z - 0.25) === 0 : roomP(x - 0.25, z + 0.5) === 0;
    const outdoorB = axis === 'h' ? roomP(x + 0.5, z + 0.25) === 0 : roomP(x + 0.25, z + 0.5) === 0;
    const front = outdoorA !== outdoorB;
    const into = outdoorA ? 1 : -1; // swing towards the indoor side
    // Leaf space: `s` across its thickness from the hinge jamb, `l` from the hinge outwards.
    const hinge = (axis === 'h' ? x : z) + T + 0.02;
    const at = (l: number) => (axis === 'h' ? z : x) + into * (T + 0.01 + l);
    const { glass } = geos;
    this.leaf(style, front, scheme, mask, { trim, ...geos }, {
      box: (g, s0, s1, y0, y1, l0, l1) => {
        const [p0, p1] = [Math.min(at(l0), at(l1)), Math.max(at(l0), at(l1))];
        if (axis === 'h') g.box(hinge + s0, y0, p0, hinge + s1, y1, p1);
        else g.box(p0, y0, hinge + s0, p1, y1, hinge + s1);
      },
      pane: (y0, y1, l0, l1) => {
        const c = hinge + LEAF_T / 2;
        const P = (l: number, y: number): V3 => (axis === 'h' ? [c, y, at(l)] : [at(l), y, c]);
        const pts: V3[] = [P(l0, y0), P(l1, y0), P(l1, y1), P(l0, y1)];
        const n: V3 = axis === 'h' ? [1, 0, 0] : [0, 0, 1];
        glass.poly(pts, n);
        glass.poly([...pts].reverse(), [-n[0], 0, -n[2]]);
      },
    });
  }

  /**
   * A door leaf, open against its jamb, in a style: `panel` (painted: the style's colour, else the
   * house accent on front doors and off-white inside), `oak` (natural wood), `halfGlass` (solid
   * below, glazed above) or `glass` (a glazed frame). `put.box` draws in leaf space (`s` across
   * its thickness, `y` up, `l` from the hinge outwards); `put.pane` a glass pane through it.
   */
  private leaf(
    style: number | undefined,
    front: boolean,
    scheme: HouseScheme,
    mask: number,
    geos: { trim: Geo; wood: Geo; glass: Geo },
    put: { box: (g: Geo, s0: number, s1: number, y0: number, y1: number, l0: number, l1: number) => void; pane: (y0: number, y1: number, l0: number, l1: number) => void },
  ): void {
    const def = this.looks.doors[style ?? 0] ?? PANEL_DOOR;
    const { trim, wood, glass } = geos;
    for (const g of [trim, wood, glass]) g.cutting(Cut.Hide, mask);
    const paint = def.color ?? (front ? scheme.accent : '#EDEAE2');
    const top = DOOR_HEIGHT - 0.03;
    const box = (g: Geo, y0: number, y1: number, l0: number, l1: number) => put.box(g, 0, LEAF_T, y0, y1, l0, l1);
    if (def.leaf === 'oak') box(wood.color('#FFFFFF'), 0.01, top, 0, LEAF_W);
    else if (def.leaf === 'panel') box(trim.color(paint), 0.01, top, 0, LEAF_W);
    else {
      // A frame of stiles and rails around glass (half-glazed: a solid panel below).
      const glassFrom = def.leaf === 'halfGlass' ? 1.05 : 0.22;
      const stile = def.leaf === 'halfGlass' ? 0.1 : 0.08;
      trim.color(paint);
      box(trim, 0.01, glassFrom, 0, LEAF_W);
      box(trim, glassFrom, top, 0, stile);
      box(trim, glassFrom, top, LEAF_W - stile, LEAF_W);
      box(trim, top - 0.1, top, stile, LEAF_W - stile);
      if (def.leaf === 'glass') box(trim, 1.08, 1.12, stile, LEAF_W - stile);
      put.pane(glassFrom, top - 0.1, stile, LEAF_W - stile);
    }
    // A brass handle on both faces.
    trim.color('#B39A62');
    put.box(trim, -0.035, LEAF_T + 0.035, 1.0, 1.05, LEAF_W - 0.12, LEAF_W - 0.07);
    trim.color(TRIM);
  }

  private window(
    axis: 'h' | 'v',
    x: number,
    z: number,
    mask: number,
    roomP: (px: number, pz: number) => number,
    scheme: HouseScheme,
    trim: Geo,
    glass: Geo,
    shutters: [boolean, boolean],
    win: WindowSpec,
  ): void {
    // Frames, sill and shutters on both faces around the opening (see `windowWall`); a pane
    // with glazing bars set a little into the opening from each side.
    const { sill, head } = win;
    const a0 = (axis === 'h' ? x : z) + win.inset;
    const a1 = (axis === 'h' ? x : z) + 1 - win.inset;
    const recess = 0.03;
    const n0: V3 = axis === 'h' ? [0, 0, 1] : [1, 0, 0];
    const back = (axis === 'h' ? z : x) - T + recess;
    trim.cutting(Cut.Hide, mask).color(TRIM);
    muntins(win, a0, a1, (b0, b1, y0, y1) => trim.box(...span(axis, back, n0, b0, b1, y0, y1, 2 * (T - recess))));
    for (const sign of [-1, 1]) {
      const n: V3 = axis === 'h' ? [0, 0, sign] : [sign, 0, 0];
      const plane = axis === 'h' ? z + sign * T : x + sign * T;
      const tileRoom = axis === 'h' ? roomP(x + 0.5, z + sign * 0.25) : roomP(x + sign * 0.25, z + 0.5);
      const outside = tileRoom === 0;
      const P = (a: number, y: number, d: number): V3 => (axis === 'h' ? [a, y, plane + n[2] * d] : [plane + n[0] * d, y, a]);
      // One clear pane per face, facing out of it (back faces are culled, so each side sees
      // through exactly one pane).
      glass.cutting(Cut.Hide, mask).poly([P(a0, sill, -recess), P(a1, sill, -recess), P(a1, head, -recess), P(a0, head, -recess)], n);
      trim.cutting(Cut.Hide, mask).color(TRIM);
      const f = 0.07;
      const out = 0.035;
      trim.box(...span(axis, plane, n, a0 - f, a0, sill, head, out));
      trim.box(...span(axis, plane, n, a1, a1 + f, sill, head, out));
      trim.box(...span(axis, plane, n, a0 - f, a1 + f, head, head + f, out));
      trim.box(...span(axis, plane, n, a0 - f - 0.04, a1 + f + 0.04, sill - 0.05, sill, outside ? 0.07 : 0.05));
      if (outside && (win.shutters === 'house' ? scheme.shutters : win.shutters)) {
        trim.color(scheme.accent);
        if (shutters[0]) trim.box(...span(axis, plane, n, a0 - f - 0.36, a0 - f - 0.02, sill - 0.02, head + 0.04, 0.03));
        if (shutters[1]) trim.box(...span(axis, plane, n, a1 + f + 0.02, a1 + f + 0.36, sill - 0.02, head + 0.04, 0.03));
        trim.color(TRIM);
      }
    }
  }

  private cornerBoards(
    x: number,
    z: number,
    e: { hl?: EdgeKind; hr?: EdgeKind; vd?: EdgeKind; vu?: EdgeKind },
    roomP: (px: number, pz: number) => number,
    trim: Geo,
  ): void {
    // An outside corner: exactly one h and one v edge meet and the outer quadrant is outdoors.
    const h = e.hl ? -1 : e.hr ? 1 : 0;
    const v = e.vd ? -1 : e.vu ? 1 : 0;
    if (!h || !v || (e.hl && e.hr) || (e.vd && e.vu)) return;
    // The quadrant opposite both walls is the outer one.
    if (roomP(h < 0 ? x + 0.25 : x - 0.25, v < 0 ? z + 0.25 : z - 0.25) !== 0) return;
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
/**
 * Glazing bars of a window between `g0` and `g1` along its wall: `bar(a0, a1, y0, y1)` puts one
 * through the opening (between the two panes, so it shows once through the clear glass).
 */
function muntins(win: WindowSpec, g0: number, g1: number, bar: (a0: number, a1: number, y0: number, y1: number) => void): void {
  const { sill, head } = win;
  const w = 0.016;
  const vertical = (a: number) => bar(a - w, a + w, sill, head);
  const across = (y: number) => bar(g0, g1, y, y + 0.03);
  const mid = (g0 + g1) / 2;
  if (win.panes === 'cross') {
    vertical(mid);
    across((sill + head) / 2 + 0.1);
  } else if (win.panes === 'bar') vertical(mid);
  else if (win.panes === 'grid') {
    vertical(g0 + (g1 - g0) / 3);
    vertical(g0 + (2 * (g1 - g0)) / 3);
    across((sill + head) / 2 - 0.015);
  } else if (win.panes === 'transom') {
    across(head - 0.42);
    vertical(mid);
  }
}

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

/**
 * Covers the indoor tiles of a bounding box with a few rectangles (greedy, row-major). Leftovers
 * smaller than `minArea` tiles (e.g. a single-tile porch notch) don't get their own roof.
 */
function indoorRects(room: (x: number, z: number) => number, x0: number, z0: number, x1: number, z1: number, minArea = 4): { x0: number; z0: number; x1: number; z1: number }[] {
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
      if ((xe - x) * (ze - z) >= minArea) out.push({ x0: x, z0: z, x1: xe, z1: ze });
    }
  }
  return out;
}

/** A roof of the scheme's shape (gable, hip or flat) over a rectangle of wall centre lines. */
function addRoofShaped(
  rect: { x0: number; z0: number; x1: number; z1: number },
  s: RoofShape,
  roof: Geo,
  trim: Geo,
  gables: Geo,
  base = WALL_HEIGHT,
  overhang = OVERHANG,
): void {
  if (s.shape === 'flat') addFlatRoof(rect, roof, trim, base);
  else addRoof(rect, s.shape === 'hip', roof, trim, gables, base, overhang, s.pitch);
}

/** A flat roof: a slab just over the walls with a small overhang, edged with a fascia. */
function addFlatRoof(rect: { x0: number; z0: number; x1: number; z1: number }, roof: Geo, trim: Geo, base = WALL_HEIGHT): void {
  const o = 0.16;
  const [a0, b0, a1, b1] = [rect.x0 - T - o, rect.z0 - T - o, rect.x1 + T + o, rect.z1 + T + o];
  roof.box(a0 + 0.02, base, b0 + 0.02, a1 - 0.02, base + 0.16, b1 - 0.02, 'ny');
  trim.box(a0, base - 0.04, b0, a1, base + 0.2, b1, 'py');
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
  pitch = PITCH,
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
  const ye = H - o * pitch; // underside height at the eaves
  const yr = ye + half * pitch; // underside height at the ridge
  const slope = Math.sqrt(1 + pitch * pitch);
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
