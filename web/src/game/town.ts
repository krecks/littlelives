/**
 * Neighbourhood generation and assembly. A town is a row of plots on each side of a
 * street; each plot is small, medium or large and gets a house layout (or the park) from
 * `content/houses.json`. Layouts are drawn for a medium lot and sit centred on the others, with
 * the front door towards the street; a small lot only takes a house that fits.
 * Plots on the south side are rotated 180° so every front door faces the street.
 * The result is one town file the simulation loads like any lot.
 */

import type { AssetRegistry } from '../assets/registry';
import type { Content } from '../content/content';
import type { GameKind, Lifespan } from '../core/protocol';
import { fetchText } from '../content/content';
import { householdBonds, householdSpawns, randomHousehold, type HouseholdDraft, type SimSpawn } from './household';
import { generateHouse, type HouseGenConfig } from './housegen';

export type Wall = [number, number, number, number];
export interface Door {
  x: number;
  z: number;
  axis: 'x' | 'z';
}
export interface Placement {
  def: string;
  x: number;
  z: number;
  rot: number;
}

export interface HouseTemplate {
  id: string;
  name: string;
  description: string;
  bedrooms: number;
  walls: Wall[];
  doors: Door[];
  /** Windows in walls, placed like doors. */
  windows?: Door[];
  objects: Placement[];
  spawns: [number, number][];
  /** The storey above (generated two-storey houses), laid out like the ground. */
  upper?: { walls: Wall[]; doors: Door[]; windows?: Door[]; objects: Placement[] };
}

interface ParkTemplate {
  id: string;
  name: string;
  description: string;
  objects: Placement[];
}

export type LotSize = 'small' | 'medium' | 'large';
export const LOT_SIZES: readonly LotSize[] = ['small', 'medium', 'large'];

export interface Templates {
  /** The lot every layout is drawn for (a medium lot). */
  plot: { width: number; depth: number };
  /** Lot sizes (missing in older files: every lot is `plot`). */
  lotSizes?: Partial<Record<LotSize, { width: number; depth: number }>>;
  houses: HouseTemplate[];
  parks: ParkTemplate[];
  /** How houses are generated (`content/housegen.json`; absent: only the fixed layouts above). */
  gen?: HouseGenConfig;
  /** Object footprints from the game's content (for furnishing generated houses). */
  footprint?: (def: string) => [number, number] | undefined;
}

export type TownSize = 'small' | 'medium' | 'large';
export const TOWN_COLUMNS: Record<TownSize, number> = { small: 3, medium: 4, large: 5 };

export interface PlotSlot {
  index: number;
  kind: 'house' | 'park';
  template: string;
  /** Address or place name. */
  name: string;
  x: number;
  z: number;
  /** Rotated 180° (south side of the street). */
  rotated: boolean;
  /** Missing in drafts from older code: medium. */
  lot?: LotSize;
}

export interface Rect {
  x: number;
  z: number;
  w: number;
  d: number;
}

export interface NeighbourhoodDraft {
  name: string;
  size: TownSize;
  width: number;
  depth: number;
  slots: PlotSlot[];
  streets: Rect[];
  /** Neighbour households and the slot each lives in. */
  households: { household: HouseholdDraft; slot: number }[];
  /**
   * Landscape seed (hills, woods, lawn detail). Kept while the draft is edited, so the 3D preview
   * in the menus and the game itself show the same valley. Missing in drafts from older code.
   */
  seed?: number;
}

/** Presentation data the renderer reads back from the world (it survives save/load). */
export interface TownMeta {
  kind: 'town';
  name: string;
  streets: Rect[];
  paths: Rect[];
  seed: number;
}

const MARGIN = 8;
const STREET = 6;

let templates: Promise<Templates> | null = null;
let giveContent: (content: Content) => void = () => {};
const townContent = new Promise<Content>((resolve) => (giveContent = resolve));

/** The game's content, once loaded (generated houses are furnished from it). */
export function useTownContent(content: Content): void {
  giveContent(content);
}

export function loadTemplates(): Promise<Templates> {
  const base = import.meta.env.BASE_URL;
  templates ??= Promise.all([
    fetchText(`${base}content/houses.json`).then((t) => JSON.parse(t) as Templates),
    fetchText(`${base}content/housegen.json`)
      .then((t) => JSON.parse(t) as HouseGenConfig)
      .catch(() => undefined),
    townContent,
  ]).then(([t, gen, content]) => ({ ...t, gen, footprint: (def: string) => content.object(def)?.footprint as [number, number] | undefined }));
  return templates;
}

const generated = new Map<string, HouseTemplate | undefined>();

/** A generated house's id: its lot size and seed (the same id always gives the same house). */
export function generatedId(size: LotSize, seed: number): string {
  return `gen:${size}:${seed >>> 0}`;
}

const pick = <T>(list: readonly T[]): T => list[Math.floor(Math.random() * list.length)];

export function houseTemplate(t: Templates, id: string): HouseTemplate | undefined {
  if (id.startsWith('gen:')) {
    if (!generated.has(id)) {
      const [, size, seed] = id.split(':');
      const house = t.gen && t.footprint ? generateHouse(t.gen, t.footprint, lotDims(t, size as LotSize), t.plot, size, Number(seed)) : null;
      generated.set(id, house ?? undefined);
    }
    return generated.get(id);
  }
  return t.houses.find((h) => h.id === id);
}

/** Width and depth of a lot of this size. */
export function lotDims(t: Templates, size: LotSize | undefined): { width: number; depth: number } {
  return t.lotSizes?.[size ?? 'medium'] ?? t.plot;
}

/**
 * A layout moved onto a lot of `size`: centred across it, front kept at the street. Objects that
 * would end up off the lot (garden things on a small lot) are left out.
 */
export function onLot(t: Templates, h: HouseTemplate, size: LotSize | undefined, footprint: (def: string) => [number, number]): HouseTemplate {
  const { width, depth } = lotDims(t, size);
  const dx = Math.floor((width - t.plot.width) / 2);
  if (dx === 0 && depth >= t.plot.depth) return h;
  const inside = (o: Placement) => {
    const [fw, fd] = footprint(o.def);
    const [w, d] = o.rot % 2 === 0 ? [fw, fd] : [fd, fw];
    return o.x >= 0 && o.z >= 0 && o.x + w <= width && o.z + d <= depth;
  };
  const move = <T extends { walls: Wall[]; doors: Door[]; windows?: Door[]; objects: Placement[] }>(f: T): T => ({
    ...f,
    walls: f.walls.map(([x0, z0, x1, z1]) => [x0 + dx, z0, x1 + dx, z1]),
    doors: f.doors.map((d) => ({ ...d, x: d.x + dx })),
    windows: f.windows?.map((d) => ({ ...d, x: d.x + dx })),
    objects: f.objects.map((o) => ({ ...o, x: o.x + dx })).filter(inside),
  });
  return { ...move(h), spawns: h.spawns.map(([x, z]) => [x + dx, z]), upper: h.upper && move(h.upper) };
}

/** Whether a layout's house fits on a lot of `size` (with a metre to spare around its walls). */
export function fitsLot(t: Templates, h: HouseTemplate, size: LotSize): boolean {
  const { width, depth } = lotDims(t, size);
  const dx = Math.floor((width - t.plot.width) / 2);
  const xs = h.walls.flatMap(([x0, , x1]) => [x0 + dx, x1 + dx]);
  const zs = h.walls.flatMap(([, z0, , z1]) => [z0, z1]);
  return Math.min(...xs) >= 1 && Math.max(...xs) <= width - 1 && Math.max(...zs) <= depth - 1;
}

/** Places every lot along the street by its size, and sizes the town around them. */
function placeLots(t: Templates, slots: PlotSlot[]): { slots: PlotSlot[]; width: number; depth: number; streets: Rect[] } {
  // The rotated (south) row lies before the street, the other after it; each row's lots touch the street.
  const rowDepth = (rotated: boolean) => Math.max(0, ...slots.filter((s) => s.rotated === rotated).map((s) => lotDims(t, s.lot).depth));
  const streetZ = MARGIN + rowDepth(true);
  const x = { rotated: MARGIN, facing: MARGIN };
  const placed = slots.map((s) => {
    const { width, depth } = lotDims(t, s.lot);
    const row = s.rotated ? 'rotated' : 'facing';
    const at = { ...s, x: x[row], z: s.rotated ? streetZ - depth : streetZ + STREET };
    x[row] += width;
    return at;
  });
  const width = Math.max(x.rotated, x.facing) + MARGIN;
  return { slots: placed, width, depth: streetZ + STREET + rowDepth(false) + MARGIN, streets: [{ x: 0, z: streetZ, w: width, d: STREET }] };
}

/** A house for a new lot of `size`: a generated one (see `housegen.ts`), else a fixed layout that fits. */
export function houseFor(t: Templates, size: LotSize): string {
  if (t.gen) {
    const id = generatedId(size, (Math.random() * 2 ** 31) >>> 0);
    if (houseTemplate(t, id)) return id;
  }
  const fitting = t.houses.filter((h) => fitsLot(t, h, size));
  return pick(fitting.length ? fitting : t.houses).id;
}

/** The draft with lot `slot` made `size`; a house that no longer fits gives way to one that does (or an empty lot). */
export function withLotSize(t: Templates, town: NeighbourhoodDraft, slot: number, size: LotSize): NeighbourhoodDraft {
  const old = town.slots[slot];
  if (!old || (old.lot ?? 'medium') === size) return town;
  const current = houseTemplate(t, old.template);
  // A generated house is generated again for the new size (the same seed).
  const regenerated = old.template.startsWith('gen:') ? generatedId(size, Number(old.template.split(':')[2])) : null;
  const template = regenerated && houseTemplate(t, regenerated)
    ? regenerated
    : !current || fitsLot(t, current, size)
      ? old.template
      : (t.houses.filter((h) => fitsLot(t, h, size)).sort((a, b) => Math.abs(a.bedrooms - current.bedrooms) - Math.abs(b.bedrooms - current.bedrooms))[0]?.id ?? EMPTY_LOT);
  const placed = placeLots(t, town.slots.map((s) => (s.index === slot ? { ...s, lot: size, template } : s)));
  return { ...town, ...placed };
}

/** Template id of a lot with nothing on it yet (no house template has it): build from the ground up. */
export const EMPTY_LOT = 'empty';

/** The draft with the house on `slot` cleared away (an empty lot), or put back (`template`). */
export function withLot(town: NeighbourhoodDraft, slot: number, template: string): NeighbourhoodDraft {
  if (town.slots[slot]?.template === template) return town;
  return { ...town, slots: town.slots.map((s) => (s.index === slot ? { ...s, template } : s)) };
}

export function generateNeighbourhood(
  content: Content,
  assets: AssetRegistry,
  t: Templates,
  size: TownSize,
  name = pick(content.names.towns ?? ['Willowbrook']),
  neighbours?: number,
  seed = (Math.random() * 2 ** 31) >>> 0,
): NeighbourhoodDraft {
  const cols = TOWN_COLUMNS[size];
  const street = pick(content.names.streets ?? ['Main Street']);
  const parkIndex = cols + Math.floor(cols / 2); // middle of the north row
  // Mostly medium lots, some small and some large (when the layouts say how big they are).
  const lotSize = (): LotSize => {
    if (!t.lotSizes) return 'medium';
    const r = Math.random();
    return r < 0.25 ? 'small' : r < 0.8 ? 'medium' : 'large';
  };

  const unplaced: PlotSlot[] = [];
  let number = 1;
  for (let row = 0; row < 2; row++) {
    for (let col = 0; col < cols; col++) {
      const index = unplaced.length;
      const park = index === parkIndex;
      const lot = park ? 'medium' : lotSize();
      unplaced.push({
        index,
        kind: park ? 'park' : 'house',
        template: park ? t.parks[0].id : houseFor(t, lot),
        name: park ? t.parks[0].name : `${number++ * 2 - row} ${street}`,
        x: 0,
        z: 0,
        rotated: row === 0,
        lot,
      });
    }
  }
  const { slots, width, depth, streets } = placeLots(t, unplaced);

  const houses = slots.filter((s) => s.kind === 'house');
  const count = Math.min(neighbours ?? houses.length - 2, houses.length - 1);
  const shuffled = [...houses].sort(() => Math.random() - 0.5).slice(0, Math.max(0, count));
  const taken = new Set<string>();
  const households = shuffled.map((slot) => {
    const bedrooms = houseTemplate(t, slot.template)?.bedrooms ?? 1;
    const size = Math.max(1, Math.min(4, bedrooms + Math.floor(Math.random() * 2)));
    const household = randomHousehold(content, assets, size, [...taken]);
    taken.add(household.name);
    return { household, slot: slot.index };
  });

  return { name, size, width, depth, slots, streets, households, seed };
}

/** Driveways are paths wider than this (garden paths are 1 m); see `driveway`. */
export const DRIVEWAY_MIN_WIDTH = 1.8;
/** Driveway length past the front wall of the house: room to park a car beside it. */
const DRIVEWAY_PAST_FRONT = 5.4;

/**
 * Driveway of a house layout in plot coordinates (front edge at z = 0): from the street to
 * beside the house, on the side with more room (away from the front door when even), clear
 * of garden objects. Null when neither side has room.
 */
export function driveway(h: HouseTemplate, pw: number, pd: number, footprint: (def: string) => [number, number]): Rect | null {
  const xs = h.walls.flatMap(([x0, , x1]) => [x0, x1]);
  const zs = h.walls.flatMap(([, z0, , z1]) => [z0, z1]);
  const [hx0, hx1, hz0] = [Math.min(...xs), Math.max(...xs), Math.min(...zs)];
  const door = h.doors[0]?.x ?? (hx0 + hx1) / 2;
  const d = Math.min(hz0 + DRIVEWAY_PAST_FRONT, pd - 1);
  const sides = [
    { gap: pw - hx1, far: door < (hx0 + hx1) / 2, rect: (w: number, gap: number) => ({ x: hx1 + Math.min(0.6, gap - w - 0.3), z: 0, w, d }) },
    { gap: hx0, far: door >= (hx0 + hx1) / 2, rect: (w: number, gap: number) => ({ x: hx0 - Math.min(0.6, gap - w - 0.3) - w, z: 0, w, d }) },
  ].sort((a, b) => b.gap - a.gap || Number(b.far) - Number(a.far));
  const blocked = (r: Rect) =>
    h.objects.some((o) => {
      const [fw, fd] = footprint(o.def);
      const [w, dd] = o.rot % 2 === 0 ? [fw, fd] : [fd, fw];
      return o.x < r.x + r.w && o.x + w > r.x && o.z < r.z + r.d && o.z + dd > r.z;
    });
  for (const side of sides) {
    const w = Math.min(3, side.gap - 0.6);
    if (w < 2.3) continue;
    const r = side.rect(w, side.gap);
    if (!blocked(r)) return r;
  }
  return null;
}

export function vacantSlots(town: NeighbourhoodDraft): PlotSlot[] {
  const occupied = new Set(town.households.map((h) => h.slot));
  return town.slots.filter((s) => s.kind === 'house' && !occupied.has(s.index));
}

/** Town geometry in world tiles: what `assembleTown` writes and the menu preview draws. */
export interface TownLayout {
  walls: Wall[];
  doors: Door[];
  windows: Door[];
  objects: Placement[];
  /** Garden paths (1 m) and driveways (wider than `DRIVEWAY_MIN_WIDTH`). */
  paths: Rect[];
  plots: { name: string; x: number; z: number; w: number; d: number; public: boolean; entry: [number, number]; storeys: number }[];
  /** Storeys of the tallest house: storey `k`'s walls and objects are on rows `k * depth ..` (see `WorldStructure.storeys`). */
  storeys: number;
}

/**
 * Stamps every plot's house layout (or the park) onto the town. `playerSlot` is left without a
 * driveway (it stays open for building); null gives every house one.
 */
export function layoutTown(content: Content, t: Templates, town: NeighbourhoodDraft, playerSlot: number | null): TownLayout {
  const walls: Wall[] = [];
  const doors: Door[] = [];
  const windows: Door[] = [];
  const objects: Placement[] = [];
  const paths: Rect[] = [];
  const footprint = (def: string): [number, number] => content.object(def)?.footprint ?? [1, 1];

  const point = (s: PlotSlot, [x, z]: [number, number]): [number, number] => {
    const { width: pw, depth: pd } = lotDims(t, s.lot);
    return s.rotated ? [s.x + pw - x, s.z + pd - z] : [s.x + x, s.z + z];
  };
  /** `lift`: rows to the storey (see `TownLayout.storeys`). */
  const placeAll = (s: PlotSlot, list: Placement[], lift = 0) => {
    const { width: pw, depth: pd } = lotDims(t, s.lot);
    for (const o of list) {
      const [fw, fd] = footprint(o.def);
      const [w, d] = o.rot % 2 === 0 ? [fw, fd] : [fd, fw];
      objects.push(
        s.rotated
          ? { def: o.def, x: s.x + pw - o.x - w, z: s.z + pd - o.z - d + lift, rot: (o.rot + 2) % 4 }
          : { def: o.def, x: s.x + o.x, z: s.z + o.z + lift, rot: o.rot },
      );
    }
  };
  const layoutOf = (s: PlotSlot) => {
    const h = houseTemplate(t, s.template);
    return h && onLot(t, h, s.lot, footprint);
  };

  const plots = town.slots.map((s) => {
    const { width: pw, depth: pd } = lotDims(t, s.lot);
    // Visitors arrive in front of the door (the first spawn point of the house layout).
    const spawn = layoutOf(s)?.spawns[0];
    const entry: [number, number] = spawn ? point(s, spawn) : [s.x + pw / 2, s.rotated ? s.z + pd - 1.5 : s.z + 1.5];
    return { name: s.name, x: s.x, z: s.z, w: pw, d: pd, public: s.kind === 'park', entry, storeys: layoutOf(s)?.upper ? 2 : 1 };
  });
  for (const s of town.slots) {
    if (s.kind === 'park') {
      placeAll(s, t.parks.find((p) => p.id === s.template)?.objects ?? []);
      continue;
    }
    const h = layoutOf(s);
    if (!h) continue;
    const { width: pw, depth: pd } = lotDims(t, s.lot);
    for (const [x0, z0, x1, z1] of h.walls) {
      const [a, b] = [point(s, [x0, z0]), point(s, [x1, z1])];
      walls.push([a[0], a[1], b[0], b[1]]);
    }
    // Doors and windows sit on wall edges; rotating the plot moves an edge's start corner.
    const edge = (d: Door): Door =>
      !s.rotated
        ? { x: s.x + d.x, z: s.z + d.z, axis: d.axis }
        : d.axis === 'x'
          ? { x: s.x + pw - 1 - d.x, z: s.z + pd - d.z, axis: 'x' }
          : { x: s.x + pw - d.x, z: s.z + pd - 1 - d.z, axis: 'z' };
    doors.push(...h.doors.map(edge));
    windows.push(...(h.windows ?? []).map(edge));
    placeAll(s, h.objects);
    // The storey above, on its own rows of the lot.
    if (h.upper) {
      const lift = town.depth;
      for (const [x0, z0, x1, z1] of h.upper.walls) {
        const [a, b] = [point(s, [x0, z0]), point(s, [x1, z1])];
        walls.push([a[0], a[1] + lift, b[0], b[1] + lift]);
      }
      const up = (d: Door): Door => ({ ...edge(d), z: edge(d).z + lift });
      doors.push(...h.upper.doors.map(up));
      windows.push(...(h.upper.windows ?? []).map(up));
      placeAll(s, h.upper.objects, lift);
    }
    // A garden path from the front door to the street.
    const front = h.doors[0];
    if (front) {
      const [px, pz] = point(s, [front.x, front.z]);
      const doorX = s.rotated ? px - 1 : px;
      paths.push(s.rotated ? { x: doorX, z: pz, w: 1, d: s.z + pd - pz } : { x: doorX, z: s.z, w: 1, d: pz - s.z });
    }
    // Neighbours get a driveway beside the house (the renderer parks a car on it); the player's
    // plot stays open for building.
    const drive = s.index === playerSlot ? null : driveway(h, pw, pd, footprint);
    if (drive) paths.push(s.rotated ? { x: s.x + pw - drive.x - drive.w, z: s.z + pd - drive.z - drive.d, w: drive.w, d: drive.d } : { x: s.x + drive.x, z: s.z + drive.z, w: drive.w, d: drive.d });
  }
  return { walls, doors, windows, objects, paths, plots, storeys: Math.max(1, ...plots.map((p) => p.storeys)) };
}

export interface AssembleOptions {
  /** `player` is the neighbour household already living at the player's slot. */
  existing?: boolean;
  mode?: GameKind;
  lifespan?: Lifespan;
}

/**
 * Builds the simulation's town file. A new player household moves in as household 0, before the
 * neighbours; with no `player` (build first) household 0 is the player's home with nobody living
 * in it yet, named after its address. With `existing`, `player` is the neighbour household already
 * living at `playerSlot`: it stays where it is in the list (with its jobs and history) and only
 * becomes the player's. A new household on an empty lot gets money to build with in Living games.
 */
export function assembleTown(
  content: Content,
  t: Templates,
  town: NeighbourhoodDraft,
  player: HouseholdDraft | null,
  playerSlot: number,
  { existing = false, mode = 'living', lifespan = 'normal' }: AssembleOptions = {},
): string {
  const { walls, doors, windows, objects, paths, plots, storeys } = layoutTown(content, t, town, playerSlot);
  const footprint = (def: string): [number, number] => content.object(def)?.footprint ?? [1, 1];
  const point = (s: PlotSlot, [x, z]: [number, number]): [number, number] => {
    const { width: pw, depth: pd } = lotDims(t, s.lot);
    return s.rotated ? [s.x + pw - x, s.z + pd - z] : [s.x + x, s.z + z];
  };

  if (existing && !town.households.some((h) => h.slot === playerSlot)) throw new Error('Nobody lives in that house.');
  // A new household first, then the neighbours (one of whom may be the player's).
  const neighbours = town.households.map((h) => ({ ...h, player: existing && h.slot === playerSlot }));
  const home = town.slots[playerSlot];
  const newcomer: HouseholdDraft = player ?? { name: home.name, members: [], bonds: [] };
  const residents: { household: HouseholdDraft; slot: number; player: boolean }[] = existing
    ? neighbours
    : [{ household: newcomer, slot: playerSlot, player: true }, ...neighbours];
  const { startingFunds, emptyLotFunds = 0 } = content.economy;
  const emptyLot = !houseTemplate(t, home.template);
  const households = residents.map((r, i) => ({
    name: r.household.name.trim(),
    plot: r.slot,
    player: r.player,
    ...(!existing && i === 0 && emptyLot && mode === 'living' ? { funds: startingFunds + emptyLotFunds } : {}),
  }));
  const sims: (SimSpawn & { job?: { career: string; level: number } })[] = [];
  const relationships: { a: number; b: number; preset: string }[] = [];
  residents.forEach((r, index) => {
    const slot = town.slots[r.slot];
    const template = houseTemplate(t, slot.template);
    const spawns = ((template && onLot(t, template, slot.lot, footprint).spawns) ?? [[lotDims(t, slot.lot).width / 2, 1.5]]).map((p) => point(slot, p));
    relationships.push(...householdBonds(r.household, sims.length));
    for (const spawn of householdSpawns(r.household, index, spawns)) {
      // Most neighbours already work somewhere (an existing household the player takes over too);
      // a newly arrived household finds jobs in game. Neighbours start somewhere on the ladder
      // (mostly the lower grades) with the skills for it.
      const tracks = content.careerCategories.flatMap((c) => c.tracks);
      const settled = !r.player || existing;
      const track = settled && tracks.length && Math.random() < 0.75 ? pick(tracks) : null;
      const level = Math.floor(Math.random() ** 2 * 6);
      sims.push(track ? { ...spawn, job: { career: track.id, level } } : spawn);
    }
  });

  // Neighbours have history with each other; a newly arrived player household doesn't.
  const newcomers = existing ? 0 : newcomer.members.length;
  for (let a = newcomers; a < sims.length; a++) {
    for (let b = a + 1; b < sims.length; b++) {
      if (sims[a].household === sims[b].household) continue;
      const roll = Math.random();
      const preset = roll < 0.03 ? 'rivals' : roll < 0.09 ? 'friends' : roll < 0.3 ? 'acquaintances' : null;
      if (preset && content.bondPresets.includes(preset)) relationships.push({ a, b, preset });
    }
  }

  const meta: TownMeta = { kind: 'town', name: town.name, streets: town.streets, paths, seed: town.seed ?? (Math.random() * 2 ** 31) >>> 0 };
  // Residents leave town (for work) at both ends of the street.
  const street = town.streets[0];
  const exits = street ? [[0.5, street.z + street.d / 2], [town.width - 0.5, street.z + street.d / 2]] : [];
  return JSON.stringify({ mode, lifespan, width: town.width, depth: town.depth, storeys, walls, doors, windows, objects, plots, households, sims, relationships, exits, meta });
}
