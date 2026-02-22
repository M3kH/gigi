<script lang="ts">
  /**
   * Chat text input with auto-resize, Enter-to-send, and per-conversation draft persistence
   *
   * Fires `onsend` with the message string. Handles Shift+Enter for newlines.
   * Persists draft text per conversation to localStorage so it survives page
   * refreshes and conversation switches. Drafts expire after 30 minutes.
   */
  import { onMount } from 'svelte'

  const DRAFT_PREFIX = 'gigi:draft:'
  const DRAFT_MAX_AGE_MS = 30 * 60 * 1000 // 30 minutes

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

  /** Derive the localStorage key for a given conversation */
  function draftKey(convId: string | null | undefined): string {
    return `${DRAFT_PREFIX}${convId ?? 'new'}`
  }

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
      saveDraft(prevConvId)

      // Load draft for the conversation we're entering
      const restored = loadDraft(currentId)
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
    cleanStaleDrafts()

    const restored = loadDraft(conversationId)
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

  /** Save draft text + timestamp to localStorage */
  function saveDraft(convId: string | null | undefined) {
    try {
      const key = draftKey(convId)
      const text = inputValue.trim()
      if (text) {
        localStorage.setItem(key, JSON.stringify({ text: inputValue, ts: Date.now() }))
      } else {
        localStorage.removeItem(key)
      }
    } catch { /* ignore quota errors */ }
  }

  /** Load draft text from localStorage, returning null if stale or missing */
  function loadDraft(convId: string | null | undefined): string | null {
    try {
      const key = draftKey(convId)
      const raw = localStorage.getItem(key)
      if (!raw) return null
      const { text, ts } = JSON.parse(raw)
      if (Date.now() - ts > DRAFT_MAX_AGE_MS) {
        localStorage.removeItem(key)
        return null
      }
      return text ?? null
    } catch {
      return null
    }
  }

  /** Remove all draft entries older than 30 minutes */
  function cleanStaleDrafts() {
    try {
      const now = Date.now()
      const keysToRemove: string[] = []
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i)
        if (!key?.startsWith(DRAFT_PREFIX)) continue
        try {
          const { ts } = JSON.parse(localStorage.getItem(key)!)
          if (now - ts > DRAFT_MAX_AGE_MS) keysToRemove.push(key)
        } catch {
          keysToRemove.push(key) // corrupt entry, remove it
        }
      }
      keysToRemove.forEach((k) => localStorage.removeItem(k))
    } catch { /* ignore */ }
  }

  /** Clear the draft for the current conversation */
  function clearDraft() {
    try {
      localStorage.removeItem(draftKey(conversationId))
    } catch { /* ignore */ }
  }

  // Sync draft to localStorage on every input change
  function syncDraft() {
    saveDraft(conversationId)
  }

  function handleSend() {
    const msg = inputValue.trim()
    if (!msg || disabled) return

    onsend(msg)
    inputValue = ''
    clearDraft()

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
