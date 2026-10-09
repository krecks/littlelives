<script lang="ts">
  import Icon from './Icon.svelte';
  import { services } from './services';
  import { game } from './state.svelte';
  import { storyIcon, storyText, storyTone } from './story';
</script>

<ol class="feed" class:hidden={game.journalOpen} aria-live="polite">
  {#each game.feed as f (f.event.id)}
    <li class={storyTone(f.event)} class:milestone={f.event.importance >= 2}>
      <button title="Show" onclick={() => services.controls.showEvent(f.event)}>
        <span class="icon"><Icon name={storyIcon(f.event)} size={16} /></span>
        {storyText(f.event)}
      </button>
    </li>
  {/each}
</ol>

<style>
  .feed {
    position: absolute;
    top: 80px;
    right: var(--edge);
    width: 300px;
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 6px;
    pointer-events: none;
  }
  .feed.hidden {
    display: none;
  }
  li {
    pointer-events: auto;
    border-radius: var(--radius-md);
    background: var(--glass-strong);
    border: 1px solid var(--glass-border);
    box-shadow: var(--shadow-md);
    backdrop-filter: blur(var(--glass-blur));
    -webkit-backdrop-filter: blur(var(--glass-blur));
    font-weight: 550;
    font-size: 13px;
    animation:
      slide var(--slow) var(--ease),
      fade 12s linear forwards;
  }
  li.milestone {
    border-color: var(--accent);
  }
  li button {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 10px 12px;
    text-align: left;
    font: inherit;
    color: inherit;
  }
  .icon {
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    flex: none;
    border-radius: 9px;
    background: rgba(79, 191, 133, 0.15);
    color: var(--good);
  }
  .love .icon {
    background: rgba(224, 96, 126, 0.14);
    color: #e0607e;
  }
  .bad .icon {
    background: rgba(236, 106, 92, 0.14);
    color: var(--bad);
  }
  @keyframes slide {
    from {
      opacity: 0;
      transform: translateX(16px);
    }
  }
  @keyframes fade {
    85% {
      opacity: 1;
    }
    to {
      opacity: 0;
    }
  }
</style>
