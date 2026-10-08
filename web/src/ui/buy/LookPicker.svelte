<script lang="ts">
  import type { DoorStyleDef, WallCoveringDef, WindowStyleDef } from '../../content/content';
  import { money } from '../format';
  import { services } from '../services';
  import { play } from '../sfx';
  import { game, type BuildTool } from '../state.svelte';

  /**
   * Build mode's looks for the tool in hand: form and covering for walls and rooms, covering for
   * Paint, style for doors and windows. Swatches and little drawings are made from the content
   * (finish, colour, leaf, glazing), so packs that add looks show up here as they are.
   */
  let { tool }: { tool: BuildTool } = $props();

  const content = services.content;
  const coverings = content.wallCoverings;
  const doors = content.doorStyles;
  const windows = content.windowStyles;
  const prices = $derived(game.catalog?.build);

  /** Rough colour of each finish's texture, so a swatch shows what the tint does to it. */
  const BASE: Record<WallCoveringDef['finish'], string> = {
    plaster: '#F4F0E8',
    wallpaper: '#F2EEE8',
    siding: '#EDEBE6',
    brick: '#B55A40',
    wood: '#EFEBE4',
    stone: '#A39C90',
    tile: '#F2F2F0',
  };
  function multiply(a: string, b: string): string {
    const n = (h: string, i: number) => parseInt(h.slice(1 + i * 2, 3 + i * 2), 16);
    const c = [0, 1, 2].map((i) => Math.round((n(a, i) * n(b, i)) / 255));
    return `rgb(${c.join(',')})`;
  }
  const swatch = (c: WallCoveringDef) => `--c:${multiply(BASE[c.finish], c.color)}`;

  const look = $derived(game.buildLook);
  const coverLabel = $derived(look.cover ? (coverings[look.cover - 1]?.label ?? '') : 'House default');
  const coverPrice = $derived(look.cover ? (coverings[look.cover - 1]?.price ?? 0) : 0);

  function set(patch: Partial<typeof game.buildLook>) {
    play('tab');
    game.buildLook = { ...game.buildLook, ...patch };
  }

  const doorPrice = (d: DoorStyleDef) => d.price ?? prices?.door ?? 0;
  const windowPrice = (w: WindowStyleDef) => w.price ?? prices?.window ?? 0;

  /** Window opening in the drawing: 34 px tall for a 2.8 m wall. */
  const wy = (m: number) => 34 - (m / 2.8) * 34;
</script>

{#if tool === 'wall' || tool === 'room' || tool === 'paint'}
  <div class="row">
    {#if tool !== 'paint'}
      <div class="forms" role="radiogroup" aria-label="Wall form">
        <button role="radio" aria-checked={look.form === 0} class:active={look.form === 0} onclick={() => set({ form: 0 })}>
          <svg viewBox="0 0 22 22" aria-hidden="true"><rect x="5" y="2" width="12" height="18" rx="1.5" /></svg>Full
        </button>
        <button role="radio" aria-checked={look.form === 1} class:active={look.form === 1} onclick={() => set({ form: 1 })}>
          <svg viewBox="0 0 22 22" aria-hidden="true"><rect x="5" y="11" width="12" height="9" rx="1.5" /></svg>Half
        </button>
      </div>
    {/if}
    {#if coverings.length}
      <div class="swatches" role="radiogroup" aria-label="Wall covering">
        <button role="radio" aria-checked={look.cover === 0} class="swatch auto" class:active={look.cover === 0} title="House default: siding outside, wallpaper inside" onclick={() => set({ cover: 0 })}>
          <span>A</span>
        </button>
        {#each coverings as c, i (c.id)}
          <button
            role="radio"
            aria-checked={look.cover === i + 1}
            class="swatch {c.finish}"
            class:active={look.cover === i + 1}
            style={swatch(c)}
            title="{c.label}{c.price ? ` · ${money(c.price)} a face` : ' · free'}"
            onclick={() => set({ cover: i + 1 })}
          ></button>
        {/each}
      </div>
      <span class="chosen"
        ><b>{coverLabel}</b>{#if coverPrice}<small class="tabular"> {money(coverPrice)} a face</small>{/if}{#if tool === 'paint'}<small> · Shift: the whole room</small>{/if}</span
      >
    {/if}
  </div>
{:else if tool === 'door' && doors.length}
  <div class="row cards" role="radiogroup" aria-label="Door style">
    {#each doors as d, i (d.id)}
      {@const paint = d.color ?? '#3E5A4A'}
      <button role="radio" aria-checked={look.door === i} class="card" class:active={look.door === i} title={d.label} onclick={() => set({ door: i })}>
        <svg viewBox="0 0 24 34" aria-hidden="true">
          <rect x="2" y="1" width="20" height="33" rx="1" fill="#E9E4DA" />
          {#if d.leaf === 'oak'}
            <rect x="4" y="3" width="16" height="31" fill="#B07A4A" />
            <path d="M8 4v29M12 4v29M16 4v29" stroke="#8F5E35" stroke-width=".6" />
          {:else if d.leaf === 'panel'}
            <rect x="4" y="3" width="16" height="31" fill={paint} />
            <rect x="6.5" y="6" width="11" height="10" rx=".6" fill="none" stroke="#000" stroke-opacity=".18" />
            <rect x="6.5" y="19" width="11" height="12" rx=".6" fill="none" stroke="#000" stroke-opacity=".18" />
          {:else}
            <rect x="4" y="3" width="16" height="31" fill={paint} />
            <rect x="6" y="5" width="12" height={d.leaf === 'halfGlass' ? 12 : 26} fill="#BFE0F0" />
            {#if d.leaf === 'glass'}<path d="M6 17.5h12" stroke={paint} stroke-width="1.2" />{/if}
          {/if}
          <circle cx="17.5" cy="20" r="1" fill="#C9AC6A" />
        </svg>
        <span class="name">{d.label}</span>
        <small class="tabular">{money(doorPrice(d))}</small>
      </button>
    {/each}
  </div>
{:else if tool === 'window' && windows.length}
  <div class="row cards" role="radiogroup" aria-label="Window style">
    {#each windows as w, i (w.id)}
      {@const x0 = 3 + w.inset * 24}
      {@const x1 = 27 - w.inset * 24}
      {@const y0 = wy(w.head)}
      {@const y1 = wy(w.sill)}
      <button role="radio" aria-checked={look.window === i} class="card" class:active={look.window === i} title={w.label} onclick={() => set({ window: i })}>
        <svg viewBox="0 0 30 34" aria-hidden="true">
          <rect x="1" y="1" width="28" height="33" rx="1" fill="#E9E4DA" />
          {#if w.shutters}<rect x={x0 - 4} y={y0} width="3" height={y1 - y0} fill="#5B6E86" opacity={w.shutters === 'house' ? 0.45 : 1} /><rect
              x={x1 + 1}
              y={y0}
              width="3"
              height={y1 - y0}
              fill="#5B6E86"
              opacity={w.shutters === 'house' ? 0.45 : 1}
            />{/if}
          <rect x={x0} y={y0} width={x1 - x0} height={y1 - y0} fill="#BFE0F0" stroke="#FFFFFF" stroke-width="1.2" />
          {#if w.panes === 'cross' || w.panes === 'bar' || w.panes === 'transom'}<path d="M15 {y0}V{y1}" stroke="#FFF" stroke-width="1" />{/if}
          {#if w.panes === 'cross'}<path d="M{x0} {(y0 + y1) / 2 - 1.2}H{x1}" stroke="#FFF" stroke-width="1" />{/if}
          {#if w.panes === 'transom'}<path d="M{x0} {y0 + 5}H{x1}" stroke="#FFF" stroke-width="1" />{/if}
          {#if w.panes === 'grid'}<path
              d="M{x0 + (x1 - x0) / 3} {y0}V{y1}M{x0 + (2 * (x1 - x0)) / 3} {y0}V{y1}M{x0} {(y0 + y1) / 2}H{x1}"
              stroke="#FFF"
              stroke-width="1"
            />{/if}
        </svg>
        <span class="name">{w.label}</span>
        <small class="tabular">{money(windowPrice(w))}</small>
      </button>
    {/each}
  </div>
{:else if tool === 'remove'}
  <p class="row muted">Tearing down walls, doors and windows is free.</p>
{/if}

<style>
  .row {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
    margin: 0;
    padding: 8px 10px;
    border-radius: var(--radius-sm);
    background: var(--surface);
    font-size: 12px;
  }
  .forms {
    flex: none;
    display: flex;
    gap: 2px;
    padding: 2px;
    border-radius: var(--radius-sm);
    background: var(--hairline);
  }
  .forms button {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    height: 30px;
    padding: 0 9px 0 5px;
    border-radius: 8px;
    font-weight: 650;
    color: var(--text-muted);
  }
  .forms svg {
    width: 18px;
    height: 18px;
    fill: currentColor;
    opacity: 0.7;
  }
  .forms button.active {
    background: var(--surface);
    color: var(--build);
    box-shadow: var(--shadow-sm);
  }
  .swatches {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    gap: 4px;
    overflow-x: auto;
    padding: 3px 2px;
    scrollbar-width: thin;
  }
  .swatch {
    flex: none;
    width: 26px;
    height: 26px;
    border-radius: 7px;
    background: var(--c);
    box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.12);
    transition: transform 160ms var(--ease);
  }
  .swatch:hover {
    transform: translateY(-2px) scale(1.08);
  }
  .swatch.active {
    box-shadow:
      inset 0 0 0 1px rgba(0, 0, 0, 0.12),
      0 0 0 2px var(--surface),
      0 0 0 4px var(--build);
  }
  .swatch.auto {
    display: grid;
    place-items: center;
    background: linear-gradient(135deg, #ece6d8 50%, #efe3d3 50%);
    color: var(--text-muted);
    font-weight: 750;
    font-size: 11px;
  }
  .swatch.wallpaper {
    background:
      radial-gradient(rgba(255, 255, 255, 0.55) 1.1px, transparent 1.6px) 0 0 / 6px 6px,
      var(--c);
  }
  .swatch.siding {
    background: repeating-linear-gradient(180deg, var(--c) 0 5px, rgba(0, 0, 0, 0.18) 5px 6px);
  }
  .swatch.brick {
    background:
      linear-gradient(90deg, transparent 11px, rgba(255, 255, 255, 0.5) 11px 12px, transparent 12px) 0 0 / 13px 6px,
      repeating-linear-gradient(180deg, var(--c) 0 5px, rgba(255, 255, 255, 0.55) 5px 6px);
  }
  .swatch.wood {
    background: repeating-linear-gradient(90deg, var(--c) 0 5px, rgba(0, 0, 0, 0.14) 5px 6px);
  }
  .swatch.stone {
    background:
      radial-gradient(circle at 30% 30%, rgba(255, 255, 255, 0.35) 0 3px, transparent 4px) 0 0 / 9px 9px,
      radial-gradient(circle at 70% 70%, rgba(0, 0, 0, 0.2) 0 3px, transparent 4px) 0 0 / 11px 11px,
      var(--c);
  }
  .swatch.tile {
    background:
      linear-gradient(90deg, rgba(0, 0, 0, 0.14) 1px, transparent 1px) 0 0 / 8px 8px,
      linear-gradient(180deg, rgba(0, 0, 0, 0.14) 1px, transparent 1px) 0 0 / 8px 8px,
      var(--c);
  }
  .chosen {
    flex: none;
    max-width: 210px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .chosen small {
    color: var(--text-muted);
    font-weight: 600;
  }
  .cards {
    gap: 6px;
    overflow-x: auto;
    padding: 6px 8px;
  }
  .card {
    flex: none;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    width: 86px;
    padding: 6px 4px 5px;
    border-radius: var(--radius-sm);
    background: var(--surface-muted);
    transition:
      transform 180ms var(--ease),
      box-shadow var(--fast) var(--ease);
  }
  .card:hover {
    transform: translateY(-2px);
  }
  .card.active {
    background: var(--surface);
    box-shadow: 0 0 0 2px var(--build);
  }
  .card svg {
    width: 30px;
    height: 34px;
  }
  .card .name {
    max-width: 100%;
    font-size: 11px;
    font-weight: 650;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .card small {
    color: var(--good);
    font-size: 11px;
    font-weight: 650;
  }
  .muted {
    color: var(--text-muted);
  }
</style>
