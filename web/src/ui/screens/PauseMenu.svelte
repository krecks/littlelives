<script lang="ts">
  import type { GameSession } from '../../game/session';
  import { settings } from '../../settings/settings.svelte';
  import { app } from '../app.svelte';
  import { clock } from '../format';
  import Icon from '../Icon.svelte';
  import { game, toast } from '../state.svelte';

  let { session }: { session: GameSession } = $props();

  let view = $state<'main' | 'save' | 'quit'>('main');
  let saveName = $state('');
  let busy = $state(false);

  function openSave() {
    saveName = `${session.household} · Day ${game.day}`;
    view = 'save';
  }

  async function save(): Promise<boolean> {
    busy = true;
    try {
      await session.save(saveName.trim() || session.household);
      toast('Game saved');
      return true;
    } catch (err) {
      toast(`Saving failed: ${err instanceof Error ? err.message : err}`);
      return false;
    } finally {
      busy = false;
    }
  }

  async function saveAndQuit() {
    saveName ||= `${session.household} · Day ${game.day}`;
    if (await save()) app.toMenu();
  }
</script>

<div class="pause scaled">
  <div class="scrim"></div>
  <div class="panel" role="dialog" aria-modal="true" aria-label="Pause menu">
    {#if view === 'main'}
      <span class="eyebrow">Paused</span>
      <h2>{session.household}</h2>
      <p class="when">Day {game.day} · {clock(game.minute, settings.clock24h)}</p>
      <nav>
        <button class="btn primary large" onclick={() => (game.pauseMenu = false)}>Resume</button>
        <button class="btn large" onclick={openSave}><Icon name="icon.ui.save" size={18} /> Save game</button>
        <button class="btn large" onclick={() => (app.overlay = 'load')}>Load game</button>
        <button class="btn large" onclick={() => (app.overlay = 'settings')}><Icon name="icon.ui.settings" size={18} /> Settings</button>
        <button class="btn large ghost" onclick={() => (view = 'quit')}>Quit to main menu</button>
      </nav>
    {:else if view === 'save'}
      <span class="eyebrow">Save game</span>
      <h2>Name this save</h2>
      <form
        onsubmit={async (e) => {
          e.preventDefault();
          if (await save()) view = 'main';
        }}
      >
        <!-- svelte-ignore a11y_autofocus -->
        <input class="input" bind:value={saveName} maxlength="40" autofocus />
        <div class="row">
          <button type="button" class="btn ghost" onclick={() => (view = 'main')}>Back</button>
          <button type="submit" class="btn primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </form>
    {:else}
      <span class="eyebrow">Quit to main menu</span>
      <h2>Leave this game?</h2>
      <p class="when">Progress since your last save will be lost.</p>
      <nav>
        <button class="btn primary large" disabled={busy} onclick={saveAndQuit}>Save and quit</button>
        <button class="btn large danger" onclick={() => app.toMenu()}>Quit without saving</button>
        <button class="btn large ghost" onclick={() => (view = 'main')}>Cancel</button>
      </nav>
    {/if}
  </div>
</div>

<style>
  .pause {
    position: fixed;
    inset: 0;
    display: grid;
    place-items: center;
    z-index: 40;
  }
  .scrim {
    position: absolute;
    inset: 0;
    background: var(--backdrop);
    backdrop-filter: blur(8px) saturate(0.8);
    -webkit-backdrop-filter: blur(8px) saturate(0.8);
    animation: fade var(--slow) var(--ease);
  }
  .panel {
    position: relative;
    width: 360px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 28px;
    border-radius: 24px;
    background: var(--glass-strong);
    border: 1px solid var(--glass-border);
    box-shadow: 0 30px 80px rgba(20, 24, 40, 0.3);
    animation: rise var(--slow) var(--ease);
  }
  h2 {
    margin: 0;
    font-size: 24px;
    letter-spacing: -0.02em;
  }
  .when {
    margin: 0 0 14px;
    color: var(--text-muted);
  }
  nav,
  form {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  form {
    margin-top: 12px;
  }
  .row {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 6px;
  }
  @keyframes fade {
    from {
      opacity: 0;
    }
  }
  @keyframes rise {
    from {
      opacity: 0;
      transform: translateY(12px) scale(0.98);
    }
  }
</style>
