<script lang="ts">
  import type { SimView } from '../../core/protocol';
  import { settings } from '../../settings/settings.svelte';
  import { services } from '../services';
  import { game } from '../state.svelte';
  import { dayBlocks, DAY, hhmm, reasonText, STATUS_TEXT } from './planner';

  /** One resident's day on a thin bar: planned blocks (and how they went), work, and now. */
  let { sim, height = 6, labels = false }: { sim: SimView; height?: number; labels?: boolean } = $props();

  // Only the plan and the job make the day: the bar isn't redrawn when their needs change.
  const plan = $derived(sim.plan);
  const job = $derived(sim.job);
  const blocks = $derived(dayBlocks({ plan, job }, game.householdRoutines, game.day));
  const pct = (m: number) => `${(m / DAY) * 100}%`;
</script>

<div class="timeline" class:labels style="--h:{height}px" aria-label="{sim.name}'s day">
  {#each blocks as b, i (i)}
    {@const title = `${hhmm(b.from, settings.clock24h)}–${hhmm(b.to, settings.clock24h)} ${b.label}${b.status !== 'upcoming' && b.status !== 'work' ? ` · ${STATUS_TEXT[b.status]}` : ''}${b.reason ? ` (${reasonText(b.reason, sim.name)})` : ''}`}
    <span
      class="block {b.status}"
      style="left:{pct(b.from)};width:{pct(b.to - b.from)};--c:{b.color}"
      {title}
      role="button"
      tabindex="-1"
      onclick={() => services.controls.openPlanner(sim.id)}
      onkeydown={() => {}}
    >
      {#if labels && b.to - b.from >= 90}<span class="label">{b.label}</span>{/if}
    </span>
  {/each}
  <span class="now" style="left:{pct(game.minute)}"></span>
</div>

<style>
  .timeline {
    position: relative;
    height: var(--h);
    border-radius: 999px;
    background: var(--hairline);
    overflow: hidden;
  }
  .timeline.labels {
    border-radius: 6px;
  }
  .block {
    position: absolute;
    top: 0;
    bottom: 0;
    background: var(--c);
    opacity: 0.85;
    cursor: pointer;
    display: flex;
    align-items: center;
    overflow: hidden;
  }
  .block.upcoming {
    opacity: 0.55;
  }
  .block.work {
    background: repeating-linear-gradient(135deg, var(--c) 0 3px, transparent 3px 6px);
    opacity: 0.6;
  }
  .block.skipped,
  .block.noPlace {
    background: repeating-linear-gradient(135deg, var(--c) 0 2px, transparent 2px 5px);
    opacity: 0.5;
  }
  .block.cut {
    opacity: 0.6;
  }
  .block.active {
    opacity: 1;
    box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.8);
  }
  .label {
    padding: 0 6px;
    font-size: 10px;
    font-weight: 650;
    color: #fff;
    white-space: nowrap;
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.25);
  }
  .now {
    position: absolute;
    top: -2px;
    bottom: -2px;
    width: 2px;
    margin-left: -1px;
    background: var(--text);
    border-radius: 2px;
  }
</style>
