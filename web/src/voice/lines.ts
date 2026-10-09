/**
 * What residents say, per language (`content/voice/<lang>.json`), keyed by id: social
 * interaction ids, animation tags, emotion ids, planner thought kinds. The line for an event is
 * picked with a hash, never the simulation's random numbers, so voices can't change the game.
 */

import { hashUnit } from './voices';

interface Group {
  lines: string[];
  tone?: string;
}

interface LinesFile {
  social: Record<string, { start: string[]; good: string[]; bad: string[]; tone?: string }>;
  action: Record<string, string[]>;
  emotion: Record<string, Group>;
  thought: Record<string, Group>;
}

export interface Line {
  text: string;
  tone?: string;
}

/** Planner thought kinds in snapshot order (`thought` 1..4). */
const THOUGHTS = ['skipped', 'noPlace', 'kept', 'goal'] as const;

const files = new Map<string, Promise<LinesFile | null>>();

export function loadLines(language: string): Promise<LinesFile | null> {
  let file = files.get(language);
  if (!file) {
    file = fetch(`${import.meta.env.BASE_URL}content/voice/${language}.json`)
      .then((r) => (r.ok ? (r.json() as Promise<LinesFile>) : null))
      .catch(() => null);
    files.set(language, file);
  }
  return file;
}

export class Lines {
  constructor(private readonly data: LinesFile) {}

  social(id: string, part: 'start' | 'good' | 'bad', seed: number): Line | null {
    const s = this.data.social[id];
    return s ? pick({ lines: s[part], tone: part === 'bad' && s.tone === 'happy' ? undefined : s.tone }, seed) : null;
  }

  action(tag: string, seed: number): Line | null {
    const lines = this.data.action[tag];
    return lines ? pick({ lines }, seed) : null;
  }

  emotion(id: string, seed: number): Line | null {
    const g = this.data.emotion[id];
    return g ? pick(g, seed) : null;
  }

  thought(kind: number, seed: number): Line | null {
    const g = this.data.thought[THOUGHTS[kind - 1]];
    return g ? pick(g, seed) : null;
  }
}

function pick(g: Group, seed: number): Line | null {
  if (!g.lines?.length) return null;
  return { text: g.lines[Math.floor(hashUnit(seed, 7) * g.lines.length)], tone: g.tone };
}

/** Fills `{name}` (the other resident) and `{me}`. */
export function fill(text: string, me: string, other: string): string {
  return text.replaceAll('{me}', me || 'me').replaceAll('{name}', other || 'friend');
}
