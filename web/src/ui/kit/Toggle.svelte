<script lang="ts">
  let { checked = $bindable(false), label }: { checked?: boolean; label: string } = $props();
</script>

<button class="toggle" class:on={checked} role="switch" aria-checked={checked} aria-label={label} onclick={() => (checked = !checked)}>
  <span class="knob"></span>
</button>

<style>
  .toggle {
    position: relative;
    width: 42px;
    height: 24px;
    flex: none;
    border-radius: var(--radius-pill);
    background: rgba(29, 34, 48, 0.16);
    transition: background var(--fast) var(--ease);
  }
  .toggle.on {
    background: var(--accent);
  }
  .knob {
    position: absolute;
    top: 3px;
    left: 3px;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: #fff;
    box-shadow: var(--shadow-sm);
    transition: transform var(--fast) var(--ease);
  }
  .on .knob {
    transform: translateX(18px);
  }
</style>
