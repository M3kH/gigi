<script lang="ts">
  /**
   * Section A: Kanban Board
   *
   * Full-width kanban board synced with Gitea issues via status/ labels.
   * Features: columns, issue cards, drag-and-drop between columns,
   * label badges, assignee avatars, repo indicators.
   */

  import { onMount } from 'svelte'
  import {
    fetchBoard,
    getColumns,
    getTotalIssues,
    isLoading,
    getError,
    isStale,
    startDrag,
    endDrag,
    getDragState,
    moveCard,
    type KanbanCard,
    type KanbanColumn,
    type KanbanLabel,
  } from '$lib/stores/kanban.svelte'
  import { navigateToIssue } from '$lib/stores/navigation.svelte'
  import { formatRelativeTime } from '$lib/utils/format'
  import { getPanelState, setPanelState, type PanelState } from '$lib/stores/panels.svelte'
  import PanelControls from '$components/ui/PanelControls.svelte'

  // ── Derived State ────────────────────────────────────────────────────

  const columns: KanbanColumn[] = $derived(getColumns())
  const totalIssues: number = $derived(getTotalIssues())
  const loading: boolean = $derived(isLoading())
  const error: string | null = $derived(getError())
  const drag = $derived(getDragState())
  const kanbanState: PanelState = $derived(getPanelState('kanban'))

  // Non-empty columns (hide Done if empty)
  const visibleColumns = $derived(
    columns.filter(col => col.cards.length > 0 || col.id !== 'done')
  )

  // ── Drag Tracking ───────────────────────────────────────────────────

  let dragOverColumnId = $state<string | null>(null)

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

    if (drag.card && drag.sourceColumnId) {
      moveCard(drag.card, drag.sourceColumnId, targetColumnId)
    }
    endDrag()
  }

  function handleDragEnd(): void {
    dragOverColumnId = null
    endDrag()
  }

  function handleCardClick(card: KanbanCard): void {
    navigateToIssue('idea', card.repo, card.number)
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

    return () => clearInterval(interval)
  })
</script>

<section class="gigi-kanban" class:header-only={kanbanState === 'hidden'}>
  <!-- Header -->
  <header class="board-header">
    <div class="header-left">
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <h2
        class="board-title"
        ondblclick={() => setPanelState('kanban', kanbanState === 'hidden' ? 'compact' : 'hidden')}
      >Board</h2>
      <span class="board-count">{totalIssues} issues</span>
    </div>
    <div class="header-right">
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
            <span class="column-count">{column.cards.length}</span>
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

                <!-- Footer: assignee + comments + time -->
                <div class="card-footer">
                  <div class="card-meta">
                    {#if card.comments > 0}
                      <span class="card-comments" title="{card.comments} comments">
                        💬 {card.comments}
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

  .refresh-btn {
    background: none;
    border: none;
    color: var(--gigi-text-muted);
    cursor: pointer;
    font-size: var(--gigi-font-size-base);
    padding: var(--gigi-space-xs);
    border-radius: var(--gigi-radius-sm);
    transition: all var(--gigi-transition-fast);
  }

  .refresh-btn:hover {
    color: var(--gigi-text-primary);
    background: var(--gigi-bg-hover);
  }

  .refresh-btn:disabled {
    opacity: 0.3;
    cursor: default;
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

  /* ── Hidden mode (header bar only) ──────────────────────────────── */

  .gigi-kanban.header-only .board-columns {
    display: none;
  }

  .gigi-kanban.header-only .board-error {
    display: none;
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
    max-width: 320px;
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

  .column-body {
    flex: 1;
    overflow-y: auto;
    padding: 0 var(--gigi-space-sm) var(--gigi-space-sm);
    display: flex;
    flex-direction: column;
    gap: var(--gigi-space-xs);
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
