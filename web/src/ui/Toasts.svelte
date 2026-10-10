<script lang="ts">
  import Icon from './Icon.svelte';
  import { dropToast, game, type Toast, type ToastAction } from './state.svelte';

  function answer(t: Toast, a: ToastAction) {
    dropToast(t.id);
    a.run();
  }
</script>

<div class="toasts" aria-live="polite">
  {#each game.toasts as t (t.id)}
    {#if t.actions}
      <div class="toast ask" role="group" aria-label={t.text}>
        {#if t.icon}<span class="icon"><Icon name={t.icon} size={15} /></span>{/if}
        <span class="text">{t.text}</span>
        {#each t.actions as a (a.label)}
          <button class="btn small" class:primary={a.primary} title={a.title} onclick={() => answer(t, a)}>{a.label}</button>
        {/each}
      </div>
    {:else}
      <div class="toast">{t.text}</div>
    {/if}
  {/each}
</div>

<style>
  .toasts {
    position: absolute;
    left: 50%;
    bottom: var(--edge);
    transform: translateX(-50%);
    display: flex;
    flex-direction: column;
    gap: 8px;
    align-items: center;
    pointer-events: none;
  }
  .toast {
    padding: 10px 16px;
    border-radius: var(--radius-pill);
    background: rgba(29, 34, 48, 0.85);
    color: var(--text-inverse);
    font-weight: 550;
    box-shadow: var(--shadow-md);
    animation: rise var(--slow) var(--ease);
  }
  .ask {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 6px 6px 8px;
    pointer-events: auto;
  }
  .ask .text {
    padding-right: 4px;
  }
  /* A plain .btn is white and inherits the toast's white text: make it light-on-dark instead. */
  .ask .btn:not(.primary) {
    background: rgba(255, 255, 255, 0.14);
    border-color: transparent;
    box-shadow: none;
  }
  .ask .btn:not(.primary):hover {
    background: rgba(255, 255, 255, 0.22);
  }
  .icon {
    display: grid;
    place-items: center;
    width: 26px;
    height: 26px;
    flex: none;
    border-radius: 99px;
    background: rgba(255, 255, 255, 0.14);
  }
  @keyframes rise {
    from {
      opacity: 0;
      transform: translateY(8px);
    }
  }
</style>
