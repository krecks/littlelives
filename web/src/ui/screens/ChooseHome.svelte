<script lang="ts">
  import { onMount } from 'svelte';
  import { menuScene } from '../../game/menuScene';
  import { houseTemplate, loadTemplates, lotDims, vacantSlots, withLotSize, type LotSize, type PlotSlot, type Templates } from '../../game/town';
  import { app } from '../app.svelte';
  import { money } from '../format';
  import Icon from '../Icon.svelte';
  import Segmented from '../kit/Segmented.svelte';
  import TownStage, { type LotLabel } from '../kit/TownStage.svelte';
  import { services } from '../services';

  let templates = $state.raw<Templates | null>(null);
  /** Changes when a lot is made bigger or smaller (the lots along the street move). */
  const town = $derived(app.town!);
  /** Null: build first, a family moves in later. */
  const household = app.buildFirst ? null : app.household;
  const economy = services.content.economy;
  const vacant = $derived(vacantSlots(town));
  const vacantIds = $derived(vacant.map((v) => v.index));
  let selectedIndex = $state<number | null>(vacantSlots(app.town!).find((v) => v.index === app.homeSlot)?.index ?? vacantSlots(app.town!)[0]?.index ?? null);
  const selected = $derived(selectedIndex === null ? null : (town.slots[selectedIndex] ?? null));
  const lotSize = $derived<LotSize>(selected?.lot ?? 'medium');
  const dims = $derived(templates && selected ? lotDims(templates, selected.lot) : null);
  function setLotSize(size: LotSize) {
    if (templates && selected) app.town = withLotSize(templates, town, selected.index, size);
  }
  let hover = $state<number | null>(null);
  /** The camera is on the chosen lot (false: the whole town). */
  let close = $state(true);
  $effect(() => {
    app.homeSlot = selected?.index ?? null;
  });
  /** The house as it stands, or an empty lot to build on. */
  let lot = $state<'house' | 'empty'>(app.emptyLot ? 'empty' : 'house');
  $effect(() => {
    app.emptyLot = lot === 'empty';
  });
  const house = $derived(templates && selected ? houseTemplate(templates, selected.template) : undefined);
  const neighbours = $derived(
    selected
      ? town.households
          .map((h) => ({ ...h, distance: Math.hypot(town.slots[h.slot].x - selected!.x, town.slots[h.slot].z - selected!.z) }))
          .sort((a, b) => a.distance - b.distance)
          .slice(0, 3)
      : [],
  );
  /** What the household has to build with on an empty lot (Living), or "free" (Creative). */
  const budget = $derived(
    app.mode === 'creative'
      ? 'Free: this is a Creative game'
      : money(economy.startingFunds + (lot === 'empty' ? (economy.emptyLotFunds ?? 0) : 0)),
  );
  const mine = household ? `The ${household.name}s` : 'Your lot';

  const labels = $derived<LotLabel[]>(
    town.slots.map((s) => {
      const h = town.households.find((x) => x.slot === s.index);
      if (s.kind === 'park') return { plot: s.index, title: s.name, kind: 'park' };
      if (h) return { plot: s.index, title: `The ${h.household.name}s`, kind: 'home' };
      if (selected?.index === s.index) return { plot: s.index, title: mine, sub: lot === 'empty' ? 'An empty lot' : 'Your new home', kind: 'mine' };
      return { plot: s.index, title: 'For sale', sub: bedrooms(s), kind: 'sale' };
    }),
  );

  function bedrooms(s: PlotSlot): string | undefined {
    const n = templates ? houseTemplate(templates, s.template)?.bedrooms : undefined;
    return n ? `${n} bedroom${n === 1 ? '' : 's'}` : undefined;
  }

  function choose(plot: number | null) {
    const slot = vacant.find((v) => v.index === plot);
    if (!slot) {
      close = false;
      return;
    }
    selectedIndex = slot.index;
    close = true;
  }

  function moveIn() {
    const request = selected && app.homeRequest(selected.index);
    if (!request) return;
    menuScene.highlight({});
    app.start(request);
  }

  function back() {
    app.screen = household ? 'create' : 'neighbourhood';
  }

  onMount(async () => {
    templates = await loadTemplates();
  });

  // The 3D town shows the chosen lot cleared when starting on an empty lot.
  $effect(() => {
    const shown = selected ? app.homeTown(selected.index) : town;
    if (shown) void menuScene.show(shown);
  });
  $effect(() => {
    menuScene.highlight({ hover, selected: selected?.index ?? null, marked: vacantIds, outlines: false });
  });

  /** Keeps lot tags clear of this element. */
  const avoid = (el: HTMLElement) => ({ destroy: menuScene.avoid(el) });
</script>

<div class="screen scaled">
  <div class="haze" aria-hidden="true"></div>
  <header>
    <button class="btn ghost back" onclick={back}><Icon name="icon.ui.back" size={18} /> {household ? 'Household' : 'Neighbourhood'}</button>
    <div class="title">
      <span class="eyebrow">{household ? 'Step 3 of 3' : 'Step 2 of 2'} · Choose a home</span>
      <h1>{household ? `Where will the ${household.name}s live?` : 'Where will you build?'}</h1>
    </div>
    <button class="btn primary large move" disabled={!selected} onclick={moveIn}>{household ? 'Move in →' : 'Start building →'}</button>
  </header>

  <main>
    <section class="view">
      <TownStage
        {labels}
        {hover}
        selected={selected?.index ?? null}
        focus={close ? (selected?.index ?? null) : null}
        selectable={(p) => vacantIds.includes(p)}
        onhover={(p) => (hover = p)}
        onselect={choose}
      />
      <div class="hint menu-glass" aria-hidden="true" use:avoid>
        <span class="swatch sale"></span> For sale
        <span class="sep"></span>
        Click a home to look closer · drag to turn · scroll to zoom
      </div>
      {#if close && vacant.length > 1}
        <button class="btn whole" use:avoid onclick={() => (close = false)}><Icon name="icon.ui.town" size={16} /> All homes</button>
      {/if}
    </section>

    <aside class="details menu-glass">
      {#if selected}
        {#if house}
          <Segmented
            label="Start with"
            bind:value={lot}
            options={[
              { value: 'house', label: 'The house' },
              { value: 'empty', label: 'An empty lot' },
            ]}
          />
        {/if}
        {#if templates?.lotSizes}
          <div class="lot-size">
            <span class="eyebrow">Lot size</span>
            <Segmented label="Lot size" bind:value={() => lotSize, setLotSize} options={[{ value: 'small', label: 'Small' }, { value: 'medium', label: 'Medium' }, { value: 'large', label: 'Large' }]} />
          </div>
        {/if}
        {#key `${selected.index}:${lot}:${selected.template}`}
          <div class="card">
            <span class="eyebrow">{town.name}</span>
            <h2>{selected.name}</h2>
            {#if lot === 'empty' || !house}
              <b class="house">An empty lot</b>
              <p>The house is cleared away: build your own from the ground up.{household ? '' : ' A family can move in whenever you like.'}</p>
            {:else}
              <b class="house">{house.name}</b>
              <p>{house.description}</p>
            {/if}
            <dl>
              {#if dims}
                <dt>Lot</dt>
                <dd>{dims.width} × {dims.depth} m{economy.rent ? ` · rent ${money(economy.rent.base + Math.round(economy.rent.perTile * dims.width * dims.depth))} a week` : ''}</dd>
              {/if}
              {#if house && lot === 'house'}
                <dt>Bedrooms</dt>
                <dd>{house.bedrooms}</dd>
              {/if}
              <dt>To build with</dt>
              <dd>{budget}</dd>
              <dt>{household ? 'Your household' : 'Living here'}</dt>
              <dd>{household ? household.members.map((m) => m.name).join(', ') : 'Nobody yet: move a family in later'}</dd>
            </dl>
            {#if neighbours.length}
              <span class="eyebrow">Closest neighbours</span>
              <ul>
                {#each neighbours as n (n.slot)}
                  <li><b>The {n.household.name}s</b> · {town.slots[n.slot].name}</li>
                {/each}
              </ul>
            {/if}
          </div>
        {/key}
        {#if vacant.length > 1}
          <div class="others">
            <span class="eyebrow">Also for sale</span>
            <div class="chips">
              {#each vacant as v (v.index)}
                <button class="chip" class:on={v.index === selected.index} onmouseenter={() => (hover = v.index)} onmouseleave={() => (hover = null)} onclick={() => choose(v.index)}>
                  {v.name}
                </button>
              {/each}
            </div>
          </div>
        {/if}
      {:else}
        <p>Every house is taken. Go back and remove a neighbour household.</p>
      {/if}
    </aside>
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
  }
  .title .eyebrow {
    color: #4a5163;
  }
  h1 {
    margin: 4px 0 0;
    font-size: 26px;
    font-weight: 750;
    letter-spacing: -0.025em;
    color: var(--text-strong);
  }
  .move {
    padding: 0 28px;
    box-shadow: 0 10px 28px rgba(60, 90, 220, 0.4);
  }
  main {
    position: relative;
    min-height: 0;
    display: grid;
    grid-template-columns: 1fr minmax(340px, 420px);
    gap: 24px;
  }
  .view {
    position: relative;
    min-height: 0;
    display: grid;
    grid-template-rows: 1fr auto;
    gap: 14px;
  }
  .hint {
    justify-self: start;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 9px 16px;
    border-radius: var(--radius-pill);
    font-size: 13px;
    font-weight: 550;
    color: #3b4254;
  }
  .swatch {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--tag-sale);
  }
  .sep {
    width: 1px;
    height: 14px;
    margin: 0 4px;
    background: var(--hairline);
  }
  .whole {
    position: absolute;
    top: 0;
    left: 0;
    animation: rise 320ms var(--ease) both;
  }
  .details {
    display: flex;
    flex-direction: column;
    gap: 18px;
    padding: 24px;
    align-self: start;
    color: var(--text-strong);
    animation: rise 520ms 80ms var(--ease) both;
  }
  .card {
    display: flex;
    flex-direction: column;
    gap: 8px;
    animation: swap 360ms var(--ease) both;
  }
  .details .eyebrow {
    color: #4a5163;
  }
  h2 {
    margin: 0;
    font-size: 26px;
    letter-spacing: -0.02em;
  }
  .house {
    color: var(--accent);
    font-size: 15px;
  }
  p {
    margin: 0;
    color: #4a5163;
    line-height: 1.5;
  }
  dl {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 6px 16px;
    margin: 8px 0;
    padding: 12px 14px;
    border-radius: var(--radius-md);
    background: rgba(29, 34, 48, 0.05);
  }
  dt {
    color: var(--text-muted);
  }
  dd {
    margin: 0;
    font-weight: 650;
  }
  ul {
    margin: 0;
    padding-left: 18px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .lot-size {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
  }
  .others {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding-top: 14px;
    border-top: 1px solid var(--hairline);
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .chip {
    padding: 7px 12px;
    border-radius: var(--radius-pill);
    background: rgba(29, 34, 48, 0.06);
    font-weight: 600;
    font-size: 13px;
    transition: background var(--fast) var(--ease);
  }
  .chip:hover {
    background: rgba(29, 34, 48, 0.12);
  }
  .chip.on {
    background: var(--accent);
    color: #fff;
  }
  @keyframes rise {
    from {
      opacity: 0;
      transform: translateY(12px);
    }
  }
  @keyframes swap {
    from {
      opacity: 0;
      transform: translateX(10px);
    }
  }
</style>
