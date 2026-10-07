<script lang="ts">
  import { onMount } from 'svelte';
  import { deleteSave, listSaves, type SaveMeta } from '../../persistence/saves';
  import { settings } from '../../settings/settings.svelte';
  import { app } from '../app.svelte';
  import { clock, timeAgo } from '../format';
  import Icon from '../Icon.svelte';

  let saves = $state<SaveMeta[] | null>(null);
  let confirmDelete = $state<string | null>(null);
  let error = $state('');

  async function refresh() {
    try {
      saves = await listSaves();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      saves = [];
    }
  }

  async function remove(id: string) {
    await deleteSave(id);
    confirmDelete = null;
    await refresh();
  }

  onMount(refresh);
</script>

{#if app.screen === 'game'}
  <p class="notice">Loading replaces the current game. Unsaved progress will be lost.</p>
{/if}
{#if error}<p class="notice bad">{error}</p>{/if}

{#if saves === null}
  <p class="empty">Loading saves…</p>
{:else if saves.length === 0}
  <p class="empty">No saved games yet. Saves appear here after you save from the pause menu, or after an autosave.</p>
{:else}
  <ul>
    {#each saves as s (s.id)}
      <li>
        <div class="thumb">
          {#if s.thumbnail}<img src={s.thumbnail} alt="" />{/if}
        </div>
        <div class="info">
          <b>{s.name}</b>
          <span>{s.members.join(', ')}</span>
          <span class="when">Day {s.day} · {clock(s.minute, settings.clock24h)} · saved {timeAgo(s.savedAt)}</span>
        </div>
        <div class="actions">
          {#if confirmDelete === s.id}
            <button class="btn danger solid" onclick={() => remove(s.id)}>Delete</button>
            <button class="btn ghost" onclick={() => (confirmDelete = null)}>Keep</button>
          {:else}
            <button class="btn ghost" aria-label="Delete {s.name}" onclick={() => (confirmDelete = s.id)}>
              <Icon name="icon.ui.trash" size={16} />
            </button>
            <button class="btn primary" onclick={() => app.start({ kind: 'load', saveId: s.id })}>Load</button>
          {/if}
        </div>
      </li>
    {/each}
  </ul>
{/if}

<style>
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  li {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 10px;
    border-radius: var(--radius-lg);
    background: var(--surface);
    box-shadow: var(--shadow-sm);
  }
  .thumb {
    width: 112px;
    height: 70px;
    flex: none;
    border-radius: var(--radius-sm);
    overflow: hidden;
    background: linear-gradient(135deg, #dfe7f6, #f3e6da);
  }
  .thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
  .info {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .info span {
    color: var(--text-muted);
    font-size: 13px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .when {
    font-size: 12px !important;
  }
  .actions {
    display: flex;
    gap: 6px;
  }
  .empty {
    color: var(--text-muted);
    padding: 24px 0;
    text-align: center;
  }
  .notice {
    margin: 0 0 12px;
    padding: 10px 14px;
    border-radius: var(--radius-md);
    background: rgba(240, 181, 74, 0.16);
    color: #8a5e0c;
    font-weight: 550;
  }
  .notice.bad {
    background: rgba(236, 106, 92, 0.12);
    color: var(--bad);
  }
</style>
