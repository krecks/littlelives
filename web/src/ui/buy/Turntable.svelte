<script lang="ts">
  import Icon from '../Icon.svelte';
  import { services } from '../services';

  /**
   * The item in the detail pane. It stands still; press and drag across it to turn it around.
   * Only the turntable's own frames are shown (the catalog picture is framed tighter, so showing
   * it first made the item shrink when the frames arrived); a soft placeholder waits meanwhile.
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
  /** Pixels of drag per frame (a full turn across ~1.5 widths of the pane). */
  const STEP_PX = 18;
  /** Pointing past items quickly shouldn't draw a turntable for each. */
  const DELAY_MS = 260;

  let frames = $state.raw<string[] | null>(null);
  let failed = $state(false);
  let index = $state(0);
  let touched = $state(false);

  $effect(() => {
    const key = model;
    const fp = footprint;
    index = 0;
    failed = false;
    // A local, not `frames`: reading what the effect writes would make it depend on itself.
    const hit = services.items?.cachedTurntable(key, FRAMES) ?? null;
    frames = hit;
    if (hit) return;
    if (!services.items) {
      failed = true;
      return;
    }
    let live = true;
    const timer = setTimeout(() => {
      void services.items.turntable(key, fp, FRAMES).then((urls) => {
        if (!live) return;
        if (urls?.length) frames = urls;
        else failed = true;
      });
    }, DELAY_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  });

  /** While dragging: pointer x where the drag started, and the frame shown then. */
  let anchor: number | null = null;
  let anchorIndex = 0;
  function down(e: PointerEvent) {
    if (!frames || e.button !== 0) return;
    anchor = e.clientX;
    anchorIndex = index;
    // Keep turning while the drag strays off the pane.
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function move(e: PointerEvent) {
    if (!frames || anchor === null) return;
    const steps = Math.trunc((anchor - e.clientX) / STEP_PX);
    if (steps === 0) return;
    index = (((anchorIndex + steps) % FRAMES) + FRAMES) % FRAMES;
    touched = true;
  }
  function up() {
    anchor = null;
  }
</script>

<div
  class="turntable"
  class:compact
  class:ready={!!frames}
  class:loading={!frames && !failed}
  role="img"
  aria-label="Preview"
  onpointerdown={down}
  onpointermove={move}
  onpointerup={up}
  onpointercancel={up}
>
  {#if frames}
    <!-- Every frame stays decoded; only the current one shows (no flicker while turning). -->
    {#each frames as src, i (src)}<img {src} class:on={i === index} alt="" draggable="false" />{/each}
    {#if !touched}<span class="hint">↔ drag to turn</span>{/if}
  {:else}
    <span class="glyph"><Icon name={glyph} size={34} /></span>
  {/if}
</div>

<style>
  .turntable {
    position: relative;
    display: grid;
    place-items: center;
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
    cursor: grab;
  }
  .ready:active {
    cursor: grabbing;
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
  .glyph {
    display: grid;
    place-items: center;
    color: var(--accent);
    opacity: 0.55;
  }
  .loading::after {
    content: '';
    position: absolute;
    inset: 0;
    background: linear-gradient(100deg, transparent 30%, rgba(255, 255, 255, 0.55) 50%, transparent 70%);
    background-size: 220% 100%;
    animation: shimmer 1.3s linear infinite;
  }
  @keyframes shimmer {
    from {
      background-position: 120% 0;
    }
    to {
      background-position: -120% 0;
    }
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
