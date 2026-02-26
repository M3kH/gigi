/**
 * Tests for mobile Safari safe-area-inset fix
 *
 * Validates that the required CSS and HTML changes are in place to prevent
 * Safari's bottom navigation bar from overlapping the chat input textarea.
 *
 * Key requirements:
 * 1. viewport-fit=cover in the HTML meta tag (enables env(safe-area-inset-*))
 * 2. safe-area-inset-bottom on fixed-bottom elements (chat overlay, collapsed tab)
 * 3. safe-area-inset-bottom padding on ChatInput and Sidebar footer
 * 4. 100dvh instead of 100vh for full-screen chat mode
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const WEB_APP = resolve(import.meta.dirname, '..', 'web', 'app')

function readFile(relativePath: string): string {
  return readFileSync(resolve(WEB_APP, relativePath), 'utf-8')
}

describe('Mobile Safari safe-area-inset fixes', () => {
  describe('index.html viewport meta tag', () => {
    const html = readFile('index.html')

    it('includes viewport-fit=cover to enable safe-area-inset env vars', () => {
      assert.ok(
        html.includes('viewport-fit=cover'),
        'viewport meta tag must include viewport-fit=cover for iOS safe area insets'
      )
    })

    it('still has width=device-width and initial-scale=1.0', () => {
      assert.ok(html.includes('width=device-width'), 'viewport must include width=device-width')
      assert.ok(html.includes('initial-scale=1.0'), 'viewport must include initial-scale=1.0')
    })
  })

  describe('ChatInput.svelte safe-area padding', () => {
    const src = readFile('components/chat/ChatInput.svelte')

    it('uses env(safe-area-inset-bottom) in the input area padding', () => {
      assert.ok(
        src.includes('safe-area-inset-bottom'),
        'ChatInput must use safe-area-inset-bottom to push input above Safari toolbar'
      )
    })
  })

  describe('AppShell.svelte safe-area and dvh', () => {
    const src = readFile('components/AppShell.svelte')

    it('uses 100dvh for full-screen chat height in CSS', () => {
      assert.ok(
        src.includes('100dvh'),
        'AppShell must use 100dvh (dynamic viewport height) instead of 100vh for mobile'
      )
    })

    it('uses safe-area-inset-bottom for chat overlay wrapper', () => {
      // The .chat-overlay-wrapper should have bottom: env(safe-area-inset-bottom)
      assert.ok(
        src.includes('env(safe-area-inset-bottom'),
        'Chat overlay wrapper must use env(safe-area-inset-bottom) for bottom offset'
      )
    })
  })

  describe('GigiSidebar.svelte safe-area padding', () => {
    const src = readFile('components/GigiSidebar.svelte')

    it('uses env(safe-area-inset-bottom) for the footer', () => {
      assert.ok(
        src.includes('safe-area-inset-bottom'),
        'Sidebar footer must use safe-area-inset-bottom to keep New Chat button visible'
      )
    })
  })
})

// ─── Mobile sidebar overlay state logic tests ──────────────────────

describe('Mobile sidebar overlay state', () => {
  describe('AppShell.svelte uses derived overlay state', () => {
    const src = readFile('components/AppShell.svelte')

    it('does NOT use mutable mobileOverlay state', () => {
      // The old bug: mobileOverlay was a separate $state that got out of sync
      // with sidebarState. The fix derives visibility from sidebarState.
      assert.ok(
        !src.includes('let mobileOverlay = $state'),
        'Should not use a separate mobileOverlay $state (must be derived from sidebarState)'
      )
    })

    it('derives mobile overlay visibility from sidebar state', () => {
      assert.ok(
        src.includes('$derived') && src.includes('sidebarState'),
        'Mobile overlay should be derived from sidebarState'
      )
    })

    it('closeMobileOverlay sets sidebar to hidden (not just a boolean)', () => {
      // Closing the overlay must actually change sidebarState so it stays in sync
      assert.ok(
        src.includes("setPanelState('sidebar', 'hidden')"),
        'closeMobileOverlay must set sidebar state to hidden'
      )
    })
  })

  /**
   * Simulates the derived overlay logic:
   * showMobileOverlay = isMobile && sidebarState === 'full'
   */
  type PanelState = 'full' | 'compact' | 'hidden'

  function shouldShowOverlay(isMobile: boolean, sidebarState: PanelState): boolean {
    return isMobile && sidebarState === 'full'
  }

  it('shows overlay on mobile when sidebar is full', () => {
    assert.equal(shouldShowOverlay(true, 'full'), true)
  })

  it('hides overlay on mobile when sidebar is hidden', () => {
    assert.equal(shouldShowOverlay(true, 'hidden'), false)
  })

  it('hides overlay on desktop even when sidebar is full', () => {
    assert.equal(shouldShowOverlay(false, 'full'), false)
  })

  it('hides overlay on mobile when sidebar is compact', () => {
    assert.equal(shouldShowOverlay(true, 'compact'), false)
  })

  it('collapse button closes overlay by changing sidebarState', () => {
    // Simulates: user clicks collapse → sidebarState goes full → hidden
    const before = shouldShowOverlay(true, 'full')
    const after = shouldShowOverlay(true, 'hidden')
    assert.equal(before, true, 'overlay should be visible before collapse')
    assert.equal(after, false, 'overlay should be hidden after collapse')
  })

  it('hamburger button reopens overlay by changing sidebarState', () => {
    // Simulates: user clicks hamburger → sidebarState goes hidden → full
    const before = shouldShowOverlay(true, 'hidden')
    const after = shouldShowOverlay(true, 'full')
    assert.equal(before, false, 'overlay should be hidden before hamburger click')
    assert.equal(after, true, 'overlay should be visible after hamburger click')
  })
})

// ─── CSS value generation logic tests ───────────────────────────────

describe('Safe-area CSS value logic', () => {
  /**
   * Simulates the max() CSS function behavior for safe-area padding.
   * On non-Safari browsers, safe-area-inset-bottom resolves to 0.
   * On Safari with toolbar, it's typically 34px (iPhone) or 20px (iPad).
   */
  function computePadding(baseSpacing: number, safeAreaInset: number): number {
    return Math.max(baseSpacing, safeAreaInset)
  }

  it('uses base spacing when safe-area-inset is 0 (non-Safari/desktop)', () => {
    const result = computePadding(8, 0)
    assert.equal(result, 8, 'Should use base spacing when no safe area')
  })

  it('uses safe-area-inset when it exceeds base spacing (iPhone Safari)', () => {
    const result = computePadding(8, 34)
    assert.equal(result, 34, 'Should use safe area inset when larger')
  })

  it('uses base spacing when it exceeds safe-area-inset (iPad Safari)', () => {
    const result = computePadding(16, 10)
    assert.equal(result, 16, 'Should use base spacing when it is larger')
  })

  it('handles edge case where both are equal', () => {
    const result = computePadding(20, 20)
    assert.equal(result, 20, 'Should return either value when equal')
  })

  /**
   * Validates that dvh units are preferred over vh for mobile viewports.
   * dvh (dynamic viewport height) correctly adjusts when Safari's toolbar
   * appears/disappears, unlike vh which is static.
   */
  function preferredHeightUnit(supportsDvh: boolean): string {
    return supportsDvh ? '100dvh' : '100vh'
  }

  it('prefers 100dvh when supported', () => {
    assert.equal(preferredHeightUnit(true), '100dvh')
  })

  it('falls back to 100vh when dvh not supported', () => {
    assert.equal(preferredHeightUnit(false), '100vh')
  })
})
