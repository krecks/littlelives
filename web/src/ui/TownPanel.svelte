<script lang="ts">
  import Icon from './Icon.svelte';
  import { clock } from './format';
  import SimPreview from './kit/SimPreview.svelte';
  import { services } from './services';
  import { game } from './state.svelte';
  import { settings } from '../settings/settings.svelte';

  /** In-game town map: who lives where, who's home, and visiting. */
  const plots = $derived(game.plots);
  const width = $derived(Math.max(...plots.map((p) => p.x + p.w), 10) + 8);
  const depth = $derived(Math.max(...plots.map((p) => p.z + p.d), 10) + 8);
  const me = $derived(game.selectedSim);
  const homePlot = $derived(game.households.find((h) => h.player)?.plot ?? null);
  let picked = $state<number | null>(null);
  const plot = $derived(picked === null ? null : plots[picked]);
  const household = $derived(plot ? game.households.find((h) => h.plot === plot.id) : undefined);
  const residents = $derived(household ? game.sims.filter((s) => s.household === household.id) : []);
  const info = (id: number) => game.roster.find((r) => r.id === id);
  const homeCount = (plotId: number) => game.sims.filter((s) => s.plot === plotId).length;

  function status(s: (typeof game.sims)[number]): string {
    if (s.awayUntil !== null) return `At work until ${clock(s.awayUntil, settings.clock24h)}`;
    if (s.visiting !== null) return `Visiting ${game.plots[s.visiting]?.name ?? ''}`;
    if (s.plot === null) return 'Out and about';
    const hh = game.households[s.household];
    return s.plot === hh?.plot ? 'At home' : `At ${game.plots[s.plot]?.name}`;
  }
</script>

{#if game.townOpen}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="scrim" onclick={() => (game.townOpen = false)}></div>
  <div class="town glass" role="dialog" aria-label="Town map">
    <header>
      <b>Town</b>
      {#if me && me.plot !== homePlot}
        <button class="btn small" onclick={() => services.controls.goHome()}><Icon name="icon.ui.home" size={14} /> {me.name}: go home</button>
      {/if}
      <button class="close" aria-label="Close" onclick={() => (game.townOpen = false)}><Icon name="icon.ui.close" size={14} /></button>
    </header>
    <svg viewBox="-4 -4 {width} {depth}" class="map">
      <rect x="-4" y="-4" width={width} height={depth} rx="3" fill="#B9D7A2" />
      {#each plots as p (p.id)}
        {@const hh = game.households.find((h) => h.plot === p.id)}
        <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
        <g class="plot" class:mine={p.id === homePlot} class:picked={p.id === picked} class:viewing={p.id === game.viewPlot} onclick={() => (picked = p.id)}>
          <rect class="lot" x={p.x + 0.5} y={p.z + 0.5} width={p.w - 1} height={p.d - 1} rx="1" />
          {#if p.house}
            <rect class="house" x={p.house[0]} y={p.house[1]} width={p.house[2] - p.house[0]} height={p.house[3] - p.house[1]} rx="0.5" />
          {/if}
          <text x={p.x + p.w / 2} y={p.z + p.d / 2 + 0.6} text-anchor="middle">{p.public ? p.name : hh ? `The ${hh.name}s` : 'Empty'}</text>
          {#if homeCount(p.id)}
            <text class="count" x={p.x + p.w / 2} y={p.z + p.d / 2 + 3.2} text-anchor="middle">{homeCount(p.id)} here</text>
          {/if}
        </g>
      {/each}
    </svg>

    {#if plot}
      <section class="details">
        <div class="title">
          <b>{household ? `The ${household.name}s` : plot.name}</b>
          <span class="muted">{plot.name}</span>
        </div>
        <ul>
          {#each residents as s (s.id)}
            {@const who = info(s.id)}
            <li>
              {#if who}<span class="face"><SimPreview appearance={who.appearance} gender={who.gender} id={who.id} size={30} /></span>{/if}
              <span class="who"><b>{s.name}</b><span class="muted">{status(s)}{s.job ? ` · ${s.job.title}` : ''}</span></span>
            </li>
          {/each}
        </ul>
        {#if me && plot.id !== me.plot && plot.id !== homePlot}
          <button class="btn primary" onclick={() => services.controls.visit(plot.id)}>
            Send {me.name} to visit
          </button>
        {:else if me && plot.id === homePlot && me.plot !== homePlot}
          <button class="btn primary" onclick={() => services.controls.goHome()}>Send {me.name} home</button>
        {/if}
      </section>
    {:else}
      <p class="muted hint">Click a lot to see who lives there.</p>
    {/if}
  </div>
{/if}

<style>
  .scrim {
    position: absolute;
    inset: 0;
    pointer-events: auto;
  }
  .town {
    position: absolute;
    top: 80px;
    right: var(--edge);
    width: 460px;
    padding: 14px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    pointer-events: auto;
    animation: rise var(--slow) var(--ease);
  }
  header {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  header b {
    flex: 1;
    font-size: 16px;
  }
  .close {
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    border-radius: 50%;
    color: var(--text-muted);
  }
  .small {
    height: 30px;
    padding: 0 10px;
    font-size: 12px;
  }
  .map {
    width: 100%;
    height: auto;
    border-radius: var(--radius-md);
  }
  .plot {
    cursor: pointer;
  }
  .lot {
    fill: rgba(255, 255, 255, 0.2);
    stroke: rgba(255, 255, 255, 0.6);
    stroke-width: 0.3;
  }
  .plot:hover .lot,
  .picked .lot {
    fill: rgba(91, 124, 250, 0.2);
    stroke: var(--accent);
  }
  .viewing .lot {
    stroke-width: 0.8;
  }
  .house {
    fill: #f4f1ec;
    stroke: #c9c1b4;
    stroke-width: 0.3;
  }
  .mine .house {
    fill: var(--accent);
  }
  text {
    font-size: 1.8px;
    font-weight: 650;
    fill: rgba(29, 34, 48, 0.8);
    pointer-events: none;
  }
  .count {
    font-size: 1.4px;
    font-weight: 500;
  }
  .details {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .title {
    display: flex;
    flex-direction: column;
  }
  .muted {
    color: var(--text-muted);
    font-size: 12px;
  }
  .hint {
    margin: 0;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  li {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .face {
    width: 30px;
    height: 30px;
    border-radius: 50%;
    overflow: hidden;
    background: var(--surface-muted);
    display: grid;
    place-items: start center;
  }
  .who {
    display: flex;
    flex-direction: column;
  }
  @keyframes rise {
    from {
      opacity: 0;
      transform: translateY(8px);
    }
  }
</style>
