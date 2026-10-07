<script lang="ts">
  import { onMount } from 'svelte';
  import { host } from '../../game/host';
  import type { GameSession } from '../../game/session';
  import { settings } from '../../settings/settings.svelte';
  import { app } from '../app.svelte';
  import Hud from '../Hud.svelte';
  import { game } from '../state.svelte';
  import PauseMenu from './PauseMenu.svelte';

  /** The game screen: the canvas lives in the host (behind every screen); this adds the HUD. */
  let session = $state.raw<GameSession | null>(null);
  let error = $state('');

  onMount(() => {
    let left = false;
    host
      .start(app.request!, $state.snapshot(settings))
      .then((s) => {
        if (!left) session = s;
      })
      .catch((err: unknown) => {
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
{:else}
  <div class="splash">
    <div class="glass box">
      {#if error}
        <b>Couldn't start the game</b>
        <span class="error">{error}</span>
        <button class="btn" onclick={() => app.toMenu()}>Back to menu</button>
      {:else}
        <div class="spinner"></div>
        <span>Moving in…</span>
      {/if}
    </div>
  </div>
{/if}

<style>
  .hud-root {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }
  .splash {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    background: rgba(233, 238, 248, 0.6);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
  }
  .box {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    padding: 28px 36px;
    max-width: 480px;
    text-align: center;
    font-weight: 550;
  }
  .error {
    color: var(--bad);
    font-weight: 500;
  }
  .spinner {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    border: 3px solid var(--accent-soft);
    border-top-color: var(--accent);
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
