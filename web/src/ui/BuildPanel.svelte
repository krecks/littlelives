<script lang="ts">
  import BuildTools from './buy/BuildTools.svelte';
  import { game } from './state.svelte';

  /** Build mode: walls, rooms, doors and windows on the home lot (furniture is Buy mode's). */
</script>

{#if game.mode === 'build'}
  <section class="build glass" aria-label="Build mode">
    <BuildTools />
    <footer class="muted">
      <kbd>B</kbd> or <kbd>Esc</kbd> back to Live · <kbd>V</kbd> Buy mode to furnish
    </footer>
  </section>
{/if}

<style>
  .build {
    --build: #c9772b;
    --build-soft: rgba(201, 119, 43, 0.14);
    position: absolute;
    left: 50%;
    bottom: var(--edge);
    transform: translateX(-50%);
    width: min(1000px, calc(100vw - 2 * var(--edge)));
    padding: 10px 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    pointer-events: auto;
  }
  .muted {
    color: var(--text-muted);
    font-size: 12px;
  }
  kbd {
    padding: 0 5px;
    border-radius: 4px;
    background: var(--hairline);
    font-family: inherit;
    font-size: 11px;
  }
</style>
