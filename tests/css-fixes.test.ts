/**
 * Tests for #193: CSS bug fixes
 *
 * Verifies CSS structural properties in Kanban and CostWidget components
 * to prevent regressions in layout behavior.
 *
 * Covers:
 * 1. Kanban collapsed columns: proper alignment without hardcoded padding-top
 * 2. Kanban columns: no restrictive max-width that causes uneven distribution
 * 3. CostWidget: overflow handling on cost-header
 * 4. CostWidget: over-budget visual indicator on cost-bar
 * 5. CostWidget: text truncation on cost-value and cost-label
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Read the component source files for CSS structural assertions
const kanbanCSS = readFileSync(
  resolve(import.meta.dirname, '../web/app/components/GigiKanban.svelte'),
  'utf-8',
)
const costWidgetCSS = readFileSync(
  resolve(import.meta.dirname, '../web/app/components/dashboard/CostWidget.svelte'),
  'utf-8',
)

// ─── Helper: extract CSS block for a selector ───────────────────────────

function extractCSSBlock(source: string, selector: string): string {
  // Escape special regex chars in selector
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  // Match the selector and its { ... } block (handles nested braces simply)
  const regex = new RegExp(`${escaped}\\s*\\{([^}]+)\\}`)
  const match = source.match(regex)
  return match ? match[1] : ''
}

function hasProperty(block: string, property: string, value?: string): boolean {
  const lines = block.split('\n').map(l => l.trim()).filter(Boolean)
  return lines.some(line => {
    if (!line.includes(property)) return false
    if (value !== undefined) return line.includes(value)
    return true
  })
}

// ─── Kanban: Collapsed columns ──────────────────────────────────────────

describe('Kanban collapsed columns CSS', () => {
  it('should not have hardcoded padding-top: 28px (misalignment bug)', () => {
    const block = extractCSSBlock(kanbanCSS, '.collapsed-columns')
    assert.ok(block, '.collapsed-columns CSS block should exist')
    assert.ok(
      !hasProperty(block, 'padding-top', '28px'),
      'Should not have padding-top: 28px which causes misalignment',
    )
  })

  it('should use align-self: stretch to fill column height', () => {
    const block = extractCSSBlock(kanbanCSS, '.collapsed-columns')
    assert.ok(
      hasProperty(block, 'align-self', 'stretch'),
      'Should have align-self: stretch for proper vertical alignment',
    )
  })

  it('should have background to match column background', () => {
    const block = extractCSSBlock(kanbanCSS, '.collapsed-columns')
    assert.ok(
      hasProperty(block, 'background'),
      'Should have explicit background color',
    )
  })
})

// ─── Kanban: Column sizing ──────────────────────────────────────────────

describe('Kanban column sizing CSS', () => {
  it('should not have a restrictive max-width on .column', () => {
    const block = extractCSSBlock(kanbanCSS, '.column')
    assert.ok(block, '.column CSS block should exist')
    assert.ok(
      !hasProperty(block, 'max-width'),
      'Should not have max-width which restricts column distribution',
    )
  })

  it('should retain flex: 1 for even column distribution', () => {
    const block = extractCSSBlock(kanbanCSS, '.column')
    assert.ok(
      hasProperty(block, 'flex', '1'),
      'Should have flex: 1 for even distribution',
    )
  })

  it('should retain min-width for minimum readable width', () => {
    const block = extractCSSBlock(kanbanCSS, '.column')
    assert.ok(
      hasProperty(block, 'min-width'),
      'Should have min-width to ensure columns are readable',
    )
  })
})

// ─── CostWidget: Overflow handling ──────────────────────────────────────

describe('CostWidget overflow handling CSS', () => {
  it('should have overflow: hidden on .cost-header', () => {
    const block = extractCSSBlock(costWidgetCSS, '.cost-header')
    assert.ok(block, '.cost-header CSS block should exist')
    assert.ok(
      hasProperty(block, 'overflow', 'hidden'),
      'Should have overflow: hidden to prevent content spilling out',
    )
  })

  it('should have white-space: nowrap on .cost-value', () => {
    const block = extractCSSBlock(costWidgetCSS, '.cost-value')
    assert.ok(block, '.cost-value CSS block should exist')
    assert.ok(
      hasProperty(block, 'white-space', 'nowrap'),
      'Should have white-space: nowrap to prevent wrapping of cost amount',
    )
  })

  it('should have white-space: nowrap on .cost-label', () => {
    const block = extractCSSBlock(costWidgetCSS, '.cost-label')
    assert.ok(block, '.cost-label CSS block should exist')
    assert.ok(
      hasProperty(block, 'white-space', 'nowrap'),
      'Should have white-space: nowrap to prevent wrapping of budget label',
    )
  })
})

// ─── CostWidget: Over-budget indicator ──────────────────────────────────

describe('CostWidget over-budget indicator CSS', () => {
  it('should have .cost-bar.over-budget style', () => {
    const block = extractCSSBlock(costWidgetCSS, '.cost-bar.over-budget')
    assert.ok(
      block,
      '.cost-bar.over-budget CSS block should exist for the striped over-budget indicator',
    )
  })

  it('should use a repeating-linear-gradient for over-budget bar', () => {
    const block = extractCSSBlock(costWidgetCSS, '.cost-bar.over-budget')
    assert.ok(
      block.includes('repeating-linear-gradient'),
      'Over-budget bar should use repeating-linear-gradient for striped pattern',
    )
  })

  it('should apply over-budget class in template when budget is exceeded', () => {
    // Verify the template binds over-budget class conditionally
    assert.ok(
      costWidgetCSS.includes('class:over-budget={budget.overBudget}'),
      'Template should conditionally apply over-budget class to cost-bar',
    )
  })

  it('should have min-width: 0 on .cost-summary for flex truncation', () => {
    const block = extractCSSBlock(costWidgetCSS, '.cost-summary')
    assert.ok(block, '.cost-summary CSS block should exist')
    assert.ok(
      hasProperty(block, 'min-width', '0'),
      'Should have min-width: 0 to allow flex truncation',
    )
  })
})
