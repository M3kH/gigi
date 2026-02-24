/**
 * Tests for cost widget grid layout
 *
 * Validates that the OverviewDashboard has the CostWidget
 * inline in the stats-row spanning 2 grid columns.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const dashboardPath = resolve(
  import.meta.dirname ?? __dirname,
  '../web/app/components/dashboard/OverviewDashboard.svelte'
)

const src = readFileSync(dashboardPath, 'utf-8')

describe('CostWidget grid layout', () => {
  it('CostWidget is inside stats-row, not in a separate section', () => {
    // The CostWidget should be wrapped in .stat-cost inside .stats-row
    // and NOT in a separate .cost-section div
    assert.ok(
      src.includes('class="stat-cost"'),
      'Expected .stat-cost wrapper for CostWidget'
    )
    assert.ok(
      !src.includes('class="cost-section"'),
      'CostWidget should NOT be in a separate .cost-section'
    )
  })

  it('stat-cost is inside the stats-row div', () => {
    // Extract the stats-row HTML block
    const statsRowStart = src.indexOf('class="stats-row"')
    assert.ok(statsRowStart !== -1, 'stats-row should exist')

    // Find the closing </div> for stats-row by counting nesting
    const statCostPos = src.indexOf('class="stat-cost"')
    assert.ok(statCostPos !== -1, 'stat-cost should exist')
    assert.ok(
      statCostPos > statsRowStart,
      'stat-cost should appear after stats-row opens'
    )

    // CostWidget should be inside the stat-cost wrapper
    const costWidgetPos = src.indexOf('<CostWidget', statCostPos)
    assert.ok(
      costWidgetPos !== -1 && costWidgetPos - statCostPos < 100,
      'CostWidget should be directly inside stat-cost'
    )
  })

  it('grid template has 7 columns (auto + 6x1fr)', () => {
    assert.ok(
      src.includes('grid-template-columns: auto repeat(6, 1fr)'),
      'Stats row should use auto repeat(6, 1fr) for 7 columns'
    )
  })

  it('stat-cost spans 2 grid columns', () => {
    assert.ok(
      src.includes('grid-column: span 2'),
      'stat-cost should span 2 grid columns'
    )
  })

  it('stat-cost goes full-width on mobile (max-width: 900px)', () => {
    // Check that the mobile breakpoint includes stat-cost full-width
    const mobileSection = src.indexOf('@media (max-width: 900px)')
    assert.ok(mobileSection !== -1, 'Should have a 900px mobile breakpoint')

    // After the mobile breakpoint, stat-cost should have grid-column: 1 / -1
    const afterMobile = src.slice(mobileSection)
    assert.ok(
      afterMobile.includes('.stat-cost') && afterMobile.includes('grid-column: 1 / -1'),
      'stat-cost should go full-width on mobile'
    )
  })
})
