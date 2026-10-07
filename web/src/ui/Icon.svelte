<script lang="ts">
  import { services } from './services';

  /** Asset key, e.g. `icon.need.hunger`. Resolved through the asset registry. */
  let { name, size = 18 }: { name: string; size?: number } = $props();
  const entry = $derived(services.assets.icon(name));
</script>

{#if entry.mode === 'image'}
  <img src={entry.url} width={size} height={size} alt="" draggable="false" />
{:else}
  <span class="icon" style="width:{size}px;height:{size}px;--icon:url('{entry.url}')" aria-hidden="true"></span>
{/if}

<style>
  .icon {
    display: inline-block;
    flex: none;
    background: currentColor;
    mask: var(--icon) center / contain no-repeat;
    -webkit-mask: var(--icon) center / contain no-repeat;
  }
  img {
    flex: none;
  }
</style>
