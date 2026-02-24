<script lang="ts">
  /**
   * Section A: Kanban Board
   *
   * Full-width kanban board synced with Gitea issues via status/ labels.
   * Features: columns, issue cards, drag-and-drop between columns,
   * label badges, assignee avatars, repo indicators, context menu,
   * quick-create issues, clickable linked PRs/chats, priority sorting.
   */

  import { onMount } from 'svelte'
  import {
    fetchBoard,
    getColumns,
    getOrgName,
    getTotalIssues,
    getRepos,
    isLoading,
    getError,
    isStale,
    startDrag,
    endDrag,
    getDragState,
    moveCard,
    createIssue,
    getSortMode,
    toggleSortMode,
    type KanbanCard,
    type KanbanColumn,
    type KanbanLabel,
    type SortMode,
  } from '$lib/stores/kanban.svelte'
  import { navigateToIssue, navigateToPull } from '$lib/stores/navigation.svelte'
  import { selectConversation } from '$lib/stores/chat.svelte'
  import { formatRelativeTime } from '$lib/utils/format'
  import { getPanelState, setPanelState, type PanelState } from '$lib/stores/panels.svelte'
  import PanelControls from '$components/ui/PanelControls.svelte'

  // ── Derived State ────────────────────────────────────────────────────

  const columns: KanbanColumn[] = $derived(getColumns())
  const totalIssues: number = $derived(getTotalIssues())
  const availableRepos: string[] = $derived(getRepos())
  const loading: boolean = $derived(isLoading())
  const error: string | null = $derived(getError())
  const drag = $derived(getDragState())
  const kanbanState: PanelState = $derived(getPanelState('kanban'))
  const currentSort: SortMode = $derived(getSortMode())

  // Show columns with cards. Empty columns collapsed.
  const visibleColumns = $derived(
    columns.filter(col => col.cards.length > 0)
  )
  const collapsedColumns = $derived(
    columns.filter(col => col.cards.length === 0)
  )

  // ── Create Issue Modal ────────────────────────────────────────────────

  interface CreateState {
    open: boolean
    repo: string
    title: string
    body: string
    column: string
    submitting: boolean
    error: string | null
  }

  let create = $state<CreateState>({
    open: false, repo: '', title: '', body: '', column: 'backlog', submitting: false, error: null,
  })

  function openCreateModal(columnId?: string): void {
    create = {
      open: true,
      repo: availableRepos[0] ?? '',
      title: '',
      body: '',
      column: columnId ?? 'backlog',
      submitting: false,
      error: null,
    }
  }

  function closeCreateModal(): void {
    create = { ...create, open: false }
  }

  async function handleCreate(): Promise<void> {
    if (!create.title.trim() || !create.repo) return
    create.submitting = true
    create.error = null
    const result = await createIssue(create.repo, create.title.trim(), create.body.trim() || undefined, create.column)
    if (result.ok) {
      closeCreateModal()
    } else {
      create.error = result.error ?? 'Unknown error'
      create.submitting = false
    }
  }

  function handleCreateKeydown(e: KeyboardEvent): void {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      handleCreate()
    }
    if (e.key === 'Escape') {
      closeCreateModal()
    }
  }

  // ── Linked items popover ────────────────────────────────────────────

  interface PopoverState {
    visible: boolean
    x: number
    y: number
    type: 'prs' | 'chats'
    card: KanbanCard | null
  }

  let popover = $state<PopoverState>({
    visible: false, x: 0, y: 0, type: 'prs', card: null,
  })

  function showLinkedPRs(e: MouseEvent, card: KanbanCard): void {
    e.stopPropagation()
    if (card.linked_pr_details.length === 0) return
    popover = { visible: true, x: e.clientX, y: e.clientY, type: 'prs', card }
  }

  function showLinkedChats(e: MouseEvent, card: KanbanCard): void {
    e.stopPropagation()
    if (card.linked_chat_details.length === 0) return
    popover = { visible: true, x: e.clientX, y: e.clientY, type: 'chats', card }
  }

  function closePopover(): void {
    popover = { visible: false, x: 0, y: 0, type: 'prs', card: null }
  }

  function handlePRClick(pr: { repo: string; number: number }): void {
    navigateToPull(getOrgName(), pr.repo, pr.number)
    closePopover()
  }

  function handleChatClick(chatId: string): void {
    selectConversation(chatId)
    closePopover()
  }

  // ── Drag Tracking ───────────────────────────────────────────────────

  let dragOverColumnId = $state<string | null>(null)
  let expandingColumnId = $state<string | null>(null)
  let expandTimer: ReturnType<typeof setTimeout> | null = null

  function handleDragStart(e: DragEvent, card: KanbanCard, columnId: string): void {
    if (!e.dataTransfer) return
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', JSON.stringify({ cardId: card.id, columnId }))
    startDrag(card, columnId)
  }

  function handleDragOver(e: DragEvent, columnId: string): void {
    e.preventDefault()
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
    dragOverColumnId = columnId
  }

  function handleDragLeave(e: DragEvent, columnId: string): void {
    // Only clear if leaving the column entirely
    const related = e.relatedTarget as HTMLElement | null
    const col = (e.currentTarget as HTMLElement)
    if (!related || !col.contains(related)) {
      if (dragOverColumnId === columnId) dragOverColumnId = null
    }
  }

  function handleDrop(e: DragEvent, targetColumnId: string): void {
    e.preventDefault()
    dragOverColumnId = null
    clearExpandTimer()

    if (drag.card && drag.sourceColumnId) {
      moveCard(drag.card, drag.sourceColumnId, targetColumnId)
    }
    endDrag()
  }

  function handleDragEnd(): void {
    dragOverColumnId = null
    clearExpandTimer()
    expandingColumnId = null
    endDrag()
  }

  // ── Collapsed column drag handlers ────────────────────────────────

  function clearExpandTimer(): void {
    if (expandTimer) {
      clearTimeout(expandTimer)
      expandTimer = null
    }
  }

  function handleCollapsedDragOver(e: DragEvent, columnId: string): void {
    e.preventDefault()
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
    dragOverColumnId = columnId

    if (expandingColumnId !== columnId) {
      clearExpandTimer()
      expandingColumnId = columnId
    }
  }

  function handleCollapsedDragLeave(e: DragEvent, columnId: string): void {
    const related = e.relatedTarget as HTMLElement | null
    const badge = (e.currentTarget as HTMLElement)
    if (!related || !badge.contains(related)) {
      if (dragOverColumnId === columnId) dragOverColumnId = null
      if (expandingColumnId === columnId) {
        clearExpandTimer()
        expandingColumnId = null
      }
    }
  }

  function handleCollapsedDrop(e: DragEvent, targetColumnId: string): void {
    e.preventDefault()
    dragOverColumnId = null
    clearExpandTimer()
    expandingColumnId = null

    if (drag.card && drag.sourceColumnId) {
      moveCard(drag.card, drag.sourceColumnId, targetColumnId)
    }
    endDrag()
  }

  // ── Context Menu ──────────────────────────────────────────────────

  interface ContextMenuState {
    visible: boolean
    x: number
    y: number
    card: KanbanCard | null
    sourceColumnId: string | null
  }

  let contextMenu = $state<ContextMenuState>({
    visible: false, x: 0, y: 0, card: null, sourceColumnId: null,
  })

  const contextMenuTargets = $derived(
    contextMenu.sourceColumnId
      ? columns.filter(col => col.id !== contextMenu.sourceColumnId)
      : []
  )

  function handleCardContextMenu(e: MouseEvent, card: KanbanCard, columnId: string): void {
    e.preventDefault()
    contextMenu = { visible: true, x: e.clientX, y: e.clientY, card, sourceColumnId: columnId }
  }

  function handleContextMenuMove(targetColumnId: string): void {
    if (contextMenu.card && contextMenu.sourceColumnId) {
      moveCard(contextMenu.card, contextMenu.sourceColumnId, targetColumnId)
    }
    closeContextMenu()
  }

  function closeContextMenu(): void {
    contextMenu = { visible: false, x: 0, y: 0, card: null, sourceColumnId: null }
  }

  // ── Card interaction ──────────────────────────────────────────────

  function handleCardClick(card: KanbanCard): void {
    navigateToIssue(getOrgName(), card.repo, card.number)
  }

  // ── Label Color Helpers ─────────────────────────────────────────────

  function labelStyle(label: KanbanLabel): string {
    if (!label.color) return ''
    const c = label.color.replace('#', '')
    return `background: #${c}22; color: #${c}; border-color: #${c}44;`
  }

  function isStatusLabel(name: string): boolean {
    return name.startsWith('status/')
  }

  function priorityIcon(labels: KanbanLabel[]): string | null {
    const p = labels.find(l => l.name.startsWith('priority/'))
    if (!p) return null
    const level = p.name.replace('priority/', '')
    switch (level) {
      case 'critical': return '🔴'
      case 'high': return '🟠'
      case 'medium': return '🟡'
      case 'low': return '🟢'
      default: return null
    }
  }

  // ── Lifecycle ───────────────────────────────────────────────────────

  onMount(() => {
    fetchBoard()

    // Auto-refresh every 60s when visible
    const interval = setInterval(() => {
      if (kanbanState !== 'hidden' && isStale()) {
        fetchBoard()
      }
    }, 60_000)

    // Close context menu / popover on click outside or Escape
    function handleGlobalClick() {
      if (contextMenu.visible) closeContextMenu()
      if (popover.visible) closePopover()
    }
    function handleGlobalKeydown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        if (create.open) closeCreateModal()
        if (contextMenu.visible) closeContextMenu()
        if (popover.visible) closePopover()
      }
    }
    document.addEventListener('click', handleGlobalClick)
    document.addEventListener('keydown', handleGlobalKeydown)

    return () => {
      clearInterval(interval)
      clearExpandTimer()
      document.removeEventListener('click', handleGlobalClick)
      document.removeEventListener('keydown', handleGlobalKeydown)
    }
  })
</script>

<section class="gigi-kanban">
  <!-- Header -->
  <header class="board-header">
    <div class="header-left">
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <h2
        class="board-title"
        ondblclick={() => setPanelState('kanban', 'hidden')}
      >Board</h2>
      <span class="board-count">{totalIssues} issues</span>
    </div>
    <div class="header-right">
      <button
        class="sort-btn"
        class:active={currentSort === 'priority'}
        onclick={toggleSortMode}
        title={currentSort === 'priority' ? 'Sort: Priority (click to reset)' : 'Sort by priority'}
      >
        <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><path d="M3 18h6v-2H3v2zM3 6v2h18V6H3zm0 7h12v-2H3v2z"/></svg>
      </button>
      <button class="create-btn" onclick={() => openCreateModal()} title="Quick-create issue">
        <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>
      </button>
      {#if loading}
        <span class="loading-indicator" title="Refreshing...">↻</span>
      {/if}
      <button class="refresh-btn" onclick={fetchBoard} title="Refresh board" disabled={loading}>
        ↻
      </button>
      <PanelControls panel="kanban" state={kanbanState} />
    </div>
  </header>

  <!-- Board body -->
  {#if error && columns.length === 0}
    <div class="board-error">
      <span>Failed to load: {error}</span>
      <button onclick={fetchBoard}>Retry</button>
    </div>
  {:else}
    <div class="board-columns">
      {#each visibleColumns as column (column.id)}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          class="column"
          class:drag-over={dragOverColumnId === column.id}
          ondragover={(e) => handleDragOver(e, column.id)}
          ondragleave={(e) => handleDragLeave(e, column.id)}
          ondrop={(e) => handleDrop(e, column.id)}
        >
          <div class="column-header">
            <span class="column-title">{column.title}</span>
            <div class="column-header-right">
              <span class="column-count">{column.cards.length}</span>
              <button
                class="column-add-btn"
                onclick={() => openCreateModal(column.id)}
                title="Add issue to {column.title}"
              >+</button>
            </div>
          </div>

          <div class="column-body">
            {#each column.cards as card (card.id)}
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <div
                class="card"
                class:dragging={drag.card?.id === card.id}
                draggable="true"
                ondragstart={(e) => handleDragStart(e, card, column.id)}
                ondragend={handleDragEnd}
                onclick={() => handleCardClick(card)}
                oncontextmenu={(e) => handleCardContextMenu(e, card, column.id)}
                role="button"
                tabindex="0"
                onkeydown={(e) => { if (e.key === 'Enter') handleCardClick(card) }}
              >
                <!-- Card header: repo + priority -->
                <div class="card-top">
                  <span class="card-repo">{card.repo}</span>
                  {#if priorityIcon(card.labels)}
                    <span class="card-priority" title="Priority">{priorityIcon(card.labels)}</span>
                  {/if}
                </div>

                <!-- Title -->
                <div class="card-title">
                  <span class="card-number">#{card.number}</span>
                  {card.title}
                </div>

                <!-- Labels (non-status) -->
                {#if card.labels.filter(l => !isStatusLabel(l.name)).length > 0}
                  <div class="card-labels">
                    {#each card.labels.filter(l => !isStatusLabel(l.name)) as label}
                      <span class="card-label" style={labelStyle(label)}>
                        {label.name.replace(/^(type|effort|priority|scope|size)\//, '')}
                      </span>
                    {/each}
                  </div>
                {/if}

                <!-- Footer: assignee + comments + PRs + chats + time -->
                <div class="card-footer">
                  <div class="card-meta">
                    {#if card.linked_prs > 0}
                      <!-- svelte-ignore a11y_no_static_element_interactions -->
                      <span
                        class="card-prs clickable"
                        title="{card.linked_prs} linked PRs — click to view"
                        onclick={(e) => showLinkedPRs(e, card)}
                        onkeydown={(e) => { if (e.key === 'Enter') showLinkedPRs(e as unknown as MouseEvent, card) }}
                        role="button"
                        tabindex="0"
                      >
                        <svg viewBox="0 0 24 24" width="11" height="11" fill="currentColor"><path d="M2 2h8v8H7v12H5V10H2V2zm2 2v4h4V4H4zm8 1h7.09v9H22v8h-8v-8h3.09V7H12V5zm4 11v4h4v-4h-4z"/></svg>
                        {card.linked_prs}
                      </span>
                    {/if}
                    {#if card.linked_chats > 0}
                      <!-- svelte-ignore a11y_no_static_element_interactions -->
                      <span
                        class="card-chats clickable"
                        title="{card.linked_chats} linked chats — click to view"
                        onclick={(e) => showLinkedChats(e, card)}
                        onkeydown={(e) => { if (e.key === 'Enter') showLinkedChats(e as unknown as MouseEvent, card) }}
                        role="button"
                        tabindex="0"
                      >
                        <svg viewBox="0 0 24 24" width="11" height="11" fill="currentColor"><path d="M20 2H2v20h2V4h16v12H6v2H4v2h2v-2h16V2h-2z"/></svg>
                        {card.linked_chats}
                      </span>
                    {/if}
                    {#if card.comments > 0}
                      <span class="card-comments" title="{card.comments} comments">
                        <svg viewBox="0 0 24 24" width="11" height="11" fill="currentColor"><path d="M22 2H2v14h2V4h16v12h-8v2h-2v2H8v-4H2v2h4v4h4v-2h2v-2h10V2z"/></svg> {card.comments}
                      </span>
                    {/if}
                    {#if card.updated_at}
                      <span class="card-time">{formatRelativeTime(card.updated_at)}</span>
                    {/if}
                  </div>
                  {#if card.assignee}
                    <img
                      class="card-avatar"
                      src={card.assignee.avatar_url}
                      alt={card.assignee.login}
                      title={card.assignee.login}
                      width="20"
                      height="20"
                    />
                  {/if}
                </div>
              </div>
            {/each}

            {#if column.cards.length === 0}
              <div class="column-empty">No issues</div>
            {/if}
          </div>
        </div>
      {/each}

      <!-- Collapsed empty columns: now valid drop targets -->
      {#if collapsedColumns.length > 0 && visibleColumns.length > 0}
        <div class="collapsed-columns">
          {#each collapsedColumns as col (col.id)}
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <span
              class="collapsed-badge"
              class:drag-target={dragOverColumnId === col.id}
              class:has-drag={drag.card !== null}
              title="{col.title}: no issues{drag.card ? ' — drop here to move' : ''}"
              ondragover={(e) => handleCollapsedDragOver(e, col.id)}
              ondragleave={(e) => handleCollapsedDragLeave(e, col.id)}
              ondrop={(e) => handleCollapsedDrop(e, col.id)}
            >{col.title} <span class="collapsed-count">0</span></span>
          {/each}
        </div>
      {/if}

      <!-- When all columns are empty, show a minimal board state -->
      {#if visibleColumns.length === 0 && columns.length > 0 && !loading}
        <div class="board-empty">
          <span class="board-empty-text">All columns are empty — create issues or drag cards to get started</span>
          <div class="collapsed-columns" style="flex-direction: row; padding-top: 0;">
            {#each columns as col (col.id)}
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <span
                class="collapsed-badge"
                class:drag-target={dragOverColumnId === col.id}
                class:has-drag={drag.card !== null}
                ondragover={(e) => handleCollapsedDragOver(e, col.id)}
                ondragleave={(e) => handleCollapsedDragLeave(e, col.id)}
                ondrop={(e) => handleCollapsedDrop(e, col.id)}
              >{col.title}</span>
            {/each}
          </div>
        </div>
      {/if}

      {#if loading && columns.length === 0}
        {#each Array(4) as _}
          <div class="column skeleton-column">
            <div class="column-header">
              <div class="skeleton-text" style="width: 80px"></div>
            </div>
            <div class="column-body">
              {#each Array(2) as _c}
                <div class="skeleton-card"></div>
              {/each}
            </div>
          </div>
        {/each}
      {/if}
    </div>
  {/if}
</section>

<!-- Context menu for moving cards between columns -->
{#if contextMenu.visible}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="context-menu"
    style="left: {contextMenu.x}px; top: {contextMenu.y}px;"
    onclick={(e) => e.stopPropagation()}
  >
    <div class="context-menu-header">Move to...</div>
    {#each contextMenuTargets as col (col.id)}
      <button class="context-menu-item" onclick={() => handleContextMenuMove(col.id)}>
        {col.title}
        {#if col.cards.length > 0}
          <span class="context-menu-count">{col.cards.length}</span>
        {/if}
      </button>
    {/each}
  </div>
{/if}

<!-- Linked items popover -->
{#if popover.visible && popover.card}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="popover"
    style="left: {popover.x}px; top: {popover.y}px;"
    onclick={(e) => e.stopPropagation()}
  >
    {#if popover.type === 'prs'}
      <div class="popover-header">Linked PRs</div>
      {#each popover.card.linked_pr_details as pr}
        <button class="popover-item" onclick={() => handlePRClick(pr)}>
          <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor" class="popover-icon pr-icon"><path d="M2 2h8v8H7v12H5V10H2V2zm2 2v4h4V4H4zm8 1h7.09v9H22v8h-8v-8h3.09V7H12V5zm4 11v4h4v-4h-4z"/></svg>
          <span class="popover-item-text">#{pr.number} {pr.title}</span>
        </button>
      {/each}
    {:else}
      <div class="popover-header">Linked Conversations</div>
      {#each popover.card.linked_chat_details as chat}
        <button class="popover-item" onclick={() => handleChatClick(chat.id)}>
          <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor" class="popover-icon chat-icon"><path d="M20 2H2v20h2V4h16v12H6v2H4v2h2v-2h16V2h-2z"/></svg>
          <span class="popover-item-text">{chat.topic}</span>
        </button>
      {/each}
    {/if}
  </div>
{/if}

<!-- Quick-create issue modal -->
{#if create.open}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="modal-overlay" onclick={closeCreateModal} onkeydown={handleCreateKeydown}>
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="modal" onclick={(e) => e.stopPropagation()} onkeydown={handleCreateKeydown}>
      <div class="modal-header">
        <span class="modal-title">New Issue</span>
        <button class="modal-close" onclick={closeCreateModal}>&times;</button>
      </div>
      <div class="modal-body">
        {#if create.error}
          <div class="modal-error">{create.error}</div>
        {/if}
        <div class="form-row">
          <label class="form-label" for="create-repo">Repository</label>
          <select id="create-repo" class="form-select" bind:value={create.repo}>
            {#each availableRepos as repo}
              <option value={repo}>{repo}</option>
            {/each}
          </select>
        </div>
        <div class="form-row">
          <label class="form-label" for="create-column">Column</label>
          <select id="create-column" class="form-select" bind:value={create.column}>
            {#each columns as col}
              <option value={col.id}>{col.title}</option>
            {/each}
          </select>
        </div>
        <div class="form-row">
          <label class="form-label" for="create-title">Title</label>
          <!-- svelte-ignore a11y_autofocus -->
          <input
            id="create-title"
            class="form-input"
            type="text"
            placeholder="Issue title..."
            bind:value={create.title}
            autofocus
          />
        </div>
        <div class="form-row">
          <label class="form-label" for="create-body">Description <span class="form-optional">(optional)</span></label>
          <textarea
            id="create-body"
            class="form-textarea"
            placeholder="Describe the issue..."
            bind:value={create.body}
            rows="3"
          ></textarea>
        </div>
      </div>
      <div class="modal-footer">
        <span class="modal-hint">Cmd+Enter to submit</span>
        <div class="modal-actions">
          <button class="btn-secondary" onclick={closeCreateModal}>Cancel</button>
          <button
            class="btn-primary"
            onclick={handleCreate}
            disabled={!create.title.trim() || !create.repo || create.submitting}
          >
            {create.submitting ? 'Creating...' : 'Create Issue'}
          </button>
        </div>
      </div>
    </div>
  </div>
{/if}

<style>
  .gigi-kanban {
    height: 100%;
    display: flex;
    flex-direction: column;
    background: var(--gigi-bg-primary);
    overflow: hidden;
  }

  /* ── Header ──────────────────────────────────────────────────────── */

  .board-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 var(--gigi-space-md);
    min-height: var(--gigi-topbar-height);
    border-bottom: var(--gigi-border-width) solid var(--gigi-border-default);
    flex-shrink: 0;
  }

  .header-left {
    display: flex;
    align-items: center;
    gap: var(--gigi-space-sm);
  }

  .board-title {
    font-size: var(--gigi-font-size-sm);
    font-weight: 600;
    color: var(--gigi-text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .board-count {
    font-size: var(--gigi-font-size-xs);
    color: var(--gigi-text-muted);
    background: var(--gigi-bg-secondary);
    padding: 1px 6px;
    border-radius: var(--gigi-radius-full);
  }

  .header-right {
    display: flex;
    align-items: center;
    gap: var(--gigi-space-xs);
  }

  .refresh-btn,
  .create-btn,
  .sort-btn {
    background: none;
    border: none;
    color: var(--gigi-text-muted);
    cursor: pointer;
    font-size: var(--gigi-font-size-base);
    padding: var(--gigi-space-xs);
    border-radius: var(--gigi-radius-sm);
    transition: all var(--gigi-transition-fast);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .refresh-btn:hover,
  .create-btn:hover,
  .sort-btn:hover {
    color: var(--gigi-text-primary);
    background: var(--gigi-bg-hover);
  }

  .refresh-btn:disabled {
    opacity: 0.3;
    cursor: default;
  }

  .create-btn {
    color: var(--gigi-accent-green);
  }

  .create-btn:hover {
    background: rgba(46, 160, 67, 0.15);
    color: var(--gigi-accent-green);
  }

  .sort-btn.active {
    color: var(--gigi-accent-blue);
    background: rgba(56, 139, 253, 0.15);
  }

  .loading-indicator {
    color: var(--gigi-accent-blue);
    animation: spin 1s linear infinite;
    font-size: var(--gigi-font-size-sm);
  }

  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }

  /* ── Board Columns ───────────────────────────────────────────────── */

  .board-columns {
    flex: 1;
    display: flex;
    gap: 1px;
    overflow-x: auto;
    overflow-y: hidden;
    background: var(--gigi-border-default);
  }

  .column {
    flex: 1;
    min-width: 200px;
    display: flex;
    flex-direction: column;
    background: var(--gigi-bg-primary);
    transition: background var(--gigi-transition-fast);
  }

  .column.drag-over {
    background: var(--gigi-bg-hover);
  }

  .column-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--gigi-space-sm) var(--gigi-space-md);
    flex-shrink: 0;
  }

  .column-header-right {
    display: flex;
    align-items: center;
    gap: var(--gigi-space-xs);
  }

  .column-title {
    font-size: var(--gigi-font-size-xs);
    font-weight: 600;
    color: var(--gigi-text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .column-count {
    font-size: var(--gigi-font-size-xs);
    color: var(--gigi-text-muted);
    background: var(--gigi-bg-secondary);
    min-width: 18px;
    height: 18px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--gigi-radius-full);
    font-weight: 500;
  }

  .column-add-btn {
    background: none;
    border: none;
    color: var(--gigi-text-muted);
    font-size: var(--gigi-font-size-sm);
    cursor: pointer;
    width: 18px;
    height: 18px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--gigi-radius-sm);
    transition: all var(--gigi-transition-fast);
    opacity: 0;
    font-weight: 600;
    line-height: 1;
    padding: 0;
  }

  .column-header:hover .column-add-btn {
    opacity: 1;
  }

  .column-add-btn:hover {
    color: var(--gigi-accent-green);
    background: rgba(46, 160, 67, 0.15);
  }

  .column-body {
    flex: 1;
    overflow-y: auto;
    padding: 0 var(--gigi-space-sm) var(--gigi-space-sm);
    display: flex;
    flex-direction: column;
    gap: var(--gigi-space-xs);
  }

  /* ── Collapsed columns ─────────────────────────────────────────── */

  .collapsed-columns {
    display: flex;
    flex-direction: column;
    gap: var(--gigi-space-xs);
    min-width: 80px;
    padding: var(--gigi-space-sm) var(--gigi-space-xs);
    align-self: stretch;
    background: var(--gigi-bg-primary);
  }

  .collapsed-badge {
    display: flex;
    align-items: center;
    gap: var(--gigi-space-xs);
    font-size: var(--gigi-font-size-xs);
    color: var(--gigi-text-muted);
    background: var(--gigi-bg-secondary);
    border: var(--gigi-border-width) solid var(--gigi-border-muted);
    border-radius: var(--gigi-radius-sm);
    padding: 2px var(--gigi-space-sm);
    white-space: nowrap;
    transition: all var(--gigi-transition-fast);
    cursor: default;
  }

  /* When a card is being dragged, badges become obvious drop targets */
  .collapsed-badge.has-drag {
    cursor: pointer;
    border-style: dashed;
    border-color: var(--gigi-accent-blue);
    opacity: 0.8;
  }

  .collapsed-badge.has-drag:hover,
  .collapsed-badge.drag-target {
    background: var(--gigi-bg-hover);
    border-color: var(--gigi-accent-green);
    color: var(--gigi-text-primary);
    opacity: 1;
    transform: scale(1.05);
  }

  .collapsed-count {
    opacity: 0.5;
  }

  .board-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--gigi-space-md);
    padding: var(--gigi-space-lg);
    width: 100%;
    color: var(--gigi-text-muted);
    font-size: var(--gigi-font-size-sm);
  }

  .board-empty-text {
    text-align: center;
  }

  .column-empty {
    text-align: center;
    color: var(--gigi-text-muted);
    font-size: var(--gigi-font-size-xs);
    padding: var(--gigi-space-lg) var(--gigi-space-sm);
    opacity: 0.6;
  }

  /* ── Cards ───────────────────────────────────────────────────────── */

  .card {
    background: var(--gigi-bg-secondary);
    border: var(--gigi-border-width) solid var(--gigi-border-default);
    border-radius: var(--gigi-radius-md);
    padding: var(--gigi-space-sm);
    cursor: grab;
    transition: all var(--gigi-transition-fast);
    user-select: none;
  }

  .card:hover {
    border-color: var(--gigi-accent-blue);
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.2);
  }

  .card:active {
    cursor: grabbing;
  }

  .card.dragging {
    opacity: 0.4;
    transform: scale(0.96);
  }

  .card-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 2px;
  }

  .card-repo {
    font-size: 10px;
    color: var(--gigi-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    font-weight: 500;
  }

  .card-priority {
    font-size: 10px;
    line-height: 1;
  }

  .card-title {
    font-size: var(--gigi-font-size-sm);
    color: var(--gigi-text-primary);
    line-height: 1.3;
    margin-bottom: var(--gigi-space-xs);
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .card-number {
    color: var(--gigi-text-muted);
    font-weight: 500;
    margin-right: 3px;
  }

  .card-labels {
    display: flex;
    flex-wrap: wrap;
    gap: 3px;
    margin-bottom: var(--gigi-space-xs);
  }

  .card-label {
    font-size: 9px;
    padding: 1px 5px;
    border-radius: var(--gigi-radius-full);
    border: 1px solid transparent;
    font-weight: 500;
    white-space: nowrap;
    text-transform: lowercase;
  }

  .card-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .card-meta {
    display: flex;
    align-items: center;
    gap: var(--gigi-space-sm);
  }

  .card-prs,
  .card-chats {
    display: flex;
    align-items: center;
    gap: 2px;
    font-size: 10px;
    color: var(--gigi-text-muted);
  }

  .card-prs {
    color: var(--gigi-accent-green);
  }

  .card-chats {
    color: var(--gigi-accent-blue);
  }

  .card-prs.clickable,
  .card-chats.clickable {
    cursor: pointer;
    border-radius: var(--gigi-radius-sm);
    padding: 1px 3px;
    margin: -1px -3px;
    transition: background var(--gigi-transition-fast);
  }

  .card-prs.clickable:hover {
    background: rgba(46, 160, 67, 0.15);
  }

  .card-chats.clickable:hover {
    background: rgba(56, 139, 253, 0.15);
  }

  .card-comments {
    font-size: 10px;
    color: var(--gigi-text-muted);
  }

  .card-time {
    font-size: 10px;
    color: var(--gigi-text-muted);
  }

  .card-avatar {
    width: 20px;
    height: 20px;
    border-radius: 50%;
    border: 1px solid var(--gigi-border-default);
  }

  /* ── Context Menu ──────────────────────────────────────────────── */

  .context-menu {
    position: fixed;
    z-index: 1000;
    min-width: 160px;
    background: var(--gigi-bg-secondary);
    border: var(--gigi-border-width) solid var(--gigi-border-default);
    border-radius: var(--gigi-radius-md);
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
    padding: var(--gigi-space-xs) 0;
    animation: context-menu-in 100ms ease-out;
  }

  @keyframes context-menu-in {
    from { opacity: 0; transform: scale(0.95); }
    to { opacity: 1; transform: scale(1); }
  }

  .context-menu-header {
    padding: var(--gigi-space-xs) var(--gigi-space-md);
    font-size: var(--gigi-font-size-xs);
    color: var(--gigi-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    font-weight: 600;
  }

  .context-menu-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    padding: var(--gigi-space-xs) var(--gigi-space-md);
    background: none;
    border: none;
    color: var(--gigi-text-primary);
    font-size: var(--gigi-font-size-sm);
    font-family: var(--gigi-font-sans);
    cursor: pointer;
    text-align: left;
    transition: background var(--gigi-transition-fast);
  }

  .context-menu-item:hover {
    background: var(--gigi-bg-hover);
  }

  .context-menu-count {
    font-size: var(--gigi-font-size-xs);
    color: var(--gigi-text-muted);
    background: var(--gigi-bg-tertiary, var(--gigi-bg-secondary));
    padding: 0 5px;
    border-radius: var(--gigi-radius-full);
    min-width: 16px;
    text-align: center;
  }

  /* ── Popover ────────────────────────────────────────────────────── */

  .popover {
    position: fixed;
    z-index: 1001;
    min-width: 200px;
    max-width: 320px;
    background: var(--gigi-bg-secondary);
    border: var(--gigi-border-width) solid var(--gigi-border-default);
    border-radius: var(--gigi-radius-md);
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
    padding: var(--gigi-space-xs) 0;
    animation: context-menu-in 100ms ease-out;
  }

  .popover-header {
    padding: var(--gigi-space-xs) var(--gigi-space-md);
    font-size: var(--gigi-font-size-xs);
    color: var(--gigi-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    font-weight: 600;
  }

  .popover-item {
    display: flex;
    align-items: center;
    gap: var(--gigi-space-sm);
    width: 100%;
    padding: var(--gigi-space-xs) var(--gigi-space-md);
    background: none;
    border: none;
    color: var(--gigi-text-primary);
    font-size: var(--gigi-font-size-sm);
    font-family: var(--gigi-font-sans);
    cursor: pointer;
    text-align: left;
    transition: background var(--gigi-transition-fast);
  }

  .popover-item:hover {
    background: var(--gigi-bg-hover);
  }

  .popover-icon {
    flex-shrink: 0;
  }

  .popover-icon.pr-icon {
    color: var(--gigi-accent-green);
  }

  .popover-icon.chat-icon {
    color: var(--gigi-accent-blue);
  }

  .popover-item-text {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* ── Quick-create Modal ──────────────────────────────────────────── */

  .modal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    z-index: 2000;
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding-top: 10vh;
    animation: fade-in 100ms ease-out;
  }

  @keyframes fade-in {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  .modal {
    background: var(--gigi-bg-primary);
    border: var(--gigi-border-width) solid var(--gigi-border-default);
    border-radius: var(--gigi-radius-lg, 8px);
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
    width: 440px;
    max-width: 90vw;
    animation: modal-in 150ms ease-out;
  }

  @keyframes modal-in {
    from { opacity: 0; transform: translateY(-10px) scale(0.98); }
    to { opacity: 1; transform: translateY(0) scale(1); }
  }

  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--gigi-space-md);
    border-bottom: var(--gigi-border-width) solid var(--gigi-border-default);
  }

  .modal-title {
    font-size: var(--gigi-font-size-sm);
    font-weight: 600;
    color: var(--gigi-text-primary);
  }

  .modal-close {
    background: none;
    border: none;
    color: var(--gigi-text-muted);
    cursor: pointer;
    font-size: var(--gigi-font-size-lg, 18px);
    padding: 2px 6px;
    border-radius: var(--gigi-radius-sm);
    transition: all var(--gigi-transition-fast);
    line-height: 1;
  }

  .modal-close:hover {
    color: var(--gigi-text-primary);
    background: var(--gigi-bg-hover);
  }

  .modal-body {
    padding: var(--gigi-space-md);
    display: flex;
    flex-direction: column;
    gap: var(--gigi-space-sm);
  }

  .modal-error {
    font-size: var(--gigi-font-size-xs);
    color: var(--gigi-accent-red);
    background: rgba(248, 81, 73, 0.1);
    border: 1px solid rgba(248, 81, 73, 0.3);
    border-radius: var(--gigi-radius-sm);
    padding: var(--gigi-space-xs) var(--gigi-space-sm);
  }

  .form-row {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .form-label {
    font-size: var(--gigi-font-size-xs);
    color: var(--gigi-text-secondary);
    font-weight: 500;
  }

  .form-optional {
    color: var(--gigi-text-muted);
    font-weight: 400;
  }

  .form-input,
  .form-textarea,
  .form-select {
    font-size: var(--gigi-font-size-sm);
    font-family: var(--gigi-font-sans);
    padding: var(--gigi-space-xs) var(--gigi-space-sm);
    background: var(--gigi-bg-secondary);
    border: var(--gigi-border-width) solid var(--gigi-border-default);
    border-radius: var(--gigi-radius-sm);
    color: var(--gigi-text-primary);
    outline: none;
    transition: border-color var(--gigi-transition-fast);
  }

  .form-input:focus,
  .form-textarea:focus,
  .form-select:focus {
    border-color: var(--gigi-accent-blue);
  }

  .form-textarea {
    resize: vertical;
    min-height: 60px;
  }

  .form-select {
    cursor: pointer;
  }

  .modal-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--gigi-space-sm) var(--gigi-space-md);
    border-top: var(--gigi-border-width) solid var(--gigi-border-default);
  }

  .modal-hint {
    font-size: var(--gigi-font-size-xs);
    color: var(--gigi-text-muted);
  }

  .modal-actions {
    display: flex;
    gap: var(--gigi-space-sm);
  }

  .btn-secondary,
  .btn-primary {
    font-size: var(--gigi-font-size-xs);
    font-family: var(--gigi-font-sans);
    padding: var(--gigi-space-xs) var(--gigi-space-md);
    border-radius: var(--gigi-radius-sm);
    cursor: pointer;
    border: var(--gigi-border-width) solid var(--gigi-border-default);
    transition: all var(--gigi-transition-fast);
    font-weight: 500;
  }

  .btn-secondary {
    background: var(--gigi-bg-secondary);
    color: var(--gigi-text-secondary);
  }

  .btn-secondary:hover {
    background: var(--gigi-bg-hover);
    color: var(--gigi-text-primary);
  }

  .btn-primary {
    background: var(--gigi-accent-green);
    color: white;
    border-color: var(--gigi-accent-green);
  }

  .btn-primary:hover:not(:disabled) {
    filter: brightness(1.1);
  }

  .btn-primary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  /* ── Error State ─────────────────────────────────────────────────── */

  .board-error {
    padding: var(--gigi-space-lg);
    text-align: center;
    color: var(--gigi-accent-red);
    font-size: var(--gigi-font-size-sm);
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--gigi-space-md);
  }

  .board-error button {
    background: var(--gigi-accent-red);
    color: white;
    border: none;
    border-radius: var(--gigi-radius-sm);
    padding: var(--gigi-space-xs) var(--gigi-space-md);
    cursor: pointer;
    font-size: var(--gigi-font-size-xs);
    font-family: var(--gigi-font-sans);
  }

  /* ── Skeleton ────────────────────────────────────────────────────── */

  .skeleton-column {
    opacity: 0.5;
  }

  .skeleton-text {
    height: 14px;
    background: var(--gigi-bg-secondary);
    border-radius: var(--gigi-radius-sm);
    animation: shimmer 1.5s ease-in-out infinite;
  }

  .skeleton-card {
    height: 72px;
    background: var(--gigi-bg-secondary);
    border: var(--gigi-border-width) solid var(--gigi-border-default);
    border-radius: var(--gigi-radius-md);
    animation: shimmer 1.5s ease-in-out infinite;
  }

  @keyframes shimmer {
    0%, 100% { opacity: 0.4; }
    50% { opacity: 0.7; }
  }

  /* ── Scrollbar ───────────────────────────────────────────────────── */

  .column-body::-webkit-scrollbar {
    width: 4px;
  }

  .column-body::-webkit-scrollbar-track {
    background: transparent;
  }

  .column-body::-webkit-scrollbar-thumb {
    background: var(--gigi-border-default);
    border-radius: 4px;
  }

  .board-columns::-webkit-scrollbar {
    height: 4px;
  }

  .board-columns::-webkit-scrollbar-track {
    background: transparent;
  }

  .board-columns::-webkit-scrollbar-thumb {
    background: var(--gigi-border-default);
    border-radius: 4px;
  }
</style>
