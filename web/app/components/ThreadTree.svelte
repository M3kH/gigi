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
  import chevronRightIcon from 'pixelarticons/svg/chevron-right.svg?raw'
  import stopIcon from 'pixelarticons/svg/checkbox-on.svg?raw'
  import forkIcon from 'pixelarticons/svg/git-branch.svg?raw'
  import archiveIcon from 'pixelarticons/svg/archive.svg?raw'
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
          <span class="chevron-icon" class:expanded>{@html chevronRightIcon}</span>
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
            <span class="btn-icon">{@html stopIcon}</span>
          </button>
        {/if}
        {#if node.status === 'stopped'}
          <button class="action-btn reopen-btn" title="Reopen" onclick={(e) => handleReopen(e, node)}>↩</button>
        {/if}
        <button class="action-btn fork-btn" title="Fork" onclick={(e) => handleFork(e, node)}>
          <span class="btn-icon">{@html forkIcon}</span>
        </button>
        <button class="action-btn archive-btn" title="Archive" onclick={(e) => handleArchive(e, node)}>
          <span class="btn-icon">{@html archiveIcon}</span>
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

  .chevron-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    transition: transform var(--gigi-transition-fast);
  }

  .chevron-icon :global(svg) {
    width: 10px;
    height: 10px;
    fill: currentColor;
  }

  .chevron-icon.expanded {
    transform: rotate(90deg);
  }

  /* Icon wrapper for action buttons using ?raw imports */
  .btn-icon {
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .btn-icon :global(svg) {
    width: 11px;
    height: 11px;
    fill: currentColor;
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
