<script lang="ts">
  import { onMount } from 'svelte';
  import { lookAtAge, randomHousehold } from '../../game/household';
  import { menuScene } from '../../game/menuScene';
  import { generateNeighbourhood, loadTemplates, vacantSlots, type NeighbourhoodDraft, type Templates, type TownSize } from '../../game/town';
  import { app } from '../app.svelte';
  import { lifespanHint } from '../format';
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

  /** The town as the next step should see it (with the name typed here). */
  function keep() {
    if (!town) return;
    app.town = { ...town, name: name.trim() || town.name };
  }

  function next() {
    if (!town) return;
    keep();
    app.buildFirst = false;
    app.screen = 'create';
  }

  /** Build first: straight to the home, a family moves in later. */
  function buildFirst() {
    if (!town) return;
    keep();
    app.buildFirst = true;
    app.screen = 'home';
  }

  /** The other path: take over a household that already lives here. */
  function play(slot: number) {
    if (!town) return;
    keep();
    app.playSlot = slot;
    app.screen = 'play';
  }

  /** The household on the lot in focus (offered to play from the 3D view). */
  const focused = $derived(town && focus !== null ? town.households.find((h) => h.slot === focus) : undefined);

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
      <p class="lede">Play one of the households who live here, create your own, or build a home first.</p>
    </div>
    <div class="actions">
      <button class="btn" onclick={() => generate()}><Icon name="icon.ui.dice" size={18} /> New neighbours</button>
      <button class="btn" disabled={!town || vacant.length === 0} title="Pick a lot and build; a family can move in later" onclick={buildFirst}>
        <Icon name="icon.ui.build" size={18} /> Build first
      </button>
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
            <span class="eyebrow">Game</span>
            <Segmented
              label="Game"
              bind:value={app.mode}
              options={[
                { value: 'living', label: 'Living' },
                { value: 'creative', label: 'Creative' },
              ]}
            />
            <span class="hint">{app.mode === 'creative' ? 'Building is free. No rent or bills at home.' : 'Your residents earn the money to build with.'}</span>
          </div>
          <div class="control">
            <span class="eyebrow">Lifespan</span>
            <Segmented
              label="Lifespan"
              bind:value={app.lifespan}
              options={[
                { value: 'off', label: 'Off' },
                { value: 'short', label: 'Short' },
                { value: 'normal', label: 'Normal' },
                { value: 'long', label: 'Long' },
              ]}
            />
            <span class="hint">{lifespanHint(app.lifespan)}</span>
          </div>
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
        <div class="lot-actions" use:avoid>
          <button class="btn" onclick={() => (focus = null)}><Icon name="icon.ui.town" size={16} /> Whole town</button>
          {#if focused}
            {#key focused.slot}
              <button class="btn primary play-lot" onclick={() => play(focused.slot)}>Play the {focused.household.name}s →</button>
            {/key}
          {/if}
        </div>
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
                    <span class="face" title={m.name}><SimPreview appearance={lookAtAge(services.content, m.appearance, m.age)} gender={m.gender} size={42} /></span>
                  {/each}
                </span>
                <span class="info">
                  <b>The {h.household.name}s</b>
                  <span class="addr">{town.slots[h.slot].name}</span>
                  <span class="members">
                    {#each h.household.members as m (m.uid)}
                      {@const traits = m.traits.map((t) => content.trait(t)?.label).join(', ')}
                      <span class="member" title={traits ? `${m.name} · ${traits}` : m.name}>{m.name}{#if traits}<em> · {traits}</em>{/if}</span>
                    {/each}
                  </span>
                </span>
              </button>
              <div class="row-actions">
                <button class="btn play" aria-label="Play this household: the {h.household.name}s" title="Play the {h.household.name}s" onclick={() => play(h.slot)}>Play</button>
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
    grid-template-columns: 1fr minmax(400px, 480px);
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
  .hint {
    font-size: 12px;
    color: var(--text-muted);
    max-width: 210px;
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
  .lede {
    margin: 0;
    font-size: 14px;
    font-weight: 550;
    color: #3b4254;
  }
  .lot-actions {
    position: absolute;
    top: 0;
    left: 0;
    display: flex;
    gap: 10px;
    animation: rise 320ms var(--ease) both;
  }
  .play-lot {
    box-shadow: 0 10px 28px rgba(60, 90, 220, 0.35);
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
  /* Room for three overlapping faces, so every card's text lines up. */
  .faces {
    display: flex;
    flex: none;
    width: 98px;
  }
  .face {
    width: 42px;
    height: 42px;
    border-radius: 50%;
    overflow: hidden;
    background: var(--surface-muted);
    border: 2px solid var(--surface);
    margin-left: -14px;
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
    display: flex;
    flex-direction: column;
    font-size: 13px;
  }
  /* One line per resident; long trait lists end in an ellipsis (full text on hover). */
  .member {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .members em {
    color: var(--text-muted);
    font-style: normal;
  }
  .row-actions {
    display: flex;
    flex: none;
  }
  .row-actions {
    align-items: center;
    gap: 2px;
  }
  .row-actions .btn {
    padding: 0 10px;
  }
  .row-actions .play {
    height: 34px;
    padding: 0 14px;
    margin-right: 4px;
    border-color: transparent;
    background: var(--accent-soft);
    color: var(--accent);
    box-shadow: none;
    font-weight: 700;
  }
  .row-actions .play:hover,
  .household.focus .play,
  .play:focus-visible {
    background: var(--accent);
    color: var(--text-inverse);
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
