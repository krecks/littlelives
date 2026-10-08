<script lang="ts" module>
  export interface LotLabel {
    plot: number;
    title: string;
    sub?: string;
    /** Look of the tag: a household, a house for sale, the park, the player's new home. */
    kind: 'home' | 'sale' | 'park' | 'mine';
  }
</script>

<script lang="ts">
  /**
   * A transparent stage over the live 3D town (drawn by the renderer behind the page). Frames the
   * camera into this box, turns pointer input into lot hover / clicks, a drag to look around and
   * the wheel to zoom, and pins a tag above every lot. The camera itself is driven by `menuScene`.
   */
  import { onMount } from 'svelte';
  import { menuScene, type Frame } from '../../game/menuScene';

  let {
    labels,
    hover = null,
    selected = null,
    focus = null,
    selectable = () => true,
    onhover,
    onselect,
  }: {
    labels: LotLabel[];
    hover?: number | null;
    selected?: number | null;
    /** Lot the camera glides to (null: the whole town). */
    focus?: number | null;
    selectable?: (plot: number) => boolean;
    onhover?: (plot: number | null) => void;
    /** A lot (or empty ground: null) was clicked. */
    onselect?: (plot: number | null) => void;
  } = $props();

  let stage: HTMLDivElement;
  let frame = $state<Frame | null>(null);
  let dragging = false;
  let down: { x: number; y: number; moved: boolean } | null = null;
  let cursor = $state('default');

  onMount(() => {
    const measure = () => {
      const r = stage.getBoundingClientRect();
      frame = { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    window.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  });

  // Camera: the lot in focus, or the whole town, framed into the stage.
  $effect(() => {
    if (!frame) return;
    menuScene.shoot(focus === null ? { kind: 'overview', frame } : { kind: 'lot', plot: focus, frame });
  });

  function pointAt(e: PointerEvent): number | null {
    return menuScene.plotAt(e.clientX, e.clientY);
  }

  function onpointerdown(e: PointerEvent) {
    if (e.button !== 0) return;
    down = { x: e.clientX, y: e.clientY, moved: false };
    stage.setPointerCapture(e.pointerId);
  }

  function onpointermove(e: PointerEvent) {
    if (down) {
      const dx = e.clientX - down.x;
      if (!down.moved && Math.abs(dx) + Math.abs(e.clientY - down.y) > 5) down.moved = dragging = true;
      if (down.moved) {
        menuScene.nudge(-e.movementX * 0.006, 1);
        cursor = 'grabbing';
        return;
      }
    }
    const plot = pointAt(e);
    if (plot !== hover) onhover?.(plot);
    cursor = plot !== null && selectable(plot) ? 'pointer' : 'grab';
  }

  function onpointerup(e: PointerEvent) {
    const click = down && !down.moved;
    down = null;
    dragging = false;
    if (stage.hasPointerCapture(e.pointerId)) stage.releasePointerCapture(e.pointerId);
    if (!click) return;
    const plot = pointAt(e);
    onselect?.(plot !== null && selectable(plot) ? plot : null);
  }

  function onwheel(e: WheelEvent) {
    e.preventDefault();
    menuScene.nudge(0, Math.exp(-e.deltaY * 0.0015));
  }

  /** Svelte action: keeps a tag pinned above its lot. */
  function pin(el: HTMLElement, plot: number) {
    let detach = menuScene.pin(plot, el);
    return {
      update(next: number) {
        detach();
        detach = menuScene.pin(next, el);
      },
      destroy: () => detach(),
    };
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="stage"
  bind:this={stage}
  style:cursor
  {onpointerdown}
  {onpointermove}
  {onpointerup}
  onpointerleave={() => !dragging && onhover?.(null)}
  {onwheel}
></div>

<div class="tags" aria-label="Lots">
  {#each labels as l (l.plot)}
    <div class="pin" use:pin={l.plot}>
      <button
        class="tag {l.kind}"
        class:hover={hover === l.plot}
        class:selected={selected === l.plot}
        disabled={!selectable(l.plot)}
        onmouseenter={() => onhover?.(l.plot)}
        onmouseleave={() => onhover?.(null)}
        onclick={() => selectable(l.plot) && onselect?.(l.plot)}
      >
        <span class="dot" aria-hidden="true"></span>
        <span class="text">
          <span class="title">{l.title}</span>
          {#if l.sub}<span class="sub">{l.sub}</span>{/if}
        </span>
      </button>
    </div>
  {/each}
</div>

<style>
  .stage {
    position: relative;
    min-height: 0;
    height: 100%;
    touch-action: none;
  }
  /* Tags are positioned in screen pixels: undo the UI scale for the layer, keep it for the tags. */
  .tags {
    position: fixed;
    inset: 0;
    pointer-events: none;
    zoom: calc(1 / var(--ui-scale));
    z-index: 1;
  }
  .pin {
    position: absolute;
    left: 0;
    top: 0;
    will-change: transform;
  }
  .tag {
    position: absolute;
    left: 0;
    bottom: 10px;
    transform: translateX(-50%);
    zoom: var(--ui-scale);
    pointer-events: auto;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 12px 6px 9px;
    border-radius: var(--radius-pill);
    background: var(--tag-bg);
    color: var(--text-strong);
    box-shadow: var(--tag-shadow);
    white-space: nowrap;
    text-align: left;
    transition:
      transform var(--fast) var(--ease),
      background var(--fast) var(--ease),
      box-shadow var(--fast) var(--ease);
  }
  /* The stem from the tag down to the roof. */
  .tag::after {
    content: '';
    position: absolute;
    left: 50%;
    bottom: -9px;
    width: 2px;
    height: 9px;
    margin-left: -1px;
    border-radius: 1px;
    background: var(--tag-bg);
  }
  .tag:disabled {
    cursor: default;
  }
  /* Lots outside the view: the tag waits at the edge of the stage. */
  .pin:global(.edge) .tag:not(.selected) {
    opacity: 0.86;
    transform: translateX(-50%) scale(0.92);
  }
  .pin:global(.edge) .tag::after {
    display: none;
  }
  .tag:not(:disabled):hover,
  .tag.hover {
    transform: translateX(-50%) translateY(-3px);
    background: #fff;
    box-shadow: var(--tag-shadow-hover);
  }
  .tag.selected {
    background: var(--accent);
    color: #fff;
    transform: translateX(-50%) translateY(-4px) scale(1.06);
    box-shadow: 0 10px 28px rgba(60, 90, 220, 0.45);
  }
  .tag.selected::after {
    background: var(--accent);
  }
  .dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    flex: none;
    background: var(--tag-home);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--tag-home) 25%, transparent);
  }
  .sale .dot {
    background: var(--tag-sale);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--tag-sale) 30%, transparent);
  }
  .park .dot {
    background: var(--tag-park);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--tag-park) 30%, transparent);
  }
  .mine .dot,
  .selected .dot {
    background: #fff;
    box-shadow: 0 0 0 3px rgba(255, 255, 255, 0.35);
  }
  .text {
    display: flex;
    flex-direction: column;
    line-height: 1.15;
  }
  .title {
    font-size: 13px;
    font-weight: 700;
    letter-spacing: -0.01em;
  }
  .sub {
    font-size: 11px;
    font-weight: 550;
    color: var(--text-muted);
  }
  .selected .sub {
    color: rgba(255, 255, 255, 0.85);
  }
</style>
