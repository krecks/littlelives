<script lang="ts">
  import type { ObjectDef } from '../../content/content';
  import type { ObjectPlacement } from '../../core/protocol';
  import Icon from '../Icon.svelte';
  import { money } from '../format';
  import { services } from '../services';
  import { game } from '../state.svelte';
  import { collectionOf, duration, loversOf, percent, styledModel, styleOptions, summarize } from './catalog';
  import Thumb from './Thumb.svelte';
  import Turntable from './Turntable.svelte';

  /** Everything an item is worth to the household; with `owned`, also upgrade/move/restyle/sell. */
  let { def, owned = null }: { def: ObjectDef; owned?: ObjectPlacement | null } = $props();

  const content = services.content;
  const info = $derived(summarize(content, def));
  const rules = $derived(game.catalog?.objectRules);
  const price = $derived(def.price ?? 0);
  const short = $derived(owned ? 0 : Math.max(0, price - game.funds));
  const category = $derived(content.buyCategories.find((c) => c.id === def.category)?.label);
  const collection = $derived(collectionOf(content, def));
  const model = $derived(styledModel(content, services.assets, def, owned ? owned.style : game.householdStyle));
  const glyph = $derived(info.boosts[0]?.need.icon ?? 'icon.ui.buy');
  const residents = $derived(game.roster.filter((s) => game.households[s.household]?.player));
  const lovers = $derived(loversOf(content, def, residents));
  /** The designs it comes in; picking one restyles it (owned) or sets the style for new purchases. */
  const styles = $derived(styleOptions(content, services.assets, def));
  const currentStyle = $derived(owned ? owned.style : game.householdStyle);
  function pickStyle(i: number) {
    if (owned) services.controls.restyle(owned.id, i);
    else services.controls.setHouseholdStyle(i);
  }
  const sim = $derived(game.selectedSim);
  const skillLabel = (id: string) => content.skill(id)?.label ?? id;
  const skillIcon = (id: string) => content.skill(id)?.icon ?? '';
  /** The selected Sim's whole level in a skill. */
  const level = (id: string) => {
    const i = content.skills.findIndex((s) => s.id === id);
    return sim && i >= 0 ? Math.floor(sim.skills[i] ?? 0) : null;
  };
  const stars = (q: number, max: number) => '★'.repeat(q) + '☆'.repeat(Math.max(0, max - q));
  /** Upgrades are bought here in Buy mode; each ★ adds `qualityBonus` to everything the object gives. */
  const upgradable = $derived(!!rules && def.price !== undefined && rules.maxQuality > 0);
  const quality = $derived(owned?.quality ?? 0);
  const factor = $derived(rules ? 1 + rules.qualityBonus * quality : 1);
  const upgradeCost = $derived(rules ? Math.round(price * rules.upgradeCost) : 0);
  /** Bills grow with what the household owns, so new things (and upgrades) raise them a little. */
  const billsRate = content.economy.rent?.billsRate ?? 0;
  const addedBills = $derived(Math.round((owned ? upgradeCost : price) * billsRate));
  const upgradeBlocker = $derived(
    !owned || !rules
      ? null
      : quality >= rules.maxQuality
        ? 'Already top quality'
        : upgradeCost > game.funds
          ? `Can't afford — ${money(upgradeCost - game.funds)} short`
          : null,
  );
</script>

<div class="detail">
  {#if !(def.icon && services.assets.has(def.icon, 'icon'))}
    <Turntable {model} footprint={def.footprint ?? [1, 1]} {glyph} compact={!!owned} />
  {/if}
  <div class="head">
    <div>
      <b class="name">{def.name}</b>
      {#if category}<span class="eyebrow">{category}</span>{/if}
    </div>
    {#if owned}
      {#if owned.sellValue !== null}<span class="price tabular" title="What selling returns">worth {money(owned.sellValue)}</span>{/if}
    {:else}
      <span class="price tabular" class:short={short > 0}>{money(price)}</span>
    {/if}
  </div>
  {#if short > 0}<p class="warn">Can't afford — {money(short)} short</p>{/if}
  {#if def.description}<p class="desc">{def.description}</p>{/if}
  {#if lovers.length || collection}
    <div class="chips">
      {#if lovers.length}
        <span class="chip love">♥ {lovers.length === 1 ? lovers[0] : `${lovers.slice(0, -1).join(', ')} & ${lovers[lovers.length - 1]}`} will love it</span>
      {/if}
      {#if collection}<span class="chip coll" title={collection.description}><Icon name={collection.icon} size={12} />{collection.label} collection</span>{/if}
    </div>
  {/if}
  {#if addedBills > 0 && (!owned || (upgradable && rules && quality < rules.maxQuality))}
    <p class="desc tabular">{owned ? 'Each upgrade adds' : 'Adds'} about {money(addedBills)}/wk to your bills</p>
  {/if}

  {#if styles.length}
    <h4>Comes in {styles.length} styles <small>{owned ? 'restyle it for free' : 'same price and quality'}</small></h4>
    <div class="looks" role="radiogroup" aria-label="Style">
      {#each styles as i (i)}
        <button role="radio" aria-checked={currentStyle === i} class:active={currentStyle === i} title={content.styles[i].label} onclick={() => pickStyle(i)}>
          <span class="look"><Thumb model={styledModel(content, services.assets, def, i)} footprint={def.footprint ?? [1, 1]} {glyph} size={14} /></span>
          <span>{content.styles[i].label}</span>
        </button>
      {/each}
    </div>
  {/if}

  {#if upgradable && rules}
    <div class="quality">
      <span class="stars" title="Quality {quality} of {rules.maxQuality}">{stars(quality, rules.maxQuality)}</span>
      <span class="muted">Each ★ +{Math.round(rules.qualityBonus * 100)}% to everything it gives · {money(upgradeCost)} per ★</span>
      {#if owned}
        <button
          class="btn small upgrade"
          disabled={upgradeBlocker !== null}
          title={upgradeBlocker ?? `Makes it ${Math.round(rules.qualityBonus * 100)}% better, right away`}
          onclick={() => services.controls.upgrade(owned.id)}
        >
          <Icon name="icon.ui.upgrade" size={14} />
          {quality >= rules.maxQuality ? 'Top quality' : `Upgrade to ★${quality + 1} · ${money(upgradeCost)}`}
        </button>
        {#if upgradeBlocker && quality < rules.maxQuality}<small class="reason">{upgradeBlocker}</small>{/if}
      {/if}
    </div>
  {/if}

  {#if owned}
    <div class="owned">
      <div class="row">
        <button class="btn ghost small" onclick={() => services.controls.startMoving(owned.id)}>Move</button>
        <button class="btn ghost small" title="Rotate (R)" onclick={() => services.controls.rotatePlacing()}>Rotate</button>
        {#if owned.sellValue !== null}
          <button class="btn ghost small danger" title="Sell (Delete)" onclick={() => services.controls.sell(owned.id)}>Sell · {money(owned.sellValue)}</button>
        {/if}
      </div>
    </div>
  {/if}

  {#if info.boosts.length || info.drains.length}
    <h4>Boosts <small>per use{factor > 1 ? ` · incl. ★ bonus` : ''}</small></h4>
    <ul class="needs">
      {#each info.boosts as b (b.need.id)}
        <li title="{b.need.label}: {percent(b.perUse * factor)} per use, {percent(b.perHour * factor)} per hour">
          <Icon name={b.need.icon} size={14} />
          <span class="label">{b.need.label}</span>
          <span class="bar"><span style="width:{Math.min(1, b.perUse * factor) * 100}%"></span></span>
          <span class="num tabular">{percent(b.perUse * factor)}<small> · {percent(b.perHour * factor)}/h</small></span>
        </li>
      {/each}
      {#each info.drains as b (b.need.id)}
        <li class="drain" title="{b.need.label}: {percent(b.perUse)} per use">
          <Icon name={b.need.icon} size={14} />
          <span class="label">{b.need.label}</span>
          <span class="bar"><span style="width:{Math.min(1, -b.perUse) * 100}%"></span></span>
          <span class="num tabular">{percent(b.perUse)}</span>
        </li>
      {/each}
    </ul>
  {/if}

  {#if info.trains.length}
    <h4>Trains</h4>
    <div class="chips">
      {#each info.trains as t (t.skill)}
        <span class="chip skill" title="+{+(t.perHour * factor).toFixed(2)} {skillLabel(t.skill)} levels per hour"><Icon name={skillIcon(t.skill)} size={12} />{skillLabel(t.skill)}</span>
      {/each}
    </div>
  {/if}

  {#if info.betterWith.length}
    <div class="chips">
      {#each info.betterWith as s (s)}
        {@const lv = level(s)}
        <span class="chip better" title="Residents with more {skillLabel(s)} get more out of it">
          <Icon name={skillIcon(s)} size={12} />Better with {skillLabel(s)}{#if lv !== null && sim}<small> · {sim.name.split(' ')[0]} {lv}</small>{/if}
        </span>
      {/each}
    </div>
  {/if}

  {#if info.feelings.length}
    <h4>Can make them feel</h4>
    <div class="chips">
      {#each info.feelings as f (f.id)}
        {@const lv = f.skill ? level(f.skill) : null}
        <span class="chip feel" class:locked={lv !== null && lv < f.minSkill} title="From “{f.from}”">
          {#if f.icon}<Icon name={f.icon} size={12} />{:else}✦{/if}{f.label}
          {#if f.skill && f.minSkill}<small>· needs {skillLabel(f.skill)} {f.minSkill}</small>{/if}
        </span>
      {/each}
    </div>
  {/if}

  {#if info.actions.length}
    <h4>Things to do</h4>
    <ul class="actions">
      {#each info.actions as a, i (i)}
        <li>
          <span class="label">{a.label}</span>
          {#if a.skill}<span class="skillmark" title="Better with {skillLabel(a.skill)}"><Icon name={skillIcon(a.skill)} size={11} /></span>{/if}
          <span class="muted tabular">{duration(a.minutes)}</span>
          {#if a.cost > 0}<span class="cost tabular" class:short={a.cost > game.funds}>{money(a.cost)} per use</span>{/if}
        </li>
      {/each}
    </ul>
  {/if}

  {#if info.slots > 1}<p class="facts">Fits {info.slots} residents at once</p>{/if}

</div>

<style>
  .detail {
    display: flex;
    flex-direction: column;
    gap: 6px;
    font-size: 12px;
  }
  .head {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 8px;
  }
  .head > div {
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .name {
    font-size: 14px;
  }
  .price {
    color: var(--good);
    font-weight: 700;
    font-size: 14px;
    white-space: nowrap;
  }
  .short {
    color: var(--bad) !important;
  }
  p {
    margin: 0;
  }
  .warn {
    color: var(--bad);
    font-weight: 600;
  }
  .desc {
    color: var(--text-muted);
    line-height: 1.35;
  }
  h4 {
    margin: 4px 0 0;
    font-size: 11px;
    font-weight: 650;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--text-muted);
  }
  h4 small {
    text-transform: none;
    letter-spacing: 0;
    font-weight: 500;
  }
  ul {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .needs li {
    display: grid;
    grid-template-columns: 14px 64px 1fr auto;
    align-items: center;
    gap: 6px;
  }
  .bar {
    height: 6px;
    border-radius: 3px;
    background: var(--hairline);
    overflow: hidden;
  }
  .bar span {
    display: block;
    height: 100%;
    border-radius: 3px;
    background: var(--good);
  }
  .drain .bar span {
    background: var(--bad);
  }
  .drain {
    color: var(--text-muted);
  }
  .num {
    font-weight: 650;
    white-space: nowrap;
  }
  .num small {
    color: var(--text-muted);
    font-weight: 500;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 8px;
    border-radius: var(--radius-pill);
    background: var(--hairline);
    font-weight: 600;
    font-size: 11px;
  }
  .chip small {
    font-weight: 500;
    opacity: 0.8;
  }
  .chip.skill {
    background: var(--accent-soft);
    color: var(--accent);
  }
  .chip.better {
    background: rgba(240, 181, 74, 0.2);
    color: #9a6a10;
  }
  .chip.feel {
    background: rgba(193, 123, 224, 0.16);
    color: #8a44ad;
  }
  .chip.love {
    background: rgba(224, 96, 126, 0.14);
    color: #c2405f;
  }
  .chip.coll {
    color: var(--text-muted);
  }
  .chip.feel.locked {
    opacity: 0.6;
  }
  .looks {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(78px, 1fr));
    gap: 6px;
  }
  .looks button {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    padding: 4px 4px 5px;
    border-radius: var(--radius-sm);
    background: var(--surface-muted);
    font-size: 11px;
    font-weight: 650;
    color: var(--text-muted);
    transition: box-shadow var(--fast) var(--ease), transform 200ms var(--ease);
  }
  .looks button:hover {
    transform: translateY(-1px);
  }
  .looks button.active {
    color: var(--accent);
    box-shadow: 0 0 0 2px var(--accent);
    background: var(--surface);
  }
  .look {
    width: 100%;
    height: 52px;
  }
  .actions li {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .actions .label {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .skillmark {
    display: inline-grid;
    color: #9a6a10;
  }
  .muted {
    color: var(--text-muted);
  }
  .cost {
    font-weight: 650;
    color: var(--text);
    white-space: nowrap;
  }
  .facts {
    display: flex;
    flex-direction: column;
    gap: 2px;
    color: var(--text-muted);
    font-size: 11px;
  }
  .owned {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding-bottom: 6px;
    border-bottom: 1px solid var(--hairline);
  }
  .stars {
    color: #e0a526;
    letter-spacing: 2px;
    font-size: 14px;
  }
  .quality {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 4px;
    padding: 6px 8px;
    border-radius: var(--radius-sm);
    background: rgba(224, 165, 38, 0.1);
  }
  .quality .muted {
    font-size: 11px;
  }
  .upgrade {
    height: 28px;
    padding: 0 10px;
    font-size: 12px;
    color: #9a6a10;
  }
  .reason {
    color: var(--bad);
    font-size: 11px;
    font-weight: 600;
  }
  .row {
    display: flex;
    gap: 4px;
    flex-wrap: wrap;
  }
  .small {
    height: 28px;
    padding: 0 10px;
    font-size: 12px;
  }
</style>
