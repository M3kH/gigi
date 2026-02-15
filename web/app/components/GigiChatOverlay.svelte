<script lang="ts">
  /** Section F: Chat overlay — messages + input + stop button */
  import { getPanelState, setPanelState, type PanelState } from '$lib/stores/panels.svelte'
  import PanelControls from '$components/ui/PanelControls.svelte'
  import {
    sendMessage,
    stopAgent,
    getDialogState,
    getActiveConversationId,
    getActiveConversation,
  } from '$lib/stores/chat.svelte'
  import { getViewContext, type ViewContext } from '$lib/stores/navigation.svelte'
  import ChatMessages from '$components/chat/ChatMessages.svelte'
  import ChatInput from '$components/chat/ChatInput.svelte'

  const state: PanelState = $derived(getPanelState('chatOverlay'))
  const dialogState = $derived(getDialogState())
  const activeConvId = $derived(getActiveConversationId())
  const activeConv = $derived(getActiveConversation())
  const isAgentBusy = $derived(dialogState !== 'idle')
  const viewCtx: ViewContext = $derived(getViewContext())

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

  function handleSend(message: string) {
    sendMessage(message)
  }

  function handleStop() {
    stopAgent()
  }
</script>

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

  {#if state !== 'hidden'}
    <ChatMessages />

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
