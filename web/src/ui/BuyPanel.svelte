<script lang="ts">
  import type { ObjectDef } from '../content/content';
  import Icon from './Icon.svelte';
  import ItemCard from './buy/ItemCard.svelte';
  import ItemDetail from './buy/ItemDetail.svelte';
  import { collectionOf, loversOf, styledModel, styleOptions, summarize } from './buy/catalog';
  import { services } from './services';
  import { play } from './sfx';
  import { game } from './state.svelte';

  /**
   * Buy mode: the furniture catalog by category, plus the owned object picked on the lot.
   * (Walls, rooms, doors and windows are Build mode's: see `BuildPanel`.)
   */
  const content = services.content;
  const ALL = '';
  const OTHER = '·other';

  /** Content categories, plus "Other" for items whose category isn't listed. */
  const categories = (() => {
    const known = new Set(content.buyCategories.map((c) => c.id));
    const list = [...content.buyCategories];
    if (content.shop.some((o) => !known.has(o.category ?? ''))) list.push({ id: OTHER, label: 'Other' });
    return list;
  })();
  /** Each category's backdrop hue for its pictures (golden-angle steps from a warm start). */
  const hue = (id: string) => Math.round((Math.max(0, categories.findIndex((c) => c.id === id)) * 137.5 + 28) % 360);
  const known = new Set(content.buyCategories.map((c) => c.id));
  const categoryOf = (def: ObjectDef) => (known.has(def.category ?? '') ? def.category! : OTHER);
  const categoryLabel = (id: string) => categories.find((c) => c.id === id)?.label ?? '';

  type Sort = 'default' | 'cheap' | 'pricey' | 'name';
  const sorts: { id: Sort; label: string }[] = [
    { id: 'default', label: 'Featured' },
    { id: 'cheap', label: 'Price ↑' },
    { id: 'pricey', label: 'Price ↓' },
    { id: 'name', label: 'Name' },
  ];

  let category = $state(ALL);
  let query = $state('');
  let sort = $state<Sort>('default');
  let affordableOnly = $state(false);
  let lovedOnly = $state(false);
  /** The item last pointed at; it stays in the detail pane while the pointer is on the panel (so it can be turned). */
  let hovered = $state<string | null>(null);
  /**
   * The pointer came (back) to the panel. While something is in hand the catalog folds away, from
   * the moment it's picked, so the lot behind it is free to click; pointing at the panel opens it.
   */
  let over = $state(false);

  /** The household's residents, and who of them loves each item (by their traits). */
  const residents = $derived(game.roster.filter((s) => game.households[s.household]?.player));
  const lovers = $derived.by(() => {
    const map = new Map<string, string[]>();
    for (const def of content.shop) {
      const names = loversOf(content, def, residents);
      if (names.length) map.set(def.id, names);
    }
    return map;
  });
  /** How many styles each item comes in (most have one design: 0). */
  const styleCounts = new Map(content.shop.map((d) => [d.id, styleOptions(content, services.assets, d).length]));
  const styledItems = [...styleCounts.values()].filter((n) => n > 0).length;
  /** How many of each item stand on the home lot. */
  const owned = $derived.by(() => {
    const plot = game.households.find((h) => h.player)?.plot;
    const home = plot == null ? null : game.plots[plot];
    const map = new Map<string, number>();
    if (!home) return map;
    for (const o of game.objects) {
      if (o.x >= home.x && o.z >= home.z && o.x < home.x + home.w && o.z < home.z + home.d) map.set(o.def, (map.get(o.def) ?? 0) + 1);
    }
    return map;
  });

  const terms = $derived(query.trim().toLowerCase().split(/\s+/).filter(Boolean));
  /** Items passing the search, "Affordable" and "For us" filters, across all categories. */
  const matching = $derived(
    content.shop.filter((def) => {
      if (affordableOnly && (def.price ?? 0) > game.funds) return false;
      if (lovedOnly && !lovers.has(def.id)) return false;
      if (!terms.length) return true;
      const text = summarize(content, def).haystack;
      return terms.every((t) => text.includes(t));
    }),
  );
  const counts = $derived.by(() => {
    const map = new Map<string, number>();
    for (const def of matching) map.set(categoryOf(def), (map.get(categoryOf(def)) ?? 0) + 1);
    return map;
  });
  const items = $derived.by(() => {
    const list = category === ALL ? [...matching] : matching.filter((d) => categoryOf(d) === category);
    if (sort === 'cheap') list.sort((a, b) => (a.price ?? 0) - (b.price ?? 0));
    else if (sort === 'pricey') list.sort((a, b) => (b.price ?? 0) - (a.price ?? 0));
    else if (sort === 'name') list.sort((a, b) => a.name.localeCompare(b.name));
    return list;
  });

  const folded = $derived(!!game.placing && !over);
  const selected = $derived(game.buySelection === null ? null : (game.objects.find((o) => o.id === game.buySelection) ?? null));
  /** The card pointed at, else what's in hand, else the owned object picked on the lot. */
  const detail = $derived.by(() => {
    const hover = hovered && content.object(hovered);
    if (hover) return { def: hover, owned: null };
    const hand = game.placing && content.object(game.placing.def);
    if (hand) return { def: hand, owned: null };
    const def = selected && content.object(selected.def);
    return def ? { def, owned: selected } : null;
  });

  function pickCategory(id: string) {
    if (category !== id) play('tab');
    category = id;
    hovered = null;
  }

  function onSearchKey(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      if (query) query = '';
      else (e.currentTarget as HTMLInputElement).blur();
      e.stopPropagation();
    } else if (e.key === 'Enter') {
      if (items.length === 1) services.controls.startPlacing(items[0].id);
      (e.currentTarget as HTMLInputElement).blur();
    }
  }
</script>

{#if game.mode === 'buy'}
  <section class="buy glass" aria-label="Buy mode" onpointerenter={() => (over = true)} onpointerleave={() => ((over = false), (hovered = null))}>
    <header class="tabs">
      <div class="group shop" role="tablist" aria-label="Furniture">
        <button role="tab" aria-selected={category === ALL} class:active={category === ALL} onclick={() => pickCategory(ALL)}>
          <Icon name="icon.ui.buy" size={14} />All <small class="tabular">{matching.length}</small>
        </button>
        {#each categories as c (c.id)}
          {@const n = counts.get(c.id) ?? 0}
          <button
            role="tab"
            aria-selected={category === c.id}
            class:active={category === c.id}
            class:empty={n === 0}
            style="--hue:{hue(c.id)}"
            title={c.label}
            onclick={() => pickCategory(c.id)}
          >
            <span class="cat-icon"><Icon name={c.icon ?? 'icon.ui.buy'} size={14} /></span><span class="label">{c.label}</span>
            <small class="tabular">{n}</small>
          </button>
        {/each}
      </div>
    </header>

    <div class="drawer" class:folded>
      <div class="drawer-inner">
        <div class="filters">
          <label class="search">
            <Icon name="icon.ui.search" size={13} />
            <input type="search" placeholder="Search {content.shop.length} items — name, need, skill, personality…" bind:value={query} onkeydown={onSearchKey} />
          </label>
          <select class="sort" bind:value={sort} aria-label="Sort">
            {#each sorts as s (s.id)}<option value={s.id}>{s.label}</option>{/each}
          </select>
          <button class="chip" class:active={affordableOnly} aria-pressed={affordableOnly} onclick={() => (affordableOnly = !affordableOnly)}>Affordable</button>
          {#if lovers.size}
            <button
              class="chip love"
              class:active={lovedOnly}
              aria-pressed={lovedOnly}
              title="Things your household's personalities draw them to"
              onclick={() => (lovedOnly = !lovedOnly)}>♥ For us <small class="tabular">{lovers.size}</small></button
            >
          {/if}
          {#if content.styles.length > 1 && styledItems > 0}
            <div
              class="styles"
              title="{styledItems} pieces of furniture come in several designs (marked on their cards); the rest have one. New purchases come in the style you pick. Styles never change price or quality."
            >
              <span class="eyebrow">Style</span>
              {#each content.styles as st, i (st.id)}
                <button class="chip" class:active={game.householdStyle === i} onclick={() => (play('tab'), services.controls.setHouseholdStyle(i))}>{st.label}</button>
              {/each}
              <span class="styled-count"><Icon name="icon.skill.creativity" size={11} />{styledItems} items</span>
            </div>
          {/if}
        </div>

        <div class="body">
          {#key category}
            <ul class="items">
              {#each items as def, i (def.id)}
                <li style="--i:{Math.min(i, 16)}">
                  <ItemCard
                    {def}
                    model={styledModel(content, services.assets, def, game.householdStyle)}
                    affordable={game.funds >= (def.price ?? 0)}
                    active={game.placing?.def === def.id && game.placing.objectId === null}
                    category={category === ALL && terms.length ? categoryLabel(categoryOf(def)) : null}
                    owned={owned.get(def.id) ?? 0}
                    lovers={lovers.get(def.id) ?? []}
                    collection={collectionOf(content, def)}
                    styles={styleCounts.get(def.id) ?? 0}
                    tint={hue(categoryOf(def))}
                    onpick={() => ((over = false), services.controls.startPlacing(def.id))}
                    onpoint={() => (hovered = def.id)}
                  />
                </li>
              {:else}
                <li class="none muted">
                  {#if terms.length || affordableOnly || lovedOnly}
                    <span class="big">🔍</span>Nothing matches.
                    <button class="link" onclick={() => ((query = ''), (affordableOnly = false), (lovedOnly = false))}>Clear filters</button>
                  {:else}Nothing here yet.{/if}
                </li>
              {/each}
            </ul>
          {/key}
          <aside class="side">
            {#if detail}
              <ItemDetail def={detail.def} owned={detail.owned} />
            {:else}
              <div class="tip">
                <span class="tip-icon"><Icon name="icon.ui.buy" size={22} /></span>
                <p><b>Make it home.</b> Point at an item to turn it around and see what it's worth to your household — the needs it fills, the skills it trains and how it can make your residents feel.</p>
                {#if lovers.size}<p class="muted">Items marked <span class="heart">♥</span> suit someone's personality.</p>{/if}
              </div>
            {/if}
          </aside>
        </div>
      </div>
    </div>

    <footer class="muted">
      {#if game.placing}
        Click on your lot to place · <kbd>R</kbd> rotate · <kbd>Esc</kbd> put back{#if folded}<span class="peek">&nbsp;· point here for the catalog</span>{/if}
      {:else if selected}
        Upgrade, restyle or move it · <kbd>R</kbd> rotate · <kbd>Delete</kbd> sell · <kbd>Esc</kbd> deselect
      {:else}
        Pick something to buy, or click something you own to upgrade, move, restyle or sell it.
      {/if}
    </footer>
  </section>
{/if}

<style>
  .buy {
    position: absolute;
    left: 50%;
    bottom: var(--edge);
    transform: translateX(-50%);
    width: min(1180px, calc(100vw - 2 * var(--edge)));
    /* Never reach the top bar. */
    max-height: calc(100vh - 2 * var(--edge) - 64px);
    padding: 10px 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    pointer-events: auto;
    container-type: inline-size;
  }
  .tabs {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    align-items: flex-start;
  }
  .group {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 2px;
    padding: 3px;
    border-radius: var(--radius-md);
    background: var(--hairline);
  }
  .group.shop {
    flex: 1 1 0;
    min-width: 280px;
  }
  .group button {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    height: 28px;
    padding: 0 10px;
    border-radius: var(--radius-sm);
    font-weight: 600;
    font-size: 12px;
    color: var(--text-muted);
    white-space: nowrap;
    transition: background var(--fast) var(--ease), color var(--fast) var(--ease);
  }
  .group button:hover {
    color: var(--text);
  }
  .group button small {
    font-size: 10px;
    font-weight: 600;
    opacity: 0.7;
  }
  .group button.empty {
    opacity: 0.45;
  }
  .group button.active {
    background: var(--surface);
    color: var(--text);
    box-shadow: var(--shadow-sm);
  }
  .cat-icon {
    display: inline-grid;
    place-items: center;
    width: 20px;
    height: 20px;
    border-radius: 7px;
    background: hsl(var(--hue) 55% 90%);
    color: hsl(var(--hue) 45% 38%);
    transition: transform 260ms var(--ease);
  }
  .group button:hover .cat-icon {
    transform: rotate(-8deg) scale(1.08);
  }
  .group button.active .cat-icon {
    background: hsl(var(--hue) 60% 52%);
    color: #fff;
    transform: scale(1.06);
  }
  .filters {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
  }
  .search {
    flex: 1 1 220px;
    max-width: 380px;
    display: flex;
    align-items: center;
    gap: 6px;
    height: 30px;
    padding: 0 10px;
    border-radius: var(--radius-pill);
    background: var(--surface);
    border: 1px solid var(--hairline);
    color: var(--text-muted);
    transition: border-color var(--fast) var(--ease), box-shadow var(--fast) var(--ease);
  }
  .search:focus-within {
    border-color: var(--accent);
    box-shadow: 0 0 0 3px var(--accent-soft);
  }
  .search input {
    flex: 1;
    min-width: 0;
    border: 0;
    outline: none;
    background: none;
    font: inherit;
    font-size: 12px;
    color: var(--text);
    user-select: text;
  }
  .sort {
    height: 30px;
    padding: 0 8px;
    border-radius: var(--radius-pill);
    border: 1px solid var(--hairline);
    background: var(--surface);
    font: inherit;
    font-size: 12px;
    font-weight: 600;
    color: var(--text);
  }
  .styles {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: 4px;
    flex-wrap: wrap;
  }
  .chip {
    height: 26px;
    padding: 0 10px;
    border-radius: var(--radius-pill);
    background: var(--hairline);
    font-size: 12px;
    font-weight: 600;
    color: var(--text-muted);
  }
  .chip.active {
    background: var(--accent-soft);
    color: var(--accent);
  }
  .styled-count {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    padding-left: 2px;
    color: var(--text-muted);
    font-size: 11px;
    font-weight: 600;
  }
  .chip.love {
    color: #c2405f;
  }
  .chip.love.active {
    background: rgba(224, 96, 126, 0.16);
  }
  .chip small {
    font-size: 10px;
    opacity: 0.75;
  }
  /* While something is in hand, the catalog folds away unless the pointer comes back to it. */
  .drawer {
    display: grid;
    grid-template-rows: 1fr;
    transition:
      grid-template-rows var(--slow) var(--ease),
      opacity var(--slow) var(--ease);
  }
  .drawer.folded {
    grid-template-rows: 0fr;
    opacity: 0;
  }
  .drawer-inner {
    min-height: 0;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .body {
    display: flex;
    gap: 10px;
    min-height: 0;
    height: clamp(190px, 31vh, 420px);
  }
  .items {
    flex: 1;
    min-width: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(124px, 1fr));
    grid-auto-rows: 134px;
    gap: 8px;
    overflow-y: auto;
    overscroll-behavior: contain;
    margin: 0;
    padding: 4px 6px 6px 3px;
    list-style: none;
  }
  .items li {
    animation: deal 420ms var(--ease) backwards;
    animation-delay: calc(var(--i) * 20ms);
  }
  @keyframes deal {
    from {
      opacity: 0;
      transform: translateY(10px) scale(0.94);
    }
  }
  .items li.none {
    grid-column: 1 / -1;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px 4px;
  }
  .big {
    font-size: 18px;
  }
  .side {
    flex: none;
    width: 310px;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: 10px 12px;
    border-radius: var(--radius-sm);
    background: var(--surface);
  }
  .tip {
    display: flex;
    flex-direction: column;
    gap: 8px;
    font-size: 12px;
    line-height: 1.45;
  }
  .tip p {
    margin: 0;
  }
  .tip-icon {
    display: grid;
    place-items: center;
    width: 40px;
    height: 40px;
    border-radius: 12px;
    background: var(--accent-soft);
    color: var(--accent);
  }
  .heart {
    color: #e0607e;
  }
  .peek {
    color: var(--accent);
  }
  @container (max-width: 1020px) {
    .group.shop .label {
      display: none;
    }
  }
  @container (max-width: 760px) {
    .body {
      flex-direction: column;
      height: auto;
    }
    .items {
      max-height: 26vh;
    }
    .side {
      width: auto;
      max-height: 22vh;
    }
  }
  .link {
    color: var(--accent);
    font-weight: 600;
  }
  .muted {
    color: var(--text-muted);
    font-size: 12px;
  }
  kbd {
    padding: 0 5px;
    border-radius: 4px;
    background: var(--hairline);
    font-family: inherit;
    font-size: 11px;
  }
</style>
