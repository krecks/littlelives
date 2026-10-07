<script lang="ts">
  import {
    bondBetween,
    HAIR_STYLES,
    householdProblems,
    palette,
    randomHousehold,
    randomSim,
    setBond,
    type HouseholdDraft,
  } from '../../game/household';
  import Segmented from '../kit/Segmented.svelte';
  import { app } from '../app.svelte';
  import Icon from '../Icon.svelte';
  import SimPreview from '../kit/SimPreview.svelte';
  import { services } from '../services';

  const { content, assets } = services;
  const rules = content.rules;
  const swatches = {
    body: palette(assets, 'palette.outfit'),
    skin: palette(assets, 'palette.skin'),
    hair: palette(assets, 'palette.hair'),
  };
  const tabs = ['Identity', 'Look', 'Traits', 'Perks', 'Bonds'] as const;
  const bondLabels: Record<string, string> = {
    roommates: 'Roommates',
    friends: 'Friends',
    bestFriends: 'Best friends',
    partners: 'Partners',
    rivals: 'Rivals',
  };
  const bondOptions = Object.keys(bondLabels)
    .filter((k) => content.bondPresets.includes(k))
    .map((value) => ({ value, label: bondLabels[value] }));

  const neighbourNames = (app.town?.households ?? []).map((h) => h.household.name);
  let household = $state<HouseholdDraft>(
    app.household ? structuredClone(app.household) : randomHousehold(content, assets, 2, neighbourNames),
  );
  let active = $state(0);
  let tab = $state<(typeof tabs)[number]>('Identity');
  let showProblems = $state(false);

  const sim = $derived(household.members[Math.min(active, household.members.length - 1)]);
  const problems = $derived(householdProblems(content, household));
  const spent = $derived(content.perkCost(sim.perks));

  function addMember() {
    if (household.members.length >= rules.maxHousehold) return;
    household.members.push(randomSim(content, assets, household.members.map((m) => m.name)));
    active = household.members.length - 1;
  }

  function removeMember(i: number) {
    if (household.members.length <= 1) return;
    household.members.splice(i, 1);
    active = Math.min(active, household.members.length - 1);
  }

  function randomize() {
    const others = household.members.filter((m) => m !== sim).map((m) => m.name);
    Object.assign(sim, { ...randomSim(content, assets, others), uid: sim.uid });
  }

  function toggleTrait(id: string) {
    const i = sim.traits.indexOf(id);
    if (i >= 0) sim.traits.splice(i, 1);
    else if (!content.traitBlocker(sim.traits, id)) sim.traits.push(id);
  }

  function togglePerk(id: string, cost: number) {
    const i = sim.perks.indexOf(id);
    if (i >= 0) sim.perks.splice(i, 1);
    else if (spent + cost <= rules.perkPoints) sim.perks.push(id);
  }

  function toggleAttraction(gender: string) {
    const i = sim.attractedTo.indexOf(gender);
    if (i >= 0) sim.attractedTo.splice(i, 1);
    else sim.attractedTo.push(gender);
  }

  function bondFor(other: string) {
    return bondBetween(household, sim.uid, other)?.preset ?? 'roommates';
  }

  /** Partners who aren't attracted to each other's gender is allowed, but worth a heads-up. */
  function bondWarning(otherUid: string): string | null {
    const other = household.members.find((m) => m.uid === otherUid);
    if (!other || bondFor(otherUid) !== 'partners') return null;
    if (!sim.attractedTo.includes(other.gender)) return `${sim.name} isn't attracted to ${content.gender(other.gender)?.label.toLowerCase()} Sims`;
    if (!other.attractedTo.includes(sim.gender)) return `${other.name} isn't attracted to ${content.gender(sim.gender)?.label.toLowerCase()} Sims`;
    return null;
  }

  function next() {
    if (problems.length) {
      showProblems = true;
      return;
    }
    app.household = $state.snapshot(household);
    app.screen = 'home';
  }
</script>

<div class="cas scaled">
  <header>
    <button class="btn ghost" onclick={() => ((app.household = $state.snapshot(household)), (app.screen = 'neighbourhood'))}>
      <Icon name="icon.ui.back" size={18} /> Neighbourhood
    </button>
    <div class="title">
      <span class="eyebrow">Step 2 of 3 · Create your household</span>
      <input class="input family" aria-label="Household name" placeholder="Household name" bind:value={household.name} maxlength="24" />
    </div>
    <div class="actions">
      <button class="btn" onclick={() => ((household = randomHousehold(content, assets, undefined, neighbourNames)), (active = 0))}>
        <Icon name="icon.ui.dice" size={18} /> Surprise me
      </button>
      <button class="btn primary" onclick={next}>Choose a home →</button>
    </div>
  </header>

  {#if showProblems && problems.length}
    <div class="problems" role="alert">
      {#each problems as p (p)}<span>{p}</span>{/each}
    </div>
  {/if}

  <main>
    <aside class="members">
      <span class="eyebrow">Members · {household.members.length}/{rules.maxHousehold}</span>
      {#each household.members as m, i (i)}
        <div class="member" class:active={i === active}>
          <button class="pick" onclick={() => (active = i)}>
            <span class="mini"><SimPreview appearance={m.appearance} size={44} animate={false} /></span>
            <span class="meta">
              <b>{m.name || 'Unnamed'}</b>
              <span class="traits">
                {#each m.traits as t (t)}<Icon name={content.trait(t)?.icon ?? ''} size={13} />{/each}
              </span>
            </span>
          </button>
          {#if household.members.length > 1}
            <button class="remove" aria-label="Remove {m.name}" onclick={() => removeMember(i)}><Icon name="icon.ui.close" size={12} /></button>
          {/if}
        </div>
      {/each}
      {#if household.members.length < rules.maxHousehold}
        <button class="add" onclick={addMember}><Icon name="icon.ui.plus" size={16} /> Add member</button>
      {/if}
    </aside>

    <section class="stage">
      <div class="spot"></div>
      {#key active}
        <div class="hero"><SimPreview appearance={sim.appearance} size={250} /></div>
      {/key}
      <h2>{sim.name || 'Unnamed'} <span>{household.name}</span></h2>
      <div class="chips">
        {#each sim.traits as t (t)}
          <span class="chip"><Icon name={content.trait(t)?.icon ?? ''} size={14} />{content.trait(t)?.label}</span>
        {/each}
        {#each sim.perks as p (p)}
          <span class="chip perk"><Icon name={content.perk(p)?.icon ?? ''} size={14} />{content.perk(p)?.label}</span>
        {/each}
      </div>
      <button class="btn" onclick={randomize}><Icon name="icon.ui.dice" size={18} /> Randomize {sim.name || 'member'}</button>
    </section>

    <section class="editor glass">
      <div class="tabs" role="tablist">
        {#each tabs as t (t)}
          {#if t !== 'Bonds' || household.members.length > 1}
            <button role="tab" aria-selected={tab === t} class:active={tab === t} onclick={() => (tab = t)}>{t}</button>
          {/if}
        {/each}
      </div>

      <div class="pane">
        {#if tab === 'Identity'}
          <label class="field">
            <span class="eyebrow">First name</span>
            <div class="row">
              <input class="input" bind:value={sim.name} maxlength="16" placeholder="Name" />
              <button
                class="btn"
                aria-label="Random name"
                onclick={() => (sim.name = content.names.first[Math.floor(Math.random() * content.names.first.length)])}
              >
                <Icon name="icon.ui.dice" size={18} />
              </button>
            </div>
          </label>
          {#if content.genders.length}
            <div class="field">
              <span class="eyebrow">Gender</span>
              <Segmented label="Gender" bind:value={sim.gender} options={content.genders.map((g) => ({ value: g.id, label: g.label }))} />
            </div>
            <div class="field">
              <span class="eyebrow">Attracted to</span>
              <div class="chips-row">
                {#each content.genders as g (g.id)}
                  <button class="pill" class:on={sim.attractedTo.includes(g.id)} aria-pressed={sim.attractedTo.includes(g.id)} onclick={() => toggleAttraction(g.id)}>
                    <Icon name="icon.gender.{g.id}" size={14} />
                    {g.label === 'Female' ? 'Women' : g.label === 'Male' ? 'Men' : g.label}
                  </button>
                {/each}
              </div>
              <span class="hint small">
                {sim.attractedTo.length === 0
                  ? `${sim.name || 'This Sim'} isn't interested in romance.`
                  : 'Romantic interactions only happen between Sims attracted to each other.'}
              </span>
            </div>
          {/if}
          <p class="hint">
            Traits shape what {sim.name || 'this Sim'} enjoys and how quickly their needs change. Perks are small advantages bought with
            {rules.perkPoints} points.
          </p>
        {:else if tab === 'Look'}
          {#each [['body', 'Outfit'], ['skin', 'Skin tone'], ['hair', 'Hair']] as const as [key, label] (key)}
            <div class="field">
              <span class="eyebrow">{label}</span>
              <div class="swatches">
                {#each swatches[key] as color (color)}
                  <button
                    class="swatch"
                    class:selected={sim.appearance[key] === color}
                    style="--c:{color}"
                    aria-label="{label} {color}"
                    onclick={() => (sim.appearance[key] = color)}
                  ></button>
                {/each}
              </div>
            </div>
          {/each}
          <div class="field">
            <span class="eyebrow">Hairstyle</span>
            <Segmented
              label="Hairstyle"
              bind:value={sim.appearance.hairStyle}
              options={HAIR_STYLES.map((h) => ({ value: h, label: h === 'none' ? 'Bald' : h[0].toUpperCase() + h.slice(1) }))}
            />
          </div>
          <label class="field">
            <span class="eyebrow">Height</span>
            <input type="range" min="0.9" max="1.1" step="0.01" bind:value={sim.appearance.height} />
            <span class="scale"><span>Shorter</span><span>Taller</span></span>
          </label>
        {:else if tab === 'Traits'}
          <div class="pane-head">
            <span><b>{sim.traits.length}</b> / {rules.maxTraits} traits</span>
            <span class="muted">Pick at least {rules.minTraits}</span>
          </div>
          <div class="cards">
            {#each content.traits as t (t.id)}
              {@const selected = sim.traits.includes(t.id)}
              {@const blocker = selected ? null : content.traitBlocker(sim.traits, t.id)}
              <button class="card" class:selected disabled={!!blocker} title={blocker ?? t.description} onclick={() => toggleTrait(t.id)}>
                <span class="card-icon"><Icon name={t.icon} size={20} /></span>
                <b>{t.label}</b>
                <span class="desc">{blocker ?? t.description}</span>
              </button>
            {/each}
          </div>
        {:else if tab === 'Bonds'}
          <p class="hint">How {sim.name || 'this Sim'} starts out with the rest of the household. Relationships keep changing in play.</p>
          {#each household.members.filter((m) => m.uid !== sim.uid) as other (other.uid)}
            {@const warning = bondWarning(other.uid)}
            <div class="field bond">
              <div class="bond-head">
                <span class="mini"><SimPreview appearance={other.appearance} size={36} animate={false} /></span>
                <b>{other.name || 'Unnamed'}</b>
              </div>
              <div class="bond-pick" role="radiogroup" aria-label="Bond with {other.name}">
                {#each bondOptions as o (o.value)}
                  <button class="pill" class:on={bondFor(other.uid) === o.value} onclick={() => setBond(household, sim.uid, other.uid, o.value)}>{o.label}</button>
                {/each}
              </div>
              {#if warning}<span class="hint small warn">{warning}</span>{/if}
            </div>
          {/each}
        {:else}
          <div class="pane-head">
            <span><b>{rules.perkPoints - spent}</b> of {rules.perkPoints} points left</span>
            <span class="points">
              {#each { length: rules.perkPoints } as _, i (i)}<span class:used={i < spent}></span>{/each}
            </span>
          </div>
          <div class="cards">
            {#each content.perks as p (p.id)}
              {@const selected = sim.perks.includes(p.id)}
              {@const affordable = selected || spent + p.cost <= rules.perkPoints}
              <button class="card" class:selected disabled={!affordable} title={p.description} onclick={() => togglePerk(p.id, p.cost)}>
                <span class="card-icon"><Icon name={p.icon} size={20} /></span>
                <b>{p.label} <span class="cost">{p.cost}</span></b>
                <span class="desc">{p.description}</span>
              </button>
            {/each}
          </div>
        {/if}
      </div>
    </section>
  </main>
</div>

<style>
  .cas {
    position: relative;
    height: 100vh;
    display: grid;
    grid-template-rows: auto auto 1fr;
    padding: 20px 28px 24px;
    gap: 12px;
  }
  header {
    display: flex;
    align-items: center;
    gap: 20px;
  }
  .title {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .family {
    max-width: 320px;
    font-size: 22px;
    font-weight: 700;
    letter-spacing: -0.02em;
    height: 44px;
    background: transparent;
    border-color: transparent;
    padding-left: 0;
  }
  .family:hover,
  .family:focus {
    background: var(--surface);
    padding-left: 12px;
  }
  .actions {
    display: flex;
    gap: 10px;
  }
  .problems {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .problems span {
    padding: 6px 12px;
    border-radius: var(--radius-pill);
    background: rgba(236, 106, 92, 0.12);
    color: var(--bad);
    font-weight: 550;
    font-size: 13px;
  }
  main {
    min-height: 0;
    display: grid;
    grid-template-columns: 240px 1fr 460px;
    gap: 20px;
  }
  .members {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .member {
    position: relative;
    border-radius: var(--radius-md);
    transition: background var(--fast) var(--ease);
  }
  .member.active {
    background: var(--glass-strong);
    box-shadow: var(--shadow-sm);
  }
  .pick {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 10px;
    text-align: left;
  }
  .mini {
    width: 44px;
    height: 44px;
    border-radius: 50%;
    overflow: hidden;
    background: var(--surface-muted);
    display: grid;
    place-items: start center;
  }
  .meta {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .traits {
    display: flex;
    gap: 4px;
    color: var(--text-muted);
  }
  .remove {
    position: absolute;
    top: 50%;
    right: 8px;
    transform: translateY(-50%);
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    border-radius: 50%;
    color: var(--text-muted);
    opacity: 0;
  }
  .member:hover .remove {
    opacity: 1;
  }
  .remove:hover {
    background: rgba(236, 106, 92, 0.15);
    color: var(--bad);
  }
  .add {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px;
    border-radius: var(--radius-md);
    border: 1.5px dashed rgba(29, 34, 48, 0.18);
    color: var(--text-muted);
    font-weight: 600;
  }
  .add:hover {
    border-color: var(--accent);
    color: var(--accent);
  }
  .stage {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 14px;
  }
  .spot {
    position: absolute;
    top: 18%;
    width: 380px;
    height: 380px;
    border-radius: 50%;
    background: radial-gradient(closest-side, rgba(255, 255, 255, 0.9), rgba(255, 255, 255, 0));
  }
  .hero {
    position: relative;
    animation: swap 420ms var(--ease);
  }
  h2 {
    position: relative;
    margin: 0;
    font-size: 30px;
    letter-spacing: -0.03em;
  }
  h2 span {
    color: var(--text-muted);
    font-weight: 500;
  }
  .chips {
    position: relative;
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 6px;
    max-width: 420px;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 5px 10px;
    border-radius: var(--radius-pill);
    background: var(--accent-soft);
    color: var(--accent);
    font-weight: 600;
    font-size: 12px;
  }
  .chip.perk {
    background: rgba(240, 181, 74, 0.18);
    color: #b07a14;
  }
  .editor {
    min-height: 0;
    display: flex;
    flex-direction: column;
    padding: 8px;
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
  .pane {
    flex: 1;
    overflow: auto;
    padding: 16px 10px 10px;
    display: flex;
    flex-direction: column;
    gap: 18px;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .row {
    display: flex;
    gap: 8px;
  }
  .row .input {
    flex: 1;
  }
  .row .btn {
    padding: 0 12px;
  }
  .hint {
    margin: 0;
    color: var(--text-muted);
    line-height: 1.5;
  }
  .hint.small {
    font-size: 12px;
  }
  .hint.warn {
    color: #b07a14;
  }
  .chips-row,
  .bond-pick {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .pill {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 32px;
    padding: 0 12px;
    border-radius: var(--radius-pill);
    background: var(--surface);
    border: 1.5px solid var(--hairline);
    font-weight: 600;
    color: var(--text-muted);
    transition: border-color var(--fast) var(--ease), color var(--fast) var(--ease);
  }
  .pill.on {
    border-color: var(--accent);
    color: var(--accent);
    background: var(--accent-soft);
  }
  .bond {
    padding: 12px;
    border-radius: var(--radius-md);
    background: var(--surface);
    box-shadow: var(--shadow-sm);
  }
  .bond-head {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .bond-head .mini {
    width: 36px;
    height: 36px;
  }
  .swatches {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .swatch {
    width: 34px;
    height: 34px;
    border-radius: 50%;
    background: var(--c);
    box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.08);
    transition: transform var(--fast) var(--ease), box-shadow var(--fast) var(--ease);
  }
  .swatch:hover {
    transform: scale(1.08);
  }
  .swatch.selected {
    box-shadow: 0 0 0 2px var(--surface), 0 0 0 4px var(--accent);
  }
  .scale {
    display: flex;
    justify-content: space-between;
    color: var(--text-muted);
    font-size: 12px;
  }
  .pane-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .muted {
    color: var(--text-muted);
  }
  .points {
    display: flex;
    gap: 4px;
  }
  .points span {
    width: 18px;
    height: 8px;
    border-radius: var(--radius-pill);
    background: var(--hairline);
  }
  .points span.used {
    background: var(--warn);
  }
  .cards {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }
  .card {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 4px;
    padding: 12px;
    border-radius: var(--radius-md);
    background: var(--surface);
    border: 1.5px solid transparent;
    text-align: left;
    box-shadow: var(--shadow-sm);
    transition: border-color var(--fast) var(--ease), transform var(--fast) var(--ease), opacity var(--fast) var(--ease);
  }
  .card:hover:not(:disabled) {
    transform: translateY(-1px);
  }
  .card.selected {
    border-color: var(--accent);
    background: linear-gradient(0deg, var(--accent-soft), var(--accent-soft)), var(--surface);
  }
  .card:disabled {
    opacity: 0.45;
    cursor: default;
  }
  .card-icon {
    display: grid;
    place-items: center;
    width: 34px;
    height: 34px;
    border-radius: 10px;
    background: var(--surface-muted);
    color: var(--accent);
    margin-bottom: 4px;
  }
  .card b {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .cost {
    padding: 1px 7px;
    border-radius: var(--radius-pill);
    background: rgba(240, 181, 74, 0.2);
    color: #b07a14;
    font-size: 11px;
  }
  .desc {
    color: var(--text-muted);
    font-size: 12px;
    line-height: 1.4;
  }
  @keyframes swap {
    from {
      opacity: 0;
      transform: translateY(10px) scale(0.97);
    }
  }
</style>
