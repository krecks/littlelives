<script lang="ts">
  import { genderOfLook, type Appearance } from '../../game/household';
  import type { SimLook } from '../../render/types';
  import { services } from '../services';

  /**
   * A Sim's avatar: a head-and-shoulders portrait rendered from the in-game 3D character
   * (`services.previews`, cached by look), filling a `size` × `size` box. Until it's ready, or
   * without `gender` or 3D support, a flat illustration stands in.
   *
   * `gender` defaults to the one the look was created for (drafts from `randomSim`).
   * `id` is the Sim's id in a running game (older saves derive clothes from it).
   * `animate` is accepted for compatibility and ignored.
   */
  let {
    appearance,
    gender,
    id,
    size = 46,
  }: { appearance: Appearance; gender?: string; id?: number; size?: number; animate?: boolean } = $props();

  let url = $state<string | null>(null);

  const body = $derived(gender ?? genderOfLook(appearance));

  $effect(() => {
    if (!body || !services.previews) return;
    const look: SimLook = { gender: body, appearance: $state.snapshot(appearance) as Appearance, id };
    const hit = services.previews.cachedPortrait(look);
    if (hit) {
      url = hit;
      return;
    }
    let alive = true;
    // Coalesce quick changes (sliders) and let siblings join the same batch.
    const timer = setTimeout(() => {
      void services.previews.portrait(look).then((u) => {
        if (alive && u) url = u;
      });
    }, 90);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  });
</script>

<span class="sim-portrait" style="width:{size}px;height:{size}px" aria-hidden="true">
  {#if url}
    {#key url}<img src={url} alt="" width={size} height={size} draggable="false" />{/key}
  {:else}
    <svg width={size} height={size} viewBox="36 6 128 128">
      <rect x="62" y="96" width="76" height="140" rx="38" fill={appearance.body} />
      <circle cx="100" cy="62" r="34" fill={appearance.skin} />
      {#if appearance.hairStyle === 'long'}
        <path d="M62 60c0-26 16-38 38-38s38 12 38 38v40c-6 6-14 8-20 6V60c-6-8-14-12-18-12s-12 4-18 12v46c-6 2-14 0-20-6Z" fill={appearance.hair} />
      {:else if appearance.hairStyle === 'bun'}
        <circle cx="100" cy="20" r="14" fill={appearance.hair} />
        <path d="M64 58c0-24 16-36 36-36s36 12 36 36c-8-10-20-15-36-15s-28 5-36 15Z" fill={appearance.hair} />
      {:else if appearance.hairStyle !== 'none'}
        <path d="M64 58c0-24 16-36 36-36s36 12 36 36c-8-10-20-15-36-15s-28 5-36 15Z" fill={appearance.hair} />
      {/if}
      <circle cx="88" cy="66" r="3.2" fill="rgba(20,24,40,0.6)" />
      <circle cx="112" cy="66" r="3.2" fill="rgba(20,24,40,0.6)" />
    </svg>
  {/if}
</span>

<style>
  .sim-portrait {
    position: relative;
    display: block;
    flex: none;
    overflow: hidden;
  }
  img,
  svg {
    position: absolute;
    inset: 0;
    display: block;
    width: 100%;
    height: 100%;
    user-select: none;
  }
  img {
    object-fit: cover;
    animation: portrait-in 260ms var(--ease, ease-out);
  }
  @keyframes portrait-in {
    from {
      opacity: 0;
    }
  }
</style>
