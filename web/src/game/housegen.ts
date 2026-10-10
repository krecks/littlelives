/**
 * Generated houses (0.18): every neighbour's home is laid out from `content/housegen.json`.
 *
 * A house class is picked by lot size (bedrooms, size, whether it has a living room, a second
 * bathroom or a second storey), then:
 * 1. the footprint is split into rooms (a guillotine plan: each cut divides the rooms left into
 *    two groups by the floor they want), so every room is a rectangle and the plan stays connected;
 * 2. doors join the rooms (a tree from the entrance, preferring doors onto the living room or
 *    kitchen), the front door faces the street; kitchen and living room may share an open space;
 * 3. two-storey houses get stairs along an outside wall of the living room, an upstairs hall over
 *    them, and the bedrooms and a bathroom off that hall;
 * 4. windows go along the outside walls, furniture against the walls (doors and stairs kept clear,
 *    every piece reachable), and a few things into the garden.
 *
 * Seeded: the same seed, lot size and config always give the same house, so a town keeps only
 * `gen:<lot size>:<seed>` per lot (see `town.ts`). Output is a `HouseTemplate` in the layouts'
 * frame (drawn for a medium lot, front to the street at z = 0), with `upper` for storey 1.
 */

import type { Door, HouseTemplate, Placement, Wall } from './town';

export interface HouseGenConfig {
  classes: Record<string, HouseClass>;
  /** Class weights per lot size. */
  lots: Record<string, Record<string, number>>;
  margins: { front: [number, number]; back: number; side: number };
  rooms: Record<Kind, RoomSpec>;
  openPlan: number;
  windows: { spacing: [number, number] };
  stairs: string;
  garden: { objects: string[]; count: [number, number] };
  names: { first: string[]; second: Record<string, string[]> };
}

interface HouseClass {
  label: string;
  bedrooms: [number, number];
  /** Chance of a living room. */
  living: number;
  /** Chance of a second bathroom. */
  extraBathroom: number;
  storeys: { one: number; two: number };
  width: [number, number];
  depth: [number, number];
}

type RoomKind = Kind | 'hall';
/** Rooms with a recipe in the config (an upstairs hall has none). */
type Kind = 'bedroom' | 'kitchen' | 'bathroom' | 'living';

interface RoomSpec {
  weight: number;
  minSide: number;
  furniture: { one: string[]; chance?: number; count?: [number, number]; opposite?: string }[];
}

/** An object's footprint `[w, d]` (along x and z, facing +z), or undefined if it doesn't exist. */
export type Footprints = (def: string) => [number, number] | undefined;

interface Rect {
  x: number;
  z: number;
  w: number;
  d: number;
}

interface Room extends Rect {
  kind: RoomKind;
}

/** One storey's plan while it's being made (lot coordinates). */
interface Floor {
  rooms: Room[];
  /** Unit wall edges: `h:x:z` (along x on line z) and `v:x:z` (along z on line x) → what stands there. */
  edges: Map<string, 'wall' | 'door' | 'window'>;
  objects: Placement[];
  /** Where each of `objects` is used from (null: nowhere that matters, garden things). */
  fronts: ([number, number] | null)[];
  /** Tiles nothing may stand on (by doors, stairs, the landing). */
  keep: Set<string>;
  /** Tiles taken by furniture. */
  taken: Set<string>;
}

const key = (x: number, z: number) => `${x}:${z}`;

/** A small seeded generator (mulberry32). */
function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function generateHouse(cfg: HouseGenConfig, footprint: Footprints, lot: { width: number; depth: number }, medium: { width: number }, lotSize: string, seed: number): HouseTemplate | null {
  // A few tries: some draws don't fit (too many rooms for the floor, no wall for the stairs).
  for (let attempt = 0; attempt < 12; attempt++) {
    const house = attemptHouse(cfg, footprint, lot, lotSize, random(seed * 31 + attempt));
    if (!house) continue;
    // Into the layouts' frame (centred on lots of other widths by `onLot`).
    const dx = -Math.floor((lot.width - medium.width) / 2);
    const shift = (h: { walls: Wall[]; doors: Door[]; windows?: Door[]; objects: Placement[] }) => {
      h.walls = h.walls.map(([x0, z0, x1, z1]) => [x0 + dx, z0, x1 + dx, z1]);
      h.doors = h.doors.map((d) => ({ ...d, x: d.x + dx }));
      h.windows = (h.windows ?? []).map((d) => ({ ...d, x: d.x + dx }));
      h.objects = h.objects.map((o) => ({ ...o, x: o.x + dx }));
    };
    shift(house);
    if (house.upper) shift(house.upper);
    house.spawns = house.spawns.map(([x, z]) => [x + dx, z]);
    house.id = `gen:${lotSize}:${seed}`;
    return house;
  }
  return null;
}

function pick<T>(rng: () => number, list: readonly T[]): T {
  return list[Math.floor(rng() * list.length)];
}

function between(rng: () => number, [a, b]: readonly [number, number]): number {
  return a + Math.floor(rng() * (b - a + 1));
}

function weighted(rng: () => number, weights: Record<string, number>): string | null {
  const entries = Object.entries(weights).filter(([, w]) => w > 0);
  const total = entries.reduce((n, [, w]) => n + w, 0);
  let r = rng() * total;
  for (const [k, w] of entries) if ((r -= w) <= 0) return k;
  return entries[entries.length - 1]?.[0] ?? null;
}

function attemptHouse(cfg: HouseGenConfig, footprint: Footprints, lot: { width: number; depth: number }, lotSize: string, rng: () => number): HouseTemplate | null {
  const className = weighted(rng, cfg.lots[lotSize] ?? cfg.lots.medium ?? {});
  const cls = className ? cfg.classes[className] : undefined;
  if (!cls) return null;
  const bedrooms = between(rng, cls.bedrooms);
  const living = rng() < cls.living;
  const extraBath = rng() < cls.extraBathroom;
  const two = (weighted(rng, { one: cls.storeys.one, two: cls.storeys.two }) ?? 'one') === 'two';

  // Footprint, within the lot's garden margins.
  const { margins } = cfg;
  const front = between(rng, margins.front);
  const maxW = lot.width - 2 * margins.side;
  const maxD = lot.depth - front - margins.back;
  const W = Math.min(maxW, between(rng, cls.width));
  const D = Math.min(maxD, between(rng, cls.depth));
  if (W < 6 || D < 6) return null;
  const slack = lot.width - 2 * margins.side - W;
  const house: Rect = { x: margins.side + Math.floor(rng() * (slack + 1)), z: front, w: W, d: D };

  // Who goes where.
  const ground: Kind[] = ['kitchen'];
  const upstairs: Kind[] = [];
  if (living || two) ground.push('living');
  if (two) {
    upstairs.push(...Array<Kind>(bedrooms).fill('bedroom'), 'bathroom');
    if (extraBath) ground.push('bathroom');
  } else {
    ground.push(...Array<Kind>(bedrooms).fill('bedroom'), 'bathroom');
    if (extraBath) ground.push('bathroom');
  }

  const g = floorPlan(cfg, rng, house, ground);
  if (!g) return null;
  if (!frontDoor(g, house, rng)) return null;
  connect(g, rng, rng() < cfg.openPlan);

  let up: Floor | null = null;
  if (two) {
    up = upperFloor(cfg, footprint, rng, house, g, upstairs);
    if (!up) return null;
  }
  windows(cfg, rng, g, house);
  if (up) windows(cfg, rng, up, house);
  if (!furnish(cfg, footprint, rng, g)) return null;
  if (up && !furnish(cfg, footprint, rng, up)) return null;
  garden(cfg, footprint, rng, g, house, lot);

  // Spawns in front of the front door.
  const door = [...g.edges].find(([k, v]) => v === 'door' && k === `h:${k.split(':')[1]}:${house.z}`);
  const doorX = door ? Number(door[0].split(':')[1]) : house.x + Math.floor(W / 2);
  const spawns: [number, number][] = [
    [doorX + 0.5, house.z - 1.5],
    [doorX + 1.5, house.z - 1.5],
    [doorX - 0.5, house.z - 1.5],
    [doorX + 2.5, house.z - 1.5],
  ];

  const name = `${pick(rng, cfg.names.first)} ${pick(rng, cfg.names.second[cls.label] ?? ['House'])}`;
  const words = ['no', 'one', 'two', 'three', 'four', 'five', 'six'];
  const parts = [
    `${words[bedrooms] ?? bedrooms} bedroom${bedrooms === 1 ? '' : 's'}`,
    ground.includes('living') ? (hasOpenPlan(g) ? 'an open kitchen and living room' : 'a living room') : null,
    extraBath ? 'two bathrooms' : null,
  ].filter((p): p is string => !!p);
  const listed = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0];
  const description = `A ${two ? 'two-storey ' : ''}${cls.label} with ${listed}.`;

  const out = (f: Floor) => {
    const e = edgesOut(f);
    // The front door first (the garden path and driveway start from it).
    e.doors.sort((a, b) => Number(b.axis === 'x' && b.z === house.z) - Number(a.axis === 'x' && a.z === house.z));
    return { ...e, objects: f.objects };
  };
  return {
    id: '',
    name,
    description,
    bedrooms,
    ...out(g),
    spawns,
    ...(up ? { upper: out(up) } : {}),
  };
}

// ---- floor plans ------------------------------------------------------------------------

/** Splits `rect` among `kinds` (a guillotine plan); null if they don't fit. */
function floorPlan(cfg: HouseGenConfig, rng: () => number, rect: Rect, kinds: Kind[]): Floor | null {
  for (let tries = 0; tries < 20; tries++) {
    const order = [...kinds].sort(() => rng() - 0.5);
    const rooms = split(cfg, rng, rect, order);
    if (rooms) {
      const floor: Floor = { rooms, edges: new Map(), objects: [], fronts: [], keep: new Set(), taken: new Set() };
      walls(floor);
      return floor;
    }
  }
  return null;
}

function split(cfg: HouseGenConfig, rng: () => number, r: Rect, kinds: Kind[]): Room[] | null {
  const spec = (k: Kind) => cfg.rooms[k];
  if (kinds.length === 1) {
    const s = spec(kinds[0]);
    return Math.min(r.w, r.d) >= s.minSide ? [{ ...r, kind: kinds[0] }] : null;
  }
  // Two groups, as even by wanted floor as a random cut allows.
  const at = 1 + Math.floor(rng() * (kinds.length - 1));
  const a = kinds.slice(0, at);
  const b = kinds.slice(at);
  const weight = (ks: Kind[]) => ks.reduce((n, k) => n + spec(k).weight, 0);
  const share = weight(a) / (weight(a) + weight(b));
  // Cut across the longer side mostly.
  const alongX = r.w > r.d ? rng() < 0.8 : rng() < 0.2;
  const len = alongX ? r.w : r.d;
  const minA = Math.max(...a.map((k) => spec(k).minSide));
  const minB = Math.max(...b.map((k) => spec(k).minSide));
  let cut = Math.round(len * share + (rng() - 0.5) * 1.5);
  cut = Math.max(minA, Math.min(len - minB, cut));
  if (cut < minA || len - cut < minB) return null;
  const [ra, rb]: [Rect, Rect] = alongX
    ? [{ ...r, w: cut }, { ...r, x: r.x + cut, w: r.w - cut }]
    : [{ ...r, d: cut }, { ...r, z: r.z + cut, d: r.d - cut }];
  const left = split(cfg, rng, ra, a);
  const right = left && split(cfg, rng, rb, b);
  return left && right ? [...left, ...right] : null;
}

/** Walls around every room (shared walls once). */
function walls(f: Floor): void {
  for (const r of f.rooms) {
    for (let x = r.x; x < r.x + r.w; x++) {
      f.edges.set(`h:${x}:${r.z}`, 'wall');
      f.edges.set(`h:${x}:${r.z + r.d}`, 'wall');
    }
    for (let z = r.z; z < r.z + r.d; z++) {
      f.edges.set(`v:${r.x}:${z}`, 'wall');
      f.edges.set(`v:${r.x + r.w}:${z}`, 'wall');
    }
  }
}

/** Edges two rooms share (unit edges, as keys). */
function shared(a: Rect, b: Rect): string[] {
  const out: string[] = [];
  if (a.x + a.w === b.x || b.x + b.w === a.x) {
    const x = a.x + a.w === b.x ? b.x : a.x;
    for (let z = Math.max(a.z, b.z); z < Math.min(a.z + a.d, b.z + b.d); z++) out.push(`v:${x}:${z}`);
  }
  if (a.z + a.d === b.z || b.z + b.d === a.z) {
    const z = a.z + a.d === b.z ? b.z : a.z;
    for (let x = Math.max(a.x, b.x); x < Math.min(a.x + a.w, b.x + b.w); x++) out.push(`h:${x}:${z}`);
  }
  return out;
}

/** The tiles on both sides of an edge. */
function sides(edge: string): [[number, number], [number, number]] {
  const [axis, xs, zs] = edge.split(':');
  const [x, z] = [Number(xs), Number(zs)];
  return axis === 'h' ? [[x, z - 1], [x, z]] : [[x - 1, z], [x, z]];
}

/** Puts a door on one of `edges` (not at a corner where possible) and keeps its tiles clear. */
function door(f: Floor, rng: () => number, edges: string[]): boolean {
  if (!edges.length) return false;
  const inner = edges.length > 2 ? edges.slice(1, -1) : edges;
  const e = pick(rng, inner);
  f.edges.set(e, 'door');
  for (const [x, z] of sides(e)) f.keep.add(key(x, z));
  return true;
}

/** The front door, from the street into the living room (else the kitchen, else any room but a bathroom). */
function frontDoor(f: Floor, house: Rect, rng: () => number): boolean {
  const facing = (r: Room) => r.z === house.z && r.w >= 2;
  const entry = f.rooms.find((r) => r.kind === 'living' && facing(r)) ?? f.rooms.find((r) => r.kind === 'kitchen' && facing(r)) ?? f.rooms.find((r) => r.kind !== 'bathroom' && facing(r));
  if (!entry) return false;
  const edges = Array.from({ length: entry.w }, (_, i) => `h:${entry.x + i}:${house.z}`);
  return door(f, rng, edges);
}

const PUBLIC: RoomKind[] = ['living', 'kitchen'];

/** Doors so every room can be reached: a tree from the entrance, through the living room and kitchen where possible. */
function connect(f: Floor, rng: () => number, openPlan: boolean): void {
  const rooms = f.rooms;
  const entry = rooms.find((r) => sides([...f.edges].find(([, v]) => v === 'door')?.[0] ?? '').some(([x, z]) => inside(r, x, z)))!;
  const reached = new Set<Room>([entry]);
  // Open plan: kitchen and living room as one space (their shared wall goes).
  if (openPlan) {
    const k = rooms.find((r) => r.kind === 'kitchen');
    const l = rooms.find((r) => r.kind === 'living');
    const wall = k && l ? shared(k, l) : [];
    if (wall.length >= 2) {
      // The way between them stays clear of furniture.
      for (const e of wall) {
        f.edges.delete(e);
        for (const [x, z] of sides(e)) f.keep.add(key(x, z));
      }
    }
  }
  while (reached.size < rooms.length) {
    let best: { from: Room; to: Room; edges: string[]; score: number } | null = null;
    for (const from of reached) {
      for (const to of rooms) {
        if (reached.has(to)) continue;
        const edges = shared(from, to);
        if (edges.length === 0) continue;
        const open = edges.every((e) => !f.edges.has(e));
        // Rooms open to each other need no door; bathrooms and bedrooms open off the shared rooms.
        const score = (open ? 10 : 0) + (PUBLIC.includes(from.kind) ? 3 : 0) + (to.kind === 'bathroom' && from.kind === 'bedroom' ? -2 : 0) + rng();
        if (!best || score > best.score) best = { from, to, edges: edges.filter((e) => f.edges.has(e)), score };
      }
    }
    if (!best) break;
    if (best.edges.length) door(f, rng, best.edges);
    reached.add(best.to);
  }
}

function inside(r: Rect, x: number, z: number): boolean {
  return x >= r.x && z >= r.z && x < r.x + r.w && z < r.z + r.d;
}

function hasOpenPlan(f: Floor): boolean {
  const k = f.rooms.find((r) => r.kind === 'kitchen');
  const l = f.rooms.find((r) => r.kind === 'living');
  return !!k && !!l && shared(k, l).length > 0 && shared(k, l).every((e) => !f.edges.has(e));
}

/**
 * Stairs along an outside wall of the living room (climbing away from the street), and the
 * storey above: a hall over the stairs, the other rooms in a row off it, each with a door.
 */
function upperFloor(cfg: HouseGenConfig, footprint: Footprints, rng: () => number, house: Rect, g: Floor, kinds: Kind[]): Floor | null {
  const [, len] = footprint(cfg.stairs) ?? [1, 4];
  const living = g.rooms.find((r) => r.kind === 'living');
  if (!living) return null;
  // A column on the left or right outside wall, with room for the stairs and their foot.
  const columns = [house.x, house.x + house.w - 1].filter((c) => c >= living.x && c < living.x + living.w).sort(() => rng() - 0.5);
  for (const c of columns) {
    for (let z = living.z + living.d - len; z >= living.z + 1; z--) {
      const tiles = Array.from({ length: len }, (_, i) => key(c, z + i));
      const foot = key(c, z - 1);
      if ([...tiles, foot].some((t) => g.keep.has(t))) continue;
      const landing = z + len;
      // The hall upstairs: the stairs' column and the one beside it, the whole depth.
      const left = c === house.x;
      const hall: Rect = { x: left ? c : c - 1, z: house.z, w: 2, d: house.d };
      if (landing >= house.z + house.d) continue;
      const rest: Rect = left ? { x: c + 2, z: house.z, w: house.w - 2, d: house.d } : { x: house.x, z: house.z, w: house.w - 2, d: house.d };
      // Rooms in a row off the hall (cuts across the depth only).
      const rooms = row(cfg, rng, rest, kinds);
      if (!rooms) continue;
      // The hall has no furniture of its own.
      const up: Floor = { rooms: [{ ...hall, kind: 'hall' }, ...rooms], edges: new Map(), objects: [], fronts: [], keep: new Set(), taken: new Set() };
      walls(up);
      for (const r of rooms) {
        const edges = shared(hall, r);
        if (!door(up, rng, edges)) return null;
      }
      // Stairs below, their stairwell and landing above.
      g.objects.push({ def: cfg.stairs, x: c, z, rot: 2 });
      g.fronts.push([c, z - 1]);
      for (const t of [...tiles, foot]) g.keep.add(t);
      for (const t of tiles) g.taken.add(t);
      for (let i = 0; i < len; i++) up.taken.add(key(c, z + i));
      up.keep.add(key(c, landing));
      for (let zz = house.z; zz < house.z + house.d; zz++) up.keep.add(key(left ? c + 1 : c - 1, zz));
      return up;
    }
  }
  return null;
}

function row(cfg: HouseGenConfig, rng: () => number, r: Rect, kinds: Kind[]): Room[] | null {
  const order = [...kinds].sort(() => rng() - 0.5);
  const weight = order.reduce((n, k) => n + cfg.rooms[k].weight, 0);
  const rooms: Room[] = [];
  let z = r.z;
  for (let i = 0; i < order.length; i++) {
    const s = cfg.rooms[order[i]];
    const left = order.slice(i + 1).reduce((n, k) => n + Math.max(cfg.rooms[k].minSide, 2), 0);
    let d = i === order.length - 1 ? r.z + r.d - z : Math.round((r.d * s.weight) / weight);
    d = Math.max(s.minSide, Math.min(d, r.z + r.d - z - left));
    if (d < s.minSide || r.w < s.minSide) return null;
    rooms.push({ x: r.x, z, w: r.w, d, kind: order[i] });
    z += d;
  }
  return z === r.z + r.d ? rooms : null;
}

// ---- windows, furniture, garden ---------------------------------------------------------

function windows(cfg: HouseGenConfig, rng: () => number, f: Floor, house: Rect): void {
  const outside = (e: string) => {
    const [axis, xs, zs] = e.split(':');
    const [x, z] = [Number(xs), Number(zs)];
    return axis === 'h' ? (z === house.z || z === house.z + house.d) && x >= house.x && x < house.x + house.w : (x === house.x || x === house.x + house.w) && z >= house.z && z < house.z + house.d;
  };
  for (const r of f.rooms) {
    const spacing = between(rng, cfg.windows.spacing);
    const edges = [...f.edges.keys()].filter((e) => f.edges.get(e) === 'wall' && outside(e) && sides(e).some(([x, z]) => inside(r, x, z)));
    let placed = 0;
    edges.forEach((e, i) => {
      if (r.kind === 'bathroom' && placed >= 1) return;
      if ((i + Math.floor(spacing / 2)) % spacing !== 0) return;
      // Not where the stairs (or the stairwell) run along the wall.
      if (sides(e).some(([x, z]) => f.taken.has(key(x, z)))) return;
      // Not right next to a door or at a corner.
      const [axis, xs, zs] = e.split(':');
      const [x, z] = [Number(xs), Number(zs)];
      const near = axis === 'h' ? [`h:${x - 1}:${z}`, `h:${x + 1}:${z}`] : [`v:${x}:${z - 1}`, `v:${x}:${z + 1}`];
      if (near.some((n) => f.edges.get(n) === 'door' || !f.edges.has(n))) return;
      f.edges.set(e, 'window');
      placed++;
    });
  }
}

/** Places each room's furniture against its walls; false if a required piece doesn't fit. */
function furnish(cfg: HouseGenConfig, footprint: Footprints, rng: () => number, f: Floor): boolean {
  for (const r of f.rooms) {
    if (r.kind === 'hall') continue;
    const spec = cfg.rooms[r.kind];
    const sideOf = new Map<string, number>();
    for (const slot of spec.furniture) {
      const required = slot.chance === undefined || slot.chance >= 1;
      const count = slot.count ? between(rng, slot.count) : 1;
      for (let n = 0; n < count; n++) {
        if (!required && rng() >= (slot.chance ?? 1)) continue;
        const options = slot.one.filter((d) => footprint(d)).sort(() => rng() - 0.5);
        let done = false;
        for (const def of options) {
          const across = slot.opposite ? sideOf.get(slot.opposite) : undefined;
          const side = place(f, r, def, footprint(def)!, rng, across === undefined ? undefined : (across + 2) % 4);
          if (side !== null) {
            sideOf.set(def, side);
            for (const o of slot.one) sideOf.set(o, side);
            done = true;
            break;
          }
        }
        if (!done && required) return false;
      }
    }
  }
  return true;
}

/**
 * One piece against a wall of room `r`, facing into it (`prefer`: a side first, 0 the side
 * towards the street, then clockwise). Returns the side, or null if there's no place for it.
 */
function place(f: Floor, r: Room, def: string, [fw, fd]: [number, number], rng: () => number, prefer?: number): number | null {
  const sideList = [0, 1, 2, 3].sort(() => rng() - 0.5);
  if (prefer !== undefined) sideList.sort((a, b) => (a === prefer ? -1 : b === prefer ? 1 : 0));
  for (const side of sideList) {
    // Back to the wall on `side`, front into the room: rot 0 faces +z (back to the street-side wall).
    const rot = [0, 3, 2, 1][side];
    const [w, d] = rot % 2 === 0 ? [fw, fd] : [fd, fw];
    const spots: [number, number][] = [];
    if (side === 0) for (let x = r.x; x + w <= r.x + r.w; x++) spots.push([x, r.z]);
    if (side === 2) for (let x = r.x; x + w <= r.x + r.w; x++) spots.push([x, r.z + r.d - d]);
    if (side === 3) for (let z = r.z; z + d <= r.z + r.d; z++) spots.push([r.x, z]);
    if (side === 1) for (let z = r.z; z + d <= r.z + r.d; z++) spots.push([r.x + r.w - w, z]);
    spots.sort(() => rng() - 0.5);
    for (const [x, z] of spots) {
      const tiles: string[] = [];
      for (let dz = 0; dz < d; dz++) for (let dx = 0; dx < w; dx++) tiles.push(key(x + dx, z + dz));
      const front = frontTile(x, z, w, d, rot);
      if (!inside(r, front[0], front[1])) continue;
      if (tiles.some((t) => f.taken.has(t) || f.keep.has(t)) || f.taken.has(key(front[0], front[1]))) continue;
      for (const t of tiles) f.taken.add(t);
      f.objects.push({ def, x, z, rot });
      f.fronts.push(front);
      if (reachable(f, r)) {
        f.keep.add(key(front[0], front[1]));
        return side;
      }
      for (const t of tiles) f.taken.delete(t);
      f.objects.pop();
      f.fronts.pop();
    }
  }
  return null;
}

function frontTile(x: number, z: number, w: number, d: number, rot: number): [number, number] {
  const mx = x + Math.floor((w - 1) / 2);
  const mz = z + Math.floor((d - 1) / 2);
  return [
    [mx, z + d],
    [x + w, mz],
    [mx, z - 1],
    [x - 1, mz],
  ][rot % 4] as [number, number];
}

/** Every free tile of the room the doors and furniture need is still connected. */
function reachable(f: Floor, r: Room): boolean {
  const free = (x: number, z: number) => inside(r, x, z) && !f.taken.has(key(x, z));
  const needed: string[] = [];
  for (let z = r.z; z < r.z + r.d; z++) for (let x = r.x; x < r.x + r.w; x++) if (f.keep.has(key(x, z)) && free(x, z)) needed.push(key(x, z));
  for (const front of f.fronts) {
    if (!front || !inside(r, front[0], front[1])) continue;
    const [x, z] = front;
    if (!free(x, z)) return false;
    needed.push(key(x, z));
  }
  if (needed.length <= 1) return true;
  const seen = new Set<string>([needed[0]]);
  const queue = [needed[0]];
  while (queue.length) {
    const [x, z] = queue.pop()!.split(':').map(Number);
    for (const [nx, nz] of [[x + 1, z], [x - 1, z], [x, z + 1], [x, z - 1]]) {
      const k = key(nx, nz);
      if (!seen.has(k) && free(nx, nz)) {
        seen.add(k);
        queue.push(k);
      }
    }
  }
  return needed.every((k) => seen.has(k));
}

function garden(cfg: HouseGenConfig, footprint: Footprints, rng: () => number, g: Floor, house: Rect, lot: { width: number; depth: number }): void {
  const count = between(rng, cfg.garden.count);
  const clear = (x: number, z: number) => x >= 0 && z >= 0 && x < lot.width && z < lot.depth && (x < house.x - 1 || x > house.x + house.w || z < house.z - 1 || z > house.z + house.d);
  for (let n = 0, tries = 0; n < count && tries < 40; tries++) {
    const def = pick(rng, cfg.garden.objects);
    const fp = footprint(def);
    if (!fp) continue;
    const [w, d] = fp;
    const x = Math.floor(rng() * (lot.width - w));
    // Behind the house or to its sides (the front garden is left for the path and drive).
    const z = house.z + Math.floor(rng() * (lot.depth - house.z - d));
    const tiles: [number, number][] = [];
    for (let dz = -1; dz <= d; dz++) for (let dx = -1; dx <= w; dx++) tiles.push([x + dx, z + dz]);
    if (!tiles.every(([tx, tz]) => clear(tx, tz) && !g.taken.has(key(tx, tz)))) continue;
    for (const [tx, tz] of tiles) g.taken.add(key(tx, tz));
    g.objects.push({ def, x, z, rot: Math.floor(rng() * 4) & 2 });
    g.fronts.push(null);
    n++;
  }
}

/** Unit edges merged into wall runs, and the doors and windows in them. */
function edgesOut(f: Floor): { walls: Wall[]; doors: Door[]; windows: Door[] } {
  const walls: Wall[] = [];
  const doors: Door[] = [];
  const windows: Door[] = [];
  const h = new Map<number, number[]>();
  const v = new Map<number, number[]>();
  for (const [e, kind] of f.edges) {
    const [axis, xs, zs] = e.split(':');
    const [x, z] = [Number(xs), Number(zs)];
    if (axis === 'h') (h.get(z) ?? h.set(z, []).get(z)!).push(x);
    else (v.get(x) ?? v.set(x, []).get(x)!).push(z);
    if (kind === 'door') doors.push({ x, z, axis: axis === 'h' ? 'x' : 'z' });
    if (kind === 'window') windows.push({ x, z, axis: axis === 'h' ? 'x' : 'z' });
  }
  const runs = (list: number[], emit: (a: number, b: number) => void) => {
    list.sort((a, b) => a - b);
    let start = list[0];
    for (let i = 1; i <= list.length; i++) {
      if (i < list.length && list[i] === list[i - 1] + 1) continue;
      emit(start, list[i - 1] + 1);
      start = list[i];
    }
  };
  for (const [z, xs] of h) runs(xs, (a, b) => walls.push([a, z, b, z]));
  for (const [x, zs] of v) runs(zs, (a, b) => walls.push([x, a, x, b]));
  return { walls, doors, windows };
}
