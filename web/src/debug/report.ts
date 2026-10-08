/**
 * Debug reports: a screenshot, the full game state (a regular save) and the context needed to
 * reproduce a problem. With the dev server they are written to `debug-reports/<name>/` in the
 * project (see the `debugReports` plugin in vite.config.ts); otherwise they download as one file.
 * `?debugReport=<name>` (dev server only) loads a report's game state with its camera.
 */

import type { CameraPose } from '../render/types';
import { writeSave, type SaveRecord } from '../persistence/saves';
import type { LogEntry } from './log';

export interface DebugReport {
  /** What the report is about, typed by the player (may be empty). */
  note: string;
  /** Game version the report was taken with. */
  version: string;
  createdAt: string;
  url: string;
  userAgent: string;
  screen: { width: number; height: number; pixelRatio: number };
  gpu: Record<string, string> | null;
  renderer: unknown;
  settings: unknown;
  camera: CameraPose;
  /** UI state (mode, selection, panels, needs…) at capture time. */
  ui: unknown;
  log: LogEntry[];
  /** Save metadata; the save data itself travels as `save`. */
  saveMeta: Omit<SaveRecord, 'data' | 'thumbnail'>;
}

export interface DebugPayload {
  report: DebugReport;
  /** The simulation's save data. */
  save: string;
  /** JPEG data URL of the 3D view, or null if capture failed. */
  screenshot: string | null;
}

/** Adapter details for the report (WebGPU only; empty when unavailable). */
export async function gpuInfo(): Promise<Record<string, string> | null> {
  try {
    const gpu = (navigator as unknown as { gpu?: { requestAdapter(): Promise<{ info?: Record<string, string> } | null> } }).gpu;
    const adapter = await gpu?.requestAdapter();
    const info = adapter?.info;
    if (!info) return null;
    return { vendor: info.vendor, architecture: info.architecture, device: info.device, description: info.description };
  } catch {
    return null;
  }
}

/** Stores the report: in the project folder via the dev server, else as a download. Returns where it went. */
export async function deliverReport(payload: DebugPayload): Promise<string> {
  if (import.meta.env.DEV) {
    const res = await fetch('/__debug/report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`dev server answered ${res.status}`);
    const { path } = (await res.json()) as { path: string };
    return path;
  }
  const stamp = payload.report.createdAt.replace(/[:.]/g, '-');
  const name = `littlelives-debug-${stamp}.json`;
  const url = URL.createObjectURL(new Blob([JSON.stringify(payload)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return `Downloads/${name}`;
}

/** Camera pose to restore once a debug report's game is shown. */
let pendingPose: CameraPose | null = null;

export function takePendingPose(): CameraPose | null {
  const pose = pendingPose;
  pendingPose = null;
  return pose;
}

/**
 * Loads report `name` from the dev server into a save slot and returns its id.
 * The camera pose is applied when the game is revealed (`takePendingPose`).
 */
export async function loadDebugReport(name: string): Promise<string> {
  const base = `/__debug/reports/${encodeURIComponent(name)}`;
  const [reportRes, saveRes] = await Promise.all([fetch(`${base}/report.json`), fetch(`${base}/save.txt`)]);
  if (!reportRes.ok || !saveRes.ok) throw new Error(`Debug report "${name}" not found`);
  const report = (await reportRes.json()) as DebugReport;
  const record: SaveRecord = { ...report.saveMeta, id: `debug-${name}`, name: `Debug: ${name}`, autosave: false, thumbnail: null, data: await saveRes.text() };
  await writeSave(record);
  pendingPose = report.camera;
  return record.id;
}
