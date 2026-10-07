<script lang="ts">
  import type { SimView } from '../core/protocol';
  import { clock } from './format';
  import Icon from './Icon.svelte';
  import { services } from './services';
  import { settings } from '../settings/settings.svelte';

  let { sim }: { sim: SimView } = $props();
  const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const careers = services.content.careers;
  let browsing = $state(false);
  const job = $derived(sim.job);
  const icon = (id: string) => careers.find((c) => c.id === id)?.icon ?? 'icon.ui.career';
  const days = (d: number[]) => (d.length === 7 ? 'Every day' : d.map((x) => WEEKDAYS[x]).join(' '));
</script>

{#if job && !browsing}
  <div class="job">
    <div class="head">
      <span class="badge"><Icon name={icon(job.career)} size={18} /></span>
      <div>
        <b>{job.title}</b>
        <span class="muted">{job.careerLabel} · level {job.level + 1} of {job.levels}</span>
      </div>
    </div>
    <dl>
      <dt>Hours</dt>
      <dd>{clock(job.startHour * 60, settings.clock24h)}–{clock((job.startHour + job.hours) * 60, settings.clock24h)}</dd>
      <dt>Days</dt>
      <dd>{days(job.days)}</dd>
      <dt>Pay</dt>
      <dd>§{job.pay} per shift</dd>
    </dl>
    <div class="perf">
      <span class="muted">Performance{job.nextTitle ? ` · next: ${job.nextTitle}` : ''}</span>
      <span class="track"><span style="width:{job.performance}%"></span></span>
    </div>
    {#if sim.awayUntil !== null}
      <p class="muted">At work until {clock(sim.awayUntil, settings.clock24h)}.</p>
    {/if}
    <div class="row">
      <button class="btn ghost" onclick={() => (browsing = true)}>Change career</button>
      <button class="btn ghost danger" onclick={() => services.controls.quitCareer()}>Quit</button>
    </div>
  </div>
{:else}
  <ul class="careers">
    {#each careers as c, i (c.id)}
      {@const first = c.levels[0]}
      <li>
        <span class="badge"><Icon name={c.icon} size={16} /></span>
        <div class="info">
          <b>{c.label}</b>
          <span class="muted">{first.title} · §{first.pay}/shift · {clock(first.start * 60, settings.clock24h)}, {first.hours} h</span>
        </div>
        <button
          class="btn primary small"
          onclick={() => {
            services.controls.joinCareer(i);
            browsing = false;
          }}>Join</button
        >
      </li>
    {/each}
    {#if job}
      <li><button class="btn ghost" onclick={() => (browsing = false)}>Keep current job</button></li>
    {/if}
  </ul>
{/if}

<style>
  .job,
  .careers {
    display: flex;
    flex-direction: column;
    gap: 10px;
    max-height: 230px;
    overflow: auto;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .head {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .head > div,
  .info {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-width: 0;
  }
  .badge {
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    flex: none;
    border-radius: 10px;
    background: var(--accent-soft);
    color: var(--accent);
  }
  .muted {
    color: var(--text-muted);
    font-size: 12px;
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
  .perf {
    display: flex;
    flex-direction: column;
    gap: 4px;
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
  p {
    margin: 0;
  }
  .row {
    display: flex;
    gap: 6px;
  }
  .careers li {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .small {
    height: 30px;
    padding: 0 12px;
    font-size: 12px;
  }
</style>
