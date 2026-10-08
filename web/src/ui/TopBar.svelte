<script lang="ts">
  import Icon from './Icon.svelte';
  import { clock, money, WEEKDAYS } from './format';
  import { settings } from '../settings/settings.svelte';
  import { services } from './services';
  import { game, nextWallMode } from './state.svelte';

  const speeds = [
    { value: 0, icon: 'icon.ui.pause', label: 'Pause (Space)' },
    { value: 1, icon: 'icon.ui.speed1', label: 'Normal speed (1)' },
    { value: 2, icon: 'icon.ui.speed2', label: 'Fast (2)' },
    { value: 3, icon: 'icon.ui.speed3', label: 'Ultra (3)' },
  ];
  const modes = [
    { id: 'live', icon: 'icon.ui.live', label: 'Live', key: 'L' },
    { id: 'buy', icon: 'icon.ui.buy', label: 'Buy', key: 'V / B' },
  ] as const;
  const rent = services.content.economy.rent;
  const fundsTitle = $derived(
    game.rent !== null && rent
      ? `Household funds · rent ${money(game.rent)} + bills ${money(game.bills ?? 0)} every ${WEEKDAYS[rent.weekday]} at ${clock(rent.hour * 60, settings.clock24h)}. Bills grow with the value of everything you own.`
      : 'Household funds',
  );
</script>

<header class="bar">
  <div class="glass group">
    <span class="brand">{game.household || 'Littlelives'}</span>
    <div class="segmented">
      {#each modes as mode (mode.id)}
        <button class:active={mode.id === game.mode} title="{mode.label} ({mode.key})" onclick={() => services.controls.setMode(mode.id)}>
          <Icon name={mode.icon} size={16} />
          <span>{mode.label}</span>
        </button>
      {/each}
    </div>
  </div>

  <div class="glass group center">
    <div class="time">
      <span class="day">{WEEKDAYS[game.weekday]} · Day {game.day}</span>
      <span class="clock tabular">{clock(game.minute, settings.clock24h)}</span>
    </div>
    {#if game.mode === 'buy'}
      <span class="paused" title="Time stands still while you shop and build. Back to Live (L) to resume.">
        <Icon name="icon.ui.pause" size={14} />Paused · Buy mode
      </span>
    {:else}
      <div class="segmented">
        {#each speeds as s (s.value)}
          <button class:active={game.speed === s.value} title={s.label} aria-label={s.label} onclick={() => services.controls.setSpeed(s.value)}>
            <Icon name={s.icon} size={16} />
          </button>
        {/each}
      </div>
    {/if}
  </div>

  <div class="glass group">
    <span class="funds tabular" class:debt={game.funds < 0} title={fundsTitle}>
      <Icon name="icon.ui.funds" size={16} />{money(game.funds)}
      {#if game.rent !== null}<small>rent + bills {money(game.rent + (game.bills ?? 0))}/wk</small>{/if}
    </span>
    <button
      class="tool"
      class:active={game.townOpen}
      disabled={game.mode !== 'live'}
      title={game.mode === 'live' ? 'Town map (M)' : 'Town map (Live mode only)'}
      aria-label="Town map"
      onclick={() => (game.townOpen = !game.townOpen)}
    >
      <Icon name="icon.ui.town" />
    </button>
    <button
      class="tool"
      title="Walls: {game.wallMode} (W: up → cutaway → down)"
      aria-label="Toggle walls"
      onclick={() => services.controls.setWallMode(nextWallMode(game.wallMode))}
    >
      <Icon name={game.wallMode === 'up' ? 'icon.ui.wallsUp' : 'icon.ui.wallsDown'} />
    </button>
    <button class="tool" class:active={game.perfOpen} title="Performance (F3)" aria-label="Performance overlay" onclick={() => (game.perfOpen = !game.perfOpen)}>
      <Icon name="icon.ui.perf" />
    </button>
    <button class="tool" title="Menu (Esc)" aria-label="Pause menu" onclick={() => services.controls.openPauseMenu()}>
      <Icon name="icon.ui.settings" />
    </button>
  </div>
</header>

<style>
  .bar {
    position: absolute;
    inset: var(--edge) var(--edge) auto;
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: var(--gap);
    pointer-events: none;
  }
  .group {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px;
    pointer-events: auto;
  }
  .brand {
    font-weight: 700;
    letter-spacing: -0.02em;
    padding: 0 8px 0 10px;
  }
  .segmented {
    display: flex;
    gap: 2px;
    padding: 3px;
    background: var(--hairline);
    border-radius: var(--radius-md);
  }
  .segmented button {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 30px;
    padding: 0 10px;
    border-radius: var(--radius-sm);
    color: var(--text-muted);
    font-weight: 550;
    transition: background var(--fast) var(--ease), color var(--fast) var(--ease);
  }
  .segmented button:hover:not(:disabled) {
    color: var(--text);
  }
  .segmented button.active {
    background: var(--glass-strong);
    color: var(--accent);
    box-shadow: var(--shadow-sm);
  }
  .segmented button:disabled {
    opacity: 0.45;
    cursor: default;
  }
  .time {
    display: flex;
    flex-direction: column;
    line-height: 1.1;
    padding: 0 6px 0 10px;
  }
  .day {
    font-size: 11px;
    font-weight: 600;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  .clock {
    font-size: 18px;
    font-weight: 650;
    letter-spacing: -0.01em;
  }
  .funds {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 0 10px 0 8px;
    font-weight: 650;
    color: var(--good);
  }
  .funds.debt {
    color: var(--bad);
  }
  .funds small {
    color: var(--text-muted);
    font-weight: 550;
    font-size: 11px;
  }
  .tool {
    display: grid;
    place-items: center;
    width: 36px;
    height: 36px;
    border-radius: var(--radius-sm);
    color: var(--text-muted);
    transition: background var(--fast) var(--ease), color var(--fast) var(--ease);
  }
  .tool:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .paused {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 36px;
    padding: 0 12px;
    border-radius: var(--radius-pill);
    background: var(--accent-soft);
    color: var(--accent);
    font-size: 12px;
    font-weight: 650;
    white-space: nowrap;
  }
  .tool:hover:not(:disabled),
  .tool.active {
    background: var(--accent-soft);
    color: var(--accent);
  }
</style>
