<script lang="ts">
  import type { Snippet } from 'svelte';

  /** One setting: its name, a short hint, badges ("Next load", "Experimental") and the control. */
  let {
    title,
    hint,
    badges = [],
    disabled = false,
    children,
  }: { title: string; hint?: string; badges?: string[]; disabled?: boolean; children: Snippet } = $props();
</script>

<div class="row" class:disabled>
  <div class="text">
    <b>
      {title}
      {#each badges as b (b)}<em class:experimental={b === 'Experimental'}>{b}</em>{/each}
    </b>
    {#if hint}<span>{hint}</span>{/if}
  </div>
  <div class="control">{@render children()}</div>
</div>

<style>
  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 24px;
    padding: 12px 0;
  }
  .row + :global(.row) {
    border-top: 1px solid var(--hairline);
  }
  .disabled .text {
    opacity: 0.5;
  }
  .text {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  b {
    display: flex;
    align-items: center;
    gap: 6px;
    font-weight: 600;
  }
  span {
    color: var(--text-muted);
    font-size: 12.5px;
    line-height: 1.4;
  }
  em {
    font-style: normal;
    font-size: 10.5px;
    font-weight: 650;
    letter-spacing: 0.02em;
    color: var(--text-muted);
    background: var(--hairline);
    padding: 1px 7px;
    border-radius: var(--radius-pill);
  }
  em.experimental {
    color: #9a6a10;
    background: rgba(240, 181, 74, 0.2);
  }
  .control {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: none;
  }
</style>
