<script lang="ts">
  import type { ObjectDef } from '../../content/content';
  import Icon from '../Icon.svelte';
  import { money } from '../format';
  import { services } from '../services';
  import { summarize } from './catalog';

  /** One catalog entry: price, what it boosts and trains, at a glance. */
  let {
    def,
    affordable,
    active,
    category = null,
    onpick,
    onhover,
  }: {
    def: ObjectDef;
    affordable: boolean;
    /** Currently in hand. */
    active: boolean;
    /** Category label, shown when the list mixes categories (search results). */
    category?: string | null;
    onpick: () => void;
    onhover: (on: boolean) => void;
  } = $props();

  const content = services.content;
  const info = $derived(summarize(content, def));
  const glyph = $derived(
    def.icon && services.assets.get(def.icon, 'icon')
      ? def.icon
      : (info.boosts[0]?.need.icon ?? (info.trains[0] ? content.skill(info.trains[0].skill)?.icon : undefined) ?? 'icon.ui.buy'),
  );
</script>

<button
  class="card"
  class:active
  class:poor={!affordable}
  aria-disabled={!affordable}
  title={affordable ? (def.description ?? def.name) : `Can't afford ${def.name} yet`}
  onclick={() => affordable && onpick()}
  onmouseenter={() => onhover(true)}
  onmouseleave={() => onhover(false)}
  onfocus={() => onhover(true)}
  onblur={() => onhover(false)}
>
  <span class="glyph"><Icon name={glyph} size={20} /></span>
  <span class="text">
    <span class="name">{def.name}</span>
    <span class="meta">
      <span class="price tabular">{money(def.price ?? 0)}</span>
      {#if info.useCost}<span class="use tabular" title="Costs money each time it's used">+{money(info.useCost.min)}/use</span>{/if}
      {#if category}<span class="cat">{category}</span>{/if}
    </span>
    <span class="perks">
      {#each info.boosts.slice(0, 3) as b (b.need.id)}
        <span class="boost" title="{b.need.label} +{Math.round(b.perUse * 100)}% per use">
          <Icon name={b.need.icon} size={12} />
          <span class="bar"><span style="width:{Math.min(1, b.perUse) * 100}%"></span></span>
        </span>
      {/each}
      {#each info.trains.slice(0, 2) as t (t.skill)}
        <span class="skill" title="Trains {content.skill(t.skill)?.label ?? t.skill}"><Icon name={content.skill(t.skill)?.icon ?? ''} size={11} /></span>
      {/each}
      {#if info.feelings.length}<span class="feel" title="Can give a feeling: {info.feelings.map((f) => f.label).join(', ')}">✦</span>{/if}
      {#if info.slots > 1}<span class="slots" title="{info.slots} residents at once">×{info.slots}</span>{/if}
    </span>
  </span>
</button>

<style>
  .card {
    width: 100%;
    height: 100%;
    display: flex;
    gap: 8px;
    align-items: flex-start;
    padding: 8px 9px;
    border-radius: var(--radius-sm);
    background: var(--surface);
    box-shadow: var(--shadow-sm);
    text-align: left;
    transition: box-shadow var(--fast) var(--ease), transform var(--fast) var(--ease), opacity var(--fast) var(--ease);
  }
  .card:hover {
    transform: translateY(-1px);
    box-shadow: var(--shadow-md);
  }
  .card.active {
    box-shadow: 0 0 0 2px var(--accent);
  }
  .card.poor {
    cursor: not-allowed;
  }
  .card.poor .glyph,
  .card.poor .name,
  .card.poor .perks {
    opacity: 0.5;
  }
  .card.poor .price {
    color: var(--bad);
  }
  .glyph {
    flex: none;
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    border-radius: 9px;
    background: var(--accent-soft);
    color: var(--accent);
  }
  .text {
    min-width: 0;
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .name {
    font-weight: 650;
    font-size: 13px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .meta {
    display: flex;
    gap: 6px;
    align-items: baseline;
    font-size: 12px;
    white-space: nowrap;
    overflow: hidden;
  }
  .price {
    color: var(--good);
    font-weight: 650;
  }
  .use {
    color: var(--text-muted);
    font-size: 11px;
    font-weight: 600;
  }
  .cat {
    color: var(--text-muted);
    font-size: 11px;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .perks {
    display: flex;
    align-items: center;
    gap: 5px;
    min-height: 14px;
    color: var(--text-muted);
    font-size: 11px;
  }
  .boost {
    display: inline-flex;
    align-items: center;
    gap: 2px;
  }
  .bar {
    width: 18px;
    height: 4px;
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
    width: 18px;
    height: 16px;
    border-radius: var(--radius-pill);
    background: var(--accent-soft);
    color: var(--accent);
  }
  .feel {
    color: #c17be0;
    font-size: 12px;
  }
  .slots {
    font-weight: 650;
  }
</style>
