<script lang="ts">
  /** Section B: Chat list / conversation sidebar */
  import { getPanelState, setPanelState, togglePanel, type PanelState } from '$lib/stores/panels.svelte'
  import { newConversation, loadConversations, setSearchQuery, clearSearch, getSearchQuery } from '$lib/stores/chat.svelte'
  import ChatList from '$components/chat/ChatList.svelte'
  import { onMount } from 'svelte'

  const state: PanelState = $derived(getPanelState('sidebar'))
  const query = $derived(getSearchQuery())

  let searchInput: HTMLInputElement | undefined = $state()

  onMount(() => {
    loadConversations()
  })

  function handleNewChat() {
    newConversation()
    clearSearch()
    // Ensure chat overlay is visible so the user sees the textarea
    const chatState = getPanelState('chatOverlay')
    if (chatState === 'hidden') {
      setPanelState('chatOverlay', 'compact')
    }
  }

  function handleCollapse() {
    togglePanel('sidebar')
  }

  function handleSearchInput(e: Event) {
    const value = (e.target as HTMLInputElement).value
    setSearchQuery(value)
  }

  function handleSearchKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      clearSearch()
      searchInput?.blur()
    }
  }

  function handleClearSearch() {
    clearSearch()
    searchInput?.focus()
  }
</script>

<aside class="gigi-sidebar">
  <header class="section-header">
    <span class="section-icon">🤵🏻‍♂️</span>
    <h2>Chats</h2>
    <div class="header-spacer"></div>
    <button class="collapse-btn" onclick={handleCollapse} title="Collapse sidebar (Ctrl+B)">
      <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14">
        <path d="M16 5v2h-2V5h2zm-4 4V7h2v2h-2zm-2 2V9h2v2h-2zm0 2H8v-2h2v2zm2 2v-2h-2v2h2zm0 0h2v2h-2v-2zm4 4v-2h-2v2h2z"/>
      </svg>
    </button>
  </header>

  <div class="search-bar">
    <svg class="search-icon" viewBox="0 0 16 16" width="13" height="13" fill="currentColor">
      <path d="M10.68 11.74a6 6 0 0 1-7.922-8.982 6 6 0 0 1 8.982 7.922l3.04 3.04a.749.749 0 0 1-.326 1.275.749.749 0 0 1-.734-.215ZM11.5 7a4.499 4.499 0 1 0-8.997 0A4.499 4.499 0 0 0 11.5 7Z"/>
    </svg>
    <input
      bind:this={searchInput}
      type="text"
      class="search-input"
      placeholder="Search chats..."
      value={query}
      oninput={handleSearchInput}
      onkeydown={handleSearchKeydown}
    />
    {#if query}
      <button class="search-clear" onclick={handleClearSearch} title="Clear search (Esc)">
        <svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor">
          <path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.749.749 0 0 1 1.275.326.749.749 0 0 1-.215.734L9.06 8l3.22 3.22a.749.749 0 0 1-.326 1.275.749.749 0 0 1-.734-.215L8 9.06l-3.22 3.22a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z"/>
        </svg>
      </button>
    {/if}
  </div>

  <div class="section-body">
    <ChatList />
  </div>

  <footer class="section-footer">
    <button class="new-chat-btn" onclick={handleNewChat}>+ New Chat</button>
  </footer>
</aside>

<style>
  .gigi-sidebar {
    height: 100%;
    display: flex;
    flex-direction: column;
    background: var(--gigi-bg-secondary);
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

  .header-spacer {
    flex: 1;
  }

  .collapse-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    background: none;
    border: none;
    color: var(--gigi-text-muted);
    cursor: pointer;
    padding: 2px;
    border-radius: var(--gigi-radius-sm);
    transition: all var(--gigi-transition-fast);
    flex-shrink: 0;
  }

  .collapse-btn:hover {
    color: var(--gigi-text-primary);
    background: var(--gigi-bg-hover);
  }

  .search-bar {
    display: flex;
    align-items: center;
    gap: var(--gigi-space-xs);
    padding: var(--gigi-space-xs) var(--gigi-space-sm);
    border-bottom: var(--gigi-border-width) solid var(--gigi-border-default);
    position: relative;
  }

  .search-icon {
    color: var(--gigi-text-muted);
    flex-shrink: 0;
  }

  .search-input {
    flex: 1;
    background: var(--gigi-bg-tertiary);
    border: var(--gigi-border-width) solid var(--gigi-border-muted);
    border-radius: var(--gigi-radius-sm);
    padding: 4px 24px 4px 6px;
    font-size: var(--gigi-font-size-xs);
    color: var(--gigi-text-primary);
    font-family: var(--gigi-font-sans);
    outline: none;
    transition: border-color var(--gigi-transition-fast);
    min-width: 0;
  }

  .search-input::placeholder {
    color: var(--gigi-text-muted);
  }

  .search-input:focus {
    border-color: var(--gigi-accent-blue);
  }

  .search-clear {
    position: absolute;
    right: calc(var(--gigi-space-sm) + 2px);
    background: none;
    border: none;
    color: var(--gigi-text-muted);
    cursor: pointer;
    padding: 2px;
    display: flex;
    align-items: center;
    border-radius: var(--gigi-radius-sm);
  }

  .search-clear:hover {
    color: var(--gigi-text-primary);
    background: var(--gigi-bg-hover);
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
</style>
