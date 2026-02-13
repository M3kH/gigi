import { describe, expect, it, vi, beforeEach } from 'vitest'
import { routeWebhook } from '../src/lib/webhookRouter.js'
import * as store from '../src/store.js'
import { runAgent } from '../src/agent.js'
import { emit } from '../src/events.js'

// Mock dependencies
vi.mock('../src/store.js')
vi.mock('../src/agent.js')
vi.mock('../src/events.js')

describe('Webhook Agent Mentions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should invoke agent when @gigi is mentioned by @ideabile in issue comment', async () => {
    const mockConversation = { id: 'conv-123', status: 'open' }
    const mockMessages = [
      { role: 'system', content: [{ type: 'text', text: 'Issue opened' }] }
    ]
    const mockAgentResponse = {
      text: 'I understand the issue and will help fix it.',
      toolCalls: [],
      toolResults: {},
      sessionId: 'session-123'
    }

    vi.mocked(store.findByTag).mockResolvedValue([mockConversation])
    vi.mocked(store.getMessages).mockResolvedValue(mockMessages)
    vi.mocked(store.addMessage).mockResolvedValue()
    vi.mocked(runAgent).mockResolvedValue(mockAgentResponse)

    const payload = {
      action: 'created',
      comment: {
        body: '@gigi please fix the authentication bug in the login flow',
        user: { login: 'ideabile' },
        html_url: 'https://gitea.example.com/repo/issues/123#comment-456'
      },
      issue: {
        number: 123,
        title: 'Authentication fails on login'
      },
      repository: {
        name: 'test-repo',
        full_name: 'idea/test-repo'
      }
    }

    const result = await routeWebhook('issue_comment', payload)

    expect(result).toBeDefined()
    expect(result.agentInvoked).toBe(true)

    // Verify agent was called
    expect(runAgent).toHaveBeenCalledWith(
      expect.any(Array),
      expect.any(Function)
    )

    // Verify message was stored
    expect(store.addMessage).toHaveBeenCalledWith(
      'conv-123',
      'user',
      expect.arrayContaining([{
        type: 'text',
        text: expect.stringContaining('please fix the authentication bug')
      }]),
      expect.objectContaining({
        message_type: 'github_mention',
        github_user: 'ideabile'
      })
    )
  })

  it('should not invoke agent when @gigi is mentioned by other users', async () => {
    const mockConversation = { id: 'conv-123', status: 'open' }

    vi.mocked(store.findByTag).mockResolvedValue([mockConversation])
    vi.mocked(store.addMessage).mockResolvedValue()

    const payload = {
      action: 'created',
      comment: {
        body: '@gigi please help',
        user: { login: 'other-user' }
      },
      issue: { number: 123 },
      repository: { name: 'test-repo' }
    }

    const result = await routeWebhook('issue_comment', payload)

    expect(result.agentInvoked).toBe(false)
    expect(runAgent).not.toHaveBeenCalled()
  })

  it('should invoke agent when @gigi is mentioned in PR review comment', async () => {
    const mockConversation = { id: 'conv-456', status: 'open' }
    const mockAgentResponse = {
      text: 'I will address this code review feedback.',
      toolCalls: [],
      toolResults: {}
    }

    vi.mocked(store.findByTag).mockResolvedValue([mockConversation])
    vi.mocked(store.getMessages).mockResolvedValue([])
    vi.mocked(store.addMessage).mockResolvedValue()
    vi.mocked(runAgent).mockResolvedValue(mockAgentResponse)

    const payload = {
      action: 'created',
      comment: {
        body: '@gigi this function needs error handling',
        user: { login: 'ideabile' },
        html_url: 'https://gitea.example.com/repo/pulls/45#comment-789'
      },
      pull_request: {
        number: 45,
        title: 'Add new feature'
      },
      repository: {
        name: 'test-repo',
        full_name: 'idea/test-repo'
      }
    }

    const result = await routeWebhook('pull_request_review_comment', payload)

    expect(result).toBeDefined()
    expect(result.agentInvoked).toBe(true)
    expect(runAgent).toHaveBeenCalled()
  })

  it('should handle agent errors gracefully', async () => {
    const mockConversation = { id: 'conv-789', status: 'open' }

    vi.mocked(store.findByTag).mockResolvedValue([mockConversation])
    vi.mocked(store.getMessages).mockResolvedValue([])
    vi.mocked(store.addMessage).mockResolvedValue()
    vi.mocked(runAgent).mockRejectedValue(new Error('Agent failed'))

    const payload = {
      action: 'created',
      comment: {
        body: '@gigi do something',
        user: { login: 'ideabile' }
      },
      issue: { number: 789 },
      repository: { name: 'test-repo' }
    }

    const result = await routeWebhook('issue_comment', payload)

    expect(result.agentInvoked).toBe(false)

    // Verify error was stored
    expect(store.addMessage).toHaveBeenCalledWith(
      'conv-789',
      'system',
      expect.arrayContaining([{
        type: 'text',
        text: expect.stringContaining('Failed to process @gigi mention')
      }]),
      expect.objectContaining({
        message_type: 'error'
      })
    )
  })
})