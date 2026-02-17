<script lang="ts">
  /**
   * Chat text input with auto-resize, Enter-to-send, and localStorage draft sync
   *
   * Fires `onsend` with the message string. Handles Shift+Enter for newlines.
   * Persists draft text to localStorage so it survives page refreshes.
   */
  import { onMount } from 'svelte'

  const DRAFT_KEY = 'gigi:chat-draft'

  interface Props {
    onsend: (message: string) => void
    placeholder?: string
    disabled?: boolean
  }

  const { onsend, placeholder = 'Message Gigi...', disabled = false }: Props = $props()

  let inputValue = $state('')
  let inputEl: HTMLTextAreaElement | undefined = $state()

  // Restore draft from localStorage on mount
  onMount(() => {
    try {
      const draft = localStorage.getItem(DRAFT_KEY)
      if (draft) {
        inputValue = draft
        // Trigger auto-resize after restoring
        requestAnimationFrame(() => {
          if (inputEl) {
            inputEl.style.height = 'auto'
            inputEl.style.height = Math.min(inputEl.scrollHeight, 200) + 'px'
          }
        })
      }
    } catch { /* ignore */ }
  })

  // Sync draft to localStorage on change
  function syncDraft() {
    try {
      if (inputValue.trim()) {
        localStorage.setItem(DRAFT_KEY, inputValue)
      } else {
        localStorage.removeItem(DRAFT_KEY)
      }
    } catch { /* ignore */ }
  }

  function handleSend() {
    const msg = inputValue.trim()
    if (!msg || disabled) return

    onsend(msg)
    inputValue = ''

    // Clear draft from localStorage on send
    try { localStorage.removeItem(DRAFT_KEY) } catch { /* ignore */ }

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
    syncDraft()
  }
</script>

<div class="chat-input-area">
  <textarea
    bind:this={inputEl}
    bind:value={inputValue}
    onkeydown={handleKeydown}
    oninput={autoResize}
    {placeholder}
    {disabled}
    rows="1"
    class="chat-input"
  ></textarea>
  <button
    class="send-btn"
    onclick={handleSend}
    disabled={!inputValue.trim() || disabled}
    title="Send message"
  >
    ↑
  </button>
</div>

<style>
  .chat-input-area {
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

  .chat-input:disabled {
    opacity: 0.5;
    cursor: not-allowed;
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
