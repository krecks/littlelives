<script lang="ts">
  import type { RoomView } from '../core/protocol';
  import { ROOM_FACTORS, roomName, scoreColor, weakest } from '../game/roomOverlay';
  import Icon from './Icon.svelte';
  import { money } from './format';
  import { describeHomeWish } from './planner/homeWishes';
  import { services } from './services';
  import { game } from './state.svelte';

  /** Our home: every room of the house with its kind, size and scores, what the residents wish for it, and what's broken. */
  const content = services.content;
  const FACTOR_LABELS: Record<(typeof ROOM_FACTORS)[number], string> = { size: 'Size', light: 'Light', decor: 'Decor', clean: 'Tidy', function: 'Use' };

  const residents = $derived(game.sims.filter((s) => game.households[s.household]?.player));
  const rooms = $derived([...game.rooms].sort((a, b) => Number(a.garden) - Number(b.garden) || a.scores[5] - b.scores[5]));
  /** The house as a whole: rooms weighted by size. */
  const overall = $derived.by(() => {
    const inside = game.rooms.filter((r) => !r.garden);
    const tiles = inside.reduce((n, r) => n + r.tiles, 0);
    return tiles ? inside.reduce((n, r) => n + r.scores[5] * r.tiles, 0) / tiles : null;
  });

  const kindId = (r: RoomView) => (r.garden ? 'garden' : r.kind === undefined ? undefined : content.roomKinds[r.kind]?.id);
  const icon = (r: RoomView) => (r.garden ? 'icon.category.garden' : (r.kind !== undefined && content.roomKinds[r.kind]?.icon) || 'icon.ui.room');
  const color = (score: number) => {
    const [r, g, b] = scoreColor(score);
    return `rgb(${r * 255}, ${g * 255}, ${b * 255})`;
  };
  /** Who wishes what for rooms of this kind. */
  function wishesFor(r: RoomView): string[] {
    const id = kindId(r);
    const out = new Map<string, string[]>();
    for (const s of residents)
      for (const w of s.plan?.homeWishes ?? [])
        if (w.factor && w.room === id) {
          const text = describeHomeWish(content, w).text;
          out.set(text, [...(out.get(text) ?? []), s.name]);
        }
    return [...out].map(([text, names]) => `${names.join(' & ')}: ${text.toLowerCase()}`);
  }
  /** Other wishes (another room) with who has them. */
  const otherWishes = $derived.by(() => {
    const out = new Map<string, string[]>();
    for (const s of residents)
      for (const w of s.plan?.homeWishes ?? [])
        if (w.another) {
          const text = describeHomeWish(content, w).text;
          out.set(text, [...(out.get(text) ?? []), s.name]);
        }
    return [...out];
  });
  function notes(r: RoomView): string[] {
    const out: string[] = [];
    if (r.mixed) out.push('Two rooms in one');
    const kind = r.kind === undefined ? undefined : content.roomKinds[r.kind];
    if (kind && r.missing !== undefined) out.push(`Missing something for ${(kind.essentials?.[r.missing] ?? []).join(' or ')}`);
    if (!r.garden && r.kind === undefined) out.push('Nothing in it says what it is for');
    if (r.dirt >= 0.3) out.push('Needs tidying');
    return out;
  }
  const home = $derived.by(() => {
    const plot = game.households[game.home]?.plot;
    return plot == null ? null : game.plots[plot];
  });
  const broken = $derived(
    home ? game.objects.filter((o) => (o.wear ?? 0) >= 1 && o.x >= home.x && o.z >= home.z && o.x < home.x + home.w && o.z < home.z + home.d) : [],
  );

  function showPlan() {
    game.homeOpen = false;
    services.controls.setMode('build');
    services.controls.toggleRoomScores(true);
  }
</script>

{#if game.homeOpen}
  <aside class="home glass" aria-label="Our home">
    <header>
      <Icon name="icon.need.environment" size={18} />
      <b>Our home</b>
      {#if overall !== null}<span class="total tabular" style="--c:{color(overall)}" title="The house as a whole">{Math.round(overall * 100)}</span>{/if}
      <button class="close" aria-label="Close (O)" onclick={() => (game.homeOpen = false)}><Icon name="icon.ui.close" size={14} /></button>
    </header>
    <button class="btn small" onclick={showPlan}>See it on the floor plan</button>
    <div class="rooms">
      {#if broken.length}
        <section class="broken">
          <h3>Broken</h3>
          {#each broken as o (o.id)}
            {@const def = content.object(o.def)}
            <div class="row">
              <span>{def?.name ?? o.def}</span>
              <button class="btn small primary" onclick={() => services.controls.repair(o.id)}>
                {game.creative || o.repairCost === undefined ? 'Repair' : `Repair · ${money(o.repairCost)}`}
              </button>
            </div>
          {/each}
          <p class="muted">Broken things don't work. Residents fix them in time, or pay for a quick fix.</p>
        </section>
      {/if}
      {#each otherWishes as [text, names] (text)}
        <section class="wish"><b>{text}</b><span class="muted">{names.join(' & ')} found it taken when they needed it</span></section>
      {/each}
      {#each rooms as r (`${r.garden}:${r.id}`)}
        {@const weak = weakest(r)}
        <section class="room">
          <div class="head">
            <span class="icon" style="--c:{color(r.scores[5])}"><Icon name={icon(r)} size={15} /></span>
            <b>{roomName(content, r)}</b>
            <span class="muted tabular">{Math.round(r.tiles)} m²</span>
            <span class="score tabular" style="--c:{color(r.scores[5])}">{Math.round(r.scores[5] * 100)}</span>
          </div>
          <div class="factors">
            {#each ROOM_FACTORS as f, i (f)}
              <span class="factor" class:weak={weak === f} title="{FACTOR_LABELS[f]}: {Math.round(r.scores[i] * 100)}">
                <small>{FACTOR_LABELS[f]}</small>
                <span class="bar"><span style="width:{r.scores[i] * 100}%; background:{color(r.scores[i])}"></span></span>
              </span>
            {/each}
          </div>
          {#if !r.garden}
            <small class="muted">{r.windows} {r.windows === 1 ? 'window' : 'windows'} · {r.lamps} {r.lamps === 1 ? 'lamp' : 'lamps'}{r.dirt > 0.05 ? ` · ${Math.round(r.dirt * 100)}% dirty` : ''}</small>
          {/if}
          {#each notes(r) as note (note)}<small class="note">{note}</small>{/each}
          {#each wishesFor(r) as wish (wish)}<small class="wished">{wish}</small>{/each}
        </section>
      {:else}
        <p class="empty">No rooms yet. Build walls around a space and it becomes a room.</p>
      {/each}
    </div>
  </aside>
{/if}

<style>
  .home {
    position: absolute;
    top: 80px;
    right: var(--edge);
    bottom: var(--edge);
    width: 340px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 14px;
    pointer-events: auto;
    animation: enter var(--slow) var(--ease);
  }
  header {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  header b {
    flex: 1;
    font-size: 15px;
  }
  .total,
  .score {
    min-width: 30px;
    padding: 2px 7px;
    border-radius: 99px;
    text-align: center;
    font-weight: 700;
    font-size: 12px;
    color: #fff;
    background: var(--c);
  }
  .close {
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    border-radius: var(--radius-sm);
    color: var(--text-muted);
  }
  .close:hover {
    background: var(--accent-soft);
    color: var(--accent);
  }
  .rooms {
    flex: 1;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin: 0 -6px;
    padding: 0 6px 6px;
  }
  section {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 10px;
    border-radius: var(--radius-sm);
    background: var(--surface);
    box-shadow: var(--shadow-sm);
    font-size: 12.5px;
  }
  .broken {
    background: color-mix(in srgb, var(--bad) 10%, var(--surface));
  }
  .wish {
    background: var(--accent-soft);
    box-shadow: none;
    gap: 2px;
  }
  h3 {
    margin: 0;
    font-size: 11px;
    font-weight: 650;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-muted);
  }
  .row,
  .head {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .row span,
  .head b {
    flex: 1;
  }
  .icon {
    display: grid;
    place-items: center;
    width: 26px;
    height: 26px;
    flex: none;
    border-radius: 8px;
    background: color-mix(in srgb, var(--c) 18%, transparent);
    color: var(--c);
  }
  .factors {
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    gap: 6px;
  }
  .factor {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .factor small {
    font-size: 10.5px;
    color: var(--text-muted);
  }
  .factor.weak small {
    color: var(--text);
    font-weight: 650;
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
    transition: width var(--slow) var(--ease);
  }
  .note {
    color: var(--bad);
  }
  .wished {
    color: var(--accent);
  }
  .muted {
    color: var(--text-muted);
  }
  p.muted {
    margin: 0;
    font-size: 11.5px;
  }
  .empty {
    margin: 24px 6px;
    color: var(--text-muted);
    font-size: 13px;
  }
  @keyframes enter {
    from {
      opacity: 0;
      transform: translateX(16px);
    }
  }
</style>
