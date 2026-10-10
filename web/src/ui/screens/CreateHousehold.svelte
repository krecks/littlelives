<script lang="ts">
  import { onDestroy, onMount, untrack } from 'svelte';
  import {
    bondBetween,
    draftVoice,
    ensureOutfit,
    HAIR_STYLES,
    householdProblems,
    lookAtAge,
    palette,
    randomAge,
    randomFirstName,
    randomHousehold,
    randomSim,
    randomVoice,
    regender,
    setBond,
    type Appearance,
    type HouseholdDraft,
  } from '../../game/household';
  import type { Wardrobe } from '../../render/types';
  import { kinLabel } from '../relationship';
  import Segmented from '../kit/Segmented.svelte';
  import SimStage from '../kit/SimStage.svelte';
  import { app } from '../app.svelte';
  import Icon from '../Icon.svelte';
  import SimPreview from '../kit/SimPreview.svelte';
  import { services } from '../services';
  import { settings } from '../../settings/settings.svelte';
  import { playClip, type Playing } from '../../voice/player';
  import { DOWNLOAD_MB, speak, unloadVoice, voiceStatus } from '../../voice/service.svelte';
  import { baseVoice, KITTEN_VOICES, modelFor, VOICE_RANGE, voiceFor } from '../../voice/voices';

  const { content, assets } = services;
  const rules = content.rules;
  const swatches = {
    body: palette(assets, 'palette.outfit'),
    skin: palette(assets, 'palette.skin'),
    hair: palette(assets, 'palette.hair'),
    bottomColor: palette(assets, 'palette.bottoms'),
    shoesColor: palette(assets, 'palette.shoes'),
  };
  const garmentLabels: Record<string, string> = {
    'top.tee': 'T-shirt',
    'top.long': 'Long sleeve',
    'top.vneck': 'V-neck',
    'top.polo': 'Polo',
    'top.tank': 'Tank top',
    'top.blouse': 'Blouse',
    'bottom.trousers': 'Trousers',
    'bottom.shorts': 'Shorts',
    'bottom.capri': 'Capris',
    'bottom.skirt': 'Skirt',
    'shoes.sneakers': 'Sneakers',
    'shoes.boots': 'Boots',
  };
  const garmentLabel = (part: string) => garmentLabels[part] ?? part.slice(part.indexOf('.') + 1).replace(/^./, (c) => c.toUpperCase());
  const tabs = ['Identity', 'Look', 'Traits', 'Perks', 'Bonds'] as const;
  const bondLabels: Record<string, string> = {
    roommates: 'Roommates',
    friends: 'Friends',
    bestFriends: 'Best friends',
    partners: 'Partners',
    rivals: 'Rivals',
    parent: 'Parent',
    child: 'Child',
    siblings: 'Sibling',
  };
  const bondOptions = Object.keys(bondLabels)
    .filter((k) => content.bondPresets.includes(k))
    .map((value) => ({ value, label: bondLabels[value] }));

  /**
   * Step 2 of a new game by default (the draft in `app`, back to the neighbourhood, on to the
   * home). In a game, a family moving into the home: the caller says where back and next lead.
   */
  let {
    eyebrow = 'Step 2 of 3 · Create your household',
    backLabel = 'Neighbourhood',
    nextLabel = 'Choose a home →',
    avoidNames = (app.town?.households ?? []).map((h) => h.household.name),
    draft = app.household,
    onback = (h: HouseholdDraft) => ((app.household = h), (app.screen = 'neighbourhood')),
    onnext = (h: HouseholdDraft) => ((app.household = h), (app.screen = 'home')),
  }: {
    eyebrow?: string;
    backLabel?: string;
    nextLabel?: string;
    /** Household names already in town (a new one is named differently). */
    avoidNames?: string[];
    /** Where editing starts (null: a random household of two). */
    draft?: HouseholdDraft | null;
    onback?: (household: HouseholdDraft) => void;
    onnext?: (household: HouseholdDraft) => void;
  } = $props();

  const neighbourNames = untrack(() => avoidNames);
  const initial = untrack(() => (draft ? structuredClone(draft) : randomHousehold(content, assets, 2, neighbourNames)));
  for (const m of initial.members) ensureOutfit(m);
  let household = $state<HouseholdDraft>(initial);
  let active = $state(0);
  let stage = $state.raw<SimStage | null>(null);
  let wardrobe = $state.raw<Wardrobe | null>(null);
  let tab = $state<(typeof tabs)[number]>('Identity');
  let showProblems = $state(false);

  const sim = $derived(household.members[Math.min(active, household.members.length - 1)]);
  const problems = $derived(householdProblems(content, household));
  const spent = $derived(content.perkCost(sim.perks));
  const others = () => household.members.filter((m) => m !== sim).map((m) => m.name);

  $effect(() => {
    const gender = sim.gender;
    let alive = true;
    void services.previews.wardrobe(gender).then((w) => alive && (wardrobe = w));
    return () => (alive = false);
  });

  // A gender change keeps the Sim but fits its name (if it was a picked one) and clothes.
  let shown = { uid: '', gender: '' };
  $effect(() => {
    const uid = sim.uid;
    const gender = sim.gender;
    untrack(() => {
      if (shown.uid === uid && shown.gender !== gender) {
        regender(content, sim, shown.gender, others());
        stage?.react('admire');
      } else if (shown.uid && shown.uid !== uid) {
        stage?.react('hello');
      }
      shown = { uid, gender };
    });
  });

  // Say hello once the stage is up.
  onMount(() => stage?.react('hello'));

  function setLook<K extends keyof Appearance>(key: K, value: Appearance[K]) {
    if (sim.appearance[key] === value) return;
    sim.appearance[key] = value;
    stage?.react('admire');
  }

  // Voice: a sample line in the resident's own voice at their age (a baby's as the child they'll be).
  const voice = $derived(sim.appearance.voice);
  const voiceChanged = $derived(
    (voice?.pitch ?? 1) !== 1 || (voice?.speed ?? 1) !== 1 || (voice?.depth ?? 1) !== 1 || baseVoice(voice) !== null,
  );
  const isBaby = $derived(!!content.stageOf(sim.age)?.baby);
  /** Teens and grown-ups speak with KittenTTS's voices; children with the small model, as a child. */
  const voiceStage = $derived(isBaby ? content.lifeStages.find((s) => !s.baby)?.id : content.stageOf(sim.age)?.id);
  const grownVoice = $derived(modelFor(voiceStage) === 'kitten');
  /** The voices offered: the four that fit the gender (all eight for others), besides their own mix. */
  const voiceOptions = $derived(
    KITTEN_VOICES.flatMap((v, i) => ((sim.gender !== 'male' && sim.gender !== 'female') || v.sex === sim.gender ? [{ index: i, name: v.name }] : [])),
  );
  function chooseVoice(index: number | null) {
    const v = draftVoice(sim);
    if (index === null) delete v.base;
    else v.base = index;
    // Heard at once (a child's choice is for later: they still sound like a child).
    if (grownVoice) void hear();
  }
  let hearing = $state(false);
  let heard = false;
  let playing: Playing | null = null;
  const voiceNote = $derived.by(() => {
    if (voiceStatus.state === 'error') return `Couldn't load the voice: ${voiceStatus.error}`;
    if (voiceStatus.state === 'loading') {
      const p = voiceStatus.progress;
      return p > 0 && p < 1 ? `Downloading the voice… ${Math.floor(p * 100)} %` : 'Getting the voice ready…';
    }
    const model = grownVoice ? 'kitten' : 'paradee';
    if (!settings.voices) {
      return voiceStatus.models[model] === 'ready'
        ? 'Resident voices are off in Settings → Audio: turn them on to hear residents in the game.'
        : `Resident voices are off in Settings → Audio. Hearing a sample downloads the voice once (about ${Math.round(DOWNLOAD_MB.shared + DOWNLOAD_MB[model])} MB).`;
    }
    if (!grownVoice) return 'Children have a child’s voice: the voice chosen above is theirs from their teens. Pitch, speed and depth apply now.';
    return 'Voices change as residents grow up; this choice goes along.';
  });

  async function hear() {
    const params = voiceFor(0, sim.gender, voiceStage, $state.snapshot(draftVoice(sim)));
    const name = sim.name.trim();
    hearing = heard = true;
    try {
      const clip = await speak(name ? `Hi, I'm ${name}! This is how I sound.` : 'Hi! This is how I sound.', params);
      playing?.stop();
      playing = playClip(clip);
      stage?.react('hello');
    } catch {
      // The note under the button says why (the voice couldn't load).
    } finally {
      hearing = false;
    }
  }

  function resetVoice() {
    if (!voice) return;
    voice.pitch = 1;
    voice.speed = 1;
    voice.depth = 1;
    delete voice.base;
  }

  // Hearing a sample doesn't turn voices on: with them off, the engine goes again on the way out.
  onDestroy(() => {
    playing?.stop();
    if (heard && !settings.voices) unloadVoice();
  });

  function addMember() {
    if (household.members.length >= rules.maxHousehold) return;
    household.members.push(randomSim(content, assets, household.members.map((m) => m.name)));
    active = household.members.length - 1;
  }

  function surprise() {
    household = randomHousehold(content, assets, undefined, neighbourNames);
    active = 0;
    shown = { uid: household.members[0].uid, gender: household.members[0].gender };
    stage?.react('cheer');
  }

  function removeMember(i: number) {
    if (household.members.length <= 1) return;
    household.members.splice(i, 1);
    active = Math.min(active, household.members.length - 1);
  }

  function randomize() {
    const fresh = randomSim(content, assets, others());
    shown = { uid: sim.uid, gender: fresh.gender };
    Object.assign(sim, { ...fresh, uid: sim.uid });
    stage?.react('cheer');
  }

  function toggleTrait(id: string) {
    const i = sim.traits.indexOf(id);
    if (i >= 0) sim.traits.splice(i, 1);
    else if (!content.traitBlocker(sim.traits, id)) {
      sim.traits.push(id);
      stage?.react(`trait:${id}`);
    }
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

  /** The bond with `other` as seen from this resident (a parent's bond is the child's "child"). */
  function bondFor(other: string) {
    const bond = bondBetween(household, sim.uid, other);
    if (!bond) return 'roommates';
    if (bond.a === sim.uid) return bond.preset;
    return bond.preset === 'parent' ? 'child' : bond.preset === 'child' ? 'parent' : bond.preset;
  }

  /** A family bond in words ("Leo is Finn's father"), with a heads-up when the ages don't fit. */
  function familyNote(otherUid: string): { text: string; warn: boolean } | null {
    const other = household.members.find((m) => m.uid === otherUid);
    const preset = bondFor(otherUid);
    const kin = preset === 'parent' ? 'parent' : preset === 'child' ? 'child' : preset === 'siblings' ? 'sibling' : null;
    if (!other || !kin) return null;
    const text = `${other.name || 'Unnamed'} is ${sim.name || 'this resident'}'s ${kinLabel(kin, other.gender)?.toLowerCase()}`;
    const gap = kin === 'parent' ? other.age - sim.age : kin === 'child' ? sim.age - other.age : 0;
    return { text: gap && gap < 16 ? `${text}, though only ${gap} years apart` : text, warn: !!gap && gap < 16 };
  }

  /** Partners who aren't attracted to each other's gender is allowed, but worth a heads-up. */
  function bondWarning(otherUid: string): string | null {
    const other = household.members.find((m) => m.uid === otherUid);
    if (!other || bondFor(otherUid) !== 'partners') return null;
    if (!sim.attractedTo.includes(other.gender)) return `${sim.name} isn't attracted to ${content.gender(other.gender)?.label.toLowerCase()} residents`;
    if (!other.attractedTo.includes(sim.gender)) return `${other.name} isn't attracted to ${content.gender(sim.gender)?.label.toLowerCase()} residents`;
    return null;
  }

  function next() {
    if (problems.length) {
      showProblems = true;
      return;
    }
    onnext($state.snapshot(household));
  }
</script>

<div class="cas scaled">
  <header>
    <button class="btn ghost" onclick={() => onback($state.snapshot(household))}>
      <Icon name="icon.ui.back" size={18} /> {backLabel}
    </button>
    <div class="title">
      <span class="eyebrow">{eyebrow}</span>
      <input class="input family" aria-label="Household name" placeholder="Household name" bind:value={household.name} maxlength="24" />
    </div>
    <div class="actions">
      <button class="btn" onclick={surprise}>
        <Icon name="icon.ui.dice" size={18} /> Surprise me
      </button>
      <button class="btn primary" onclick={next}>{nextLabel}</button>
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
            <span class="mini"><SimPreview appearance={lookAtAge(content, assets, m.appearance, m.age)} gender={m.gender} size={44} /></span>
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
      <SimStage bind:this={stage} gender={sim.gender} appearance={lookAtAge(content, assets, sim.appearance, sim.age)} />
      <div class="nameplate glass">
        <h2>{sim.name || 'Unnamed'} <span>{household.name}</span></h2>
        {#if sim.traits.length || sim.perks.length}
          <div class="chips">
            {#each sim.traits as t (t)}
              <span class="chip"><Icon name={content.trait(t)?.icon ?? ''} size={14} />{content.trait(t)?.label}</span>
            {/each}
            {#each sim.perks as p (p)}
              <span class="chip perk"><Icon name={content.perk(p)?.icon ?? ''} size={14} />{content.perk(p)?.label}</span>
            {/each}
          </div>
        {/if}
        <button class="btn randomize" onclick={randomize}><Icon name="icon.ui.dice" size={18} /> Randomize {sim.name || 'member'}</button>
      </div>
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
                onclick={() => (sim.name = randomFirstName(content, sim.gender, [...others(), sim.name]))}
              >
                <Icon name="icon.ui.dice" size={18} />
              </button>
            </div>
          </label>
          {#if content.lifeStages.length}
            <div class="field">
              <span class="eyebrow">Age</span>
              <Segmented
                label="Life stage"
                bind:value={() => content.stageOf(sim.age)?.id ?? '', (id) => (sim.age = randomAge(content, id))}
                options={content.lifeStages.map((s) => ({ value: s.id, label: s.label }))}
              />
              <label class="age-row">
                <input
                  class="input age"
                  type="number"
                  aria-label="Age in years"
                  min={content.lifeStages[0].from}
                  max={content.stageAges(content.lifeStages[content.lifeStages.length - 1].id)[1]}
                  bind:value={sim.age}
                />
                <span class="hint">years old</span>
              </label>
            </div>
          {/if}
          {#if content.genders.length}
            <div class="field">
              <span class="eyebrow">Gender</span>
              <Segmented label="Gender" bind:value={sim.gender} options={content.genders.map((g) => ({ value: g.id, label: g.label }))} />
            </div>
            {#if !content.isAdult(sim.age)}
              <span class="hint small">Who they fall for is a question for when they grow up.</span>
            {:else}
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
                  ? `${sim.name || 'This resident'} isn't interested in romance.`
                  : 'Romantic interactions only happen between residents attracted to each other.'}
              </span>
            </div>
            {/if}
          {/if}
          <div class="field">
            <span class="eyebrow">Voice</span>
            <div class="chips-row" role="radiogroup" aria-label="Voice">
              <button
                class="pill"
                role="radio"
                aria-checked={baseVoice(voice) === null}
                class:on={baseVoice(voice) === null}
                title="A mix of two voices that is {sim.name.trim() || 'theirs'} alone"
                onclick={() => chooseVoice(null)}>Own mix</button
              >
              {#each voiceOptions as o (o.index)}
                <button class="pill" role="radio" aria-checked={baseVoice(voice) === o.index} class:on={baseVoice(voice) === o.index} onclick={() => chooseVoice(o.index)}
                  >{o.name}</button
                >
              {/each}
            </div>
            <label class="slider">
              <input
                type="range"
                aria-label="Pitch"
                min={VOICE_RANGE.pitch[0]}
                max={VOICE_RANGE.pitch[1]}
                step="0.01"
                bind:value={() => voice?.pitch ?? 1, (v) => (draftVoice(sim).pitch = v)}
              />
              <span class="scale"><span>Lower</span><b>Pitch</b><span>Higher</span></span>
            </label>
            <label class="slider">
              <input
                type="range"
                aria-label="Speed"
                min={VOICE_RANGE.speed[0]}
                max={VOICE_RANGE.speed[1]}
                step="0.01"
                bind:value={() => voice?.speed ?? 1, (v) => (draftVoice(sim).speed = v)}
              />
              <span class="scale"><span>Slower</span><b>Speed</b><span>Faster</span></span>
            </label>
            <label class="slider">
              <!-- The stored factor is below 1 for a larger voice; the slider runs smaller to larger. -->
              <input
                type="range"
                aria-label="Depth"
                min={2 - VOICE_RANGE.depth[1]}
                max={2 - VOICE_RANGE.depth[0]}
                step="0.01"
                bind:value={() => 2 - (voice?.depth ?? 1), (v) => (draftVoice(sim).depth = Math.round((2 - v) * 100) / 100)}
              />
              <span class="scale"><span>Smaller</span><b>Depth</b><span>Larger</span></span>
            </label>
            <div class="row">
              <button class="btn hear" disabled={hearing} onclick={hear}>
                <Icon name="icon.ui.speed1" size={18} />
                {hearing ? (voiceStatus.models[grownVoice ? 'kitten' : 'paradee'] === 'ready' ? 'One moment…' : 'Loading the voice…') : `Hear ${sim.name.trim() || 'it'}`}
              </button>
              <button class="btn" aria-label="Random voice" title="Random voice" onclick={() => randomVoice(sim)}>
                <Icon name="icon.ui.dice" size={18} />
              </button>
              <button class="btn" aria-label="Default voice" title="Default voice" disabled={!voiceChanged} onclick={resetVoice}>
                <Icon name="icon.ui.undo" size={18} />
              </button>
            </div>
            {#if isBaby}<span class="hint small">Babies don't talk yet: this is how they'll sound as a child.</span>{/if}
            {#if voiceNote}<span class="hint small">{voiceNote}</span>{/if}
          </div>
          <p class="hint">
            Traits shape what {sim.name || 'this resident'} enjoys and how quickly their needs change. Perks are small advantages bought with
            {rules.perkPoints} points.
          </p>
        {:else if tab === 'Look'}
          {#snippet colors(key: 'body' | 'skin' | 'hair' | 'bottomColor' | 'shoesColor', label: string)}
            <div class="swatches" role="radiogroup" aria-label={label}>
              {#each swatches[key] as color (color)}
                <button
                  class="swatch"
                  role="radio"
                  aria-checked={sim.appearance[key] === color}
                  class:selected={sim.appearance[key] === color}
                  style="--c:{color}"
                  aria-label="{label} {color}"
                  onclick={() => setLook(key, color)}
                ></button>
              {/each}
            </div>
          {/snippet}
          {#snippet garments(key: 'top' | 'bottom' | 'shoes', parts: readonly string[], label: string)}
            <div class="chips-row" role="radiogroup" aria-label={label}>
              {#each parts as part (part)}
                <button class="pill" role="radio" aria-checked={sim.appearance[key] === part} class:on={sim.appearance[key] === part} onclick={() => setLook(key, part)}>
                  {garmentLabel(part)}
                </button>
              {/each}
            </div>
          {/snippet}
          <div class="field">
            <span class="eyebrow">Skin tone</span>
            {@render colors('skin', 'Skin tone')}
          </div>
          <div class="field">
            <span class="eyebrow">Hair</span>
            <Segmented
              label="Hairstyle"
              bind:value={sim.appearance.hairStyle}
              options={HAIR_STYLES.map((h) => ({ value: h, label: h === 'none' ? 'Bald' : h[0].toUpperCase() + h.slice(1) }))}
            />
            {@render colors('hair', 'Hair colour')}
            {#if wardrobe?.beard}
              <div class="chips-row" role="radiogroup" aria-label="Facial hair">
                <button class="pill" role="radio" aria-checked={!sim.appearance.beard} class:on={!sim.appearance.beard} onclick={() => setLook('beard', false)}>Clean-shaven</button>
                <button class="pill" role="radio" aria-checked={!!sim.appearance.beard} class:on={!!sim.appearance.beard} onclick={() => setLook('beard', true)}>Beard</button>
              </div>
            {/if}
          </div>
          <div class="field">
            <span class="eyebrow">Top</span>
            {#if wardrobe}{@render garments('top', wardrobe.tops, 'Top')}{/if}
            {@render colors('body', 'Top colour')}
          </div>
          <div class="field">
            <span class="eyebrow">Bottom</span>
            {#if wardrobe}{@render garments('bottom', wardrobe.bottoms, 'Bottom')}{/if}
            {@render colors('bottomColor', 'Bottom colour')}
          </div>
          <div class="field">
            <span class="eyebrow">Shoes</span>
            {#if wardrobe}{@render garments('shoes', wardrobe.shoes, 'Shoes')}{/if}
            {@render colors('shoesColor', 'Shoe colour')}
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
          <p class="hint">How {sim.name || 'this resident'} starts out with the rest of the household. Relationships keep changing in play.</p>
          {#each household.members.filter((m) => m.uid !== sim.uid) as other (other.uid)}
            {@const warning = bondWarning(other.uid)}
            <div class="field bond">
              <div class="bond-head">
                <span class="mini"><SimPreview appearance={lookAtAge(content, assets, other.appearance, other.age)} gender={other.gender} size={36} /></span>
                <b>{other.name || 'Unnamed'}</b>
              </div>
              <div class="bond-pick" role="radiogroup" aria-label="Bond with {other.name}">
                {#each bondOptions.filter((o) => o.value !== 'partners' || (content.isAdult(sim.age) && content.isAdult(other.age))) as o (o.value)}
                  <button class="pill" class:on={bondFor(other.uid) === o.value} onclick={() => setBond(household, sim.uid, other.uid, o.value)}>{o.label}</button>
                {/each}
              </div>
              {#if warning}<span class="hint small warn">{warning}</span>{/if}
              {#if familyNote(other.uid)}
                {@const note = familyNote(other.uid)!}
                <span class="hint small" class:warn={note.warn}>{note.text}</span>
              {/if}
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
  .input.age {
    width: 64px;
  }
  .age-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }
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
    grid-row: 3;
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
  /* The member count and "Add member" sit on the live 3D town: give them their own surface. */
  .members > .eyebrow {
    align-self: flex-start;
    padding: 5px 11px;
    border-radius: var(--radius-pill);
    background: var(--glass-menu);
    border: 1px solid var(--glass-menu-border);
    color: #3b4254;
    box-shadow: var(--shadow-sm);
    backdrop-filter: blur(14px);
    -webkit-backdrop-filter: blur(14px);
  }
  .add {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px;
    border-radius: var(--radius-md);
    border: 1.5px dashed rgba(29, 34, 48, 0.28);
    background: var(--glass-menu);
    color: #3b4254;
    font-weight: 650;
    box-shadow: var(--shadow-sm);
    backdrop-filter: blur(14px);
    -webkit-backdrop-filter: blur(14px);
  }
  .add:hover {
    border-color: var(--accent);
    color: var(--accent);
    background: #fff;
  }
  .stage {
    position: relative;
    min-height: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: flex-end;
  }
  .nameplate {
    position: relative;
    z-index: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    max-width: min(460px, 100%);
    padding: 12px 18px 14px;
    pointer-events: none;
  }
  .nameplate > * {
    pointer-events: auto;
  }
  h2 {
    margin: 0;
    font-size: 26px;
    letter-spacing: -0.03em;
    line-height: 1.15;
    text-align: center;
  }
  h2 span {
    color: var(--text-muted);
    font-weight: 500;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 6px;
  }
  .randomize {
    margin-top: 2px;
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
    gap: 20px;
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
  .row .hear {
    flex: 1;
  }
  .slider {
    display: flex;
    flex-direction: column;
    gap: 4px;
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
  .scale b {
    color: var(--text);
    font-weight: 600;
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
</style>
