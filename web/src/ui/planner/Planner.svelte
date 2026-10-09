<script lang="ts">
  import type { RoutineIn } from '../../core/protocol';
  import { settings } from '../../settings/settings.svelte';
  import Icon from '../Icon.svelte';
  import { WEEKDAYS } from '../format';
  import Modal from '../kit/Modal.svelte';
  import SimPreview from '../kit/SimPreview.svelte';
  import { services } from '../services';
  import { game } from '../state.svelte';
  import GoalsPanel from './GoalsPanel.svelte';
  import { activityColor, activityLabel, conflicts, DAY, duration, hhmm, SNAP } from './planner';
  import WeekGrid from './WeekGrid.svelte';

  /**
   * The planner: each resident's week (routine blocks they're strongly nudged toward) and life
   * goals, plus the household's template that everyone follows. Edits apply as you make them.
   */
  const content = services.content;
  const residents = $derived(game.sims.filter((s) => game.households[s.household]?.player));
  const who = $derived(game.plannerFor);
  const sim = $derived(who === 'household' ? null : (residents.find((s) => s.id === who) ?? null));
  const info = (id: number) => game.roster.find((r) => r.id === id);

  /** What the sim has; local edits show at once and are sent shortly after. */
  const incoming = $derived<RoutineIn[]>(sim ? (sim.plan?.routines ?? []) : game.householdRoutines);
  let local = $state<RoutineIn[] | null>(null);
  const routines = $derived(local ?? incoming);
  let selected = $state<number | null>(null);
  let sendTimer: ReturnType<typeof setTimeout> | undefined;
  let syncTimer: ReturnType<typeof setTimeout> | undefined;

  function change(list: RoutineIn[]) {
    local = list;
    clearTimeout(sendTimer);
    clearTimeout(syncTimer);
    sendTimer = setTimeout(send, 300);
  }

  function send() {
    if (!local) return;
    // Overlapping blocks aren't sent until they're sorted out (they stay outlined).
    if (conflicts(local).size === 0) services.controls.setRoutines(sim ? sim.id : null, $state.snapshot(local));
    syncTimer = setTimeout(() => {
      if (conflicts(local ?? []).size === 0) local = null;
    }, 400);
  }

  function pick(target: number | 'household') {
    send();
    local = null;
    selected = null;
    game.plannerFor = target;
  }

  function close() {
    clearTimeout(sendTimer);
    send();
    game.plannerOpen = false;
  }

  // The palette: what a click on the grid adds (and what dragging a chip drops).
  let tool = $state<{ activity: string; skill?: string | null } | null>(null);
  let trainSkill = $state(content.skills[0]?.id ?? '');
  let grid: WeekGrid | undefined = $state();
  let dragging = $state<{ activity: string; skill?: string | null; x: number; y: number } | null>(null);

  function chipDown(e: PointerEvent, activity: string) {
    const a = content.activity(activity);
    const t = { activity, skill: a?.skill ? trainSkill : null };
    tool = tool?.activity === activity ? null : t;
    dragging = { ...t, x: e.clientX, y: e.clientY };
  }
  function windowMove(e: PointerEvent) {
    if (dragging) dragging = { ...dragging, x: e.clientX, y: e.clientY };
  }
  function windowUp(e: PointerEvent) {
    if (!dragging) return;
    const slot = grid?.at(e.clientX, e.clientY);
    if (slot) grid?.add(slot.day, slot.minute, dragging.activity, dragging.skill);
    dragging = null;
  }

  // The selected block's editor.
  const block = $derived(selected !== null ? routines[selected] : undefined);
  function edit(patch: Partial<RoutineIn>) {
    if (selected === null || !block) return;
    const next = { ...block, ...patch };
    if (!content.activity(next.activity)?.skill) delete next.skill;
    else next.skill ??= trainSkill;
    change(routines.map((r, i) => (i === selected ? next : r)));
  }
  function remove() {
    if (selected === null) return;
    change(routines.filter((_, i) => i !== selected));
    selected = null;
  }
  const toggleDay = (d: number) => block && edit({ days: block.days ^ (1 << d) || block.days });
  const startText = $derived(block ? hhmm(block.start) : '');

  // Presets: a whole week in one go.
  const presets: { id: string; label: string; blocks: RoutineIn[] }[] = [
    { id: 'early', label: 'Early bird', blocks: [
      { activity: 'sleep', days: 0x7f, start: 22 * 60, minutes: 8 * 60 },
      { activity: 'workout', days: 0x1f, start: 6 * 60 + 30, minutes: 45 },
      { activity: 'read', days: 0x7f, start: 20 * 60, minutes: 60 },
    ] },
    { id: 'owl', label: 'Night owl', blocks: [
      { activity: 'sleep', days: 0x7f, start: 60, minutes: 9 * 60 },
      { activity: 'fun', days: 0x7f, start: 22 * 60, minutes: 120 },
    ] },
    { id: 'fit', label: 'Fitness', blocks: [
      { activity: 'workout', days: 0x15, start: 7 * 60, minutes: 60 },
      { activity: 'train', skill: 'endurance', days: 0x2a, start: 18 * 60, minutes: 60 },
      { activity: 'eat', days: 0x7f, start: 19 * 60 + 15, minutes: 45 },
    ] },
    { id: 'home', label: 'Homebody', blocks: [
      { activity: 'cook', days: 0x7f, start: 18 * 60, minutes: 60 },
      { activity: 'relax', days: 0x7f, start: 20 * 60, minutes: 120 },
      { activity: 'garden', days: 0x60, start: 10 * 60, minutes: 90 },
    ] },
  ];
  let preset = $state('');
  $effect(() => {
    if (!preset) return;
    const p = presets.find((x) => x.id === preset);
    preset = '';
    const usable = p?.blocks.filter((b) => content.activity(b.activity) && (!b.skill || content.skill(b.skill)));
    if (usable && (routines.length === 0 || confirm(`Replace this week with "${p!.label}"?`))) {
      selected = null;
      change(usable);
    }
  });

  const work = $derived(
    sim?.job ? { days: sim.job.days, start: Math.round(sim.job.startHour * 60), minutes: Math.round(sim.job.hours * 60), label: sim.job.title } : null,
  );
  const runs = $derived(sim ? [...(sim.plan?.history ?? []), ...(sim.plan?.current ? [sim.plan.current] : [])] : []);
  const bad = $derived(conflicts(routines).size > 0);
</script>

<svelte:window onpointermove={windowMove} onpointerup={windowUp} />

<Modal title="Planner" onclose={close} width={1180}>
  <div class="planner">
    <nav class="who" aria-label="Whose plan">
      <button class:active={who === 'household'} onclick={() => pick('household')}>
        <span class="hh"><Icon name="icon.ui.home" size={16} /></span>Everyone
      </button>
      {#each residents as r (r.id)}
        {@const look = info(r.id)}
        <button class:active={who === r.id} onclick={() => pick(r.id)}>
          <span class="face">{#if look}<SimPreview appearance={look.appearance} gender={look.gender} id={look.id} size={26} />{/if}</span>{r.name}
        </button>
      {/each}
    </nav>

    <div class="main">
      <div class="left">
        <div class="palette" role="toolbar" aria-label="Activities">
          {#each content.activities as a (a.id)}
            <button
              class="chip"
              class:active={tool?.activity === a.id}
              style="--c:{activityColor(a.id)}"
              title="Click to pick, then click the calendar (or drag it there)"
              onpointerdown={(e) => chipDown(e, a.id)}
            >
              <Icon name={a.icon} size={13} />{a.label}
            </button>
          {/each}
          {#if tool && content.activity(tool.activity)?.skill}
            <select
              bind:value={trainSkill}
              aria-label="Skill to train"
              onchange={() => tool && (tool = { ...tool, skill: trainSkill })}
            >
              {#each content.skills as s (s.id)}<option value={s.id}>{s.label}</option>{/each}
            </select>
          {/if}
          <select class="presets" bind:value={preset} aria-label="Presets">
            <option value="">Presets…</option>
            {#each presets as p (p.id)}<option value={p.id}>{p.label}</option>{/each}
          </select>
        </div>

        <WeekGrid
          bind:this={grid}
          {routines}
          onchange={change}
          bind:selected
          {tool}
          template={sim ? game.householdRoutines : []}
          skipped={sim?.plan?.skipHousehold ?? []}
          {work}
          {runs}
          today={game.day}
        />
        <p class="hint" class:warn={bad}>
          {#if bad}
            Two blocks overlap (outlined red): move or shorten one. Nothing is saved until they don't.
          {:else if who === 'household'}
            Everyone in the household follows these blocks unless they have their own at that time, or skip one in their week.
          {:else}
            Plans are a strong nudge: urgent needs come first, and how well {sim?.name} sticks to them depends on their traits and mood. Hatched blocks
            are the household's; grey stripes are work.
          {/if}
        </p>
      </div>

      <aside class="side">
        {#if block}
          {@const a = content.activity(block.activity)}
          <section class="editor" style="--c:{activityColor(block.activity)}">
            <header>
              <span class="swatch"></span><b>{activityLabel(block.activity, block.skill)}</b>
              <button class="btn small danger" onclick={remove}><Icon name="icon.ui.trash" size={13} />Remove</button>
            </header>
            <label>
              <span>Activity</span>
              <select value={block.activity} onchange={(e) => edit({ activity: e.currentTarget.value })}>
                {#each content.activities as x (x.id)}<option value={x.id}>{x.label}</option>{/each}
              </select>
            </label>
            {#if a?.skill}
              <label>
                <span>Skill</span>
                <select value={block.skill ?? ''} onchange={(e) => edit({ skill: e.currentTarget.value })}>
                  {#each content.skills as s (s.id)}<option value={s.id}>{s.label}</option>{/each}
                </select>
              </label>
            {/if}
            <div class="days" role="group" aria-label="Days">
              {#each WEEKDAYS as d, i (d)}
                <button class:on={block.days & (1 << i)} aria-pressed={!!(block.days & (1 << i))} onclick={() => toggleDay(i)}>{d}</button>
              {/each}
              <button class="all" onclick={() => edit({ days: 0x7f })}>Every day</button>
            </div>
            <label>
              <span>Starts</span>
              <input
                type="time"
                step={SNAP * 60}
                value={startText}
                onchange={(e) => {
                  const [h, m] = e.currentTarget.value.split(':').map(Number);
                  if (Number.isFinite(h)) edit({ start: Math.round((h * 60 + (m || 0)) / SNAP) * SNAP % DAY });
                }}
              />
            </label>
            <label>
              <span>For {duration(block.minutes)}</span>
              <input
                type="range"
                min={SNAP}
                max={a?.sleep ? content.planner.maxSleepMinutes : content.planner.maxMinutes}
                step={SNAP}
                value={block.minutes}
                oninput={(e) => edit({ minutes: Number(e.currentTarget.value) })}
              />
            </label>
            <p class="muted">{hhmm(block.start, settings.clock24h)}–{hhmm(block.start + block.minutes, settings.clock24h)}</p>
          </section>
        {:else if sim && game.householdRoutines.length}
          <section class="template">
            <h3>Household blocks</h3>
            {#each game.householdRoutines as r (r.id)}
              {@const off = sim.plan?.skipHousehold.includes(r.id)}
              <label class="row">
                <input type="checkbox" checked={!off} onchange={() => services.controls.skipHouseholdRoutine(sim.id, r.id, !off)} />
                {activityLabel(r.activity, r.skill)} · {hhmm(r.start, settings.clock24h)}
              </label>
            {/each}
          </section>
        {/if}

        {#if sim}
          <GoalsPanel {sim} />
        {:else}
          <section class="about">
            <h3>Everyone's week</h3>
            <p>Blocks here apply to every member of the household. Each resident can skip a household block from their own week.</p>
          </section>
        {/if}
      </aside>
    </div>
  </div>
</Modal>

{#if dragging && !grid?.at(dragging.x, dragging.y)}
  <div class="drag-chip" style="left:{dragging.x}px;top:{dragging.y}px;--c:{activityColor(dragging.activity)}">{activityLabel(dragging.activity, dragging.skill)}</div>
{/if}

<style>
  .planner {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .who {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }
  .who button {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    height: 36px;
    padding: 0 12px 0 5px;
    border-radius: var(--radius-pill);
    background: var(--hairline);
    font-weight: 600;
    font-size: 13px;
  }
  .who button.active {
    background: var(--surface);
    color: var(--accent);
    box-shadow: var(--shadow-sm);
  }
  .face,
  .hh {
    display: grid;
    place-items: center;
    width: 26px;
    height: 26px;
    border-radius: 50%;
    overflow: hidden;
    background: var(--surface-muted);
  }
  .main {
    display: grid;
    grid-template-columns: 1fr 320px;
    gap: 16px;
    min-height: 0;
  }
  .left {
    display: flex;
    flex-direction: column;
    gap: 10px;
    min-width: 0;
  }
  .palette {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    align-items: center;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    height: 28px;
    padding: 0 10px;
    border-radius: var(--radius-pill);
    background: color-mix(in srgb, var(--c) 16%, transparent);
    color: color-mix(in srgb, var(--c) 70%, black);
    font-size: 12px;
    font-weight: 650;
    cursor: grab;
    touch-action: none;
    user-select: none;
  }
  .chip.active {
    background: var(--c);
    color: #fff;
  }
  select,
  input[type='time'] {
    height: 30px;
    padding: 0 8px;
    border-radius: var(--radius-sm);
    border: 1px solid var(--hairline);
    background: var(--surface);
    font: inherit;
    font-size: 12.5px;
  }
  .presets {
    margin-left: auto;
  }
  .hint {
    margin: 0;
    font-size: 12px;
    color: var(--text-muted);
  }
  .hint.warn {
    color: var(--bad);
    font-weight: 600;
  }
  .side {
    display: flex;
    flex-direction: column;
    gap: 14px;
    max-height: min(68vh, 640px);
    overflow-y: auto;
    padding-right: 4px;
  }
  .editor {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 12px;
    border-radius: var(--radius-md);
    background: var(--surface);
    box-shadow: var(--shadow-sm);
    border-top: 4px solid var(--c);
  }
  .editor header {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .editor header b {
    flex: 1;
  }
  .swatch {
    width: 12px;
    height: 12px;
    border-radius: 4px;
    background: var(--c);
  }
  .editor label {
    display: grid;
    grid-template-columns: 90px 1fr;
    align-items: center;
    gap: 8px;
    font-size: 12.5px;
  }
  .days {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .days button {
    height: 26px;
    padding: 0 8px;
    border-radius: 8px;
    background: var(--hairline);
    font-size: 11.5px;
    font-weight: 650;
  }
  .days button.on {
    background: var(--c);
    color: #fff;
  }
  .days .all {
    margin-left: auto;
    background: none;
    color: var(--accent);
  }
  .muted {
    margin: 0;
    color: var(--text-muted);
    font-size: 12px;
  }
  h3 {
    margin: 0 0 6px;
    font-size: 11px;
    font-weight: 650;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-muted);
  }
  .template .row {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12.5px;
    padding: 3px 0;
  }
  .about p {
    margin: 0;
    font-size: 12.5px;
    color: var(--text-muted);
  }
  .drag-chip {
    position: fixed;
    z-index: 100;
    transform: translate(-50%, -50%);
    padding: 4px 10px;
    border-radius: var(--radius-pill);
    background: var(--c);
    color: #fff;
    font-size: 12px;
    font-weight: 650;
    pointer-events: none;
    box-shadow: var(--shadow-md);
  }
</style>
