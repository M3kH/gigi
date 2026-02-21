<script lang="ts">
  /**
   * Add Reference Dialog — lets user link an issue/PR to the current thread.
   *
   * Accepts a repo/number format like "gigi#44" or a full "owner/repo#44".
   * Calls the thread refs API to persist the link.
   */

  interface Props {
    threadId: string
    onClose: () => void
    onAdded: () => void
  }

  const { threadId, onClose, onAdded }: Props = $props()

  let refInput = $state('')
  let refType = $state<'issue' | 'pr'>('issue')
  let loading = $state(false)
  let error = $state('')

  // Parse "repo#42" or "owner/repo#42" format
  function parseRef(input: string): { repo: string; number: number } | null {
    const trimmed = input.trim()
    // Match "repo#N" or "owner/repo#N"
    const match = trimmed.match(/^(?:([a-zA-Z0-9._-]+)\/)?([a-zA-Z0-9._-]+)#(\d+)$/)
    if (!match) return null
    const owner = match[1] || 'idea'
    const repo = match[2]
    const number = parseInt(match[3])
    return { repo: `${owner}/${repo}`, number }
  }

  const parsed = $derived(parseRef(refInput))
  const isValid = $derived(parsed !== null)

  async function handleSubmit() {
    if (!parsed || loading) return
    loading = true
    error = ''

    try {
      const res = await fetch(`/api/threads/${threadId}`, { method: 'GET' })
      if (!res.ok) throw new Error('Thread not found')

      // Add the ref via the thread refs endpoint
      const addRes = await fetch(`/api/threads/${threadId}/refs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ref_type: refType,
          repo: parsed.repo,
          number: parsed.number,
        }),
      })

      if (!addRes.ok) {
        const data = await addRes.json().catch(() => ({}))
        throw new Error(data.error || `Failed to add ref (${addRes.status})`)
      }

      onAdded()
      onClose()
    } catch (err) {
      error = (err as Error).message
    } finally {
      loading = false
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') onClose()
    if (e.key === 'Enter' && isValid) handleSubmit()
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="dialog-backdrop" onclick={onClose} onkeydown={handleKeydown}>
  <!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
  <div class="dialog" onclick={(e) => e.stopPropagation()}>
    <div class="dialog-header">
      <span class="dialog-title">🔗 Link Reference</span>
      <button class="dialog-close" onclick={onClose}>&times;</button>
    </div>

    <div class="dialog-body">
      <label class="field-label">
        Reference
        <input
          class="field-input"
          type="text"
          bind:value={refInput}
          placeholder="gigi#44 or idea/gigi#44"
          onkeydown={handleKeydown}
        />
      </label>

      <div class="type-toggle">
        <button
          class="type-btn"
          class:active={refType === 'issue'}
          onclick={() => refType = 'issue'}
        >📋 Issue</button>
        <button
          class="type-btn"
          class:active={refType === 'pr'}
          onclick={() => refType = 'pr'}
        >🔀 PR</button>
      </div>

      {#if parsed}
        <div class="preview">
          Linking {refType} <strong>{parsed.repo}#{parsed.number}</strong> to this thread
        </div>
      {/if}

      {#if error}
        <div class="error">{error}</div>
      {/if}
    </div>

    <div class="dialog-footer">
      <button class="btn btn-cancel" onclick={onClose}>Cancel</button>
      <button
        class="btn btn-primary"
        disabled={!isValid || loading}
        onclick={handleSubmit}
      >
        {loading ? 'Linking...' : 'Link'}
      </button>
    </div>
  </div>
</div>

<style>
  .dialog-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
  }

  .dialog {
    background: var(--gigi-bg-secondary);
    border: 1px solid var(--gigi-border-default);
    border-radius: var(--gigi-radius-lg);
    width: min(380px, 90vw);
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
  }

  .dialog-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--gigi-space-sm) var(--gigi-space-md);
    border-bottom: 1px solid var(--gigi-border-muted);
  }

  .dialog-title {
    font-size: var(--gigi-font-size-sm);
    font-weight: 600;
    color: var(--gigi-text-primary);
  }

  .dialog-close {
    background: none;
    border: none;
    color: var(--gigi-text-muted);
    font-size: 1.2rem;
    cursor: pointer;
    padding: 0 4px;
    line-height: 1;
  }

  .dialog-close:hover {
    color: var(--gigi-text-primary);
  }

  .dialog-body {
    padding: var(--gigi-space-md);
    display: flex;
    flex-direction: column;
    gap: var(--gigi-space-sm);
  }

  .field-label {
    font-size: var(--gigi-font-size-xs);
    color: var(--gigi-text-muted);
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .field-input {
    background: var(--gigi-bg-primary);
    border: 1px solid var(--gigi-border-default);
    border-radius: var(--gigi-radius-sm);
    padding: var(--gigi-space-xs) var(--gigi-space-sm);
    color: var(--gigi-text-primary);
    font-size: var(--gigi-font-size-sm);
    font-family: var(--gigi-font-mono, monospace);
    outline: none;
  }

  .field-input:focus {
    border-color: var(--gigi-accent-blue);
  }

  .type-toggle {
    display: flex;
    gap: var(--gigi-space-xs);
  }

  .type-btn {
    flex: 1;
    padding: var(--gigi-space-xs) var(--gigi-space-sm);
    background: var(--gigi-bg-tertiary);
    border: 1px solid var(--gigi-border-muted);
    border-radius: var(--gigi-radius-sm);
    color: var(--gigi-text-muted);
    font-size: var(--gigi-font-size-xs);
    cursor: pointer;
    font-family: var(--gigi-font-sans);
    transition: all var(--gigi-transition-fast);
  }

  .type-btn.active {
    background: var(--gigi-bg-hover);
    border-color: var(--gigi-accent-blue);
    color: var(--gigi-text-primary);
  }

  .type-btn:hover:not(.active) {
    background: var(--gigi-bg-hover);
  }

  .preview {
    font-size: var(--gigi-font-size-xs);
    color: var(--gigi-text-muted);
    padding: var(--gigi-space-xs) var(--gigi-space-sm);
    background: var(--gigi-bg-tertiary);
    border-radius: var(--gigi-radius-sm);
  }

  .error {
    font-size: var(--gigi-font-size-xs);
    color: var(--gigi-accent-red, #f85149);
    padding: var(--gigi-space-xs) var(--gigi-space-sm);
    background: rgba(248, 81, 73, 0.1);
    border-radius: var(--gigi-radius-sm);
  }

  .dialog-footer {
    display: flex;
    justify-content: flex-end;
    gap: var(--gigi-space-xs);
    padding: var(--gigi-space-sm) var(--gigi-space-md);
    border-top: 1px solid var(--gigi-border-muted);
  }

  .btn {
    padding: var(--gigi-space-xs) var(--gigi-space-md);
    border-radius: var(--gigi-radius-sm);
    font-size: var(--gigi-font-size-xs);
    cursor: pointer;
    font-family: var(--gigi-font-sans);
    border: 1px solid var(--gigi-border-muted);
    transition: all var(--gigi-transition-fast);
  }

  .btn-cancel {
    background: var(--gigi-bg-tertiary);
    color: var(--gigi-text-muted);
  }

  .btn-cancel:hover {
    background: var(--gigi-bg-hover);
  }

  .btn-primary {
    background: var(--gigi-accent-blue, #58a6ff);
    color: #fff;
    border-color: transparent;
  }

  .btn-primary:hover:not(:disabled) {
    filter: brightness(1.1);
  }

  .btn-primary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
