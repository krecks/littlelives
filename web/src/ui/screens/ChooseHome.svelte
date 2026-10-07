<script lang="ts">
  import { onMount } from 'svelte';
  import { houseTemplate, loadTemplates, vacantSlots, type PlotSlot, type Templates } from '../../game/town';
  import { app } from '../app.svelte';
  import Icon from '../Icon.svelte';
  import TownMap from '../kit/TownMap.svelte';

  let templates = $state.raw<Templates | null>(null);
  const town = app.town!;
  const household = app.household!;
  const vacant = vacantSlots(town);
  let selected = $state<PlotSlot | null>(vacant.find((v) => v.index === app.homeSlot) ?? vacant[0] ?? null);
  $effect(() => {
    app.homeSlot = selected?.index ?? null;
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

  onMount(async () => (templates = await loadTemplates()));
</script>

<div class="screen scaled">
  <header>
    <button class="btn ghost" onclick={() => (app.screen = 'create')}><Icon name="icon.ui.back" size={18} /> Household</button>
    <div class="title">
      <span class="eyebrow">Step 3 of 3 · Choose a home</span>
      <h1>Where will the {household.name}s live?</h1>
    </div>
    <button
      class="btn primary"
      disabled={!selected}
      onclick={() => selected && app.start({ kind: 'new', town, household, slot: selected.index })}
    >
      Move in →
    </button>
  </header>

  {#if templates}
    <main>
      <TownMap
        {town}
        {templates}
        selectable={(s) => vacant.some((v) => v.index === s.index)}
        selected={selected?.index ?? null}
        onselect={(s) => (selected = s)}
        playerSlot={selected?.index ?? null}
        playerName={household.name}
      />
      <aside class="details glass">
        {#if selected && house}
          <span class="eyebrow">{town.name}</span>
          <h2>{selected.name}</h2>
          <b class="house">{house.name}</b>
          <p>{house.description}</p>
          <dl>
            <dt>Bedrooms</dt>
            <dd>{house.bedrooms}</dd>
            <dt>Your household</dt>
            <dd>{household.members.map((m) => m.name).join(', ')}</dd>
          </dl>
          {#if neighbours.length}
            <span class="eyebrow">Closest neighbours</span>
            <ul>
              {#each neighbours as n (n.slot)}
                <li><b>The {n.household.name}s</b> · {town.slots[n.slot].name}</li>
              {/each}
            </ul>
          {/if}
        {:else}
          <p>Every house is taken. Go back and remove a neighbour household.</p>
        {/if}
      </aside>
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
  }
  h1 {
    margin: 4px 0 0;
    font-size: 22px;
    letter-spacing: -0.02em;
  }
  main {
    min-height: 0;
    display: grid;
    grid-template-columns: 1.6fr 1fr;
    gap: 24px;
    align-items: start;
  }
  .details {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 22px;
  }
  h2 {
    margin: 0;
    font-size: 24px;
    letter-spacing: -0.02em;
  }
  .house {
    color: var(--accent);
  }
  p {
    margin: 0;
    color: var(--text-muted);
    line-height: 1.5;
  }
  dl {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 6px 16px;
    margin: 8px 0;
  }
  dt {
    color: var(--text-muted);
  }
  dd {
    margin: 0;
    font-weight: 600;
  }
  ul {
    margin: 0;
    padding-left: 18px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
</style>
