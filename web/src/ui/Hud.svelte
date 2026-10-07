<script lang="ts">
  import NeedsPanel from './NeedsPanel.svelte';
  import PerfOverlay from './PerfOverlay.svelte';
  import PieMenu from './PieMenu.svelte';
  import SimPanel from './SimPanel.svelte';
  import EventFeed from './EventFeed.svelte';
  import SocialMenu from './SocialMenu.svelte';
  import TopBar from './TopBar.svelte';
  import TownPanel from './TownPanel.svelte';
</script>

<div class="hud">
  <TopBar />
  <SimPanel />
  <NeedsPanel />
  <PerfOverlay />
  <EventFeed />
  <PieMenu />
  <SocialMenu />
  <TownPanel />
</div>

<style>
  /* Children opt in to pointer events; everything else lets clicks reach the 3D view. */
  .hud {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }
</style>
