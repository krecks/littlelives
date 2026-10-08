/**
 * Neighbourhood generation and assembly. A town is a row of plots on each side of a
 * street; each plot gets a house layout (or the park) from `content/houses.json`.
 * Plots on the south side are rotated 180° so every front door faces the street.
 * The result is one town file the simulation loads like any lot.
 */

import type { AssetRegistry } from '../assets/registry';
import type { Content } from '../content/content';
import { fetchText } from '../content/content';
import { householdBonds, householdSpawns, randomHousehold, type HouseholdDraft, type SimSpawn } from './household';

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
}

interface ParkTemplate {
  id: string;
  name: string;
  description: string;
  objects: Placement[];
}

export interface Templates {
  plot: { width: number; depth: number };
  houses: HouseTemplate[];
  parks: ParkTemplate[];
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
export function loadTemplates(): Promise<Templates> {
  templates ??= fetchText(`${import.meta.env.BASE_URL}content/houses.json`).then((t) => JSON.parse(t) as Templates);
  return templates;
}

const pick = <T>(list: readonly T[]): T => list[Math.floor(Math.random() * list.length)];

export function houseTemplate(t: Templates, id: string): HouseTemplate | undefined {
  return t.houses.find((h) => h.id === id);
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
  const { width: pw, depth: pd } = t.plot;
  const cols = TOWN_COLUMNS[size];
  const width = MARGIN * 2 + cols * pw;
  const depth = MARGIN * 2 + pd * 2 + STREET;
  const street = pick(content.names.streets ?? ['Main Street']);
  const parkIndex = cols + Math.floor(cols / 2); // middle of the north row

  const slots: PlotSlot[] = [];
  let number = 1;
  for (let row = 0; row < 2; row++) {
    for (let col = 0; col < cols; col++) {
      const index = slots.length;
      const park = index === parkIndex;
      slots.push({
        index,
        kind: park ? 'park' : 'house',
        template: park ? t.parks[0].id : pick(t.houses).id,
        name: park ? t.parks[0].name : `${number++ * 2 - row} ${street}`,
        x: MARGIN + col * pw,
        z: row === 0 ? MARGIN : MARGIN + pd + STREET,
        rotated: row === 0,
      });
    }
  }

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

  return { name, size, width, depth, slots, streets: [{ x: 0, z: MARGIN + pd, w: width, d: STREET }], households, seed };
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
  plots: { name: string; x: number; z: number; w: number; d: number; public: boolean; entry: [number, number] }[];
}

/**
 * Stamps every plot's house layout (or the park) onto the town. `playerSlot` is left without a
 * driveway (it stays open for building); null gives every house one.
 */
export function layoutTown(content: Content, t: Templates, town: NeighbourhoodDraft, playerSlot: number | null): TownLayout {
  const { width: pw, depth: pd } = t.plot;
  const walls: Wall[] = [];
  const doors: Door[] = [];
  const windows: Door[] = [];
  const objects: Placement[] = [];
  const paths: Rect[] = [];
  const footprint = (def: string): [number, number] => content.object(def)?.footprint ?? [1, 1];

  const point = (s: PlotSlot, [x, z]: [number, number]): [number, number] =>
    s.rotated ? [s.x + pw - x, s.z + pd - z] : [s.x + x, s.z + z];
  const placeAll = (s: PlotSlot, list: Placement[]) => {
    for (const o of list) {
      const [fw, fd] = footprint(o.def);
      const [w, d] = o.rot % 2 === 0 ? [fw, fd] : [fd, fw];
      objects.push(
        s.rotated
          ? { def: o.def, x: s.x + pw - o.x - w, z: s.z + pd - o.z - d, rot: (o.rot + 2) % 4 }
          : { def: o.def, x: s.x + o.x, z: s.z + o.z, rot: o.rot },
      );
    }
  };

  const plots = town.slots.map((s) => {
    // Visitors arrive in front of the door (the first spawn point of the house layout).
    const spawn = houseTemplate(t, s.template)?.spawns[0];
    const entry: [number, number] = spawn ? point(s, spawn) : [s.x + pw / 2, s.rotated ? s.z + pd - 1.5 : s.z + 1.5];
    return { name: s.name, x: s.x, z: s.z, w: pw, d: pd, public: s.kind === 'park', entry };
  });
  for (const s of town.slots) {
    if (s.kind === 'park') {
      placeAll(s, t.parks.find((p) => p.id === s.template)?.objects ?? []);
      continue;
    }
    const h = houseTemplate(t, s.template);
    if (!h) continue;
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
  return { walls, doors, windows, objects, paths, plots };
}

/** Builds the simulation's town file. The player household is index 0. */
export function assembleTown(
  content: Content,
  t: Templates,
  town: NeighbourhoodDraft,
  player: HouseholdDraft,
  playerSlot: number,
): string {
  const { width: pw } = t.plot;
  const { walls, doors, windows, objects, paths, plots } = layoutTown(content, t, town, playerSlot);
  const point = (s: PlotSlot, [x, z]: [number, number]): [number, number] =>
    s.rotated ? [s.x + pw - x, s.z + t.plot.depth - z] : [s.x + x, s.z + z];

  // Player first, then neighbours.
  const residents: { household: HouseholdDraft; slot: number; player: boolean }[] = [
    { household: player, slot: playerSlot, player: true },
    ...town.households.map((h) => ({ ...h, player: false })),
  ];
  const households = residents.map((r) => ({ name: r.household.name.trim(), plot: r.slot, player: r.player }));
  const sims: (SimSpawn & { job?: { career: string; level: number } })[] = [];
  const relationships: { a: number; b: number; preset: string }[] = [];
  residents.forEach((r, index) => {
    const slot = town.slots[r.slot];
    const template = houseTemplate(t, slot.template);
    const spawns = (template?.spawns ?? [[pw / 2, 1.5]]).map((p) => point(slot, p));
    relationships.push(...householdBonds(r.household, sims.length));
    for (const spawn of householdSpawns(r.household, index, spawns)) {
      // Most neighbours already work somewhere; the player's Sims find jobs in game.
      // Neighbours start somewhere on the ladder (mostly the lower grades) with the skills for it.
      const tracks = content.careerCategories.flatMap((c) => c.tracks);
      const track = !r.player && tracks.length && Math.random() < 0.75 ? pick(tracks) : null;
      const level = Math.floor(Math.random() ** 2 * 6);
      sims.push(track ? { ...spawn, job: { career: track.id, level } } : spawn);
    }
  });

  // Neighbours have history with each other; the newly arrived player household doesn't.
  const playerCount = player.members.length;
  for (let a = playerCount; a < sims.length; a++) {
    for (let b = a + 1; b < sims.length; b++) {
      if (sims[a].household === sims[b].household) continue;
      const roll = Math.random();
      const preset = roll < 0.03 ? 'rivals' : roll < 0.09 ? 'friends' : roll < 0.3 ? 'acquaintances' : null;
      if (preset && content.bondPresets.includes(preset)) relationships.push({ a, b, preset });
    }
  }

  const meta: TownMeta = { kind: 'town', name: town.name, streets: town.streets, paths, seed: town.seed ?? (Math.random() * 2 ** 31) >>> 0 };
  // Sims leave town (for work) at both ends of the street.
  const street = town.streets[0];
  const exits = street ? [[0.5, street.z + street.d / 2], [town.width - 0.5, street.z + street.d / 2]] : [];
  return JSON.stringify({ width: town.width, depth: town.depth, walls, doors, windows, objects, plots, households, sims, relationships, exits, meta });
}
