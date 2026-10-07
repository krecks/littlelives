<script lang="ts">
  /**
   * Fallback backdrop behind the menus: a golden-hour landscape in CSS + inline SVG (no images,
   * no JS work). Hidden while the live 3D scene renders behind the menu (`app.liveBackdrop`).
   * Only `transform` is animated, so it stays on the compositor.
   */
  import { app } from '../app.svelte';

  const live = $derived((app as { liveBackdrop?: boolean }).liveBackdrop ?? false);
</script>

{#if !live}
  <div class="backdrop" aria-hidden="true">
    <div class="sky"></div>
    <div class="sun"></div>
    <div class="clouds">
      <span class="cloud c1"></span>
      <span class="cloud c2"></span>
      <span class="cloud c3"></span>
    </div>
    <svg class="land" viewBox="0 0 1600 600" preserveAspectRatio="none">
      <defs>
        <linearGradient id="mb-far" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#9aa6b4" />
          <stop offset="1" stop-color="#b9b6ae" />
        </linearGradient>
        <linearGradient id="mb-mid" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#6c7f5e" />
          <stop offset="1" stop-color="#7d8862" />
        </linearGradient>
        <linearGradient id="mb-near" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#4b6236" />
          <stop offset="1" stop-color="#2c3b22" />
        </linearGradient>
      </defs>
      <path
        fill="url(#mb-far)"
        d="M0 300 C120 270 220 250 340 262 C470 276 560 228 690 236 C820 244 900 282 1030 270 C1170 256 1260 222 1390 236 C1480 246 1550 262 1600 258 L1600 600 L0 600 Z"
      />
      <path
        fill="url(#mb-mid)"
        d="M0 372 C160 340 280 330 420 350 C560 370 640 336 780 330 C920 324 1020 360 1160 352 C1300 344 1420 318 1600 330 L1600 600 L0 600 Z"
      />
      <path
        fill="url(#mb-near)"
        d="M0 452 C180 420 340 432 500 448 C660 464 780 430 960 424 C1140 418 1260 446 1420 440 C1500 437 1560 430 1600 428 L1600 600 L0 600 Z"
      />
    </svg>
    <div class="haze"></div>
    <div class="vignette"></div>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    overflow: hidden;
    background: #c9b8a0;
  }
  .sky {
    position: absolute;
    inset: 0;
    background: linear-gradient(
      180deg,
      #3e5f8e 0%,
      #6f92bf 28%,
      #b4c2cf 52%,
      #e9cfae 66%,
      #f1c39a 74%,
      #c9b8a0 100%
    );
  }
  .sun {
    position: absolute;
    left: 66%;
    top: 58%;
    width: 70vmax;
    height: 70vmax;
    transform: translate(-50%, -50%);
    background: radial-gradient(
      closest-side,
      rgba(255, 244, 220, 0.95) 0%,
      rgba(255, 220, 170, 0.55) 6%,
      rgba(255, 205, 150, 0.22) 22%,
      rgba(255, 200, 150, 0) 60%
    );
  }
  .clouds {
    position: absolute;
    inset: 0 -20% 40% -20%;
    animation: drift 90s linear infinite alternate;
  }
  .cloud {
    position: absolute;
    border-radius: 50%;
    background: rgba(255, 246, 236, 0.5);
    filter: blur(28px);
  }
  .c1 {
    width: 42vw;
    height: 7vh;
    top: 18%;
    left: 10%;
  }
  .c2 {
    width: 30vw;
    height: 5vh;
    top: 30%;
    left: 52%;
    background: rgba(255, 236, 214, 0.45);
  }
  .c3 {
    width: 24vw;
    height: 4vh;
    top: 10%;
    left: 70%;
    background: rgba(240, 244, 250, 0.4);
  }
  .land {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    width: 100%;
    height: 62%;
  }
  .haze {
    position: absolute;
    inset: 40% 0 0 0;
    background: linear-gradient(180deg, rgba(241, 214, 180, 0) 0%, rgba(241, 214, 180, 0.28) 30%, rgba(241, 214, 180, 0) 60%);
  }
  .vignette {
    position: absolute;
    inset: 0;
    background: radial-gradient(ellipse at 60% 45%, rgba(0, 0, 0, 0) 55%, rgba(0, 0, 0, 0.35) 100%);
  }
  @keyframes drift {
    to {
      transform: translateX(8vw);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .clouds {
      animation: none;
    }
  }
</style>
