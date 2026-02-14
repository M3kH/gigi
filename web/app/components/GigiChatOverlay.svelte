<script lang="ts">
  /** Section F: Chat overlay — messages + input + stop button */
  import { getPanelState, togglePanel, type PanelState } from '$lib/stores/panels.svelte'
  import {
    sendMessage,
    stopAgent,
    getDialogState,
    getActiveConversationId,
    getActiveConversation,
  } from '$lib/stores/chat.svelte'
  import ChatMessages from '$components/chat/ChatMessages.svelte'
  import ChatInput from '$components/chat/ChatInput.svelte'

  const state: PanelState = $derived(getPanelState('chatOverlay'))
  const dialogState = $derived(getDialogState())
  const activeConvId = $derived(getActiveConversationId())
  const activeConv = $derived(getActiveConversation())
  const isAgentBusy = $derived(dialogState !== 'idle')

  function handleSend(message: string) {
    sendMessage(message)
  }

  function handleStop() {
    stopAgent()
  }
</script>

{#if state !== 'hidden'}
  <div class="gigi-chat-overlay" class:compact={state === 'compact'}>
    <header class="overlay-header">
      <div class="overlay-left">
        <span class="overlay-title">Chat</span>
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
        <button
          class="toggle-btn"
          onclick={() => togglePanel('chatOverlay')}
          title="Toggle chat overlay"
        >
          {state === 'compact' ? '▲' : '▼'}
        </button>
      </div>
    </header>

    {#if state === 'full'}
      <ChatMessages />

      <ChatInput
        onsend={handleSend}
        disabled={false}
        placeholder={activeConvId ? 'Continue conversation...' : 'Message Gigi...'}
      />
    {/if}
  </div>
{/if}

<style>
  .gigi-chat-overlay {
    display: flex;
    flex-direction: column;
    background: var(--gigi-bg-secondary);
    border-top: var(--gigi-border-width) solid var(--gigi-border-default);
    max-height: 50%;
    min-height: 180px;
    transition: all var(--gigi-transition-normal);
  }

  .gigi-chat-overlay.compact {
    min-height: auto;
    max-height: auto;
  }

  .overlay-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--gigi-space-xs) var(--gigi-space-md);
    border-bottom: var(--gigi-border-width) solid var(--gigi-border-muted);
    cursor: pointer;
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

  .toggle-btn {
    background: none;
    border: none;
    color: var(--gigi-text-muted);
    cursor: pointer;
    padding: var(--gigi-space-xs);
    font-size: var(--gigi-font-size-xs);
    border-radius: var(--gigi-radius-sm);
    transition: all var(--gigi-transition-fast);
  }

  .toggle-btn:hover {
    background: var(--gigi-bg-hover);
    color: var(--gigi-text-primary);
  }
</style>
