<script lang="ts">
  import { applyPreset, resetSettings, RESTART_KEYS, settings, type QualityPreset } from '../../settings/settings.svelte';
  import { STYLES, VISUAL_STYLES } from '../../render/styles';
  import { app } from '../app.svelte';
  import Segmented from '../kit/Segmented.svelte';
  import Toggle from '../kit/Toggle.svelte';

  const tabs = ['Graphics', 'Gameplay', 'Interface', 'Controls'] as const;
  let tab = $state<(typeof tabs)[number]>('Graphics');

  // Remember restart-only values when opened during a game, to show a notice if they change.
  const initial = Object.fromEntries(RESTART_KEYS.map((k) => [k, settings[k]]));
  const needsRestart = $derived(app.screen === 'game' && RESTART_KEYS.some((k) => settings[k] !== initial[k]));

  let preset = $state<QualityPreset>(settings.quality);
  $effect(() => {
    if (preset !== settings.quality) applyPreset(preset);
  });

  const keys = [
    ['Left-click a resident / Tab', 'Select a resident'],
    ['Left-click object', 'Interaction menu'],
    ['Left-click floor', 'Walk there'],
    ['Left-drag / right-drag', 'Rotate / pan camera'],
    ['Mouse wheel', 'Zoom'],
    ['Space · 0–3', 'Pause · game speed'],
    ['W', 'Walls up / down'],
    ['Esc', 'Pause menu'],
    ['F3', 'Performance overlay'],
  ];
</script>

<div class="settings">
  <div class="tabs" role="tablist">
    {#each tabs as t (t)}
      <button role="tab" aria-selected={tab === t} class:active={tab === t} onclick={() => (tab = t)}>{t}</button>
    {/each}
  </div>

  {#if needsRestart}
    <p class="notice">Some changes apply the next time you start or load a game.</p>
  {/if}

  <div class="rows">
    {#if tab === 'Graphics'}
      <div class="row">
        <div><b>Visual style</b><span>{STYLES[settings.visualStyle].description} Same game, different look.</span></div>
        <Segmented
          label="Visual style"
          bind:value={settings.visualStyle}
          options={VISUAL_STYLES.map((id) => ({ value: id, label: STYLES[id].label }))}
        />
      </div>
      <div class="row">
        <div><b>Quality preset</b><span>Shadow detail, anti-aliasing and effects. Applies on next load.</span></div>
        <Segmented
          label="Quality preset"
          bind:value={preset}
          options={[
            { value: 'low', label: 'Low' },
            { value: 'medium', label: 'Medium' },
            { value: 'high', label: 'High' },
            { value: 'ultra', label: 'Ultra' },
          ]}
        />
      </div>
      <div class="row">
        <div><b>Graphics API</b><span>WebGPU is faster; WebGL2 is the compatibility fallback. Applies on next load.</span></div>
        <Segmented
          label="Graphics API"
          bind:value={settings.renderer}
          options={[
            { value: 'auto', label: 'Auto' },
            { value: 'webgl', label: 'WebGL2' },
          ]}
        />
      </div>
      <label class="row">
        <div><b>Resolution scale · {Math.round(settings.resolutionScale * 100)}%</b><span>Lower for more frames per second.</span></div>
        <input class="slider" type="range" min="0.5" max="1" step="0.05" bind:value={settings.resolutionScale} />
      </label>
      <div class="row">
        <div><b>Bloom</b><span>Soft glow on bright surfaces.</span></div>
        <Toggle label="Bloom" bind:checked={settings.bloom} />
      </div>
      <div class="row">
        <div><b>Tilt-shift</b><span>Miniature-style depth of field.</span></div>
        <Toggle label="Tilt-shift" bind:checked={settings.tiltShift} />
      </div>
      <div class="row">
        <div>
          <b>Ambient occlusion <em>experimental</em></b>
          <span>Contact shadows in corners. Can fail to start on some WebGPU drivers. Applies on next load.</span>
        </div>
        <Toggle label="Ambient occlusion" bind:checked={settings.ambientOcclusion} />
      </div>
    {:else if tab === 'Gameplay'}
      <div class="row">
        <div><b>Free will</b><span>Residents look after their own needs when you don't give orders.</span></div>
        <Toggle label="Free will" bind:checked={settings.autonomy} />
      </div>
      <div class="row">
        <div><b>Autosave</b><span>Saves into a single autosave slot.</span></div>
        <Segmented
          label="Autosave"
          bind:value={settings.autosaveMinutes}
          options={[
            { value: 0, label: 'Off' },
            { value: 2, label: '2 min' },
            { value: 5, label: '5 min' },
            { value: 10, label: '10 min' },
          ]}
        />
      </div>
    {:else if tab === 'Interface'}
      <div class="row">
        <div><b>Interface size</b><span>Scales menus and the HUD.</span></div>
        <Segmented
          label="Interface size"
          bind:value={settings.uiScale}
          options={[
            { value: 0.9, label: 'S' },
            { value: 1, label: 'M' },
            { value: 1.1, label: 'L' },
            { value: 1.25, label: 'XL' },
          ]}
        />
      </div>
      <div class="row">
        <div><b>24-hour clock</b><span>Otherwise AM / PM.</span></div>
        <Toggle label="24-hour clock" bind:checked={settings.clock24h} />
      </div>
      <div class="row">
        <div><b>Performance overlay</b><span>Frame rate, draw calls and backend (F3).</span></div>
        <Toggle label="Performance overlay" bind:checked={settings.showFps} />
      </div>
      <div class="row">
        <div><b>Reduce motion</b><span>Turns off interface animations.</span></div>
        <Toggle label="Reduce motion" bind:checked={settings.reducedMotion} />
      </div>
      <div class="row">
        <div><b>Sound effects</b><span>Little sounds when you buy, build and place things.</span></div>
        <Toggle label="Sound effects" bind:checked={settings.sound} />
      </div>
    {:else}
      <label class="row">
        <div><b>Camera sensitivity · {settings.cameraSensitivity.toFixed(1)}×</b><span>Rotate, pan and zoom speed.</span></div>
        <input class="slider" type="range" min="0.5" max="2" step="0.1" bind:value={settings.cameraSensitivity} />
      </label>
      <dl class="keys">
        {#each keys as [key, action] (key)}
          <dt>{key}</dt>
          <dd>{action}</dd>
        {/each}
      </dl>
    {/if}
  </div>

  <footer>
    <button class="btn ghost" onclick={() => (resetSettings(), (preset = settings.quality))}>Reset to defaults</button>
  </footer>
</div>

<style>
  .settings {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .tabs {
    display: flex;
    gap: 2px;
    padding: 3px;
    border-radius: var(--radius-md);
    background: var(--hairline);
  }
  .tabs button {
    flex: 1;
    height: 34px;
    border-radius: var(--radius-sm);
    font-weight: 600;
    color: var(--text-muted);
  }
  .tabs button.active {
    background: var(--surface);
    color: var(--text);
    box-shadow: var(--shadow-sm);
  }
  .notice {
    margin: 0;
    padding: 10px 14px;
    border-radius: var(--radius-md);
    background: rgba(240, 181, 74, 0.16);
    color: #8a5e0c;
    font-weight: 550;
  }
  .rows {
    display: flex;
    flex-direction: column;
    min-height: 300px;
  }
  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 24px;
    padding: 14px 0;
    border-bottom: 1px solid var(--hairline);
  }
  .row > div {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .row span {
    color: var(--text-muted);
    font-size: 13px;
  }
  em {
    font-style: normal;
    font-size: 11px;
    font-weight: 650;
    color: #b07a14;
    background: rgba(240, 181, 74, 0.18);
    padding: 1px 6px;
    border-radius: var(--radius-pill);
    margin-left: 4px;
  }
  .slider {
    width: 200px;
    flex: none;
  }
  .keys {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 10px 24px;
    margin: 16px 0 0;
  }
  dt {
    font-weight: 600;
  }
  dd {
    margin: 0;
    color: var(--text-muted);
  }
  footer {
    display: flex;
    justify-content: flex-end;
  }
</style>
