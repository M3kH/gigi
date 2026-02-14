/**
 * API Webhooks — webhook payload and routing types.
 */

export interface WebhookPayload {
  action: string
  repository?: { name: string; full_name: string }
  issue?: {
    number: number
    title: string
    user?: { login: string }
    html_url?: string
  }
  pull_request?: {
    number: number
    title: string
    user?: { login: string }
    html_url?: string
    merged?: boolean
    head?: { ref: string }
    base?: { ref: string }
  }
  comment?: {
    body: string
    user?: { login: string }
    html_url?: string
  }
  number?: number
  commits?: Array<{ message: string }>
  pusher?: { login: string }
  ref?: string
}

export interface WebhookResult {
  conversationId: string
  tags: string[]
  systemMessage: string
  agentInvoked: boolean
}
