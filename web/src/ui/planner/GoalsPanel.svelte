<script lang="ts">
  import type { GoalView, SimView } from '../../core/protocol';
  import Icon from '../Icon.svelte';
  import { money } from '../format';
  import { services } from '../services';
  import { game } from '../state.svelte';
  import { goalText } from '../story';
  import { describeHomeWish, type WishInfo } from './homeWishes';
  import { activityLabel, reasonText } from './planner';

  /** A resident's life goals, the ones they'd like to take on, and what they wish for (places, the home). */
  let { sim }: { sim: SimView } = $props();

  const content = services.content;
  const plan = $derived(sim.plan);
  const full = $derived((plan?.goals.length ?? 0) >= content.planner.maxGoals);

  // Adding a goal: the definition, then whatever it needs.
  let def = $state('');
  let skill = $state(content.skills[0]?.id ?? '');
  let category = $state(content.careerCategories[0]?.id ?? '');
  let target = $state(5);
  const picked = $derived(content.goals.find((g) => g.id === def));
  $effect(() => {
    // A sensible default target for the kind of goal picked.
    const kind = picked?.kind;
    if (kind === 'skill') target = Math.min(10, Math.floor(sim.skills[content.skills.findIndex((s) => s.id === skill)] ?? 0) + 2);
    else if (kind === 'friends') target = 3;
    else if (kind === 'funds') target = 5000;
    else if (kind === 'jobLevel') target = Math.min(10, (sim.job?.level ?? 0) + 3);
  });

  function add() {
    if (!picked) return;
    services.controls.addGoal(sim.id, {
      def: picked.id,
      skill: picked.kind === 'skill' ? skill : undefined,
      category: picked.label.includes('{category}') ? category : undefined,
      target: ['skill', 'friends', 'funds', 'jobLevel'].includes(picked.kind) ? target : undefined,
    });
    def = '';
  }

  /** Home wishes; a fix shows only while the thing is still broken (the sim drops it within the hour). */
  const homeWishes = $derived(
    (plan?.homeWishes ?? []).filter((w) => !w.fix || brokenAtHome(w.fix)).map((w) => describeHomeWish(content, w)),
  );
  /** The broken thing a fix wish is about, at home. */
  function brokenAtHome(def: string) {
    const plot = game.households[game.home]?.plot;
    const home = plot == null ? null : game.plots[plot];
    if (!home) return undefined;
    return game.objects.find(
      (o) => o.def === def && (o.wear ?? 0) >= 1 && o.x >= home.x && o.z >= home.z && o.x < home.x + home.w && o.z < home.z + home.d,
    );
  }
  function act(w: WishInfo) {
    const a = w.action;
    if (!a) return;
    if (a.kind === 'catalog') services.controls.openCatalog({ label: `For ${sim.name}: ${a.label}`, defs: a.defs });
    else if (a.kind === 'build') {
      game.plannerOpen = false;
      services.controls.setMode('build');
    } else {
      const o = brokenAtHome(a.def);
      if (o) services.controls.repair(o.id);
    }
  }
  function actLabel(w: WishInfo): string {
    const a = w.action;
    if (!a) return '';
    if (a.kind === 'catalog') return 'Find in catalog';
    if (a.kind === 'build') return 'Build';
    const cost = brokenAtHome(a.def)?.repairCost;
    return game.creative || cost === undefined ? 'Repair' : `Repair · ${money(cost)}`;
  }

  const label = (g: GoalView) => goalText(g.def, g.target, g.skill, g.category);
  const trend = (g: GoalView) => (g.progress >= 1 ? '' : g.trend > 0.01 ? '▲' : g.trend < -0.01 ? '▼' : '–');
  const trendTitle = (g: GoalView) => (g.trend > 0.01 ? 'Getting there' : g.trend < -0.01 ? 'Slipping' : 'No progress lately');

  /** The last week of plans in a line: kept, cut short, skipped, and the most common reason. */
  const week = $derived.by(() => {
    const h = plan?.history ?? [];
    const count = (s: string) => h.filter((b) => b.status === s).length;
    const reasons = new Map<string, number>();
    for (const b of h) if (b.reason && b.status !== 'kept') reasons.set(reasonText(b.reason, sim.name), (reasons.get(reasonText(b.reason, sim.name)) ?? 0) + 1);
    const top = [...reasons].sort((a, b) => b[1] - a[1])[0]?.[0];
    return { kept: count('kept'), cut: count('cut'), missed: count('skipped') + count('noPlace'), top };
  });
</script>

{#if plan}
  <section class="goals">
    {#if week.kept + week.cut + week.missed > 0}
      <div class="week">
        <b>Last 7 days</b>
        <span><i class="ok">✓</i> {week.kept} kept · <i class="half">½</i> {week.cut} cut short · <i class="no">✕</i> {week.missed} missed</span>
        {#if week.top}<span class="muted">Mostly: {week.top}</span>{/if}
        <span class="muted">
          Sticks to plans: {plan.adherence >= 1.15 ? 'very well' : plan.adherence >= 0.9 ? 'fairly well' : plan.adherence >= 0.65 ? 'now and then' : 'hardly'}
        </span>
      </div>
    {/if}

    <h3>Goals</h3>
    <ul>
      {#each plan.goals as g, i (`${g.def}:${g.skill}:${g.target}`)}
        <li class="goal">
          <span class="icon"><Icon name={g.icon || 'icon.ui.calendar'} size={15} /></span>
          <div class="body">
            <span class="label">{label(g)}</span>
            <span class="bar"><span style="width:{g.progress * 100}%"></span></span>
          </div>
          <span class="trend" title={trendTitle(g)}>{trend(g)}</span>
          <button class="x" aria-label="Drop goal {label(g)}" onclick={() => services.controls.removeGoal(sim.id, i)}><Icon name="icon.ui.close" size={11} /></button>
        </li>
      {:else}
        <li class="muted empty">No goals yet. Pick one below, or wait for {sim.name}'s own ideas.</li>
      {/each}
    </ul>

    {#if plan.suggestions.length}
      <h3>Ideas from {sim.name}</h3>
      <ul>
        {#each plan.suggestions as g, i (`${g.def}:${g.skill}:${g.target}`)}
          <li class="goal idea">
            <span class="icon"><Icon name={g.icon || 'icon.ui.calendar'} size={15} /></span>
            <span class="label">{label(g)}</span>
            <button class="btn small" disabled={full} title={full ? 'Three goals at a time' : 'Take it on'} onclick={() => services.controls.acceptSuggestion(sim.id, i)}>Yes</button>
            <button class="x" aria-label="Not now" onclick={() => services.controls.dismissSuggestion(sim.id, i)}><Icon name="icon.ui.close" size={11} /></button>
          </li>
        {/each}
      </ul>
    {/if}

    {#if !full}
      <div class="add">
        <select bind:value={def} aria-label="New goal">
          <option value="">Add a goal…</option>
          {#each content.goals as g (g.id)}<option value={g.id}>{g.label.replace('{skill}', 'a skill').replace('{n}', 'N').replace('{category}', 'a field').replace('$N', 'money')}</option>{/each}
        </select>
        {#if picked}
          <div class="params">
            {#if picked.kind === 'skill'}
              <select bind:value={skill} aria-label="Skill">{#each content.skills as s (s.id)}<option value={s.id}>{s.label}</option>{/each}</select>
            {/if}
            {#if picked.label.includes('{category}')}
              <select bind:value={category} aria-label="Field">{#each content.careerCategories as c (c.id)}<option value={c.id}>{c.label}</option>{/each}</select>
            {/if}
            {#if ['skill', 'friends', 'funds', 'jobLevel'].includes(picked.kind)}
              <input type="number" min="1" step={picked.kind === 'funds' ? 500 : 1} bind:value={target} aria-label="Target" />
            {/if}
            <button class="btn small primary" onclick={add}>Add</button>
          </div>
        {/if}
      </div>
    {/if}

    {#if plan.wishes.length || homeWishes.length}
      <h3>Wishes</h3>
      <ul>
        {#each homeWishes as w (w.key)}
          <li class="wish">
            <span class="icon"><Icon name={w.icon} size={15} /></span>
            <span class="label">{w.text}</span>
            {#if w.action}
              <button class="btn small" onclick={() => act(w)}>{actLabel(w)}</button>
            {:else}
              <span class="muted hint">Someone should tidy up</span>
            {/if}
          </li>
        {/each}
        {#each plan.wishes as [activity, skillId] (`${activity}:${skillId}`)}
          <li class="wish">
            <span class="label">Somewhere to <b>{activityLabel(activity, skillId).toLowerCase()}</b></span>
            <button
              class="btn small"
              onclick={() =>
                services.controls.openCatalog({ label: `For ${sim.name}: ${activityLabel(activity, skillId)}`, activity, skill: skillId })}
            >
              Find in catalog
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  </section>
{/if}

<style>
  .goals {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  h3 {
    margin: 6px 0 0;
    font-size: 11px;
    font-weight: 650;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-muted);
  }
  ul {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .goal,
  .wish {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px;
    border-radius: var(--radius-sm);
    background: var(--surface);
    box-shadow: var(--shadow-sm);
    font-size: 12.5px;
  }
  .idea {
    background: var(--accent-soft);
    box-shadow: none;
  }
  .icon {
    display: grid;
    place-items: center;
    width: 26px;
    height: 26px;
    flex: none;
    border-radius: 8px;
    background: var(--accent-soft);
    color: var(--accent);
  }
  .body {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  }
  .label {
    flex: 1;
    font-weight: 600;
  }
  .bar {
    height: 5px;
    border-radius: 99px;
    background: var(--hairline);
    overflow: hidden;
  }
  .bar span {
    display: block;
    height: 100%;
    background: var(--good);
    transition: width var(--slow) var(--ease);
  }
  .trend {
    width: 14px;
    text-align: center;
    font-size: 11px;
    color: var(--text-muted);
  }
  .x {
    display: grid;
    place-items: center;
    width: 22px;
    height: 22px;
    border-radius: 6px;
    color: var(--text-muted);
  }
  .x:hover {
    background: var(--hairline);
    color: var(--text);
  }
  .add,
  .params {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  select,
  input {
    height: 30px;
    padding: 0 8px;
    border-radius: var(--radius-sm);
    border: 1px solid var(--hairline);
    background: var(--surface);
    font: inherit;
    font-size: 12.5px;
  }
  .add > select {
    flex: 1;
  }
  input {
    width: 84px;
  }
  .week {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 8px 10px;
    border-radius: var(--radius-sm);
    background: var(--surface-muted);
    font-size: 12px;
  }
  .week i {
    font-style: normal;
    font-weight: 800;
  }
  .ok {
    color: var(--good);
  }
  .half {
    color: var(--warn);
  }
  .no {
    color: var(--bad);
  }
  .muted {
    color: var(--text-muted);
  }
  .empty {
    font-size: 12px;
  }
  .hint {
    font-size: 11.5px;
  }
</style>
