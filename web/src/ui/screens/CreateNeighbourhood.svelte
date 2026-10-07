<script lang="ts">
  import { onMount } from 'svelte';
  import { randomHousehold } from '../../game/household';
  import { generateNeighbourhood, loadTemplates, vacantSlots, type Templates, type TownSize } from '../../game/town';
  import { app } from '../app.svelte';
  import Icon from '../Icon.svelte';
  import Segmented from '../kit/Segmented.svelte';
  import SimPreview from '../kit/SimPreview.svelte';
  import TownMap from '../kit/TownMap.svelte';
  import { services } from '../services';

  const { content, assets } = services;
  let templates = $state.raw<Templates | null>(null);
  let size = $state<TownSize>(app.town?.size ?? 'small');
  let name = $state(app.town?.name ?? '');
  let town = $state.raw(app.town);

  const houseCount = $derived(town ? town.slots.filter((s) => s.kind === 'house').length : 0);
  const vacant = $derived(town ? vacantSlots(town).length : 0);
  const population = $derived(town?.households.reduce((n, h) => n + h.household.members.length, 0) ?? 0);

  function generate(keepName = true) {
    if (!templates) return;
    town = generateNeighbourhood(content, assets, templates, size, keepName && name ? name : undefined);
    name = town.name;
  }

  function setNeighbours(count: number) {
    if (!templates || !town) return;
    town = generateNeighbourhood(content, assets, templates, size, name, count);
  }

  function rerollHousehold(i: number) {
    if (!town) return;
    const households = [...town.households];
    households[i] = { ...households[i], household: randomHousehold(content, assets, households[i].household.members.length) };
    town = { ...town, households };
  }

  function removeHousehold(i: number) {
    if (!town) return;
    town = { ...town, households: town.households.filter((_, j) => j !== i) };
  }

  function next() {
    if (!town) return;
    app.town = { ...town, name: name.trim() || town.name };
    app.screen = 'create';
  }

  onMount(async () => {
    templates = await loadTemplates();
    if (!town) generate(false);
  });

  $effect(() => {
    // Regenerate when the size changes.
    if (templates && town && town.size !== size) generate();
  });
</script>

<div class="screen scaled">
  <header>
    <button class="btn ghost" onclick={() => app.toMenu()}><Icon name="icon.ui.back" size={18} /> Menu</button>
    <div class="title">
      <span class="eyebrow">Step 1 of 3 · Your neighbourhood</span>
      <input class="input town-name" aria-label="Town name" bind:value={name} maxlength="24" />
    </div>
    <div class="actions">
      <button class="btn" onclick={() => generate()}><Icon name="icon.ui.dice" size={18} /> New neighbours</button>
      <button class="btn primary" disabled={!town || vacant === 0} onclick={next}>Create your household →</button>
    </div>
  </header>

  {#if town && templates}
    <main>
      <section class="map-col">
        <TownMap {town} {templates} />
        <div class="stats">
          <span><b>{houseCount}</b> homes</span>
          <span><b>{town.households.length}</b> neighbour households</span>
          <span><b>{population}</b> residents</span>
          <span><b>{vacant}</b> for sale</span>
        </div>
        <div class="controls glass">
          <div class="control">
            <span class="eyebrow">Town size</span>
            <Segmented
              label="Town size"
              bind:value={size}
              options={[
                { value: 'small', label: 'Small' },
                { value: 'medium', label: 'Medium' },
                { value: 'large', label: 'Large' },
              ]}
            />
          </div>
          <label class="control">
            <span class="eyebrow">Neighbours · {town.households.length}</span>
            <input
              type="range"
              min="0"
              max={houseCount - 1}
              value={town.households.length}
              onchange={(e) => setNeighbours(Number((e.currentTarget as HTMLInputElement).value))}
            />
          </label>
        </div>
      </section>

      <section class="households">
        <span class="eyebrow">Who lives here</span>
        {#each town.households as h, i (h.household.name + i)}
          <article class="household glass">
            <div class="faces">
              {#each h.household.members as m (m.uid)}
                <span class="face" title={m.name}><SimPreview appearance={m.appearance} size={46} animate={false} /></span>
              {/each}
            </div>
            <div class="info">
              <b>The {h.household.name}s</b>
              <span class="addr">{town.slots[h.slot].name}</span>
              <span class="members">
                {#each h.household.members as m, j (m.uid)}
                  {m.name}{#if m.traits.length}<em> · {m.traits.map((t) => content.trait(t)?.label).join(', ')}</em>{/if}{j <
                  h.household.members.length - 1
                    ? ' — '
                    : ''}
                {/each}
              </span>
            </div>
            <div class="row-actions">
              <button class="btn ghost" aria-label="Reroll the {h.household.name}s" onclick={() => rerollHousehold(i)}>
                <Icon name="icon.ui.dice" size={16} />
              </button>
              <button class="btn ghost" aria-label="Remove the {h.household.name}s" onclick={() => removeHousehold(i)}>
                <Icon name="icon.ui.trash" size={16} />
              </button>
            </div>
          </article>
        {:else}
          <p class="empty">A quiet town — you'll be the first to move in.</p>
        {/each}
      </section>
    </main>
  {/if}
</div>

<style>
  .screen {
    position: relative;
    height: 100vh;
    display: grid;
    grid-template-rows: auto 1fr;
    padding: 20px 28px 24px;
    gap: 16px;
  }
  header {
    display: flex;
    align-items: center;
    gap: 20px;
  }
  .title {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .town-name {
    max-width: 360px;
    font-size: 22px;
    font-weight: 700;
    letter-spacing: -0.02em;
    height: 44px;
    background: transparent;
    border-color: transparent;
    padding-left: 0;
  }
  .town-name:hover,
  .town-name:focus {
    background: var(--surface);
    padding-left: 12px;
  }
  .actions {
    display: flex;
    gap: 10px;
  }
  main {
    min-height: 0;
    display: grid;
    grid-template-columns: 1.4fr 1fr;
    gap: 24px;
  }
  .map-col {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .stats {
    display: flex;
    gap: 18px;
    color: var(--text-muted);
  }
  .stats b {
    color: var(--text);
  }
  .controls {
    display: flex;
    gap: 28px;
    padding: 14px 18px;
    align-items: center;
  }
  .control {
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-width: 200px;
  }
  .households {
    min-height: 0;
    overflow: auto;
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding-right: 4px;
  }
  .household {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 12px 14px;
    border-radius: var(--radius-lg);
  }
  .faces {
    display: flex;
  }
  .face {
    width: 46px;
    height: 46px;
    border-radius: 50%;
    overflow: hidden;
    background: var(--surface-muted);
    border: 2px solid var(--surface);
    margin-left: -10px;
    display: grid;
    place-items: start center;
  }
  .face:first-child {
    margin-left: 0;
  }
  .info {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .addr {
    color: var(--text-muted);
    font-size: 12px;
  }
  .members {
    font-size: 13px;
  }
  .members em {
    color: var(--text-muted);
    font-style: normal;
  }
  .row-actions {
    display: flex;
  }
  .row-actions .btn {
    padding: 0 10px;
  }
  .empty {
    color: var(--text-muted);
  }
</style>
