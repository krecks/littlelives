<script lang="ts">
  import { services } from '../services';
  import Thumb from './Thumb.svelte';

  /**
   * The item in the detail pane. It stands still; move the pointer across it (or drag, on touch)
   * to turn it around. Shows the catalog picture at once and swaps in the turntable frames once
   * they are drawn.
   */
  let {
    model,
    footprint,
    glyph,
    compact = false,
  }: {
    model: string;
    footprint: [number, number];
    glyph: string;
    /** A shorter stage (owned things: their upgrade and sell buttons come first). */
    compact?: boolean;
  } = $props();

  const FRAMES = 24;
  /** Pixels of pointer travel per frame (a full turn across ~1.5 widths of the pane). */
  const STEP_PX = 18;
  /** Pointing past items quickly shouldn't draw a turntable for each. */
  const DELAY_MS = 260;

  let frames = $state<string[] | null>(null);
  let index = $state(0);
  let touched = $state(false);

  $effect(() => {
    const key = model;
    const fp = footprint;
    frames = null;
    index = 0;
    if (!services.items) return;
    let live = true;
    const timer = setTimeout(() => {
      void services.items.turntable(key, fp, FRAMES).then((urls) => {
        if (live && urls?.length) frames = urls;
      });
    }, DELAY_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  });

  /** Pointer x where the current frame was reached; travel from there turns the item. */
  let anchor: number | null = null;
  let anchorIndex = 0;
  function enter(e: PointerEvent) {
    anchor = e.clientX;
    anchorIndex = index;
  }
  function move(e: PointerEvent) {
    if (!frames) return;
    if (anchor === null) enter(e);
    const steps = Math.trunc((anchor! - e.clientX) / STEP_PX);
    if (steps === 0) return;
    index = (((anchorIndex + steps) % FRAMES) + FRAMES) % FRAMES;
    touched = true;
  }
  function down(e: PointerEvent) {
    enter(e);
    // Touch has no hover: keep turning while the finger drags, even off the pane.
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function leave() {
    anchor = null;
  }
</script>

<div
  class="turntable"
  class:compact
  class:ready={!!frames}
  role="img"
  aria-label="Preview"
  onpointerenter={enter}
  onpointerdown={down}
  onpointermove={move}
  onpointerleave={leave}
  onpointercancel={leave}
>
  {#if frames}
    <!-- Every frame stays decoded; only the current one shows (no flicker while turning). -->
    {#each frames as src, i (src)}<img {src} class:on={i === index} alt="" draggable="false" />{/each}
    {#if !touched}<span class="hint">↔ move across to turn</span>{/if}
  {:else}
    <Thumb {model} {footprint} {glyph} size={34} />
  {/if}
</div>

<style>
  .turntable {
    position: relative;
    width: 100%;
    aspect-ratio: 1.45;
    border-radius: var(--radius-sm);
    background: radial-gradient(ellipse 65% 60% at 50% 48%, #ffffff 0%, #eef1f7 70%, #e3e7f0 100%);
    overflow: hidden;
    touch-action: none;
  }
  .compact {
    aspect-ratio: 2.6;
  }
  .ready {
    cursor: ew-resize;
  }
  img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: contain;
    pointer-events: none;
    visibility: hidden;
  }
  img.on {
    visibility: visible;
  }
  .hint {
    position: absolute;
    right: 8px;
    bottom: 6px;
    padding: 1px 8px;
    border-radius: var(--radius-pill);
    background: rgba(255, 255, 255, 0.85);
    color: var(--text-muted);
    font-size: 10px;
    font-weight: 600;
    animation: fade 600ms var(--ease) 400ms both;
  }
  @keyframes fade {
    from {
      opacity: 0;
      transform: translateY(4px);
    }
  }
</style>
