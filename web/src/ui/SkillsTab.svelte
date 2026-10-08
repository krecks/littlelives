<script lang="ts">
  import type { SimView } from '../core/protocol';
  import Icon from './Icon.svelte';
  import { services } from './services';
  import { game } from './state.svelte';

  let { sim }: { sim: SimView } = $props();
  const max = $derived(game.catalog?.maxSkill ?? 10);

  /** What the job (now) and the next promotion ask of each skill. */
  const targets = $derived.by(() => {
    const out = new Map<string, { job: number; next: number }>();
    const job = sim.job;
    if (!job) return out;
    for (const r of job.requires) if (r.level > 0) out.set(r.skill, { job: r.level, next: 0 });
    for (const r of job.next?.requires ?? []) {
      if (r.level <= 0) continue;
      const t = out.get(r.skill) ?? { job: 0, next: 0 };
      out.set(r.skill, { ...t, next: r.level });
    }
    return out;
  });

  const rows = $derived(
    services.content.skills
      .map((def, i) => {
        const value = sim.skills[i] ?? 0;
        const level = Math.floor(value);
        const t = targets.get(def.id);
        const target = t ? Math.max(t.job, t.next) : 0;
        return { def, value, level, progress: level >= max ? 1 : value - level, t, target };
      })
      .sort((a, b) => Number(!!b.t) - Number(!!a.t) || b.value - a.value),
  );

  function tooltip(r: (typeof rows)[number]): string {
    const parts = [r.def.description];
    if (r.t?.job) parts.push(`Current job needs ${r.t.job}.`);
    if (r.t?.next) parts.push(`Next promotion needs ${r.t.next}.`);
    return parts.join(' ');
  }
</script>

<ul class="skills">
  {#each rows as r (r.def.id)}
    <li title={tooltip(r)} class:needed={!!r.t}>
      <span class="icon"><Icon name={r.def.icon} size={15} /></span>
      <div class="body">
        <span class="top">
          <span class="label">{r.def.label}</span>
          {#if r.t}
            <span class="target" class:met={r.level >= r.target} aria-label="Job target {r.target}">
              {r.t.next && r.t.next > r.t.job ? 'Next' : 'Job'} → {r.target}
            </span>
          {/if}
          <span class="lvl tabular">{r.level}</span>
        </span>
        <span class="bar" role="progressbar" aria-label="{r.def.label} progress to level {Math.min(r.level + 1, max)}" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(r.progress * 100)}>
          <span class="fill" style="width:{r.progress * 100}%"></span>
        </span>
      </div>
    </li>
  {/each}
</ul>

<style>
  .skills {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 5px;
    max-height: 250px;
    overflow: auto;
  }
  li {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 5px 8px;
    border-radius: var(--radius-sm);
  }
  li.needed {
    background: var(--accent-soft);
  }
  .icon {
    display: grid;
    place-items: center;
    width: 26px;
    height: 26px;
    flex: none;
    border-radius: 8px;
    background: var(--surface);
    box-shadow: var(--shadow-sm);
    color: var(--text);
  }
  .body {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .top {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12.5px;
  }
  .label {
    flex: 1;
    font-weight: 600;
  }
  .lvl {
    min-width: 16px;
    text-align: right;
    font-weight: 750;
  }
  .target {
    padding: 0 6px;
    border-radius: var(--radius-pill);
    background: rgba(240, 181, 74, 0.22);
    color: #a06d0e;
    font-size: 10px;
    font-weight: 700;
  }
  .target.met {
    background: rgba(79, 191, 133, 0.18);
    color: #2f8a5c;
  }
  .bar {
    position: relative;
    height: 4px;
    border-radius: var(--radius-pill);
    background: var(--hairline);
    overflow: hidden;
  }
  .fill {
    display: block;
    height: 100%;
    background: var(--accent);
    transition: width var(--slow) var(--ease);
  }
</style>
