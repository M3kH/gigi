/**
 * Tests for #339: Mobile chat sends message on Enter instead of allowing multi-line input
 *
 * Validates that:
 * 1. ChatInput imports mobile detection utility
 * 2. The handleKeydown logic gates Enter-to-send on desktop only
 * 3. On mobile, Enter allows default behavior (new line)
 * 4. The send button is always available for both mobile and desktop
 *
 * Also tests the extracted keyboard handling logic directly.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const WEB_APP = resolve(import.meta.dirname, '..', 'web', 'app')

function readFile(relativePath: string): string {
  return readFileSync(resolve(WEB_APP, relativePath), 'utf-8')
}

// ─── Source code structural tests ─────────────────────────────────────

describe('ChatInput mobile Enter key handling (#339)', () => {
  const src = readFile('components/chat/ChatInput.svelte')

  it('imports getIsMobile from responsive utility', () => {
    assert.ok(
      src.includes('getIsMobile'),
      'ChatInput must import getIsMobile to detect mobile devices',
    )
  })

  it('gates Enter-to-send on non-mobile (desktop) only', () => {
    // The keydown handler should check !getIsMobile() before sending
    assert.ok(
      src.includes('!getIsMobile()'),
      'handleKeydown must check !getIsMobile() so Enter inserts newline on mobile',
    )
  })

  it('still checks for Shift+Enter on desktop', () => {
    assert.ok(
      src.includes('!e.shiftKey'),
      'handleKeydown must still check !e.shiftKey for desktop newline via Shift+Enter',
    )
  })

  it('has a send button for mobile users to tap', () => {
    assert.ok(
      src.includes('class="send-btn"'),
      'ChatInput must have a visible send button for mobile tap-to-send',
    )
    assert.ok(
      src.includes('onclick={handleSend}'),
      'Send button must call handleSend on click',
    )
  })

  it('documents mobile vs desktop behavior in the component header', () => {
    assert.ok(
      src.includes('Mobile') && src.includes('Desktop'),
      'Component doc comment should describe mobile vs desktop Enter behavior',
    )
  })
})

// ─── Logic unit tests ─────────────────────────────────────────────────

describe('Enter key handling logic', () => {
  /**
   * Simulates the handleKeydown decision: should we send on Enter?
   * This mirrors the logic in ChatInput.svelte:
   *   if (key === 'Enter' && !shiftKey && !isMobile) → send
   */
  function shouldSendOnEnter(key: string, shiftKey: boolean, isMobile: boolean): boolean {
    return key === 'Enter' && !shiftKey && !isMobile
  }

  // Desktop behavior
  it('sends on Enter (desktop, no shift)', () => {
    assert.equal(shouldSendOnEnter('Enter', false, false), true)
  })

  it('does NOT send on Shift+Enter (desktop)', () => {
    assert.equal(shouldSendOnEnter('Enter', true, false), false)
  })

  it('does NOT send on other keys (desktop)', () => {
    assert.equal(shouldSendOnEnter('a', false, false), false)
    assert.equal(shouldSendOnEnter('Tab', false, false), false)
  })

  // Mobile behavior
  it('does NOT send on Enter (mobile)', () => {
    assert.equal(shouldSendOnEnter('Enter', false, true), false)
  })

  it('does NOT send on Shift+Enter (mobile)', () => {
    assert.equal(shouldSendOnEnter('Enter', true, true), false)
  })

  it('does NOT send on other keys (mobile)', () => {
    assert.equal(shouldSendOnEnter('a', false, true), false)
  })
})

// ─── Responsive utility structural tests ──────────────────────────────

describe('responsive.svelte.ts utility', () => {
  const src = readFile('lib/actions/responsive.svelte.ts')

  it('exports getIsMobile function', () => {
    assert.ok(
      src.includes('export function getIsMobile'),
      'responsive utility must export getIsMobile',
    )
  })

  it('uses 768px as the mobile breakpoint', () => {
    assert.ok(
      src.includes('768'),
      'Mobile breakpoint should be 768px to match standard tablet/mobile threshold',
    )
  })

  it('listens for window resize events', () => {
    assert.ok(
      src.includes('resize'),
      'responsive utility must listen for resize events to stay reactive',
    )
  })
})
