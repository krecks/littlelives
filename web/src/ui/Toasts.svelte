<script lang="ts">
  import { game } from './state.svelte';
</script>

<div class="toasts" aria-live="polite">
  {#each game.toasts as t (t.id)}
    <div class="toast">{t.text}</div>
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
  @keyframes rise {
    from {
      opacity: 0;
      transform: translateY(8px);
    }
  }
</style>
