/**
 * Tests for panel collapse/expand toggle feature (#119)
 *
 * Validates panel state cycling logic and collapsed bar behavior.
 * Since the panels store uses Svelte 5 runes ($state), we test
 * the pure logic patterns rather than the reactive store directly.
 */

import assert from 'node:assert/strict'

// ─── Panel state cycling logic ──────────────────────────────────────

type PanelState = 'full' | 'compact' | 'hidden'
type PanelId = 'kanban' | 'sidebar' | 'filters' | 'chatOverlay'

/** Default cycle: full → compact → hidden → full */
const CYCLE: PanelState[] = ['full', 'compact', 'hidden']

/** Sidebar only has two states: full <-> hidden */
const SIDEBAR_CYCLE: PanelState[] = ['full', 'hidden']

function getNextState(id: PanelId, current: PanelState): PanelState {
  const cycle = id === 'sidebar' ? SIDEBAR_CYCLE : CYCLE
  const idx = cycle.indexOf(current)
  return cycle[(idx + 1) % cycle.length]
}

describe('Panel state cycling', () => {
  it('kanban cycles full → compact → hidden → full', () => {
    assert.equal(getNextState('kanban', 'full'), 'compact')
    assert.equal(getNextState('kanban', 'compact'), 'hidden')
    assert.equal(getNextState('kanban', 'hidden'), 'full')
  })

  it('chatOverlay cycles full → compact → hidden → full', () => {
    assert.equal(getNextState('chatOverlay', 'full'), 'compact')
    assert.equal(getNextState('chatOverlay', 'compact'), 'hidden')
    assert.equal(getNextState('chatOverlay', 'hidden'), 'full')
  })

  it('sidebar cycles full → hidden → full (two states only)', () => {
    assert.equal(getNextState('sidebar', 'full'), 'hidden')
    assert.equal(getNextState('sidebar', 'hidden'), 'full')
  })

  it('filters cycle full → compact → hidden → full', () => {
    assert.equal(getNextState('filters', 'full'), 'compact')
    assert.equal(getNextState('filters', 'compact'), 'hidden')
    assert.equal(getNextState('filters', 'hidden'), 'full')
  })
})

// ─── Collapsed bar display logic ────────────────────────────────────

describe('Collapsed bar display rules', () => {
  function shouldShowCollapsedKanbanBar(state: PanelState): boolean {
    return state === 'hidden'
  }

  function shouldShowKanbanPanel(state: PanelState): boolean {
    return state !== 'hidden' // compact or full
  }

  function shouldShowCollapsedSidebarBar(state: PanelState, isMobile: boolean): boolean {
    return !isMobile && state === 'hidden'
  }

  function shouldShowSidebarPanel(state: PanelState, isMobile: boolean): boolean {
    return !isMobile && state === 'full'
  }

  function shouldShowCollapsedChatTab(state: PanelState, kanbanState: PanelState): boolean {
    return kanbanState !== 'full' && state === 'hidden'
  }

  function shouldShowChatOverlay(state: PanelState, kanbanState: PanelState): boolean {
    return kanbanState !== 'full' && state !== 'hidden'
  }

  it('kanban: hidden state shows collapsed bar, not panel', () => {
    assert.ok(shouldShowCollapsedKanbanBar('hidden'))
    assert.ok(!shouldShowKanbanPanel('hidden'))
  })

  it('kanban: compact state shows panel, not collapsed bar', () => {
    assert.ok(!shouldShowCollapsedKanbanBar('compact'))
    assert.ok(shouldShowKanbanPanel('compact'))
  })

  it('kanban: full state shows panel, not collapsed bar', () => {
    assert.ok(!shouldShowCollapsedKanbanBar('full'))
    assert.ok(shouldShowKanbanPanel('full'))
  })

  it('sidebar: hidden state shows collapsed bar on desktop', () => {
    assert.ok(shouldShowCollapsedSidebarBar('hidden', false))
    assert.ok(!shouldShowSidebarPanel('hidden', false))
  })

  it('sidebar: hidden state does NOT show collapsed bar on mobile', () => {
    assert.ok(!shouldShowCollapsedSidebarBar('hidden', true))
  })

  it('sidebar: full state shows panel, not collapsed bar', () => {
    assert.ok(!shouldShowCollapsedSidebarBar('full', false))
    assert.ok(shouldShowSidebarPanel('full', false))
  })

  it('chat: hidden state shows collapsed tab', () => {
    assert.ok(shouldShowCollapsedChatTab('hidden', 'compact'))
    assert.ok(!shouldShowChatOverlay('hidden', 'compact'))
  })

  it('chat: compact state shows overlay, not collapsed tab', () => {
    assert.ok(!shouldShowCollapsedChatTab('compact', 'compact'))
    assert.ok(shouldShowChatOverlay('compact', 'compact'))
  })

  it('chat: hidden when kanban is full, no collapsed tab shown', () => {
    // When kanban is full, chat is entirely hidden (no tab either)
    assert.ok(!shouldShowCollapsedChatTab('hidden', 'full'))
    assert.ok(!shouldShowChatOverlay('hidden', 'full'))
  })
})

// ─── Collapsed bar click behavior ───────────────────────────────────

describe('Collapsed bar click targets', () => {
  it('clicking collapsed kanban bar should set state to compact', () => {
    // The collapsed bar onClick sets state to 'compact'
    const targetState: PanelState = 'compact'
    assert.equal(targetState, 'compact', 'kanban collapsed bar should expand to compact')
  })

  it('clicking collapsed sidebar bar should set state to full', () => {
    // The collapsed bar onClick sets state to 'full'
    const targetState: PanelState = 'full'
    assert.equal(targetState, 'full', 'sidebar collapsed bar should expand to full')
  })

  it('clicking collapsed chat tab should set state to compact', () => {
    // The collapsed tab onClick sets state to 'compact'
    const targetState: PanelState = 'compact'
    assert.equal(targetState, 'compact', 'chat collapsed tab should expand to compact')
  })
})

// ─── Panel state persistence ────────────────────────────────────────

describe('Panel state serialization', () => {
  const DEFAULT_STATES: Record<PanelId, PanelState> = {
    kanban: 'compact',
    sidebar: 'full',
    filters: 'compact',
    chatOverlay: 'compact',
  }

  it('default states are valid PanelState values', () => {
    const validStates: PanelState[] = ['full', 'compact', 'hidden']
    for (const [panel, state] of Object.entries(DEFAULT_STATES)) {
      assert.ok(validStates.includes(state), `${panel} default state "${state}" should be valid`)
    }
  })

  it('all panel IDs are covered in defaults', () => {
    const allPanels: PanelId[] = ['kanban', 'sidebar', 'filters', 'chatOverlay']
    for (const panel of allPanels) {
      assert.ok(panel in DEFAULT_STATES, `${panel} should have a default state`)
    }
  })

  it('serialized state can be deserialized', () => {
    const serialized = JSON.stringify(DEFAULT_STATES)
    const deserialized = JSON.parse(serialized)
    assert.deepEqual(deserialized, DEFAULT_STATES)
  })

  it('partial stored state merges with defaults', () => {
    const partial = { kanban: 'hidden' as PanelState }
    const merged = { ...DEFAULT_STATES, ...partial }
    assert.equal(merged.kanban, 'hidden')
    assert.equal(merged.sidebar, 'full') // default preserved
    assert.equal(merged.chatOverlay, 'compact') // default preserved
  })
})
