<script lang="ts">
  import Icon from './Icon.svelte';
  import { clock, WEEKDAYS } from './format';
  import Segmented from './kit/Segmented.svelte';
  import { services } from './services';
  import { game } from './state.svelte';
  import { settings } from '../settings/settings.svelte';
  import { aboutUs, storyIcon, storyText, storyTime, storyTone } from './story';
  import type { SocialEvent } from '../core/protocol';

  /** The story so far, newest day first: what happened at home, to everyone, or just the big moments. */
  type Filter = 'home' | 'town' | 'milestones';
  let filter = $state<Filter>('home');
  const filters: { value: Filter; label: string }[] = [
    { value: 'home', label: 'Our home' },
    { value: 'town', label: 'Everyone' },
    { value: 'milestones', label: 'Milestones' },
  ];

  const shown = (e: SocialEvent) =>
    filter === 'milestones' ? e.importance >= 2 : filter === 'home' ? aboutUs(e) : e.importance >= 1 || aboutUs(e);

  const days = $derived.by(() => {
    const out: { day: number; events: { event: SocialEvent; minute: number }[] }[] = [];
    for (let i = game.journal.length - 1; i >= 0; i--) {
      const e = game.journal[i];
      if (!shown(e)) continue;
      const { day, minute } = storyTime(e);
      if (out[out.length - 1]?.day !== day) out.push({ day, events: [] });
      out[out.length - 1].events.push({ event: e, minute });
    }
    return out;
  });
</script>

{#if game.journalOpen}
  <aside class="journal glass" aria-label="Journal">
    <header>
      <Icon name="icon.ui.journal" size={18} />
      <b>Journal</b>
      <button class="close" aria-label="Close journal (J)" onclick={() => (game.journalOpen = false)}><Icon name="icon.ui.close" size={14} /></button>
    </header>
    <Segmented options={filters} bind:value={filter} label="Show" />
    <div class="days">
      {#each days as d (d.day)}
        <section>
          <h3>{WEEKDAYS[(d.day - 1) % 7]} · Day {d.day}</h3>
          <ol>
            {#each d.events as { event, minute } (event.id)}
              <li class={storyTone(event)} class:milestone={event.importance >= 2}>
                <button title="Show them" onclick={() => services.controls.showEvent(event)}>
                  <span class="icon"><Icon name={storyIcon(event)} size={15} /></span>
                  <span class="text">{storyText(event)}</span>
                  <time>{clock(minute, settings.clock24h)}</time>
                </button>
              </li>
            {/each}
          </ol>
        </section>
      {:else}
        <p class="empty">
          {filter === 'milestones' ? 'No big moments yet. Give them time.' : 'Nothing has happened yet. Leave them be for a while.'}
        </p>
      {/each}
    </div>
  </aside>
{/if}

<style>
  .journal {
    position: absolute;
    top: 80px;
    right: var(--edge);
    bottom: var(--edge);
    width: 340px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 14px;
    pointer-events: auto;
    animation: enter var(--slow) var(--ease);
  }
  header {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  header b {
    flex: 1;
    font-size: 15px;
  }
  .close {
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    border-radius: var(--radius-sm);
    color: var(--text-muted);
  }
  .close:hover {
    background: var(--accent-soft);
    color: var(--accent);
  }
  .days {
    flex: 1;
    overflow-y: auto;
    margin: 0 -6px;
    padding: 0 6px;
  }
  h3 {
    position: sticky;
    top: 0;
    margin: 10px 0 6px;
    padding: 4px 0;
    font-size: 11px;
    font-weight: 650;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--text-muted);
    background: linear-gradient(var(--glass-strong) 70%, transparent);
  }
  ol {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  li button {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 7px 8px;
    border-radius: var(--radius-sm);
    text-align: left;
    font: inherit;
    font-size: 13px;
    color: inherit;
    transition: background var(--fast) var(--ease);
  }
  li button:hover {
    background: var(--accent-soft);
  }
  li.milestone .text {
    font-weight: 650;
  }
  .text {
    flex: 1;
  }
  time {
    font-size: 11px;
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
  }
  .icon {
    display: grid;
    place-items: center;
    width: 26px;
    height: 26px;
    flex: none;
    border-radius: 8px;
    background: rgba(79, 191, 133, 0.15);
    color: var(--good);
  }
  .love .icon {
    background: rgba(224, 96, 126, 0.14);
    color: #e0607e;
  }
  .bad .icon {
    background: rgba(236, 106, 92, 0.14);
    color: var(--bad);
  }
  .empty {
    margin: 24px 6px;
    color: var(--text-muted);
    font-size: 13px;
  }
  @keyframes enter {
    from {
      opacity: 0;
      transform: translateX(16px);
    }
  }
</style>
