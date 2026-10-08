<script lang="ts">
  import Icon from '../Icon.svelte';
  import { services } from '../services';

  /**
   * A catalog picture of a model, drawn in 3D once it scrolls into view (see
   * `render/preview/items.ts`) and cached. A soft placeholder with `glyph` shows until it arrives
   * (or if 3D isn't available).
   */
  let { model, footprint, glyph, size = 22 }: { model: string; footprint: [number, number]; glyph: string; size?: number } = $props();

  let url = $state<string | null>(null);
  let failed = $state(false);
  let el = $state<HTMLElement>();
  /** On screen (or about to be): only then is the picture asked for. */
  let near = $state(false);

  $effect(() => {
    if (!el) return;
    const io = new IntersectionObserver((entries) => (near = entries.some((e) => e.isIntersecting)), { rootMargin: '160px' });
    io.observe(el);
    return () => io.disconnect();
  });

  $effect(() => {
    const key = model;
    const fp = footprint;
    const hit = services.items?.cachedThumbnail(key) ?? null;
    url = hit;
    failed = false;
    if (hit || !services.items || !near) return;
    const abort = new AbortController();
    void services.items.thumbnail(key, fp, 'now', abort.signal).then((u) => {
      if (abort.signal.aborted) return;
      url = u;
      failed = !u;
    });
    // Scrolled away or another category: withdraw the request.
    return () => abort.abort();
  });
</script>

<span class="thumb" class:loading={!url && !failed} bind:this={el}>
  {#if url}
    {#key url}<img src={url} alt="" draggable="false" />{/key}
  {:else}
    <span class="glyph"><Icon name={glyph} {size} /></span>
  {/if}
</span>

<style>
  .thumb {
    position: relative;
    display: grid;
    place-items: center;
    width: 100%;
    height: 100%;
    overflow: hidden;
  }
  img {
    width: 100%;
    height: 100%;
    object-fit: contain;
    animation: arrive 360ms var(--ease) both;
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
  @keyframes arrive {
    from {
      opacity: 0;
      transform: scale(0.86) translateY(4px);
    }
  }
</style>
