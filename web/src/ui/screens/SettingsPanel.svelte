<script lang="ts">
  import { resetSettings, RESTART_KEYS, settings } from '../../settings/settings.svelte';
  import { app } from '../app.svelte';
  import { services } from '../services';
  import { game } from '../state.svelte';
  import { lifespanHint } from '../format';
  import Icon from '../Icon.svelte';
  import Segmented from '../kit/Segmented.svelte';
  import Toggle from '../kit/Toggle.svelte';
  import SettingRow from './SettingRow.svelte';
  import type { Lifespan } from '../../core/protocol';
  import { benchVerdict, DOWNLOAD_MB, runBenchmark, speak, voiceStatus } from '../../voice/service.svelte';
  import { playClip } from '../../voice/player';
  import { voiceFor } from '../../voice/voices';

  // This game's lifespan (sent to the simulation when picked).
  let lifespan = $state<Lifespan>(game.lifespan);
  let playerMoves = $state(game.playerMoves);
  $effect(() => {
    if (app.screen === 'game' && lifespan !== game.lifespan) services.controls.setLifespan(lifespan);
  });
  $effect(() => {
    if (app.screen === 'game' && playerMoves !== game.playerMoves) services.controls.setPlayerMoves(playerMoves);
  });

  const pages = [
    { id: 'performance', label: 'Performance', icon: 'icon.ui.perf' },
    { id: 'gameplay', label: 'Gameplay', icon: 'icon.ui.live' },
    { id: 'camera', label: 'Camera & time', icon: 'icon.ui.watch' },
    { id: 'interface', label: 'Interface', icon: 'icon.ui.settings' },
    { id: 'audio', label: 'Audio', icon: 'icon.career.music' },
    { id: 'controls', label: 'Controls', icon: 'icon.ui.move' },
  ] as const;
  let page = $state<(typeof pages)[number]['id']>('performance');

  // Remember restart-only values when opened during a game, to show a notice if they change.
  const initial = Object.fromEntries(RESTART_KEYS.map((k) => [k, settings[k]]));
  const needsRestart = $derived(app.screen === 'game' && RESTART_KEYS.some((k) => settings[k] !== initial[k]));
  /** Badge for settings that apply the next time a game starts. */
  const NEXT_LOAD = 'Next load';


  const modelStatus = $derived.by(() => {
    if (voiceStatus.state === 'loading') return `Downloading… ${Math.round(voiceStatus.progress * 100)} %`;
    if (voiceStatus.state === 'error') return `Couldn't load the voice: ${voiceStatus.error}`;
    return (
      'KittenTTS nano: eight voices mixed for each resident, raised and made smaller for children. ' +
      `Runs on the CPU; about ${Math.round(DOWNLOAD_MB)} MB, downloaded once.`
    );
  });
  const VERDICT = { good: 'smooth', ok: 'lines may start a moment late', slow: 'too slow here: voices may pause' };
  const benchText = $derived.by(() => {
    if (voiceStatus.benchmarking) return 'Testing…';
    const b = voiceStatus.bench;
    if (!b) return 'How fast this computer makes speech while the game keeps drawing.';
    return `${(b.lineMs / 1000).toFixed(1)} s per line, ${(1 / b.rtf).toFixed(1)}× real time, ${VERDICT[benchVerdict(b)]}`;
  });
  let sampleBusy = $state(false);
  let sampleCount = 0;
  async function sample() {
    sampleBusy = true;
    try {
      const male = sampleCount++ % 2 === 1;
      const text = male ? "Hey! I'm one of your residents. Is this what I sound like?" : "Hi! I'm one of your residents. This is how I sound.";
      const voice = voiceFor(sampleCount, male ? 'male' : 'female');
      playClip(await speak(text, voice));
    } finally {
      sampleBusy = false;
    }
  }

  const percent = (v: number) => `${Math.round(v * 100)}%`;

  /** Shortcuts by area: keys (each a keycap), and what they do. */
  const shortcuts: { title: string; keys: [string[], string][] }[] = [
    {
      title: 'Time',
      keys: [
        [['Space'], 'Pause / resume'],
        [['1', '–', '5'], 'Game speed'],
        [['0'], 'Pause'],
      ],
    },
    {
      title: 'Residents',
      keys: [
        [['Click'], 'Look at a resident, use an object, walk somewhere'],
        [['Tab'], 'Next resident'],
        [['F'], 'Follow the resident'],
      ],
    },
    {
      title: 'Camera',
      keys: [
        [['Drag'], 'Rotate (left) / pan (right)'],
        [['Wheel'], 'Zoom'],
        [['H'], 'Whole house'],
        [['W'], 'Walls up / cutaway / down'],
      ],
    },
    {
      title: 'Modes and panels',
      keys: [
        [['L'], 'Live / Watch'],
        [['V'], 'Buy mode'],
        [['B'], 'Build mode'],
        [['P'], 'Planner'],
        [['J'], 'Journal'],
        [['O'], 'Our home (room scores in Build)'],
        [['M'], 'Town map'],
        [['Esc'], 'Close / step back / pause menu'],
      ],
    },
    {
      title: 'Buy and Build',
      keys: [
        [['R'], 'Rotate (Shift: the other way)'],
        [['E'], 'Eyedropper'],
        [['Del'], 'Sell'],
        [['Ctrl', 'Z'], 'Undo'],
        [['Ctrl', 'Y'], 'Redo'],
      ],
    },
    {
      title: 'Other',
      keys: [
        [['F3'], 'Performance overlay'],
        [['F8'], 'Save a debug report'],
      ],
    },
  ];
</script>

<div class="settings">
  <nav aria-label="Settings">
    <ul role="tablist" aria-orientation="vertical">
      {#each pages as p (p.id)}
        <li>
          <button role="tab" aria-selected={page === p.id} class:active={page === p.id} onclick={() => (page = p.id)}>
            <Icon name={p.icon} size={16} />
            {p.label}
          </button>
        </li>
      {/each}
    </ul>
    <button class="reset" onclick={resetSettings}>Reset to defaults</button>
  </nav>

  <div class="page" role="tabpanel">
    {#if needsRestart}
      <p class="notice">Some changes apply the next time you start or load a game.</p>
    {/if}

    {#if page === 'performance'}
      <p class="intro">Each of these trades looks for speed. If the game stutters, lower the resolution first: it saves the most.</p>
      <section>
        <h3>Image</h3>
        <SettingRow title="Resolution" hint="How many pixels the game draws. Lower is softer but much faster.">
          <input class="slider" type="range" min="0.5" max="1" step="0.05" aria-label="Resolution scale" bind:value={settings.resolutionScale} />
          <output>{percent(settings.resolutionScale)}</output>
        </SettingRow>
        <SettingRow title="Smooth edges" hint="Anti-aliasing: 4× multisampling removes jagged edges. Off uses a cheaper filter that blurs them a little." badges={[NEXT_LOAD]}>
          <Toggle label="Smooth edges" bind:checked={settings.antiAliasing} />
        </SettingRow>
      </section>
      <section>
        <h3>Light and shadow</h3>
        <SettingRow title="Shadow detail" hint="How crisp shadows are. Each step up uses four times the graphics memory." badges={[NEXT_LOAD]}>
          <Segmented
            label="Shadow detail"
            bind:value={settings.shadowDetail}
            options={[
              { value: 1024, label: 'Low' },
              { value: 2048, label: 'Medium' },
              { value: 4096, label: 'High' },
            ]}
          />
        </SettingRow>
        <SettingRow title="Every lamp lights" hint="On: up to 32 lamps light their rooms. Off: only the four nearest the biggest rooms. Costs little on WebGPU, more on WebGL2." badges={[NEXT_LOAD]}>
          <Toggle label="Every lamp lights" bind:checked={settings.allLamps} />
        </SettingRow>
        <SettingRow title="Ambient occlusion" hint="Soft contact shadows in corners and under furniture. Costly, and may fail to start on some WebGPU drivers." badges={['Experimental', NEXT_LOAD]}>
          <Toggle label="Ambient occlusion" bind:checked={settings.ambientOcclusion} />
        </SettingRow>
      </section>
      <section>
        <h3>Engine</h3>
        <SettingRow title="Graphics API" hint="WebGPU is faster; WebGL2 is the fallback if the game won't draw." badges={[NEXT_LOAD]}>
          <Segmented
            label="Graphics API"
            bind:value={settings.renderer}
            options={[
              { value: 'auto', label: 'Auto' },
              { value: 'webgl', label: 'WebGL2' },
            ]}
          />
        </SettingRow>
      </section>
    {:else if page === 'gameplay'}
      {#if app.screen === 'game'}
        <section>
          <h3>This game</h3>
          <SettingRow title="Lifespan" hint={lifespanHint(game.lifespan)}>
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
          </SettingRow>
          <SettingRow title="Moving" hint="Your residents move in with partners and out of the family home on their own.">
            <Toggle label="Moving" bind:checked={playerMoves} />
          </SettingRow>
        </section>
      {/if}
      <section>
        <h3>Residents</h3>
        <SettingRow title="Free will" hint="Your residents look after their needs, friends and work by themselves. Neighbours always do.">
          <Toggle label="Free will" bind:checked={settings.autonomy} />
        </SettingRow>
      </section>
      <section>
        <h3>Saving</h3>
        <SettingRow title="Autosave" hint="Into a single autosave slot.">
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
        </SettingRow>
      </section>
    {:else if page === 'camera'}
      <section>
        <h3>Watching</h3>
        <SettingRow title="Back to watching" hint="Watch mode lets the camera follow what happens at home. Any input takes it back; after this long it watches again.">
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
        </SettingRow>
        <SettingRow title="Camera pace" hint="Calm lingers on each moment; lively moves on sooner.">
          <Segmented
            label="Camera pace"
            bind:value={settings.directorPace}
            options={[
              { value: 'calm', label: 'Calm' },
              { value: 'lively', label: 'Lively' },
            ]}
          />
        </SettingRow>
        <SettingRow title="Quiet interface" hint="The interface fades while the camera watches; move the mouse to bring it back.">
          <Toggle label="Quiet interface" bind:checked={settings.hideHudWhileWatching} />
        </SettingRow>
      </section>
      <section>
        <h3>Time</h3>
        <SettingRow title="Slow down for big moments" hint="A first kiss, a new job or a fight at home plays at normal speed.">
          <Toggle label="Slow down for big moments" bind:checked={settings.autoSlow} />
        </SettingRow>
        <SettingRow title="Skip quiet hours" hint="Time-lapse while everyone at home sleeps or is at work.">
          <Toggle label="Skip quiet hours" bind:checked={settings.skipQuietHours} />
        </SettingRow>
      </section>
    {:else if page === 'interface'}
      <section>
        <h3>Display</h3>
        <SettingRow title="Interface size" hint="Scales menus and the HUD.">
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
        </SettingRow>
        <SettingRow title="24-hour clock" hint="Otherwise AM / PM.">
          <Toggle label="24-hour clock" bind:checked={settings.clock24h} />
        </SettingRow>
        <SettingRow title="Reduce motion" hint="Turns off interface animations.">
          <Toggle label="Reduce motion" bind:checked={settings.reducedMotion} />
        </SettingRow>
      </section>
      <section>
        <h3>Diagnostics</h3>
        <SettingRow title="Performance overlay" hint="Frame rate, draw calls and graphics backend (F3).">
          <Toggle label="Performance overlay" bind:checked={settings.showFps} />
        </SettingRow>
      </section>
    {:else if page === 'audio'}
      <section>
        <h3>Sound</h3>
        <SettingRow title="Sound effects" hint="Little sounds when you buy, build and place things.">
          <Toggle label="Sound effects" bind:checked={settings.sound} />
        </SettingRow>
        <SettingRow title="Sounds of the world" hint="Birds by day, crickets at night, a pan sizzling, running water, the TV.">
          <Toggle label="Sounds of the world" bind:checked={settings.worldSound} />
        </SettingRow>
        <SettingRow title="World volume" disabled={!settings.worldSound}>
          <input class="slider" type="range" min="0" max="1" step="0.05" aria-label="World volume" bind:value={settings.worldVolume} disabled={!settings.worldSound} />
          <output>{percent(settings.worldVolume)}</output>
        </SettingRow>
      </section>
      <section>
        <h3>Voices</h3>
        <SettingRow
          title="Resident voices"
          hint="The resident you're looking at, and conversations you start, are spoken out loud in English. Runs on this computer; the voices download about {Math.round(DOWNLOAD_MB)} MB once."
          badges={['Experimental']}
        >
          <Toggle label="Resident voices" bind:checked={settings.voices} />
        </SettingRow>
        {#if settings.voices}
          <SettingRow title="Voice model" hint={modelStatus}>
            <output>{voiceStatus.state === 'ready' ? 'Ready' : voiceStatus.state === 'loading' ? 'Loading' : voiceStatus.state === 'error' ? 'Failed' : 'Not loaded'}</output>
          </SettingRow>
          <SettingRow title="Voice volume">
            <input class="slider" type="range" min="0" max="1" step="0.05" aria-label="Voice volume" bind:value={settings.voiceVolume} />
            <output>{percent(settings.voiceVolume)}</output>
          </SettingRow>
          <SettingRow title="Try it" hint={benchText}>
            <button class="btn ghost" disabled={sampleBusy} onclick={sample}>Hear a sample</button>
            <button class="btn ghost" disabled={voiceStatus.benchmarking} onclick={() => void runBenchmark().catch(() => {})}>Speed test</button>
          </SettingRow>
        {/if}
      </section>
    {:else}
      <section>
        <h3>Mouse</h3>
        <SettingRow title="Clicking residents" hint="Look first: a click opens their panel. Give orders: clicks command the selected resident straight away.">
          <Segmented
            label="Clicking residents"
            bind:value={settings.directControl}
            options={[
              { value: 'inspect', label: 'Look first' },
              { value: 'always', label: 'Give orders' },
            ]}
          />
        </SettingRow>
        <SettingRow title="Camera sensitivity" hint="Rotate, pan and zoom speed.">
          <input class="slider" type="range" min="0.5" max="2" step="0.1" aria-label="Camera sensitivity" bind:value={settings.cameraSensitivity} />
          <output>{settings.cameraSensitivity.toFixed(1)}×</output>
        </SettingRow>
      </section>
      <section>
        <h3>Keyboard</h3>
        <div class="shortcuts">
          {#each shortcuts as group (group.title)}
            <div class="group">
              <h4>{group.title}</h4>
              <dl>
                {#each group.keys as [keys, action] (action)}
                  <dt>{#each keys as k, i (i)}{#if k === '–'}<span class="to">–</span>{:else}<kbd>{k}</kbd>{/if}{/each}</dt>
                  <dd>{action}</dd>
                {/each}
              </dl>
            </div>
          {/each}
        </div>
      </section>
    {/if}
  </div>
</div>

<style>
  .settings {
    display: grid;
    grid-template-columns: 180px 1fr;
    gap: 24px;
    height: min(560px, calc(100vh / var(--ui-scale) - 140px));
  }
  nav {
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    gap: 12px;
  }
  nav ul {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  nav li button {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    height: 38px;
    padding: 0 12px;
    border-radius: var(--radius-sm);
    font-weight: 600;
    color: var(--text-muted);
    text-align: left;
  }
  nav li button:hover {
    background: var(--hairline);
    color: var(--text);
  }
  nav li button.active {
    background: var(--surface);
    color: var(--accent);
    box-shadow: var(--shadow-sm);
  }
  .reset {
    height: 34px;
    padding: 0 12px;
    border-radius: var(--radius-sm);
    font-size: 12.5px;
    font-weight: 600;
    color: var(--text-muted);
    text-align: left;
  }
  .reset:hover {
    background: var(--hairline);
    color: var(--bad);
  }
  .page {
    display: flex;
    flex-direction: column;
    gap: 18px;
    min-width: 0;
    overflow-y: auto;
    padding-right: 4px;
  }
  section {
    padding: 4px 16px;
    border-radius: var(--radius-md);
    background: var(--surface);
    box-shadow: var(--shadow-sm);
  }
  h3 {
    margin: 12px 0 2px;
    font-size: 11px;
    font-weight: 650;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-muted);
  }
  .intro {
    margin: 0;
    color: var(--text-muted);
    font-size: 13px;
  }
  .notice {
    margin: 0;
    padding: 10px 14px;
    border-radius: var(--radius-md);
    background: rgba(240, 181, 74, 0.16);
    color: #8a5e0c;
    font-weight: 550;
    font-size: 13px;
  }
  .slider {
    width: 170px;
  }
  output {
    min-width: 40px;
    text-align: right;
    font-variant-numeric: tabular-nums;
    font-weight: 600;
    font-size: 13px;
  }
  .shortcuts {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 4px 24px;
    padding: 8px 0 14px;
  }
  h4 {
    margin: 8px 0 6px;
    font-size: 12.5px;
    font-weight: 650;
  }
  dl {
    display: grid;
    grid-template-columns: auto 1fr;
    align-items: center;
    gap: 6px 12px;
    margin: 0;
  }
  dt {
    display: flex;
    align-items: center;
    gap: 3px;
  }
  dd {
    margin: 0;
    color: var(--text-muted);
    font-size: 12.5px;
  }
  kbd {
    min-width: 22px;
    height: 22px;
    padding: 0 6px;
    display: inline-grid;
    place-items: center;
    border-radius: 6px;
    background: var(--surface-muted);
    border: 1px solid var(--hairline);
    border-bottom-width: 2px;
    font: inherit;
    font-size: 11.5px;
    font-weight: 650;
  }
  .to {
    color: var(--text-muted);
    font-size: 12px;
  }
</style>
