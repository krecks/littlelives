/**
 * The main thread's copy of the HUD view, kept up to date from the worker's UI updates (changes
 * only, see `UiUpdate`). Unchanged residents, relationship pairs and rooms keep their objects,
 * so Svelte's keyed blocks and deriveds skip them; a list is only rebuilt when something in it
 * changed.
 */

import type { FundsView, PlanView, RelationshipView, RoomView, SimPatch, SimView, UiUpdate } from '../core/protocol';

/** A resident's details while they aren't sent (`SimView.detail` false). */
const NO_DETAILS: Pick<SimView, 'needs' | 'mood' | 'emotion' | 'feelings' | 'actions' | 'skills'> = {
  needs: [],
  mood: 0,
  emotion: null,
  feelings: [],
  actions: [],
  skills: [],
};

const NEW_SIM: SimView = { id: -1, detail: false, name: '', household: 0, traits: [], perks: [], plot: null, awayUntil: null, visiting: null, job: null, ...NO_DETAILS };

/** The lists an update changed (null: unchanged). */
export interface UiChanges {
  sims: SimView[] | null;
  relationships: RelationshipView[] | null;
  rooms: RoomView[] | null;
}

export class UiMirror {
  /** A full update arrived: changes apply on top of it. */
  private synced = false;
  private readonly sims = new Map<number, SimView>();
  /** By `a * 65536 + b`. */
  private readonly relationships = new Map<number, RelationshipView>();
  private readonly rooms = new Map<number, RoomView>();
  /** Every household's money and home, by id. */
  readonly households = new Map<number, FundsView>();

  /** Applies an update; null until the first full one (changes need something to change). */
  apply(u: UiUpdate): UiChanges | null {
    if (u.full) {
      this.sims.clear();
      this.relationships.clear();
      this.rooms.clear();
      this.households.clear();
      this.synced = true;
    } else if (!this.synced) {
      return null;
    }
    for (const h of u.households ?? []) this.households.set(h.id, h);
    return { sims: this.applySims(u), relationships: this.applyRelationships(u), rooms: this.applyRooms(u) };
  }

  private applySims(u: UiUpdate): SimView[] | null {
    if (!u.full && !u.sims && !u.simsGone) return null;
    for (const id of u.simsGone ?? []) this.sims.delete(id);
    let arrived = false;
    for (const patch of u.sims ?? []) {
      const old = this.sims.get(patch.id);
      arrived ||= !old;
      this.sims.set(patch.id, patched(old, patch));
    }
    const list = [...this.sims.values()];
    // In id order, as the worker lists them (someone new can take an old slot).
    if (arrived) list.sort((a, b) => a.id - b.id);
    return list;
  }

  private applyRelationships(u: UiUpdate): RelationshipView[] | null {
    if (!u.full && !u.relationships && !u.relationshipsGone) return null;
    for (const [a, b] of u.relationshipsGone ?? []) this.relationships.delete(a * 65536 + b);
    for (const r of u.relationships ?? []) this.relationships.set(r.a * 65536 + r.b, r);
    return [...this.relationships.values()];
  }

  private applyRooms(u: UiUpdate): RoomView[] | null {
    if (!u.full && !u.rooms && !u.roomsGone) return null;
    for (const id of u.roomsGone ?? []) this.rooms.delete(id);
    for (const r of u.rooms ?? []) this.rooms.set(r.id, r);
    return [...this.rooms.values()];
  }
}

/** A new object for a resident with the changed fields (`null` drops an optional one). */
function patched(old: SimView | undefined, patch: SimPatch): SimView {
  const { plan, ...fields } = patch;
  const sim = { ...(old ?? NEW_SIM), ...fields } as SimView;
  if (fields.pension === null) delete sim.pension;
  if (fields.grade === null) delete sim.grade;
  if (plan === null) delete sim.plan;
  else if (plan) sim.plan = { ...sim.plan, ...plan } as PlanView;
  if (patch.detail === false) {
    Object.assign(sim, NO_DETAILS);
    delete sim.grade;
    delete sim.plan;
  }
  return sim;
}
