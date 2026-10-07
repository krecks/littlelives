<script lang="ts">
  import { chanceLabel, chemistryLabel, friendLabel, romanceLabel } from './relationship';
  import Icon from './Icon.svelte';
  import SimPreview from './kit/SimPreview.svelte';
  import { services } from './services';
  import { game } from './state.svelte';

  const menu = $derived(game.socialMenu);
  const target = $derived(menu ? game.roster.find((s) => s.id === menu.target) : undefined);
  const household = $derived(target ? game.households[target.household] : undefined);
  const mine = $derived(household?.player ?? false);
  const rel = $derived(menu ? game.relationships.find((r) => r.a === game.selected && r.b === menu.target) : undefined);
  const back = $derived(menu ? game.relationships.find((r) => r.a === menu.target && r.b === game.selected) : undefined);
  const categories = [
    { id: 'friendly', label: 'Friendly' },
    { id: 'romantic', label: 'Romantic' },
    { id: 'mean', label: 'Mean' },
    { id: 'makeup', label: 'Make up' },
  ];
  const left = $derived(menu ? Math.min(menu.x + 16, innerWidth - 340) : 0);
  const top = $derived(menu ? Math.min(Math.max(menu.y - 120, 70), innerHeight - 460) : 0);
</script>

{#if menu && target}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="scrim" onclick={() => services.controls.closeMenu()}></div>
  <div class="social glass" style="left:{left}px;top:{top}px" role="dialog" aria-label="Interact with {target.name}">
    <header>
      <span class="face"><SimPreview appearance={target.appearance} size={52} animate={false} /></span>
      <div>
        <b>{target.name}</b>
        <span class="sub">{mine ? 'Your household' : `The ${household?.name}s`}</span>
      </div>
      {#if mine}
        <button class="btn switch" onclick={() => services.controls.selectSim(target.id)}>Play as {target.name}</button>
      {/if}
    </header>

    {#if rel}
      <div class="bars">
        <div class="bar-row">
          <span>{friendLabel(rel.friendship, back?.friendship ?? 0)}</span>
          <span class="track"><span class="mid"></span><span class="fill" class:neg={rel.friendship < 0} style="--v:{rel.friendship}"></span></span>
        </div>
        {#if rel.romance > 0 || rel.partners}
          <div class="bar-row romance">
            <span>{romanceLabel(rel) ?? 'Romance'}</span>
            <span class="track"><span class="fill love" style="--v:{rel.romance}"></span></span>
          </div>
        {/if}
        <span class="chem">{chemistryLabel(rel.chemistry)}</span>
      </div>
    {:else}
      <p class="stranger">You haven't met yet.</p>
    {/if}

    <div class="options">
      {#if !menu.options}
        <p class="loading">…</p>
      {:else}
        {#each categories as cat (cat.id)}
          {@const list = menu.options.filter((o) => o.category === cat.id)}
          {#if list.length}
            <span class="eyebrow">{cat.label}</span>
            <div class="list">
              {#each list as o (o.index)}
                {@const c = chanceLabel(o.chance)}
                <button class="option" disabled={o.chance <= 0} onclick={() => services.controls.socialize(target.id, o.index)}>
                  <Icon name={services.content.social(o.index)?.icon ?? ''} size={16} />
                  <span class="label">{o.label}</span>
                  <span class="chance {c.tone}">{c.text}</span>
                </button>
              {/each}
            </div>
          {/if}
        {/each}
      {/if}
    </div>
  </div>
{/if}

<style>
  .scrim {
    position: absolute;
    inset: 0;
    pointer-events: auto;
  }
  .social {
    position: absolute;
    width: 320px;
    max-height: 440px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 14px;
    pointer-events: auto;
    animation: rise var(--slow) var(--ease);
  }
  header {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  header > div {
    flex: 1;
    display: flex;
    flex-direction: column;
  }
  .sub {
    color: var(--text-muted);
    font-size: 12px;
  }
  .face {
    width: 46px;
    height: 46px;
    border-radius: 50%;
    overflow: hidden;
    background: var(--surface-muted);
    display: grid;
    place-items: start center;
  }
  .switch {
    height: 32px;
    padding: 0 10px;
    font-size: 12px;
  }
  .bars {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .bar-row {
    display: grid;
    grid-template-columns: 96px 1fr;
    align-items: center;
    gap: 8px;
    font-size: 12px;
    font-weight: 600;
  }
  .track {
    position: relative;
    height: 6px;
    border-radius: var(--radius-pill);
    background: var(--hairline);
    overflow: hidden;
  }
  .mid {
    position: absolute;
    left: 50%;
    top: 0;
    bottom: 0;
    width: 1px;
    background: rgba(29, 34, 48, 0.25);
  }
  .fill {
    position: absolute;
    top: 0;
    bottom: 0;
    left: 50%;
    width: calc(max(var(--v), 0) * 0.5%);
    background: var(--good);
    border-radius: var(--radius-pill);
  }
  .fill.neg {
    left: calc(50% + var(--v) * 0.5%);
    width: calc(var(--v) * -0.5%);
    background: var(--bad);
  }
  .fill.love {
    left: 0;
    width: calc(max(var(--v), 0) * 1%);
    background: #e0607e;
  }
  .chem,
  .stranger {
    margin: 0;
    color: var(--text-muted);
    font-size: 12px;
  }
  .options {
    overflow: auto;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .list {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .option {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 10px;
    border-radius: var(--radius-sm);
    text-align: left;
    color: var(--text-muted);
  }
  .option:hover:not(:disabled) {
    background: var(--accent-soft);
    color: var(--accent);
  }
  .option:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .label {
    flex: 1;
    color: var(--text);
    font-weight: 600;
  }
  .chance {
    font-size: 11px;
    font-weight: 650;
  }
  .chance.good {
    color: var(--good);
  }
  .chance.warn {
    color: #b07a14;
  }
  .chance.bad {
    color: var(--bad);
  }
  .loading {
    color: var(--text-muted);
  }
  @keyframes rise {
    from {
      opacity: 0;
      transform: translateY(8px);
    }
  }
</style>
