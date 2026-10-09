<script lang="ts">
  import { money } from './format';
  import { services } from './services';
  import { game } from './state.svelte';

  const RADIUS = 96;
  const menu = $derived(game.menu);
  /** Who does it: the household member last looked at. */
  const actor = $derived(game.sims.find((s) => s.id === game.selected));
  // Keep the ring on screen.
  const cx = $derived(menu ? Math.min(Math.max(menu.x, RADIUS + 80), innerWidth - RADIUS - 80) : 0);
  const cy = $derived(menu ? Math.min(Math.max(menu.y, RADIUS + 40), innerHeight - RADIUS - 40) : 0);

  function position(i: number, n: number): string {
    const angle = -Math.PI / 2 + (i * Math.PI * 2) / Math.max(n, 1);
    return `--dx:${Math.cos(angle) * RADIUS}px;--dy:${Math.sin(angle) * RADIUS}px`;
  }
</script>

{#if menu}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="scrim" onclick={() => services.controls.closeMenu()}></div>
  <div class="pie" style="left:{cx}px;top:{cy}px" role="menu" aria-label={menu.title}>
    <div class="title">{menu.title}{#if actor}<small> · {actor.name}</small>{/if}</div>
    {#each menu.items as item, i (item.index)}
      {@const poor = item.cost !== undefined && item.cost > game.funds}
      <button
        class="item"
        role="menuitem"
        style={position(i, menu.items.length)}
        disabled={item.disabled || poor}
        title={poor ? `Can't afford — costs ${money(item.cost ?? 0)}` : undefined}
        onclick={() => services.controls.useObject(menu.objectId, item.index)}
      >
        {item.label}{#if item.cost !== undefined}<span class="cost tabular" class:short={poor}> · {money(item.cost)}</span>{/if}
      </button>
    {/each}
  </div>
{/if}

<style>
  .scrim {
    position: absolute;
    inset: 0;
    pointer-events: auto;
  }
  .pie {
    position: absolute;
    width: 0;
    height: 0;
  }
  .title,
  .item {
    position: absolute;
    transform: translate(-50%, -50%);
    white-space: nowrap;
    border-radius: var(--radius-pill);
    backdrop-filter: blur(var(--glass-blur));
    -webkit-backdrop-filter: blur(var(--glass-blur));
  }
  .title {
    padding: 6px 12px;
    background: rgba(29, 34, 48, 0.78);
    color: var(--text-inverse);
    font-size: 12px;
    font-weight: 600;
    animation: pop var(--slow) var(--ease);
  }
  .item {
    padding: 10px 16px;
    background: var(--glass-strong);
    border: 1px solid var(--glass-border);
    box-shadow: var(--shadow-md);
    font-weight: 600;
    pointer-events: auto;
    animation: fly var(--slow) var(--ease) both;
    transform: translate(calc(-50% + var(--dx)), calc(-50% + var(--dy)));
    transition: background var(--fast) var(--ease), color var(--fast) var(--ease);
  }
  .item:hover:not(:disabled) {
    background: var(--accent);
    color: var(--text-inverse);
  }
  .item:disabled {
    cursor: not-allowed;
    color: var(--text-muted);
  }
  .cost {
    font-weight: 550;
    opacity: 0.8;
  }
  .cost.short {
    color: var(--bad);
    opacity: 1;
  }
  @keyframes fly {
    from {
      opacity: 0;
      transform: translate(-50%, -50%) scale(0.6);
    }
  }
  @keyframes pop {
    from {
      opacity: 0;
      transform: translate(-50%, -50%) scale(0.8);
    }
  }
</style>
