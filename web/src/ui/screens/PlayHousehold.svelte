<script lang="ts">
  /**
   * New game, the other path from step 1: play a household that already lives in town. Shows who
   * they are and where they live; starting flies the camera into their lot, like Move in.
   */
  import { onMount } from 'svelte';
  import { menuScene } from '../../game/menuScene';
  import { houseTemplate, loadTemplates, type Templates } from '../../game/town';
  import { app } from '../app.svelte';
  import { money } from '../format';
  import Icon from '../Icon.svelte';
  import SimPreview from '../kit/SimPreview.svelte';
  import TownStage, { type LotLabel } from '../kit/TownStage.svelte';
  import { services } from '../services';

  const { content } = services;
  let templates = $state.raw<Templates | null>(null);
  const town = app.town!;
  const homes = town.households.map((h) => h.slot);
  let slot = $state<number | null>(homes.includes(app.playSlot ?? -1) ? app.playSlot : (homes[0] ?? null));
  let hover = $state<number | null>(null);
  /** The camera is on their lot (false: the whole town). */
  let close = $state(true);
  $effect(() => {
    app.playSlot = slot;
  });

  const chosen = $derived(town.households.find((h) => h.slot === slot));
  const address = $derived(slot !== null ? town.slots[slot] : null);
  const house = $derived(templates && address ? houseTemplate(templates, address.template) : undefined);
  const neighbours = $derived(
    address
      ? town.households
          .filter((h) => h.slot !== slot)
          .map((h) => ({ ...h, distance: Math.hypot(town.slots[h.slot].x - address.x, town.slots[h.slot].z - address.z) }))
          .sort((a, b) => a.distance - b.distance)
          .slice(0, 3)
      : [],
  );

  const labels = $derived<LotLabel[]>(
    town.slots.map((s) => {
      const h = town.households.find((x) => x.slot === s.index);
      if (s.kind === 'park') return { plot: s.index, title: s.name, kind: 'park' };
      if (h) return { plot: s.index, title: `The ${h.household.name}s`, sub: s.index === slot ? 'Your household' : s.name, kind: s.index === slot ? 'mine' : 'home' };
      return { plot: s.index, title: 'For sale', kind: 'sale' };
    }),
  );

  /** "Partner of Ben" for members in a couple. */
  function partner(uid: string): string | undefined {
    const h = chosen?.household;
    const bond = h?.bonds.find((b) => b.preset === 'partners' && (b.a === uid || b.b === uid));
    const other = bond && h?.members.find((m) => m.uid === (bond.a === uid ? bond.b : bond.a));
    return other ? `Partner of ${other.name}` : undefined;
  }

  function choose(plot: number | null) {
    if (plot === null || !homes.includes(plot)) {
      close = false;
      return;
    }
    slot = plot;
    close = true;
  }

  function play() {
    if (!chosen) return;
    menuScene.highlight({});
    app.start({ kind: 'new', town, household: chosen.household, slot: chosen.slot, existing: true });
  }

  onMount(async () => {
    templates = await loadTemplates();
  });

  void menuScene.show(town);
  $effect(() => {
    menuScene.highlight({ hover, selected: slot, marked: [], outlines: false });
  });

  /** Keeps lot tags clear of this element. */
  const avoid = (el: HTMLElement) => ({ destroy: menuScene.avoid(el) });
</script>

<div class="screen scaled">
  <div class="haze" aria-hidden="true"></div>
  <header>
    <button class="btn ghost back" onclick={() => (app.screen = 'neighbourhood')}><Icon name="icon.ui.back" size={18} /> Neighbourhood</button>
    <div class="title">
      <span class="eyebrow">Play a household · {town.name}</span>
      <h1>{chosen ? `Meet the ${chosen.household.name}s` : 'Nobody lives here yet'}</h1>
    </div>
    {#if chosen}
      {#key chosen.slot}
        <button class="btn primary large go" onclick={play}>Play the {chosen.household.name}s →</button>
      {/key}
    {/if}
  </header>

  <main>
    <section class="view">
      <TownStage
        {labels}
        {hover}
        selected={slot}
        focus={close ? slot : null}
        selectable={(p) => homes.includes(p)}
        onhover={(p) => (hover = p)}
        onselect={choose}
      />
      <div class="hint menu-glass" aria-hidden="true" use:avoid>
        Click another home to meet its household · drag to turn · scroll to zoom
      </div>
      {#if close && homes.length > 1}
        <button class="btn whole" use:avoid onclick={() => (close = false)}><Icon name="icon.ui.town" size={16} /> Whole town</button>
      {/if}
    </section>

    <aside class="details menu-glass">
      {#if chosen && address}
        {#key chosen.slot}
          <div class="card">
            <span class="eyebrow">{address.name}{house ? ` · ${house.name}` : ''}</span>
            <h2>The {chosen.household.name}s</h2>
            <ul class="members">
              {#each chosen.household.members as m (m.uid)}
                {@const bond = partner(m.uid)}
                <li>
                  <span class="face"><SimPreview appearance={m.appearance} gender={m.gender} size={60} /></span>
                  <span class="who">
                    <b>{m.name}</b>
                    {#if bond}<span class="bond">{bond}</span>{/if}
                    <span class="tags">
                      {#each m.traits as t (t)}<span class="trait">{content.trait(t)?.label ?? t}</span>{/each}
                      {#each m.perks as p (p)}<span class="perk">{content.perk(p)?.label ?? p}</span>{/each}
                    </span>
                  </span>
                </li>
              {/each}
            </ul>
            <dl>
              <dt>Home</dt>
              <dd>{house ? `${house.name}, ${house.bedrooms} bedroom${house.bedrooms === 1 ? '' : 's'}` : address.name}</dd>
              <dt>Household funds</dt>
              <dd>{money(content.economy.startingFunds)}</dd>
            </dl>
            <p class="note">Settled residents: most already have a job and know a few of the neighbours.</p>
            {#if neighbours.length}
              <span class="eyebrow">Closest neighbours</span>
              <ul class="near">
                {#each neighbours as n (n.slot)}
                  <li><b>The {n.household.name}s</b> · {town.slots[n.slot].name}</li>
                {/each}
              </ul>
            {/if}
          </div>
        {/key}
        {#if homes.length > 1}
          <div class="others">
            <span class="eyebrow">Or play</span>
            <div class="chips">
              {#each town.households as h (h.slot)}
                <button
                  class="chip"
                  class:on={h.slot === slot}
                  aria-pressed={h.slot === slot}
                  onmouseenter={() => (hover = h.slot)}
                  onmouseleave={() => (hover = null)}
                  onclick={() => choose(h.slot)}
                >
                  The {h.household.name}s
                </button>
              {/each}
            </div>
          </div>
        {/if}
      {:else}
        <p>Nobody lives in this town yet. Go back and add neighbours, or create your own household.</p>
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
  .go {
    padding: 0 28px;
    box-shadow: 0 10px 28px rgba(60, 90, 220, 0.4);
    animation: swap 360ms var(--ease) both;
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
    padding: 9px 16px;
    border-radius: var(--radius-pill);
    font-size: 13px;
    font-weight: 550;
    color: #3b4254;
  }
  .whole {
    position: absolute;
    top: 0;
    left: 0;
    animation: rise 320ms var(--ease) both;
  }
  .details {
    min-height: 0;
    max-height: 100%;
    overflow: auto;
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
    margin: 0 0 4px;
    font-size: 26px;
    letter-spacing: -0.02em;
  }
  .members {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .members li {
    display: flex;
    align-items: center;
    gap: 14px;
  }
  .face {
    flex: none;
    width: 60px;
    height: 60px;
    border-radius: 50%;
    overflow: hidden;
    background: var(--surface-muted);
    border: 2px solid var(--surface);
    box-shadow: var(--shadow-sm);
    display: grid;
    place-items: start center;
  }
  .who {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .who b {
    font-size: 16px;
  }
  .bond {
    font-size: 12px;
    font-weight: 600;
    color: var(--accent);
  }
  .tags {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .trait,
  .perk {
    padding: 2px 8px;
    border-radius: var(--radius-pill);
    font-size: 12px;
    font-weight: 600;
    background: rgba(29, 34, 48, 0.06);
    color: #3b4254;
  }
  .perk {
    background: rgba(233, 162, 59, 0.16);
  }
  dl {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 6px 16px;
    margin: 8px 0 0;
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
  p {
    margin: 0;
    color: #4a5163;
    line-height: 1.5;
  }
  .note {
    font-size: 13px;
    margin-bottom: 6px;
  }
  .near {
    margin: 0;
    padding-left: 18px;
    display: flex;
    flex-direction: column;
    gap: 4px;
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
