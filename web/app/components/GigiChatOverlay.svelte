<script lang="ts">
  /** Section F: Chat overlay / input area */
  import { getPanelState, togglePanel, type PanelState } from '$lib/stores/panels.svelte'
  import { getWSClient } from '$lib/stores/connection.svelte'

  const state: PanelState = $derived(getPanelState('chatOverlay'))

  let inputValue = $state('')
  let inputEl: HTMLTextAreaElement | undefined = $state()

  function handleSend() {
    const msg = inputValue.trim()
    if (!msg) return

    const ws = getWSClient()
    ws.send({
      type: 'chat:send',
      message: msg,
    })

    inputValue = ''
    if (inputEl) {
      inputEl.style.height = 'auto'
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  function autoResize(e: Event) {
    const el = e.target as HTMLTextAreaElement
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 200) + 'px'
  }
</script>

{#if state !== 'hidden'}
  <div class="gigi-chat-overlay" class:compact={state === 'compact'}>
    <header class="overlay-header">
      <span class="overlay-title">Chat</span>
      <button
        class="toggle-btn"
        onclick={() => togglePanel('chatOverlay')}
        title="Toggle chat overlay"
      >
        {state === 'compact' ? '▲' : '▼'}
      </button>
    </header>

    {#if state === 'full'}
      <div class="messages-area">
        <p class="empty-state">Send a message to get started</p>
      </div>

      <div class="input-area">
        <textarea
          bind:this={inputEl}
          bind:value={inputValue}
          onkeydown={handleKeydown}
          oninput={autoResize}
          placeholder="Message Gigi..."
          rows="1"
          class="chat-input"
        ></textarea>
        <button
          class="send-btn"
          onclick={handleSend}
          disabled={!inputValue.trim()}
          title="Send message"
        >
          ↑
        </button>
      </div>
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
  }

  .overlay-title {
    font-size: var(--gigi-font-size-xs);
    font-weight: 600;
    color: var(--gigi-text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.05em;
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

  .messages-area {
    flex: 1;
    overflow-y: auto;
    padding: var(--gigi-space-md);
  }

  .empty-state {
    color: var(--gigi-text-muted);
    font-size: var(--gigi-font-size-sm);
    text-align: center;
    padding: var(--gigi-space-xl);
  }

  .input-area {
    display: flex;
    align-items: flex-end;
    gap: var(--gigi-space-sm);
    padding: var(--gigi-space-sm) var(--gigi-space-md);
    border-top: var(--gigi-border-width) solid var(--gigi-border-muted);
  }

  .chat-input {
    flex: 1;
    background: var(--gigi-bg-tertiary);
    border: var(--gigi-border-width) solid var(--gigi-border-default);
    border-radius: var(--gigi-radius-md);
    color: var(--gigi-text-primary);
    padding: var(--gigi-space-sm) var(--gigi-space-md);
    font-family: var(--gigi-font-sans);
    font-size: var(--gigi-font-size-base);
    resize: none;
    line-height: 1.5;
    max-height: 200px;
  }

  .chat-input::placeholder {
    color: var(--gigi-text-muted);
  }

  .chat-input:focus {
    outline: none;
    border-color: var(--gigi-accent-green);
    box-shadow: 0 0 0 1px var(--gigi-accent-green);
  }

  .send-btn {
    width: 36px;
    height: 36px;
    border-radius: var(--gigi-radius-md);
    background: var(--gigi-accent-green);
    border: none;
    color: white;
    font-size: var(--gigi-font-size-lg);
    font-weight: 700;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all var(--gigi-transition-fast);
    flex-shrink: 0;
  }

  .send-btn:hover:not(:disabled) {
    filter: brightness(1.15);
  }

  .send-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
</style>
