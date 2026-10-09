/** Household drafts from character creation, and turning them into Sims the simulation understands. */

import type { AssetRegistry } from '../assets/registry';
import type { Content } from '../content/content';
import { GARMENTS, pickOutfit } from '../render/babylon/characters/outfit';

export const HAIR_STYLES = ['short', 'long', 'bun', 'none'] as const;
export type HairStyle = (typeof HAIR_STYLES)[number];

/** Opaque to the simulation; read by the renderer and UI. */
export interface Appearance {
  /** Outfit (top) colour. */
  body: string;
  skin: string;
  hair: string;
  hairStyle: HairStyle;
  /** Scale factor, 0.9..1.1. */
  height: number;
  /** Facial hair (bodies that have it). */
  beard?: boolean;
  /**
   * Garments (character part names: `top.tee`, `bottom.skirt`, `shoes.boots`, ...) and their
   * colours. Missing in older saves: the renderer then picks them from the Sim's id.
   */
  top?: string;
  bottom?: string;
  shoes?: string;
  bottomColor?: string;
  shoesColor?: string;
  /** Optional model key overriding `model.sim` (for future character models). */
  model?: string;
  /** The hair colour before age greyed it (`hair` is what's shown). */
  hairBase?: string;
}

/** `hex` mixed `amount` of the way towards silver. */
export function greyed(hex: string, amount: number): string {
  const n = parseInt(hex.replace('#', ''), 16);
  if (!Number.isFinite(n) || amount <= 0) return hex;
  const mix = (c: number) => Math.round(c + (0xc4 - c) * Math.min(1, amount));
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(mix);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

export interface SimDraft {
  /** Stable id while editing (members can be reordered or removed). */
  uid: string;
  name: string;
  gender: string;
  /** Genders this Sim is romantically attracted to. */
  attractedTo: string[];
  appearance: Appearance;
  traits: string[];
  perks: string[];
  /** Age in years. */
  age: number;
}

export interface Bond {
  a: string;
  b: string;
  /** Key into the content's bond presets (roommates, friends, partners, ...). */
  preset: string;
}

export interface HouseholdDraft {
  name: string;
  members: SimDraft[];
  bonds: Bond[];
}

/** A Sim as the simulation's lot/town file expects it. */
export interface SimSpawn {
  name: string;
  gender: string;
  attractedTo: string[];
  household: number;
  appearance: Appearance;
  traits: string[];
  perks: string[];
  age?: number;
  x: number;
  z: number;
}

export function palette(
  assets: AssetRegistry,
  key: 'palette.skin' | 'palette.hair' | 'palette.outfit' | 'palette.bottoms' | 'palette.shoes',
): string[] {
  return assets.get(key, 'palette')?.colors ?? ['#CCCCCC'];
}

const pick = <T>(list: readonly T[], rand: () => number = Math.random): T => list[Math.floor(rand() * list.length)];

/** The gender each appearance made by `randomSim` belongs to (for avatars given only a look). */
const lookGenders = new WeakMap<object, string>();
export function genderOfLook(appearance: Appearance): string | undefined {
  return lookGenders.get(appearance);
}
const uid = () => Math.random().toString(36).slice(2, 10);

function weighted<T>(options: readonly [T, number][], rand: () => number = Math.random): T {
  let roll = rand() * options.reduce((s, [, w]) => s + w, 0);
  for (const [value, w] of options) {
    if ((roll -= w) < 0) return value;
  }
  return options[options.length - 1][0];
}

/** Attraction for a random Sim: varied, with "the other gender" most common. */
function randomAttraction(content: Content, gender: string): string[] {
  const ids = content.genders.map((g) => g.id);
  const others = ids.filter((g) => g !== gender);
  return weighted<string[]>([
    [others, 70],
    [ids, 15],
    [[gender], 15],
  ]);
}

function randomHair(gender: string, rand: () => number = Math.random): HairStyle {
  return gender === 'female'
    ? weighted<HairStyle>([['long', 50], ['bun', 25], ['short', 25]], rand)
    : weighted<HairStyle>([['short', 75], ['long', 10], ['none', 15]], rand);
}

/** A first name that suits `gender`, avoiding `taken` names while there are others. */
export function randomFirstName(content: Content, gender: string, taken: readonly string[] = []): string {
  const names = content.firstNames(gender);
  const free = names.filter((n) => !taken.includes(n));
  return pick(free.length ? free : names);
}

/**
 * After a gender change: a first name picked for the old gender (not one typed in) becomes one
 * for the new gender, and garments the new body doesn't have become their closest match.
 */
export function regender(content: Content, sim: SimDraft, from: string, taken: readonly string[] = []): void {
  const to = sim.gender;
  const fits = content.firstNames(to);
  if (content.firstNames(from).includes(sim.name) && !fits.includes(sim.name)) sim.name = randomFirstName(content, to, taken);
  const look = sim.appearance;
  const tops = GARMENTS.TOPS[to] ?? GARMENTS.TOPS.male;
  const bottoms = GARMENTS.BOTTOMS[to] ?? GARMENTS.BOTTOMS.male;
  const similar: Record<string, string> = {
    'top.tank': 'top.vneck',
    'top.blouse': 'top.polo',
    'top.vneck': 'top.tank',
    'top.polo': 'top.blouse',
    'bottom.skirt': 'bottom.trousers',
    'bottom.capri': 'bottom.trousers',
  };
  if (look.top && !tops.includes(look.top)) look.top = tops.includes(similar[look.top]) ? similar[look.top] : tops[0];
  if (look.bottom && !bottoms.includes(look.bottom)) look.bottom = bottoms.includes(similar[look.bottom]) ? similar[look.bottom] : bottoms[0];
  if (look.beard && to !== 'male') look.beard = false;
}

/** Drafts made before garments could be chosen get a random outfit (kept from then on). */
export function ensureOutfit(sim: SimDraft): void {
  if (!sim.appearance.top) Object.assign(sim.appearance, pickOutfit(sim.gender));
}

export function randomSim(content: Content, assets: AssetRegistry, taken: readonly string[] = []): SimDraft {
  const gender = content.genders.length ? pick(content.genders).id : '';
  const traits: string[] = [];
  const target = content.rules.minTraits + Math.floor(Math.random() * (content.rules.maxTraits - content.rules.minTraits + 1));
  for (const t of [...content.traits].sort(() => Math.random() - 0.5)) {
    if (traits.length >= target) break;
    if (!content.traitBlocker(traits, t.id)) traits.push(t.id);
  }
  const perks: string[] = [];
  for (const p of [...content.perks].sort(() => Math.random() - 0.5)) {
    if (content.perkCost([...perks, p.id]) <= content.rules.perkPoints && Math.random() < 0.6) perks.push(p.id);
  }
  const appearance = randomLook(assets, gender);
  return {
    uid: uid(),
    name: randomFirstName(content, gender, taken),
    gender,
    attractedTo: randomAttraction(content, gender),
    appearance,
    traits,
    perks,
    age: randomAge(content),
  };
}

/** A random look for `gender` (the creator's dice, or seeded for the same look every time). */
export function randomLook(assets: AssetRegistry, gender: string, rand: () => number = Math.random): Appearance {
  const appearance: Appearance = {
    body: pick(palette(assets, 'palette.outfit'), rand),
    skin: pick(palette(assets, 'palette.skin'), rand),
    hair: pick(palette(assets, 'palette.hair'), rand),
    hairStyle: randomHair(gender, rand),
    height: Math.round((0.94 + rand() * 0.12) * 100) / 100,
    beard: gender === 'male' && rand() < 0.2,
    ...pickOutfit(gender, rand),
  };
  lookGenders.set(appearance, gender);
  return appearance;
}

/** The look of a resident the simulation made up (a newcomer): `{seed}` expanded, always the same. */
export function lookFromSeed(assets: AssetRegistry, gender: string, seed: number): Appearance {
  let state = seed >>> 0;
  // mulberry32
  const rand = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return randomLook(assets, gender, rand);
}

/** A random age: mostly adults, some young adults, a few elders (or within `stage`). */
export function randomAge(content: Content, stage?: string): number {
  const stages = content.lifeStages;
  const id = stage ?? (Math.random() < 0.35 ? stages[0]?.id : Math.random() < 0.8 ? stages[1]?.id : stages[2]?.id) ?? stages[0]?.id;
  const [lo, hi] = id ? content.stageAges(id) : [25, 50];
  return lo + Math.floor(Math.random() * (hi - lo + 1));
}

export function randomHousehold(
  content: Content,
  assets: AssetRegistry,
  size = 1 + Math.floor(Math.random() * 3),
  avoidNames: readonly string[] = [],
): HouseholdDraft {
  const members: SimDraft[] = [];
  for (let i = 0; i < size; i++) members.push(randomSim(content, assets, members.map((m) => m.name)));
  const bonds: Bond[] = [];
  // Two adults who are attracted to each other are often a couple.
  const [a, b, c] = members;
  const adult = content.lifeStages[0]?.from ?? 18;
  const couple = !!a && !!b && a.attractedTo.includes(b.gender) && b.attractedTo.includes(a.gender) && Math.random() < 0.6;
  if (a && b && couple) {
    bonds.push({ a: a.uid, b: b.uid, preset: 'partners' });
    // Partners are close in age.
    b.age = Math.max(adult, a.age + Math.floor(Math.random() * 9) - 4);
    // Often with a grown child still at home.
    const youngest = Math.min(a.age, b.age);
    if (c && youngest - 20 >= adult && Math.random() < 0.6) {
      c.age = Math.max(adult, youngest - 20 - Math.floor(Math.random() * 11));
      bonds.push({ a: c.uid, b: a.uid, preset: 'parent' }, { a: c.uid, b: b.uid, preset: 'parent' });
    }
  } else if (a && b && Math.random() < 0.3) {
    // Or two siblings.
    b.age = Math.max(adult, a.age + Math.floor(Math.random() * 13) - 6);
    bonds.push({ a: a.uid, b: b.uid, preset: 'siblings' });
  }
  const names = content.names.last.filter((n) => !avoidNames.includes(n));
  return { name: pick(names.length ? names : content.names.last), members, bonds };
}

export function bondBetween(h: HouseholdDraft, a: string, b: string): Bond | undefined {
  return h.bonds.find((x) => (x.a === a && x.b === b) || (x.a === b && x.b === a));
}

/** Sets the bond between two members; partners are exclusive. */
export function setBond(h: HouseholdDraft, a: string, b: string, preset: string, defaultPreset = 'roommates'): void {
  h.bonds = h.bonds.filter((x) => !((x.a === a && x.b === b) || (x.a === b && x.b === a)));
  if (preset === 'partners') {
    h.bonds = h.bonds.filter((x) => !(x.preset === 'partners' && [x.a, x.b].some((u) => u === a || u === b)));
  }
  if (preset !== defaultPreset) h.bonds.push({ a, b, preset });
}

/** All problems that block moving in, per member and for the household. */
export function householdProblems(content: Content, h: HouseholdDraft): string[] {
  const problems: string[] = [];
  if (!h.name.trim()) problems.push('Give your household a name');
  if (h.members.length === 0) problems.push('Add at least one member');
  if (h.members.length > content.rules.maxHousehold) problems.push(`At most ${content.rules.maxHousehold} members`);
  for (const m of h.members) {
    const who = m.name.trim() || 'Unnamed';
    if (!m.name.trim()) problems.push('Every member needs a name');
    for (const p of content.validateCharacter(m.traits, m.perks)) problems.push(`${who}: ${p}`);
  }
  return problems;
}

/** Spawns for a household standing at `spawns` (cycled if there are more members). */
export function householdSpawns(h: HouseholdDraft, household: number, spawns: readonly [number, number][]): SimSpawn[] {
  return h.members.map((m, i) => {
    const [x, z] = spawns[i % spawns.length];
    return {
      name: m.name.trim(),
      gender: m.gender,
      attractedTo: m.attractedTo,
      household,
      appearance: m.appearance,
      traits: m.traits,
      perks: m.perks,
      age: m.age,
      x,
      z,
    };
  });
}

/** Bonds as Sim-index pairs, given the index of the household's first member. */
export function householdBonds(h: HouseholdDraft, firstIndex: number): { a: number; b: number; preset: string }[] {
  const index = (u: string) => firstIndex + h.members.findIndex((m) => m.uid === u);
  return h.bonds
    .filter((b) => h.members.some((m) => m.uid === b.a) && h.members.some((m) => m.uid === b.b))
    .map((b) => ({ a: index(b.a), b: index(b.b), preset: b.preset }));
}
