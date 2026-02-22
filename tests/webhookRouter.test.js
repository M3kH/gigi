import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { routeWebhook } from '../src/lib/webhookRouter.js'
import * as store from '../src/store.js'

describe('webhookRouter', () => {
  describe('extractTags', () => {
    it('extracts repo and issue tags from issues event', async () => {
      const payload = {
        action: 'opened',
        repository: { name: 'gigi', full_name: 'idea/gigi' },
        issue: { number: 16, title: 'Test issue', user: { login: 'testuser' } }
      }

      // Create a conversation first to test against
      const conv = await store.createConversation('test', 'Test conv')
      await store.updateConversation(conv.id, {
        tags: ['gigi', 'gigi#16'],
        repo: 'gigi',
        status: 'open'
      })

      const result = await routeWebhook('issues', payload)

      assert.ok(result, 'Should return result')
      assert.ok(result.tags.includes('gigi'), 'Should include repo tag')
      assert.ok(result.tags.includes('gigi#16'), 'Should include issue tag')
    })

    it('extracts repo and PR tags from pull_request event', async () => {
      const payload = {
        action: 'opened',
        number: 7,
        repository: { name: 'gigi', full_name: 'idea/gigi' },
        pull_request: { number: 7, title: 'Test PR', user: { login: 'testuser' } }
      }

      const result = await routeWebhook('pull_request', payload)

      assert.ok(result, 'Should return result')
      assert.ok(result.tags.includes('gigi'), 'Should include repo tag')
      assert.ok(result.tags.includes('gigi#7'), 'Should include PR tag')
      assert.ok(result.tags.includes('pr#7'), 'Should include pr#N tag')
    })
  })

  describe('auto-create conversations', () => {
    it('creates conversation for new issue', async () => {
      const payload = {
        action: 'opened',
        repository: { name: 'test-repo', full_name: 'idea/test-repo' },
        issue: {
          number: 42,
          title: 'New feature request',
          user: { login: 'testuser' },
          html_url: 'http://gitea/issues/42'
        }
      }

      const result = await routeWebhook('issues', payload)

      assert.ok(result, 'Should create conversation')
      assert.ok(result.conversationId, 'Should have conversation ID')
      assert.ok(result.systemMessage.includes('Issue #42'), 'Should format message')

      // Verify conversation was created with correct tags
      const conv = await store.getConversation(result.conversationId)
      assert.ok(conv.tags.includes('test-repo'), 'Should have repo tag')
      assert.ok(conv.tags.includes('test-repo#42'), 'Should have issue tag')
    })

    it('creates conversation for new PR', async () => {
      const payload = {
        action: 'opened',
        number: 8,
        repository: { name: 'test-repo', full_name: 'idea/test-repo' },
        pull_request: {
          number: 8,
          title: 'Add dark mode',
          user: { login: 'testuser' },
          html_url: 'http://gitea/pr/8'
        }
      }

      const result = await routeWebhook('pull_request', payload)

      assert.ok(result, 'Should create conversation')
      assert.ok(result.systemMessage.includes('PR #8'), 'Should format PR message')
    })
  })

  describe('auto-close conversations', () => {
    it('closes conversation when issue closed', async () => {
      // Create conversation
      const conv = await store.createConversation('webhook', 'Test issue')
      await store.updateConversation(conv.id, {
        tags: ['test-repo', 'test-repo#99'],
        repo: 'test-repo',
        status: 'open'
      })

      const payload = {
        action: 'closed',
        repository: { name: 'test-repo', full_name: 'idea/test-repo' },
        issue: {
          number: 99,
          title: 'Closed issue',
          user: { login: 'testuser' }
        }
      }

      await routeWebhook('issues', payload)

      const updated = await store.getConversation(conv.id)
      assert.equal(updated.status, 'closed', 'Should auto-close conversation')
    })
  })

  describe('message formatting', () => {
    it('formats issue opened event', async () => {
      const payload = {
        action: 'opened',
        repository: { name: 'gigi', full_name: 'idea/gigi' },
        issue: {
          number: 16,
          title: 'Webhook routing',
          user: { login: 'gigi' },
          html_url: 'http://gitea/issues/16'
        }
      }

      const result = await routeWebhook('issues', payload)

      assert.ok(result.systemMessage.includes('📋'), 'Should have issue emoji')
      assert.ok(result.systemMessage.includes('Issue #16'), 'Should include issue number')
      assert.ok(result.systemMessage.includes('opened'), 'Should include action')
      assert.ok(result.systemMessage.includes('@gigi'), 'Should include user')
    })

    it('formats PR merged event', async () => {
      const payload = {
        action: 'closed',
        number: 7,
        repository: { name: 'gigi', full_name: 'idea/gigi' },
        pull_request: {
          number: 7,
          title: 'Add feature',
          user: { login: 'testuser' },
          merged: true,
          html_url: 'http://gitea/pr/7'
        }
      }

      const result = await routeWebhook('pull_request', payload)

      assert.ok(result.systemMessage.includes('✅'), 'Should have merged emoji')
      assert.ok(result.systemMessage.includes('PR #7'), 'Should include PR number')
      assert.ok(result.systemMessage.includes('merged'), 'Should indicate merged')
    })

    it('formats comment event', async () => {
      // Create conversation first
      const conv = await store.createConversation('webhook', 'Test')
      await store.updateConversation(conv.id, {
        tags: ['gigi', 'gigi#16'],
        repo: 'gigi',
        status: 'open'
      })

      const payload = {
        action: 'created',
        repository: { name: 'gigi', full_name: 'idea/gigi' },
        issue: { number: 16 },
        comment: {
          user: { login: 'testuser' },
          body: 'This looks good!',
          html_url: 'http://gitea/comment/123'
        }
      }

      const result = await routeWebhook('issue_comment', payload)

      assert.ok(result.systemMessage.includes('💬'), 'Should have comment emoji')
      assert.ok(result.systemMessage.includes('@testuser'), 'Should include commenter')
      assert.ok(result.systemMessage.includes('This looks good!'), 'Should include comment text')
    })
  })
})
