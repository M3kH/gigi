<script lang="ts">
  /**
   * Thread refs bar — shows linked issues/PRs/commits at the top of the thread.
   * Each ref is a clickable link with status badges (open/closed/merged).
   */
  import type { ThreadRef } from '$lib/types/chat'
  import { navigateToGitea } from '$lib/stores/navigation.svelte'

  interface Props {
    refs: ThreadRef[]
    onAddRef?: () => void
  }

  const { refs, onAddRef }: Props = $props()

  function statusColor(status: string | null): string {
    switch (status) {
      case 'open': return 'status-open'
      case 'closed': return 'status-closed'
      case 'merged': return 'status-merged'
      default: return ''
    }
  }

  function refLabel(ref: ThreadRef): string {
    const short = ref.repo.split('/').pop() || ref.repo
    if (ref.number) return `${short}#${ref.number}`
    if (ref.ref) return `${short}@${ref.ref.slice(0, 7)}`
    return short
  }

  function refTypeIcon(type: string): string {
    switch (type) {
      case 'issue': return '📋'
      case 'pr': return '🔀'
      case 'commit': return '📌'
      case 'branch': return '🌿'
      default: return '🔗'
    }
  }

  function handleRefClick(ref: ThreadRef) {
    if (ref.url) {
      // Navigate to the ref URL in the Gitea panel
      // Extract the path after the Gitea host for navigateToGitea
      try {
        const url = new URL(ref.url)
        navigateToGitea(url.pathname)
      } catch {
        navigateToGitea(ref.url)
      }
    }
  }
</script>

{#if refs.length > 0}
  <div class="refs-bar">
    <span class="refs-icon">🔗</span>
    {#each refs as ref, i (ref.id)}
      <button
        class="ref-chip {statusColor(ref.status)}"
        title="{ref.ref_type}: {ref.repo}{ref.number ? '#' + ref.number : ''} ({ref.status || 'unknown'})"
        onclick={() => handleRefClick(ref)}
      >
        <span class="ref-type-icon">{refTypeIcon(ref.ref_type)}</span>
        <span class="ref-label">{refLabel(ref)}</span>
        {#if ref.status}
          <span class="ref-status">({ref.status})</span>
        {/if}
      </button>
      {#if i < refs.length - 1}
        <span class="ref-separator">·</span>
      {/if}
    {/each}
    {#if onAddRef}
      <button class="add-ref-btn" title="Link an issue or PR" onclick={onAddRef}>
        + Add
      </button>
    {/if}
  </div>
{/if}

<style>
  .refs-bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--gigi-space-xs);
    padding: var(--gigi-space-xs) var(--gigi-space-sm);
    margin-bottom: var(--gigi-space-sm);
    background: var(--gigi-bg-tertiary);
    border: 1px solid var(--gigi-border-muted);
    border-radius: var(--gigi-radius-md);
    font-size: var(--gigi-font-size-xs);
  }

  .refs-icon {
    font-size: 0.7rem;
    flex-shrink: 0;
  }

  .ref-chip {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    padding: 1px 6px;
    border-radius: var(--gigi-radius-full);
    border: 1px solid var(--gigi-border-muted);
    background: var(--gigi-bg-secondary);
    color: var(--gigi-text-secondary);
    cursor: pointer;
    font-size: inherit;
    font-family: var(--gigi-font-mono, monospace);
    transition: all var(--gigi-transition-fast);
  }

  .ref-chip:hover {
    background: var(--gigi-bg-hover);
    border-color: var(--gigi-accent-blue);
  }

  .ref-type-icon {
    font-size: 0.6rem;
  }

  .ref-label {
    font-weight: 500;
  }

  .ref-status {
    font-size: 0.55rem;
    opacity: 0.7;
  }

  .ref-separator {
    color: var(--gigi-text-muted);
    opacity: 0.5;
  }

  /* Status colors */
  .status-open {
    border-color: rgba(63, 185, 80, 0.3);
  }

  .status-open .ref-status {
    color: var(--gigi-accent-green, #3fb950);
  }

  .status-closed {
    border-color: rgba(248, 81, 73, 0.3);
  }

  .status-closed .ref-status {
    color: var(--gigi-accent-red, #f85149);
  }

  .status-merged {
    border-color: rgba(163, 113, 247, 0.3);
  }

  .status-merged .ref-status {
    color: var(--gigi-accent-purple, #a371f7);
  }

  .add-ref-btn {
    display: inline-flex;
    align-items: center;
    padding: 1px 6px;
    border-radius: var(--gigi-radius-full);
    border: 1px dashed var(--gigi-border-muted);
    background: transparent;
    color: var(--gigi-text-muted);
    cursor: pointer;
    font-size: inherit;
    font-family: var(--gigi-font-sans);
    transition: all var(--gigi-transition-fast);
  }

  .add-ref-btn:hover {
    border-color: var(--gigi-accent-blue);
    color: var(--gigi-accent-blue);
    background: rgba(88, 166, 255, 0.05);
  }

  /* ── Responsive ────────────────────────────────────────────────────── */
  @media (max-width: 480px) {
    .refs-bar {
      padding: var(--gigi-space-xs);
      gap: 3px;
    }
  }
</style>
