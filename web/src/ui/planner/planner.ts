/** Planner helpers shared by the week grid, the today timeline and the goals list. */

import type { BlockView, ReasonView, Routine, RoutineIn, SimView } from '../../core/protocol';
import { services } from '../services';

export const DAY = 1440;
export const WEEK = 7 * DAY;
/** Calendar steps: blocks start and end on quarter hours. */
export const SNAP = 15;

/** One colour per activity (by content order), soft enough for text on top. */
const COLORS = ['#7b8cde', '#e8a35a', '#e07a5f', '#5fb3c9', '#5b7cfa', '#d9534f', '#9b7ede', '#e05fa4', '#f2c14e', '#6bbf8e', '#4caf50', '#a0826d', '#ef8fb1', '#59a5d8'];

export function activityColor(id: string): string {
  const i = services.content.activities.findIndex((a) => a.id === id);
  return COLORS[(i < 0 ? 0 : i) % COLORS.length];
}

export function activityLabel(id: string, skill?: string | null): string {
  const a = services.content.activity(id);
  const s = skill ? services.content.skill(skill)?.label : undefined;
  return s ? `${a?.label ?? id}: ${s}` : (a?.label ?? id);
}

/** "18:00" (or 12-hour) from a minute of the day. */
export function hhmm(minute: number, h24 = true): string {
  const m = ((minute % DAY) + DAY) % DAY;
  const h = Math.floor(m / 60);
  const mm = String(Math.round(m % 60)).padStart(2, '0');
  if (h24) return `${String(h).padStart(2, '0')}:${mm}`;
  return `${((h + 11) % 12) + 1}:${mm} ${h < 12 ? 'am' : 'pm'}`;
}

export function duration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h && m ? `${h} h ${m} min` : h ? `${h} h` : `${m} min`;
}

/** Pieces of a routine on the week grid (a block past midnight continues on the next day). */
export interface Segment {
  day: number;
  from: number;
  to: number;
  /** The block's first piece (its handle and label go here). */
  head: boolean;
  /** Weekday the block starts on. */
  startDay: number;
}

export function segments(r: RoutineIn): Segment[] {
  const out: Segment[] = [];
  for (let d = 0; d < 7; d++) {
    if (!(r.days & (1 << d))) continue;
    const end = r.start + r.minutes;
    out.push({ day: d, from: r.start, to: Math.min(end, DAY), head: true, startDay: d });
    if (end > DAY) out.push({ day: (d + 1) % 7, from: 0, to: end - DAY, head: false, startDay: d });
  }
  return out;
}

/** Whether two blocks would run at the same time (also across the week's end). */
export function overlaps(a: RoutineIn, b: RoutineIn): boolean {
  const spans = (r: RoutineIn) => [0, 1, 2, 3, 4, 5, 6].filter((d) => r.days & (1 << d)).map((d) => [d * DAY + r.start, d * DAY + r.start + r.minutes]);
  return spans(a).some(([a0, a1]) => spans(b).some(([b0, b1]) => [-WEEK, 0, WEEK].some((s) => a0 < b1 + s && b0 + s < a1)));
}

/** Ids of blocks that overlap another in the list. */
export function conflicts(list: readonly RoutineIn[]): Set<number> {
  const out = new Set<number>();
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      if (overlaps(list[i], list[j])) {
        out.add(i);
        out.add(j);
      }
    }
  }
  return out;
}

/** Weekday (0 = Monday) of game day `day` (from 1). */
export const weekday = (day: number) => (day - 1) % 7;

/** Why a block wasn't kept, in words. */
export function reasonText(r: ReasonView | null | undefined, name: string): string {
  if (!r) return '';
  switch (r.code) {
    case 'trait':
      return `${services.content.trait(r.trait ?? '')?.label ?? 'Their nature'}: not their thing`;
    case 'need':
      return `${services.content.needs.find((n) => n.id === r.need)?.label ?? 'A need'} came first`;
    case 'away':
      return `${name} was out`;
    case 'noPlace':
      return 'Nowhere to do it at home';
    default:
      return 'Not in the mood';
  }
}

export const STATUS_TEXT: Record<BlockView['status'], string> = {
  active: 'Now',
  kept: 'Kept',
  cut: 'Cut short',
  skipped: 'Skipped',
  noPlace: 'Nowhere to do it',
};

/** A resident's day on one bar: their blocks (own first, then the household's) and work. */
export interface DayBlock {
  from: number;
  to: number;
  activity: string | null;
  skill?: string | null;
  label: string;
  color: string;
  status: BlockView['status'] | 'upcoming' | 'work';
  reason: ReasonView | null;
}

export function dayBlocks(sim: Pick<SimView, 'plan' | 'job'>, household: readonly Routine[], day: number): DayBlock[] {
  const plan = sim.plan;
  const wd = weekday(day);
  const out: DayBlock[] = [];
  const own = plan?.routines ?? [];
  const shared = household.filter((r) => !plan?.skipHousehold.includes(r.id));
  const runs = [...(plan?.history ?? []), ...(plan?.current ? [plan.current] : [])];
  const add = (r: Routine, householdBlock: boolean) => {
    for (const s of segments(r)) {
      const startedToday = s.startDay === wd && s.head;
      const fromYesterday = !s.head && s.day === wd;
      if (!startedToday && !fromYesterday) continue;
      const blockDay = startedToday ? day : day - 1;
      const run = runs.findLast((b) => b.routine === r.id && b.household === householdBlock && b.day === blockDay);
      out.push({
        from: s.from,
        to: s.to,
        activity: r.activity,
        skill: r.skill,
        label: activityLabel(r.activity, r.skill),
        color: activityColor(r.activity),
        status: run?.status ?? 'upcoming',
        reason: run?.reason ?? null,
      });
    }
  };
  for (const r of own) add(r, false);
  for (const r of shared) if (!out.some((b) => b.from < r.start + r.minutes && r.start < b.to)) add(r, true);
  const job = sim.job;
  if (job && job.days.includes(wd)) {
    const from = Math.round(job.startHour * 60);
    out.push({ from, to: Math.min(DAY, from + job.hours * 60), activity: null, label: job.title, color: '#8b93a7', status: 'work', reason: null });
  }
  return out.sort((a, b) => a.from - b.from);
}
