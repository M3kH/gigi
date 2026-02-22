<script lang="ts">
  /**
   * Bar above Gitea iframe showing conversations linked to the current issue/PR.
   * Clicking a chip opens that conversation in the chat panel.
   */
  import { getViewContext, type ViewContext } from '$lib/stores/navigation.svelte'
  import { selectConversation } from '$lib/stores/chat.svelte'

  interface LinkedConversation {
    id: string
    topic: string
    status: string
  }

  const viewCtx: ViewContext = $derived(getViewContext())
  let linkedConvs = $state<LinkedConversation[]>([])
  let loading = $state(false)

  // Fetch linked conversations when viewing an issue or PR
  $effect(() => {
    const ctx = viewCtx
    if ((ctx.type === 'issue' || ctx.type === 'pull') && ctx.owner && ctx.repo && ctx.number) {
      fetchLinked(ctx.repo, ctx.type === 'pull' ? 'pr' : 'issue', ctx.number)
    } else {
      linkedConvs = []
    }
  })

  async function fetchLinked(repo: string, refType: string, number: number) {
    loading = true
    try {
      const res = await fetch(`/api/threads/by-ref/${repo}/${refType}/${number}`)
      if (res.ok) {
        linkedConvs = await res.json()
      } else {
        linkedConvs = []
      }
    } catch {
      linkedConvs = []
    }
    loading = false
  }

  function handleConvClick(conv: LinkedConversation) {
    selectConversation(conv.id)
  }

  function statusIcon(status: string): string {
    switch (status) {
      case 'active': return '🟢'
      case 'paused': return '🟡'
      case 'stopped': return '🔴'
      case 'archived': return '📦'
      default: return '⚪'
    }
  }
</script>

{#if linkedConvs.length > 0}
  <div class="linked-conversations-bar">
    <span class="bar-label"><svg viewBox="0 0 24 24" fill="currentColor" width="12" height="12" style="vertical-align: middle; margin-right: 2px;"><path d="M20 2H2v20h2V4h16v12H6v2H4v2h2v-2h16V2h-2z"/></svg> Conversations:</span>
    {#each linkedConvs as conv}
      <button class="conv-chip" onclick={() => handleConvClick(conv)} title={conv.topic}>
        <span class="conv-status">{statusIcon(conv.status)}</span>
        <span class="conv-topic">{conv.topic || 'Untitled'}</span>
      </button>
    {/each}
  </div>
{/if}

<style>
  .linked-conversations-bar {
    display: flex;
    align-items: center;
    gap: var(--gigi-space-sm);
    padding: var(--gigi-space-xs) var(--gigi-space-md);
    background: var(--gigi-bg-secondary);
    border-bottom: var(--gigi-border-width) solid var(--gigi-border-muted);
    flex-shrink: 0;
    overflow-x: auto;
    min-height: 28px;
  }

  .bar-label {
    font-size: var(--gigi-font-size-xs);
    color: var(--gigi-text-muted);
    white-space: nowrap;
    flex-shrink: 0;
    font-weight: 500;
  }

  .conv-chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 8px;
    border-radius: var(--gigi-radius-full);
    border: 1px solid var(--gigi-border-muted);
    background: var(--gigi-bg-primary);
    color: var(--gigi-text-secondary);
    font-size: var(--gigi-font-size-xs);
    cursor: pointer;
    font-family: var(--gigi-font-sans);
    transition: all var(--gigi-transition-fast);
    white-space: nowrap;
    max-width: 200px;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .conv-chip:hover {
    background: var(--gigi-bg-hover);
    border-color: var(--gigi-accent-blue);
    color: var(--gigi-text-primary);
  }

  .conv-status {
    font-size: 0.5rem;
    flex-shrink: 0;
  }

  .conv-topic {
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* Scrollbar */
  .linked-conversations-bar::-webkit-scrollbar {
    height: 3px;
  }

  .linked-conversations-bar::-webkit-scrollbar-track {
    background: transparent;
  }

  .linked-conversations-bar::-webkit-scrollbar-thumb {
    background: var(--gigi-border-default);
    border-radius: 3px;
  }
</style>
