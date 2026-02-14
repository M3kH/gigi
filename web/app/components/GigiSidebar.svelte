<script lang="ts">
  /** Section B: Chat list / conversation sidebar */
  import { getPanelState, type PanelState } from '$lib/stores/panels.svelte'
  import { newConversation, loadConversations } from '$lib/stores/chat.svelte'
  import ChatList from '$components/chat/ChatList.svelte'
  import { onMount } from 'svelte'

  const state: PanelState = $derived(getPanelState('sidebar'))
  const isCompact = $derived(state === 'compact')

  onMount(() => {
    loadConversations()
  })

  function handleNewChat() {
    newConversation()
  }
</script>

<aside class="gigi-sidebar" class:compact={isCompact}>
  <header class="section-header">
    {#if !isCompact}
      <span class="section-icon">💬</span>
      <h2>Chats</h2>
    {:else}
      <span class="section-icon">💬</span>
    {/if}
  </header>

  <div class="section-body">
    {#if !isCompact}
      <ChatList compact={isCompact} />
    {/if}
  </div>

  <footer class="section-footer">
    {#if !isCompact}
      <button class="new-chat-btn" onclick={handleNewChat}>+ New Chat</button>
    {:else}
      <button class="new-chat-btn compact" title="New Chat" onclick={handleNewChat}>+</button>
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
