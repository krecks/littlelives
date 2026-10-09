<script lang="ts">
  import NeedsPanel from './NeedsPanel.svelte';
  import PerfOverlay from './PerfOverlay.svelte';
  import PieMenu from './PieMenu.svelte';
  import SimPanel from './SimPanel.svelte';
  import EventFeed from './EventFeed.svelte';
  import HouseholdStrip from './HouseholdStrip.svelte';
  import Journal from './Journal.svelte';
  import JobBoard from './JobBoard.svelte';
  import SocialMenu from './SocialMenu.svelte';
  import TopBar from './TopBar.svelte';
  import TownPanel from './TownPanel.svelte';
  import BuyPanel from './BuyPanel.svelte';
  import BuildPanel from './BuildPanel.svelte';
  import BuyFx from './buy/BuyFx.svelte';
  import { game } from './state.svelte';
  import { settings } from '../settings/settings.svelte';
</script>

<div class="hud" class:quiet={game.watching && settings.hideHudWhileWatching && !game.hudAwake}>
  <TopBar />
  {#if game.mode === 'live'}
    <HouseholdStrip />
    <SimPanel />
    <NeedsPanel />
    <Journal />
  {/if}
  <BuyPanel />
  <BuildPanel />
  <BuyFx />
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
    transition: opacity var(--slow) var(--ease);
  }
  /* Watching with a quiet interface: everything fades until the player moves the mouse. */
  .hud.quiet {
    opacity: 0;
  }
</style>
