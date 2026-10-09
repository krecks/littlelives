<script lang="ts">
  import { applyPreset, resetSettings, RESTART_KEYS, settings, type QualityPreset } from '../../settings/settings.svelte';
  import { STYLES, VISUAL_STYLES } from '../../render/styles';
  import { app } from '../app.svelte';
  import { services } from '../services';
  import { game } from '../state.svelte';
  import { lifespanHint } from '../format';
  import Segmented from '../kit/Segmented.svelte';
  import type { Lifespan } from '../../core/protocol';
  import Toggle from '../kit/Toggle.svelte';
  import { benchVerdict, runBenchmark, synthesize, voiceStatus } from '../../voice/service.svelte';
  import { playClip } from '../../voice/player';
  import { voiceFor } from '../../voice/voices';

  // This game's lifespan (sent to the simulation when picked).
  let lifespan = $state<Lifespan>(game.lifespan);
  $effect(() => {
    if (app.screen === 'game' && lifespan !== game.lifespan) services.controls.setLifespan(lifespan);
  });

  const tabs = ['Graphics', 'Gameplay', 'Watching', 'Interface', 'Audio', 'Controls'] as const;
  let tab = $state<(typeof tabs)[number]>('Graphics');

  // Remember restart-only values when opened during a game, to show a notice if they change.
  const initial = Object.fromEntries(RESTART_KEYS.map((k) => [k, settings[k]]));
  const needsRestart = $derived(app.screen === 'game' && RESTART_KEYS.some((k) => settings[k] !== initial[k]));

  let preset = $state<QualityPreset>(settings.quality);
  $effect(() => {
    if (preset !== settings.quality) applyPreset(preset);
  });

  const modelStatus = $derived(
    voiceStatus.state === 'loading'
      ? `Downloading… ${Math.round(voiceStatus.progress * 100)} %`
      : voiceStatus.state === 'ready'
        ? 'Ready. Runs on the CPU: a model this small doesn\'t need the GPU.'
        : voiceStatus.state === 'error'
          ? `Couldn't load the voice: ${voiceStatus.error}`
          : 'Small and fast (9 MB). One voice, made higher or lower for each resident.',
  );
  const VERDICT = { good: 'Smooth', ok: 'Lines may start a moment late', slow: 'Too slow: voices will lag on this computer' };
  const benchText = $derived.by(() => {
    const b = voiceStatus.bench;
    if (voiceStatus.benchmarking) return 'Testing…';
    if (!b) return 'Measures how fast this computer makes speech while the game keeps drawing.';
    return `${(b.lineMs / 1000).toFixed(1)} s per line · ${(1 / b.rtf).toFixed(1)}× faster than real time · ${VERDICT[benchVerdict(b)]}`;
  });
  let sampleBusy = $state(false);
  let sampleCount = 0;
  async function sample() {
    sampleBusy = true;
    try {
      const male = sampleCount++ % 2 === 1;
      const text = male ? "Hey! I'm one of your residents. Is this what I sound like?" : "Hi! I'm one of your residents. This is how I sound.";
      playClip(await synthesize(text, voiceFor(sampleCount, male ? 'male' : 'female')));
    } finally {
      sampleBusy = false;
    }
  }

  const keys = [
    ['Left-click a resident / Tab', 'Look at a resident'],
    ['Left-click object', 'Interaction menu'],
    ['Left-click floor', 'Walk there (while looking at a resident)'],
    ['Left-drag / right-drag', 'Rotate / pan camera'],
    ['Mouse wheel', 'Zoom'],
    ['Space · 0–5', 'Pause · game speed'],
    ['F · H', 'Follow a resident · whole house'],
    ['J', 'Journal'],
    ['W', 'Walls up / down'],
    ['Esc', 'Close · pause menu'],
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
      {#if app.screen === 'game'}
        <div class="row">
          <div><b>Lifespan</b><span>This game: {lifespanHint(game.lifespan)}</span></div>
          <Segmented
            label="Lifespan"
            bind:value={lifespan}
            options={[
              { value: 'off', label: 'Off' },
              { value: 'short', label: 'Short' },
              { value: 'normal', label: 'Normal' },
              { value: 'long', label: 'Long' },
            ]}
          />
        </div>
      {/if}
      <div class="row">
        <div><b>Free will</b><span>Your residents live their own lives: needs, friends, visits and work. Neighbours always do.</span></div>
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
    {:else if tab === 'Watching'}
      <div class="row">
        <div><b>Back to watching</b><span>In Watch mode (next to Live in the top bar) the camera follows what happens at home. Any click, key or scroll takes it back; after this long without input it watches again. Off: only when you pick Watch.</span></div>
        <Segmented
          label="Back to watching"
          bind:value={settings.directorDelay}
          options={[
            { value: 0, label: 'Off' },
            { value: 20, label: '20 s' },
            { value: 45, label: '45 s' },
            { value: 90, label: '90 s' },
          ]}
        />
      </div>
      <div class="row">
        <div><b>Camera pace</b><span>Calm lingers on each moment; lively moves on sooner.</span></div>
        <Segmented
          label="Camera pace"
          bind:value={settings.directorPace}
          options={[
            { value: 'calm', label: 'Calm' },
            { value: 'lively', label: 'Lively' },
          ]}
        />
      </div>
      <div class="row">
        <div><b>Quiet interface</b><span>The interface fades while the camera watches; move the mouse to see it.</span></div>
        <Toggle label="Quiet interface" bind:checked={settings.hideHudWhileWatching} />
      </div>
      <div class="row">
        <div><b>Slow down for big moments</b><span>A first kiss, a new job or a fight at home plays at normal speed.</span></div>
        <Toggle label="Slow down for big moments" bind:checked={settings.autoSlow} />
      </div>
      <div class="row">
        <div><b>Skip quiet hours</b><span>Time-lapse while everyone at home sleeps or is at work.</span></div>
        <Toggle label="Skip quiet hours" bind:checked={settings.skipQuietHours} />
      </div>
      <div class="row">
        <div>
          <b>Clicking residents</b>
          <span>Look first: a click opens their panel and orders come from there. Give orders: clicks command the selected resident straight away.</span>
        </div>
        <Segmented
          label="Clicking residents"
          bind:value={settings.directControl}
          options={[
            { value: 'inspect', label: 'Look first' },
            { value: 'always', label: 'Give orders' },
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
    {:else if tab === 'Audio'}
      <div class="row">
        <div><b>Sound effects</b><span>Little sounds when you buy, build and place things.</span></div>
        <Toggle label="Sound effects" bind:checked={settings.sound} />
      </div>
      <div class="row">
        <div>
          <b>Resident voices <em>experimental</em></b>
          <span>The resident you're looking at, and conversations you start, are spoken out loud. Runs on this computer; downloads about 29 MB once.</span>
        </div>
        <Toggle label="Resident voices" bind:checked={settings.voices} />
      </div>
      <div class="row">
        <div><b>Language</b><span>More languages, and Babble (a made-up language), come later.</span></div>
        <Segmented label="Language" bind:value={settings.voiceLanguage} options={[{ value: 'en', label: 'English' }]} />
      </div>
      <div class="row">
        <div><b>Voice model</b><span>{modelStatus}</span></div>
        <Segmented label="Voice model" bind:value={settings.voiceModel} options={[{ value: 'paradee-8m', label: 'Paradee-8M' }]} />
      </div>
      <label class="row">
        <div><b>Voice volume · {Math.round(settings.voiceVolume * 100)}%</b><span>Separate from sound effects.</span></div>
        <input class="slider" type="range" min="0" max="1" step="0.05" bind:value={settings.voiceVolume} />
      </label>
      <div class="row">
        <div><b>Speed test</b><span>{benchText}</span></div>
        <div class="buttons">
          <button class="btn ghost" disabled={!settings.voices || sampleBusy} onclick={sample}>Hear a sample</button>
          <button class="btn ghost" disabled={!settings.voices || voiceStatus.benchmarking} onclick={() => void runBenchmark().catch(() => {})}>
            Test this computer
          </button>
        </div>
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
  .row > .buttons {
    flex-direction: row;
    gap: 8px;
    flex: none;
  }
</style>
