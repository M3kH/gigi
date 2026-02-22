<script lang="ts">
  /**
   * Fork indicator — "Forked from X at Y" banner shown at top of forked threads.
   */
  import type { ThreadLineageThread, ThreadEvent } from '$lib/types/chat'
  import { selectConversation } from '$lib/stores/chat.svelte'
  import { formatTime } from '$lib/utils/format'

  interface Props {
    parent: ThreadLineageThread
    forkPoint?: ThreadEvent | null
  }

  const { parent, forkPoint }: Props = $props()

  function navigateToParent() {
    selectConversation(parent.id)
  }

  const forkTime = $derived(
    forkPoint?.created_at ? formatTime(forkPoint.created_at) : formatTime(parent.created_at)
  )
</script>

<div class="fork-indicator">
  <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" class="fork-icon">
    <path d="M5 2h2v12h3v3h7v-7h-3V2h8v8h-3v9h-9v3H2v-8h3V2zm15 6V4h-4v4h4zM8 19v-3H4v4h4v-1z"/>
  </svg>
  <span class="fork-text">
    Forked from
    <button class="fork-link" onclick={navigateToParent}>
      {parent.topic || 'parent thread'}
    </button>
    at {forkTime}
  </span>
  <button class="view-parent-btn" onclick={navigateToParent} title="View parent thread">
    View parent →
  </button>
</div>

<style>
  .fork-indicator {
    display: flex;
    align-items: center;
    gap: var(--gigi-space-sm);
    padding: var(--gigi-space-xs) var(--gigi-space-md);
    margin-bottom: var(--gigi-space-sm);
    background: rgba(163, 113, 247, 0.06);
    border: 1px solid rgba(163, 113, 247, 0.2);
    border-radius: var(--gigi-radius-md);
    font-size: var(--gigi-font-size-xs);
    color: var(--gigi-text-muted);
  }

  .fork-icon {
    flex-shrink: 0;
    color: var(--gigi-accent-purple, #a371f7);
    opacity: 0.7;
  }

  .fork-text {
    flex: 1;
  }

  .fork-link {
    background: none;
    border: none;
    color: var(--gigi-accent-purple, #a371f7);
    cursor: pointer;
    padding: 0;
    font-size: inherit;
    font-family: inherit;
    text-decoration: underline;
    text-decoration-style: dotted;
    text-underline-offset: 2px;
  }

  .fork-link:hover {
    color: var(--gigi-accent-blue);
    text-decoration-style: solid;
  }

  .view-parent-btn {
    flex-shrink: 0;
    background: none;
    border: 1px solid rgba(163, 113, 247, 0.2);
    border-radius: var(--gigi-radius-sm);
    color: var(--gigi-accent-purple, #a371f7);
    cursor: pointer;
    padding: 2px 8px;
    font-size: var(--gigi-font-size-xs);
    font-family: var(--gigi-font-sans);
    transition: all var(--gigi-transition-fast);
  }

  .view-parent-btn:hover {
    background: rgba(163, 113, 247, 0.1);
    border-color: rgba(163, 113, 247, 0.4);
  }
</style>
