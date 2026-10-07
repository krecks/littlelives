<script lang="ts">
  import type { Appearance } from '../../game/household';

  /**
   * 2D portrait matching the placeholder 3D Sim (pill body, round head, hair cap).
   * Swap this component for a 3D preview once real character models exist.
   */
  let { appearance, size = 220, animate = true }: { appearance: Appearance; size?: number; animate?: boolean } = $props();
  const uid = $props.id();
  const h = $derived(Math.min(1.15, Math.max(0.85, appearance.height)));
</script>

<svg class:animate width={size} height={size * 1.25} viewBox="0 0 200 250" aria-hidden="true">
  <ellipse cx="100" cy="236" rx="46" ry="9" fill="rgba(20,24,40,0.12)" />
  <g style="transform: scale({h}); transform-origin: 100px 236px">
    <g class="figure">
      <rect x="62" y="96" width="76" height="140" rx="38" fill={appearance.body} />
      <rect x="62" y="96" width="76" height="140" rx="38" fill="url(#shade-{uid})" />
      <circle cx="100" cy="62" r="34" fill={appearance.skin} />
      {#if appearance.hairStyle === 'long'}
        <path d="M62 60c0-26 16-38 38-38s38 12 38 38v40c-6 6-14 8-20 6V60c-6-8-14-12-18-12s-12 4-18 12v46c-6 2-14 0-20-6Z" fill={appearance.hair} />
      {:else if appearance.hairStyle === 'bun'}
        <circle cx="100" cy="20" r="14" fill={appearance.hair} />
        <path d="M64 58c0-24 16-36 36-36s36 12 36 36c-8-10-20-15-36-15s-28 5-36 15Z" fill={appearance.hair} />
      {:else if appearance.hairStyle !== 'none'}
        <path d="M64 58c0-24 16-36 36-36s36 12 36 36c-8-10-20-15-36-15s-28 5-36 15Z" fill={appearance.hair} />
      {/if}
      <circle cx="88" cy="66" r="3.2" fill="rgba(20,24,40,0.75)" />
      <circle cx="112" cy="66" r="3.2" fill="rgba(20,24,40,0.75)" />
      <path d="M91 78c5 4 13 4 18 0" stroke="rgba(20,24,40,0.55)" stroke-width="3" fill="none" stroke-linecap="round" />
    </g>
  </g>
  <defs>
    <linearGradient id="shade-{uid}" x1="0" x2="1">
      <stop offset="0" stop-color="#fff" stop-opacity="0.18" />
      <stop offset="0.6" stop-color="#000" stop-opacity="0" />
      <stop offset="1" stop-color="#000" stop-opacity="0.12" />
    </linearGradient>
  </defs>
</svg>

<style>
  svg {
    display: block;
    overflow: visible;
  }
  .animate .figure {
    animation: idle 3.2s ease-in-out infinite;
    transform-origin: 100px 236px;
  }
  @keyframes idle {
    50% {
      transform: translateY(-4px) scaleY(1.01);
    }
  }
</style>
