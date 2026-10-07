<script lang="ts">
  import Icon from './Icon.svelte';
  import { needColor } from './format';
  import { services } from './services';
  import { game } from './state.svelte';

  const needs = services.content.needs;
</script>

{#if game.selectedSim}
  {@const values = game.selectedSim.needs}
  <section class="needs glass">
    <h2>Needs</h2>
    <div class="grid">
      {#each needs as need, i (need.id)}
        <div class="need" title="{need.label}: {Math.round(values[i] * 100)}%">
          <Icon name={need.icon} size={18} />
          <div class="meta">
            <span class="label">{need.label}</span>
            <span class="bar"><span style="width:{values[i] * 100}%;background:{needColor(values[i])}"></span></span>
          </div>
        </div>
      {/each}
    </div>
  </section>
{/if}

<style>
  .needs {
    position: absolute;
    right: var(--edge);
    bottom: var(--edge);
    width: 360px;
    padding: 14px 16px 16px;
    pointer-events: auto;
  }
  h2 {
    margin: 0 0 10px;
    font-size: 11px;
    font-weight: 650;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-muted);
  }
  .grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px 16px;
  }
  .need {
    display: flex;
    align-items: center;
    gap: 10px;
    color: var(--text-muted);
  }
  .meta {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 5px;
  }
  .label {
    font-weight: 550;
    color: var(--text);
    font-size: 13px;
  }
  .bar {
    height: 6px;
    border-radius: var(--radius-pill);
    background: var(--hairline);
    overflow: hidden;
  }
  .bar span {
    display: block;
    height: 100%;
    border-radius: inherit;
    transition: width var(--slow) linear, background var(--slow) var(--ease);
  }
</style>
