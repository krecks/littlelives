/**
 * Keeps the most recent console warnings and errors (and uncaught errors) for debug reports.
 * Installed once at start-up; the console keeps working as before.
 */

export interface LogEntry {
  /** Milliseconds since the page loaded. */
  t: number;
  level: 'error' | 'warn' | 'uncaught' | 'rejection';
  text: string;
}

const MAX_ENTRIES = 200;
const MAX_TEXT = 2000;
const entries: LogEntry[] = [];

function describe(value: unknown): string {
  if (value instanceof Error) return `${value.name}: ${value.message}${value.stack ? `\n${value.stack}` : ''}`;
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function push(level: LogEntry['level'], parts: unknown[]): void {
  const text = parts.map(describe).join(' ').slice(0, MAX_TEXT);
  entries.push({ t: Math.round(performance.now()), level, text });
  if (entries.length > MAX_ENTRIES) entries.shift();
}

let installed = false;

export function installLogCapture(): void {
  if (installed) return;
  installed = true;
  for (const level of ['error', 'warn'] as const) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      push(level, args);
      original(...args);
    };
  }
  window.addEventListener('error', (e) => push('uncaught', [e.error ?? e.message]));
  window.addEventListener('unhandledrejection', (e) => push('rejection', [e.reason]));
}

/** The captured entries, oldest first. */
export function recentLog(): LogEntry[] {
  return entries.slice();
}
