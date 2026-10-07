<script lang="ts">
  import { onMount } from 'svelte';
  import { host } from './game/host';
  import { loadGameData } from './game/session';
  import { latestSave } from './persistence/saves';
  import { settings } from './settings/settings.svelte';
  import { app } from './ui/app.svelte';
  import Modal from './ui/kit/Modal.svelte';
  import ChooseHome from './ui/screens/ChooseHome.svelte';
  import CreateHousehold from './ui/screens/CreateHousehold.svelte';
  import CreateNeighbourhood from './ui/screens/CreateNeighbourhood.svelte';
  import Credits from './ui/screens/Credits.svelte';
  import GameView from './ui/screens/GameView.svelte';
  import LoadGame from './ui/screens/LoadGame.svelte';
  import MainMenu from './ui/screens/MainMenu.svelte';
  import MenuBackdrop from './ui/screens/MenuBackdrop.svelte';
  import SettingsPanel from './ui/screens/SettingsPanel.svelte';
  import Toasts from './ui/Toasts.svelte';

  let gameLayer: HTMLDivElement;

  onMount(() => {
    host.mount(gameLayer);
    loadGameData()
      .then(() => (app.dataReady = true))
      .catch((err: unknown) => (app.fatal = err instanceof Error ? err.message : String(err)));
  });

  // Global interface preferences.
  $effect(() => {
    const root = document.documentElement;
    root.style.setProperty('--ui-scale', String(settings.uiScale));
    root.classList.toggle('reduce-motion', settings.reducedMotion);
  });

  const titles = { settings: 'Settings', load: 'Load game', credits: 'Credits' } as const;

  /**
   * Prepare the next game in the background so starting it is instant: the latest save
   * while on the main menu, the chosen house while picking a home.
   */
  $effect(() => {
    if (!app.dataReady) return;
    const screen = app.screen;
    const town = app.town;
    const household = app.household;
    const slot = app.homeSlot;
    const snapshot = $state.snapshot(settings);
    let cancelled = false;
    if (screen !== 'menu' && screen !== 'game') void host.hideBackdrop();
    // Let the screen's own entrance animation finish first.
    const timer = setTimeout(async () => {
      if (screen === 'menu') {
        const latest = await latestSave().catch(() => undefined);
        if (cancelled || !latest || app.screen !== 'menu') return;
        await host.prepare({ kind: 'load', saveId: latest.id }, snapshot).catch(() => {});
        if (!cancelled && app.screen === 'menu') await host.showAsBackdrop();
      } else if (screen === 'home' && town && household && slot !== null) {
        await host.prepare({ kind: 'new', town, household, slot }, snapshot).catch(() => {});
      }
    }, 500);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  });
</script>

<!-- The game canvas lives here permanently (engine and shaders survive between games). -->
<div class="game-layer" class:hidden={app.screen !== 'game' && !app.liveBackdrop} bind:this={gameLayer}></div>

{#if app.fatal}
  <MenuBackdrop />
  <div class="center"><div class="glass box"><b>Couldn't load game data</b><span>{app.fatal}</span></div></div>
{:else if !app.dataReady}
  <MenuBackdrop />
{:else if app.screen === 'game'}
  {#key app.sessionKey}<GameView />{/key}
{:else}
  {#if !app.liveBackdrop}<MenuBackdrop />{/if}
  {#if app.screen === 'neighbourhood'}
    <CreateNeighbourhood />
  {:else if app.screen === 'create'}
    <CreateHousehold />
  {:else if app.screen === 'home'}
    <ChooseHome />
  {:else}
    <MainMenu />
  {/if}
{/if}

{#if app.overlay}
  <Modal title={titles[app.overlay]} width={app.overlay === 'credits' ? 520 : 680} onclose={() => (app.overlay = null)}>
    {#if app.overlay === 'settings'}<SettingsPanel />{:else if app.overlay === 'load'}<LoadGame />{:else}<Credits />{/if}
  </Modal>
{/if}

<div class="scaled toast-layer"><Toasts /></div>

<style>
  .game-layer {
    position: fixed;
    inset: 0;
    transition: opacity 600ms var(--ease);
  }
  .game-layer.hidden {
    opacity: 0;
    pointer-events: none;
  }
  .game-layer :global(.scene) {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    display: block;
    outline: none;
    touch-action: none;
  }
  .game-layer :global(.world-overlay) {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }
  .center {
    position: fixed;
    inset: 0;
    display: grid;
    place-items: center;
  }
  .box {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 28px 36px;
    max-width: 480px;
  }
  .toast-layer {
    position: fixed;
    inset: 0;
    pointer-events: none;
    z-index: 60;
  }
</style>
