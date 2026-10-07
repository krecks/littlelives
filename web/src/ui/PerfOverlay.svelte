<script lang="ts">
  import { game } from './state.svelte';
</script>

{#if game.perfOpen}
  <aside class="perf glass tabular">
    {#if game.stats}
      {@const s = game.stats}
      <div><span>Backend</span><b>{s.backend}</b></div>
      <div><span>FPS</span><b>{s.fps.toFixed(0)}</b></div>
      <div><span>Frame</span><b>{s.frameMs.toFixed(1)} ms</b></div>
      <div><span>Draw calls</span><b>{s.drawCalls}</b></div>
      <div><span>Snapshot rendering</span><b>{s.snapshotRendering ? 'on' : 'off'}</b></div>
    {/if}
    <div><span>Shared memory</span><b>{game.sharedMemory ? 'on' : 'off'}</b></div>
  </aside>
{/if}

<style>
  .perf {
    position: absolute;
    top: 76px;
    right: var(--edge);
    min-width: 220px;
    padding: 10px 14px;
    border-radius: var(--radius-md);
    font-size: 12px;
    pointer-events: none;
  }
  div {
    display: flex;
    justify-content: space-between;
    gap: 16px;
    padding: 2px 0;
  }
  span {
    color: var(--text-muted);
  }
</style>
