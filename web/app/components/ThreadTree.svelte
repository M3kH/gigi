<script lang="ts">
  /**
   * ThreadTree — Recursive tree view of threads with rich 2-3 line items.
   *
   * Each node shows:
   *   Row 1: [expand] [status] Title [spinner] [actions]
   *   Row 2: Preview text (one line, truncated)
   *   Row 3: Time · PR#123 · #45 · $0.42
   *
   * Subthreads are expandable/collapsible with indentation.
   */

  import type { ThreadTreeNode, ThreadStatus, ThreadRef } from '$lib/types/chat'
  import {
    getFilteredTree,
    getSelectedThreadId,
    isExpanded,
    toggleExpand,
    selectThread,
    isLoading,
    getError,
  } from '$lib/stores/thread-tree.svelte'
  import {
    selectConversation,
    isAgentRunning,
    archiveConversation,
    deleteConversation,
    stopThread,
    reopenThread,
    forkConversation,
  } from '$lib/stores/chat.svelte'
  import { getPanelState, setPanelState } from '$lib/stores/panels.svelte'
  import { formatRelativeTime, formatCost } from '$lib/utils/format'

  const tree = $derived(getFilteredTree())
  const selectedId = $derived(getSelectedThreadId())
  const loading = $derived(isLoading())
  const error = $derived(getError())

  function statusClass(node: ThreadTreeNode): string {
    const convId = node.conversation_id || node.id
    if (isAgentRunning(convId)) return 'active'
    return node.status || 'paused'
  }

  function statusTooltip(node: ThreadTreeNode): string {
    const convId = node.conversation_id || node.id
    if (isAgentRunning(convId)) return 'Agent running'
    switch (node.status) {
      case 'active': return 'Agent running'
      case 'paused': return 'Ready'
      case 'stopped': return 'Done'
      case 'archived': return 'Archived'
      default: return node.status
    }
  }

  function displayName(node: ThreadTreeNode): string {
    const name = node.display_name || node.topic || ''
    // If name is generic, try to derive from preview
    if (!name || name === 'web' || name === 'telegram' || name === 'Untitled') {
      if (node.last_event_preview) {
        const stripped = node.last_event_preview.replace(/^\[Viewing [^\]]+\]\n?/, '').trim()
        const trimmed = stripped.slice(0, 50)
        return trimmed + (stripped.length > 50 ? '...' : '') || 'Untitled'
      }
      return 'Untitled'
    }
    return name
  }

  function handleSelect(node: ThreadTreeNode) {
    const id = node.conversation_id || node.id
    selectThread(node.id)
    selectConversation(id)
    if (getPanelState('chatOverlay') === 'hidden') {
      setPanelState('chatOverlay', 'compact')
    }
  }

  function handleToggle(e: MouseEvent, node: ThreadTreeNode) {
    e.stopPropagation()
    toggleExpand(node.id)
  }

  async function handleArchive(e: MouseEvent, node: ThreadTreeNode) {
    e.stopPropagation()
    const id = node.conversation_id || node.id
    await archiveConversation(id)
  }

  async function handleDelete(e: MouseEvent, node: ThreadTreeNode) {
    e.stopPropagation()
    if (!confirm(`Permanently delete "${displayName(node)}"?`)) return
    const id = node.conversation_id || node.id
    await deleteConversation(id)
  }

  async function handleStop(e: MouseEvent, node: ThreadTreeNode) {
    e.stopPropagation()
    const id = node.conversation_id || node.id
    await stopThread(id)
  }

  async function handleReopen(e: MouseEvent, node: ThreadTreeNode) {
    e.stopPropagation()
    const id = node.conversation_id || node.id
    await reopenThread(id)
  }

  async function handleFork(e: MouseEvent, node: ThreadTreeNode) {
    e.stopPropagation()
    const id = node.conversation_id || node.id
    await forkConversation(id)
  }

  function handleForkTrailClick(e: MouseEvent, node: ThreadTreeNode) {
    e.stopPropagation()
    if (node.fork_source) {
      selectThread(node.fork_source.thread_id)
      const parentNode = findInTree(tree, node.fork_source.thread_id)
      if (parentNode) {
        const parentConvId = parentNode.conversation_id || parentNode.id
        selectConversation(parentConvId)
      }
    }
  }

  function findInTree(nodes: ThreadTreeNode[], id: string): ThreadTreeNode | null {
    for (const node of nodes) {
      if (node.id === id) return node
      const found = findInTree(node.children, id)
      if (found) return found
    }
    return null
  }

  function refLabel(ref: ThreadRef): string {
    if (ref.ref_type === 'pr') return `PR#${ref.number}`
    if (ref.ref_type === 'issue') return `#${ref.number}`
    if (ref.ref_type === 'branch') return ref.ref || 'branch'
    return ref.ref_type
  }

  function handleRefClick(e: MouseEvent, ref: ThreadRef) {
    e.stopPropagation()
    if (ref.url) {
      window.open(ref.url, '_blank')
    }
  }
</script>

{#snippet treeNode(node: ThreadTreeNode, depth: number)}
  {@const expanded = isExpanded(node.id)}
  {@const hasChildren = node.children.length > 0}
  {@const isSelected = selectedId === node.id}
  {@const convId = node.conversation_id || node.id}
  {@const running = isAgentRunning(convId)}
  {@const costStr = formatCost(node.usage_cost)}

  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="tree-node"
    class:selected={isSelected}
    class:stopped={node.status === 'stopped'}
    style:padding-left="{8 + depth * 14}px"
    onclick={() => handleSelect(node)}
    onkeydown={(e) => e.key === 'Enter' && handleSelect(node)}
    tabindex="0"
    role="treeitem"
    aria-expanded={hasChildren ? expanded : undefined}
  >
    <!-- Row 1: status + title + spinner + actions -->
    <div class="node-row-1">
      {#if hasChildren}
        <button
          class="expand-toggle"
          onclick={(e) => handleToggle(e, node)}
          aria-label={expanded ? 'Collapse' : 'Expand'}
        >
          <svg
            class="chevron"
            class:expanded
            viewBox="0 0 24 24"
            width="10"
            height="10"
            fill="currentColor"
          >
            <path d="M8 5v2h2V5H8zm4 4V7h-2v2h2zm2 2V9h-2v2h2zm0 2h2v-2h-2v2zm-2 2v-2h2v2h-2zm0 0h-2v2h2v-2zm-4 4v-2h2v2H8z"/>
          </svg>
        </button>
      {:else}
        <span class="expand-spacer"></span>
      {/if}

      <span class="status-dot {statusClass(node)}" title={statusTooltip(node)}></span>
      <span class="node-title">{displayName(node)}</span>

      {#if running}
        <span class="spinner">&#x27F3;</span>
      {/if}

      {#if hasChildren}
        <span class="child-count" title="{node.children.length} subthread{node.children.length > 1 ? 's' : ''}">{node.children.length}</span>
      {/if}

      <!-- Action buttons (on hover) -->
      <div class="action-btns">
        {#if node.status === 'paused' || node.status === 'active'}
          <button class="action-btn stop-btn" title="Stop (mark done)" onclick={(e) => handleStop(e, node)}>
            <svg viewBox="0 0 24 24" width="11" height="11" fill="currentColor">
              <path d="M2 2h20v20H2V2zm2 2v16h16V4H4z"/>
            </svg>
          </button>
        {/if}
        {#if node.status === 'stopped'}
          <button class="action-btn reopen-btn" title="Reopen" onclick={(e) => handleReopen(e, node)}>↩</button>
        {/if}
        <button class="action-btn fork-btn" title="Fork" onclick={(e) => handleFork(e, node)}>
          <svg viewBox="0 0 24 24" width="11" height="11" fill="currentColor">
            <path d="M5 2h2v12h3v3h7v-7h-3V2h8v8h-3v9h-9v3H2v-8h3V2zm15 6V4h-4v4h4zM8 19v-3H4v4h4v-1z"/>
          </svg>
        </button>
        <button class="action-btn archive-btn" title="Archive" onclick={(e) => handleArchive(e, node)}>
          <svg viewBox="0 0 24 24" width="11" height="11" fill="currentColor">
            <path d="M4 4h8v2h10v14H2V4h2zm16 4H10V6H4v12h16V8z"/>
          </svg>
        </button>
        <button class="action-btn delete-btn" title="Delete" onclick={(e) => handleDelete(e, node)}>&times;</button>
      </div>
    </div>

    <!-- Row 2: preview text -->
    {#if node.last_event_preview}
      <div class="node-preview">{node.last_event_preview}</div>
    {/if}

    <!-- Row 3: time + refs + cost -->
    <div class="node-meta">
      <span class="meta-time">{formatRelativeTime(node.updated_at)}</span>

      {#each node.refs.slice(0, 3) as ref (ref.id)}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <span
          class="ref-link"
          class:pr={ref.ref_type === 'pr'}
          class:issue={ref.ref_type === 'issue'}
          class:clickable={!!ref.url}
          onclick={(e) => handleRefClick(e, ref)}
          title={ref.url || refLabel(ref)}
        >{refLabel(ref)}</span>
      {/each}

      <span class="meta-spacer"></span>

      {#if costStr}
        <span class="meta-cost">{costStr}</span>
      {/if}
    </div>
  </div>

  <!-- Fork trail link -->
  {#if node.fork_source}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="fork-trail"
      style:padding-left="{22 + depth * 14}px"
      onclick={(e) => handleForkTrailClick(e, node)}
    >
      ↩ from {node.fork_source.display_name || node.fork_source.topic || 'parent'}
    </div>
  {/if}

  <!-- Children (collapsible) -->
  {#if hasChildren && expanded}
    {#each node.children as child (child.id)}
      {@render treeNode(child, depth + 1)}
    {/each}
  {/if}
{/snippet}

<div class="thread-tree" role="tree">
  {#if loading && tree.length === 0}
    <div class="tree-loading">Loading threads...</div>
  {:else if error && tree.length === 0}
    <div class="tree-error">{error}</div>
  {:else if tree.length === 0}
    <div class="tree-empty">No threads yet</div>
  {:else}
    {#each tree as node (node.id)}
      {@render treeNode(node, 0)}
    {/each}
  {/if}
</div>

<style>
  .thread-tree {
    display: flex;
    flex-direction: column;
  }

  /* ── Tree Node (2-3 line card) ──────────────────────────────── */

  .tree-node {
    display: flex;
    flex-direction: column;
    padding: 6px 8px 5px;
    cursor: pointer;
    border-bottom: var(--gigi-border-width) solid var(--gigi-border-muted);
    transition: background var(--gigi-transition-fast);
    font-family: var(--gigi-font-sans);
    position: relative;
  }

  .tree-node:hover {
    background: var(--gigi-bg-hover);
  }

  .tree-node.selected {
    background: var(--gigi-bg-active);
    border-left: 2px solid var(--gigi-accent-green);
  }

  .tree-node.stopped {
    opacity: 0.7;
  }

  /* ── Row 1: Header ─────────────────────────────────────────── */

  .node-row-1 {
    display: flex;
    align-items: center;
    gap: 4px;
    min-height: 20px;
  }

  /* ── Expand/collapse ────────────────────────────────────────── */

  .expand-toggle {
    display: flex;
    align-items: center;
    justify-content: center;
    background: none;
    border: none;
    cursor: pointer;
    color: var(--gigi-text-muted);
    padding: 1px;
    border-radius: var(--gigi-radius-sm);
    flex-shrink: 0;
    width: 14px;
    height: 14px;
  }

  .expand-toggle:hover {
    color: var(--gigi-text-primary);
    background: var(--gigi-bg-tertiary);
  }

  .chevron {
    transition: transform var(--gigi-transition-fast);
  }

  .chevron.expanded {
    transform: rotate(90deg);
  }

  .expand-spacer {
    width: 14px;
    flex-shrink: 0;
  }

  /* ── Status dot ─────────────────────────────────────────────── */

  .status-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .status-dot.paused {
    background: var(--gigi-accent-green);
  }

  .status-dot.active {
    background: var(--gigi-accent-orange);
    animation: pulse 1.5s ease-in-out infinite;
  }

  .status-dot.stopped {
    background: var(--gigi-text-muted);
  }

  .status-dot.archived {
    background: var(--gigi-text-muted);
    opacity: 0.5;
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
  }

  /* ── Title ──────────────────────────────────────────────────── */

  .node-title {
    font-size: var(--gigi-font-size-sm);
    font-weight: 500;
    color: var(--gigi-text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    flex: 1;
    min-width: 0;
  }

  /* ── Spinner ────────────────────────────────────────────────── */

  .spinner {
    font-size: 0.7rem;
    animation: spin 1s linear infinite;
    flex-shrink: 0;
    color: var(--gigi-accent-orange);
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  /* ── Child count badge ──────────────────────────────────────── */

  .child-count {
    font-size: 8px;
    font-weight: 600;
    color: var(--gigi-text-muted);
    background: var(--gigi-bg-tertiary);
    padding: 0 4px;
    border-radius: var(--gigi-radius-full);
    flex-shrink: 0;
    line-height: 1.5;
  }

  /* ── Row 2: Preview ─────────────────────────────────────────── */

  .node-preview {
    font-size: 11px;
    color: var(--gigi-text-muted);
    margin-top: 1px;
    margin-left: 24px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    line-height: 1.3;
  }

  /* ── Row 3: Meta ────────────────────────────────────────────── */

  .node-meta {
    display: flex;
    align-items: center;
    gap: 4px;
    margin-top: 2px;
    margin-left: 24px;
    flex-wrap: nowrap;
    overflow: hidden;
  }

  .meta-time {
    font-size: 10px;
    color: var(--gigi-text-muted);
    flex-shrink: 0;
  }

  .meta-spacer {
    flex: 1;
  }

  .meta-cost {
    font-size: 9px;
    color: var(--gigi-text-muted);
    flex-shrink: 0;
    font-variant-numeric: tabular-nums;
  }

  /* ── Ref links (clickable) ──────────────────────────────────── */

  .ref-link {
    font-size: 9px;
    font-weight: 600;
    padding: 0 4px;
    border-radius: var(--gigi-radius-full);
    flex-shrink: 0;
    letter-spacing: 0.02em;
    text-decoration: none;
  }

  .ref-link.clickable {
    cursor: pointer;
  }

  .ref-link.clickable:hover {
    text-decoration: underline;
  }

  .ref-link.issue {
    color: var(--gigi-accent-green);
    background: rgba(63, 185, 80, 0.12);
  }

  .ref-link.pr {
    color: var(--gigi-accent-purple, #a371f7);
    background: rgba(163, 113, 247, 0.12);
  }

  /* ── Fork trail ─────────────────────────────────────────────── */

  .fork-trail {
    font-size: 10px;
    color: var(--gigi-accent-purple, #a371f7);
    padding: 0 8px 3px;
    cursor: pointer;
    transition: color var(--gigi-transition-fast);
  }

  .fork-trail:hover {
    color: var(--gigi-text-primary);
    text-decoration: underline;
  }

  /* ── Action buttons ─────────────────────────────────────────── */

  .action-btns {
    display: none;
    align-items: center;
    gap: 1px;
    flex-shrink: 0;
  }

  .tree-node:hover .action-btns {
    display: flex;
  }

  .action-btn {
    background: none;
    border: none;
    color: var(--gigi-text-muted);
    cursor: pointer;
    padding: 2px;
    line-height: 1;
    font-family: var(--gigi-font-sans);
    border-radius: var(--gigi-radius-sm);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .action-btn:hover {
    background: var(--gigi-bg-tertiary);
  }

  .reopen-btn {
    font-size: 0.7rem;
  }

  .reopen-btn:hover {
    color: var(--gigi-accent-green);
  }

  .fork-btn:hover {
    color: var(--gigi-accent-purple, #a371f7);
  }

  .archive-btn:hover {
    color: var(--gigi-accent-blue);
  }

  .delete-btn {
    font-size: 0.9rem;
  }

  .delete-btn:hover {
    color: var(--gigi-accent-red);
  }

  /* ── Loading / Error / Empty states ─────────────────────────── */

  .tree-loading,
  .tree-error,
  .tree-empty {
    padding: var(--gigi-space-lg);
    text-align: center;
    color: var(--gigi-text-muted);
    font-size: var(--gigi-font-size-xs);
  }

  .tree-error {
    color: var(--gigi-accent-red);
  }
</style>
