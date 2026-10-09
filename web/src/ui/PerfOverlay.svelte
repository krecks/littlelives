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

  const pct = (x: number) => `${Math.round(x * 100)}%`;
  const mb = (bytes: number) => `${(bytes / 2 ** 20).toFixed(0)} MB`;
</script>

{#if game.perfOpen}
  {@const t = game.threads}
  <aside class="perf glass tabular">
    {#if t}
      <h4>Overall</h4>
      <div><span>CPU</span><b>{t.overall.busyCores.toFixed(2)} of {t.overall.cores || '?'} cores</b></div>
      {#if t.overall.memoryBytes !== null}<div><span>Memory</span><b>{mb(t.overall.memoryBytes)}</b></div>{/if}
    {/if}
    <div><span>Shared memory</span><b>{game.sharedMemory ? 'on' : 'off'}</b></div>
    {#if game.stats}
      {@const s = game.stats}
      <h4>Main thread</h4>
      <div><span>Backend</span><b>{s.backend}</b></div>
      <div><span>FPS</span><b>{s.fps.toFixed(0)}</b></div>
      <div><span>Frame</span><b>{s.frameMs.toFixed(1)} ms</b></div>
      <div><span>Frame work</span><b>{s.cpuMs.toFixed(1)} ms</b></div>
      {#if t}<div><span>Busy</span><b>{pct(t.main.busy)}</b></div>{/if}
      <div><span>Draw calls</span><b>{s.drawCalls}</b></div>
      <div><span>Snapshot rendering</span><b>{s.snapshotRendering ? 'on' : 'off'}</b></div>
      {#if t?.main.longTasks != null}
        <div><span>Long tasks (10 s)</span><b>{t.main.longTasks}{t.main.longTasks ? ` · max ${t.main.longestTaskMs.toFixed(0)} ms` : ''}</b></div>
      {/if}
      {#if t?.main.heapBytes != null}<div><span>JS heap</span><b>{mb(t.main.heapBytes)}</b></div>{/if}
    {/if}
    {#if t}
      <h4>Simulation thread</h4>
      {#if t.sim}
        {@const m = t.sim}
        <div><span>Steps</span><b>{m.stepsPerSecond.toFixed(0)} / {m.targetPerSecond.toFixed(0)} per s</b></div>
        <div><span>Step</span><b>{m.stepMs.toFixed(2)} ms · max {m.stepMaxMs.toFixed(1)}</b></div>
        <div><span>Busy</span><b>{pct(m.busy)}</b></div>
        <div><span>WASM memory</span><b>{mb(m.memoryBytes)}</b></div>
      {:else}
        <div><span>Waiting for report…</span></div>
      {/if}
      {@const v = t.voice}
      <h4>Voice thread</h4>
      <div><span>Engine</span><b>{v.state}{v.loadMs ? ` · loaded in ${(v.loadMs / 1000).toFixed(1)} s` : ''}</b></div>
      {#if v.state === 'ready'}
        <div><span>Lines made</span><b>{v.lines}{v.queued ? ` · ${v.queued} queued` : ''}</b></div>
        {#if v.lines}
          <div><span>Line time</span><b>{v.lastMs.toFixed(0)} ms · avg {v.avgMs.toFixed(0)}</b></div>
          <div><span>Speed</span><b>{v.rtf.toFixed(2)}× real time</b></div>
        {/if}
        <div><span>Busy (5 s)</span><b>{pct(v.busy)}</b></div>
        <div><span>Playing</span><b>{v.speaking} · {v.spoken} said · {v.dropped} dropped</b></div>
      {/if}
    {/if}
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
  h4 {
    margin: 8px 0 2px;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--text-muted);
  }
  h4:first-child {
    margin-top: 0;
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
