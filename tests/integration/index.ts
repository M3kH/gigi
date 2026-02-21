/**
 * Integration Test Infrastructure — Barrel Export
 *
 * Import everything from here:
 *   import { connectTestDB, createTestThread, issueEvent, ... } from './index'
 */

// Database setup & lifecycle
export {
  connectTestDB,
  disconnectTestDB,
  getTestPool,
  truncateAll,
  TEST_DATABASE_URL,
} from './setup'

// Webhook mocks
export {
  issueEvent,
  issueCommentEvent,
  pullRequestEvent,
  prReviewCommentEvent,
  pushEvent,
  gigiMentionEvent,
  signPayload,
  verifySignature,
  type WebhookRequest,
  type WebhookOptions,
} from './webhook-mock'

// WebSocket test client
export {
  WSTestClient,
  EventCollector,
  type WSEvent,
  type WSClientOptions,
} from './ws-client'

// Agent stub
export {
  AgentStub,
  createAgentStub,
  createSimpleStub,
  createToolStub,
  type StubResponse,
  type StubPattern,
} from './agent-stub'

// Test helpers
export {
  createTestThread,
  createMultiChannelThread,
  simulateWebhook,
  simulateWebhookEvent,
  simulateWebMessage,
  assertThreadEvents,
  assertThreadTags,
  assertThreadStatus,
  collectEvents,
  waitUntil,
  type ThreadEvent,
} from './helpers'
