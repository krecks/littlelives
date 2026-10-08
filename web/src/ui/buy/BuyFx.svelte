<script lang="ts">
  import { untrack } from 'svelte';
  import { settings } from '../../settings/settings.svelte';
  import { money } from '../format';
  import { services } from '../services';
  import { game } from '../state.svelte';

  /**
   * Buy and Build mode's pointer companions: a tag beside the cursor saying what a click will
   * do and cost (red where it can't), and the money each purchase or sale moves, floating up
   * from where it happened.
   */
  let x = $state(0);
  let y = $state(0);
  let onCanvas = $state(false);
  let floats = $state<{ id: number; amount: number; x: number; y: number }[]>([]);
  let nextId = 0;

  function move(e: PointerEvent) {
    // The HUD is zoomed by the UI scale; positions inside it are in its own pixels.
    const k = settings.uiScale || 1;
    x = e.clientX / k;
    y = e.clientY / k;
    onCanvas = e.target instanceof HTMLCanvasElement;
  }

  const tag = $derived.by((): { text: string; sub?: string; bad: boolean } | null => {
    if (game.mode === 'live' || !onCanvas) return null;
    const placing = game.placing;
    if (game.mode === 'buy') {
      if (!placing) return null;
      const def = services.content.object(placing.def);
      if (!def) return null;
      if (placing.objectId !== null) return { text: `Move ${def.name}`, sub: game.placeValid ? undefined : "Doesn't fit here", bad: !game.placeValid };
      const short = (def.price ?? 0) - game.funds;
      if (short > 0) return { text: def.name, sub: `${money(short)} short`, bad: true };
      return { text: money(def.price ?? 0), sub: game.placeValid ? def.name : "Doesn't fit here", bad: !game.placeValid };
    }
    const tool = game.buildTool;
    if (game.buildEdges === 0) return null;
    const cost = game.buildCost;
    const short = cost > game.funds;
    if (tool === 'paint') {
      const n = game.paintFaces;
      const cover = game.buildLook.cover;
      const label = cover ? (services.content.wallCoverings[cover - 1]?.label ?? '') : 'House default';
      const sub = `${label} · ${n} ${n === 1 ? 'face' : 'faces'}`;
      return short ? { text: `${money(cost - game.funds)} short`, sub, bad: true } : { text: cost ? money(cost) : 'Free', sub, bad: false };
    }
    if (tool === 'door' || tool === 'window') {
      const label = tool === 'door' ? 'Door' : 'Window';
      if (!game.buildValid) return { text: label, sub: short ? `${money(cost - game.funds)} short` : 'Needs a full-height wall', bad: true };
      return cost > 0 ? { text: money(cost), sub: label, bad: false } : null;
    }
    const n = game.buildEdges;
    const room = game.buildRoom;
    const what = tool === 'remove' ? `Tear down ${n} m` : room ? `${room[0]} × ${room[1]} room · ${n} m` : `${n} m of wall`;
    if (!game.buildValid) return { text: what, sub: short ? `${money(cost - game.funds)} short` : "Can't build here", bad: true };
    if (!game.buildStart) return cost > 0 ? { text: money(cost), sub: tool === 'remove' ? 'Drag to tear down' : tool === 'room' ? 'Drag out a room' : 'Drag to draw', bad: false } : null;
    return { text: cost > 0 ? money(cost) : 'Free', sub: what, bad: false };
  });

  // Money moved by an edit floats up from the pointer (time stands still in Buy mode, so the
  // funds only change through buying, selling and building).
  let lastFunds: number | null = null;
  $effect(() => {
    const funds = game.funds;
    const buying = game.mode !== 'live';
    const prev = lastFunds;
    lastFunds = funds;
    if (!buying || prev === null || funds === prev) return;
    const id = ++nextId;
    const k = settings.uiScale || 1;
    untrack(() => {
      const at = onCanvas ? { x, y } : { x: window.innerWidth / k / 2, y: window.innerHeight / k / 2 };
      floats = [...floats, { id, amount: funds - prev, ...at }];
    });
    setTimeout(() => (floats = floats.filter((f) => f.id !== id)), 1400);
  });
</script>

<svelte:window onpointermove={move} />

{#if tag}
  <div class="tag" class:bad={tag.bad} style="transform: translate({x + 18}px, {y + 14}px)">
    <b class="tabular">{tag.text}</b>
    {#if tag.sub}<span>{tag.sub}</span>{/if}
  </div>
{/if}
{#each floats as f (f.id)}
  <div class="float tabular" class:gain={f.amount > 0} style="left:{f.x}px;top:{f.y}px">{f.amount > 0 ? '+' : '−'}{money(Math.abs(f.amount))}</div>
{/each}

<style>
  .tag {
    position: fixed;
    left: 0;
    top: 0;
    display: flex;
    flex-direction: column;
    gap: 0;
    padding: 4px 9px 5px;
    border-radius: 10px;
    background: rgba(255, 255, 255, 0.94);
    box-shadow: 0 6px 18px rgba(24, 30, 50, 0.2);
    pointer-events: none;
    white-space: nowrap;
    font-size: 12px;
    z-index: 5;
  }
  .tag b {
    color: var(--good);
    font-size: 13px;
  }
  .tag span {
    color: var(--text-muted);
    font-size: 11px;
    font-weight: 600;
  }
  .tag.bad b,
  .tag.bad span {
    color: var(--bad);
  }
  .float {
    position: fixed;
    transform: translate(-50%, -100%);
    color: var(--bad);
    font-weight: 800;
    font-size: 17px;
    text-shadow:
      0 1px 0 #fff,
      0 0 8px rgba(255, 255, 255, 0.9);
    pointer-events: none;
    z-index: 6;
    animation: rise 1.4s var(--ease) forwards;
  }
  .float.gain {
    color: var(--good);
  }
  @keyframes rise {
    0% {
      opacity: 0;
      transform: translate(-50%, -60%) scale(0.6);
    }
    15% {
      opacity: 1;
      transform: translate(-50%, -120%) scale(1.15);
    }
    30% {
      transform: translate(-50%, -140%) scale(1);
    }
    100% {
      opacity: 0;
      transform: translate(-50%, -320%) scale(1);
    }
  }
</style>
