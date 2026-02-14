<script lang="ts">
  /**
   * Project dropdown selector
   *
   * Lets the user filter by project. Fires `onchange` with selected value.
   */
  interface Props {
    projects?: string[]
    selected?: string
    onchange?: (project: string) => void
  }

  const {
    projects = ['gigi', 'org-press', 'website', 'biancifiore'],
    selected = '',
    onchange,
  }: Props = $props()

  function handleChange(e: Event) {
    const value = (e.target as HTMLSelectElement).value
    onchange?.(value)
  }
</script>

<div class="project-selector">
  <label class="filter-label">Project</label>
  <select class="filter-select" value={selected} onchange={handleChange}>
    <option value="">All projects</option>
    {#each projects as project}
      <option value={project}>{project}</option>
    {/each}
  </select>
</div>

<style>
  .project-selector {
    display: flex;
    align-items: center;
    gap: var(--gigi-space-sm);
  }

  .filter-label {
    font-size: var(--gigi-font-size-xs);
    color: var(--gigi-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    white-space: nowrap;
  }

  .filter-select {
    background: var(--gigi-bg-tertiary);
    border: var(--gigi-border-width) solid var(--gigi-border-default);
    border-radius: var(--gigi-radius-sm);
    color: var(--gigi-text-primary);
    padding: var(--gigi-space-xs) var(--gigi-space-sm);
    font-size: var(--gigi-font-size-sm);
    font-family: var(--gigi-font-sans);
    cursor: pointer;
  }
</style>
