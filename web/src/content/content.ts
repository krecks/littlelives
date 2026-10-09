/**
 * Gameplay content as the main thread sees it (labels, icons, descriptions).
 * The simulation receives the same JSON, ignores the visual fields, and is the
 * authority on rules; `validateCharacter` mirrors its checks for instant UI feedback.
 */

export interface NeedDef {
  id: string;
  label: string;
  decayPerHour: number;
  /** Asset key. */
  icon: string;
}

export interface InteractionDef {
  id: string;
  label: string;
  minutes: number;
  effects: Record<string, number>;
  pose?: 'stand' | 'sit' | 'lie';
  autonomous?: boolean;
  tags?: string[];
  /** Skill levels gained per hour. */
  skills?: Record<string, number>;
  /** Money charged from household funds each time it's used. */
  cost?: number;
  /** Skill that makes this interaction better (bigger need gains per level). */
  skill?: string;
  /** Feeling granted when finished (if the Sim has at least `feelingMinSkill` in `skill`). */
  feeling?: string;
  feelingMinSkill?: number;
  /**
   * Animation tag (one of the content's `animations`) the renderer shows while a Sim uses it.
   * Without one the simulation derives a tag from `tags`, `pose` and `effects`.
   */
  anim?: string;
}

export interface ObjectDef {
  id: string;
  name: string;
  /** Asset key of the 3D model. */
  model: string;
  /** Asset key of the catalog icon. */
  icon?: string;
  footprint?: [number, number];
  interactions: InteractionDef[];
  /** Buy-mode price; objects without one aren't sold. */
  price?: number;
  /** Buy-mode category id. */
  category?: string;
  /** Decor points it gives its room (default: by category, `roomRules.decorByCategory`). */
  decor?: number;
  /** Group within the category (one of its `groups`), e.g. `trees` in the garden. */
  group?: string;
  description?: string;
  /** Sims that can use it at once. */
  slots?: number;
  /** Can only be placed outdoors (trees, flower beds, ponds). */
  outdoors?: boolean;
  /** Gives light at night (lamps, lanterns): reach in metres, relative brightness, height of the bulb. */
  light?: { range?: number; intensity?: number; height?: number };
  /** Turns freely (at any angle, for looks); default: 1×1 objects of `objectRules.freeRotation` categories. */
  freeRotation?: boolean;
}

export interface SkillDef {
  id: string;
  label: string;
  icon: string;
  description: string;
}

/** A look for objects. Visual only: price and effects are the same in every style. */
export interface StyleDef {
  id: string;
  label: string;
}

export interface BuyCategory {
  id: string;
  label: string;
  /** Icon asset key for the catalog tab. */
  icon?: string;
  /** Sub-groups shown as chips when the category is open; objects name theirs in `group`. */
  groups?: { id: string; label: string; outside?: boolean }[];
  /** Its things belong in the garden (wishes for a room don't offer them); a group can say otherwise. */
  outside?: boolean;
}

/** A wall covering (Build mode's paint): a finish (texture) tinted with a colour. Price per face. */
export interface WallCoveringDef {
  id: string;
  label: string;
  finish: 'plaster' | 'wallpaper' | 'siding' | 'brick' | 'wood' | 'stone' | 'tile';
  color: string;
  price?: number;
}

/** What happens when a need runs out (sim-core `AccidentDef`); `story` reads "{a} …". */
export interface AccidentDef {
  id: string;
  need: string;
  story?: string;
  feeling?: string;
}

/** A stage of life (content `life.stages`): from `from` years until the next stage's. */
export interface LifeStageDef {
  id: string;
  label: string;
  from: number;
  /** The story's words when someone reaches it ("is an elder now"). */
  story?: string;
  /** How far hair greys at this stage (0..1). */
  greyHair?: number;
  /** Grown up (default: unless `baby` or `school`); a baby (lives in a crib); goes to school. */
  adult?: boolean;
  baby?: boolean;
  school?: boolean;
  /** Body size and head size for the stage (renderer). */
  scale?: number;
  head?: number;
}

/** What a room is for, from the tags of what stands in it (sim-core `RoomKind`). */
export interface RoomKindDef {
  id: string;
  label?: string;
  /** Asset key of its icon (thought bubbles, Our home). */
  icon?: string;
  tags: string[];
  essentials?: string[][];
  size?: [number, number];
  exclusive?: boolean;
}

/** A roof style (Build mode's Roof tool): the shape and, for pitched roofs, the pitch in degrees. */
export interface RoofStyleDef {
  id: string;
  label: string;
  shape: 'gable' | 'hip' | 'flat';
  pitch?: number;
}

/** A roof colour (shingles). */
export interface RoofColorDef {
  id: string;
  label: string;
  color: string;
}

/** A fence style (Build mode's Fence and Gate tools). Price per metre; a gate adds `build.gate`. */
export interface FenceStyleDef {
  id: string;
  label: string;
  kind: 'picket' | 'rails' | 'slats' | 'iron' | 'stone';
  color: string;
  /** Height in metres. */
  height?: number;
  price?: number;
}

/** A floor covering (Build mode's Floor tool): a finish (texture) tinted with a colour. Price per tile. */
export interface FloorCoveringDef {
  id: string;
  label: string;
  finish: 'wood' | 'tile' | 'carpet' | 'stone';
  color: string;
  price?: number;
}

/** A door style: the leaf (`panel` painted, `oak` natural wood, `halfGlass`, `glass`) and its paint. */
export interface DoorStyleDef {
  id: string;
  label: string;
  leaf: 'panel' | 'oak' | 'halfGlass' | 'glass';
  /** Paint (or frame) colour; without one, front doors take the house's accent colour. */
  color?: string;
  price?: number;
}

/** A window style: opening heights (m), glazing bars and shutters outside (`house`: if the house's style has them). */
export interface WindowStyleDef {
  id: string;
  label: string;
  panes: 'cross' | 'grid' | 'bar' | 'transom' | 'none';
  sill: number;
  head: number;
  /** Wall left either side of the glazing (m). */
  inset: number;
  shutters: boolean | 'house';
  price?: number;
}

export interface CareerCategory {
  id: string;
  label: string;
  icon: string;
  description: string;
  tracks: { id: string; label: string; titles: string[] }[];
}

export interface Economy {
  startingFunds: number;
  /** Extra money to build with when a household starts on an empty lot (Living games). */
  emptyLotFunds?: number;
  currency: string;
  rent?: { weekday: number; hour: number; base: number; perTile: number; billsBase?: number; billsRate?: number };
}

export interface TraitDef {
  id: string;
  label: string;
  description: string;
  icon: string;
  conflicts?: string[];
}

export interface PerkDef {
  id: string;
  label: string;
  description: string;
  icon: string;
  cost: number;
}

export interface GenderDef {
  id: string;
  label: string;
  pronouns: { subject: string; object: string; possessive: string };
}

export interface EmotionDef {
  id: string;
  label: string;
  icon: string;
}

export interface SocialDef {
  id: string;
  label: string;
  category: string;
  icon: string;
}

/** What a routine block can be for (`activities`). */
export interface ActivityDef {
  id: string;
  label: string;
  icon: string;
  tags?: string[];
  /** Blocks name a skill to train. */
  skill?: boolean;
  social?: boolean;
  visit?: boolean;
  sleep?: boolean;
}

export interface GoalDef {
  id: string;
  /** With `{skill}`, `{n}` and `{category}`. */
  label: string;
  icon: string;
  kind: 'hasJob' | 'jobLevel' | 'promoted' | 'skill' | 'friends' | 'partner' | 'funds';
}

export interface PlannerRules {
  maxMinutes: number;
  maxSleepMinutes: number;
  maxGoals: number;
}

export interface Names {
  /** Every first name (used for genders without their own list). */
  first: string[];
  /** First names per gender id. */
  byGender?: Record<string, string[]>;
  last: string[];
  towns?: string[];
  streets?: string[];
}

export interface CharacterRules {
  minTraits: number;
  maxTraits: number;
  perkPoints: number;
  maxHousehold: number;
}

interface ContentFile {
  needs: NeedDef[];
  rules: CharacterRules;
  traits: TraitDef[];
  perks: PerkDef[];
  names: Names;
  genders: GenderDef[];
  emotions: EmotionDef[];
  socials: SocialDef[];
  careerCategories?: CareerCategory[];
  bondPresets: Record<string, unknown>;
  events: Record<string, string>;
  objects: ObjectDef[];
  skills?: SkillDef[];
  styles?: StyleDef[];
  buyCategories?: BuyCategory[];
  wallCoverings?: WallCoveringDef[];
  floorCoverings?: FloorCoveringDef[];
  doorStyles?: DoorStyleDef[];
  windowStyles?: WindowStyleDef[];
  fenceStyles?: FenceStyleDef[];
  roofStyles?: RoofStyleDef[];
  roofColors?: RoofColorDef[];
  roomKinds?: RoomKindDef[];
  accidents?: AccidentDef[];
  roomRules?: { decorByCategory?: Record<string, number> };
  life?: { daysPerYear?: number; startAge?: [number, number]; stages?: LifeStageDef[] };
  economy?: Partial<Economy>;
  objectRules?: { freeRotation?: string[] };
  /** Animation tags interactions can use as `anim` (the snapshot layout's `actions`). */
  animations?: string[];
  activities?: ActivityDef[];
  goals?: GoalDef[];
  planner?: Partial<PlannerRules>;
  /** Further content files (relative to this one), merged key by key. */
  include?: string[];
}

export class Content {
  readonly needs: readonly NeedDef[];
  readonly traits: readonly TraitDef[];
  readonly perks: readonly PerkDef[];
  readonly rules: CharacterRules;
  readonly names: Names;
  readonly genders: readonly GenderDef[];
  readonly emotions: readonly EmotionDef[];
  readonly socials: readonly SocialDef[];
  readonly careerCategories: readonly CareerCategory[];
  readonly skills: readonly SkillDef[];
  readonly styles: readonly StyleDef[];
  readonly buyCategories: readonly BuyCategory[];
  /** Build mode looks; a wall face's covering is an index into `wallCoverings` + 1 (0: automatic). */
  readonly wallCoverings: readonly WallCoveringDef[];
  /** A floor tile's covering is an index into `floorCoverings` + 1 (0: automatic, by room). */
  readonly floorCoverings: readonly FloorCoveringDef[];
  readonly doorStyles: readonly DoorStyleDef[];
  readonly fenceStyles: readonly FenceStyleDef[];
  readonly roofStyles: readonly RoofStyleDef[];
  readonly roofColors: readonly RoofColorDef[];
  readonly roomKinds: readonly RoomKindDef[];
  readonly accidents: readonly AccidentDef[];
  /** Life stages, youngest first. */
  readonly lifeStages: readonly LifeStageDef[];
  private readonly decorByCategory: Readonly<Record<string, number>>;
  readonly windowStyles: readonly WindowStyleDef[];
  readonly economy: Economy;
  /** Animation tags, in the order the snapshot's `sim.action` indexes them. */
  readonly animations: readonly string[];
  /** Objects for sale, in content order. */
  readonly shop: readonly ObjectDef[];
  readonly bondPresets: readonly string[];
  /** Story-feed templates with `{a}`, `{b}`, `{c}` placeholders. */
  readonly eventTexts: Readonly<Record<string, string>>;
  /** What routine blocks can be for; life goals; planner limits. */
  readonly activities: readonly ActivityDef[];
  readonly goals: readonly GoalDef[];
  readonly planner: PlannerRules;
  private readonly objects: Map<string, ObjectDef>;
  /** Every object, in the order the simulation numbers them (story events name them by index). */
  readonly objectList: readonly ObjectDef[];

  private constructor(
    /** Raw JSON, forwarded unchanged to the simulation. */
    readonly json: string,
  ) {
    const file = JSON.parse(json) as ContentFile;
    this.needs = file.needs;
    this.traits = file.traits;
    this.perks = file.perks;
    this.rules = file.rules;
    this.names = file.names;
    this.genders = file.genders ?? [];
    this.emotions = file.emotions ?? [];
    this.socials = file.socials ?? [];
    this.careerCategories = file.careerCategories ?? [];
    this.skills = file.skills ?? [];
    this.styles = file.styles ?? [];
    this.buyCategories = file.buyCategories ?? [];
    this.wallCoverings = file.wallCoverings ?? [];
    this.floorCoverings = file.floorCoverings ?? [];
    this.doorStyles = file.doorStyles ?? [];
    this.windowStyles = file.windowStyles ?? [];
    this.fenceStyles = file.fenceStyles ?? [];
    this.roofStyles = file.roofStyles ?? [];
    this.roofColors = file.roofColors ?? [];
    this.roomKinds = file.roomKinds ?? [];
    this.accidents = file.accidents ?? [];
    this.lifeStages = file.life?.stages ?? [];
    this.decorByCategory = file.roomRules?.decorByCategory ?? {};
    this.economy = { startingFunds: 0, currency: '$', ...file.economy };
    this.animations = [...new Set(file.animations ?? [])];
    this.shop = file.objects.filter((o) => o.price !== undefined);
    this.bondPresets = Object.keys(file.bondPresets ?? {});
    this.eventTexts = file.events ?? {};
    this.activities = file.activities ?? [];
    this.goals = file.goals ?? [];
    this.planner = { maxMinutes: 240, maxSleepMinutes: 720, maxGoals: 3, ...file.planner };
    this.objects = new Map(file.objects.map((o) => [o.id, o]));
    this.objectList = file.objects;
    this.freeRotation = new Set(file.objectRules?.freeRotation ?? []);
  }

  private readonly freeRotation: Set<string>;

  /** Whether an object turns freely (sim-core `ObjectDef::turns`): at any angle past its facing. */
  turns(def: ObjectDef): boolean {
    const [w, d] = def.footprint ?? [1, 1];
    return def.freeRotation ?? (w === 1 && d === 1 && def.category !== undefined && this.freeRotation.has(def.category));
  }

  /** Loads a content file and merges the files it includes (content packs); see `mergeContent`. */
  static async load(url: string): Promise<Content> {
    const base = new URL(url, location.href);
    const baseText = await fetchText(base.href);
    const includes = ((JSON.parse(baseText) as { include?: unknown }).include as string[] | undefined) ?? [];
    const parts = await Promise.all(includes.map((name) => fetchText(new URL(name, base).href)));
    const name = base.pathname.split('/').pop() || url;
    return new Content(JSON.stringify(mergeContent([[name, baseText], ...includes.map((n, i): [string, string] => [n, parts[i]])])));
  }

  activity(id: string): ActivityDef | undefined {
    return this.activities.find((a) => a.id === id);
  }

  /** The life stage at `age` (the last one reached). */
  stageOf(age: number): LifeStageDef | undefined {
    let stage: LifeStageDef | undefined;
    for (const s of this.lifeStages) if (age >= s.from) stage = s;
    return stage ?? this.lifeStages[0];
  }

  /** Whether someone at `age` is grown up (may work, fall in love, live without a parent). */
  isAdult(age: number): boolean {
    const s = this.stageOf(age);
    return !s || (s.adult ?? (!s.baby && !s.school));
  }

  /** The grown-up stages, youngest first. */
  get adultStages(): LifeStageDef[] {
    return this.lifeStages.filter((s) => s.adult ?? (!s.baby && !s.school));
  }

  /** Ages a stage spans, `[from, to]` (the last one: fifteen years). */
  stageAges(id: string): [number, number] {
    const i = this.lifeStages.findIndex((s) => s.id === id);
    const s = this.lifeStages[i];
    if (!s) return [25, 50];
    const next = this.lifeStages[i + 1];
    return [s.from, next ? next.from - 1 : s.from + 15];
  }

  /** Whether an object belongs in the garden rather than a room (outdoor-only, or its category or group says so). */
  belongsOutside(def: ObjectDef): boolean {
    if (def.outdoors) return true;
    const category = this.buyCategories.find((c) => c.id === def.category);
    return category?.groups?.find((g) => g.id === def.group)?.outside ?? category?.outside ?? false;
  }

  /** Decor points an object gives the room it stands in (sim-core `ObjectDef::decor`). */
  decorOf(def: ObjectDef): number {
    return def.decor ?? (def.category ? this.decorByCategory[def.category] : undefined) ?? 0;
  }

  /** Whether an object's interactions offer any of `tags`. */
  offersTags(def: ObjectDef, tags: readonly string[]): boolean {
    return def.interactions.some((it) => (it.tags ?? []).some((t) => tags.includes(t)));
  }

  /** Whether an object's interactions offer an activity (with a skill to train, if given). */
  offers(def: ObjectDef, activity: ActivityDef, skill?: string | null): boolean {
    return def.interactions.some((it) =>
      activity.skill && skill ? (it.skills?.[skill] ?? 0) > 0 : (it.tags ?? []).some((t) => activity.tags?.includes(t)),
    );
  }

  skill(id: string): SkillDef | undefined {
    return this.skills.find((s) => s.id === id);
  }

  careerCategory(id: string | null | undefined): CareerCategory | undefined {
    return id ? this.careerCategories.find((c) => c.id === id) : undefined;
  }

  object(id: string): ObjectDef | undefined {
    return this.objects.get(id);
  }

  trait(id: string): TraitDef | undefined {
    return this.traits.find((t) => t.id === id);
  }

  gender(id: string): GenderDef | undefined {
    return this.genders.find((g) => g.id === id);
  }

  /** First names that suit a gender (all first names when the content has no list for it). */
  firstNames(gender: string): readonly string[] {
    const list = this.names.byGender?.[gender];
    return list && list.length ? list : this.names.first;
  }

  emotion(id: string | null): EmotionDef | undefined {
    return id ? this.emotions.find((e) => e.id === id) : undefined;
  }

  social(index: number): SocialDef | undefined {
    return this.socials[index];
  }

  perk(id: string): PerkDef | undefined {
    return this.perks.find((p) => p.id === id);
  }

  perkCost(perks: readonly string[]): number {
    return perks.reduce((sum, id) => sum + (this.perk(id)?.cost ?? 0), 0);
  }

  /** Why `traitId` can't be added to `traits`, or null if it can. */
  traitBlocker(traits: readonly string[], traitId: string): string | null {
    if (traits.includes(traitId)) return null;
    const conflict = traits.find((t) => this.trait(t)?.conflicts?.includes(traitId) || this.trait(traitId)?.conflicts?.includes(t));
    if (conflict) return `Conflicts with ${this.trait(conflict)?.label ?? conflict}`;
    if (traits.length >= this.rules.maxTraits) return `Up to ${this.rules.maxTraits} traits`;
    return null;
  }

  /** Mirrors `Content::character_modifiers` in sim-core. Returns a list of problems. */
  validateCharacter(traits: readonly string[], perks: readonly string[]): string[] {
    const problems: string[] = [];
    const { minTraits, maxTraits, perkPoints } = this.rules;
    if (traits.length < minTraits) problems.push(`Pick at least ${minTraits} trait${minTraits === 1 ? '' : 's'}`);
    if (traits.length > maxTraits) problems.push(`Pick at most ${maxTraits} traits`);
    for (const t of traits) {
      const blocker = this.traitBlocker(traits.filter((x) => x !== t), t);
      if (blocker?.startsWith('Conflicts')) problems.push(`${this.trait(t)?.label}: ${blocker.toLowerCase()}`);
    }
    if (this.perkCost(perks) > perkPoints) problems.push(`Perks cost more than ${perkPoints} points`);
    return problems;
  }
}

type Json = Record<string, unknown>;

const isJsonObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const jsonKind = (v: unknown) => (Array.isArray(v) ? 'array' : isJsonObject(v) ? 'object' : 'value');
/**
 * Content keys renamed when moodlets became feelings: [old, new]. Kept so content packs written
 * before the rename still load. Same list as `LEGACY_KEYS` in sim-core's `pack.rs`.
 */
const LEGACY_KEYS: [string, string][] = [
  ['moodlets', 'feelings'],
  ['moodlet', 'feeling'],
  ['moodletMinSkill', 'feelingMinSkill'],
  ['targetMoodlet', 'targetFeeling'],
  ['winnerMoodlet', 'winnerFeeling'],
  ['loserMoodlet', 'loserFeeling'],
  ['jealousyMoodlet', 'jealousyFeeling'],
  ['heartbreakMoodlet', 'heartbreakFeeling'],
  ['promotionMoodlet', 'promotionFeeling'],
  ['missedMoodlet', 'missedFeeling'],
  ['debtMoodlet', 'debtFeeling'],
];

/** Renames `LEGACY_KEYS` anywhere in `value`, unless the new key is already there. */
function upgradeLegacyKeys(value: unknown): void {
  if (Array.isArray(value)) {
    value.forEach(upgradeLegacyKeys);
  } else if (isJsonObject(value)) {
    for (const [old, key] of LEGACY_KEYS) {
      if (old in value && !(key in value)) {
        value[key] = value[old];
        delete value[old];
      }
    }
    Object.values(value).forEach(upgradeLegacyKeys);
  }
}

/** `traitPatches` effect maps whose entries are set per key. */
const PATCH_MAPS = ['needDecay', 'needGain', 'tagPreference', 'tagAcceptance', 'tagSuccess', 'skillGain'];

/**
 * Merges content files in order (base first, then its includes). Mirrors
 * `sim_core::pack::merge_named` exactly; see docs/content-packs.md:
 * top-level arrays are appended (a repeated `id` is an error), objects are merged
 * shallowly, other values replaced, `traitPatches` are applied to the merged traits
 * last, and `include` / `$comment` are dropped. Keys from before the moodlet → feeling rename
 * are renamed first (`LEGACY_KEYS`).
 */
export function mergeContent(files: [name: string, text: string][]): Json {
  const out: Json = {};
  const origin = new Map<string, string>();
  const patches: [string, unknown][] = [];
  for (const [name, text] of files) {
    let file: unknown;
    try {
      file = JSON.parse(text);
    } catch (e) {
      throw new Error(`${name}: invalid JSON: ${(e as Error).message}`);
    }
    if (!isJsonObject(file)) throw new Error(`${name}: a content file must be a JSON object`);
    upgradeLegacyKeys(file);
    for (const [key, value] of Object.entries(file)) {
      if (key === 'include' || key === '$comment') continue;
      if (key === 'traitPatches') {
        patches.push([name, value]);
        continue;
      }
      const prev = out[key];
      if (prev !== undefined && jsonKind(prev) !== jsonKind(value)) {
        throw new Error(`${name}: '${key}' has a different type than in the files before it`);
      }
      if (Array.isArray(value)) {
        for (const item of value) {
          if (!isJsonObject(item) || typeof item.id !== 'string') continue;
          const first = origin.get(`${key}\u0000${item.id}`);
          if (first !== undefined) throw new Error(`duplicate ${key} id '${item.id}' in ${first} and ${name}`);
          origin.set(`${key}\u0000${item.id}`, name);
        }
        out[key] = [...((prev as unknown[] | undefined) ?? []), ...value];
      } else if (isJsonObject(value)) {
        out[key] = { ...((prev as Json | undefined) ?? {}), ...value };
      } else {
        out[key] = value;
      }
    }
  }
  const setEntries = (target: Json, key: string, value: unknown, ctx: string) => {
    if (!isJsonObject(value)) throw new Error(`${ctx}.${key} must be an object`);
    if (!isJsonObject(target[key])) target[key] = {};
    Object.assign(target[key] as Json, value);
  };
  for (const [name, value] of patches) {
    if (!isJsonObject(value)) throw new Error(`${name}: traitPatches must be an object`);
    const traits = Array.isArray(out.traits) ? (out.traits as unknown[]) : [];
    for (const [id, patch] of Object.entries(value)) {
      const ctx = `${name}: traitPatches.${id}`;
      const target = traits.find((t) => isJsonObject(t) && t.id === id);
      if (!isJsonObject(target)) throw new Error(`${name}: traitPatches: unknown trait '${id}'`);
      if (!isJsonObject(patch)) throw new Error(`${ctx} must be an object`);
      for (const [k, v] of Object.entries(patch)) {
        if (k === 'startingSkills') {
          setEntries(target, k, v, ctx);
        } else if (k === 'effects') {
          if (!isJsonObject(v)) throw new Error(`${ctx}.effects must be an object`);
          if (!isJsonObject(target.effects)) target.effects = {};
          const effects = target.effects as Json;
          for (const [ek, ev] of Object.entries(v)) {
            if (PATCH_MAPS.includes(ek)) {
              setEntries(effects, ek, ev, `${ctx}.effects`);
            } else if (ek === 'mood' || ek === 'walkSpeed') {
              if (typeof ev !== 'number') throw new Error(`${ctx}.effects.${ek} must be a number`);
              const old = typeof effects[ek] === 'number' ? (effects[ek] as number) : ek === 'mood' ? 0 : 1;
              effects[ek] = ek === 'mood' ? old + ev : old * ev;
            } else {
              throw new Error(`${ctx}.effects: unknown key '${ek}'`);
            }
          }
        } else {
          throw new Error(`${ctx}: unknown key '${k}' (use effects or startingSkills)`);
        }
      }
    }
  }
  return out;
}

export async function fetchText(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`failed to load ${url}: ${res.status}`);
  return res.text();
}
