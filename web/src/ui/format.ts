import { services } from './services';

export function clock(minute: number, h24 = true): string {
  const m = Math.floor(minute);
  const hours = Math.floor(m / 60);
  const mins = String(m % 60).padStart(2, '0');
  if (h24) return `${String(hours).padStart(2, '0')}:${mins}`;
  return `${hours % 12 || 12}:${mins} ${hours < 12 ? 'AM' : 'PM'}`;
}

export function needColor(value: number): string {
  return value > 0.6 ? 'var(--good)' : value > 0.3 ? 'var(--warn)' : 'var(--bad)';
}

export function moodLabel(mood: number): string {
  return mood > 0.75 ? 'Happy' : mood > 0.5 ? 'Fine' : mood > 0.3 ? 'Uncomfortable' : 'Miserable';
}

export function timeAgo(timestamp: number): string {
  const s = Math.round((Date.now() - timestamp) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(timestamp).toLocaleDateString();
}

/** Money in the content's currency, e.g. "$1,250" or "-$40". */
export function money(amount: number): string {
  const symbol = services.content?.economy.currency ?? '$';
  return `${amount < 0 ? '-' : ''}${symbol}${Math.abs(Math.round(amount)).toLocaleString()}`;
}

export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** "Mon–Fri", "Mon Wed Fri", "Every day". */
export function dayList(days: readonly number[]): string {
  if (days.length === 7) return 'Every day';
  const sorted = [...days].sort((a, b) => a - b);
  const contiguous = sorted.every((d, i) => i === 0 || d === sorted[i - 1] + 1);
  if (contiguous && sorted.length > 2) return `${WEEKDAYS[sorted[0]]}–${WEEKDAYS[sorted[sorted.length - 1]]}`;
  return sorted.map((d) => WEEKDAYS[d]).join(' ');
}

/** A school grade's letter (sim-core `SchoolRules::letter`). */
export function gradeLetter(grade: number): string {
  return grade >= 85 ? 'A' : grade >= 70 ? 'B' : grade >= 50 ? 'C' : grade >= 30 ? 'D' : 'F';
}

/** What a lifespan means, in a line. */
export function lifespanHint(lifespan: string): string {
  switch (lifespan) {
    case 'off':
      return 'Nobody ages.';
    case 'short':
      return 'A year of age every game day: lives move fast.';
    case 'long':
      return 'A year of age every four game days.';
    default:
      return 'A year of age every two game days: a whole life in about 130 game days.';
  }
}
