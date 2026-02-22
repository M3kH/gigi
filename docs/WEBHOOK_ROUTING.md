# Webhook → Chat Routing

## Overview

The webhook routing system automatically connects incoming Gitea webhook events to relevant chat conversations based on tags (repo, issue#, pr#).

## How It Works

1. **Webhook arrives** → `src/webhooks.js` receives and validates the webhook
2. **Extract tags** → `webhookRouter` extracts repo name, issue#/pr# from payload
3. **Find or create chat** → Lookup existing conversation by tags, or auto-create for new issues/PRs
4. **Append system message** → Add formatted webhook event to chat as system message
5. **Auto-close** → Close conversation when issue/PR closes

## Supported Events

- `issues` (opened, closed, reopened, edited)
- `pull_request` (opened, closed, synchronized, merged)
- `issue_comment` / `pull_request_comment`
- `push` (commits pushed)

## Tag Extraction

| Event           | Tags Generated                     |
|-----------------|-------------------------------------|
| issues          | `[repo, repo#N]`                   |
| pull_request    | `[repo, repo#N, pr#N]`             |
| issue_comment   | `[repo, repo#N]`                   |
| push            | `[repo]`                           |

## Auto-Create Behavior

New conversations are automatically created when:
- An issue is opened (`action: 'opened'`)
- A PR is opened (`action: 'opened'`)

The conversation topic is set to: `"Issue #N: title"` or `"PR #N: title"`

## Auto-Close Behavior

Conversations are automatically closed when:
- An issue is closed (`action: 'closed'`)
- A PR is closed or merged (`action: 'closed'` or `merged: true`)

## Message Formatting

System messages use emojis and concise formatting:

### Issue Events
```
📋 Issue #16 opened: "Webhook routing" by @gigi
http://gitea.example.com/idea/gigi/issues/16
```

### PR Events
```
✅ PR #7 merged: "Add dark mode"
feat/dark-mode → main
http://gitea.example.com/idea/gigi/pulls/7
```

### Comments
```
💬 @user commented on issue #16:
"This looks great! Let's merge it."
http://gitea.example.com/idea/gigi/issues/16#comment-123
```

### Push Events
```
📤 @user pushed 3 commit(s) to refs/heads/main:
  • Add webhook routing
  • Update docs
  • Fix tests
```

## Architecture

```
Gitea Webhook
     ↓
src/webhooks.js (validate, parse)
     ↓
lib/webhookRouter.js (route, format)
     ↓
store.js (find/create conversation, add message)
     ↓
Chat UI (displays system message in conversation)
```

## Implementation Files

- `src/lib/webhookRouter.js` - Core routing logic
- `src/webhooks.js` - Webhook handler integration
- `tests/webhookRouter.test.js` - Test suite

## Example Usage

When a user runs `/issue gigi#16`, Gigi:
1. Creates/loads conversation
2. Auto-tags with `["gigi", "gigi#16"]`
3. Future webhooks for gigi#16 are routed to this conversation
4. User sees issue updates in real-time within the chat context
