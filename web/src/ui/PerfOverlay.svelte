<script lang="ts">
  import { saveDebugReport } from './debugReport';
  import { game } from './state.svelte';

  let note = $state('');
  let saved = $state('');

  async function report() {
    const path = await saveDebugReport(note.trim());
    if (path) {
      saved = path;
      note = '';
    }
  }
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
    <form class="debug" onsubmit={(e) => (e.preventDefault(), void report())}>
      <input bind:value={note} placeholder="What went wrong? (optional)" aria-label="Debug report note" />
      <button class="btn" type="submit" disabled={game.debugSaving}>
        {game.debugSaving ? 'Saving…' : 'Save debug report'} <kbd>F8</kbd>
      </button>
      <small>Screenshot, game state and recent errors.{#if saved}<br />Last: <code>{saved}</code>{/if}</small>
    </form>
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
  .debug {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 6px;
    margin-top: 8px;
    padding-top: 8px;
    border-top: 1px solid var(--border, rgba(0, 0, 0, 0.1));
    pointer-events: auto;
  }
  .debug input {
    font: inherit;
    padding: 6px 8px;
    border-radius: var(--radius-sm, 6px);
    border: 1px solid var(--border, rgba(0, 0, 0, 0.15));
    background: rgba(255, 255, 255, 0.8);
  }
  .debug button {
    justify-content: center;
    gap: 6px;
  }
  kbd {
    font-size: 10px;
    opacity: 0.6;
  }
  small {
    color: var(--text-muted);
    line-height: 1.4;
    word-break: break-all;
  }
</style>
