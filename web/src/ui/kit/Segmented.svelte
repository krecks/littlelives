<script lang="ts" generics="T extends string | number">
  let {
    value = $bindable(),
    options,
    label,
  }: { value: T; options: readonly { value: T; label: string }[]; label: string } = $props();
</script>

<div class="segmented" role="radiogroup" aria-label={label}>
  {#each options as option (option.value)}
    <button role="radio" aria-checked={value === option.value} class:active={value === option.value} onclick={() => (value = option.value)}>
      {option.label}
    </button>
  {/each}
</div>

<style>
  .segmented {
    display: inline-flex;
    gap: 2px;
    padding: 3px;
    border-radius: var(--radius-md);
    background: var(--hairline);
  }
  button {
    height: 30px;
    padding: 0 12px;
    border-radius: var(--radius-sm);
    color: var(--text-muted);
    font-weight: 600;
    transition: background var(--fast) var(--ease), color var(--fast) var(--ease);
  }
  button.active {
    background: var(--surface);
    color: var(--accent);
    box-shadow: var(--shadow-sm);
  }
</style>
