<script lang="ts">
  import Icon from './Icon.svelte';
  import { clock } from './format';
  import { settings } from '../settings/settings.svelte';
  import { services } from './services';
  import { game } from './state.svelte';

  const speeds = [
    { value: 0, icon: 'icon.ui.pause', label: 'Pause (Space)' },
    { value: 1, icon: 'icon.ui.speed1', label: 'Normal speed (1)' },
    { value: 2, icon: 'icon.ui.speed2', label: 'Fast (2)' },
    { value: 3, icon: 'icon.ui.speed3', label: 'Ultra (3)' },
  ];
  const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const modes = [
    { id: 'live', icon: 'icon.ui.live', label: 'Live', enabled: true },
    { id: 'build', icon: 'icon.ui.build', label: 'Build', enabled: false },
    { id: 'buy', icon: 'icon.ui.buy', label: 'Buy', enabled: false },
  ];
</script>

<header class="bar">
  <div class="glass group">
    <span class="brand">{game.household || 'open-sims'}</span>
    <div class="segmented">
      {#each modes as mode (mode.id)}
        <button class:active={mode.id === 'live'} disabled={!mode.enabled} title={mode.enabled ? mode.label : `${mode.label} — coming soon`}>
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
    <div class="segmented">
      {#each speeds as s (s.value)}
        <button class:active={game.speed === s.value} title={s.label} aria-label={s.label} onclick={() => services.controls.setSpeed(s.value)}>
          <Icon name={s.icon} size={16} />
        </button>
      {/each}
    </div>
  </div>

  <div class="glass group">
    <span class="funds tabular" title="Household funds"><Icon name="icon.ui.funds" size={16} />§ {game.funds.toLocaleString()}</span>
    <button class="tool" class:active={game.townOpen} title="Town map (M)" aria-label="Town map" onclick={() => (game.townOpen = !game.townOpen)}>
      <Icon name="icon.ui.town" />
    </button>
    <button
      class="tool"
      title="Walls up / down (W)"
      aria-label="Toggle walls"
      onclick={() => services.controls.setWallMode(game.wallMode === 'up' ? 'down' : 'up')}
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
  .tool {
    display: grid;
    place-items: center;
    width: 36px;
    height: 36px;
    border-radius: var(--radius-sm);
    color: var(--text-muted);
    transition: background var(--fast) var(--ease), color var(--fast) var(--ease);
  }
  .tool:hover,
  .tool.active {
    background: var(--accent-soft);
    color: var(--accent);
  }
</style>
