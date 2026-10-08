<script lang="ts">
  import { onMount } from 'svelte';
  import { randomHousehold } from '../../game/household';
  import { menuScene } from '../../game/menuScene';
  import { generateNeighbourhood, loadTemplates, vacantSlots, type NeighbourhoodDraft, type Templates, type TownSize } from '../../game/town';
  import { app } from '../app.svelte';
  import Icon from '../Icon.svelte';
  import Segmented from '../kit/Segmented.svelte';
  import SimPreview from '../kit/SimPreview.svelte';
  import TownStage, { type LotLabel } from '../kit/TownStage.svelte';
  import { services } from '../services';

  const { content, assets } = services;
  let templates = $state.raw<Templates | null>(null);
  let size = $state<TownSize>(app.town?.size ?? 'medium');
  let name = $state(app.town?.name ?? '');
  let town = $state.raw<NeighbourhoodDraft | null>(app.town);
  /** Lot under the pointer (3D or a household card) and the lot the camera is on. */
  let hover = $state<number | null>(null);
  let focus = $state<number | null>(null);
  let list = $state<HTMLElement>();

  const houseCount = $derived(town ? town.slots.filter((s) => s.kind === 'house').length : 0);
  const vacant = $derived(town ? vacantSlots(town).map((s) => s.index) : []);
  const population = $derived(town?.households.reduce((n, h) => n + h.household.members.length, 0) ?? 0);

  const labels = $derived<LotLabel[]>(
    town
      ? town.slots.map((s) => {
          const h = town!.households.find((x) => x.slot === s.index);
          if (s.kind === 'park') return { plot: s.index, title: s.name, kind: 'park' };
          if (h) return { plot: s.index, title: `The ${h.household.name}s`, sub: s.name, kind: 'home' };
          return { plot: s.index, title: 'For sale', sub: s.name, kind: 'sale' };
        })
      : [],
  );

  function generate(keepName = true) {
    if (!templates) return;
    town = generateNeighbourhood(content, assets, templates, size, keepName && name ? name : undefined, undefined, town?.seed);
    name = town.name;
  }

  function setNeighbours(count: number) {
    if (!templates || !town) return;
    town = generateNeighbourhood(content, assets, templates, size, name, count, town.seed);
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

  /** Click on a lot (3D, tag or card): the camera glides to it; again (or empty ground) back out. */
  function select(plot: number | null) {
    focus = plot === focus ? null : plot;
    if (focus === null) return;
    const i = town?.households.findIndex((h) => h.slot === focus) ?? -1;
    if (i >= 0) list?.querySelectorAll('.household')[i]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  onMount(async () => {
    templates = await loadTemplates();
    if (!town) {
      // Start from the neighbourhood the main menu showed.
      town = await menuScene.showcaseDraft();
      size = town.size;
      name = town.name;
    }
  });

  // Regenerate when the size changes.
  $effect(() => {
    if (templates && town && town.size !== size) generate();
  });

  // The 3D town follows the draft; a new layout drops the focus.
  $effect(() => {
    if (!town) return;
    void menuScene.show(town);
  });
  let layout = '';
  $effect(() => {
    const key = town ? `${town.size}:${town.slots.map((s) => s.template).join(',')}` : '';
    if (key !== layout) {
      layout = key;
      focus = null;
      hover = null;
    }
  });

  $effect(() => {
    menuScene.highlight({ hover, selected: focus, marked: vacant, outlines: true });
  });
  $effect(() => () => menuScene.highlight({}));

  /** Keeps lot tags clear of this element. */
  const avoid = (el: HTMLElement) => ({ destroy: menuScene.avoid(el) });
</script>

<div class="screen scaled">
  <div class="haze" aria-hidden="true"></div>
  <header>
    <button class="btn ghost back" onclick={() => app.toMenu()}><Icon name="icon.ui.back" size={18} /> Menu</button>
    <div class="title">
      <span class="eyebrow">Step 1 of 3 · Your neighbourhood</span>
      <input class="input town-name" aria-label="Town name" bind:value={name} maxlength="24" />
    </div>
    <div class="actions">
      <button class="btn" onclick={() => generate()}><Icon name="icon.ui.dice" size={18} /> New neighbours</button>
      <button class="btn primary" disabled={!town || vacant.length === 0} onclick={next}>Create your household →</button>
    </div>
  </header>

  <main>
    <section class="view">
      {#if town}
        <TownStage {labels} {hover} selected={focus} {focus} onhover={(p) => (hover = p)} onselect={select} />
      {:else}
        <div></div>
      {/if}
      {#if town && templates}
        <div class="controls menu-glass" use:avoid>
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
          <div class="stats" aria-label="Town summary">
            <span><b>{houseCount}</b> homes</span>
            <span><b>{town.households.length}</b> neighbour households</span>
            <span><b>{population}</b> residents</span>
            <span class="sale"><b>{vacant.length}</b> for sale</span>
          </div>
        </div>
      {/if}
      {#if focus !== null}
        <button class="btn whole" use:avoid onclick={() => (focus = null)}><Icon name="icon.ui.town" size={16} /> Whole town</button>
      {/if}
    </section>

    {#if town}
      <aside class="households menu-glass">
        <header class="list-head">
          <span class="eyebrow">Who lives here</span>
          <span class="count">{town.households.length} {town.households.length === 1 ? 'household' : 'households'}</span>
        </header>
        <div class="list" bind:this={list}>
          {#each town.households as h, i (h.household.name + i)}
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <article
              class="household"
              class:hover={hover === h.slot}
              class:focus={focus === h.slot}
              onmouseenter={() => (hover = h.slot)}
              onmouseleave={() => (hover = null)}
            >
              <button class="pick" aria-label="Show the {h.household.name}s' home" onclick={() => select(h.slot)}>
                <span class="faces">
                  {#each h.household.members as m (m.uid)}
                    <span class="face" title={m.name}><SimPreview appearance={m.appearance} gender={m.gender} size={46} /></span>
                  {/each}
                </span>
                <span class="info">
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
                </span>
              </button>
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
        </div>
      </aside>
    {/if}
  </main>
</div>

<style>
  .screen {
    position: relative;
    height: 100vh;
    display: grid;
    grid-template-rows: auto 1fr;
    padding: 20px 28px 24px;
    gap: 14px;
  }
  /* Light haze behind the header so its text reads on any part of the scene. */
  .haze {
    position: absolute;
    inset: 0 0 auto 0;
    height: 150px;
    background: var(--scene-haze);
    pointer-events: none;
  }
  header {
    position: relative;
    display: flex;
    align-items: center;
    gap: 20px;
  }
  .back {
    color: var(--text-strong);
  }
  .title {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .title .eyebrow {
    color: #4a5163;
  }
  .town-name {
    max-width: 380px;
    font-size: 26px;
    font-weight: 750;
    letter-spacing: -0.025em;
    height: 46px;
    color: var(--text-strong);
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
    position: relative;
    min-height: 0;
    display: grid;
    grid-template-columns: 1fr minmax(360px, 440px);
    gap: 24px;
  }
  .view {
    position: relative;
    min-height: 0;
    display: grid;
    grid-template-rows: 1fr auto;
    gap: 14px;
  }
  .controls {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 14px 28px;
    padding: 14px 20px;
    justify-self: start;
    animation: rise 520ms var(--ease) both;
  }
  .control {
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-width: 200px;
  }
  .controls .eyebrow,
  .list-head .eyebrow {
    color: #4a5163;
  }
  .stats {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    color: #3b4254;
    font-size: 13px;
    font-weight: 550;
  }
  .stats span {
    padding: 5px 10px;
    border-radius: var(--radius-pill);
    background: rgba(29, 34, 48, 0.06);
  }
  .stats b {
    color: var(--text-strong);
    font-weight: 750;
  }
  .stats .sale {
    background: rgba(233, 162, 59, 0.16);
  }
  .whole {
    position: absolute;
    top: 0;
    left: 0;
    animation: rise 320ms var(--ease) both;
  }
  .households {
    min-height: 0;
    display: flex;
    flex-direction: column;
    padding: 16px 12px 12px 16px;
    align-self: start;
    max-height: 100%;
    animation: rise 520ms 80ms var(--ease) both;
  }
  .list-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    padding: 0 6px 10px 2px;
    border-bottom: 1px solid var(--hairline);
    margin-bottom: 8px;
  }
  .count {
    font-size: 12px;
    font-weight: 600;
    color: var(--text-muted);
  }
  .list {
    min-height: 0;
    overflow: auto;
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding-right: 4px;
  }
  .household {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 6px 4px 4px;
    border-radius: var(--radius-md);
    border: 1px solid transparent;
    transition:
      background var(--fast) var(--ease),
      border-color var(--fast) var(--ease);
  }
  .household.hover {
    background: rgba(255, 255, 255, 0.75);
  }
  .household.focus {
    background: #fff;
    border-color: color-mix(in srgb, var(--accent) 55%, transparent);
    box-shadow: 0 0 0 3px var(--accent-soft);
  }
  .pick {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 8px;
    text-align: left;
  }
  .faces {
    display: flex;
    flex: none;
  }
  .face {
    width: 46px;
    height: 46px;
    border-radius: 50%;
    overflow: hidden;
    background: var(--surface-muted);
    border: 2px solid var(--surface);
    margin-left: -12px;
    display: grid;
    place-items: start center;
    box-shadow: var(--shadow-sm);
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
    color: var(--text-strong);
  }
  .addr {
    color: var(--text-muted);
    font-size: 12px;
    font-weight: 550;
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
    flex: none;
  }
  .row-actions .btn {
    padding: 0 10px;
  }
  .empty {
    color: var(--text-muted);
    padding: 8px;
  }
  @keyframes rise {
    from {
      opacity: 0;
      transform: translateY(12px);
    }
  }
</style>
