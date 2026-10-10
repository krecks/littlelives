/**
 * Saved houses (blueprints): kept in this browser across games, not in saves, so a house built
 * in one game can be built again in another. `data` is the simulation's blueprint as it wrote it
 * (`sim-core/src/blueprint.rs`).
 */

export interface SavedBlueprint {
  id: string;
  name: string;
  /** When it was saved (ISO). */
  date: string;
  /** Size of the lot it was taken from (m), and what's in it. */
  w: number;
  d: number;
  walls: number;
  things: number;
  /** Small JPEG data URL of the house, or null. */
  thumbnail: string | null;
  data: string;
}

const KEY = 'littlelives.blueprints';

export const blueprints = $state({ list: read() });

function read(): SavedBlueprint[] {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown;
    return Array.isArray(list) ? (list as SavedBlueprint[]) : [];
  } catch {
    return [];
  }
}

function write(list: SavedBlueprint[]): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
    blueprints.list = list;
    return true;
  } catch {
    return false;
  }
}

/** Keeps a blueprint (newest first); false if the browser has no room for it. */
export function addBlueprint(name: string, data: string, thumbnail: string | null): boolean {
  const bp = JSON.parse(data) as { w: number; d: number; edges?: { kind: string }[]; objects?: unknown[] };
  const entry: SavedBlueprint = {
    id: `bp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    name,
    date: new Date().toISOString(),
    w: bp.w,
    d: bp.d,
    walls: (bp.edges ?? []).filter((e) => e.kind === 'wall' || e.kind === 'door' || e.kind === 'window').length,
    things: (bp.objects ?? []).length,
    thumbnail,
    data,
  };
  // Without the picture if that's what doesn't fit.
  return write([entry, ...blueprints.list]) || write([{ ...entry, thumbnail: null }, ...blueprints.list]);
}

export function removeBlueprint(id: string): void {
  write(blueprints.list.filter((b) => b.id !== id));
}
