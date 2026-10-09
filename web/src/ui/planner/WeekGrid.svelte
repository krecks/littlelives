<script lang="ts">
  import type { BlockView, Routine, RoutineIn } from '../../core/protocol';
  import { settings } from '../../settings/settings.svelte';
  import { WEEKDAYS } from '../format';
  import { services } from '../services';
  import { activityColor, activityLabel, conflicts, DAY, duration, hhmm, reasonText, segments, SNAP, STATUS_TEXT, weekday } from './planner';

  /**
   * The weekly calendar: 7 day columns by 24 hours. Blocks are dragged to move (also to other
   * days), resized from their bottom edge, clicked to select; clicking an empty slot adds a
   * block of the chosen activity. Read-only layers: the household's template (hatched; dimmed
   * where skipped), work shifts, and how this week's blocks went.
   */
  let {
    routines,
    onchange,
    selected = $bindable(null),
    tool = null,
    template = [],
    skipped = [],
    work = null,
    runs = [],
    today,
    readonly = false,
  }: {
    routines: readonly RoutineIn[];
    onchange: (list: RoutineIn[]) => void;
    selected?: number | null;
    /** Activity a click on an empty slot adds. */
    tool?: { activity: string; skill?: string | null } | null;
    template?: readonly Routine[];
    skipped?: readonly number[];
    work?: { days: number[]; start: number; minutes: number; label: string } | null;
    /** This and last week's blocks (for how they went). */
    runs?: readonly BlockView[];
    today: number;
    readonly?: boolean;
  } = $props();

  const HOUR = 26;
  const PX = HOUR / 60;
  let body: HTMLDivElement;
  let scroller: HTMLDivElement;
  const bad = $derived(conflicts(routines));
  const weekStart = $derived(today - weekday(today));

  $effect(() => {
    // Start the view at 06:00.
    if (scroller) scroller.scrollTop = 6 * HOUR - 4;
  });

  /** Day column and minute (snapped) under a client point; null outside the grid. */
  export function at(clientX: number, clientY: number): { day: number; minute: number } | null {
    const r = body?.getBoundingClientRect();
    const view = scroller?.getBoundingClientRect();
    if (!r || !view || clientX < r.left || clientX > r.right || clientY < view.top || clientY > view.bottom) return null;
    const day = Math.min(6, Math.floor(((clientX - r.left) / r.width) * 7));
    const minute = Math.max(0, Math.min(DAY - SNAP, Math.floor((clientY - r.top) / PX / SNAP) * SNAP));
    return { day, minute };
  }

  const defaultMinutes = (activity: string) => (services.content.activity(activity)?.sleep ? 8 * 60 : 60);
  const longest = (activity: string) => (services.content.activity(activity)?.sleep ? services.content.planner.maxSleepMinutes : services.content.planner.maxMinutes);

  /** Adds a block of the tool's activity at a slot. */
  export function add(day: number, minute: number, activity = tool?.activity, skill = tool?.skill): void {
    if (!activity || readonly) return;
    const block: RoutineIn = { activity, days: 1 << day, start: minute, minutes: defaultMinutes(activity) };
    if (skill) block.skill = skill;
    const index = routines.length;
    onchange([...routines, block]);
    selected = index;
  }

  // --- Dragging blocks ----------------------------------------------------------------------
  let drag: { index: number; mode: 'move' | 'resize'; x: number; y: number; start: number; minutes: number; days: number; moved: boolean } | null = null;

  function rotate(days: number, by: number): number {
    const k = ((by % 7) + 7) % 7;
    return ((days << k) | (days >> (7 - k))) & 0x7f;
  }

  function down(e: PointerEvent, index: number, mode: 'move' | 'resize') {
    if (e.button !== 0) return;
    e.stopPropagation();
    selected = index;
    if (readonly) return;
    const r = routines[index];
    drag = { index, mode, x: e.clientX, y: e.clientY, start: r.start, minutes: r.minutes, days: r.days, moved: false };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function move(e: PointerEvent) {
    if (!drag) return;
    const dy = e.clientY - drag.y;
    const dx = e.clientX - drag.x;
    if (!drag.moved && Math.hypot(dx, dy) < 4) return;
    drag.moved = true;
    const dm = Math.round(dy / PX / SNAP) * SNAP;
    const r = { ...routines[drag.index] };
    if (drag.mode === 'resize') {
      r.minutes = Math.max(SNAP, Math.min(longest(r.activity), drag.minutes + dm));
    } else {
      const colWidth = body.getBoundingClientRect().width / 7;
      r.start = Math.max(0, Math.min(DAY - SNAP, drag.start + dm));
      r.days = rotate(drag.days, Math.round(dx / colWidth));
    }
    if (r.start !== routines[drag.index].start || r.minutes !== routines[drag.index].minutes || r.days !== routines[drag.index].days) {
      onchange(routines.map((x, i) => (i === drag!.index ? r : x)));
    }
  }

  function up() {
    drag = null;
  }

  function onBodyDown(e: PointerEvent) {
    if (e.button !== 0 || readonly) return;
    const slot = at(e.clientX, e.clientY);
    if (!slot) return;
    if (tool) add(slot.day, slot.minute);
    else selected = null;
  }

  function onKey(e: KeyboardEvent, index: number) {
    if (readonly) return;
    const r = { ...routines[index] };
    if (e.key === 'Delete' || e.key === 'Backspace') {
      onchange(routines.filter((_, i) => i !== index));
      selected = null;
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      const d = e.key === 'ArrowUp' ? -SNAP : SNAP;
      if (e.shiftKey) r.minutes = Math.max(SNAP, Math.min(longest(r.activity), r.minutes + d));
      else r.start = Math.max(0, Math.min(DAY - SNAP, r.start + d));
      onchange(routines.map((x, i) => (i === index ? r : x)));
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      r.days = rotate(r.days, e.key === 'ArrowLeft' ? -1 : 1);
      onchange(routines.map((x, i) => (i === index ? r : x)));
    } else return;
    e.preventDefault();
  }

  /** How this week's block went (for a block starting on column `col`). */
  function runOf(id: number | undefined, household: boolean, col: number): BlockView | undefined {
    if (id === undefined) return undefined;
    return runs.findLast((b) => b.routine === id && b.household === household && b.day === weekStart + col);
  }
  const mark: Record<string, string> = { kept: '✓', cut: '½', skipped: '✕', noPlace: '⌂', active: '●' };

  const workSegments = $derived(
    work ? work.days.flatMap((d) => segments({ activity: '', days: 1 << d, start: work.start, minutes: work.minutes })) : [],
  );
  const hours = Array.from({ length: 24 }, (_, h) => h);
</script>

<svelte:window onpointermove={move} onpointerup={up} />

<div class="week" class:readonly>
  <div class="head">
    <span></span>
    {#each WEEKDAYS as d, i (d)}
      <span class="dayname" class:today={i === weekday(today)}>{d}</span>
    {/each}
  </div>
  <div class="scroller" bind:this={scroller}>
    <div class="grid" style="height:{24 * HOUR}px">
      <div class="hours">
        {#each hours as h (h)}<span style="top:{h * HOUR}px">{hhmm(h * 60, settings.clock24h)}</span>{/each}
      </div>
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="body" class:adding={!!tool} bind:this={body} onpointerdown={onBodyDown}>
        {#each hours as h (h)}<div class="line" style="top:{h * HOUR}px"></div>{/each}
        {#each [0, 1, 2, 3, 4, 5, 6] as c (c)}<div class="col" class:today={c === weekday(today)} style="left:{(c / 7) * 100}%"></div>{/each}

        {#each workSegments as s, i (i)}
          <div class="block work" style="left:calc({(s.day / 7) * 100}% + 2px);top:{s.from * PX}px;height:{(s.to - s.from) * PX}px">
            {#if s.head}<span class="name">{work?.label}</span>{/if}
          </div>
        {/each}

        {#each template as r (r.id)}
          {#each segments(r) as s, k (k)}
            {@const run = s.head ? runOf(r.id, true, s.day) : undefined}
            <div
              class="block shared"
              class:off={skipped.includes(r.id)}
              style="left:calc({(s.day / 7) * 100}% + 2px);top:{s.from * PX}px;height:{(s.to - s.from) * PX}px;--c:{activityColor(r.activity)}"
              title="Household: {activityLabel(r.activity, r.skill)} {hhmm(r.start, settings.clock24h)}, {duration(r.minutes)}{skipped.includes(r.id) ? ' (skipped)' : ''}"
            >
              {#if s.head}<span class="name">{activityLabel(r.activity, r.skill)}</span>{/if}
              {#if run}<span class="mark {run.status}" title="{STATUS_TEXT[run.status]}{run.reason ? `: ${reasonText(run.reason, '')}` : ''}">{mark[run.status]}</span>{/if}
            </div>
          {/each}
        {/each}

        {#each routines as r, i (i)}
          {#each segments(r) as s, k (k)}
            {@const run = s.head ? runOf((r as Routine).id, false, s.day) : undefined}
            <div
              class="block own"
              class:selected={selected === i}
              class:bad={bad.has(i)}
              style="left:calc({(s.day / 7) * 100}% + 2px);top:{s.from * PX}px;height:{(s.to - s.from) * PX}px;--c:{activityColor(r.activity)}"
              role="button"
              tabindex="0"
              aria-label="{activityLabel(r.activity, r.skill)}, {WEEKDAYS[s.startDay]} {hhmm(r.start, settings.clock24h)}, {duration(r.minutes)}"
              onpointerdown={(e) => down(e, i, 'move')}
              onkeydown={(e) => onKey(e, i)}
            >
              {#if s.head}
                <span class="name">{activityLabel(r.activity, r.skill)}</span>
                {#if r.minutes >= 90}<span class="time">{hhmm(r.start, settings.clock24h)}–{hhmm(r.start + r.minutes, settings.clock24h)}</span>{/if}
              {/if}
              {#if run}<span class="mark {run.status}" title="{STATUS_TEXT[run.status]}{run.reason ? `: ${reasonText(run.reason, '')}` : ''}">{mark[run.status]}</span>{/if}
              {#if !readonly && (s.head ? s.to === r.start + r.minutes || s.to < DAY : true) && (!s.head || r.start + r.minutes <= DAY)}
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <span class="handle" onpointerdown={(e) => down(e, i, 'resize')}></span>
              {/if}
            </div>
          {/each}
        {/each}
      </div>
    </div>
  </div>
</div>

<style>
  .week {
    display: flex;
    flex-direction: column;
    min-height: 0;
    border-radius: var(--radius-md);
    background: var(--surface);
    box-shadow: var(--shadow-sm);
    overflow: hidden;
  }
  .head {
    display: grid;
    grid-template-columns: 48px repeat(7, 1fr);
    padding: 8px 0 6px;
    border-bottom: 1px solid var(--hairline);
    font-size: 11px;
    font-weight: 650;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-muted);
  }
  .dayname {
    text-align: center;
  }
  .dayname.today {
    color: var(--accent);
  }
  .scroller {
    overflow-y: auto;
    max-height: min(58vh, 540px);
  }
  .grid {
    position: relative;
    display: grid;
    grid-template-columns: 48px 1fr;
  }
  .hours {
    position: relative;
  }
  .hours span {
    position: absolute;
    right: 8px;
    transform: translateY(-50%);
    font-size: 10px;
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
  }
  .hours span:first-child {
    transform: none;
  }
  .body {
    position: relative;
    touch-action: none;
  }
  .body.adding {
    cursor: copy;
  }
  .line {
    position: absolute;
    left: 0;
    right: 0;
    border-top: 1px solid var(--hairline);
  }
  .col {
    position: absolute;
    top: 0;
    bottom: 0;
    width: calc(100% / 7);
    border-left: 1px solid var(--hairline);
  }
  .col.today {
    background: var(--accent-soft);
  }
  .block {
    position: absolute;
    width: calc(100% / 7 - 4px);
    border-radius: 7px;
    padding: 3px 6px;
    overflow: hidden;
    font-size: 11px;
    line-height: 1.2;
    display: flex;
    flex-direction: column;
    user-select: none;
  }
  .block.own {
    background: color-mix(in srgb, var(--c) 82%, white);
    color: #fff;
    cursor: grab;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12);
    transition: box-shadow var(--fast) var(--ease);
    z-index: 2;
  }
  .block.own:active {
    cursor: grabbing;
  }
  .block.own.selected {
    box-shadow:
      0 0 0 2px var(--surface),
      0 0 0 4px var(--c),
      0 6px 16px rgba(0, 0, 0, 0.18);
    z-index: 3;
  }
  .block.own.bad {
    box-shadow:
      0 0 0 2px var(--surface),
      0 0 0 4px var(--bad);
  }
  .block.own:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  .block.shared {
    background: repeating-linear-gradient(135deg, color-mix(in srgb, var(--c) 35%, transparent) 0 5px, color-mix(in srgb, var(--c) 18%, transparent) 5px 10px);
    color: var(--text);
    border: 1px dashed color-mix(in srgb, var(--c) 70%, transparent);
    z-index: 1;
  }
  .block.shared.off {
    opacity: 0.35;
  }
  .block.work {
    background: repeating-linear-gradient(135deg, rgba(120, 128, 148, 0.22) 0 5px, rgba(120, 128, 148, 0.1) 5px 10px);
    color: var(--text-muted);
    border: 1px solid rgba(120, 128, 148, 0.3);
    z-index: 1;
  }
  .name {
    font-weight: 650;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .time {
    opacity: 0.9;
    font-variant-numeric: tabular-nums;
  }
  .mark {
    position: absolute;
    top: 3px;
    right: 4px;
    display: grid;
    place-items: center;
    width: 15px;
    height: 15px;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.92);
    color: var(--good);
    font-size: 10px;
    font-weight: 800;
  }
  .mark.cut {
    color: var(--warn);
  }
  .mark.skipped,
  .mark.noPlace {
    color: var(--bad);
  }
  .mark.active {
    color: var(--accent);
  }
  .handle {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    height: 7px;
    cursor: ns-resize;
  }
  .readonly .block.own {
    cursor: default;
  }
</style>
