<script lang="ts">
  import { onMount } from 'svelte';
  import { host } from '../../game/host';
  import type { GameSession } from '../../game/session';
  import { settings } from '../../settings/settings.svelte';
  import { app } from '../app.svelte';
  import Hud from '../Hud.svelte';
  import { game } from '../state.svelte';
  import LoadingScreen from './LoadingScreen.svelte';
  import PauseMenu from './PauseMenu.svelte';

  /** The game screen: the canvas lives in the host (behind every screen); this adds the HUD. */
  let session = $state.raw<GameSession | null>(null);
  let error = $state('');
  /** The game is loaded (usually already, prepared behind the menus); until then, a loading screen. */
  let ready = $state(false);

  onMount(() => {
    let left = false;
    const snapshot = $state.snapshot(settings);
    host
      .prepare(app.request!, snapshot)
      .then(() => {
        if (!left) ready = true;
      })
      .catch(() => {});
    host
      .start(app.request!, snapshot)
      .then((s) => {
        if (!left) session = s;
      })
      .catch((err: unknown) => {
        // Left (or replaced, e.g. by a dev hot reload) before it started: nothing went wrong.
        if (left) return;
        console.error(err);
        error = err instanceof Error ? err.message : String(err);
      });
    return () => {
      left = true;
      host.release();
    };
  });

  // Live settings (effects, camera, free will, autosave).
  $effect(() => {
    const s = $state.snapshot(settings);
    session?.applySettings(s);
  });

  // The world stands still while a menu is open.
  $effect(() => {
    session?.setMenuPause(game.pauseMenu || app.overlay !== null);
  });
</script>

{#if session}
  <div class="scaled hud-root"><Hud /></div>
  {#if game.pauseMenu}<PauseMenu {session} />{/if}
{:else if error}
  <div class="splash">
    <div class="glass box">
      <b>Couldn't start the game</b>
      <span class="error">{error}</span>
      <button class="btn" onclick={() => app.toMenu()}>Back to menu</button>
    </div>
  </div>
{:else if !ready}
  <LoadingScreen progress={app.loading ?? { label: 'Moving in', value: 0 }} />
{/if}

<style>
  .hud-root {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }
  /* An error starting the game: a small card over the scene. */
  .splash {
    position: absolute;
    inset: auto 0 48px 0;
    display: grid;
    place-items: center;
    pointer-events: none;
  }
  .box {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 22px;
    max-width: 480px;
    text-align: center;
    font-weight: 600;
    border-radius: var(--radius-pill);
    pointer-events: auto;
    animation: pill 420ms var(--ease) both;
  }
  .box:has(.error) {
    flex-direction: column;
    border-radius: var(--radius-lg);
    padding: 24px 32px;
  }
  @keyframes pill {
    from {
      opacity: 0;
      transform: translateY(10px);
    }
  }
  .error {
    color: var(--bad);
    font-weight: 500;
  }
</style>
