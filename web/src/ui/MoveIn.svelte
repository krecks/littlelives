<script lang="ts">
  import type { HouseholdDraft } from '../game/household';
  import CreateHousehold from './screens/CreateHousehold.svelte';
  import { services } from './services';
  import { game } from './state.svelte';

  /** "Move a family in": the household creator over the paused game, for a home nobody lives in yet. */
  const neighbours = game.households.filter((h) => !h.player).map((h) => h.name);
  const address = game.plots[game.households.find((h) => h.player)?.plot ?? -1]?.name;

  function moveIn(household: HouseholdDraft) {
    services.controls.moveIn(household);
  }
</script>

<div class="move-in">
  <CreateHousehold
    eyebrow={address ? `Moving in · ${address}` : 'Moving in'}
    backLabel="Not yet"
    nextLabel="Move in →"
    avoidNames={neighbours}
    draft={null}
    onback={() => (game.moveInOpen = false)}
    onnext={moveIn}
  />
</div>

<style>
  /* Over the game (and its interface), which shows dimmed behind the creator. */
  .move-in {
    position: fixed;
    inset: 0;
    z-index: 40;
    background: linear-gradient(180deg, rgba(243, 230, 210, 0.82), rgba(217, 203, 184, 0.9));
    backdrop-filter: blur(6px);
  }
</style>
