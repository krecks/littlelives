<script module lang="ts">
  import type { Catalog, CareerEntry } from '../core/protocol';
  import type { Content } from '../content/content';
  import { services } from './services';

  /*
   * Display mirrors of the career rules in `sim-core/src/life.rs` (the simulation stays
   * the authority). Exported for CareerTab and SkillsTab.
   */

  export type Level = CareerEntry['levels'][number];
  /** ok = hired normally, probation = hired with a shortfall, no = too far off. */
  export type Standing = 'ok' | 'probation' | 'no';

  let indexFor: Content | null = null;
  let skillIndex = new Map<string, number>();

  /** Position of a skill in `SimView.skills` (content order). */
  export function skillSlot(id: string): number {
    if (indexFor !== services.content) {
      indexFor = services.content;
      skillIndex = new Map(services.content.skills.map((s, i) => [s.id, i]));
    }
    return skillIndex.get(id) ?? -1;
  }

  /** The Sim's whole level in a skill. */
  export function wholeLevel(skills: readonly number[], id: string): number {
    const i = skillSlot(id);
    return i < 0 ? 0 : Math.floor(skills[i] ?? 0);
  }

  /** Levels above (+) or below (-) the requirements; the weakest skill counts. */
  export function levelFit(skills: readonly number[], requires: readonly [string, number][]): number {
    let fit: number | null = null;
    for (const [id, need] of requires) {
      const f = wholeLevel(skills, id) - need;
      if (fit === null || f < fit) fit = f;
    }
    return fit ?? 0;
  }

  export function standing(fit: number, catalog: Catalog): Standing {
    return fit >= 0 ? 'ok' : fit >= -catalog.probationLevels ? 'probation' : 'no';
  }

  /** Tone of one requirement chip. */
  export function chipTone(have: number, need: number, catalog: Catalog): Standing {
    return standing(have - need, catalog);
  }

  /** The workweek rule with the highest `fit` not above the Sim's fit. */
  export function workweekRule(catalog: Catalog, fit: number): Catalog['workweek'][number] | null {
    let best: Catalog['workweek'][number] | null = null;
    for (const r of catalog.workweek) if (r.fit <= fit && (!best || r.fit >= best.fit)) best = r;
    return best;
  }

  /** Adds days after the last workday, or drops the latest workdays (at least one stays). */
  export function adjustDays(days: readonly number[], delta: number): number[] {
    const set = new Set(days);
    const last = () => Math.max(...set, 0);
    for (let n = 0; n < delta; n++) {
      const from = last();
      for (let k = 1; k < 7; k++) {
        const d = (from + k) % 7;
        if (!set.has(d)) {
          set.add(d);
          break;
        }
      }
    }
    for (let n = 0; n < -delta && set.size > 1; n++) set.delete(last());
    return [...set].sort((a, b) => a - b);
  }

  /** The requirement furthest from being met (only when not all are met). */
  export function weakest(skills: readonly number[], requires: readonly [string, number][]): [string, number] | null {
    let worst: [string, number] | null = null;
    let gap = 0;
    for (const [id, need] of requires) {
      const g = wholeLevel(skills, id) - need;
      if (g < gap) {
        gap = g;
        worst = [id, need];
      }
    }
    return worst;
  }

  export const payPerHour = (l: Level) => l.pay / l.hours;
  /** Weekly pay is fixed by the standard week, whatever the Sim's workweek. */
  export const weeklyPay = (l: Level) => l.pay * l.days.length;
</script>

<script lang="ts">
  import { clock, dayList, money } from './format';
  import Icon from './Icon.svelte';
  import { game } from './state.svelte';
  import { settings } from '../settings/settings.svelte';

  interface Row {
    career: number;
    level: number;
    category: string;
    track: string;
    def: Level;
    grade: string;
    /** Lowercased title, track and category for search. */
    text: string;
  }

  const SEARCH_CAP = 150;
  const catalog = $derived(game.catalog);
  const sim = $derived(game.selectedSim);
  const job = $derived(sim?.job ?? null);

  let query = $state('');
  let onlyEligible = $state(false);
  let grades = $state<string[]>([]);
  let picked = $state<string | null>(null);
  let searchEl = $state<HTMLInputElement>();

  /** Every position, flattened once per catalog. */
  const rows = $derived.by<Row[]>(() => {
    if (!catalog) return [];
    const out: Row[] = [];
    catalog.careers.forEach((c, ci) => {
      const cat = c.category ?? '';
      const catLabel = services.content.careerCategory(cat)?.label ?? cat;
      c.levels.forEach((l, li) =>
        out.push({
          career: ci,
          level: li,
          category: cat,
          track: c.label,
          def: l,
          grade: l.grade ?? String.fromCharCode(65 + li),
          text: `${l.title} ${c.label} ${catLabel}`.toLowerCase(),
        }),
      );
    });
    return out;
  });

  /** Whole skill levels as a string, so fits only recompute when a level changes. */
  const skillKey = $derived(sim ? sim.skills.map((s) => Math.floor(s)).join(',') : '');
  const wholeSkills = $derived(skillKey ? skillKey.split(',').map(Number) : []);
  const fits = $derived(rows.map((r) => levelFit(wholeSkills, r.def.requires)));

  const categories = $derived(catalog?.categories ?? []);
  const eligibleCount = $derived.by(() => {
    const counts = new Map<string, number>();
    if (!catalog) return counts;
    rows.forEach((r, i) => {
      if (fits[i] >= -catalog.probationLevels) counts.set(r.category, (counts.get(r.category) ?? 0) + 1);
    });
    return counts;
  });
  const totalEligible = $derived([...eligibleCount.values()].reduce((a, b) => a + b, 0));

  const category = $derived(picked ?? job?.category ?? categories[0] ?? '');
  const categoryDef = $derived(services.content.careerCategory(category));

  const visible = (i: number) =>
    (!onlyEligible || !catalog || fits[i] >= -catalog.probationLevels) && (grades.length === 0 || grades.includes(rows[i].grade));

  const tokens = $derived(query.trim().toLowerCase().split(/\s+/).filter(Boolean));
  const searching = $derived(tokens.length > 0);

  /** Row indices of the picked category, grouped by track. */
  const tracks = $derived.by(() => {
    if (searching || !catalog) return [];
    const groups: { career: number; label: string; rows: number[] }[] = [];
    rows.forEach((r, i) => {
      if (r.category !== category) return;
      let g = groups.find((x) => x.career === r.career);
      if (!g) groups.push((g = { career: r.career, label: r.track, rows: [] }));
      if (visible(i)) g.rows.push(i);
    });
    return groups;
  });

  /** Search hits grouped by category, capped. */
  const results = $derived.by(() => {
    if (!searching) return { groups: [], total: 0 };
    const groups = new Map<string, number[]>();
    let total = 0;
    rows.forEach((r, i) => {
      if (!tokens.every((t) => r.text.includes(t)) || !visible(i)) return;
      total++;
      if (total > SEARCH_CAP) return;
      const g = groups.get(r.category);
      if (g) g.push(i);
      else groups.set(r.category, [i]);
    });
    return { groups: [...groups], total };
  });

  function close() {
    game.jobBoardOpen = false;
    query = '';
    picked = null;
  }

  function join(r: Row) {
    services.controls.joinCareer(r.career, r.level);
    close();
  }

  function toggleGrade(g: string) {
    grades = grades.includes(g) ? grades.filter((x) => x !== g) : [...grades, g];
  }

  function onkeydown(e: KeyboardEvent) {
    if (!game.jobBoardOpen || e.key !== 'Escape') return;
    e.stopPropagation();
    if (e.target === searchEl && query) query = '';
    else close();
  }

  $effect(() => {
    if (game.jobBoardOpen) searchEl?.focus();
  });

  const shift = (l: Level) => `${clock(l.start * 60, settings.clock24h)}–${clock(((l.start + l.hours) % 24) * 60, settings.clock24h)}`;
  const skillLabel = (id: string) => services.content.skill(id)?.label ?? id;
</script>

<svelte:window onkeydowncapture={onkeydown} />

{#snippet row(i: number, showTrack: boolean)}
  {@const r = rows[i]}
  {@const l = r.def}
  {@const fit = fits[i]}
  {@const st = catalog ? standing(fit, catalog) : 'no'}
  {@const rule = catalog && st !== 'no' ? workweekRule(catalog, fit) : null}
  {@const current = job?.index === r.career && job?.level === r.level}
  {@const worst = st === 'no' ? weakest(wholeSkills, l.requires) : null}
  <li class="pos" class:current class:locked={st === 'no'}>
    <span class="grade" title={catalog?.grades.find((g) => g.id === r.grade)?.label}>{r.grade}</span>
    <div class="main">
      <div class="line">
        <b class="title">{l.title}</b>
        {#if showTrack}<span class="muted">· {r.track}</span>{/if}
        {#if current}<span class="pill accent">Current job</span>{/if}
      </div>
      <div class="line meta">
        <span class="tabular">{money(payPerHour(l))}/h · {money(weeklyPay(l))}/wk</span>
        <span class="tabular">{shift(l)} · {dayList(l.days)}</span>
        {#if rule && rule.days !== 0}
          <span class="pill" class:warn={rule.days > 0} class:good={rule.days < 0}>
            {rule.label} · {adjustDays(l.days, rule.days).length} days
          </span>
        {/if}
      </div>
      {#if l.requires.some(([, n]) => n > 0)}
        <div class="chips">
          {#each l.requires as [id, need] (id)}
            {#if need > 0}
              {@const have = wholeLevel(wholeSkills, id)}
              {@const tone = catalog ? chipTone(have, need, catalog) : 'no'}
              <span class="chip {tone}" title="{skillLabel(id)}: needs {need}, has {have}">
                <Icon name={services.content.skill(id)?.icon ?? ''} size={12} />{need}
              </span>
            {/if}
          {/each}
        </div>
      {/if}
    </div>
    {#if current}
      <span class="here">Working here</span>
    {:else if st === 'ok'}
      <button class="btn primary small" onclick={() => join(r)} aria-label="Join as {l.title}">Join</button>
    {:else if st === 'probation'}
      <button class="btn small probation" onclick={() => join(r)} aria-label="Join as {l.title} on probation">Join on probation</button>
    {:else}
      <button class="btn small" disabled>Needs {worst ? `${skillLabel(worst[0])} ${worst[1]}` : 'skills'}</button>
    {/if}
  </li>
{/snippet}

{#if game.jobBoardOpen}
  <div class="layer">
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <div class="scrim" onclick={close}></div>
    <div class="board" role="dialog" aria-modal="true" aria-label="Job board">
      <header>
        <div class="heading">
          <h2>Job board</h2>
          {#if sim && catalog}
            <span class="muted">{rows.length.toLocaleString()} positions · {sim.name} can take {totalEligible}</span>
          {/if}
        </div>
        <button class="close" aria-label="Close job board" onclick={close}><Icon name="icon.ui.close" size={16} /></button>
      </header>

      {#if !catalog || !sim}
        <p class="empty">Loading careers…</p>
      {:else}
        <div class="filters">
          <label class="search">
            <span class="sr">Search jobs</span>
            <input class="input" type="search" placeholder="Search titles, tracks, fields…" bind:value={query} bind:this={searchEl} />
          </label>
          <label class="only">
            <input type="checkbox" bind:checked={onlyEligible} />
            Only jobs I can take
          </label>
          <div class="grades" role="group" aria-label="Filter by grade">
            {#each catalog.grades as g (g.id)}
              <button class="gchip" class:on={grades.includes(g.id)} aria-pressed={grades.includes(g.id)} title="{g.label} · {money(g.payPerHour)}/h" onclick={() => toggleGrade(g.id)}>{g.id}</button>
            {/each}
            {#if grades.length}
              <button class="gclear" onclick={() => (grades = [])}>All</button>
            {/if}
          </div>
        </div>

        <div class="columns">
          <nav class="cats" aria-label="Career fields">
            {#each categories as id (id)}
              {@const def = services.content.careerCategory(id)}
              {@const n = eligibleCount.get(id) ?? 0}
              <button
                class="cat"
                class:active={!searching && id === category}
                class:mine={job?.category === id}
                aria-current={!searching && id === category ? 'true' : undefined}
                onclick={() => {
                  picked = id;
                  query = '';
                }}
              >
                <span class="cicon"><Icon name={def?.icon ?? 'icon.ui.career'} size={16} /></span>
                <span class="clabel">{def?.label ?? id}</span>
                <span class="count" class:zero={n === 0} title="{n} positions {sim.name} can take">{n}</span>
              </button>
            {/each}
          </nav>

          <div class="list">
            {#if searching}
              {#each results.groups as [cat, hits] (cat)}
                {@const def = services.content.careerCategory(cat)}
                <section>
                  <h3><Icon name={def?.icon ?? 'icon.ui.career'} size={15} />{def?.label ?? cat}</h3>
                  <ul>
                    {#each hits as i (i)}{@render row(i, true)}{/each}
                  </ul>
                </section>
              {:else}
                <p class="empty">No jobs match “{query.trim()}”{onlyEligible || grades.length ? ' with these filters' : ''}.</p>
              {/each}
              {#if results.total > SEARCH_CAP}
                <p class="hint">Showing {SEARCH_CAP} of {results.total} matches — refine your search.</p>
              {/if}
            {:else}
              <div class="intro">
                <span class="bigicon"><Icon name={categoryDef?.icon ?? 'icon.ui.career'} size={24} /></span>
                <div>
                  <h3 class="name">{categoryDef?.label ?? category}</h3>
                  <p class="muted">{categoryDef?.description ?? ''}</p>
                </div>
              </div>
              {#each tracks as t (t.career)}
                {@const skills = catalog.careers[t.career].skills}
                <section>
                  <h3>
                    {t.label}
                    <span class="tskills">
                      {#each skills as s (s)}
                        <span title={skillLabel(s)}><Icon name={services.content.skill(s)?.icon ?? ''} size={13} /></span>
                      {/each}
                    </span>
                  </h3>
                  <ul>
                    {#each t.rows as i (i)}{@render row(i, false)}{:else}<li class="none muted">No positions match the filters.</li>{/each}
                  </ul>
                </section>
              {/each}
            {/if}
          </div>
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .layer {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    z-index: 40;
    pointer-events: auto;
  }
  .scrim {
    position: absolute;
    inset: 0;
    background: var(--backdrop);
    backdrop-filter: blur(6px);
    -webkit-backdrop-filter: blur(6px);
    animation: fade var(--slow) var(--ease);
  }
  .board {
    position: relative;
    width: min(880px, calc(100% - 32px));
    height: min(680px, calc(100% - 48px));
    display: flex;
    flex-direction: column;
    border-radius: 24px;
    background: var(--glass-strong);
    border: 1px solid var(--glass-border);
    box-shadow: 0 30px 80px rgba(20, 24, 40, 0.3);
    backdrop-filter: blur(24px) saturate(1.4);
    -webkit-backdrop-filter: blur(24px) saturate(1.4);
    animation: rise var(--slow) var(--ease);
    overflow: hidden;
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 18px 20px 6px 24px;
  }
  .heading {
    display: flex;
    align-items: baseline;
    gap: 12px;
  }
  h2 {
    margin: 0;
    font-size: 20px;
    letter-spacing: -0.02em;
  }
  .close {
    display: grid;
    place-items: center;
    width: 34px;
    height: 34px;
    border-radius: 50%;
    color: var(--text-muted);
  }
  .close:hover {
    background: var(--hairline);
    color: var(--text);
  }
  .muted {
    color: var(--text-muted);
    font-size: 12px;
  }
  .sr {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
  }
  .filters {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 24px 12px;
    flex-wrap: wrap;
  }
  .search {
    flex: 1;
    min-width: 220px;
  }
  .search .input {
    width: 100%;
    height: 36px;
  }
  .only {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
    font-weight: 550;
    cursor: pointer;
  }
  .only input {
    accent-color: var(--accent);
    width: 15px;
    height: 15px;
  }
  .grades {
    display: flex;
    gap: 3px;
    align-items: center;
  }
  .gchip,
  .gclear {
    min-width: 24px;
    height: 26px;
    padding: 0 6px;
    border-radius: 8px;
    font-size: 12px;
    font-weight: 650;
    color: var(--text-muted);
    background: var(--hairline);
    transition: background var(--fast) var(--ease), color var(--fast) var(--ease);
  }
  .gchip:hover,
  .gclear:hover {
    color: var(--text);
  }
  .gchip.on {
    background: var(--accent);
    color: var(--text-inverse);
  }
  .gclear {
    background: transparent;
  }
  .columns {
    flex: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: 220px 1fr;
    border-top: 1px solid var(--hairline);
  }
  .cats {
    overflow: auto;
    padding: 10px 8px 14px 14px;
    display: flex;
    flex-direction: column;
    gap: 2px;
    border-right: 1px solid var(--hairline);
  }
  .cat {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 8px;
    border-radius: var(--radius-sm);
    text-align: left;
    font-size: 13px;
    font-weight: 550;
    transition: background var(--fast) var(--ease);
  }
  .cat:hover {
    background: var(--hairline);
  }
  .cat.active {
    background: var(--accent-soft);
    color: var(--accent);
  }
  .cicon {
    display: grid;
    place-items: center;
    width: 26px;
    height: 26px;
    flex: none;
    border-radius: 8px;
    background: var(--surface);
    box-shadow: var(--shadow-sm);
  }
  .cat.mine .cicon {
    box-shadow: 0 0 0 2px var(--accent);
  }
  .clabel {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .count {
    min-width: 22px;
    padding: 1px 6px;
    border-radius: var(--radius-pill);
    background: rgba(79, 191, 133, 0.16);
    color: #2f8a5c;
    font-size: 11px;
    font-weight: 700;
    text-align: center;
    font-variant-numeric: tabular-nums;
  }
  .count.zero {
    background: var(--hairline);
    color: var(--text-muted);
  }
  .list {
    overflow: auto;
    padding: 12px 20px 20px;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .intro {
    display: flex;
    gap: 12px;
    align-items: center;
  }
  .bigicon {
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    flex: none;
    border-radius: var(--radius-md);
    background: var(--accent-soft);
    color: var(--accent);
  }
  .intro p {
    margin: 2px 0 0;
    font-size: 13px;
  }
  h3 {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 0 0 6px;
    font-size: 13px;
    font-weight: 700;
    letter-spacing: -0.01em;
  }
  h3.name {
    font-size: 17px;
    margin: 0;
  }
  .tskills {
    display: inline-flex;
    gap: 4px;
    color: var(--text-muted);
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .pos {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 7px 10px;
    border-radius: var(--radius-sm);
    background: var(--hairline);
    border: 1px solid transparent;
  }
  .pos.current {
    background: var(--accent-soft);
    border-color: var(--accent);
  }
  .pos.locked .title {
    color: var(--text-muted);
  }
  .grade {
    display: grid;
    place-items: center;
    width: 26px;
    height: 26px;
    flex: none;
    border-radius: 8px;
    background: var(--surface);
    box-shadow: var(--shadow-sm);
    font-weight: 750;
    font-size: 12px;
  }
  .main {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .line {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    flex-wrap: wrap;
  }
  .title {
    font-size: 13px;
    font-weight: 650;
  }
  .meta {
    gap: 10px;
    color: var(--text-muted);
    font-size: 11.5px;
  }
  .pill {
    padding: 1px 7px;
    border-radius: var(--radius-pill);
    background: var(--hairline);
    font-size: 10.5px;
    font-weight: 650;
    color: var(--text-muted);
  }
  .pill.accent {
    background: var(--accent);
    color: var(--text-inverse);
  }
  .pill.warn {
    background: rgba(240, 181, 74, 0.2);
    color: #a06d0e;
  }
  .pill.good {
    background: rgba(79, 191, 133, 0.18);
    color: #2f8a5c;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-top: 2px;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    padding: 1px 7px 1px 5px;
    border-radius: var(--radius-pill);
    font-size: 11px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }
  .chip.ok {
    background: rgba(79, 191, 133, 0.18);
    color: #2f8a5c;
  }
  .chip.probation {
    background: rgba(240, 181, 74, 0.22);
    color: #a06d0e;
  }
  .chip.no {
    background: rgba(236, 106, 92, 0.16);
    color: #c2483b;
  }
  .small {
    height: 30px;
    padding: 0 12px;
    font-size: 12px;
    flex: none;
    white-space: nowrap;
  }
  .probation {
    background: rgba(240, 181, 74, 0.22);
    border-color: transparent;
    color: #8a5c08;
  }
  .here {
    font-size: 12px;
    font-weight: 650;
    color: var(--accent);
    padding: 0 6px;
  }
  .none {
    padding: 6px 2px;
  }
  .empty,
  .hint {
    margin: 0;
    color: var(--text-muted);
    font-size: 13px;
  }
  .empty {
    padding: 24px;
    text-align: center;
  }
  .hint {
    text-align: center;
    padding: 4px 0 8px;
  }
  @keyframes fade {
    from {
      opacity: 0;
    }
  }
  @keyframes rise {
    from {
      opacity: 0;
      transform: translateY(12px) scale(0.98);
    }
  }
</style>
