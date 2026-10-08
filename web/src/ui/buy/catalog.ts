/**
 * What a catalog item is worth to a household, distilled from its content definition:
 * the needs it fills, the skills it trains, the feelings it can give and what each use
 * costs. Summaries are computed once per object and cached (the catalog may hold
 * hundreds of items).
 */

import type { AssetRegistry } from '../../assets/registry';
import type { Content, NeedDef, ObjectDef, TraitDef } from '../../content/content';

export interface NeedBoost {
  need: NeedDef;
  /** Need gained over one use (0..1 of the bar). Negative for drains. */
  perUse: number;
  /** The same gain per hour of use. */
  perHour: number;
}

export interface FeelingInfo {
  id: string;
  label: string;
  /** Emotion icon asset key, if the feeling carries an emotion. */
  icon: string | null;
  /** Skill needed to get it (with `minSkill`), if any. */
  skill: string | null;
  minSkill: number;
  /** Interaction that gives it. */
  from: string;
}

export interface ActionInfo {
  label: string;
  minutes: number;
  cost: number;
  skill: string | null;
}

export interface ItemSummary {
  /** Needs it fills, strongest first (best interaction per need). */
  boosts: NeedBoost[];
  /** Needs it drains (e.g. a workout costs hygiene). */
  drains: NeedBoost[];
  /** Skills it trains, levels per hour, strongest first. */
  trains: { skill: string; perHour: number }[];
  /** Skills that make it better (bigger gains per level). */
  betterWith: string[];
  feelings: FeelingInfo[];
  actions: ActionInfo[];
  /** Lowest and highest per-use cost of its paid interactions; null if all are free. */
  useCost: { min: number; max: number } | null;
  slots: number;
  /** Lower-case text the search box matches against. */
  haystack: string;
}

interface FeelingDef {
  id: string;
  label: string;
  emotion?: string;
}

interface RawContent {
  feelings?: FeelingDef[];
  traits?: { id: string; effects?: { tagPreference?: Record<string, number> } }[];
}

let rawSource: string | null = null;
let feelingMap = new Map<string, FeelingDef>();
let likesMap = new Map<string, Record<string, number>>();

/** Indexes what the `Content` class doesn't: feelings, and trait tag preferences (packs patched in). */
function raw(content: Content): void {
  if (rawSource === content.json) return;
  rawSource = content.json;
  try {
    const file = JSON.parse(content.json) as RawContent;
    feelingMap = new Map((file.feelings ?? []).map((m) => [m.id, m]));
    likesMap = new Map((file.traits ?? []).map((t) => [t.id, t.effects?.tagPreference ?? {}]));
  } catch {
    feelingMap = new Map();
    likesMap = new Map();
  }
}

/** Feeling definitions from the raw content. */
export function feelingDef(content: Content, id: string): FeelingDef | undefined {
  raw(content);
  return feelingMap.get(id);
}

/** How much a resident with these traits is drawn to an item (best interaction; 1 = neutral). */
export function appeal(content: Content, def: ObjectDef, traits: readonly string[]): number {
  raw(content);
  let best = 1;
  for (const it of def.interactions) {
    let pull = 1;
    for (const t of traits) {
      const prefs = likesMap.get(t);
      if (!prefs) continue;
      for (const tag of it.tags ?? []) pull = Math.max(pull, prefs[tag] ?? 1);
    }
    best = Math.max(best, pull);
  }
  return best;
}

/** From this pull on, a resident "loves" an item (their traits make it at least twice as tempting). */
export const LOVES = 2;

/**
 * First names of the residents who love an item: it comes from one of their personalities'
 * collections, or their traits make it far more tempting than usual.
 */
export function loversOf(content: Content, def: ObjectDef, residents: readonly { name: string; traits: readonly string[] }[]): string[] {
  const collection = collectionOf(content, def)?.id;
  return residents
    .filter((r) => (collection !== undefined && r.traits.includes(collection)) || appeal(content, def, r.traits) >= LOVES)
    .map((r) => r.name.split(' ')[0]);
}

/** The personality collection an item comes from (`bookworm.readingNook` → Bookworm), if any. */
export function collectionOf(content: Content, def: ObjectDef): TraitDef | null {
  const dot = def.id.indexOf('.');
  return dot > 0 ? (content.trait(def.id.slice(0, dot)) ?? null) : null;
}

/**
 * The styles an item comes in (indices into content styles): only furniture with its own model
 * per style (`model.sofa@cozy`, ...) has any; the rest has one design. Empty when it has none.
 */
export function styleOptions(content: Content, assets: AssetRegistry, def: ObjectDef): number[] {
  const options = content.styles.flatMap((s, i) => (assets.has(`${def.model}@${s.id}`, 'model') ? [i] : []));
  return options.length > 1 ? options : [];
}

/** Model key of an item in a style (`model.sofa@cozy`), falling back to the plain model. */
export function styledModel(content: Content, assets: AssetRegistry, def: ObjectDef, style: number): string {
  const id = content.styles[style]?.id;
  return id && assets.has(`${def.model}@${id}`, 'model') ? `${def.model}@${id}` : def.model;
}

const cache = new WeakMap<ObjectDef, ItemSummary>();

export function summarize(content: Content, def: ObjectDef): ItemSummary {
  const hit = cache.get(def);
  if (hit) return hit;

  const best = new Map<string, NeedBoost>();
  const worst = new Map<string, NeedBoost>();
  const trains = new Map<string, number>();
  const betterWith = new Set<string>();
  const feelings: FeelingInfo[] = [];
  const costs: number[] = [];
  for (const it of def.interactions) {
    const hours = Math.max(it.minutes, 1) / 60;
    for (const [id, v] of Object.entries(it.effects)) {
      const need = content.needs.find((n) => n.id === id);
      if (!need || v === 0) continue;
      const entry = { need, perUse: v, perHour: v / hours };
      if (v > 0 && v > (best.get(id)?.perUse ?? 0)) best.set(id, entry);
      if (v < 0 && v < (worst.get(id)?.perUse ?? 0)) worst.set(id, entry);
    }
    for (const [s, v] of Object.entries(it.skills ?? {})) if (v > 0) trains.set(s, Math.max(trains.get(s) ?? 0, v));
    if (it.skill) betterWith.add(it.skill);
    if (it.cost && it.cost > 0) costs.push(it.cost);
    if (it.feeling && !feelings.some((f) => f.id === it.feeling)) {
      const m = feelingDef(content, it.feeling);
      feelings.push({
        id: it.feeling,
        label: m?.label ?? it.feeling,
        icon: (m?.emotion && content.emotion(m.emotion)?.icon) || null,
        skill: it.feelingMinSkill ? (it.skill ?? null) : null,
        minSkill: it.feelingMinSkill ?? 0,
        from: it.label,
      });
    }
  }

  const skillLabel = (id: string) => content.skill(id)?.label ?? id;
  const category = content.buyCategories.find((c) => c.id === def.category)?.label ?? '';
  const collection = collectionOf(content, def)?.label ?? '';
  const summary: ItemSummary = {
    boosts: [...best.values()].sort((a, b) => b.perUse - a.perUse),
    drains: [...worst.values()].sort((a, b) => a.perUse - b.perUse),
    trains: [...trains].sort((a, b) => b[1] - a[1]).map(([skill, perHour]) => ({ skill, perHour })),
    betterWith: [...betterWith],
    feelings,
    actions: def.interactions.map((it) => ({ label: it.label, minutes: it.minutes, cost: it.cost ?? 0, skill: it.skill ?? null })),
    useCost: costs.length ? { min: Math.min(...costs), max: Math.max(...costs) } : null,
    slots: def.slots ?? 1,
    haystack: '',
  };
  summary.haystack = [
    def.name,
    def.description ?? '',
    category,
    collection,
    ...summary.boosts.map((b) => b.need.label),
    ...summary.trains.map((t) => skillLabel(t.skill)),
    ...summary.betterWith.map(skillLabel),
    ...feelings.map((f) => f.label),
    ...def.interactions.map((it) => it.label),
  ]
    .join(' ')
    .toLowerCase();
  cache.set(def, summary);
  return summary;
}

/** "45 min", "1 h", "8 h". */
export function duration(minutes: number): string {
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const h = minutes / 60;
  return `${Number.isInteger(h) ? h : h.toFixed(1)} h`;
}

/** Need gain as a percentage of the bar: "+85%". */
export function percent(v: number): string {
  return `${v > 0 ? '+' : '−'}${Math.round(Math.abs(v) * 100)}%`;
}
