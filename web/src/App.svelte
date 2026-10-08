<script lang="ts">
  import { onMount } from 'svelte';
  import { host } from './game/host';
  import { menuScene } from './game/menuScene';
  import { loadDebugReport } from './debug/report';
  import { loadGameData } from './game/session';
  import { latestSave } from './persistence/saves';
  import { settings } from './settings/settings.svelte';
  import { app } from './ui/app.svelte';
  import { services } from './ui/services';
  import { toast } from './ui/state.svelte';
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
      .then(openDebugReport)
      .catch((err: unknown) => (app.fatal = err instanceof Error ? err.message : String(err)));
  });

  // Global interface preferences.
  $effect(() => {
    const root = document.documentElement;
    root.style.setProperty('--ui-scale', String(settings.uiScale));
    root.classList.toggle('reduce-motion', settings.reducedMotion);
  });

  /** `?debugReport=<name>` (dev server): starts straight into a saved debug report's game. */
  async function openDebugReport() {
    const name = new URLSearchParams(location.search).get('debugReport');
    if (!name || !import.meta.env.DEV) return;
    try {
      app.start({ kind: 'load', saveId: await loadDebugReport(name) });
    } catch (err) {
      console.error(err);
      toast(err instanceof Error ? err.message : String(err), 6000);
    }
  }

  const titles = { settings: 'Settings', load: 'Load game', credits: 'Credits' } as const;

  /**
   * The live 3D town behind the menus: a showcase neighbourhood on the main menu (and its
   * overlays), the household's new town behind character creation. The neighbourhood and
   * home screens show and frame their town themselves.
   */
  $effect(() => {
    if (!app.dataReady || app.fatal) return;
    const screen = app.screen;
    const town = app.town;
    let cancelled = false;
    if (screen === 'menu' || screen === 'create') {
      void (async () => {
        const draft = screen === 'create' && town ? town : await menuScene.showcaseDraft();
        if (cancelled) return;
        menuScene.highlight({});
        menuScene.shoot({ kind: screen }, screen === 'menu' ? 2.4 : 2);
        await menuScene.show(draft).catch((err: unknown) => console.warn('[menu] town preview failed', err));
        // "New game" starts from this neighbourhood: have its residents' portraits ready by then.
        if (!cancelled && screen === 'menu') {
          services.previews?.prefetch(draft.households.flatMap((h) => h.household.members.map((m) => ({ gender: m.gender, appearance: m.appearance }))));
        }
      })();
    }
    return () => {
      cancelled = true;
    };
  });

  // Live render settings (style, effects) while no game is running.
  $effect(() => {
    const s = $state.snapshot(settings);
    if (app.screen !== 'game') host.applyMenuSettings(s);
  });

  /**
   * Prepare the next game in the background so starting it is instant: the latest save
   * while on the main menu, the chosen house while picking a home. Both build hidden behind
   * the menus' town.
   */
  $effect(() => {
    if (!app.dataReady) return;
    const screen = app.screen;
    const town = app.town;
    const household = app.household;
    const slot = app.homeSlot;
    const snapshot = $state.snapshot(settings);
    let cancelled = false;
    // Let the screen's own entrance animation finish first.
    const timer = setTimeout(async () => {
      if (screen === 'menu') {
        const latest = await latestSave().catch(() => undefined);
        if (cancelled || !latest || app.screen !== 'menu') return;
        await host.prepare({ kind: 'load', saveId: latest.id }, snapshot).catch(() => {});
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
  /* Fades the scene out and in when it changes completely (menu town <-> a saved game). */
  .game-layer :global(.scene-veil) {
    position: absolute;
    inset: 0;
    pointer-events: none;
    background: radial-gradient(ellipse at 60% 40%, #f3e6d2 0%, #d9cbb8 60%, #b9ab98 100%);
    opacity: 0;
    transition: opacity 240ms var(--ease);
  }
  .game-layer :global(.scene-veil.on) {
    opacity: 1;
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
