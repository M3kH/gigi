<script lang="ts">
  /**
   * Chat text input with auto-resize, Enter-to-send, and per-conversation draft persistence
   *
   * Fires `onsend` with the message string. Handles Shift+Enter for newlines.
   * Persists draft text per conversation to localStorage so it survives page
   * refreshes and conversation switches. Drafts expire after 30 minutes.
   */
  import { onMount } from 'svelte'
  import { saveDraft, loadDraft, clearDraft, cleanStaleDrafts } from '$lib/utils/draft'

  interface Props {
    onsend: (message: string) => void
    conversationId?: string | null
    placeholder?: string
    disabled?: boolean
    autofocus?: boolean
  }

  const {
    onsend,
    conversationId = null,
    placeholder = 'Message Gigi...',
    disabled = false,
    autofocus = false,
  }: Props = $props()

  let inputValue = $state('')
  let inputEl: HTMLTextAreaElement | undefined = $state()

  // Track previous conversation ID for save-on-switch
  let prevConvId: string | null | undefined = undefined

  // Focus the textarea when autofocus becomes true (e.g. new chat)
  $effect(() => {
    if (autofocus && inputEl) {
      requestAnimationFrame(() => inputEl?.focus())
    }
  })

  // React to conversation switches: save old draft, load new one
  $effect(() => {
    const currentId = conversationId

    // Skip the very first run (handled by onMount)
    if (prevConvId === undefined) {
      prevConvId = currentId
      return
    }

    // If conversation actually changed
    if (currentId !== prevConvId) {
      // Save draft for the conversation we're leaving
      saveDraft(localStorage, prevConvId, inputValue)

      // Load draft for the conversation we're entering
      const restored = loadDraft(localStorage, currentId)
      inputValue = restored ?? ''

      // Resize textarea to fit restored content
      requestAnimationFrame(() => {
        if (inputEl) {
          inputEl.style.height = 'auto'
          inputEl.style.height = Math.min(inputEl.scrollHeight, 200) + 'px'
        }
      })

      prevConvId = currentId
    }
  })

  // Allow parent to set initial value (e.g. pre-filled fork summary)
  export function setValue(text: string): void {
    inputValue = text
    requestAnimationFrame(() => {
      if (inputEl) {
        inputEl.style.height = 'auto'
        inputEl.style.height = Math.min(inputEl.scrollHeight, 200) + 'px'
        inputEl.focus()
      }
    })
  }

  // Restore draft from localStorage on mount + clean stale drafts
  onMount(() => {
    cleanStaleDrafts(localStorage)

    const restored = loadDraft(localStorage, conversationId)
    if (restored) {
      inputValue = restored
      requestAnimationFrame(() => {
        if (inputEl) {
          inputEl.style.height = 'auto'
          inputEl.style.height = Math.min(inputEl.scrollHeight, 200) + 'px'
        }
      })
    }
  })

  // Sync draft to localStorage on every input change
  function syncDraft() {
    saveDraft(localStorage, conversationId, inputValue)
  }

  function handleSend() {
    const msg = inputValue.trim()
    if (!msg || disabled) return

    onsend(msg)
    inputValue = ''
    clearDraft(localStorage, conversationId)

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
    /* Push input above Safari's bottom navigation bar */
    padding-bottom: max(var(--gigi-space-sm), env(safe-area-inset-bottom, 0px));
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
