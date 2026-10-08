<script lang="ts">
  import Icon from '../Icon.svelte';
  import { money } from '../format';
  import { services } from '../services';
  import { game, type BuildTool } from '../state.svelte';

  /** The Build section of the catalog: walls, doors, windows and removing them, on the home lot. */
  const prices = $derived(game.catalog?.build);
  const tools: { id: BuildTool; label: string; icon: string; hint: string; unit: string }[] = [
    { id: 'wall', label: 'Walls', icon: 'icon.ui.wall', hint: 'Drag from a corner to draw a wall; drag at 45° for a diagonal one. Or click a corner, then another. Esc or right-click cancels.', unit: '/m' },
    { id: 'door', label: 'Doors', icon: 'icon.ui.door', hint: 'Click a wall, straight or diagonal, to put a door in it.', unit: '' },
    { id: 'window', label: 'Windows', icon: 'icon.ui.window', hint: 'Click a wall, straight or diagonal, to put a window in it.', unit: '' },
    { id: 'remove', label: 'Remove', icon: 'icon.ui.eraser', hint: 'Drag along walls (straight or at 45°) to tear down walls, doors and windows. Esc or right-click cancels.', unit: '/m' },
  ];
  const price = (id: BuildTool) => (prices ? (prices[id] ?? 0) : 0);
  const tool = $derived(tools.find((t) => t.id === game.buildTool) ?? tools[0]);
</script>

<div class="build">
  <div class="tools" role="radiogroup" aria-label="Build tool">
    {#each tools as t (t.id)}
      <button role="radio" aria-checked={game.buildTool === t.id} class:active={game.buildTool === t.id} onclick={() => services.controls.setBuildTool(t.id)}>
        <Icon name={t.icon} size={22} />
        <span>{t.label}</span>
        <small class="tabular">{money(price(t.id))}{t.unit}</small>
      </button>
    {/each}
  </div>
  <div class="info">
    <p class="hint">{tool.hint}</p>
    <p class="cost">
      {#if game.buildCost > 0}
        <span class="muted">This edit</span> <b class="tabular" class:short={game.buildCost > game.funds}>{money(game.buildCost)}</b>
        {#if game.buildCost > game.funds}<span class="short"> — can't afford</span>{/if}
      {:else}
        <span class="muted">Hover your lot to see the cost.</span>
      {/if}
    </p>
    {#if game.buildTool === 'wall' && prices}
      <p class="muted">A diagonal wall costs <span class="tabular">{money(prices.diagonalWall ?? Math.round(prices.wall * 1.414))}</span> per tile. Furniture can't stand on tiles a diagonal crosses.</p>
    {/if}
    <p class="muted">Draw the walls first, then add a door. Residents and furniture can't be shut in.</p>
  </div>
</div>

<style>
  .build {
    display: flex;
    gap: 12px;
    align-items: stretch;
    flex-wrap: wrap;
  }
  .tools {
    flex: 1 1 360px;
    display: flex;
    gap: 6px;
  }
  .tools button {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 3px;
    padding: 12px 8px;
    border-radius: var(--radius-md);
    background: var(--surface);
    box-shadow: var(--shadow-sm);
    color: var(--text-muted);
    font-weight: 650;
    font-size: 13px;
    transition: box-shadow var(--fast) var(--ease), color var(--fast) var(--ease);
  }
  .tools button:hover {
    color: var(--text);
  }
  .tools button.active {
    color: var(--build);
    box-shadow: 0 0 0 2px var(--build);
  }
  small {
    font-weight: 600;
    font-size: 11px;
    color: var(--good);
  }
  .info {
    flex: 1 1 240px;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 4px;
    padding: 8px 12px;
    border-radius: var(--radius-sm);
    background: var(--surface);
    font-size: 12px;
  }
  p {
    margin: 0;
  }
  .hint {
    font-size: 13px;
    font-weight: 600;
  }
  .cost b {
    color: var(--good);
  }
  .short {
    color: var(--bad) !important;
  }
  .muted {
    color: var(--text-muted);
  }
</style>
