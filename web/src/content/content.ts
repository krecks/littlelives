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

export interface Names {
  first: string[];
  last: string[];
  towns?: string[];
  streets?: string[];
}

export interface CareerLevel {
  title: string;
  pay: number;
  start: number;
  hours: number;
  days: number[];
}

export interface CareerDef {
  id: string;
  label: string;
  icon: string;
  levels: CareerLevel[];
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
  careers: CareerDef[];
  bondPresets: Record<string, unknown>;
  events: Record<string, string>;
  objects: ObjectDef[];
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
  readonly careers: readonly CareerDef[];
  readonly bondPresets: readonly string[];
  /** Story-feed templates with `{a}`, `{b}`, `{c}` placeholders. */
  readonly eventTexts: Readonly<Record<string, string>>;
  private readonly objects: Map<string, ObjectDef>;

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
    this.careers = file.careers ?? [];
    this.bondPresets = Object.keys(file.bondPresets ?? {});
    this.eventTexts = file.events ?? {};
    this.objects = new Map(file.objects.map((o) => [o.id, o]));
  }

  static async load(url: string): Promise<Content> {
    return new Content(await fetchText(url));
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

export async function fetchText(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`failed to load ${url}: ${res.status}`);
  return res.text();
}
