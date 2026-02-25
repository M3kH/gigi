/**
 * Stream segments — story integration test + unit tests
 *
 * Tests the pure segment builder without Svelte or DOM dependencies.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { applyEvent, answerSegment, formatGiteaEvent, type SegmentEvent } from '../web/app/lib/utils/segment-builder'
import type { StreamSegment } from '../web/app/lib/types/chat'

describe('applyEvent — full story', () => {
  it('builds correct segment sequence from realistic event flow', () => {
    let segs: StreamSegment[] = []
    const t = 1000

    // 1. text_chunk "Let me help..."
    segs = applyEvent(segs, { type: 'text_chunk', text: 'Let me help...' }, t)
    assert.equal(segs.length, 1)
    assert.equal(segs[0].type, 'text')

    // 2. tool_use scaffold
    segs = applyEvent(segs, { type: 'tool_use', toolUseId: 't1', name: 'scaffold', input: { name: 'my-plugin' } }, t)
    assert.equal(segs.length, 2)
    assert.equal(segs[1].type, 'tool')

    // 3. tool_result scaffold done
    segs = applyEvent(segs, { type: 'tool_result', toolUseId: 't1', result: 'created' }, t)
    assert.equal(segs.length, 2)
    if (segs[1].type === 'tool') {
      assert.equal(segs[1].status, 'done')
      assert.equal(segs[1].result, 'created')
    }

    // 4. text_chunk "I have some questions..."
    segs = applyEvent(segs, { type: 'text_chunk', text: 'I have some questions...' }, t)
    assert.equal(segs.length, 3)
    assert.equal(segs[2].type, 'text')

    // 5. ask_user "What should it do?"
    segs = applyEvent(segs, { type: 'ask_user', questionId: 'q1', question: 'What should it do?', options: ['A', 'B'] }, t)
    assert.equal(segs.length, 4)
    assert.equal(segs[3].type, 'ask_user')

    // 6. answerSegment "B"
    segs = answerSegment(segs, 'q1', 'B', t)
    assert.equal(segs.length, 4)
    if (segs[3].type === 'ask_user') {
      assert.equal(segs[3].answer, 'B')
      assert.equal(segs[3].answeredAt, t)
    }

    // 7. text_chunk "Creating with option B..."
    segs = applyEvent(segs, { type: 'text_chunk', text: 'Creating with option B...' }, t)
    assert.equal(segs.length, 5)
    assert.equal(segs[4].type, 'text')

    // 8. tool_use write-file
    segs = applyEvent(segs, { type: 'tool_use', toolUseId: 't2', name: 'write-file', input: { path: 'index.ts' } }, t)
    assert.equal(segs.length, 6)

    // 9. tool_use git-commit (adjacent tools!)
    segs = applyEvent(segs, { type: 'tool_use', toolUseId: 't3', name: 'git-commit', input: { message: 'init' } }, t)
    assert.equal(segs.length, 7)

    // 10. tool_result write-file
    segs = applyEvent(segs, { type: 'tool_result', toolUseId: 't2', result: 'ok' }, t)
    if (segs[5].type === 'tool') assert.equal(segs[5].status, 'done')

    // 11. tool_result git-commit
    segs = applyEvent(segs, { type: 'tool_result', toolUseId: 't3', result: 'committed' }, t)
    if (segs[6].type === 'tool') assert.equal(segs[6].status, 'done')

    // 12. text_chunk "Done! [repo](/gigi/...)"
    segs = applyEvent(segs, { type: 'text_chunk', text: 'Done! [repo](/gigi/my-plugin)' }, t)
    assert.equal(segs.length, 8)

    // 13. gitea_event push
    segs = applyEvent(segs, { type: 'gitea_event', event: 'push', action: 'created', repo: 'gigi/my-plugin' }, t)
    assert.equal(segs.length, 9)

    // Final type sequence
    assert.deepEqual(
      segs.map((s) => s.type),
      ['text', 'tool', 'text', 'ask_user', 'text', 'tool', 'tool', 'text', 'system'],
    )
  })
})

describe('applyEvent — unit tests', () => {
  it('consecutive text_chunks merge into one segment', () => {
    let segs: StreamSegment[] = []
    segs = applyEvent(segs, { type: 'text_chunk', text: 'Hello ' })
    segs = applyEvent(segs, { type: 'text_chunk', text: 'world' })
    assert.equal(segs.length, 1)
    if (segs[0].type === 'text') {
      assert.equal(segs[0].content, 'Hello world')
    }
  })

  it('text after tool creates new segment (not merged)', () => {
    let segs: StreamSegment[] = []
    segs = applyEvent(segs, { type: 'text_chunk', text: 'before' })
    segs = applyEvent(segs, { type: 'tool_use', toolUseId: 't1', name: 'read', input: {} })
    segs = applyEvent(segs, { type: 'text_chunk', text: 'after' })
    assert.equal(segs.length, 3)
    assert.deepEqual(segs.map((s) => s.type), ['text', 'tool', 'text'])
  })

  it('tool_result for unknown toolUseId is no-op', () => {
    let segs: StreamSegment[] = []
    segs = applyEvent(segs, { type: 'tool_use', toolUseId: 't1', name: 'read', input: {} })
    const before = segs
    segs = applyEvent(segs, { type: 'tool_result', toolUseId: 'unknown', result: 'x' })
    assert.equal(segs, before) // same reference — no change
  })

  it('answerSegment for unknown questionId is no-op', () => {
    let segs: StreamSegment[] = []
    segs = applyEvent(segs, { type: 'ask_user', questionId: 'q1', question: 'hi', options: [] })
    const before = segs
    segs = answerSegment(segs, 'unknown', 'answer')
    assert.equal(segs, before)
  })

  it('ask_user with no options defaults to empty array', () => {
    let segs: StreamSegment[] = []
    segs = applyEvent(segs, { type: 'ask_user', questionId: 'q1', question: 'hi' } as SegmentEvent)
    if (segs[0].type === 'ask_user') {
      assert.deepEqual(segs[0].options, [])
    }
  })
})

describe('Multiple concurrent ask_user questions', () => {
  it('should track multiple unanswered questions independently', () => {
    let segs: StreamSegment[] = []
    const t = 1000

    // Two questions arrive (parallel ask_user tool calls)
    segs = applyEvent(segs, { type: 'ask_user', questionId: 'q1', question: 'First?', options: ['A', 'B'] }, t)
    segs = applyEvent(segs, { type: 'ask_user', questionId: 'q2', question: 'Second?', options: ['X', 'Y'] }, t)

    assert.equal(segs.length, 2)
    assert.equal(segs[0].type, 'ask_user')
    assert.equal(segs[1].type, 'ask_user')

    // Both should be unanswered
    if (segs[0].type === 'ask_user') assert.equal(segs[0].answer, undefined)
    if (segs[1].type === 'ask_user') assert.equal(segs[1].answer, undefined)
  })

  it('answering first question should leave second unanswered', () => {
    let segs: StreamSegment[] = []
    const t = 1000

    segs = applyEvent(segs, { type: 'ask_user', questionId: 'q1', question: 'First?', options: ['A', 'B'] }, t)
    segs = applyEvent(segs, { type: 'ask_user', questionId: 'q2', question: 'Second?', options: ['X', 'Y'] }, t)

    // Answer first question only
    segs = answerSegment(segs, 'q1', 'A', t)

    if (segs[0].type === 'ask_user') {
      assert.equal(segs[0].answer, 'A')
      assert.equal(segs[0].answeredAt, t)
    }
    if (segs[1].type === 'ask_user') {
      assert.equal(segs[1].answer, undefined, 'Second question should remain unanswered')
    }

    // Check: still has unanswered questions
    const hasUnanswered = segs.some(s => s.type === 'ask_user' && s.answer === undefined)
    assert.equal(hasUnanswered, true, 'Should detect unanswered question')
  })

  it('answering all questions should report no unanswered', () => {
    let segs: StreamSegment[] = []
    const t = 1000

    segs = applyEvent(segs, { type: 'ask_user', questionId: 'q1', question: 'First?', options: ['A', 'B'] }, t)
    segs = applyEvent(segs, { type: 'ask_user', questionId: 'q2', question: 'Second?', options: ['X', 'Y'] }, t)

    // Answer both
    segs = answerSegment(segs, 'q1', 'A', t)
    segs = answerSegment(segs, 'q2', 'Y', t)

    const hasUnanswered = segs.some(s => s.type === 'ask_user' && s.answer === undefined)
    assert.equal(hasUnanswered, false, 'All questions should be answered')
  })

  it('answering questions out of order should work', () => {
    let segs: StreamSegment[] = []
    const t = 1000

    segs = applyEvent(segs, { type: 'ask_user', questionId: 'q1', question: 'First?', options: ['A'] }, t)
    segs = applyEvent(segs, { type: 'ask_user', questionId: 'q2', question: 'Second?', options: ['X'] }, t)

    // Answer second first
    segs = answerSegment(segs, 'q2', 'X', t)
    if (segs[0].type === 'ask_user') assert.equal(segs[0].answer, undefined)
    if (segs[1].type === 'ask_user') assert.equal(segs[1].answer, 'X')

    // Now answer first
    segs = answerSegment(segs, 'q1', 'A', t)
    if (segs[0].type === 'ask_user') assert.equal(segs[0].answer, 'A')

    const hasUnanswered = segs.some(s => s.type === 'ask_user' && s.answer === undefined)
    assert.equal(hasUnanswered, false)
  })
})

describe('formatGiteaEvent', () => {
  it('formats push event with repo', () => {
    assert.equal(formatGiteaEvent('push', 'created', 'gigi/my-plugin'), 'Push: created — gigi/my-plugin')
  })

  it('formats event without action or repo', () => {
    assert.equal(formatGiteaEvent('repository'), 'Repository')
  })

  it('formats event with action only', () => {
    assert.equal(formatGiteaEvent('issues', 'opened'), 'Issues: opened')
  })
})
