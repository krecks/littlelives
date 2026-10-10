<script lang="ts">
  import Icon from '../Icon.svelte';
  import { money } from '../format';
  import { services } from '../services';
  import { play } from '../sfx';
  import { game, type BuildTool } from '../state.svelte';
  import Blueprints from './Blueprints.svelte';
  import LookPicker from './LookPicker.svelte';

  /** Build mode's tools: walls, rooms, paint, floors, doors, windows, stairs and removing them, on the home lot. */
  const content = services.content;
  const prices = $derived(game.catalog?.build);
  const tools: { id: BuildTool; label: string; icon: string; unit: string; steps: string[] }[] = [
    { id: 'wall', label: 'Wall', icon: 'icon.ui.wall', unit: '/m', steps: ['Press on a corner', 'Drag along the grid — at 45° for a diagonal', 'Let go to build'] },
    { id: 'room', label: 'Room', icon: 'icon.ui.room', unit: '/m', steps: ['Press on a corner', 'Drag out a rectangle', 'Let go, then add a door'] },
    { id: 'fence', label: 'Fence', icon: 'icon.ui.fence', unit: '/m', steps: ['Press on a corner', 'Drag along the grid', 'Let go, then add a gate'] },
    { id: 'gate', label: 'Gate', icon: 'icon.ui.gate', unit: '', steps: ['Point at a fence (or open ground)', 'Click to fit a gate'] },
    { id: 'paint', label: 'Paint', icon: 'icon.skill.creativity', unit: '', steps: ['Pick a covering', 'Click the side of a wall — or drag along walls', 'Shift-click: a whole room'] },
    { id: 'floor', label: 'Floor', icon: 'icon.ui.floor', unit: '', steps: ['Pick a floor', 'Click a tile — or drag over several', 'Shift-click: a whole room'] },
    { id: 'door', label: 'Door', icon: 'icon.ui.door', unit: '', steps: ['Point at a wall, straight or diagonal', 'Click to fit a door'] },
    { id: 'window', label: 'Window', icon: 'icon.ui.window', unit: '', steps: ['Point at a wall, straight or diagonal', 'Click to fit a window'] },
    { id: 'stairs', label: 'Stairs', icon: 'icon.ui.stairs', unit: '', steps: ['Build the storey above first', 'Click where the stairs start — R turns them', 'Click your stairs to move them; Delete sells them'] },
    { id: 'roof', label: 'Roof', icon: 'icon.ui.roof', unit: '', steps: ['Pick a roof shape', 'Pick a colour', 'It changes at once'] },
    { id: 'remove', label: 'Remove', icon: 'icon.ui.eraser', unit: '/m', steps: ['Click a door or window to wall it up', 'Or drag along walls', 'Let go to tear them down'] },
    { id: 'move', label: 'Move', icon: 'icon.ui.move', unit: '', steps: ['Point at a room', 'Drag it where it should go', 'Let go to move it'] },
    { id: 'blueprint', label: 'Blueprints', icon: 'icon.ui.blueprint', unit: '', steps: ['Save the house you built', 'Clear a lot (or start on an empty one)', 'Build a blueprint on it'] },
  ];
  /** What the tool costs with the look picked (per metre for walls, per face for paint, per tile for floors). */
  const price = (id: BuildTool): string => {
    if (!prices) return '';
    if (id === 'blueprint') return '';
    if (game.creative || id === 'roof' || id === 'move') return 'Free';
    if (id === 'stairs') {
      const stairs = content.shop.find((d) => d.stairs)?.price ?? 0;
      return stairs ? money(stairs) : 'Free';
    }
    const look = game.buildLook;
    const p =
      id === 'wall' || id === 'room'
        ? prices.wall
        : id === 'paint'
          ? look.cover
            ? (content.wallCoverings[look.cover - 1]?.price ?? 0)
            : 0
          : id === 'floor'
            ? look.floor
              ? (content.floorCoverings[look.floor - 1]?.price ?? 0)
              : 0
            : id === 'fence'
              ? (content.fenceStyles[look.fence]?.price ?? prices.fence ?? 0)
              : id === 'gate'
                ? (content.fenceStyles[look.fence]?.price ?? prices.fence ?? 0) + (prices.gate ?? 0)
            : id === 'door'
              ? (content.doorStyles[look.door]?.price ?? prices.door)
              : id === 'window'
                ? (content.windowStyles[look.window]?.price ?? prices.window)
                : prices.remove;
    return p ? money(p) : 'Free';
  };
  const tool = $derived(tools.find((t) => t.id === game.buildTool) ?? tools[0]);
  const short = $derived(!game.affords(game.buildCost));

  function pick(id: BuildTool) {
    play('tab');
    services.controls.setBuildTool(id);
  }
</script>

<div class="build">
  <div class="tools" role="radiogroup" aria-label="Build tool">
    {#each tools as t (t.id)}
      <button role="radio" aria-checked={game.buildTool === t.id} class:active={game.buildTool === t.id} onclick={() => pick(t.id)}>
        <span class="badge"><Icon name={t.icon} size={22} /></span>
        <span class="label">{t.label}</span>
        <small class="tabular">{price(t.id)}{price(t.id) === 'Free' ? '' : t.unit}</small>
      </button>
    {/each}
  </div>
  <div class="info">
    {#key tool.id}
      <ol class="steps">
        {#each tool.steps as step, i (i)}
          <li style="--i:{i}"><span class="n">{i + 1}</span>{step}</li>
        {/each}
      </ol>
    {/key}
    <div class="cost">
      {#if game.buildTool === 'paint' && game.paintFaces > 0}
        <span class="muted">{game.paintFaces} {game.paintFaces === 1 ? 'face' : 'faces'}</span>
        {#key game.buildCost}<b class="tabular" class:short>{game.buildCost ? money(game.buildCost) : 'Free'}</b>{/key}
        {#if short}<span class="short">— {money(game.buildCost - game.funds)} short</span>{/if}
      {:else if game.buildTool === 'floor' && game.floorTiles > 0}
        <span class="muted">{game.floorTiles} {game.floorTiles === 1 ? 'tile' : 'tiles'}</span>
        {#key game.buildCost}<b class="tabular" class:short>{game.buildCost ? money(game.buildCost) : 'Free'}</b>{/key}
        {#if short}<span class="short">— {money(game.buildCost - game.funds)} short</span>{/if}
      {:else if game.buildTool === 'stairs'}
        {#if game.placing && !game.placeValid && game.placeHint}
          <span class="short">{game.placeHint}</span>
        {:else if !game.placing}
          <span class="muted">Click your stairs to move them, or anywhere on your lot for a new staircase.</span>
        {/if}
      {:else if game.buildCost > 0}
        <span class="muted">This edit</span>
        {#key game.buildCost}<b class="tabular" class:short>{money(game.buildCost)}</b>{/key}
        {#if short}<span class="short">— {money(game.buildCost - game.funds)} short</span>{/if}
      {:else if game.buildTool !== 'roof' && game.buildTool !== 'move' && game.buildTool !== 'blueprint'}
        <span class="muted">Point at your lot to see what it costs.</span>
      {/if}
    </div>
    <p class="muted">
      {#if game.buildTool === 'wall' && prices}
        A diagonal wall {game.creative ? 'is free' : `costs ${money(prices.diagonalWall ?? Math.round(prices.wall * 1.414))} a tile`}; furniture can't stand on tiles it crosses.
      {:else if game.buildTool === 'room'}
        An empty room can be closed off; residents and furniture can't be shut in.
      {:else if game.buildTool === 'paint'}
        Each side of a wall has its own covering.
      {:else if game.buildTool === 'floor'}
        Floors go inside rooms; every tile can have its own.
      {:else if game.buildTool === 'remove'}
        Doors, windows and gates are closed up again; residents and furniture can't be shut in.
      {:else if game.buildTool === 'roof'}
        The roof covers every room of the house. Changing it is free.
      {:else if game.buildTool === 'fence' || game.buildTool === 'gate'}
        Fences keep a garden outdoors (no floor, no roof); leave a gate so nobody is shut in.
      {:else if game.buildTool === 'door' || game.buildTool === 'window'}
        Doors and windows go into full-height walls; pick another style to replace one.
      {:else if game.buildTool === 'stairs'}
        Stairs lead up to the storey above and are climbed from the front; nothing can stand on the steps or where they come up.
      {:else if game.buildTool === 'move'}
        The room's walls, doors, windows, floor and furniture come along; walls it shares with another room stay.
      {:else if game.buildTool === 'blueprint'}
        A blueprint is built all at once, turned to face the street, and paid like building it by hand.
      {:else}
        Residents and furniture can't be shut in.
      {/if}
      <kbd>Esc</kbd> or right-click cancels.
    </p>
  </div>
  <div class="look">
    {#if game.buildTool === 'blueprint'}<Blueprints />{:else}<LookPicker tool={game.buildTool} />{/if}
  </div>
</div>

<style>
  .build {
    display: flex;
    gap: 12px;
    align-items: stretch;
    flex-wrap: wrap;
  }
  .look {
    flex: 1 1 100%;
    min-width: 0;
  }
  .tools {
    flex: 1 1 460px;
    display: flex;
    gap: 6px;
  }
  .tools button {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 4px;
    padding: 12px 6px 10px;
    border-radius: var(--radius-md);
    background: var(--surface);
    box-shadow: var(--shadow-sm);
    color: var(--text-muted);
    font-weight: 650;
    font-size: 13px;
    transition:
      box-shadow var(--fast) var(--ease),
      color var(--fast) var(--ease),
      transform 220ms var(--ease);
  }
  .tools button:hover {
    color: var(--text);
    transform: translateY(-2px);
  }
  .tools button:active {
    transform: scale(0.96);
  }
  .badge {
    display: grid;
    place-items: center;
    width: 42px;
    height: 42px;
    border-radius: 14px;
    background: var(--build-soft);
    color: var(--build);
    transition:
      transform 320ms var(--ease),
      background var(--fast) var(--ease);
  }
  .tools button:hover .badge {
    transform: rotate(-6deg) scale(1.06);
  }
  .tools button.active {
    color: var(--build);
    box-shadow:
      0 0 0 2px var(--build),
      var(--shadow-md);
  }
  .tools button.active .badge {
    background: var(--build);
    color: #fff;
    animation: bounce 420ms var(--ease);
  }
  small {
    font-weight: 600;
    font-size: 11px;
    color: var(--good);
  }
  .info {
    flex: 1 1 280px;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 6px;
    padding: 10px 14px;
    border-radius: var(--radius-sm);
    background: var(--surface);
    font-size: 12px;
  }
  .steps {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-wrap: wrap;
    gap: 4px 12px;
    font-size: 13px;
    font-weight: 600;
  }
  .steps li {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    animation: step 360ms var(--ease) backwards;
    animation-delay: calc(var(--i) * 70ms);
  }
  .n {
    display: inline-grid;
    place-items: center;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: var(--build-soft);
    color: var(--build);
    font-size: 11px;
    font-weight: 750;
  }
  .cost {
    display: flex;
    align-items: baseline;
    gap: 6px;
  }
  .cost b {
    display: inline-block;
    color: var(--good);
    font-size: 16px;
    animation: tick 260ms var(--ease);
  }
  p {
    margin: 0;
  }
  .short {
    color: var(--bad) !important;
    font-weight: 600;
  }
  .muted {
    color: var(--text-muted);
  }
  kbd {
    padding: 0 5px;
    border-radius: 4px;
    background: var(--hairline);
    font-family: inherit;
    font-size: 11px;
  }
  @keyframes bounce {
    40% {
      transform: scale(1.18) rotate(-4deg);
    }
  }
  @keyframes step {
    from {
      opacity: 0;
      transform: translateX(-6px);
    }
  }
  @keyframes tick {
    from {
      transform: translateY(-3px) scale(1.1);
    }
  }
</style>
