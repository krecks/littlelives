<script lang="ts">
  import CareerTab from './CareerTab.svelte';
  import SkillsTab from './SkillsTab.svelte';
  import Icon from './Icon.svelte';
  import { gradeLetter, moodLabel, needColor } from './format';
  import SimPreview from './kit/SimPreview.svelte';
  import { chemistryLabel, friendLabel, kinLabel, romanceLabel } from './relationship';
  import { services } from './services';
  import TodayTimeline from './planner/TodayTimeline.svelte';
  import { goalText } from './story';
  import { game } from './state.svelte';

  const allTabs = ['Now', 'People', 'Feelings', 'Career', 'Skills'] as const;
  let tab = $state<(typeof allTabs)[number]>('Now');

  /** The resident being looked at; orders only for the player's household. */
  const info = (id: number) => game.roster.find((r) => r.id === id);
  const sim = $derived(game.inspectedSim);
  const mine = $derived(!!sim && !!game.households[sim.household]?.player);
  // Careers are for grown-ups of the player's household.
  const grownUp = $derived(!sim || services.content.isAdult(sim.age ?? 30));
  /** Babies don't plan or choose: they're cared for at the crib. */
  const baby = $derived(!!sim && !!services.content.lifeStages.find((s) => s.id === sim.stage)?.baby);
  const tabs = $derived(mine && grownUp ? allTabs : allTabs.filter((t) => t !== 'Career'));
  const homeName = $derived(sim ? game.households[sim.household]?.name : undefined);
  const emotion = $derived(services.content.emotion(sim?.emotion ?? null));
  // By id: the list is rebuilt when relationships change, not with every change to the resident.
  const simId = $derived(sim?.id ?? null);
  const people = $derived(
    simId !== null
      ? game.relationships
          .filter((r) => r.a === simId)
          .map((r) => ({ rel: r, back: game.relationships.find((x) => x.a === r.b && x.b === r.a), who: info(r.b) }))
          .sort((x, y) => Math.abs(y.rel.friendship) + y.rel.romance - (Math.abs(x.rel.friendship) + x.rel.romance))
      : [],
  );
  const hours = (m: number) => (m >= 60 ? `${Math.round(m / 60)} h` : `${Math.max(1, Math.round(m))} min`);
</script>

{#snippet face(id: number, size: number)}
  {@const who = info(id)}
  {#if who}<SimPreview appearance={who.appearance} gender={who.gender} id={who.id} {size} />{/if}
{/snippet}

<section class="panel">
  {#if sim}
    <div class="card glass">
      <div class="who">
        <div class="portrait">{@render face(sim.id, 46)}</div>
        <div class="ident">
          <div class="name">{sim.name}{#if !mine && homeName}<span class="family"> · the {homeName}s</span>{/if}</div>
          {#if sim.age !== undefined && sim.stage}
            <div class="age">
              {services.content.lifeStages.find((s) => s.id === sim.stage)?.label ?? ''} · {sim.age}{#if sim.grade !== undefined}{' · school: '}<b title="{Math.round(sim.grade)} of 100">{gradeLetter(sim.grade)}</b>{/if}
            </div>
          {/if}
          <div class="mood">
            <span class="dot" style="background:{needColor(sim.mood)}"></span>
            {moodLabel(sim.mood)}
            {#if emotion}
              <span class="emotion"><Icon name={emotion.icon} size={13} />{emotion.label}</span>
            {/if}
          </div>
        </div>
        <div class="actions">
          <button
            class="icon-btn"
            class:on={game.follow === sim.id}
            title={game.follow === sim.id ? 'Stop following (F)' : `Follow ${sim.name} (F)`}
            aria-label="Follow"
            aria-pressed={game.follow === sim.id}
            onclick={() => services.controls.follow(game.follow === sim.id ? null : sim.id)}
          >
            <Icon name="icon.ui.follow" size={16} />
          </button>
          <button class="icon-btn" title="Close (Esc)" aria-label="Close" onclick={() => services.controls.inspect(null)}>
            <Icon name="icon.ui.close" size={14} />
          </button>
        </div>
      </div>

      {#if sim.traits.length || sim.perks.length}
        <div class="tags">
          {#each sim.traits as t (t)}
            <span class="tag" title={services.content.trait(t)?.description}>
              <Icon name={services.content.trait(t)?.icon ?? ''} size={12} />{services.content.trait(t)?.label ?? t}
            </span>
          {/each}
          {#each sim.perks as p (p)}
            <span class="tag perk" title={services.content.perk(p)?.description}>
              <Icon name={services.content.perk(p)?.icon ?? ''} size={12} />{services.content.perk(p)?.label ?? p}
            </span>
          {/each}
        </div>
      {/if}

      <div class="tabs" role="tablist">
        {#each tabs as t (t)}
          <button role="tab" aria-selected={tab === t} class:active={tab === t} onclick={() => (tab = t)}>
            {t}{#if t === 'Feelings' && sim.feelings.length}<span class="count">{sim.feelings.length}</span>{/if}
          </button>
        {/each}
      </div>

      {#if tab === 'Now'}
        {#if mine && !baby}
          <div class="plan">
            <TodayTimeline {sim} height={14} labels />
            <button class="btn small" onclick={() => services.controls.openPlanner(sim.id)}><Icon name="icon.ui.calendar" size={13} />Plan</button>
          </div>
          {#if sim.plan?.goals.length}
            <ul class="mini-goals">
              {#each sim.plan.goals as g, i (i)}
                <li title="{Math.round(g.progress * 100)}%"><span>{goalText(g.def, g.target, g.skill, g.category)}</span><span class="bar"><span style="width:{g.progress * 100}%"></span></span></li>
              {/each}
            </ul>
          {/if}
        {/if}
        <ol class="queue">
          {#each sim.actions as action, i (i)}
            <li class:active={action.active} class:auto={!action.directed}>
              <span class="label">
                {action.label}{#if action.target !== null}<span class="with"> · {info(action.target)?.name}</span>{/if}
              </span>
              {#if action.active}
                <span class="progress"><span style="width:{action.progress * 100}%"></span></span>
              {/if}
              {#if mine}
                <button class="cancel" aria-label="Cancel {action.label}" onclick={() => services.controls.cancelAction(i)}>
                  <Icon name="icon.ui.close" size={12} />
                </button>
              {/if}
            </li>
          {:else}
            <li class="idle">{sim.awayUntil !== null ? (grownUp ? 'At work' : 'At school') : 'Deciding what to do next'}</li>
          {/each}
        </ol>
        {#if baby}
          <p class="hint">A baby: the grown-ups at home feed, change and play with them at the crib. A crying baby needs someone.</p>
        {:else if mine}
          <p class="hint">They choose for themselves. To step in, click a person to talk to, an object to use, or the floor to walk.</p>
        {/if}
      {:else if tab === 'People'}
        <ul class="people">
          {#each people as p (p.rel.b)}
            {@const romance = romanceLabel(p.rel)}
            {@const family = kinLabel(p.rel.kin, p.who?.gender)}
            <li>
              <span class="mini">{@render face(p.rel.b, 30)}</span>
              <div class="person">
                <span class="row">
                  <b>{p.who?.name}</b>
                  <span class="status">{family ? `${family} · ` : ''}{friendLabel(p.rel.friendship, p.back?.friendship ?? 0)}{romance ? ` · ${romance}` : ''}</span>
                </span>
                <span class="track"><span class="mid"></span><span class="fill" class:neg={p.rel.friendship < 0} style="--v:{p.rel.friendship}"></span></span>
                {#if p.rel.romance > 0}
                  <span class="track"><span class="fill love" style="--v:{p.rel.romance}"></span></span>
                {/if}
                <span class="chem">{chemistryLabel(p.rel.chemistry)}</span>
              </div>
            </li>
          {:else}
            <li class="idle">{sim.name} hasn't met anyone yet.</li>
          {/each}
        </ul>
      {:else if tab === 'Career'}
        <CareerTab {sim} />
      {:else if tab === 'Skills'}
        <SkillsTab {sim} />
      {:else}
        <ul class="feelings">
          {#each sim.feelings as m (m.id)}
            <li class:good={m.mood > 0} class:bad={m.mood < 0}>
              <span class="mood-delta">{m.mood > 0 ? '+' : ''}{Math.round(m.mood * 100)}</span>
              <span class="label">{m.label}</span>
              <span class="left">{hours(m.minutesLeft)}</span>
            </li>
          {:else}
            <li class="idle">No strong feelings right now.</li>
          {/each}
        </ul>
      {/if}
    </div>
  {/if}
</section>

<style>
  .age {
    font-size: 11.5px;
    color: var(--text-muted);
  }
  .panel {
    position: absolute;
    left: var(--edge);
    /* Above the household strip. */
    bottom: calc(var(--edge) + 88px);
    display: flex;
    flex-direction: column;
    gap: 10px;
    width: 320px;
    pointer-events: none;
  }
  .card {
    pointer-events: auto;
    animation: rise var(--slow) var(--ease);
  }
  @keyframes rise {
    from {
      opacity: 0;
      transform: translateY(8px);
    }
  }
  .ident {
    flex: 1;
    min-width: 0;
  }
  .family {
    font-weight: 500;
    color: var(--text-muted);
  }
  .actions {
    display: flex;
    gap: 4px;
    align-self: flex-start;
  }
  .icon-btn {
    display: grid;
    place-items: center;
    width: 30px;
    height: 30px;
    border-radius: var(--radius-sm);
    color: var(--text-muted);
    transition: background var(--fast) var(--ease), color var(--fast) var(--ease);
  }
  .icon-btn:hover,
  .icon-btn.on {
    background: var(--accent-soft);
    color: var(--accent);
  }
  .plan {
    display: grid;
    grid-template-columns: 1fr auto;
    align-items: center;
    gap: 8px;
  }
  .mini-goals {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 11.5px;
  }
  .mini-goals li {
    display: grid;
    grid-template-columns: 1fr 60px;
    align-items: center;
    gap: 8px;
  }
  .mini-goals .bar {
    height: 4px;
    border-radius: 99px;
    background: var(--hairline);
    overflow: hidden;
  }
  .mini-goals .bar span {
    display: block;
    height: 100%;
    background: var(--good);
  }
  .hint {
    margin: 0;
    font-size: 11.5px;
    color: var(--text-muted);
  }
  .portrait,
  .mini {
    display: grid;
    place-items: start start;
    border-radius: 50%;
    overflow: hidden;
    background: var(--surface-muted);
  }
  .card {
    padding: 14px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .who {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .portrait {
    width: 46px;
    height: 46px;
    flex: none;
  }
  .name {
    font-size: 17px;
    font-weight: 650;
    letter-spacing: -0.01em;
  }
  .mood {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--text-muted);
    font-weight: 500;
  }
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
  }
  .emotion {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    margin-left: 4px;
    padding: 2px 8px;
    border-radius: var(--radius-pill);
    background: var(--hairline);
    font-size: 12px;
    color: var(--text);
  }
  .tags {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .tag {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 3px 8px;
    border-radius: var(--radius-pill);
    background: var(--accent-soft);
    color: var(--accent);
    font-size: 11px;
    font-weight: 600;
  }
  .tag.perk {
    background: rgba(240, 181, 74, 0.18);
    color: #b07a14;
  }
  .tabs {
    display: flex;
    gap: 2px;
    padding: 3px;
    border-radius: var(--radius-md);
    background: var(--hairline);
  }
  .tabs button {
    flex: 1 1 auto;
    min-width: 0;
    height: 28px;
    padding: 0 4px;
    border-radius: var(--radius-sm);
    font-weight: 600;
    font-size: 11.5px;
    letter-spacing: -0.01em;
    white-space: nowrap;
    color: var(--text-muted);
  }
  .tabs button.active {
    background: var(--surface);
    color: var(--text);
    box-shadow: var(--shadow-sm);
  }
  .count {
    margin-left: 3px;
    padding: 0 5px;
    border-radius: var(--radius-pill);
    background: var(--accent);
    color: var(--text-inverse);
    font-size: 10px;
  }
  .queue,
  .people,
  .feelings {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
    max-height: 210px;
    overflow: auto;
  }
  .queue li {
    position: relative;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 10px;
    border-radius: var(--radius-sm);
    background: var(--hairline);
    overflow: hidden;
  }
  .queue li.active {
    background: var(--accent-soft);
  }
  .queue li.auto .label {
    font-style: italic;
  }
  .label {
    flex: 1;
    font-weight: 550;
  }
  .with {
    color: var(--text-muted);
    font-weight: 500;
  }
  .progress {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    height: 3px;
  }
  .progress span {
    display: block;
    height: 100%;
    background: var(--accent);
    transition: width var(--slow) linear;
  }
  .cancel {
    display: grid;
    place-items: center;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    color: var(--text-muted);
  }
  .cancel:hover {
    background: rgba(236, 106, 92, 0.15);
    color: var(--bad);
  }
  .idle {
    color: var(--text-muted);
    background: transparent !important;
    padding: 4px 2px !important;
  }
  .people li {
    display: flex;
    gap: 10px;
    align-items: flex-start;
  }
  .mini {
    width: 30px;
    height: 30px;
    flex: none;
  }
  .person {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .row {
    display: flex;
    justify-content: space-between;
    gap: 8px;
    font-size: 13px;
  }
  .status,
  .chem {
    color: var(--text-muted);
    font-size: 11px;
  }
  .track {
    position: relative;
    height: 5px;
    border-radius: var(--radius-pill);
    background: var(--hairline);
    overflow: hidden;
  }
  .mid {
    position: absolute;
    left: 50%;
    top: 0;
    bottom: 0;
    width: 1px;
    background: rgba(29, 34, 48, 0.25);
  }
  .fill {
    position: absolute;
    top: 0;
    bottom: 0;
    left: 50%;
    width: calc(max(var(--v), 0) * 0.5%);
    background: var(--good);
  }
  .fill.neg {
    left: calc(50% + var(--v) * 0.5%);
    width: calc(var(--v) * -0.5%);
    background: var(--bad);
  }
  .fill.love {
    left: 0;
    width: calc(max(var(--v), 0) * 1%);
    background: #e0607e;
  }
  .feelings li {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 7px 10px;
    border-radius: var(--radius-sm);
    background: var(--hairline);
  }
  .mood-delta {
    min-width: 30px;
    font-weight: 700;
    font-size: 12px;
  }
  .good .mood-delta {
    color: var(--good);
  }
  .bad .mood-delta {
    color: var(--bad);
  }
  .left {
    color: var(--text-muted);
    font-size: 11px;
  }
</style>
