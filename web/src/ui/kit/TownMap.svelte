<script lang="ts">
  import type { NeighbourhoodDraft, PlotSlot, Templates } from '../../game/town';

  /**
   * Top-down 2D map of a neighbourhood. Plots can be made selectable (e.g. vacant homes).
   */
  let {
    town,
    templates,
    selectable = () => false,
    selected = null,
    onselect,
    labels = true,
    playerSlot = null,
    playerName = '',
  }: {
    town: NeighbourhoodDraft;
    templates: Templates;
    selectable?: (slot: PlotSlot) => boolean;
    selected?: number | null;
    onselect?: (slot: PlotSlot) => void;
    labels?: boolean;
    playerSlot?: number | null;
    playerName?: string;
  } = $props();

  const pw = $derived(templates.plot.width);
  const pd = $derived(templates.plot.depth);
  const occupant = (slot: number) => town.households.find((h) => h.slot === slot)?.household.name;

  /** House outline (bounding box of the walls) in plot coordinates, rotated with the plot. */
  function footprint(slot: PlotSlot) {
    const h = templates.houses.find((t) => t.id === slot.template);
    if (!h || !h.walls.length) return null;
    const xs = h.walls.flatMap((w) => [w[0], w[2]]);
    const zs = h.walls.flatMap((w) => [w[1], w[3]]);
    let [x0, x1, z0, z1] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
    if (slot.rotated) [x0, x1, z0, z1] = [pw - x1, pw - x0, pd - z1, pd - z0];
    return { x: slot.x + x0, z: slot.z + z0, w: x1 - x0, d: z1 - z0 };
  }
</script>

<svg viewBox="0 0 {town.width} {town.depth}" class="map" role="img" aria-label="Map of {town.name}">
  <defs>
    <pattern id="grass-dots" width="4" height="4" patternUnits="userSpaceOnUse">
      <circle cx="1" cy="1" r="0.35" fill="rgba(60,110,60,0.18)" />
    </pattern>
  </defs>
  <rect width={town.width} height={town.depth} rx="3" fill="#B9D7A2" />
  <rect width={town.width} height={town.depth} rx="3" fill="url(#grass-dots)" />
  {#each town.streets as s, i (i)}
    <rect x={s.x} y={s.z} width={s.w} height={s.d} fill="#C9C4BC" />
    <line x1={s.x} y1={s.z + s.d / 2} x2={s.x + s.w} y2={s.z + s.d / 2} stroke="#F4F1EC" stroke-width="0.35" stroke-dasharray="2 2" />
  {/each}

  {#each town.slots as slot (slot.index)}
    {@const fp = footprint(slot)}
    {@const canSelect = selectable(slot)}
    {@const isPlayer = slot.index === playerSlot}
    {@const owner = isPlayer ? playerName : occupant(slot.index)}
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <g
      class="plot"
      class:selectable={canSelect}
      class:selected={selected === slot.index}
      onclick={() => canSelect && onselect?.(slot)}
      role={canSelect ? 'button' : undefined}
      aria-label={canSelect ? `Choose ${slot.name}` : undefined}
    >
      <rect class="lot" x={slot.x + 0.6} y={slot.z + 0.6} width={pw - 1.2} height={pd - 1.2} rx="1.2" />
      {#if slot.kind === 'park'}
        {#each [[5, 5], [20, 6], [7, 16], [19, 16], [13, 11]] as [tx, tz], i (i)}
          <circle cx={slot.x + tx} cy={slot.z + tz} r="2" fill="#7FA77A" />
        {/each}
      {:else if fp}
        <rect
          class="house"
          class:mine={isPlayer}
          class:taken={!!owner && !isPlayer}
          x={fp.x}
          y={fp.z}
          width={fp.w}
          height={fp.d}
          rx="0.6"
        />
      {/if}
      {#if labels}
        <text x={slot.x + pw / 2} y={slot.z + (slot.rotated ? 3.4 : pd - 1.8)} text-anchor="middle" class="label">
          {slot.kind === 'park' ? slot.name : owner ? `The ${owner}s` : 'For sale'}
        </text>
      {/if}
    </g>
  {/each}
</svg>

<style>
  .map {
    width: 100%;
    height: auto;
    display: block;
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-md);
  }
  .lot {
    fill: rgba(255, 255, 255, 0.18);
    stroke: rgba(255, 255, 255, 0.55);
    stroke-width: 0.3;
    transition: fill var(--fast) var(--ease), stroke var(--fast) var(--ease);
  }
  .house {
    fill: #f4f1ec;
    stroke: #c9c1b4;
    stroke-width: 0.3;
  }
  .house.taken {
    fill: #e7dfd3;
  }
  .house.mine {
    fill: var(--accent);
    stroke: none;
  }
  .label {
    font-size: 1.6px;
    font-weight: 650;
    fill: rgba(29, 34, 48, 0.75);
    pointer-events: none;
  }
  .selectable {
    cursor: pointer;
  }
  .selectable .lot {
    stroke: var(--accent);
    stroke-dasharray: 1 0.8;
    stroke-width: 0.4;
  }
  .selectable:hover .lot {
    fill: rgba(91, 124, 250, 0.18);
  }
  .selected .lot {
    fill: rgba(91, 124, 250, 0.28);
    stroke-dasharray: none;
    stroke-width: 0.6;
  }
</style>
