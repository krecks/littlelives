<script lang="ts">
  /**
   * Full-screen loading: the menu backdrop, the game's name, what is loading and a progress bar.
   * Covers the 3D scene, so nothing is seen half-built; fades out when it goes.
   */
  import { fade } from 'svelte/transition';
  import type { Progress } from '../app.svelte';
  import MenuBackdrop from './MenuBackdrop.svelte';

  let { progress }: { progress: Progress } = $props();
  /** The bar never runs backwards (a step may report less than an earlier estimate). */
  let shown = $state(0);
  $effect(() => {
    shown = Math.max(shown, Math.min(1, progress.value));
  });
</script>

<div class="loading" out:fade={{ duration: 420 }} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(shown * 100)} aria-valuetext={progress.label}>
  <MenuBackdrop always />
  <div class="center scaled">
    <div class="card glass">
      <h1>Idyll Lives</h1>
      <div class="bar"><div class="fill" style:transform="scaleX({shown})"></div></div>
      <p class="label">{progress.label}{shown < 1 ? "…" : ""}</p>
    </div>
  </div>
</div>

<style>
  .loading {
    position: fixed;
    inset: 0;
    z-index: 50;
  }
  .center {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    padding: 16px;
  }
  .card {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 14px;
    width: min(360px, 100%);
    padding: 32px 36px 28px;
    animation: rise 420ms var(--ease) both;
  }
  @keyframes rise {
    from {
      opacity: 0;
      transform: translateY(10px);
    }
  }
  h1 {
    margin: 0;
    font-size: 26px;
    font-weight: 750;
    letter-spacing: -0.02em;
    color: var(--text-strong);
  }
  .bar {
    width: 100%;
    height: 6px;
    border-radius: var(--radius-pill);
    background: var(--accent-soft);
    overflow: hidden;
  }
  .fill {
    width: 100%;
    height: 100%;
    border-radius: inherit;
    background: var(--accent);
    transform-origin: left center;
    transition: transform 420ms var(--ease);
  }
  .label {
    margin: 0;
    font-size: 13px;
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
  }
  :global(.reduce-motion) .card,
  :global(.reduce-motion) .fill {
    animation: none;
    transition: none;
  }
</style>
