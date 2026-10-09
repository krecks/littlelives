/** Relationship labels for the UI. Thresholds mirror `sim-core/src/social.rs`. */

import type { Kin, RelationshipView } from '../core/protocol';

export function friendLabel(f: number, mutual: number): string {
  if (f <= -60) return 'Enemy';
  if (f <= -25) return 'Disliked';
  if (f >= 80 && mutual >= 80) return 'Best friend';
  if (f >= 60) return 'Good friend';
  if (f >= 35) return 'Friend';
  return 'Acquaintance';
}

export function romanceLabel(r: RelationshipView | undefined): string | null {
  if (!r) return null;
  if (r.partners) return 'Partner';
  if (r.romance >= 60) return 'In love';
  if (r.romance >= 35) return 'Crush';
  return null;
}

export function chemistryLabel(c: number): string {
  if (c > 0.45) return 'Sparks fly';
  if (c > 0.15) return 'Good chemistry';
  if (c < -0.3) return 'Clashing';
  return 'Neutral';
}

export function chanceLabel(p: number): { text: string; tone: 'good' | 'warn' | 'bad' } {
  if (p >= 0.7) return { text: 'Likely', tone: 'good' };
  if (p >= 0.4) return { text: 'Maybe', tone: 'warn' };
  if (p > 0) return { text: 'Unlikely', tone: 'bad' };
  return { text: 'Not interested', tone: 'bad' };
}

/** What someone of `gender` is to the other in the family ("Mother", "Brother"). */
export function kinLabel(kin: Kin | undefined, gender: string | undefined): string | null {
  if (!kin) return null;
  const female = gender === 'female';
  const male = gender === 'male';
  if (kin === 'parent') return female ? 'Mother' : male ? 'Father' : 'Parent';
  if (kin === 'child') return female ? 'Daughter' : male ? 'Son' : 'Child';
  return female ? 'Sister' : male ? 'Brother' : 'Sibling';
}
