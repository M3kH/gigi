<script lang="ts">
  /** Section B: Chat list / conversation sidebar */
  import { getPanelState, type PanelState } from '$lib/stores/panels.svelte'

  const state: PanelState = $derived(getPanelState('sidebar'))
</script>

<aside class="gigi-sidebar" class:compact={state === 'compact'}>
  <header class="section-header">
    {#if state === 'full'}
      <span class="section-icon">💬</span>
      <h2>Chats</h2>
    {:else}
      <span class="section-icon">💬</span>
    {/if}
  </header>

  <div class="section-body">
    {#if state === 'full'}
      <div class="chat-list">
        <div class="chat-item active">
          <div class="chat-title">New conversation</div>
          <div class="chat-preview">Start chatting with Gigi...</div>
        </div>
      </div>
    {/if}
  </div>

  <footer class="section-footer">
    {#if state === 'full'}
      <button class="new-chat-btn">+ New Chat</button>
    {:else}
      <button class="new-chat-btn compact" title="New Chat">+</button>
    {/if}
  </footer>
</aside>

<style>
  .gigi-sidebar {
    height: 100%;
    display: flex;
    flex-direction: column;
    background: var(--gigi-bg-secondary);
    width: var(--gigi-sidebar-width);
    min-width: var(--gigi-sidebar-width);
    transition: width var(--gigi-transition-normal), min-width var(--gigi-transition-normal);
  }

  .gigi-sidebar.compact {
    width: var(--gigi-sidebar-compact);
    min-width: var(--gigi-sidebar-compact);
  }

  .section-header {
    display: flex;
    align-items: center;
    gap: var(--gigi-space-sm);
    padding: var(--gigi-space-sm) var(--gigi-space-md);
    border-bottom: var(--gigi-border-width) solid var(--gigi-border-default);
    min-height: var(--gigi-topbar-height);
  }

  .section-header h2 {
    font-size: var(--gigi-font-size-sm);
    font-weight: 600;
    color: var(--gigi-text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .section-icon {
    font-size: var(--gigi-font-size-base);
  }

  .section-body {
    flex: 1;
    overflow-y: auto;
  }

  .chat-list {
    display: flex;
    flex-direction: column;
  }

  .chat-item {
    padding: var(--gigi-space-sm) var(--gigi-space-md);
    cursor: pointer;
    border-bottom: var(--gigi-border-width) solid var(--gigi-border-muted);
    transition: background var(--gigi-transition-fast);
  }

  .chat-item:hover {
    background: var(--gigi-bg-hover);
  }

  .chat-item.active {
    background: var(--gigi-bg-active);
    border-left: 2px solid var(--gigi-accent-green);
  }

  .chat-title {
    font-size: var(--gigi-font-size-sm);
    font-weight: 500;
    color: var(--gigi-text-primary);
    margin-bottom: 2px;
  }

  .chat-preview {
    font-size: var(--gigi-font-size-xs);
    color: var(--gigi-text-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .section-footer {
    padding: var(--gigi-space-sm);
    border-top: var(--gigi-border-width) solid var(--gigi-border-default);
  }

  .new-chat-btn {
    width: 100%;
    padding: var(--gigi-space-sm) var(--gigi-space-md);
    background: var(--gigi-bg-tertiary);
    border: var(--gigi-border-width) solid var(--gigi-border-default);
    border-radius: var(--gigi-radius-md);
    color: var(--gigi-text-secondary);
    cursor: pointer;
    font-size: var(--gigi-font-size-sm);
    transition: all var(--gigi-transition-fast);
  }

  .new-chat-btn:hover {
    background: var(--gigi-bg-hover);
    color: var(--gigi-text-primary);
  }

  .new-chat-btn.compact {
    padding: var(--gigi-space-sm);
    font-size: var(--gigi-font-size-lg);
    text-align: center;
  }
</style>
