<script lang="ts">
  /** Section F: Chat overlay — messages + input + stop button + toolbar */
  import { getPanelState, setPanelState, type PanelState } from '$lib/stores/panels.svelte'
  import PanelControls from '$components/ui/PanelControls.svelte'
  import {
    sendMessage,
    stopAgent,
    getDialogState,
    getActiveConversationId,
    getActiveConversation,
    getThreadRefs,
    forkConversation,
    compactThread,
    getCompactStatus,
  } from '$lib/stores/chat.svelte'
  import { getViewContext, type ViewContext, navigateToGitea } from '$lib/stores/navigation.svelte'
  import type { ThreadRef, CompactStatus } from '$lib/types/chat'
  import ThreadTimeline from '$components/chat/ThreadTimeline.svelte'
  import ChatInput from '$components/chat/ChatInput.svelte'

  const state: PanelState = $derived(getPanelState('chatOverlay'))
  const dialogState = $derived(getDialogState())
  const activeConvId = $derived(getActiveConversationId())
  const activeConv = $derived(getActiveConversation())
  const isAgentBusy = $derived(dialogState !== 'idle')
  const viewCtx: ViewContext = $derived(getViewContext())

  // Thread refs and compact status for toolbar
  let threadRefs = $state<ThreadRef[]>([])
  let compactStatus = $state<CompactStatus | null>(null)
  let showLinksDropdown = $state(false)

  // Fetch refs and compact status when conversation changes
  $effect(() => {
    const id = activeConvId
    if (id) {
      getThreadRefs(id).then(refs => { threadRefs = refs })
      getCompactStatus(id).then(s => { compactStatus = s })
    } else {
      threadRefs = []
      compactStatus = null
    }
  })

  // Refresh refs after agent finishes
  let prevDialogState = $state<string>('idle')
  $effect(() => {
    const ds = dialogState
    if (prevDialogState !== 'idle' && ds === 'idle' && activeConvId) {
      getThreadRefs(activeConvId).then(refs => { threadRefs = refs })
      getCompactStatus(activeConvId).then(s => { compactStatus = s })
    }
    prevDialogState = ds
  })

  const contextLabel = $derived.by(() => {
    const ctx = viewCtx
    if (ctx.type === 'overview') return ''
    if (ctx.type === 'issue' && ctx.owner && ctx.repo && ctx.number) return `${ctx.owner}/${ctx.repo}#${ctx.number}`
    if (ctx.type === 'pull' && ctx.owner && ctx.repo && ctx.number) return `PR ${ctx.owner}/${ctx.repo}#${ctx.number}`
    if (ctx.type === 'file' && ctx.owner && ctx.repo && ctx.filepath) return `${ctx.owner}/${ctx.repo}/${ctx.filepath}`
    if (ctx.type === 'commit' && ctx.owner && ctx.repo && ctx.commitSha) return `${ctx.owner}/${ctx.repo}@${ctx.commitSha.slice(0, 7)}`
    if (ctx.type === 'repo' && ctx.owner && ctx.repo) return `${ctx.owner}/${ctx.repo}`
    return ''
  })

  const showCompactBadge = $derived(compactStatus?.should_compact === true)

  function handleSend(message: string) {
    sendMessage(message)
  }

  function handleStop() {
    stopAgent()
  }

  function handleFork() {
    if (activeConvId) forkConversation(activeConvId)
  }

  function handleCompact() {
    if (activeConvId) compactThread(activeConvId)
  }

  function handleRefClick(ref: ThreadRef) {
    showLinksDropdown = false
    const path = ref.ref_type === 'pr'
      ? `/${ref.repo.includes('/') ? ref.repo : `idea/${ref.repo}`}/pulls/${ref.number}`
      : `/${ref.repo.includes('/') ? ref.repo : `idea/${ref.repo}`}/issues/${ref.number}`
    navigateToGitea(path)
  }

  function refStatusIcon(status: string | undefined): string {
    switch (status) {
      case 'open': return '🟢'
      case 'closed': return '🔴'
      case 'merged': return '🟣'
      default: return '⚪'
    }
  }

  // Close links dropdown when clicking outside
  function handleGlobalClick() {
    if (showLinksDropdown) showLinksDropdown = false
  }
</script>

<svelte:document onclick={handleGlobalClick} />

<div class="gigi-chat-overlay">
  <header class="overlay-header">
    <div class="overlay-left">
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <span
        class="overlay-title"
        ondblclick={() => setPanelState('chatOverlay', state === 'hidden' ? 'compact' : 'hidden')}
      >Chat</span>
      {#if activeConv}
        <span class="overlay-conv-title">{activeConv.topic}</span>
      {/if}
    </div>
    <div class="overlay-right">
      {#if isAgentBusy}
        <button class="stop-btn" onclick={handleStop} title="Stop agent">
          ⏹ Stop
        </button>
      {/if}
      <PanelControls panel="chatOverlay" state={state} />
    </div>
  </header>

  {#if state !== 'hidden' && activeConvId}
    <!-- Toolbar: Links, Compact, Fork -->
    <div class="overlay-toolbar">
      <!-- Links dropdown -->
      <div class="toolbar-dropdown-wrapper">
        <button
          class="toolbar-btn"
          class:has-refs={threadRefs.length > 0}
          title="{threadRefs.length} linked refs"
          onclick={(e) => { e.stopPropagation(); showLinksDropdown = !showLinksDropdown }}
        >
          🔗 {threadRefs.length > 0 ? threadRefs.length : ''}
        </button>
        {#if showLinksDropdown && threadRefs.length > 0}
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div class="links-dropdown" onclick={(e) => e.stopPropagation()}>
            <div class="links-dropdown-header">Linked refs</div>
            {#each threadRefs as ref}
              <button class="links-dropdown-item" onclick={() => handleRefClick(ref)}>
                <span class="ref-status">{refStatusIcon(ref.status)}</span>
                <span class="ref-type">{ref.ref_type === 'pr' ? 'PR' : 'Issue'}</span>
                <span class="ref-label">{ref.repo}#{ref.number}</span>
              </button>
            {/each}
          </div>
        {/if}
      </div>

      <button
        class="toolbar-btn"
        class:compact-recommended={showCompactBadge}
        title={showCompactBadge
          ? `${compactStatus?.event_count} events — recommend compacting`
          : 'Compact thread'}
        onclick={handleCompact}
      >
        📦
        {#if showCompactBadge}
          <span class="compact-badge">{compactStatus?.event_count}</span>
        {/if}
      </button>

      <button class="toolbar-btn" title="Fork thread" onclick={handleFork}>
        🍴
      </button>
    </div>
  {/if}

  {#if state !== 'hidden'}
    <ThreadTimeline />

    {#if contextLabel}
      <div class="context-pill">
        <span class="context-pill-label">Viewing {contextLabel}</span>
      </div>
    {/if}

    <ChatInput
      onsend={handleSend}
      disabled={false}
      placeholder={activeConvId ? 'Continue conversation...' : 'Message Gigi...'}
    />
  {/if}
</div>

<style>
  .gigi-chat-overlay {
    display: flex;
    flex-direction: column;
    background: var(--gigi-bg-secondary);
    height: 100%;
    min-height: 0;
  }

  .overlay-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--gigi-space-xs) var(--gigi-space-md);
    border-bottom: var(--gigi-border-width) solid var(--gigi-border-muted);
    flex-shrink: 0;
  }

  .overlay-left {
    display: flex;
    align-items: center;
    gap: var(--gigi-space-sm);
    min-width: 0;
  }

  .overlay-title {
    font-size: var(--gigi-font-size-xs);
    font-weight: 600;
    color: var(--gigi-text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    flex-shrink: 0;
    cursor: default;
    user-select: none;
  }

  .overlay-conv-title {
    font-size: var(--gigi-font-size-xs);
    color: var(--gigi-text-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .overlay-right {
    display: flex;
    align-items: center;
    gap: var(--gigi-space-sm);
    flex-shrink: 0;
  }

  .stop-btn {
    background: var(--gigi-accent-red, #a44);
    color: #fff;
    border: none;
    border-radius: var(--gigi-radius-sm);
    padding: 0.15rem 0.5rem;
    cursor: pointer;
    font-size: 0.7rem;
    transition: all var(--gigi-transition-fast);
  }

  .stop-btn:hover {
    filter: brightness(1.2);
  }

  /* ── Toolbar ──────────────────────────────────────────────────────── */

  .overlay-toolbar {
    display: flex;
    align-items: center;
    gap: var(--gigi-space-xs);
    padding: 2px var(--gigi-space-md);
    border-bottom: var(--gigi-border-width) solid var(--gigi-border-muted);
    flex-shrink: 0;
  }

  .toolbar-btn {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    padding: 1px 6px;
    border-radius: var(--gigi-radius-sm);
    border: 1px solid transparent;
    background: none;
    color: var(--gigi-text-muted);
    font-size: var(--gigi-font-size-xs);
    cursor: pointer;
    font-family: var(--gigi-font-sans);
    transition: all var(--gigi-transition-fast);
  }

  .toolbar-btn:hover {
    background: var(--gigi-bg-hover);
    color: var(--gigi-text-secondary);
    border-color: var(--gigi-border-muted);
  }

  .toolbar-btn.has-refs {
    color: var(--gigi-accent-blue);
  }

  .toolbar-btn.compact-recommended {
    color: var(--gigi-accent-orange, #d29922);
  }

  .compact-badge {
    background: var(--gigi-accent-orange, #d29922);
    color: #fff;
    font-size: 0.5rem;
    padding: 0 3px;
    border-radius: var(--gigi-radius-full);
    font-weight: 600;
    line-height: 1.4;
  }

  /* ── Links dropdown ──────────────────────────────────────────────── */

  .toolbar-dropdown-wrapper {
    position: relative;
  }

  .links-dropdown {
    position: absolute;
    top: 100%;
    left: 0;
    z-index: 100;
    min-width: 200px;
    max-width: 300px;
    background: var(--gigi-bg-secondary);
    border: var(--gigi-border-width) solid var(--gigi-border-default);
    border-radius: var(--gigi-radius-md);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    padding: var(--gigi-space-xs) 0;
    margin-top: 4px;
    animation: dropdown-in 100ms ease-out;
  }

  @keyframes dropdown-in {
    from { opacity: 0; transform: translateY(-4px); }
    to { opacity: 1; transform: translateY(0); }
  }

  .links-dropdown-header {
    padding: var(--gigi-space-xs) var(--gigi-space-md);
    font-size: var(--gigi-font-size-xs);
    color: var(--gigi-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    font-weight: 600;
  }

  .links-dropdown-item {
    display: flex;
    align-items: center;
    gap: var(--gigi-space-sm);
    width: 100%;
    padding: var(--gigi-space-xs) var(--gigi-space-md);
    background: none;
    border: none;
    color: var(--gigi-text-primary);
    font-size: var(--gigi-font-size-sm);
    font-family: var(--gigi-font-sans);
    cursor: pointer;
    text-align: left;
    transition: background var(--gigi-transition-fast);
  }

  .links-dropdown-item:hover {
    background: var(--gigi-bg-hover);
  }

  .ref-status {
    font-size: 0.6rem;
    flex-shrink: 0;
  }

  .ref-type {
    font-size: var(--gigi-font-size-xs);
    color: var(--gigi-text-muted);
    flex-shrink: 0;
  }

  .ref-label {
    font-family: var(--gigi-font-mono, monospace);
    font-size: var(--gigi-font-size-xs);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* ── Context pill ────────────────────────────────────────────────── */

  .context-pill {
    display: flex;
    align-items: center;
    gap: var(--gigi-space-xs);
    padding: var(--gigi-space-xs) var(--gigi-space-md);
    border-top: var(--gigi-border-width) solid var(--gigi-border-muted);
    flex-shrink: 0;
  }

  .context-pill-label {
    font-size: var(--gigi-font-size-xs);
    color: var(--gigi-text-muted);
    font-family: var(--gigi-font-mono, monospace);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

</style>
