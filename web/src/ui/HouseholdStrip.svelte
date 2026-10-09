<script lang="ts">
  import Icon from './Icon.svelte';
  import { clock, needColor } from './format';
  import SimPreview from './kit/SimPreview.svelte';
  import { services } from './services';
  import { game } from './state.svelte';
  import { settings } from '../settings/settings.svelte';
  import type { SimView } from '../core/protocol';

  /** Everyone at a glance: the household (what they're doing, where, how they feel) and guests. */
  const home = $derived(game.households.find((h) => h.player)?.plot ?? null);
  const household = $derived(game.sims.filter((s) => game.households[s.household]?.player));
  const guests = $derived(game.sims.filter((s) => !game.households[s.household]?.player && home !== null && s.plot === home && s.awayUntil === null));
  const info = (id: number) => game.roster.find((r) => r.id === id);
  const needs = services.content.needs;

  function where(s: SimView): string {
    if (s.awayUntil !== null) return `At work · back ${clock(s.awayUntil, settings.clock24h)}`;
    if (s.visiting !== null) return `Visiting ${game.plots[s.visiting]?.name ?? 'friends'}`;
    if (s.plot === home) return 'Home';
    return s.plot === null ? 'Out and about' : `At ${game.plots[s.plot]?.name ?? 'a friend’s'}`;
  }

  /** The need that's worst off, if it's getting low. */
  function low(s: SimView): { label: string; icon: string; value: number } | null {
    let worst = -1;
    for (let i = 0; i < needs.length; i++) if (worst < 0 || s.needs[i] < s.needs[worst]) worst = i;
    return worst >= 0 && s.needs[worst] < 0.25 ? { label: needs[worst].label, icon: needs[worst].icon, value: s.needs[worst] } : null;
  }

  const doing = (s: SimView) => s.actions.find((a) => a.active) ?? s.actions[0];
</script>

{#snippet face(id: number, size: number)}
  {@const who = info(id)}
  {#if who}<SimPreview appearance={who.appearance} gender={who.gender} id={who.id} {size} />{/if}
{/snippet}

<section class="strip" aria-label="Household">
  {#each household as s (s.id)}
    {@const action = doing(s)}
    {@const need = low(s)}
    {@const away = s.plot !== home}
    <div class="card glass" class:active={game.inspected === s.id} class:away>
      <button
        class="main"
        title="{s.name}: look closer (Tab). Double-click to follow."
        onclick={() => services.controls.inspect(game.inspected === s.id ? null : s.id)}
        ondblclick={() => services.controls.follow(s.id)}
      >
        <span class="face" style="--mood:{needColor(s.mood)}">{@render face(s.id, 38)}</span>
        <span class="text">
          <span class="name">{s.name}</span>
          <span class="doing">{action ? action.label : s.awayUntil !== null ? 'Working' : 'Taking a moment'}</span>
          <span class="where">{where(s)}</span>
        </span>
        {#if need}
          <span class="need" title="{need.label} is low">
            <Icon name={need.icon} size={14} />
          </span>
        {/if}
      </button>
      {#if action?.active}
        <span class="progress"><span style="width:{action.progress * 100}%"></span></span>
      {/if}
      {#if away && s.awayUntil === null && game.follow !== s.id}
        <button class="go" title="Follow {s.name}" onclick={() => services.controls.follow(s.id)}>
          <Icon name="icon.ui.follow" size={12} />Follow
        </button>
      {/if}
    </div>
  {/each}
  {#if guests.length}
    <div class="guests glass" title="Guests">
      {#each guests as g (g.id)}
        <button class="guest" class:active={game.inspected === g.id} title="{g.name} is visiting" onclick={() => services.controls.inspect(g.id)}>
          {@render face(g.id, 28)}
        </button>
      {/each}
    </div>
  {/if}
</section>

<style>
  .strip {
    position: absolute;
    left: var(--edge);
    bottom: var(--edge);
    right: 420px;
    display: flex;
    align-items: flex-end;
    gap: 8px;
    pointer-events: none;
  }
  .card {
    position: relative;
    pointer-events: auto;
    width: 200px;
    border-radius: var(--radius-md);
    overflow: hidden;
    transition:
      transform var(--fast) var(--ease),
      box-shadow var(--fast) var(--ease);
  }
  .card:hover {
    transform: translateY(-2px);
  }
  .card.active {
    box-shadow: 0 0 0 2px var(--accent), var(--shadow-md);
  }
  .card.away {
    opacity: 0.82;
  }
  .main {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 8px 10px;
    text-align: left;
    font: inherit;
    color: inherit;
  }
  .face {
    width: 38px;
    height: 38px;
    flex: none;
    border-radius: 50%;
    overflow: hidden;
    background: var(--surface-muted);
    box-shadow: 0 0 0 2px var(--glass-strong), 0 0 0 4px var(--mood);
  }
  .text {
    display: flex;
    flex-direction: column;
    min-width: 0;
    flex: 1;
    line-height: 1.25;
  }
  .name {
    font-weight: 650;
    font-size: 13px;
  }
  .doing,
  .where {
    font-size: 11.5px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .where {
    color: var(--text-muted);
  }
  .need {
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    flex: none;
    border-radius: 8px;
    background: rgba(236, 106, 92, 0.14);
    color: var(--bad);
    animation: pulse 1.6s ease-in-out infinite;
  }
  .progress {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    height: 3px;
    background: var(--hairline);
  }
  .progress span {
    display: block;
    height: 100%;
    background: var(--accent);
    transition: width 0.3s linear;
  }
  .go {
    position: absolute;
    top: 6px;
    right: 6px;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    height: 20px;
    padding: 0 7px;
    border-radius: var(--radius-pill);
    background: var(--accent-soft);
    color: var(--accent);
    font-size: 10.5px;
    font-weight: 650;
  }
  .guests {
    pointer-events: auto;
    display: flex;
    gap: 4px;
    padding: 6px;
    border-radius: var(--radius-md);
  }
  .guest {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    overflow: hidden;
    background: var(--surface-muted);
    opacity: 0.85;
  }
  .guest.active,
  .guest:hover {
    opacity: 1;
    box-shadow: 0 0 0 2px var(--accent);
  }
  @keyframes pulse {
    50% {
      transform: scale(1.1);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .need {
      animation: none;
    }
  }
</style>
