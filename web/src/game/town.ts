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

type Wall = [number, number, number, number];
interface Door {
  x: number;
  z: number;
  axis: 'x' | 'z';
}
interface Placement {
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

  return { name, size, width, depth, slots, streets: [{ x: 0, z: MARGIN + pd, w: width, d: STREET }], households };
}

export function vacantSlots(town: NeighbourhoodDraft): PlotSlot[] {
  const occupied = new Set(town.households.map((h) => h.slot));
  return town.slots.filter((s) => s.kind === 'house' && !occupied.has(s.index));
}

/** Builds the simulation's town file. The player household is index 0. */
export function assembleTown(
  content: Content,
  t: Templates,
  town: NeighbourhoodDraft,
  player: HouseholdDraft,
  playerSlot: number,
): string {
  const { width: pw, depth: pd } = t.plot;
  const walls: Wall[] = [];
  const doors: Door[] = [];
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
    const entry = spawn ? point(s, spawn) : [s.x + pw / 2, s.rotated ? s.z + pd - 1.5 : s.z + 1.5];
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
    for (const d of h.doors) {
      doors.push(
        !s.rotated
          ? { x: s.x + d.x, z: s.z + d.z, axis: d.axis }
          : d.axis === 'x'
            ? { x: s.x + pw - 1 - d.x, z: s.z + pd - d.z, axis: 'x' }
            : { x: s.x + pw - d.x, z: s.z + pd - 1 - d.z, axis: 'z' },
      );
    }
    placeAll(s, h.objects);
    // A garden path from the front door to the street.
    const front = h.doors[0];
    if (front) {
      const [px, pz] = point(s, [front.x, front.z]);
      const doorX = s.rotated ? px - 1 : px;
      paths.push(s.rotated ? { x: doorX, z: pz, w: 1, d: s.z + pd - pz } : { x: doorX, z: s.z, w: 1, d: pz - s.z });
    }
  }

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
      const career = !r.player && content.careers.length && Math.random() < 0.75 ? pick(content.careers) : null;
      sims.push(career ? { ...spawn, job: { career: career.id, level: Math.floor(Math.random() * 3) } } : spawn);
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

  const meta: TownMeta = { kind: 'town', name: town.name, streets: town.streets, paths, seed: (Math.random() * 2 ** 31) >>> 0 };
  // Sims leave town (for work) at both ends of the street.
  const street = town.streets[0];
  const exits = street ? [[0.5, street.z + street.d / 2], [town.width - 0.5, street.z + street.d / 2]] : [];
  return JSON.stringify({ width: town.width, depth: town.depth, walls, doors, objects, plots, households, sims, relationships, exits, meta });
}
