<script lang="ts">
  import { blueprints, removeBlueprint } from '../../persistence/blueprints.svelte';
  import Icon from '../Icon.svelte';
  import { services } from '../services';
  import { play } from '../sfx';
  import { game } from '../state.svelte';

  /** Build mode's Blueprints: keep the house as a blueprint, or build a saved one on an empty lot. */
  const household = $derived(game.households[game.home]);
  let name = $state('');
  let saving = $state(false);

  async function save() {
    saving = true;
    play('tab');
    try {
      await services.controls.saveBlueprint(name.trim() || `The ${household?.name ?? 'new'} house`);
      name = '';
    } finally {
      saving = false;
    }
  }

  function build(id: string) {
    play('tab');
    services.controls.buildBlueprint(id);
  }

  function remove(id: string) {
    play('close');
    removeBlueprint(id);
  }

  const date = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
</script>

<div class="blueprints">
  <form
    class="save"
    onsubmit={(e) => {
      e.preventDefault();
      void save();
    }}
  >
    <input class="input" bind:value={name} maxlength="32" placeholder={`The ${household?.name ?? 'new'} house`} aria-label="Blueprint name" />
    <button class="btn" type="submit" disabled={saving}><Icon name="icon.ui.save" size={16} /> Save this house</button>
  </form>
  {#if blueprints.list.length}
    <ul class="list">
      {#each blueprints.list as bp (bp.id)}
        <li class="card">
          {#if bp.thumbnail}<img src={bp.thumbnail} alt="" />{:else}<span class="blank"><Icon name="icon.ui.blueprint" size={28} /></span>{/if}
          <div class="text">
            <b>{bp.name}</b>
            <small>{bp.w} × {bp.d} m lot · {bp.walls} walls · {bp.things} {bp.things === 1 ? 'thing' : 'things'} · {date(bp.date)}</small>
          </div>
          <div class="actions">
            <button class="btn build" title="Build it on your lot (it has to be empty)" onclick={() => build(bp.id)}>Build here</button>
            <button class="icon" title="Delete this blueprint" aria-label="Delete {bp.name}" onclick={() => remove(bp.id)}><Icon name="icon.ui.trash" size={16} /></button>
          </div>
        </li>
      {/each}
    </ul>
  {:else}
    <p class="muted">No blueprints yet. Saved houses stay in this browser, for any game.</p>
  {/if}
</div>

<style>
  .blueprints {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .save {
    display: flex;
    gap: 8px;
  }
  .save .input {
    flex: 1;
    min-width: 0;
  }
  .list {
    margin: 0;
    padding: 0 0 4px;
    list-style: none;
    display: flex;
    gap: 8px;
    overflow-x: auto;
  }
  .card {
    flex: none;
    width: 220px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px;
    border-radius: var(--radius-sm);
    background: var(--surface);
  }
  img,
  .blank {
    width: 100%;
    aspect-ratio: 16 / 10;
    border-radius: 6px;
    object-fit: cover;
    background: var(--hairline);
  }
  .blank {
    display: grid;
    place-items: center;
    color: var(--text-muted);
  }
  .text {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .text b {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  small,
  .muted {
    color: var(--text-muted);
    font-size: 11px;
  }
  .muted {
    margin: 0;
    font-size: 12px;
  }
  .actions {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .build {
    height: 30px;
    padding: 0 12px;
    font-size: 12px;
  }
  .icon {
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    border-radius: 50%;
    color: var(--text-muted);
  }
  .icon:hover {
    color: var(--bad);
    background: var(--hairline);
  }
</style>
