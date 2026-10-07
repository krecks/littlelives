<script lang="ts">
  import type { Snippet } from 'svelte';
  import Icon from '../Icon.svelte';

  let { title, onclose, width = 640, children }: { title: string; onclose: () => void; width?: number; children: Snippet } = $props();

  // Capture phase: Escape closes the modal before game shortcuts see it.
  function onkeydown(e: KeyboardEvent) {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    onclose();
  }
</script>

<svelte:window onkeydowncapture={onkeydown} />

<div class="backdrop scaled">
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="scrim" onclick={onclose}></div>
  <div class="panel" role="dialog" aria-modal="true" aria-label={title} style="width:min({width}px, calc(100vw - 32px))">
    <header>
      <h2>{title}</h2>
      <button class="close" aria-label="Close" onclick={onclose}><Icon name="icon.ui.close" size={16} /></button>
    </header>
    <div class="body">{@render children()}</div>
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    display: grid;
    place-items: center;
    z-index: 50;
  }
  .scrim {
    position: absolute;
    inset: 0;
    background: var(--backdrop);
    backdrop-filter: blur(6px);
    -webkit-backdrop-filter: blur(6px);
    animation: fade var(--slow) var(--ease);
  }
  .panel {
    position: relative;
    max-height: calc(100vh / var(--ui-scale) - 48px);
    display: flex;
    flex-direction: column;
    border-radius: 24px;
    background: var(--glass-strong);
    border: 1px solid var(--glass-border);
    box-shadow: 0 30px 80px rgba(20, 24, 40, 0.3);
    backdrop-filter: blur(24px) saturate(1.4);
    -webkit-backdrop-filter: blur(24px) saturate(1.4);
    animation: rise var(--slow) var(--ease);
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 20px 22px 8px 26px;
  }
  h2 {
    margin: 0;
    font-size: 20px;
    letter-spacing: -0.02em;
  }
  .close {
    display: grid;
    place-items: center;
    width: 34px;
    height: 34px;
    border-radius: 50%;
    color: var(--text-muted);
  }
  .close:hover {
    background: var(--hairline);
    color: var(--text);
  }
  .body {
    padding: 8px 26px 24px;
    overflow: auto;
  }
  @keyframes fade {
    from {
      opacity: 0;
    }
  }
  @keyframes rise {
    from {
      opacity: 0;
      transform: translateY(12px) scale(0.98);
    }
  }
</style>
