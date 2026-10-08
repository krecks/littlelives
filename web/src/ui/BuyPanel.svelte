<script lang="ts">
  import type { ObjectDef } from '../content/content';
  import Icon from './Icon.svelte';
  import BuildTools from './buy/BuildTools.svelte';
  import ItemCard from './buy/ItemCard.svelte';
  import ItemDetail from './buy/ItemDetail.svelte';
  import { summarize } from './buy/catalog';
  import { services } from './services';
  import { game, type BuildTool } from './state.svelte';

  /**
   * Buy mode: one catalog for everything the household can buy — build tools (walls, doors,
   * windows, removal) and furniture by category — plus the owned object picked on the lot.
   */
  const content = services.content;
  const ALL = '';
  const OTHER = '·other';

  const buildTabs: { id: BuildTool; label: string; icon: string }[] = [
    { id: 'wall', label: 'Walls', icon: 'icon.ui.wall' },
    { id: 'door', label: 'Doors', icon: 'icon.ui.door' },
    { id: 'window', label: 'Windows', icon: 'icon.ui.window' },
    { id: 'remove', label: 'Remove', icon: 'icon.ui.eraser' },
  ];
  /** Content categories, plus "Other" for items whose category isn't listed. */
  const categories = (() => {
    const known = new Set(content.buyCategories.map((c) => c.id));
    const list = [...content.buyCategories];
    if (content.shop.some((o) => !known.has(o.category ?? ''))) list.push({ id: OTHER, label: 'Other' });
    return list;
  })();
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
  let hovered = $state<string | null>(null);

  const terms = $derived(query.trim().toLowerCase().split(/\s+/).filter(Boolean));
  /** Items passing the search and "affordable only" filters, across all categories. */
  const matching = $derived(
    content.shop.filter((def) => {
      if (affordableOnly && (def.price ?? 0) > game.funds) return false;
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

  const building = $derived(game.buildTool !== null);
  const selected = $derived(game.buySelection === null ? null : (game.objects.find((o) => o.id === game.buySelection) ?? null));
  /** Hovered card, else what's in hand, else the owned object picked on the lot. */
  const detail = $derived.by(() => {
    const hover = hovered && content.object(hovered);
    if (hover) return { def: hover, owned: null };
    const hand = game.placing && content.object(game.placing.def);
    if (hand) return { def: hand, owned: null };
    const def = selected && content.object(selected.def);
    return def ? { def, owned: selected } : null;
  });

  function pickCategory(id: string) {
    category = id;
    if (building) services.controls.setBuildTool(null);
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
  <section class="buy glass" aria-label="Buy mode">
    <header class="tabs">
      <div class="group build" role="radiogroup" aria-label="Build">
        <span class="eyebrow">Build</span>
        {#each buildTabs as t (t.id)}
          <button role="radio" aria-checked={game.buildTool === t.id} class:active={game.buildTool === t.id} onclick={() => services.controls.setBuildTool(t.id)}>
            <Icon name={t.icon} size={14} />{t.label}
          </button>
        {/each}
      </div>
      <div class="group shop" role="tablist" aria-label="Furniture">
        <span class="eyebrow">Buy</span>
        <button role="tab" aria-selected={!building && category === ALL} class:active={!building && category === ALL} onclick={() => pickCategory(ALL)}>
          All <small class="tabular">{matching.length}</small>
        </button>
        {#each categories as c (c.id)}
          {@const n = counts.get(c.id) ?? 0}
          <button role="tab" aria-selected={!building && category === c.id} class:active={!building && category === c.id} class:empty={n === 0} onclick={() => pickCategory(c.id)}>
            {c.label} <small class="tabular">{n}</small>
          </button>
        {/each}
      </div>
    </header>

    {#if building}
      <BuildTools />
    {:else}
      <div class="filters">
        <label class="search">
          <span aria-hidden="true">⌕</span>
          <input type="search" placeholder="Search {content.shop.length} items — name, need, skill…" bind:value={query} onkeydown={onSearchKey} />
        </label>
        <select class="sort" bind:value={sort} aria-label="Sort">
          {#each sorts as s (s.id)}<option value={s.id}>{s.label}</option>{/each}
        </select>
        <button class="chip" class:active={affordableOnly} aria-pressed={affordableOnly} onclick={() => (affordableOnly = !affordableOnly)}>Affordable only</button>
        {#if content.styles.length > 1}
          <div class="styles" title="Your favourite look for new purchases. Looks never change price or quality.">
            <span class="eyebrow">Style</span>
            {#each content.styles as s, i (s.id)}
              <button class="chip" class:active={game.householdStyle === i} onclick={() => services.controls.setHouseholdStyle(i)}>{s.label}</button>
            {/each}
          </div>
        {/if}
      </div>

      <div class="body">
        <ul class="items">
          {#each items as def (def.id)}
            <li>
              <ItemCard
                {def}
                affordable={game.funds >= (def.price ?? 0)}
                active={game.placing?.def === def.id && game.placing.objectId === null}
                category={category === ALL && terms.length ? categoryLabel(categoryOf(def)) : null}
                onpick={() => services.controls.startPlacing(def.id)}
                onhover={(on) => (hovered = on ? def.id : hovered === def.id ? null : hovered)}
              />
            </li>
          {:else}
            <li class="none muted">
              {#if terms.length || affordableOnly}Nothing matches.
                <button class="link" onclick={() => ((query = ''), (affordableOnly = false))}>Clear filters</button>
              {:else}Nothing here yet.{/if}
            </li>
          {/each}
        </ul>
        <aside class="side">
          {#if detail}
            <ItemDetail def={detail.def} owned={detail.owned} />
          {:else}
            <p class="muted tip">Point at an item to see what it's worth to your household — the needs it fills, the skills it trains and how it can make your residents feel.</p>
          {/if}
        </aside>
      </div>
    {/if}

    <footer class="muted">
      {#if game.placing}
        Click on your lot to place · <kbd>R</kbd> rotate · <kbd>Esc</kbd> put back
      {:else if building}
        <kbd>Esc</kbd> back to the catalog · <kbd>L</kbd> Live mode
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
    --build: #c9772b;
    --build-soft: rgba(201, 119, 43, 0.14);
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
  .group .eyebrow {
    padding: 0 8px 0 7px;
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
  .group.build {
    background: var(--build-soft);
  }
  .group.build .eyebrow {
    color: var(--build);
  }
  .group.build button.active {
    color: var(--build);
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
  .body {
    display: flex;
    gap: 10px;
    min-height: 0;
    height: clamp(150px, 26vh, 380px);
  }
  .items {
    flex: 1;
    min-width: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(176px, 1fr));
    grid-auto-rows: 62px;
    gap: 6px;
    overflow-y: auto;
    overscroll-behavior: contain;
    margin: 0;
    padding: 2px 4px 4px 2px;
    list-style: none;
  }
  .items li {
    content-visibility: auto;
    contain-intrinsic-size: auto 62px;
  }
  .items li.none {
    grid-column: 1 / -1;
    padding: 12px 4px;
    content-visibility: visible;
  }
  .side {
    flex: none;
    width: 300px;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: 10px 12px;
    border-radius: var(--radius-sm);
    background: var(--surface);
  }
  .tip {
    margin: 0;
    line-height: 1.4;
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
