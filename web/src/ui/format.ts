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
