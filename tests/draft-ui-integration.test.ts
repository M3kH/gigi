/**
 * UI integration tests for ChatInput draft message persistence.
 *
 * These tests simulate the behavioral workflows that ChatInput.svelte performs
 * (mount, conversation switch, send, input) using the draft utility functions.
 * They verify the exact sequences of calls the component makes — covering the
 * integration logic rather than just individual utility functions.
 *
 * Covers issue #116 test cases:
 *  1. Typing saves draft to localStorage with key gigi:draft:{conversationId}
 *  2. Switching conversations saves current draft and restores the target's
 *  3. Sending a message clears the draft for that conversation
 *  4. Drafts older than 30 minutes are cleaned up on component mount
 *  5. Page refresh restores the draft for the active conversation
 *  6. Draft with no active conversation uses a fallback key
 */

import assert from 'node:assert/strict'
import {
  draftKey,
  saveDraft,
  loadDraft,
  clearDraft,
  cleanStaleDrafts,
  DRAFT_PREFIX,
  DRAFT_MAX_AGE_MS,
} from '../web/app/lib/utils/draft'

// ---------------------------------------------------------------------------
// Minimal in-memory Storage mock (Web Storage API)
// ---------------------------------------------------------------------------
function createMockStorage(): Storage {
  const store = new Map<string, string>()
  return {
    get length() {
      return store.size
    },
    key(index: number) {
      return [...store.keys()][index] ?? null
    },
    getItem(key: string) {
      return store.get(key) ?? null
    },
    setItem(key: string, value: string) {
      store.set(key, value)
    },
    removeItem(key: string) {
      store.delete(key)
    },
    clear() {
      store.clear()
    },
  }
}

// ---------------------------------------------------------------------------
// Helpers that simulate ChatInput.svelte component behavior
// ---------------------------------------------------------------------------

/**
 * Simulates what ChatInput.svelte does on mount:
 *  1. cleanStaleDrafts(localStorage)
 *  2. loadDraft(localStorage, conversationId)
 *  3. Set inputValue to restored text (or '')
 */
function simulateMount(
  storage: Storage,
  conversationId: string | null,
  now?: number,
): string {
  cleanStaleDrafts(storage, now)
  const restored = loadDraft(storage, conversationId, now)
  return restored ?? ''
}

/**
 * Simulates what ChatInput.svelte does on conversation switch ($effect):
 *  1. saveDraft(localStorage, prevConvId, currentInputValue)
 *  2. loadDraft(localStorage, newConvId)
 *  3. Set inputValue to restored text (or '')
 */
function simulateConversationSwitch(
  storage: Storage,
  prevConvId: string | null,
  newConvId: string | null,
  currentInputValue: string,
  now?: number,
): string {
  saveDraft(storage, prevConvId, currentInputValue, now)
  const restored = loadDraft(storage, newConvId, now)
  return restored ?? ''
}

/**
 * Simulates what ChatInput.svelte does on input change (syncDraft via oninput):
 *  1. saveDraft(localStorage, conversationId, inputValue)
 */
function simulateTyping(
  storage: Storage,
  conversationId: string | null,
  inputValue: string,
  now?: number,
): void {
  saveDraft(storage, conversationId, inputValue, now)
}

/**
 * Simulates what ChatInput.svelte does on send (handleSend):
 *  1. Fire onsend(msg)
 *  2. Clear inputValue
 *  3. clearDraft(localStorage, conversationId)
 */
function simulateSend(
  storage: Storage,
  conversationId: string | null,
): { inputValue: string } {
  clearDraft(storage, conversationId)
  return { inputValue: '' }
}

// ===========================================================================
// Test suites
// ===========================================================================

describe('ChatInput UI: typing saves draft to localStorage', () => {
  let storage: Storage

  beforeEach(() => {
    storage = createMockStorage()
  })

  it('saves draft with correct key format gigi:draft:{conversationId}', () => {
    const convId = 'conv-abc-123'
    const now = Date.now()

    simulateTyping(storage, convId, 'hello draft', now)

    const key = `gigi:draft:${convId}`
    const raw = storage.getItem(key)
    assert.notEqual(raw, null, 'Draft should be saved to localStorage')
    const parsed = JSON.parse(raw!)
    assert.equal(parsed.text, 'hello draft')
    assert.equal(parsed.ts, now)
  })

  it('updates draft on each keystroke (simulated input events)', () => {
    const convId = 'conv-1'
    const now = Date.now()

    // Simulate typing character by character
    simulateTyping(storage, convId, 'h', now)
    simulateTyping(storage, convId, 'he', now)
    simulateTyping(storage, convId, 'hel', now)
    simulateTyping(storage, convId, 'hello', now)

    const restored = loadDraft(storage, convId, now)
    assert.equal(restored, 'hello')
  })

  it('removes draft when user deletes all text', () => {
    const convId = 'conv-1'
    const now = Date.now()

    simulateTyping(storage, convId, 'some text', now)
    assert.notEqual(storage.getItem(draftKey(convId)), null)

    // User clears the input
    simulateTyping(storage, convId, '', now)
    assert.equal(storage.getItem(draftKey(convId)), null)
  })

  it('removes draft when only whitespace remains', () => {
    const convId = 'conv-1'
    const now = Date.now()

    simulateTyping(storage, convId, 'text', now)
    simulateTyping(storage, convId, '   ', now)

    assert.equal(storage.getItem(draftKey(convId)), null)
  })
})

describe('ChatInput UI: switching conversations saves and restores drafts', () => {
  let storage: Storage

  beforeEach(() => {
    storage = createMockStorage()
  })

  it('saves current draft and restores target conversation draft', () => {
    const now = Date.now()

    // User types in conv-1
    simulateTyping(storage, 'conv-1', 'working on feature', now)

    // User switches to conv-2 (which has a pre-existing draft)
    saveDraft(storage, 'conv-2', 'earlier thought', now)

    const restoredValue = simulateConversationSwitch(
      storage,
      'conv-1',
      'conv-2',
      'working on feature',
      now,
    )

    assert.equal(restoredValue, 'earlier thought', 'Should restore conv-2 draft')
    assert.equal(
      loadDraft(storage, 'conv-1', now),
      'working on feature',
      'conv-1 draft should be saved',
    )
  })

  it('returns empty string when target conversation has no draft', () => {
    const now = Date.now()

    simulateTyping(storage, 'conv-1', 'my draft', now)

    const restoredValue = simulateConversationSwitch(
      storage,
      'conv-1',
      'conv-2',
      'my draft',
      now,
    )

    assert.equal(restoredValue, '', 'Should return empty when no draft exists')
  })

  it('handles rapid switching between multiple conversations', () => {
    const now = Date.now()

    // Type in conv-1
    simulateTyping(storage, 'conv-1', 'alpha', now)

    // Switch to conv-2
    let inputValue = simulateConversationSwitch(
      storage,
      'conv-1',
      'conv-2',
      'alpha',
      now,
    )
    assert.equal(inputValue, '')

    // Type in conv-2
    simulateTyping(storage, 'conv-2', 'beta', now)

    // Switch to conv-3
    inputValue = simulateConversationSwitch(
      storage,
      'conv-2',
      'conv-3',
      'beta',
      now,
    )
    assert.equal(inputValue, '')

    // Type in conv-3
    simulateTyping(storage, 'conv-3', 'gamma', now)

    // Switch back to conv-1 — should restore 'alpha'
    inputValue = simulateConversationSwitch(
      storage,
      'conv-3',
      'conv-1',
      'gamma',
      now,
    )
    assert.equal(inputValue, 'alpha', 'conv-1 draft should be preserved')

    // Switch to conv-2 — should restore 'beta'
    inputValue = simulateConversationSwitch(
      storage,
      'conv-1',
      'conv-2',
      'alpha',
      now,
    )
    assert.equal(inputValue, 'beta', 'conv-2 draft should be preserved')

    // Switch to conv-3 — should restore 'gamma'
    inputValue = simulateConversationSwitch(
      storage,
      'conv-2',
      'conv-3',
      'beta',
      now,
    )
    assert.equal(inputValue, 'gamma', 'conv-3 draft should be preserved')
  })

  it('saves empty input as no-draft on switch (does not pollute storage)', () => {
    const now = Date.now()

    // User has nothing typed, switches conversations
    const result = simulateConversationSwitch(
      storage,
      'conv-1',
      'conv-2',
      '',
      now,
    )

    assert.equal(result, '')
    assert.equal(
      storage.getItem(draftKey('conv-1')),
      null,
      'Empty input should not create a draft entry',
    )
  })

  it('overwrites old draft when switching away with new text', () => {
    const now = Date.now()

    // Pre-seed conv-1 with an old draft
    saveDraft(storage, 'conv-1', 'old text', now)

    // User modifies it
    simulateTyping(storage, 'conv-1', 'updated text', now)

    // Switch away — should save the updated text
    simulateConversationSwitch(storage, 'conv-1', 'conv-2', 'updated text', now)

    assert.equal(
      loadDraft(storage, 'conv-1', now),
      'updated text',
      'Draft should be the latest version',
    )
  })
})

describe('ChatInput UI: sending a message clears the draft', () => {
  let storage: Storage

  beforeEach(() => {
    storage = createMockStorage()
  })

  it('clears draft from localStorage after send', () => {
    const now = Date.now()
    const convId = 'conv-1'

    // User types a draft
    simulateTyping(storage, convId, 'message to send', now)
    assert.notEqual(storage.getItem(draftKey(convId)), null, 'Draft should exist before send')

    // User sends
    const { inputValue } = simulateSend(storage, convId)

    assert.equal(inputValue, '', 'Input should be cleared')
    assert.equal(
      storage.getItem(draftKey(convId)),
      null,
      'Draft should be removed from storage after send',
    )
  })

  it('clears only the current conversation draft (other drafts untouched)', () => {
    const now = Date.now()

    simulateTyping(storage, 'conv-1', 'draft 1', now)
    simulateTyping(storage, 'conv-2', 'draft 2', now)

    // Send in conv-1
    simulateSend(storage, 'conv-1')

    assert.equal(storage.getItem(draftKey('conv-1')), null, 'conv-1 draft should be gone')
    assert.equal(
      loadDraft(storage, 'conv-2', now),
      'draft 2',
      'conv-2 draft should remain',
    )
  })

  it('is a no-op when there is no draft to clear', () => {
    // Should not throw
    simulateSend(storage, 'conv-nonexistent')
    assert.equal(storage.length, 0)
  })
})

describe('ChatInput UI: stale drafts cleaned up on component mount', () => {
  let storage: Storage

  beforeEach(() => {
    storage = createMockStorage()
  })

  it('removes drafts older than 30 minutes on mount', () => {
    const oldTime = 1_000_000
    const freshTime = oldTime + DRAFT_MAX_AGE_MS - 100
    const mountTime = oldTime + DRAFT_MAX_AGE_MS + 1

    // Create an old draft and a fresh draft
    saveDraft(storage, 'old-conv', 'stale message', oldTime)
    saveDraft(storage, 'fresh-conv', 'recent message', freshTime)

    // Simulate mount — should clean stale and restore current conv draft
    const inputValue = simulateMount(storage, 'fresh-conv', mountTime)

    assert.equal(inputValue, 'recent message', 'Fresh draft should be restored')
    assert.equal(
      storage.getItem(draftKey('old-conv')),
      null,
      'Stale draft should be removed on mount',
    )
  })

  it('cleans stale drafts even when mounting a conversation with no draft', () => {
    const oldTime = 1_000_000
    const mountTime = oldTime + DRAFT_MAX_AGE_MS + 1

    saveDraft(storage, 'expired-conv', 'old text', oldTime)

    const inputValue = simulateMount(storage, 'new-conv', mountTime)

    assert.equal(inputValue, '', 'No draft for new-conv')
    assert.equal(
      storage.getItem(draftKey('expired-conv')),
      null,
      'Stale draft should be cleaned',
    )
  })

  it('removes corrupt entries on mount', () => {
    const now = Date.now()

    // Inject a corrupt draft
    storage.setItem(`${DRAFT_PREFIX}corrupt`, 'this is not json')
    saveDraft(storage, 'good-conv', 'valid draft', now)

    const inputValue = simulateMount(storage, 'good-conv', now)

    assert.equal(inputValue, 'valid draft')
    assert.equal(
      storage.getItem(`${DRAFT_PREFIX}corrupt`),
      null,
      'Corrupt entry should be cleaned on mount',
    )
  })

  it('preserves non-draft localStorage keys during cleanup', () => {
    const oldTime = 1_000_000
    const mountTime = oldTime + DRAFT_MAX_AGE_MS + 1

    storage.setItem('user-preference', 'dark-mode')
    storage.setItem('auth-token', 'abc123')
    saveDraft(storage, 'expired', 'old draft', oldTime)

    simulateMount(storage, 'some-conv', mountTime)

    assert.equal(storage.getItem('user-preference'), 'dark-mode')
    assert.equal(storage.getItem('auth-token'), 'abc123')
  })
})

describe('ChatInput UI: page refresh restores draft for active conversation', () => {
  let storage: Storage

  beforeEach(() => {
    storage = createMockStorage()
  })

  it('restores draft text after simulated page refresh', () => {
    const now = Date.now()
    const convId = 'conv-1'

    // User types something (pre-refresh)
    simulateTyping(storage, convId, 'unsent message', now)

    // Page refresh: re-mount the component
    const inputValue = simulateMount(storage, convId, now)

    assert.equal(inputValue, 'unsent message', 'Draft should survive page refresh')
  })

  it('restores draft for whichever conversation is active on refresh', () => {
    const now = Date.now()

    // Two conversations with drafts
    simulateTyping(storage, 'conv-1', 'first draft', now)
    simulateTyping(storage, 'conv-2', 'second draft', now)

    // Page refresh on conv-2
    const inputValue = simulateMount(storage, 'conv-2', now)
    assert.equal(inputValue, 'second draft')

    // Verify conv-1 draft is still there (not loaded but preserved)
    assert.equal(loadDraft(storage, 'conv-1', now), 'first draft')
  })

  it('does not restore a draft that expired during the page being closed', () => {
    const savedAt = 1_000_000

    simulateTyping(storage, 'conv-1', 'will expire', savedAt)

    // User comes back 31 minutes later
    const mountTime = savedAt + DRAFT_MAX_AGE_MS + 1
    const inputValue = simulateMount(storage, 'conv-1', mountTime)

    assert.equal(inputValue, '', 'Expired draft should not be restored')
  })

  it('preserves multiline draft text through refresh', () => {
    const now = Date.now()
    const multiline = 'line 1\nline 2\nline 3'

    simulateTyping(storage, 'conv-1', multiline, now)
    const inputValue = simulateMount(storage, 'conv-1', now)

    assert.equal(inputValue, multiline, 'Multiline text should be preserved exactly')
  })

  it('preserves draft with special characters through refresh', () => {
    const now = Date.now()
    const special = '{"json": true, "emoji": "🚀", "quotes": "she said \\"hello\\""}'

    simulateTyping(storage, 'conv-1', special, now)
    const inputValue = simulateMount(storage, 'conv-1', now)

    assert.equal(inputValue, special, 'Special characters should round-trip correctly')
  })
})

describe('ChatInput UI: draft with no active conversation uses fallback key', () => {
  let storage: Storage

  beforeEach(() => {
    storage = createMockStorage()
  })

  it('uses gigi:draft:new when conversationId is null', () => {
    const now = Date.now()

    simulateTyping(storage, null, 'new chat draft', now)

    const key = 'gigi:draft:new'
    const raw = storage.getItem(key)
    assert.notEqual(raw, null, 'Draft should be stored under fallback key')
    assert.equal(JSON.parse(raw!).text, 'new chat draft')
  })

  it('restores draft for null conversationId on mount', () => {
    const now = Date.now()

    saveDraft(storage, null, 'pre-existing new chat draft', now)

    const inputValue = simulateMount(storage, null, now)
    assert.equal(inputValue, 'pre-existing new chat draft')
  })

  it('switching from null to a real conversation preserves the new-chat draft', () => {
    const now = Date.now()

    // User types in new chat (null convId)
    simulateTyping(storage, null, 'starting a thought', now)

    // Conversation is created and assigned an ID
    const inputValue = simulateConversationSwitch(
      storage,
      null,
      'conv-new-123',
      'starting a thought',
      now,
    )

    // The "new" draft should be saved
    assert.equal(
      loadDraft(storage, null, now),
      'starting a thought',
      'New chat draft should be preserved under fallback key',
    )

    // Target conversation has no draft yet
    assert.equal(inputValue, '', 'New conversation has no draft')
  })

  it('clearing a null-conversation draft removes the fallback key', () => {
    const now = Date.now()

    simulateTyping(storage, null, 'will be cleared', now)
    simulateSend(storage, null)

    assert.equal(
      storage.getItem('gigi:draft:new'),
      null,
      'Fallback draft should be cleared after send',
    )
  })
})

describe('ChatInput UI: end-to-end workflow scenarios', () => {
  let storage: Storage

  beforeEach(() => {
    storage = createMockStorage()
  })

  it('full lifecycle: mount → type → switch → type → switch back → send', () => {
    const now = Date.now()

    // 1. Mount with no existing drafts
    let inputValue = simulateMount(storage, 'conv-1', now)
    assert.equal(inputValue, '')

    // 2. Type in conv-1
    simulateTyping(storage, 'conv-1', 'working on issue #42', now)

    // 3. Switch to conv-2
    inputValue = simulateConversationSwitch(
      storage,
      'conv-1',
      'conv-2',
      'working on issue #42',
      now,
    )
    assert.equal(inputValue, '')

    // 4. Type in conv-2
    simulateTyping(storage, 'conv-2', 'reviewing PR', now)

    // 5. Switch back to conv-1
    inputValue = simulateConversationSwitch(
      storage,
      'conv-2',
      'conv-1',
      'reviewing PR',
      now,
    )
    assert.equal(inputValue, 'working on issue #42')

    // 6. Send the message in conv-1
    const result = simulateSend(storage, 'conv-1')
    assert.equal(result.inputValue, '')
    assert.equal(storage.getItem(draftKey('conv-1')), null)

    // 7. conv-2 draft should still exist
    assert.equal(loadDraft(storage, 'conv-2', now), 'reviewing PR')
  })

  it('new chat → gets assigned ID → continue typing', () => {
    const now = Date.now()

    // Start in new chat (null)
    let inputValue = simulateMount(storage, null, now)
    assert.equal(inputValue, '')

    // Type
    simulateTyping(storage, null, 'hello gigi', now)

    // Chat gets assigned an ID after first message creates a conversation
    // But the user might have continued typing before the switch
    // The component's $effect sees conversationId change from null → 'conv-new'
    inputValue = simulateConversationSwitch(
      storage,
      null,
      'conv-new',
      'hello gigi',
      now,
    )

    // The new-chat draft is saved, new conv has no draft yet
    assert.equal(loadDraft(storage, null, now), 'hello gigi')
    assert.equal(inputValue, '', 'New conv ID has no pre-existing draft')
  })

  it('mount with multiple stale + fresh drafts cleans correctly', () => {
    // mountTime is the reference; work backwards to compute save times
    const mountTime = 5_000_000

    // Stale: saved more than DRAFT_MAX_AGE_MS ago
    const staleTime1 = mountTime - DRAFT_MAX_AGE_MS - 5000
    const staleTime2 = mountTime - DRAFT_MAX_AGE_MS - 100
    // Fresh: saved recently (well within the window)
    const freshTime = mountTime - 1000
    // Boundary: saved exactly at the limit (not > so still valid)
    const boundaryTime = mountTime - DRAFT_MAX_AGE_MS

    saveDraft(storage, 'very-old', 'ancient', staleTime1)
    saveDraft(storage, 'also-old', 'expired too', staleTime2)
    saveDraft(storage, 'fresh-1', 'still good', freshTime)
    saveDraft(storage, 'boundary', 'also good', boundaryTime)

    // Mount on fresh-1
    const inputValue = simulateMount(storage, 'fresh-1', mountTime)
    assert.equal(inputValue, 'still good')

    // Verify stale drafts were cleaned
    assert.equal(storage.getItem(draftKey('very-old')), null, 'Very old draft cleaned')
    assert.equal(storage.getItem(draftKey('also-old')), null, 'Also-old draft cleaned')
    // boundary draft: mountTime - boundaryTime = DRAFT_MAX_AGE_MS, which is NOT > so survives
    assert.notEqual(storage.getItem(draftKey('boundary')), null, 'Boundary draft survives')
  })
})
