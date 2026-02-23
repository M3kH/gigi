<script lang="ts">
  /**
   * Onboarding — Setup wizard for first-run configuration
   *
   * Shows three steps: Claude (required), Telegram (optional), Gitea (auto).
   * Setup is "complete" when the Claude token is configured.
   */

  import {
    getSetupStatus,
    submitSetup,
    dismissSetup,
    type SetupStatus,
    type SetupResult,
  } from '$lib/stores/setup.svelte'

  // ── Form state ───────────────────────────────────────────────────────

  let claudeToken = $state('')
  let telegramToken = $state('')
  let giteaUrl = $state('')
  let giteaToken = $state('')

  let submitting = $state<string | null>(null)
  let feedback = $state<Record<string, { ok: boolean; message: string }>>({})

  const status: SetupStatus | null = $derived(getSetupStatus())

  // ── Handlers ─────────────────────────────────────────────────────────

  async function handleSubmit(step: string) {
    submitting = step
    feedback = { ...feedback, [step]: undefined! }

    let data: Record<string, string>
    switch (step) {
      case 'claude':
        data = { token: claudeToken }
        break
      case 'telegram':
        data = { token: telegramToken }
        break
      case 'gitea':
        data = { url: giteaUrl, token: giteaToken }
        break
      default:
        return
    }

    const result: SetupResult = await submitSetup(step, data)
    feedback = {
      ...feedback,
      [step]: {
        ok: result.ok,
        message: result.ok ? (result.message ?? 'Saved') : (result.error ?? 'Failed'),
      },
    }
    submitting = null
  }
</script>

<div class="onboarding">
  <div class="card">
    <header>
      <h1>Gigi Setup</h1>
      <p class="subtitle">Let's get me running. One step at a time.</p>
    </header>

    <!-- Claude (required) -->
    <section class="step" class:done={status?.claude}>
      <div class="step-header">
        <span class="indicator" class:done={status?.claude}>
          {#if status?.claude}&#10003;{/if}
        </span>
        <div>
          <h2>Claude API</h2>
          <p class="hint">Required — OAuth token for the agent</p>
        </div>
      </div>

      {#if !status?.claude}
        <form onsubmit={(e) => { e.preventDefault(); handleSubmit('claude') }}>
          <input
            type="password"
            placeholder="sk-ant-..."
            bind:value={claudeToken}
            disabled={submitting === 'claude'}
          />
          <button type="submit" disabled={!claudeToken.trim() || submitting === 'claude'}>
            {submitting === 'claude' ? 'Saving...' : 'Save'}
          </button>
        </form>
        {#if feedback.claude}
          <p class="feedback" class:error={!feedback.claude.ok}>{feedback.claude.message}</p>
        {/if}
      {/if}
    </section>

    <!-- Telegram (optional) -->
    <section class="step" class:done={status?.telegram}>
      <div class="step-header">
        <span class="indicator" class:done={status?.telegram}>
          {#if status?.telegram}&#10003;{/if}
        </span>
        <div>
          <h2>Telegram Bot</h2>
          <p class="hint">Optional — for notifications and chat</p>
        </div>
      </div>

      {#if !status?.telegram}
        <form onsubmit={(e) => { e.preventDefault(); handleSubmit('telegram') }}>
          <input
            type="password"
            placeholder="123456:ABC-DEF..."
            bind:value={telegramToken}
            disabled={submitting === 'telegram'}
          />
          <button type="submit" disabled={!telegramToken.trim() || submitting === 'telegram'}>
            {submitting === 'telegram' ? 'Saving...' : 'Save'}
          </button>
        </form>
        {#if feedback.telegram}
          <p class="feedback" class:error={!feedback.telegram.ok}>{feedback.telegram.message}</p>
        {/if}
      {/if}
    </section>

    <!-- Gitea (usually auto-configured) -->
    <section class="step" class:done={status?.gitea}>
      <div class="step-header">
        <span class="indicator" class:done={status?.gitea}>
          {#if status?.gitea}&#10003;{/if}
        </span>
        <div>
          <h2>Gitea</h2>
          <p class="hint">{status?.gitea ? 'Auto-configured' : 'Git hosting and CI'}</p>
        </div>
      </div>

      {#if !status?.gitea}
        <form onsubmit={(e) => { e.preventDefault(); handleSubmit('gitea') }}>
          <input
            type="url"
            placeholder="http://localhost:3300"
            bind:value={giteaUrl}
            disabled={submitting === 'gitea'}
          />
          <input
            type="password"
            placeholder="Gitea token"
            bind:value={giteaToken}
            disabled={submitting === 'gitea'}
          />
          <button type="submit" disabled={(!giteaUrl.trim() || !giteaToken.trim()) || submitting === 'gitea'}>
            {submitting === 'gitea' ? 'Saving...' : 'Save'}
          </button>
        </form>
        {#if feedback.gitea}
          <p class="feedback" class:error={!feedback.gitea.ok}>{feedback.gitea.message}</p>
        {/if}
      {/if}
    </section>

    <!-- Continue button — appears once Claude (required step) is configured -->
    {#if status?.claude}
      <div class="continue">
        <button class="continue-btn" onclick={dismissSetup}>
          Continue to chat
        </button>
      </div>
    {/if}
  </div>
</div>

<style>
  .onboarding {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
    padding: var(--gigi-space-lg);
    background: var(--gigi-bg-primary);
  }

  .card {
    width: 100%;
    max-width: 480px;
    background: var(--gigi-bg-secondary);
    border: 1px solid var(--gigi-border-default);
    border-radius: var(--gigi-radius-md);
    padding: var(--gigi-space-2xl);
  }

  header {
    margin-bottom: var(--gigi-space-2xl);
  }

  h1 {
    margin: 0;
    font-size: 1.5rem;
    font-weight: 600;
    color: var(--gigi-text-primary);
  }

  .subtitle {
    margin: var(--gigi-space-sm) 0 0;
    color: var(--gigi-text-secondary);
    font-size: var(--gigi-font-size-base);
  }

  .step {
    padding: var(--gigi-space-lg);
    margin-bottom: var(--gigi-space-md);
    background: var(--gigi-bg-tertiary);
    border: 1px solid var(--gigi-border-default);
    border-radius: var(--gigi-radius-sm);
  }

  .step.done {
    border-color: color-mix(in srgb, var(--gigi-accent-green) 40%, transparent);
  }

  .step-header {
    display: flex;
    align-items: center;
    gap: var(--gigi-space-md);
  }

  .indicator {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    min-width: 24px;
    border-radius: 50%;
    border: 2px solid var(--gigi-border-default);
    font-size: 0.75rem;
    color: var(--gigi-text-muted);
  }

  .indicator.done {
    border-color: var(--gigi-accent-green);
    color: var(--gigi-accent-green);
    background: color-mix(in srgb, var(--gigi-accent-green) 10%, transparent);
  }

  h2 {
    margin: 0;
    font-size: var(--gigi-font-size-base);
    font-weight: 500;
    color: var(--gigi-text-primary);
  }

  .hint {
    margin: 2px 0 0;
    font-size: var(--gigi-font-size-sm);
    color: var(--gigi-text-muted);
  }

  form {
    display: flex;
    flex-direction: column;
    gap: var(--gigi-space-sm);
    margin-top: var(--gigi-space-md);
  }

  input {
    padding: var(--gigi-space-sm) var(--gigi-space-md);
    background: var(--gigi-bg-primary);
    border: 1px solid var(--gigi-border-default);
    border-radius: var(--gigi-radius-sm);
    color: var(--gigi-text-primary);
    font-family: var(--gigi-font-mono);
    font-size: var(--gigi-font-size-sm);
    outline: none;
  }

  input::placeholder {
    color: var(--gigi-text-muted);
  }

  input:focus {
    border-color: var(--gigi-accent-blue);
  }

  input:disabled {
    opacity: 0.5;
  }

  button {
    align-self: flex-end;
    padding: var(--gigi-space-sm) var(--gigi-space-lg);
    background: var(--gigi-accent-blue);
    color: var(--gigi-bg-primary);
    border: none;
    border-radius: var(--gigi-radius-sm);
    font-size: var(--gigi-font-size-sm);
    font-weight: 500;
    cursor: pointer;
  }

  button:hover:not(:disabled) {
    filter: brightness(1.1);
  }

  button:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .feedback {
    margin: var(--gigi-space-sm) 0 0;
    font-size: var(--gigi-font-size-sm);
    color: var(--gigi-accent-green);
  }

  .feedback.error {
    color: var(--gigi-accent-red);
  }

  .continue {
    margin-top: var(--gigi-space-xl);
    text-align: center;
  }

  .continue-btn {
    width: 100%;
    padding: var(--gigi-space-md) var(--gigi-space-xl);
    background: var(--gigi-accent-green);
    color: var(--gigi-bg-primary);
    border: none;
    border-radius: var(--gigi-radius-sm);
    font-size: var(--gigi-font-size-base);
    font-weight: 600;
    cursor: pointer;
  }

  .continue-btn:hover {
    filter: brightness(1.1);
  }
</style>
