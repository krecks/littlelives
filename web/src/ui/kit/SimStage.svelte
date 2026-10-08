<script lang="ts">
  import { onMount } from 'svelte';
  import type { Appearance } from '../../game/household';
  import type { SimStage, StageReaction } from '../../render/types';
  import Icon from '../Icon.svelte';
  import { services } from '../services';
  import SimPreview from './SimPreview.svelte';

  /**
   * The 3D household-creator stage: the Sim from the game's own character pipeline on a transparent
   * canvas (drag to turn, scroll or the buttons to zoom). Falls back to the flat illustration
   * without 3D support.
   */
  let { gender, appearance }: { gender: string; appearance: Appearance } = $props();

  let host: HTMLDivElement;
  let stage = $state.raw<SimStage | null>(null);
  let failed = $state(false);
  let zoom = $state(0);
  let queued: StageReaction | null = null;

  onMount(() => {
    let alive = true;
    let attached: SimStage | null = null;
    void services.previews.stage(host).then((s) => {
      if (!s) {
        failed = alive;
        return;
      }
      if (!alive) {
        s.detach();
        return;
      }
      attached = s;
      s.onZoom = (z) => (zoom = z);
      stage = s;
    });
    return () => {
      alive = false;
      attached?.detach();
    };
  });

  $effect(() => {
    const s = stage;
    if (!s) return;
    s.show({ gender, appearance: $state.snapshot(appearance) as Appearance });
    if (queued) {
      s.react(queued);
      queued = null;
    }
  });

  /** Plays a short reaction (queued until the stage is up). */
  export function react(reaction: StageReaction): void {
    if (stage) stage.react(reaction);
    else queued = reaction;
  }
</script>

<div class="stage-host" bind:this={host}>
  {#if failed}
    <div class="fallback"><SimPreview {appearance} size={260} /></div>
  {:else}
    <div class="zoom glass" role="group" aria-label="Framing">
      <button class:on={zoom < 0.5} aria-pressed={zoom < 0.5} title="Full body" onclick={() => stage?.zoomTo(0)}>
        <Icon name="icon.ui.body" size={16} /><span>Body</span>
      </button>
      <button class:on={zoom >= 0.5} aria-pressed={zoom >= 0.5} title="Face" onclick={() => stage?.zoomTo(1)}>
        <Icon name="icon.ui.face" size={16} /><span>Face</span>
      </button>
    </div>
    {#if stage}<span class="hint">Drag to turn · scroll to zoom</span>{/if}
  {/if}
</div>

<style>
  .stage-host {
    position: absolute;
    inset: 0;
  }
  .stage-host :global(canvas.sim-studio:focus-visible) {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
    border-radius: var(--radius-lg);
  }
  .fallback {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    padding-bottom: 22%;
  }
  .zoom {
    position: absolute;
    top: 6px;
    right: 6px;
    z-index: 1;
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 4px;
    border-radius: var(--radius-md);
  }
  .zoom button {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 32px;
    padding: 0 10px;
    border-radius: var(--radius-sm);
    font-weight: 600;
    font-size: 13px;
    color: var(--text-muted);
  }
  .zoom button.on {
    background: var(--surface);
    color: var(--text);
    box-shadow: var(--shadow-sm);
  }
  .hint {
    position: absolute;
    top: 12px;
    left: 50%;
    transform: translateX(-50%);
    padding: 5px 12px;
    border-radius: var(--radius-pill);
    background: rgba(20, 24, 40, 0.42);
    color: #fff;
    font-size: 12px;
    font-weight: 550;
    pointer-events: none;
    z-index: 1;
    animation: hint 5s var(--ease) forwards;
  }
  @keyframes hint {
    0%,
    70% {
      opacity: 1;
    }
    100% {
      opacity: 0;
    }
  }
</style>
