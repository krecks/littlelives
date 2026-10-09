/**
 * What each thread is doing, for the debug overlay and debug reports: the main thread (UI and
 * drawing), the sim worker and the voice worker, and the sum of them.
 */

import type { SimThreadStats } from '../core/protocol';
import type { RenderStats } from '../render/types';
import { voiceThreadStats, type VoiceThreadStats } from '../voice/service.svelte';

export interface ThreadStats {
  overall: {
    /** Logical cores the browser reports. */
    cores: number;
    /** Work across all three threads, in cores (1 = one core fully busy). */
    busyCores: number;
    /** Main-thread JS heap plus the sim's WASM memory, bytes (null when the browser won't say). */
    memoryBytes: number | null;
    /** Shared memory between the threads (needs cross-origin isolation). */
    isolated: boolean;
  };
  main: {
    /** Share of the time spent on frames, 0..1. */
    busy: number;
    /** Tasks over 50 ms in the last ten seconds, and the longest, ms (null: not supported). */
    longTasks: number | null;
    longestTaskMs: number;
    heapBytes: number | null;
  };
  /** Null until the worker's first report. */
  sim: SimThreadStats | null;
  voice: VoiceThreadStats & { speaking: number; inFlight: number; spoken: number; dropped: number };
}

const LONG_TASK_WINDOW_MS = 10_000;
const longTasks: { at: number; ms: number }[] = [];
const longTasksSupported = typeof PerformanceObserver !== 'undefined' && PerformanceObserver.supportedEntryTypes?.includes('longtask');
if (longTasksSupported) {
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) longTasks.push({ at: e.startTime + e.duration, ms: e.duration });
  }).observe({ type: 'longtask', buffered: true });
}

export function threadStats(
  render: RenderStats,
  sim: SimThreadStats | null,
  director: { speaking: number; inFlight: number; spoken: number; dropped: number },
): ThreadStats {
  const now = performance.now();
  while (longTasks.length && longTasks[0].at < now - LONG_TASK_WINDOW_MS) longTasks.shift();
  // Chrome only.
  const heapBytes = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? null;
  const mainBusy = Math.min(1, (render.cpuMs * render.fps) / 1000);
  const voice = { ...voiceThreadStats(), ...director };
  return {
    overall: {
      cores: navigator.hardwareConcurrency ?? 0,
      busyCores: mainBusy + (sim?.busy ?? 0) + voice.busy,
      memoryBytes: heapBytes === null ? null : heapBytes + (sim?.memoryBytes ?? 0),
      isolated: self.crossOriginIsolated,
    },
    main: {
      busy: mainBusy,
      longTasks: longTasksSupported ? longTasks.length : null,
      longestTaskMs: longTasks.reduce((n, t) => Math.max(n, t.ms), 0),
      heapBytes,
    },
    sim,
    voice,
  };
}
