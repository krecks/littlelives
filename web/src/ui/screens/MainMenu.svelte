<script lang="ts">
  import { onMount } from 'svelte';
  import { listSaves, type SaveMeta } from '../../persistence/saves';
  import { settings } from '../../settings/settings.svelte';
  import { app } from '../app.svelte';
  import { clock } from '../format';
  import Icon from '../Icon.svelte';

  let saves = $state<SaveMeta[]>([]);
  const latest = $derived(saves[0]);
  const gpu = typeof navigator !== 'undefined' && 'gpu' in navigator;
  /** True while the live 3D scene renders behind the menu (set by the app when available). */
  const live = $derived((app as { liveBackdrop?: boolean }).liveBackdrop ?? false);

  onMount(() => {
    listSaves()
      .then((s) => (saves = s))
      .catch(() => (saves = []));
  });
</script>

<div class="menu scaled" class:live>
  <div class="scrim" aria-hidden="true"></div>

  <section class="panel">
    <header class="brand">
      <span class="mark" aria-hidden="true"></span>
      <div>
        <h1>open-sims</h1>
        <p>A little life, simulated in your browser.</p>
      </div>
    </header>

    <nav>
      {#if latest}
        <button class="item continue" onclick={() => app.start({ kind: 'load', saveId: latest.id })}>
          <span class="label">Continue</span>
          <span class="meta">{latest.household} · Day {latest.day}, {clock(latest.minute, settings.clock24h)}</span>
          <span class="arrow" aria-hidden="true">→</span>
        </button>
      {/if}
      <button class="item" class:primary={!latest} onclick={() => app.newGame()}>
        <Icon name="icon.ui.plus" size={18} /><span class="label">New game</span>
      </button>
      <button class="item" disabled={saves.length === 0} onclick={() => (app.overlay = 'load')}>
        <Icon name="icon.ui.save" size={18} /><span class="label">Load game</span>
      </button>
      <button class="item" onclick={() => (app.overlay = 'settings')}>
        <Icon name="icon.ui.settings" size={18} /><span class="label">Settings</span>
      </button>
      <button class="item quiet" onclick={() => (app.overlay = 'credits')}>
        <span class="label">Credits</span>
      </button>
    </nav>

    <footer>
      <span>v0.2 · desktop</span>
      <span class="dot"></span>
      <span>{gpu ? 'WebGPU available' : 'WebGL2 mode'}</span>
    </footer>
  </section>
</div>

<style>
  .menu {
    position: relative;
    height: 100vh;
    display: flex;
    align-items: stretch;
    color: #f4f1ea;
  }
  /* Darkens the left side of whatever is behind (live scene or fallback still) for legibility. */
  .scrim {
    position: absolute;
    inset: 0;
    pointer-events: none;
    background:
      linear-gradient(90deg, rgba(8, 11, 16, 0.62) 0%, rgba(8, 11, 16, 0.38) 30%, rgba(8, 11, 16, 0) 58%),
      linear-gradient(0deg, rgba(8, 11, 16, 0.35) 0%, rgba(8, 11, 16, 0) 30%);
  }
  .panel {
    position: relative;
    width: min(440px, 38vw);
    min-width: 360px;
    margin: 4vh 0 4vh 4vw;
    padding: 44px 36px 28px;
    display: flex;
    flex-direction: column;
    gap: 40px;
    border-radius: 22px;
    background: rgba(18, 22, 28, 0.42);
    border: 1px solid rgba(255, 255, 255, 0.12);
    box-shadow: 0 30px 80px rgba(0, 0, 0, 0.35);
    backdrop-filter: blur(22px) saturate(1.2);
    -webkit-backdrop-filter: blur(22px) saturate(1.2);
    animation: enter 700ms var(--ease) both;
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 16px;
  }
  .mark {
    width: 48px;
    height: 48px;
    flex: none;
    border-radius: 14px;
    background:
      radial-gradient(circle at 70% 28%, rgba(255, 236, 200, 0.95) 0 14%, transparent 15%),
      linear-gradient(180deg, #7fa6d6 0%, #e7c6a0 58%, #5d7a43 59%, #3f5a2e 100%);
    box-shadow:
      inset 0 0 0 1px rgba(255, 255, 255, 0.25),
      0 8px 24px rgba(0, 0, 0, 0.3);
  }
  h1 {
    margin: 0;
    font-size: 42px;
    font-weight: 650;
    letter-spacing: -0.035em;
    line-height: 1;
  }
  p {
    margin: 8px 0 0;
    color: rgba(244, 241, 234, 0.7);
    font-size: 15px;
  }
  nav {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .item {
    position: relative;
    display: flex;
    align-items: center;
    gap: 14px;
    height: 52px;
    padding: 0 18px;
    border-radius: 14px;
    font-size: 17px;
    font-weight: 550;
    text-align: left;
    color: inherit;
    transition:
      background var(--fast) ease,
      transform var(--fast) var(--ease);
    animation: enter 600ms var(--ease) both;
  }
  .item:nth-child(2) {
    animation-delay: 50ms;
  }
  .item:nth-child(3) {
    animation-delay: 100ms;
  }
  .item:nth-child(4) {
    animation-delay: 150ms;
  }
  .item:nth-child(5) {
    animation-delay: 200ms;
  }
  .item:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.1);
    transform: translateX(4px);
  }
  .item:disabled {
    opacity: 0.38;
    cursor: default;
  }
  .item.primary {
    background: rgba(255, 255, 255, 0.92);
    color: #151a22;
  }
  .item.primary:hover:not(:disabled) {
    background: #ffffff;
  }
  .item.quiet {
    font-size: 15px;
    font-weight: 500;
    color: rgba(244, 241, 234, 0.7);
  }
  .continue {
    height: 76px;
    margin-bottom: 8px;
    display: grid;
    grid-template-columns: 1fr auto;
    grid-template-rows: auto auto;
    align-content: center;
    column-gap: 12px;
    row-gap: 3px;
    background: rgba(255, 255, 255, 0.92);
    color: #151a22;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.25);
  }
  .continue:hover:not(:disabled) {
    background: #ffffff;
  }
  .continue .label {
    font-size: 19px;
    font-weight: 650;
  }
  .continue .meta {
    grid-row: 2;
    font-size: 13px;
    font-weight: 500;
    color: #5d6472;
  }
  .continue .arrow {
    grid-row: 1 / span 2;
    grid-column: 2;
    font-size: 20px;
    transition: transform var(--fast) var(--ease);
  }
  .continue:hover .arrow {
    transform: translateX(3px);
  }
  footer {
    margin-top: auto;
    display: flex;
    align-items: center;
    gap: 10px;
    color: rgba(244, 241, 234, 0.55);
    font-size: 12px;
  }
  .dot {
    width: 4px;
    height: 4px;
    border-radius: 50%;
    background: currentColor;
  }
  @keyframes enter {
    from {
      opacity: 0;
      transform: translateY(14px);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .panel,
    .item {
      animation: none;
    }
  }
</style>
