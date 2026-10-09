<script lang="ts">
  import type { ObjectDef, TraitDef } from '../../content/content';
  import Icon from '../Icon.svelte';
  import { money } from '../format';
  import { services } from '../services';
  import { play } from '../sfx';
  import { game } from '../state.svelte';
  import { summarize } from './catalog';
  import Thumb from './Thumb.svelte';

  /** One catalog tile: a 3D picture, price, and what it boosts and trains at a glance. */
  let {
    def,
    model,
    affordable,
    active,
    category = null,
    owned = 0,
    lovers = [],
    collection = null,
    styles = 0,
    tint = 210,
    onpick,
    onpoint,
  }: {
    def: ObjectDef;
    /** Model key in the household's style (the picture follows the style chips). */
    model: string;
    affordable: boolean;
    /** Currently in hand. */
    active: boolean;
    /** Category label, shown when the list mixes categories (search results). */
    category?: string | null;
    /** How many the household already has. */
    owned?: number;
    /** First names of residents whose traits make them love it. */
    lovers?: string[];
    /** Personality collection it comes from. */
    collection?: TraitDef | null;
    /** How many styles it comes in (0: one design; the style chips don't change it). */
    styles?: number;
    /** Hue (degrees) of the picture's backdrop. */
    tint?: number;
    onpick: () => void;
    /** Pointed at or focused (the detail pane shows it). */
    onpoint: () => void;
  } = $props();

  const content = services.content;
  const info = $derived(summarize(content, def));
  /** A pack's own icon wins; otherwise a placeholder glyph until the 3D picture arrives. */
  const custom = $derived(def.icon && services.assets.has(def.icon, 'icon') ? def.icon : null);
  const glyph = $derived(info.boosts[0]?.need.icon ?? (info.trains[0] ? content.skill(info.trains[0].skill)?.icon : undefined) ?? 'icon.ui.buy');
  const short = $derived(game.creative ? 0 : Math.max(0, (def.price ?? 0) - game.funds));

  let popped = $state(false);
  let shake = $state(false);
  function pick() {
    if (!affordable) {
      play('error');
      shake = false;
      requestAnimationFrame(() => (shake = true));
      return;
    }
    popped = false;
    requestAnimationFrame(() => (popped = true));
    play('pick');
    onpick();
  }
  const lovesTitle = $derived(
    lovers.length === 0 ? '' : `${lovers.length === 1 ? lovers[0] : `${lovers.slice(0, -1).join(', ')} and ${lovers[lovers.length - 1]}`} will love this`,
  );
</script>

<button
  class="card"
  class:active
  class:poor={!affordable}
  class:pop={popped}
  class:shake
  style="--hue:{tint}"
  aria-disabled={!affordable}
  aria-label="{def.name}, {game.creative ? 'free' : money(def.price ?? 0)}{affordable ? '' : `, ${money(short)} short`}"
  title={affordable ? (def.description ?? def.name) : `${money(short)} short of ${def.name}`}
  onclick={pick}
  onanimationend={(e) => {
    if (e.animationName.includes('shake')) shake = false;
    if (e.animationName.includes('pop')) popped = false;
  }}
  onmouseenter={onpoint}
  onfocus={onpoint}
>
  <span class="stage">
    <span class="picture">
      {#if custom}<span class="custom"><Icon name={custom} size={40} /></span>{:else}<Thumb {model} footprint={def.footprint ?? [1, 1]} {glyph} />{/if}
    </span>
    <span class="corner left">
      {#if collection}<span class="badge coll" title="{collection.label} collection"><Icon name={collection.icon} size={11} /></span>{/if}
      {#if styles > 0}<span class="badge styled" title="Comes in {styles} styles"><Icon name="icon.skill.creativity" size={11} />{styles}</span>{/if}
      {#if owned > 0}<span class="badge owned" title="You have {owned}">×{owned}</span>{/if}
    </span>
    {#if lovers.length}<span class="badge love" title={lovesTitle}>♥</span>{/if}
    {#if active}<span class="hand">In hand</span>{/if}
    <span class="perks">
      {#each info.boosts.slice(0, 3) as b (b.need.id)}
        <span class="boost" title="{b.need.label} +{Math.round(b.perUse * 100)}% per use">
          <Icon name={b.need.icon} size={11} />
          <span class="bar"><span style="width:{Math.min(1, b.perUse) * 100}%"></span></span>
        </span>
      {/each}
      {#each info.trains.slice(0, 2) as t (t.skill)}
        <span class="skill" title="Trains {content.skill(t.skill)?.label ?? t.skill}"><Icon name={content.skill(t.skill)?.icon ?? ''} size={10} /></span>
      {/each}
      {#if info.feelings.length}<span class="feel" title="Can give a feeling: {info.feelings.map((f) => f.label).join(', ')}">✦</span>{/if}
    </span>
  </span>
  <span class="text">
    <span class="name">{def.name}</span>
    <span class="meta">
      <span class="price tabular">{game.creative ? 'Free' : money(def.price ?? 0)}</span>
      {#if !affordable}<span class="need tabular">{money(short)} short</span>
      {:else if info.useCost}<span class="use tabular" title="Costs money each time it's used">+{money(info.useCost.min)}/use</span>{/if}
      {#if info.slots > 1}<span class="slots" title="{info.slots} residents at once"><Icon name="icon.ui.relationships" size={11} />{info.slots}</span>{/if}
      {#if category}<span class="cat">{category}</span>{/if}
    </span>
  </span>
</button>

<style>
  .card {
    position: relative;
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    border-radius: 12px;
    background: var(--surface);
    box-shadow: var(--shadow-sm);
    text-align: left;
    overflow: hidden;
    transition:
      box-shadow var(--fast) var(--ease),
      transform 220ms var(--ease);
  }
  .card:hover {
    transform: translateY(-3px);
    box-shadow: var(--shadow-md);
  }
  .card:active {
    transform: translateY(0) scale(0.97);
  }
  .card.active {
    box-shadow:
      0 0 0 2px var(--accent),
      var(--shadow-md);
  }
  .card.pop {
    animation: pop 380ms var(--ease);
  }
  .card.shake {
    animation: shake 360ms ease;
  }
  .card.poor {
    cursor: not-allowed;
  }
  .card.poor .picture {
    filter: grayscale(0.85) opacity(0.55);
  }
  .card.poor .price {
    color: var(--bad);
  }

  .stage {
    position: relative;
    flex: 1;
    min-height: 0;
    background:
      radial-gradient(ellipse 70% 62% at 50% 46%, hsl(var(--hue) 70% 98%) 0%, hsl(var(--hue) 45% 92%) 70%, hsl(var(--hue) 35% 88%) 100%);
  }
  .picture {
    position: absolute;
    inset: 6px 8px 16px;
    transition: transform 320ms var(--ease);
  }
  .card:hover .picture {
    transform: scale(1.07) translateY(-2px) rotate(-1.5deg);
  }
  .custom {
    display: grid;
    place-items: center;
    width: 100%;
    height: 100%;
    color: hsl(var(--hue) 45% 45%);
  }
  .corner {
    position: absolute;
    top: 5px;
    display: flex;
    gap: 3px;
  }
  .corner.left {
    left: 5px;
  }
  .badge {
    display: inline-grid;
    place-items: center;
    min-width: 18px;
    height: 18px;
    padding: 0 4px;
    border-radius: var(--radius-pill);
    background: rgba(255, 255, 255, 0.85);
    box-shadow: 0 1px 3px rgba(24, 30, 50, 0.12);
    font-size: 10px;
    font-weight: 700;
    color: var(--text-muted);
  }
  .badge.styled {
    display: inline-flex;
    gap: 2px;
    color: var(--accent);
  }
  .badge.coll {
    color: hsl(var(--hue) 40% 40%);
  }
  .badge.love {
    position: absolute;
    top: 5px;
    right: 5px;
    color: #e0607e;
    font-size: 11px;
    animation: beat 1.6s ease-in-out infinite;
  }
  .hand {
    position: absolute;
    top: 6px;
    left: 50%;
    transform: translateX(-50%);
    padding: 1px 7px;
    border-radius: var(--radius-pill);
    background: var(--accent);
    color: var(--text-inverse);
    font-size: 10px;
    font-weight: 700;
    white-space: nowrap;
  }
  .perks {
    position: absolute;
    left: 5px;
    bottom: 4px;
    display: flex;
    align-items: center;
    gap: 4px;
    max-width: calc(100% - 10px);
    padding: 1px 5px;
    border-radius: var(--radius-pill);
    background: rgba(255, 255, 255, 0.78);
    color: var(--text-muted);
    font-size: 10px;
    overflow: hidden;
  }
  .perks:empty {
    display: none;
  }
  .boost {
    display: inline-flex;
    align-items: center;
    gap: 2px;
  }
  .bar {
    width: 14px;
    height: 3px;
    border-radius: 2px;
    background: var(--hairline);
    overflow: hidden;
  }
  .bar span {
    display: block;
    height: 100%;
    background: var(--good);
  }
  .skill {
    display: inline-grid;
    place-items: center;
    color: var(--accent);
  }
  .feel {
    color: #c17be0;
  }

  .text {
    flex: none;
    display: flex;
    flex-direction: column;
    gap: 1px;
    padding: 5px 8px 6px;
  }
  .name {
    font-weight: 650;
    font-size: 12px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .meta {
    display: flex;
    gap: 6px;
    align-items: center;
    font-size: 11px;
    white-space: nowrap;
    overflow: hidden;
  }
  .price {
    color: var(--good);
    font-weight: 700;
    font-size: 12px;
  }
  .use,
  .need {
    color: var(--text-muted);
    font-weight: 600;
  }
  .need {
    color: var(--bad);
  }
  .slots {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    color: var(--text-muted);
    font-weight: 650;
  }
  .cat {
    color: var(--text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
  }

  @keyframes pop {
    40% {
      transform: scale(1.06);
    }
  }
  @keyframes shake {
    20%,
    60% {
      transform: translateX(-4px);
    }
    40%,
    80% {
      transform: translateX(4px);
    }
  }
  @keyframes beat {
    0%,
    60%,
    100% {
      transform: scale(1);
    }
    30% {
      transform: scale(1.18);
    }
  }
</style>
