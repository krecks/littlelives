<script lang="ts">
  import type { Requirement, SimView } from '../core/protocol';
  import { clock, dayList, money } from './format';
  import Icon from './Icon.svelte';
  import { levelFit, payPerHour, skillSlot, weeklyPay, type Level } from './JobBoard.svelte';
  import { services } from './services';
  import { game } from './state.svelte';
  import { settings } from '../settings/settings.svelte';

  let { sim }: { sim: SimView } = $props();
  const job = $derived(sim.job);
  const catalog = $derived(game.catalog);
  const category = $derived(services.content.careerCategory(job?.category));
  const time = (hour: number) => clock((hour % 24) * 60, settings.clock24h);
  const skill = (id: string) => services.content.skill(id);
  const nextReady = $derived(job?.next ? job.next.requires.every((r) => r.have >= r.level) : false);

  /** Whole skill levels as a string, so suggestions only recompute when a level changes. */
  const skillKey = $derived(sim.skills.map((s) => Math.floor(s)).join(','));

  /**
   * Up to three starting points from different fields: per track, the highest grade the Sim
   * can take without probation, ranked by how well the track uses the Sim's best skills.
   */
  const suggestions = $derived.by(() => {
    if (!catalog || job) return [];
    const skills = skillKey.split(',').map(Number);
    const raw = sim.skills;
    const picks: { career: number; level: number; def: Level; category: string; score: number }[] = [];
    catalog.careers.forEach((c, ci) => {
      let level = -1;
      for (let li = c.levels.length - 1; li >= 0; li--) {
        if (levelFit(skills, c.levels[li].requires) >= 0) {
          level = li;
          break;
        }
      }
      if (level < 0) return;
      // Weight each skill by what the top grade asks of it.
      const top = c.levels[c.levels.length - 1].requires;
      const weight = top.reduce((sum, [, n]) => sum + n, 0) || 1;
      const score = top.reduce((sum, [id, n]) => sum + (raw[skillSlot(id)] ?? 0) * n, 0) / weight + level;
      picks.push({ career: ci, level, def: c.levels[level], category: c.category ?? '', score });
    });
    picks.sort((a, b) => b.score - a.score || payPerHour(b.def) - payPerHour(a.def));
    const seen = new Set<string>();
    return picks.filter((p) => !seen.has(p.category) && seen.add(p.category)).slice(0, 3);
  });

  const positions = $derived(catalog?.careers.reduce((n, c) => n + c.levels.length, 0) ?? 0);
  const openBoard = () => (game.jobBoardOpen = true);
</script>

{#snippet chips(reqs: Requirement[])}
  <span class="chips">
    {#each reqs as r (r.skill)}
      {#if r.level > 0}
        {@const met = r.have >= r.level}
        <span class="chip" class:met title="{skill(r.skill)?.label ?? r.skill}: {r.have} of {r.level}">
          <Icon name={skill(r.skill)?.icon ?? ''} size={11} />{met ? r.level : `${r.have}/${r.level}`}
        </span>
      {/if}
    {/each}
  </span>
{/snippet}

{#if !catalog}
  <p class="muted">Loading careers…</p>
{:else if job}
  <div class="job">
    <div class="head">
      <span class="badge"><Icon name={category?.icon ?? 'icon.ui.career'} size={18} /></span>
      <div class="titles">
        <b>{job.title}</b>
        {#if job.grade}<span class="sub">Grade {job.grade}{job.gradeLabel ? ` · ${job.gradeLabel}` : ''}</span>{/if}
        <span class="muted">{job.careerLabel}{category ? ` · ${category.label}` : ''}</span>
      </div>
    </div>

    <dl>
      <dt>Hours</dt>
      <dd class="tabular">{time(job.startHour)}–{time(job.startHour + job.hours)}</dd>
      <dt>Days</dt>
      <dd>
        {dayList(job.days)}
        {#if job.workweek}
          <span class="pill" class:warn={job.days.length > job.standardDays.length} class:good={job.days.length < job.standardDays.length}>
            {job.workweek} · {job.days.length} {job.days.length === 1 ? 'day' : 'days'}
          </span>
        {/if}
      </dd>
      <dt>Pay</dt>
      <dd class="tabular">{money(job.pay)}/shift <span class="muted">· {money(job.payPerHour)}/h · {money(job.weeklyPay)}/wk</span></dd>
    </dl>

    <div class="perf">
      <span class="muted row-between"><span>Performance</span><span class="tabular">{Math.round(job.performance)}%</span></span>
      <span class="track" role="progressbar" aria-label="Performance" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(job.performance)}>
        <span style="width:{Math.min(100, job.performance)}%"></span>
      </span>
    </div>

    {#if job.next}
      <div class="next">
        <span>Next: <b>{job.next.title}</b>{job.next.grade ? ` (grade ${job.next.grade})` : ''}</span>
        {@render chips(job.next.requires)}
        <span class="muted">{nextReady ? 'Skills ready — fill the bar to be promoted.' : 'Needs the skills shown and a full bar.'}</span>
      </div>
    {:else}
      <span class="muted">Top of the field.</span>
    {/if}

    {#if sim.awayUntil !== null}
      <p class="away">At work until {clock(sim.awayUntil, settings.clock24h)}</p>
    {/if}

    <div class="row">
      <button class="btn small" onclick={openBoard}>Find a job</button>
      <button class="btn ghost danger small" onclick={() => services.controls.quitCareer()}>Quit</button>
    </div>
  </div>
{:else}
  <div class="job">
    <p class="pitch">{sim.name} is between jobs. Pick from {positions.toLocaleString()} positions in {catalog.categories.length} fields — skills unlock better grades and shorter weeks.</p>
    <button class="btn primary small" onclick={openBoard}>Browse {positions.toLocaleString()} jobs</button>
    {#if suggestions.length}
      <span class="eyebrow">Good fits</span>
      <ul class="suggest">
        {#each suggestions as s (s.career)}
          {@const cat = services.content.careerCategory(s.category)}
          <li>
            <span class="badge sm"><Icon name={cat?.icon ?? 'icon.ui.career'} size={15} /></span>
            <div class="titles">
              <b>{s.def.title}</b>
              <span class="muted">{catalog.careers[s.career].label} · {money(payPerHour(s.def))}/h · {money(weeklyPay(s.def))}/wk</span>
            </div>
            <button class="btn primary mini" aria-label="Join as {s.def.title}" onclick={() => services.controls.joinCareer(s.career, s.level)}>Join</button>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
{/if}

<style>
  .job {
    display: flex;
    flex-direction: column;
    gap: 9px;
    max-height: 250px;
    overflow: auto;
  }
  .head {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .titles {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-width: 0;
  }
  .titles b {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .sub {
    font-size: 12px;
    font-weight: 600;
    color: var(--accent);
  }
  .badge {
    display: grid;
    place-items: center;
    width: 34px;
    height: 34px;
    flex: none;
    border-radius: 10px;
    background: var(--accent-soft);
    color: var(--accent);
  }
  .badge.sm {
    width: 28px;
    height: 28px;
    border-radius: 8px;
  }
  .muted {
    color: var(--text-muted);
    font-size: 12px;
    font-weight: 500;
  }
  dl {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 4px 12px;
    margin: 0;
    font-size: 13px;
  }
  dt {
    color: var(--text-muted);
  }
  dd {
    margin: 0;
    font-weight: 600;
  }
  .pill {
    display: inline-block;
    margin-left: 4px;
    padding: 1px 7px;
    border-radius: var(--radius-pill);
    background: var(--hairline);
    color: var(--text-muted);
    font-size: 10.5px;
    font-weight: 650;
  }
  .pill.warn {
    background: rgba(240, 181, 74, 0.2);
    color: #a06d0e;
  }
  .pill.good {
    background: rgba(79, 191, 133, 0.18);
    color: #2f8a5c;
  }
  .perf {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .row-between {
    display: flex;
    justify-content: space-between;
  }
  .track {
    height: 6px;
    border-radius: var(--radius-pill);
    background: var(--hairline);
    overflow: hidden;
  }
  .track span {
    display: block;
    height: 100%;
    background: var(--good);
    transition: width var(--slow) var(--ease);
  }
  .next {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 13px;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    padding: 1px 7px 1px 5px;
    border-radius: var(--radius-pill);
    background: rgba(236, 106, 92, 0.16);
    color: #c2483b;
    font-size: 11px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }
  .chip.met {
    background: rgba(79, 191, 133, 0.18);
    color: #2f8a5c;
  }
  p {
    margin: 0;
  }
  .away {
    font-size: 12px;
    font-weight: 600;
    color: var(--accent);
  }
  .pitch {
    font-size: 13px;
    color: var(--text-muted);
  }
  .row {
    display: flex;
    gap: 6px;
  }
  .small {
    height: 32px;
    padding: 0 14px;
    font-size: 12px;
  }
  .mini {
    height: 26px;
    padding: 0 10px;
    font-size: 12px;
    flex: none;
  }
  .suggest {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .suggest li {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .suggest b {
    font-size: 13px;
  }
  .suggest .muted {
    font-size: 11px;
  }
</style>
