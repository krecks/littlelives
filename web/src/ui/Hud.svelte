<script lang="ts">
  import NeedsPanel from './NeedsPanel.svelte';
  import PerfOverlay from './PerfOverlay.svelte';
  import PieMenu from './PieMenu.svelte';
  import SimPanel from './SimPanel.svelte';
  import EventFeed from './EventFeed.svelte';
  import JobBoard from './JobBoard.svelte';
  import SocialMenu from './SocialMenu.svelte';
  import TopBar from './TopBar.svelte';
  import TownPanel from './TownPanel.svelte';
  import BuyPanel from './BuyPanel.svelte';
  import { game } from './state.svelte';
</script>

<div class="hud">
  <TopBar />
  {#if game.mode === 'live'}
    <SimPanel />
    <NeedsPanel />
  {/if}
  <BuyPanel />
  <PerfOverlay />
  <EventFeed />
  <PieMenu />
  <SocialMenu />
  <TownPanel />
  <JobBoard />
</div>

<style>
  /* Children opt in to pointer events; everything else lets clicks reach the 3D view. */
  .hud {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }
</style>
